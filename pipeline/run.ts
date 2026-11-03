/**
 * Pipeline orchestrator. Run by GitHub Actions (and locally with `npm run pipeline`).
 *
 *   tsx pipeline/run.ts [--data-dir out-data] [--gate] [--force]
 *
 * --gate  exit early (no writes) when outside the election-night window, unless --force / FORCE=1.
 *
 * Every provider is fetched with Promise.allSettled; a failing provider never
 * aborts the run. Each output file is validated before it is written, and the
 * previous file is retained when the new one is missing or invalid.
 */
import fs from "node:fs";
import path from "node:path";
import { ELECTION_NIGHT_WINDOW, MARKET_SUBJECTS, WATCHED_RACES } from "@/lib/registry";
import {
  BaselinesSchema,
  HistorySnapshotSchema,
  MarketsSnapshotSchema,
  ResultsSnapshotSchema,
  StatusSnapshotSchema,
  type ContractQuote,
  type EarlyVoteStats,
  type MarketsSnapshot,
  type RaceResult,
  type ResultsSnapshot,
  type SourceStatus,
  type StatusSnapshot,
} from "@/lib/schema";
import { THRESHOLDS, buildSubjectSnapshot } from "@/lib/consensus";
import { fetchPolymarket } from "./adapters/polymarket";
import { fetchKalshi } from "./adapters/kalshi";
import { fetchVirginia } from "./adapters/va-enr";
import { fetchTexas } from "./adapters/tx-civix";
import { appendHistory } from "./history";
import { readPrevious, writeValidated } from "./write";

const PIPELINE_VERSION = "1.0.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

export function inElectionWindow(now: Date): boolean {
  const start = Date.parse(process.env.WINDOW_START ?? ELECTION_NIGHT_WINDOW.start);
  const end = Date.parse(process.env.WINDOW_END ?? ELECTION_NIGHT_WINDOW.end);
  return now.getTime() >= start && now.getTime() < end;
}

async function main() {
  const dataDir = path.resolve(arg("--data-dir") ?? "out-data");
  const force = flag("--force") || process.env.FORCE === "1";
  const now = new Date();
  const inWindow = inElectionWindow(now);
  if (flag("--gate") && !inWindow && !force) {
    console.log(`outside election-night window (${ELECTION_NIGHT_WINDOW.start} → ${ELECTION_NIGHT_WINDOW.end}); skipping.`);
    process.exit(0);
  }
  const windowMode: StatusSnapshot["windowMode"] = force && !inWindow ? "manual" : inWindow ? "election-night" : "normal";
  fs.mkdirSync(path.join(dataDir, "latest"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "history"), { recursive: true });

  const prevMarkets = readPrevious(dataDir, "latest/markets.json", MarketsSnapshotSchema);
  const prevResults = readPrevious(dataDir, "latest/results.json", ResultsSnapshotSchema);
  const prevStatus = readPrevious(dataDir, "latest/status.json", StatusSnapshotSchema);
  const prevHistory = readPrevious(dataDir, "history/markets.json", HistorySnapshotSchema);
  const baselines = readPrevious(path.resolve("data/historical/va"), "baselines.json", BaselinesSchema);

  const registered: Record<string, { total: number; source: string }> = {};
  for (const [race, r] of Object.entries(baselines?.registration2026 ?? {})) registered[race] = { total: r.total, source: `VA Dept. of Elections registrant count, ${r.asOf}` };

  const prevAbsenteeBlob = prevStatus?.sources["va:absentee-csv"]?.url?.split("/").pop() ?? null;
  const prevEarlyVote: Record<string, EarlyVoteStats | null> = {};
  for (const r of prevResults?.races ?? []) prevEarlyVote[r.id] = r.earlyVote;

  const [poly, kalshi, va, tx] = await Promise.allSettled([
    fetchPolymarket(MARKET_SUBJECTS),
    fetchKalshi(MARKET_SUBJECTS),
    fetchVirginia(WATCHED_RACES, registered, { absenteeBlob: prevAbsenteeBlob ? decodeURIComponent(prevAbsenteeBlob) : null, earlyVote: prevEarlyVote }),
    fetchTexas(WATCHED_RACES.find((r) => r.id === "tx-sen")!, prevEarlyVote["tx-sen"] ?? null),
  ]);

  const sources: Record<string, SourceStatus> = {};
  const notes: string[] = [];
  const retained: string[] = [];
  const settledSources = (r: PromiseSettledResult<{ sources: Record<string, SourceStatus> }>, name: string) => {
    if (r.status === "fulfilled") Object.assign(sources, r.value.sources);
    else {
      notes.push(`${name} adapter threw: ${String(r.reason).slice(0, 300)}`);
      sources[`${name}:adapter`] = { ok: false, url: "", httpStatus: null, durationMs: 0, error: String(r.reason).slice(0, 300), fetchedAt: now.toISOString(), lastSuccessAt: null };
    }
  };
  settledSources(poly, "polymarket");
  settledSources(kalshi, "kalshi");
  settledSources(va, "va");
  settledSources(tx, "tx");
  // Carry forward lastSuccessAt for sources that failed this run.
  for (const [k, s] of Object.entries(sources)) if (!s.ok) s.lastSuccessAt = prevStatus?.sources[k]?.lastSuccessAt ?? null;

  /* ---------- markets ---------- */
  const fresh: ContractQuote[] = [
    ...(poly.status === "fulfilled" ? poly.value.quotes : []),
    ...(kalshi.status === "fulfilled" ? kalshi.value.quotes : []),
  ];
  const prevQuotes = new Map<string, ContractQuote>((prevMarkets?.subjects ?? []).flatMap((s) => s.contracts.map((c) => [`${c.venue}:${c.id}`, c])));
  const staleMs = windowMode === "election-night" ? THRESHOLDS.staleMsElectionNight : THRESHOLDS.staleMsNormal;
  const subjects = MARKET_SUBJECTS.map((s) => {
    const quotes = s.contracts.map((c) => {
      const key = c.venue === "kalshi" ? `kalshi:${c.ticker}` : `polymarket:${c.marketId}`;
      const got = fresh.find((q) => (q.venue === "kalshi" ? `kalshi:${q.id}` : `polymarket:${q.id}`) === key || (c.venue === "polymarket" && q.venue === "polymarket" && q.tokenId === c.yesTokenId));
      if (got && got.status === "ok" && got.mid != null) return got;
      const prev = prevQuotes.get(key) ?? (c.venue === "polymarket" ? [...prevQuotes.values()].find((q) => q.tokenId === c.yesTokenId) : undefined);
      if (prev && prev.status === "ok") {
        retained.push(`${key}`);
        // Keep the old fetchedAt so the UI can show how old the retained quote is; mark it.
        return { ...prev, status: "error" as const, error: got?.error ?? "fetch failed; previous quote retained", flags: [...new Set([...prev.flags, "RETAINED_PREVIOUS" as const, "FETCH_FAILED" as const])], lastTradeAt: prev.lastTradeAt ?? prev.fetchedAt };
      }
      return (
        got ?? {
          venue: c.venue,
          party: c.party,
          id: c.venue === "kalshi" ? c.ticker : c.marketId,
          tokenId: c.venue === "polymarket" ? c.yesTokenId : undefined,
          label: `${s.label} · ${c.party}`,
          bid: null, ask: null, mid: null, last: null, spread: null, liquidity: null, volume: null, lastTradeAt: null,
          fetchedAt: now.toISOString(),
          sourceUrl: "",
          status: "error" as const,
          error: "adapter failed",
          flags: [],
        }
      );
    });
    return buildSubjectSnapshot({ id: s.id, kind: s.kind, label: s.label }, quotes, { now: now.getTime(), staleMs });
  });
  const markets: MarketsSnapshot = { schemaVersion: 1, generatedAt: now.toISOString(), subjects };
  const mw = writeValidated(dataDir, "latest/markets.json", markets, MarketsSnapshotSchema);
  if (!mw.ok) {
    notes.push(`markets.json failed validation: ${mw.error}`);
    retained.push("latest/markets.json");
  }

  /* ---------- results ---------- */
  const prevRaces = new Map((prevResults?.races ?? []).map((r) => [r.id, r]));
  const races: RaceResult[] = WATCHED_RACES.map((w) => {
    let got: RaceResult | null = null;
    if (w.state === "VA" && va.status === "fulfilled") got = va.value.races[w.id] ?? null;
    if (w.state === "TX" && tx.status === "fulfilled") got = tx.value.race;
    if (got && got.status === "ok") return got;
    const prev = prevRaces.get(w.id);
    if (prev) {
      retained.push(`results:${w.id}`);
      return { ...prev, status: "retained" as const, error: got?.error ?? "fetch failed; previous result retained" };
    }
    return emptyRace(w, now.toISOString(), got?.error ?? "no data yet");
  });
  const results: ResultsSnapshot = { schemaVersion: 1, generatedAt: now.toISOString(), races };
  const rw = writeValidated(dataDir, "latest/results.json", results, ResultsSnapshotSchema);
  if (!rw.ok) {
    notes.push(`results.json failed validation: ${rw.error}`);
    retained.push("latest/results.json");
  }

  /* ---------- history ---------- */
  const history = appendHistory(prevHistory, mw.ok ? subjects : (prevMarkets?.subjects ?? []), now.getTime());
  const hw = writeValidated(dataDir, "history/markets.json", history, HistorySnapshotSchema);
  if (!hw.ok) notes.push(`history failed validation: ${hw.error}`);

  /* ---------- status ---------- */
  const status: StatusSnapshot = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    pipelineVersion: PIPELINE_VERSION,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    windowMode,
    sources,
    retained,
    notes,
  };
  const sw = writeValidated(dataDir, "latest/status.json", status, StatusSnapshotSchema);
  if (!sw.ok) throw new Error(`status.json failed validation: ${sw.error}`);

  const okCount = Object.values(sources).filter((s) => s.ok).length;
  console.log(`[${now.toISOString()}] mode=${windowMode} sources ok=${okCount}/${Object.keys(sources).length} retained=${retained.length}`);
  for (const [k, s] of Object.entries(sources)) if (!s.ok) console.log(`  ! ${k}: ${s.error} (${s.url})`);
  for (const n of notes) console.log(`  note: ${n}`);
  for (const s of subjects) {
    const v = s.venues.map((x) => `${x.venue}=${x.pDem ?? "–"}`).join(" ");
    console.log(`  ${s.id.padEnd(7)} pDem consensus=${s.consensus.pDem ?? "–"} ${v} flags=[${s.flags.join(",")}]`);
  }
  for (const r of races) console.log(`  ${r.id.padEnd(7)} ${r.status} votes=${r.totalVotes} reporting=${r.reporting.unitsReporting}/${r.reporting.unitsTotal} marginDR=${r.marginDR ?? "–"}`);
}

function emptyRace(w: (typeof WATCHED_RACES)[number], fetchedAt: string, error: string): RaceResult {
  return {
    id: w.id,
    label: w.label,
    state: w.state,
    office: w.office,
    status: "error",
    error,
    source: { name: w.state === "VA" ? "Virginia Department of Elections (ENR)" : "Texas Secretary of State", url: w.sourceUrl, asOf: null, fetchedAt, isOfficial: false },
    candidates: w.candidates.map((c) => ({ name: c.name, party: c.party, votes: 0, share: null })),
    totalVotes: 0,
    marginDR: null,
    reporting: { unitKind: w.state === "VA" ? "locality" : "county", unitsReporting: 0, unitsTotal: 0, fully: null, partially: null, notReported: null, precinctsReporting: null, precinctsTotal: null, complete: false },
    countGroups: null,
    turnout: { ballotsCast: null, registered: null, rate: null, registeredSource: null },
    localities: [],
    earlyVote: null,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
