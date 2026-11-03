import { describe, expect, it } from "vitest";
import { HISTORY_LIMITS, appendHistory, bound } from "@/pipeline/history";
import { HistorySnapshotSchema, type MarketSubjectSnapshot } from "@/lib/schema";

const now = Date.parse("2026-11-03T20:00:00Z");

describe("bound", () => {
  it("drops points older than maxAge, thins to hourly beyond 72h, keeps full resolution inside 72h", () => {
    const pts: [number, number | null, number | null, number | null][] = [];
    for (let m = 0; m < 10 * 24 * 60; m += 5) pts.push([Math.floor((now - m * 60_000) / 1000), 0.5, 0.5, 0.5]);
    pts.push([Math.floor((now - 40 * 24 * 3600_000) / 1000), 0.1, 0.1, 0.1]);
    const out = bound(pts, now);
    expect(out.every((p) => now - p[0] * 1000 <= HISTORY_LIMITS.maxAgeMs)).toBe(true);
    const recent = out.filter((p) => now - p[0] * 1000 <= HISTORY_LIMITS.fullResolutionMs);
    expect(recent.length).toBe((72 * 60) / 5 + 1);
    const old = out.filter((p) => now - p[0] * 1000 > HISTORY_LIMITS.fullResolutionMs);
    expect(old.length).toBeLessThanOrEqual(7 * 24 + 2);
    expect(out.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxPoints);
  });
});

describe("appendHistory", () => {
  it("appends one point per subject and validates", () => {
    const subject: MarketSubjectSnapshot = {
      id: "house", kind: "chamber", label: "House", contracts: [], flags: [],
      venues: [{ venue: "polymarket", pDem: 0.94, fromDemContract: 0.94, fromRepContract: 0.94, maxSpread: 0.01, usable: true, flags: [] }],
      consensus: { pDem: 0.94, method: "equal-weight-mean-of-usable-venue-midpoints", inputs: [{ venue: "polymarket", pDem: 0.94 }], band: { lo: 0.93, hi: 0.95 }, flags: ["SINGLE_SOURCE"] },
    };
    const h1 = appendHistory(null, [subject], now);
    const h2 = appendHistory(h1, [subject], now + 300_000);
    expect(h2.series.house).toHaveLength(2);
    expect(h2.series.house[1]).toEqual([Math.floor((now + 300_000) / 1000), 0.94, null, 0.94]);
    expect(HistorySnapshotSchema.safeParse(h2).success).toBe(true);
  });
});
