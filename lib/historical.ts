import type { BaselineLocality, CandidateResult, ContestBaseline, LocalityResult, Party } from "./schema";

/** Share of each candidate (0–1) given total; null when total is 0. */
export function shares<T extends { votes: number }>(cands: T[], total?: number): (T & { share: number | null })[] {
  const t = total ?? cands.reduce((a, c) => a + c.votes, 0);
  return cands.map((c) => ({ ...c, share: t > 0 ? c.votes / t : null }));
}

/** D share − R share in percentage points; null if either side is missing or total is 0. */
export function marginDR(cands: { party: Party; votes: number }[], total?: number): number | null {
  const t = total ?? cands.reduce((a, c) => a + c.votes, 0);
  if (t <= 0) return null;
  const d = cands.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0);
  const r = cands.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0);
  return Math.round(((d - r) / t) * 10000) / 100;
}

export function partyVotes(cands: { party: Party; votes: number }[], party: Party): number {
  return cands.filter((c) => c.party === party).reduce((a, c) => a + c.votes, 0);
}

export interface Aggregate {
  localities: string[];
  dem: number;
  rep: number;
  other: number;
  total: number;
  marginDR: number | null;
  registered: number | null;
  ballotsCast: number | null;
}

/** Sum a set of localities (by name) from a baseline or live result. */
export function aggregateLocalities(
  rows: (BaselineLocality | LocalityResult)[],
  names: string[] | null,
): Aggregate {
  const wanted = names ? new Set(names.map(normalizeLocality)) : null;
  const picked = rows.filter((r) => !wanted || wanted.has(normalizeLocality(r.name)));
  const dem = picked.reduce((a, r) => a + partyVotes(r.candidates, "D"), 0);
  const rep = picked.reduce((a, r) => a + partyVotes(r.candidates, "R"), 0);
  const total = picked.reduce((a, r) => a + r.total, 0);
  const regs = picked.map((r) => r.registered).filter((x): x is number => x != null);
  const ballots = picked
    .map((r) => ("ballotsCast" in r ? r.ballotsCast : null))
    .filter((x): x is number => x != null);
  return {
    localities: picked.map((r) => r.name),
    dem,
    rep,
    other: total - dem - rep,
    total,
    marginDR: total > 0 ? Math.round(((dem - rep) / total) * 10000) / 100 : null,
    registered: regs.length === picked.length && picked.length > 0 ? regs.reduce((a, b) => a + b, 0) : null,
    ballotsCast: ballots.length === picked.length && picked.length > 0 ? ballots.reduce((a, b) => a + b, 0) : null,
  };
}

/** Canonical locality key: upper-case, collapse whitespace, drop punctuation. */
export function normalizeLocality(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Comparability = "same-map" | "comparable" | "moved" | "split" | "not-reported";

/**
 * Classify a 2026 locality against a baseline contest.
 * - same-map: baseline uses the 2021 map (2024) → every locality compares, unless split.
 * - comparable: baseline uses the 2016 map and the locality is in the comparable set.
 * - moved: locality was not in the district under the baseline map.
 * - split: locality is split in either map.
 */
export function classifyLocality(
  name: string,
  baseline: ContestBaseline,
  comparable: Set<string> | null,
  splitNow: Set<string>,
): Comparability {
  const key = normalizeLocality(name);
  const row = baseline.localities.find((l) => normalizeLocality(l.name) === key);
  if (splitNow.has(key) || row?.split) return "split";
  if (baseline.map === "2021-sms") return row ? "same-map" : "moved";
  if (!row) return "moved";
  return comparable && comparable.has(key) ? "comparable" : "split";
}

/**
 * The only place a "swing" number is produced. Requires the live side to be
 * complete; otherwise returns null so the UI must show a partial-returns label.
 */
export function swingPoints(liveMargin: number | null, baseMargin: number | null, liveComplete: boolean): number | null {
  if (!liveComplete || liveMargin == null || baseMargin == null) return null;
  return Math.round((liveMargin - baseMargin) * 100) / 100;
}

export function candidateShares(cands: CandidateResult[]): CandidateResult[] {
  return shares(cands);
}
