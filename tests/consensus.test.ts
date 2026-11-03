import { describe, expect, it } from "vitest";
import { THRESHOLDS, buildSubjectSnapshot, consensus, contractFlags, midpoint, venueEstimate } from "@/lib/consensus";
import type { ContractQuote } from "@/lib/schema";

const now = Date.parse("2026-11-03T20:00:00Z");
const ctx = { now, staleMs: THRESHOLDS.staleMsElectionNight };

function q(partial: Partial<ContractQuote> & { venue: ContractQuote["venue"]; party: ContractQuote["party"] }): ContractQuote {
  const bid = partial.bid ?? null;
  const ask = partial.ask ?? null;
  return {
    id: `${partial.venue}-${partial.party}`,
    label: "x",
    bid,
    ask,
    mid: midpoint(bid, ask),
    last: null,
    spread: bid != null && ask != null ? ask - bid : null,
    liquidity: 1_000_000,
    volume: null,
    lastTradeAt: new Date(now - 60_000).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    sourceUrl: "",
    status: "ok",
    flags: [],
    ...partial,
  };
}

describe("midpoint", () => {
  it("averages a two-sided quote", () => expect(midpoint(0.94, 0.95)).toBe(0.945));
  it("returns null when one side is missing or crossed", () => {
    expect(midpoint(null, 0.95)).toBeNull();
    expect(midpoint(0.96, 0.95)).toBeNull();
  });
});

describe("contractFlags", () => {
  it("flags wide spread, thin liquidity and stale trades", () => {
    const f = contractFlags(q({ venue: "kalshi", party: "D", bid: 0.4, ask: 0.5, liquidity: 500, lastTradeAt: new Date(now - 10 * 3600_000).toISOString() }), ctx);
    expect(f).toEqual(["STALE", "THIN_LIQUIDITY", "WIDE_SPREAD"]);
  });
  it("flags NO_QUOTE and ONE_SIDED_BOOK", () => {
    const f = contractFlags(q({ venue: "polymarket", party: "D", bid: 0.4, ask: null }), ctx);
    expect(f).toContain("NO_QUOTE");
    expect(f).toContain("ONE_SIDED_BOOK");
  });
});

describe("venueEstimate", () => {
  it("combines the D contract and the complement of the R contract", () => {
    const v = venueEstimate("kalshi", [q({ venue: "kalshi", party: "D", bid: 0.93, ask: 0.94 }), q({ venue: "kalshi", party: "R", bid: 0.06, ask: 0.07 })]);
    expect(v.fromDemContract).toBe(0.935);
    expect(v.fromRepContract).toBe(0.935);
    expect(v.pDem).toBe(0.935);
    expect(v.usable).toBe(true);
    expect(v.flags).toEqual([]);
  });
  it("flags internal inconsistency above 3 points", () => {
    const v = venueEstimate("polymarket", [q({ venue: "polymarket", party: "D", bid: 0.9, ask: 0.91 }), q({ venue: "polymarket", party: "R", bid: 0.13, ask: 0.14 })]);
    expect(v.flags).toContain("INTERNAL_INCONSISTENCY");
  });
  it("is not usable when the spread exceeds the usable threshold", () => {
    const quotes = [q({ venue: "polymarket", party: "D", bid: 0.4, ask: 0.6 })].map((x) => ({ ...x, flags: contractFlags(x, ctx) }));
    const v = venueEstimate("polymarket", quotes);
    expect(v.pDem).toBe(0.5);
    expect(v.usable).toBe(false);
  });
  it("is not usable when every contract is stale", () => {
    const quotes = [q({ venue: "kalshi", party: "D", bid: 0.4, ask: 0.41, lastTradeAt: new Date(now - 48 * 3600_000).toISOString() })].map((x) => ({ ...x, flags: contractFlags(x, ctx) }));
    expect(venueEstimate("kalshi", quotes).usable).toBe(false);
  });
});

describe("consensus", () => {
  const mk = (venue: "polymarket" | "kalshi", pDem: number | null, usable = true, maxSpread = 0.01) => ({ venue, pDem, fromDemContract: pDem, fromRepContract: pDem, maxSpread, usable, flags: [] as never[] });
  it("equal-weights usable venues and records inputs", () => {
    const c = consensus([mk("polymarket", 0.945), mk("kalshi", 0.935)]);
    expect(c.pDem).toBe(0.94);
    expect(c.inputs).toEqual([{ venue: "polymarket", pDem: 0.945 }, { venue: "kalshi", pDem: 0.935 }]);
    expect(c.band).toEqual({ lo: 0.93, hi: 0.95 });
    expect(c.flags).toEqual([]);
  });
  it("flags disagreement at 3 points or more", () => {
    expect(consensus([mk("polymarket", 0.95), mk("kalshi", 0.92)]).flags).toContain("DISAGREEMENT");
  });
  it("flags single source and excludes unusable venues", () => {
    const c = consensus([mk("polymarket", 0.95), mk("kalshi", 0.5, false)]);
    expect(c.pDem).toBe(0.95);
    expect(c.flags).toContain("SINGLE_SOURCE");
    expect(c.inputs).toHaveLength(1);
  });
  it("returns NO_CONSENSUS when nothing is usable", () => {
    const c = consensus([mk("polymarket", null, false)]);
    expect(c.pDem).toBeNull();
    expect(c.flags).toEqual(["NO_CONSENSUS"]);
  });
});

describe("buildSubjectSnapshot", () => {
  it("never aggregates race probabilities into chamber control (chamber uses only its own contracts)", () => {
    const s = buildSubjectSnapshot({ id: "house", kind: "chamber", label: "House" }, [q({ venue: "kalshi", party: "D", bid: 0.93, ask: 0.94 })], ctx);
    expect(s.contracts).toHaveLength(1);
    expect(s.consensus.inputs.map((i) => i.venue)).toEqual(["kalshi"]);
    expect(s.flags).toContain("SINGLE_SOURCE");
  });
});
