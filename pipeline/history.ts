import type { HistorySnapshot, MarketSubjectSnapshot } from "@/lib/schema";

export const HISTORY_LIMITS = {
  /** Keep every point for this long. */
  fullResolutionMs: 72 * 60 * 60 * 1000,
  /** Beyond fullResolution, keep one point per bucket. */
  thinBucketMs: 60 * 60 * 1000,
  /** Drop everything older than this. */
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  /** Hard cap per series. */
  maxPoints: 5000,
} as const;

/** Append the current venue/consensus values for every subject and bound the series. Pure. */
export function appendHistory(prev: HistorySnapshot | null, subjects: MarketSubjectSnapshot[], nowMs: number): HistorySnapshot {
  const series: HistorySnapshot["series"] = { ...(prev?.series ?? {}) };
  const t = Math.floor(nowMs / 1000);
  for (const s of subjects) {
    const poly = s.venues.find((v) => v.venue === "polymarket")?.pDem ?? null;
    const kalshi = s.venues.find((v) => v.venue === "kalshi")?.pDem ?? null;
    const c = s.consensus.pDem;
    const pts = [...(series[s.id] ?? [])].filter((p) => p[0] < t);
    if (poly != null || kalshi != null || c != null) pts.push([t, poly, kalshi, c]);
    series[s.id] = bound(pts, nowMs);
  }
  return { schemaVersion: 1, generatedAt: new Date(nowMs).toISOString(), columns: ["t", "polymarket", "kalshi", "consensus"], series };
}

export function bound(points: HistorySnapshot["series"][string], nowMs: number): HistorySnapshot["series"][string] {
  const { fullResolutionMs, thinBucketMs, maxAgeMs, maxPoints } = HISTORY_LIMITS;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const out: typeof sorted = [];
  let lastBucket = -1;
  for (const p of sorted) {
    const ageMs = nowMs - p[0] * 1000;
    if (ageMs > maxAgeMs) continue;
    if (ageMs > fullResolutionMs) {
      const bucket = Math.floor((p[0] * 1000) / thinBucketMs);
      if (bucket === lastBucket) continue;
      lastBucket = bucket;
    }
    out.push(p);
  }
  return out.length > maxPoints ? out.slice(out.length - maxPoints) : out;
}
