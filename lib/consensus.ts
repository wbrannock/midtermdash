import type {
  Consensus,
  ContractFlag,
  ContractQuote,
  MarketSubjectSnapshot,
  SubjectFlag,
  VenueEstimate,
} from "./schema";

/**
 * Pure functions for turning raw contract quotes into per-venue estimates and
 * a transparent market consensus. Every threshold is a named constant and is
 * echoed in the methodology panel.
 */

export const THRESHOLDS = {
  /** ask − bid above this flags the contract. */
  wideSpread: 0.05,
  /** A venue is excluded from consensus if its worst contract spread exceeds this. */
  maxUsableSpread: 0.1,
  /** USD liquidity / open interest below this flags the contract. */
  thinLiquidityUsd: 10_000,
  /** |Polymarket − Kalshi| at or above this flags disagreement. */
  disagreement: 0.03,
  /** |p(D contract) − (1 − p(R contract))| above this flags venue inconsistency. */
  internalInconsistency: 0.03,
  /** Last trade older than this (ms) flags STALE. Set by caller per window mode. */
  staleMsElectionNight: 6 * 60 * 60 * 1000,
  staleMsNormal: 48 * 60 * 60 * 1000,
} as const;

export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** Midpoint of bid/ask when both exist, otherwise null. */
export function midpoint(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null) return null;
  if (!(bid >= 0 && ask <= 1 && ask >= bid)) return null;
  return round4((bid + ask) / 2);
}

export interface FlagContext {
  now: number;
  staleMs: number;
}

/** Compute contract-level flags from the quote fields. Mutates nothing. */
export function contractFlags(q: ContractQuote, ctx: FlagContext): ContractFlag[] {
  const flags = new Set<ContractFlag>(q.flags);
  if (q.status !== "ok") flags.add("FETCH_FAILED");
  if (q.mid == null) {
    flags.add("NO_QUOTE");
    if ((q.bid == null) !== (q.ask == null)) flags.add("ONE_SIDED_BOOK");
  }
  if (q.spread != null && q.spread > THRESHOLDS.wideSpread) flags.add("WIDE_SPREAD");
  if (q.liquidity != null && q.liquidity < THRESHOLDS.thinLiquidityUsd) flags.add("THIN_LIQUIDITY");
  if (q.lastTradeAt) {
    const t = Date.parse(q.lastTradeAt);
    if (Number.isFinite(t) && ctx.now - t > ctx.staleMs) flags.add("STALE");
  }
  return [...flags].sort();
}

/**
 * Per-venue estimate of P(Democratic side wins) from the D and R contracts.
 * Uses the D contract mid and the complement of the R contract mid; the venue
 * value is their mean. If only one exists, it is used alone.
 */
export function venueEstimate(venue: ContractQuote["venue"], quotes: ContractQuote[]): VenueEstimate {
  const mine = quotes.filter((q) => q.venue === venue);
  const d = mine.find((q) => q.party === "D");
  const r = mine.find((q) => q.party === "R");
  const fromD = d?.mid ?? null;
  const fromR = r?.mid != null ? round4(1 - r.mid) : null;
  const flags = new Set<SubjectFlag>();
  const parts = [fromD, fromR].filter((x): x is number => x != null);
  let pDem: number | null = parts.length ? round4(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  if (fromD != null && fromR != null && Math.abs(fromD - fromR) > THRESHOLDS.internalInconsistency) {
    flags.add("INTERNAL_INCONSISTENCY");
  }
  const spreads = mine.map((q) => q.spread).filter((x): x is number => x != null);
  const maxSpread = spreads.length ? Math.max(...spreads) : null;
  const cflags = new Set(mine.flatMap((q) => q.flags));
  if (cflags.has("WIDE_SPREAD")) flags.add("WIDE_SPREAD");
  if (cflags.has("THIN_LIQUIDITY")) flags.add("THIN_LIQUIDITY");
  if (cflags.has("STALE")) flags.add("STALE");

  let usable = pDem != null;
  let reason: string | undefined;
  if (pDem == null) reason = "no two-sided quote";
  else if (mine.every((q) => q.flags.includes("STALE"))) {
    usable = false;
    reason = "all contracts stale";
  } else if (maxSpread != null && maxSpread > THRESHOLDS.maxUsableSpread) {
    usable = false;
    reason = `spread ${maxSpread.toFixed(2)} > ${THRESHOLDS.maxUsableSpread}`;
  } else if (mine.some((q) => q.flags.includes("RETAINED_PREVIOUS") && q.flags.includes("STALE"))) {
    usable = false;
    reason = "retained quote is stale";
  }
  if (!usable) pDem = pDem; // value still reported for display; just not used in consensus
  return {
    venue,
    pDem,
    fromDemContract: fromD,
    fromRepContract: fromR,
    maxSpread,
    usable,
    reason,
    flags: [...flags].sort(),
  };
}

/** Equal-weighted mean of usable venue values; records exactly which inputs were used. */
export function consensus(venues: VenueEstimate[]): Consensus {
  const usable = venues.filter((v) => v.usable && v.pDem != null) as (VenueEstimate & { pDem: number })[];
  const flags = new Set<SubjectFlag>();
  if (usable.length === 0) {
    flags.add("NO_CONSENSUS");
    return {
      pDem: null,
      method: "equal-weight-mean-of-usable-venue-midpoints",
      inputs: [],
      band: null,
      flags: [...flags],
    };
  }
  if (usable.length === 1) flags.add("SINGLE_SOURCE");
  const values = usable.map((v) => v.pDem);
  const mean = round4(values.reduce((a, b) => a + b, 0) / values.length);
  const halfSpread = Math.max(0, ...usable.map((v) => (v.maxSpread ?? 0) / 2));
  const lo = Math.max(0, round4(Math.min(...values) - halfSpread));
  const hi = Math.min(1, round4(Math.max(...values) + halfSpread));
  const all = venues.filter((v) => v.pDem != null).map((v) => v.pDem as number);
  if (all.length >= 2 && round4(Math.max(...all) - Math.min(...all)) >= THRESHOLDS.disagreement) {
    flags.add("DISAGREEMENT");
  }
  return {
    pDem: mean,
    method: "equal-weight-mean-of-usable-venue-midpoints",
    inputs: usable.map((v) => ({ venue: v.venue, pDem: v.pDem })),
    band: { lo, hi },
    flags: [...flags].sort(),
  };
}

export function buildSubjectSnapshot(
  meta: { id: string; kind: "chamber" | "race"; label: string },
  quotes: ContractQuote[],
  ctx: FlagContext,
): MarketSubjectSnapshot {
  const flagged = quotes.map((q) => ({ ...q, flags: contractFlags(q, ctx) }));
  const venues = (["polymarket", "kalshi"] as const)
    .filter((v) => flagged.some((q) => q.venue === v))
    .map((v) => venueEstimate(v, flagged));
  const c = consensus(venues);
  const subjectFlags = new Set<SubjectFlag>([...c.flags, ...venues.flatMap((v) => v.flags)]);
  return {
    ...meta,
    contracts: flagged,
    venues,
    consensus: c,
    flags: [...subjectFlags].sort(),
  };
}
