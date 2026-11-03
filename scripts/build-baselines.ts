/**
 * Build data/historical/va/baselines.json from the committed raw CSVs.
 * Deterministic; CI runs `--check` to ensure the committed JSON is current.
 *
 *   npm run build-baselines
 *   npm run check-baselines
 */
import fs from "node:fs";
import path from "node:path";
import { VA_HISTORICAL_CONTESTS, VA_SPLIT_LOCALITIES, type HistoricalContest } from "@/lib/registry";
import { BaselinesSchema, type Baselines, type ContestBaseline, type Party } from "@/lib/schema";
import { marginDR, normalizeLocality, shares } from "@/lib/historical";
import { numWithCommas, parseCsvRows } from "../pipeline/csv";
import { RAW_SOURCES } from "./fetch-historical";

const RAW = path.resolve("data/historical/va/raw");

/** Parse a historical.elections.virginia.gov contest table CSV. */
export function parseContestCsv(text: string, contest: HistoricalContest): Omit<ContestBaseline, "sourceUrl" | "fetchedAt" | "turnout"> {
  const rows = parseCsvRows(text);
  const header = rows[0]; // ["", "", "Cand A", "Cand B", "Write-Ins", "Total Votes Cast", ("Undervotes")]
  const partyRow = rows[1];
  const cols = header.slice(2).map((name, i) => ({ idx: i + 2, name: name.trim(), party: (partyRow[i + 2] ?? "").trim() }));
  const totalIdx = cols.find((c) => /total votes cast/i.test(c.name))?.idx;
  const candCols = cols.filter((c) => !/total votes|undervotes|overvotes/i.test(c.name));
  const partyOf = (c: { name: string; party: string }): Party => {
    if (/^republican/i.test(c.party)) return "R";
    if (/^democratic/i.test(c.party)) return "D";
    if (/^libertarian/i.test(c.party)) return "L";
    if (/^green/i.test(c.party)) return "G";
    if (/^independent/i.test(c.party)) return "I";
    if (/write-?in/i.test(c.name)) return "W";
    const known = contest.candidates.find((k) => k.match.some((m) => c.name.toLowerCase().includes(m)));
    return known?.party ?? "O";
  };
  const num = (s: string | undefined) => numWithCommas(s) ?? 0;
  const districtRow = rows.find((r) => /^congressional district$/i.test(r[0] ?? ""));
  if (!districtRow) throw new Error(`no district row in contest ${contest.contestId}`);
  const candidates = shares(candCols.map((c) => ({ name: c.name, party: partyOf(c), votes: num(districtRow[c.idx]) })));
  const totalVotes = totalIdx != null ? num(districtRow[totalIdx]) : candidates.reduce((a, c) => a + c.votes, 0);
  const splits = new Set(VA_SPLIT_LOCALITIES[contest.map][contest.race].map(normalizeLocality));
  const localities = rows
    .filter((r) => /^locality$/i.test(r[0] ?? ""))
    .map((r) => {
      const name = r[1].trim();
      const cands = candCols.map((c) => ({ party: partyOf(c), name: c.name, votes: num(r[c.idx]) }));
      return { name, total: totalIdx != null ? num(r[totalIdx]) : cands.reduce((a, c) => a + c.votes, 0), candidates: cands, split: splits.has(normalizeLocality(name)), registered: null, ballotsCast: null };
    });
  return { race: contest.race, year: contest.year, map: contest.map, contestId: contest.contestId, candidates, totalVotes, marginDR: marginDR(candidates, totalVotes), localities };
}

/** District totals from a Registrant_Count_By_Congressional CSV: { "05": {active,total}, ... } */
export function parseRegistrationByDistrict(text: string): Record<string, { active: number; total: number }> {
  const rows = parseCsvRows(text);
  const header = rows[0].map((h) => h.trim());
  const dIdx = header.indexOf("District");
  const aIdx = header.indexOf("TotalActiveVotersDistrict");
  const tIdx = header.indexOf("TotalAllVotersDistrict");
  if (dIdx < 0 || aIdx < 0 || tIdx < 0) throw new Error("unexpected registration CSV header");
  const out: Record<string, { active: number; total: number }> = {};
  for (const r of rows.slice(1)) {
    const m = (r[dIdx] ?? "").match(/CON\s*(\d+)/i);
    if (!m) continue;
    const key = m[1].padStart(2, "0");
    const active = numWithCommas(r[aIdx]);
    const total = numWithCommas(r[tIdx]);
    if (active == null || total == null) continue;
    // Every row repeats the district total; take the max in case of partial rows.
    const prev = out[key];
    if (!prev || total > prev.total) out[key] = { active, total };
  }
  return out;
}

export function build(): Baselines {
  const fetchedAt = "2026-11-03";
  const regFiles: Record<number, string> = { 2018: "registration_2018_congressional.csv", 2024: "registration_2024_congressional.csv", 2026: "registration_2026_congressional.csv" };
  const regByYear: Record<number, Record<string, { active: number; total: number }>> = {};
  for (const [y, f] of Object.entries(regFiles)) regByYear[Number(y)] = parseRegistrationByDistrict(fs.readFileSync(path.join(RAW, f), "utf8"));

  const contests: ContestBaseline[] = VA_HISTORICAL_CONTESTS.map((c) => {
    const parsed = parseContestCsv(fs.readFileSync(path.join(RAW, `${c.contestId}_table.csv`), "utf8"), c);
    const dKey = c.race.split("-")[1];
    const reg = regByYear[c.year]?.[dKey];
    const src = RAW_SOURCES.find((s) => s.file === `${c.contestId}_table.csv`)!;
    return {
      ...parsed,
      sourceUrl: src.url,
      fetchedAt,
      turnout: {
        ballotsCast: parsed.totalVotes,
        registered: reg?.total ?? null,
        rate: reg ? Math.round((parsed.totalVotes / reg.total) * 10000) / 10000 : null,
        note: `Turnout = votes cast in this contest ÷ registered voters (active + inactive) in the district on Nov 1, ${c.year} (Dept. of Elections registrant count). Ballots cast with no vote in this contest are not included.`,
      },
    };
  });

  // Comparable geography for 2018 ↔ 2026 (2021 map): localities wholly inside the district under both maps.
  const comparableGeography: Baselines["comparableGeography"] = {};
  for (const race of ["va-05", "va-09"] as const) {
    const c2018 = contests.find((c) => c.race === race && c.year === 2018)!;
    const c2024 = contests.find((c) => c.race === race && c.year === 2024)!;
    const in2018 = new Set(c2018.localities.filter((l) => !l.split).map((l) => normalizeLocality(l.name)));
    const both = c2024.localities.filter((l) => !l.split && in2018.has(normalizeLocality(l.name))).map((l) => l.name);
    comparableGeography[`${race}:2018`] = {
      localities: both,
      note: `Localities wholly inside ${race.toUpperCase()} under both the 2016 court-ordered map (2018) and the 2021 Supreme Court of Virginia map (2024, 2026). Split localities (${VA_SPLIT_LOCALITIES["2016-court"][race].concat(VA_SPLIT_LOCALITIES["2021-sms"][race]).filter((v, i, a) => a.indexOf(v) === i).join(", ")}) are excluded because locality-level totals include precincts from other districts.`,
    };
  }

  const registration2026: Baselines["registration2026"] = {};
  for (const race of ["va-05", "va-09"] as const) {
    const r = regByYear[2026][race.split("-")[1]];
    if (r) registration2026[race] = { active: r.active, total: r.total, asOf: "2026-11-01", sourceUrl: RAW_SOURCES.find((s) => s.file === "registration_2026_congressional.csv")!.url };
  }
  return { schemaVersion: 1, generatedAt: fetchedAt, contests, comparableGeography, registration2026 };
}

if (process.argv[1]?.endsWith("build-baselines.ts")) {
  const out = BaselinesSchema.parse(build());
  const json = JSON.stringify(out, null, 1) + "\n";
  const target = path.resolve("data/historical/va/baselines.json");
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (cur !== json) {
      console.error("baselines.json is out of date; run `npm run build-baselines`");
      process.exit(1);
    }
    console.log("baselines.json up to date");
  } else {
    fs.writeFileSync(target, json);
    for (const c of out.contests) console.log(`${c.year} ${c.race}: ${c.candidates.map((x) => `${x.party} ${x.votes}`).join(" / ")} total=${c.totalVotes} marginDR=${c.marginDR} localities=${c.localities.length} reg=${c.turnout.registered} rate=${c.turnout.rate}`);
    for (const [k, v] of Object.entries(out.comparableGeography)) console.log(`${k}: ${v.localities.length} comparable localities`);
    console.log("registration2026", out.registration2026);
  }
}
