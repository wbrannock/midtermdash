import { POLL_CLOSE_UTC, WATCHED_RACES, type RaceId } from "@/lib/registry";
import type { Baselines, ForecastHistory, ForecastPrior, ForecastSnapshot, HistorySnapshot, MarketsSnapshot, RaceForecast, RaceResult, UnitBaselines } from "@/lib/schema";
import { MODEL_VERSION, baselineFromUnits, buildPrior, forecastRace, type RaceBaseline, type TurnoutContext } from "@/lib/forecast";
import { bound } from "./history";

/**
 * Pipeline glue for the live forecast: picks each race's baseline, freezes the
 * market prior at poll close, runs the model and maintains a bounded history.
 */

const OFFICE: Record<RaceId, "house" | "senate"> = { "va-05": "house", "va-09": "house", "tx-sen": "senate" };

/** Baseline (most recent same-lines contest) and turnout scaling for a race. */
export function raceBaseline(raceId: RaceId, va: Baselines | null, tx: UnitBaselines | null): { baseline: RaceBaseline; midtermAdjustment: number } | null {
  if (raceId === "tx-sen") {
    const c24 = tx?.contests.find((c) => c.race === "tx-sen" && c.year === 2024);
    const c18 = tx?.contests.find((c) => c.race === "tx-sen" && c.year === 2018);
    if (!c24) return null;
    return { baseline: baselineFromUnits(c24), midtermAdjustment: c18 && c24.totalVotes > 0 ? c18.totalVotes / c24.totalVotes : 1 };
  }
  const c24 = va?.contests.find((c) => c.race === raceId && c.year === 2024);
  const c18 = va?.contests.find((c) => c.race === raceId && c.year === 2018);
  if (!c24) return null;
  return {
    baseline: {
      year: 2024,
      label: "2024 U.S. House (same district lines)",
      marginDR: c24.marginDR,
      totalVotes: c24.totalVotes,
      registered: c24.turnout.registered == null ? null : Math.round(c24.turnout.registered),
      units: c24.localities.map((l) => ({ name: l.name, dem: l.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0), rep: l.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0), total: l.total })),
    },
    // 2018 was drawn on different lines, but the ratio of its total vote to 2024's is still the best local midterm/presidential turnout ratio available.
    midtermAdjustment: c18 && c24.totalVotes > 0 ? c18.totalVotes / c24.totalVotes : 1,
  };
}

export interface PriorContext {
  nowMs: number;
  markets: MarketsSnapshot | null;
  /** Market history including snapshots before poll close. */
  history: HistorySnapshot | null;
  previous: RaceForecast | null;
  baselineMargin: number | null;
}

/**
 * The prior tracks the market consensus while polls are open. At poll close it
 * is frozen at the last snapshot taken before that instant and never moves
 * again, so prices that react to returns are not fed back in.
 */
export function selectPrior(raceId: RaceId, ctx: PriorContext): ForecastPrior {
  if (ctx.previous?.prior.locked) return ctx.previous.prior;
  const office = OFFICE[raceId];
  const closeMs = Date.parse(POLL_CLOSE_UTC[raceId]);
  const current = ctx.markets?.subjects.find((s) => s.id === raceId)?.consensus.pDem ?? null;
  const currentAt = ctx.markets?.generatedAt ?? null;
  if (ctx.nowMs < closeMs) return buildPrior({ pDem: current, asOf: currentAt, locked: false, office, baselineMargin: ctx.baselineMargin });

  const series = ctx.history?.series[raceId] ?? [];
  const before = series.filter((p) => p[0] * 1000 <= closeMs && p[3] != null).sort((a, b) => a[0] - b[0]).at(-1);
  if (before) return buildPrior({ pDem: before[3], asOf: new Date(before[0] * 1000).toISOString(), locked: true, office, baselineMargin: ctx.baselineMargin, note: "Market consensus at the last snapshot before polls closed." });
  if (ctx.previous?.prior.pDem != null && ctx.previous.prior.asOf && Date.parse(ctx.previous.prior.asOf) <= closeMs) {
    return { ...ctx.previous.prior, locked: true, note: "Market consensus at the last snapshot before polls closed." };
  }
  return buildPrior({ pDem: current, asOf: currentAt, locked: true, office, baselineMargin: ctx.baselineMargin, note: current == null ? undefined : "No pre-close snapshot was available; locked to the first price after polls closed, which may already reflect returns." });
}

export function buildForecastSnapshot(args: { nowMs: number; results: RaceResult[]; markets: MarketsSnapshot | null; history: HistorySnapshot | null; previous: ForecastSnapshot | null; va: Baselines | null; tx: UnitBaselines | null }): { snapshot: ForecastSnapshot; skipped: string[] } {
  const skipped: string[] = [];
  const races: RaceForecast[] = [];
  for (const w of WATCHED_RACES) {
    const result = args.results.find((r) => r.id === w.id);
    const bl = raceBaseline(w.id, args.va, args.tx);
    if (!result || !bl) {
      skipped.push(`${w.id}: ${!result ? "no result" : "no baseline"}`);
      continue;
    }
    const previous = args.previous?.races.find((r) => r.id === w.id) ?? null;
    const prior = selectPrior(w.id, { nowMs: args.nowMs, markets: args.markets, history: args.history, previous, baselineMargin: bl.baseline.marginDR });
    const turnout: TurnoutContext = { registeredNow: result.turnout.registered, midtermAdjustment: bl.midtermAdjustment };
    races.push(forecastRace({ result, baseline: bl.baseline, prior, turnout }));
  }
  return { snapshot: { schemaVersion: 1, generatedAt: new Date(args.nowMs).toISOString(), model: MODEL_VERSION, races }, skipped };
}

export function appendForecastHistory(prev: ForecastHistory | null, snapshot: ForecastSnapshot, nowMs: number): ForecastHistory {
  const series: ForecastHistory["series"] = { ...(prev?.series ?? {}) };
  const t = Math.floor(nowMs / 1000);
  for (const r of snapshot.races) {
    const pts = [...(series[r.id] ?? [])].filter((p) => p[0] < t);
    pts.push([t, r.pDem, r.interval80.lo, r.interval80.hi, r.priorWeight, r.reportedFraction]);
    series[r.id] = bound(pts, nowMs);
  }
  return { schemaVersion: 1, generatedAt: new Date(nowMs).toISOString(), columns: ["t", "pDem", "lo80", "hi80", "priorWeight", "reportedFraction"], series };
}
