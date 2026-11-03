/**
 * Build data/historical/tx/baselines.json (county-level U.S. Senate results for
 * 2024 and 2018, plus 2024 registration by county) from the committed raw VTD CSVs.
 * Deterministic; CI runs `--check` to ensure the committed JSON is current.
 *
 *   npm run build-tx-baselines
 *   npm run check-tx-baselines
 */
import fs from "node:fs";
import path from "node:path";
import { TX_HISTORICAL_CONTESTS, TX_TLC_API, TX_VOTER_DATA } from "@/lib/registry";
import { UnitBaselinesSchema, type Party, type UnitBaselineContest, type UnitBaselines } from "@/lib/schema";
import { parseCsvRows } from "../pipeline/csv";

const RAW = path.resolve("data/historical/tx/raw");
const OUT = path.resolve("data/historical/tx/baselines.json");

/** "001" → "Anderson County" from the Census code list (pipe-delimited). */
export function parseCountyCodes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const f = line.split("|");
    if (f.length >= 5 && f[0] === "TX") out.set(f[2], f[4]);
  }
  return out;
}

/** Column header "AllredD_24G_U.S. Sen" → { name: "Allred", party: "D" }. */
export function parseCandidateHeader(h: string): { name: string; party: Party } | null {
  const m = h.match(/^(.*?)([DRLGIW])_\d{2}[A-Z]_/);
  if (!m) return null;
  const letter = m[2] as Party;
  return { name: m[1], party: letter === "W" ? "W" : letter };
}

/** Aggregate a TLC VTD returns CSV to counties. */
export function aggregateVtdReturns(text: string, counties: Map<string, string>): { candidates: { name: string; party: Party; votes: number }[]; units: Map<string, { dem: number; rep: number; other: number; total: number }> } {
  const rows = parseCsvRows(text);
  const header = rows[0];
  const cols = header.map((h, i) => ({ i, c: parseCandidateHeader(h) })).filter((x): x is { i: number; c: { name: string; party: Party } } => x.c != null);
  const totals = cols.map((x) => ({ ...x.c, votes: 0 }));
  const units = new Map<string, { dem: number; rep: number; other: number; total: number }>();
  for (const r of rows.slice(1)) {
    const fips = r[0].replace(/"/g, "").slice(0, 3);
    if (!counties.has(fips)) throw new Error(`unknown county code ${fips} in ${r[0]}`);
    const u = units.get(fips) ?? { dem: 0, rep: 0, other: 0, total: 0 };
    cols.forEach((x, k) => {
      const v = Number(r[x.i] ?? 0) || 0;
      totals[k].votes += v;
      if (x.c.party === "D") u.dem += v;
      else if (x.c.party === "R") u.rep += v;
      else u.other += v;
      u.total += v;
    });
    units.set(fips, u);
  }
  return { candidates: totals, units };
}

/** Sum Voter_Registration and Turnout per county from the TLC voter-data CSV. */
export function aggregateVoterData(text: string): Map<string, { registered: number; ballots: number }> {
  const rows = parseCsvRows(text);
  const h = rows[0];
  const ri = h.indexOf("Voter_Registration");
  const ti = h.indexOf("Turnout");
  if (ri < 0 || ti < 0) throw new Error("unexpected voter data header");
  const out = new Map<string, { registered: number; ballots: number }>();
  for (const r of rows.slice(1)) {
    const fips = r[0].replace(/"/g, "").slice(0, 3);
    const u = out.get(fips) ?? { registered: 0, ballots: 0 };
    u.registered += Number(r[ri]) || 0;
    u.ballots += Number(r[ti]) || 0;
    out.set(fips, u);
  }
  return out;
}

export function build(): UnitBaselines {
  const read = (f: string) => fs.readFileSync(path.join(RAW, f), "utf8");
  const counties = parseCountyCodes(read("tx_county_codes_2020.txt"));
  const voter = aggregateVoterData(read(TX_VOTER_DATA.file));
  const contests: UnitBaselineContest[] = TX_HISTORICAL_CONTESTS.map((c) => {
    const agg = aggregateVtdReturns(read(c.file), counties);
    const total = agg.candidates.reduce((a, x) => a + x.votes, 0);
    const dem = agg.candidates.filter((x) => x.party === "D").reduce((a, x) => a + x.votes, 0);
    const rep = agg.candidates.filter((x) => x.party === "R").reduce((a, x) => a + x.votes, 0);
    const reg = c.year === TX_VOTER_DATA.year ? [...voter.values()].reduce((a, v) => a + v.registered, 0) : null;
    return {
      race: "tx-sen",
      year: c.year,
      label: c.label,
      sourceUrl: `${TX_TLC_API}/${c.electionId}/${c.officeId}/vtd`,
      candidates: agg.candidates.map((x) => ({ ...x, share: total ? x.votes / total : null })),
      totalVotes: total,
      marginDR: total ? Math.round(((dem - rep) / total) * 10000) / 100 : null,
      registered: reg,
      units: [...agg.units.entries()]
        .map(([fips, u]) => ({ name: counties.get(fips)!, fips, ...u, registered: c.year === TX_VOTER_DATA.year ? (voter.get(fips)?.registered ?? null) : null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  return UnitBaselinesSchema.parse({ schemaVersion: 1, generatedAt: new Date().toISOString(), unitKind: "county", contests });
}

function main() {
  const built = build();
  if (process.argv.includes("--check")) {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const strip = (b: UnitBaselines) => JSON.stringify({ ...b, generatedAt: null });
    if (strip(existing) !== strip(built)) {
      console.error("data/historical/tx/baselines.json is out of date; run npm run build-tx-baselines");
      process.exit(1);
    }
    console.log("tx baselines up to date");
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(built, null, 1) + "\n");
  for (const c of built.contests) console.log(`${c.label}: total ${c.totalVotes} marginDR ${c.marginDR} counties ${c.units.length} registered ${c.registered ?? "–"}`);
}

if (process.argv[1]?.endsWith("build-tx-baselines.ts")) main();
