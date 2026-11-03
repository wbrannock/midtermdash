import type { ForecastPrior, ForecastUnit, LocalityResult, RaceForecast, RaceResult, UnitBaselineContest } from "./schema";

/**
 * Live election-night forecast for a single race.
 *
 * A pre-election prior on the final D−R margin (taken from the market
 * consensus and frozen at poll close) is combined with a returns-only
 * projection built from counted votes, per-unit baselines and a learned
 * uniform swing. The two are combined as independent normal estimates, so the
 * prior's share of the answer is exactly its share of the posterior precision:
 * 100% before any votes, falling toward zero as expected vote is counted.
 *
 * Everything here is pure and deterministic given the inputs. Every constant
 * is a named judgment call echoed in the methodology panel.
 */

export const MODEL_VERSION = "needle-1.0.0";

export const FORECAST = {
  /** Pre-election sd (points) of the final margin around the market-implied mean. Roughly the RMSE of final-week expectations for House and Senate races. */
  priorSigmaPts: { house: 7, senate: 5 },
  /** Sd of the prior when no market price is available and the baseline margin is used instead. */
  fallbackSigmaPts: 12,
  /** Sd (points) of a unit's final margin around baseline + uniform swing, for a unit of referenceVotes votes. */
  tauPts: 5,
  /** Units with fewer expected votes than this get a larger tau (∝ 1/√votes), capped at tauMaxMultiple × tau. */
  referenceVotes: 10_000,
  tauMaxMultiple: 2.5,
  /** Tau multiplier for a unit with no baseline row (its baseline is the race-wide baseline margin). */
  noBaselineTauMultiple: 4,
  /** Composition bias (points) of early returns relative to final results, as error on the swing estimate, scaled by (1 − effective fraction). */
  swingBiasPts: 6,
  /** Systematic skew (points) of the vote still outstanding in units that have begun reporting, relative to those units' final margins (e.g. election-day precincts after early votes). */
  remainderSkewPts: 6,
  /** Relative sd of the expected-vote estimate per unit (expected vote is uncertain until a unit completes). */
  kappa: 0.2,
  /** Sd floor (points): late-arriving mail, provisional ballots and canvass corrections. */
  floorPts: { unofficial: 0.35, official: 0.05 },
  /** Pseudo-votes (as a share of expected total) that anchor the turnout factor at 1 before units complete. */
  turnoutPriorShare: 0.15,
  /** Incomplete units are assumed to have at least this share of their vote still outstanding. */
  minOutstandingShare: 0.05,
} as const;

/* ---------------- normal distribution helpers ---------------- */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function phi(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam's rational approximation, |rel error| < 1.2e-9). */
export function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const Z80 = 1.2815515655446004;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Matching key for unit names across feeds ("DeWitt County" ≡ "De Witt County"). */
export function unitKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z]/g, "");
}

/* ---------------- prior ---------------- */

export interface PriorInput {
  /** Market consensus P(D), or null if unavailable. */
  pDem: number | null;
  asOf: string | null;
  locked: boolean;
  office: "house" | "senate";
  /** Baseline race margin (points) used when no market price exists. */
  baselineMargin: number | null;
  note?: string;
}

/** Translate a market probability into a normal prior on the final margin. */
export function buildPrior(input: PriorInput): ForecastPrior {
  const sigma = FORECAST.priorSigmaPts[input.office];
  if (input.pDem != null && input.pDem > 0 && input.pDem < 1) {
    return { pDem: r4(input.pDem), marginMean: r2(sigma * probit(input.pDem)), sigma, source: "market-consensus", asOf: input.asOf, locked: input.locked, note: input.note };
  }
  return {
    pDem: null,
    marginMean: r2(input.baselineMargin ?? 0),
    sigma: FORECAST.fallbackSigmaPts,
    source: "baseline-fallback",
    asOf: input.asOf,
    locked: input.locked,
    note: input.note ?? "No usable market price; prior centred on the baseline margin with a wide sd.",
  };
}

/* ---------------- baseline adapter ---------------- */

export interface UnitBase {
  name: string;
  dem: number;
  rep: number;
  total: number;
}

export interface RaceBaseline {
  year: number;
  label: string;
  marginDR: number | null;
  totalVotes: number;
  /** Registered voters at the baseline election, for scaling expected turnout. */
  registered: number | null;
  units: UnitBase[];
}

/** Turnout scaling: expected total = baseline total × (registered now ÷ registered then) × midtermAdjustment. */
export interface TurnoutContext {
  registeredNow: number | null;
  /** Ratio of a comparable earlier midterm's total vote to the baseline (presidential-year) total; 1 if unknown. */
  midtermAdjustment: number;
}

export function baselineFromUnits(c: UnitBaselineContest): RaceBaseline {
  return { year: c.year, label: c.label, marginDR: c.marginDR, totalVotes: c.totalVotes, registered: c.registered, units: c.units.map((u) => ({ name: u.name, dem: u.dem, rep: u.rep, total: u.total })) };
}

/* ---------------- the model ---------------- */

function unitMargin(l: { candidates: { party: string; votes: number }[]; total: number }): number | null {
  if (l.total <= 0) return null;
  const d = l.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0);
  const r = l.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0);
  return ((d - r) / l.total) * 100;
}

export interface ForecastInput {
  result: RaceResult;
  baseline: RaceBaseline;
  prior: ForecastPrior;
  turnout: TurnoutContext;
}

export function forecastRace({ result, baseline, prior, turnout }: ForecastInput): RaceForecast {
  const notes: string[] = [];
  const baseByKey = new Map(baseline.units.map((u) => [unitKey(u.name), u]));
  const baseMargin = baseline.marginDR ?? 0;

  /* Expected total vote: baseline total scaled by registration growth and the midterm adjustment. */
  const regScale = turnout.registeredNow && baseline.registered ? turnout.registeredNow / baseline.registered : 1;
  const expectedTotal0 = baseline.totalVotes * regScale * turnout.midtermAdjustment;
  if (!turnout.registeredNow || !baseline.registered) notes.push("Registration growth unknown; expected vote assumes the baseline electorate size.");

  /* Pre-election expected vote per live unit, allocated by the unit's share of the baseline vote. */
  type Row = { live: LocalityResult; base: UnitBase | null; e0: number; v: number; o: number | null; b: number | null };
  const rows: Row[] = result.localities.map((live) => {
    const base = baseByKey.get(unitKey(live.name)) ?? null;
    return { live, base, e0: 0, v: live.total, o: unitMargin(live), b: base && base.total > 0 ? ((base.dem - base.rep) / base.total) * 100 : null };
  });
  const matched = rows.filter((r) => r.base).length;
  const baseTotalMatched = rows.reduce((a, r) => a + (r.base?.total ?? 0), 0);
  const unmatched = rows.filter((r) => !r.base);
  if (unmatched.length) notes.push(`${unmatched.length} unit(s) without a baseline row use the race-wide baseline margin: ${unmatched.slice(0, 4).map((r) => r.live.name).join(", ")}${unmatched.length > 4 ? "…" : ""}.`);
  const unmatchedShare = unmatched.length ? unmatched.length / Math.max(1, rows.length) : 0;
  for (const r of rows) {
    const share = r.base && baseTotalMatched > 0 ? (r.base.total / baseTotalMatched) * (1 - unmatchedShare) : unmatchedShare / Math.max(1, unmatched.length);
    r.e0 = expectedTotal0 * share;
  }

  /* Turnout factor learned from fully reported units, anchored at 1 by pseudo-votes. */
  const complete = rows.filter((r) => r.live.complete && r.v > 0);
  const k = FORECAST.turnoutPriorShare * expectedTotal0;
  const theta = (complete.reduce((a, r) => a + r.v, 0) + k) / (complete.reduce((a, r) => a + r.e0, 0) + k);

  /* Expected and outstanding vote per unit. */
  const units = rows.map((r) => {
    let e = r.live.complete ? r.v : r.e0 * theta;
    if (!r.live.complete && r.v > 0) e = Math.max(e, r.v / (1 - FORECAST.minOutstandingShare));
    const f = r.live.complete ? 1 : e > 0 ? Math.min(1, r.v / e) : 0;
    const tauMult = Math.min(FORECAST.tauMaxMultiple, Math.max(1, Math.sqrt(FORECAST.referenceVotes / Math.max(1, e)))) * (r.b == null ? FORECAST.noBaselineTauMultiple : 1);
    return { ...r, e, u: r.live.complete ? 0 : Math.max(0, e - r.v), f, tau: FORECAST.tauPts * tauMult };
  });
  const T = units.reduce((a, r) => a + r.e, 0);
  const counted = units.reduce((a, r) => a + r.v, 0);
  const reportedFraction = T > 0 ? Math.min(1, counted / T) : 0;

  /*
   * Uniform swing from reported units, precision-weighted. A complete unit's
   * (observed − baseline) has variance tau_i²; a partial unit's observed margin
   * is a noisy, composition-biased read on its final margin, so its precision
   * is scaled by the square of its reported fraction (10% in → 1% of the
   * weight). The effective fraction uses the same discount, so the
   * composition-bias term stays large until units actually complete.
   */
  let wSum = 0;
  let wSwing = 0;
  let effSum = 0;
  for (const r of units) {
    if (r.v <= 0 || r.o == null) continue;
    const bi = r.b ?? baseMargin;
    const g = r.live.complete ? 1 : r.f * r.f;
    const w = g / (r.tau * r.tau);
    wSum += w;
    wSwing += w * (r.o - bi);
    effSum += (r.e / Math.max(1, T)) * g;
  }
  const effectiveFraction = T > 0 ? Math.min(1, effSum) : 0;
  let data: RaceForecast["data"] = null;
  let projectedUnits: ForecastUnit[];
  const floor = result.source.isOfficial ? FORECAST.floorPts.official : FORECAST.floorPts.unofficial;

  if (wSum > 0 && counted > 0 && T > 0) {
    const swing = wSwing / wSum;
    const swingVar = 1 / wSum + (FORECAST.swingBiasPts * (1 - effectiveFraction)) ** 2;
    const U = units.reduce((a, r) => a + r.u, 0);
    let num = 0;
    for (const r of units) num += r.v * (r.o ?? 0) + r.u * ((r.b ?? baseMargin) + swing);
    const mean = num / T;
    let unitVar = 0;
    let evVar = 0;
    let partialOutstanding = 0;
    for (const r of units) {
      const share = r.u / T;
      const mi = (r.b ?? baseMargin) + swing;
      unitVar += share * share * r.tau * r.tau;
      evVar += FORECAST.kappa ** 2 * share * share * (mi - mean) ** 2;
      if (r.v > 0 && !r.live.complete) partialOutstanding += r.u;
    }
    // The remainder of a half-reported unit is not a random sample of it (method mix); treat its skew as one shared error.
    const skewVar = (FORECAST.remainderSkewPts * (partialOutstanding / T)) ** 2;
    const variance = (U / T) ** 2 * swingVar + unitVar + evVar + skewVar + floor * floor;
    const sd = Math.sqrt(variance);
    data = { pDem: r4(phi(mean / sd)), marginMean: r2(mean), marginSd: r2(sd), swing: r2(swing), swingSd: r2(Math.sqrt(swingVar)) };
    projectedUnits = units.map((r) => ({
      name: r.live.name,
      expected: Math.round(r.e),
      counted: r.v,
      fraction: r4(r.f),
      complete: r.live.complete,
      baselineMargin: r.b == null ? null : r2(r.b),
      observedMargin: r.o == null ? null : r2(r.o),
      projectedMargin: r2(r.e > 0 ? (r.v * (r.o ?? 0) + r.u * ((r.b ?? baseMargin) + swing)) / r.e : (r.b ?? baseMargin) + swing),
    }));
  } else {
    const swing0 = prior.marginMean - baseMargin;
    projectedUnits = units.map((r) => ({ name: r.live.name, expected: Math.round(r.e), counted: r.v, fraction: r4(r.f), complete: r.live.complete, baselineMargin: r.b == null ? null : r2(r.b), observedMargin: r.o == null ? null : r2(r.o), projectedMargin: r2((r.b ?? baseMargin) + swing0) }));
  }

  /* Combine prior and returns as independent normal estimates of the final margin. */
  const p0 = 1 / (prior.sigma * prior.sigma);
  const p1 = data ? 1 / (data.marginSd * data.marginSd) : 0;
  const precision = p0 + p1;
  const mean = (prior.marginMean * p0 + (data?.marginMean ?? 0) * p1) / precision;
  const sd = Math.sqrt(1 / precision);
  const priorWeight = p0 / precision;
  const pDem = prior.pDem != null && !data ? prior.pDem : phi(mean / sd);

  const phase: RaceForecast["phase"] = result.source.isOfficial ? "official" : result.reporting.complete ? "complete" : counted > 0 ? "counting" : "pre-results";
  if (phase === "pre-results") notes.push("No votes counted yet; the forecast equals the market prior.");

  return {
    id: result.id,
    label: result.label,
    state: result.state,
    phase,
    pDem: r4(Math.min(1, Math.max(0, pDem))),
    marginMean: r2(mean),
    marginSd: r2(sd),
    interval80: { lo: r2(mean - Z80 * sd), hi: r2(mean + Z80 * sd) },
    prior,
    priorWeight: r4(priorWeight),
    data,
    baseline: { year: baseline.year, label: baseline.label, marginDR: baseline.marginDR, unitsMatched: matched, unitsTotal: rows.length },
    expectedVotes: Math.round(T),
    countedVotes: counted,
    reportedFraction: r4(reportedFraction),
    effectiveFraction: r4(effectiveFraction),
    turnoutFactor: r4(theta),
    unitsComplete: complete.length,
    unitsTotal: rows.length,
    units: projectedUnits,
    notes,
  };
}
