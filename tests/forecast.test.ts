import { describe, expect, it } from "vitest";
import { FORECAST, baselineFromUnits, buildPrior, forecastRace, phi, probit, unitKey, type RaceBaseline } from "@/lib/forecast";
import { appendForecastHistory, raceBaseline, selectPrior } from "@/pipeline/forecast";
import { ForecastHistorySchema, RaceForecastSchema, UnitBaselinesSchema, type ForecastSnapshot, type LocalityResult, type RaceResult } from "@/lib/schema";
import { aggregateVoterData, aggregateVtdReturns, parseCandidateHeader, parseCountyCodes } from "@/scripts/build-tx-baselines";
import txBaselinesJson from "@/data/historical/tx/baselines.json";

const txBaselines = UnitBaselinesSchema.parse(txBaselinesJson);

describe("normal helpers", () => {
  it("phi and probit are inverses and symmetric", () => {
    expect(phi(0)).toBeCloseTo(0.5, 6);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(probit(0.975)).toBeCloseTo(1.96, 2);
    for (const p of [0.01, 0.2, 0.43, 0.5, 0.73, 0.99]) expect(phi(probit(p))).toBeCloseTo(p, 5);
  });
  it("unitKey ignores spacing and punctuation", () => {
    expect(unitKey("De Witt County")).toBe(unitKey("DeWitt County"));
  });
});

describe("buildPrior", () => {
  it("maps a market probability to a margin prior", () => {
    const p = buildPrior({ pDem: 0.43, asOf: "2026-11-03T23:55:00Z", locked: true, office: "house", baselineMargin: -15 });
    expect(p.source).toBe("market-consensus");
    expect(p.sigma).toBe(FORECAST.priorSigmaPts.house);
    expect(p.marginMean).toBeLessThan(0);
    expect(phi(p.marginMean / p.sigma)).toBeCloseTo(0.43, 2);
  });
  it("falls back to the baseline margin when no price exists", () => {
    const p = buildPrior({ pDem: null, asOf: null, locked: false, office: "senate", baselineMargin: -8.5 });
    expect(p.source).toBe("baseline-fallback");
    expect(p.marginMean).toBe(-8.5);
    expect(p.sigma).toBe(FORECAST.fallbackSigmaPts);
  });
});

/* ---- synthetic district: 4 units, 2024 R+10 overall ---- */
const base: RaceBaseline = {
  year: 2024,
  label: "2024",
  marginDR: -10,
  totalVotes: 100_000,
  registered: 150_000,
  units: [
    { name: "Alpha County", dem: 20_000, rep: 10_000, total: 30_000 }, // D+33
    { name: "Beta County", dem: 10_000, rep: 15_000, total: 25_000 }, // R+20
    { name: "Gamma County", dem: 10_000, rep: 20_000, total: 30_000 }, // R+33
    { name: "Delta County", dem: 5_000, rep: 10_000, total: 15_000 }, // R+33
  ],
};
function loc(name: string, d: number, r: number, complete: boolean, precinctsTotal = 10): LocalityResult {
  const reporting = complete ? precinctsTotal : d + r > 0 ? Math.max(1, Math.round(precinctsTotal / 2)) : 0;
  return { name, fips: null, total: d + r, candidates: [{ party: "D", name: "Dem", votes: d }, { party: "R", name: "Rep", votes: r }], precinctsReporting: reporting, precinctsTotal, fully: null, partially: null, notReported: null, complete, registered: null };
}
function result(localities: LocalityResult[], official = false): RaceResult {
  const d = localities.reduce((a, l) => a + l.candidates[0].votes, 0);
  const r = localities.reduce((a, l) => a + l.candidates[1].votes, 0);
  const total = d + r;
  return {
    id: "va-05", label: "VA-05", state: "VA", office: "House", status: "ok",
    source: { name: "test", url: "", asOf: null, fetchedAt: "2026-11-04T01:00:00Z", isOfficial: official },
    candidates: [{ name: "Dem", party: "D", votes: d, share: total ? d / total : null }, { name: "Rep", party: "R", votes: r, share: total ? r / total : null }],
    totalVotes: total,
    marginDR: total ? ((d - r) / total) * 100 : null,
    reporting: { unitKind: "locality", unitsReporting: localities.filter((l) => l.total > 0).length, unitsTotal: localities.length, fully: null, partially: null, notReported: null, precinctsReporting: null, precinctsTotal: null, complete: localities.every((l) => l.complete) },
    countGroups: null,
    turnout: { ballotsCast: total, registered: 165_000, rate: null, registeredSource: null },
    localities,
    earlyVote: null,
  };
}
const prior = buildPrior({ pDem: 0.43, asOf: "2026-11-03T23:55:00Z", locked: true, office: "house", baselineMargin: -10 });
const turnout = { registeredNow: 165_000, midtermAdjustment: 0.7 };

describe("forecastRace", () => {
  it("equals the market prior before any votes are counted", () => {
    const f = forecastRace({ result: result(base.units.map((u) => loc(u.name, 0, 0, false))), baseline: base, prior, turnout });
    expect(f.phase).toBe("pre-results");
    expect(f.pDem).toBeCloseTo(0.43, 3);
    expect(f.priorWeight).toBe(1);
    expect(f.data).toBeNull();
    expect(f.expectedVotes).toBeCloseTo(100_000 * (165_000 / 150_000) * 0.7, -2);
    expect(RaceForecastSchema.safeParse(f).success).toBe(true);
  });
  it("moves toward the returns and reduces the prior weight as units complete", () => {
    // Alpha complete at D+40 (swing +7), Beta half-in at R+10 (swing +10 so far).
    const partial = result([loc("Alpha County", 15_400, 6_600, true), loc("Beta County", 4_000, 4_900, false), loc("Gamma County", 0, 0, false), loc("Delta County", 0, 0, false)]);
    const f = forecastRace({ result: partial, baseline: base, prior, turnout });
    expect(f.phase).toBe("counting");
    expect(f.data).not.toBeNull();
    expect(f.data!.swing).toBeGreaterThan(5);
    expect(f.priorWeight).toBeGreaterThan(0.05);
    expect(f.priorWeight).toBeLessThan(0.95);
    // Posterior lies between the prior mean and the data mean.
    const lo = Math.min(prior.marginMean, f.data!.marginMean);
    const hi = Math.max(prior.marginMean, f.data!.marginMean);
    expect(f.marginMean).toBeGreaterThanOrEqual(lo - 0.01);
    expect(f.marginMean).toBeLessThanOrEqual(hi + 0.01);
    expect(f.turnoutFactor).toBeGreaterThan(0.5);
    expect(f.units.find((u) => u.name === "Beta County")!.fraction).toBeLessThan(1);
    expect(f.units.find((u) => u.name === "Alpha County")!.complete).toBe(true);
  });
  it("is dominated by the count once every unit is complete, with a tighter official floor", () => {
    const final = [loc("Alpha County", 15_000, 7_000, true), loc("Beta County", 8_000, 9_500, true), loc("Gamma County", 8_000, 13_000, true), loc("Delta County", 4_000, 6_500, true)];
    const f = forecastRace({ result: result(final), baseline: base, prior, turnout });
    const total = final.reduce((a, l) => a + l.total, 0);
    const margin = ((35_000 - 36_000) / total) * 100;
    expect(f.phase).toBe("complete");
    expect(f.priorWeight).toBeLessThan(0.01);
    expect(f.marginMean).toBeCloseTo(margin, 0);
    expect(f.marginSd).toBeLessThan(0.5);
    expect(f.pDem).toBeLessThan(0.5);
    const off = forecastRace({ result: result(final, true), baseline: base, prior, turnout });
    expect(off.phase).toBe("official");
    expect(off.marginSd).toBeLessThan(f.marginSd);
    expect(off.pDem).toBeLessThan(0.01);
  });
  it("uses the race-wide baseline for units without a baseline row and says so", () => {
    const f = forecastRace({ result: result([...base.units.map((u) => loc(u.name, 0, 0, false)), loc("Omega City", 100, 50, true)]), baseline: base, prior, turnout });
    expect(f.baseline.unitsMatched).toBe(4);
    expect(f.notes.some((n) => n.includes("Omega City"))).toBe(true);
    expect(f.units.find((u) => u.name === "Omega City")!.baselineMargin).toBeNull();
  });
});

describe("selectPrior", () => {
  const markets = { schemaVersion: 1 as const, generatedAt: "2026-11-04T00:30:00Z", subjects: [{ id: "va-05", kind: "race" as const, label: "x", contracts: [], venues: [], consensus: { pDem: 0.2, method: "equal-weight-mean-of-usable-venue-midpoints" as const, inputs: [], band: null, flags: [] }, flags: [] }] };
  const history = { schemaVersion: 1 as const, generatedAt: "2026-11-04T00:30:00Z", columns: ["t", "polymarket", "kalshi", "consensus"] as ["t", "polymarket", "kalshi", "consensus"], series: { "va-05": [[Math.floor(Date.parse("2026-11-03T23:50:00Z") / 1000), 0.44, 0.42, 0.43], [Math.floor(Date.parse("2026-11-04T00:25:00Z") / 1000), 0.2, 0.2, 0.2]] as [number, number, number, number][] } };
  it("tracks the current market while polls are open", () => {
    const p = selectPrior("va-05", { nowMs: Date.parse("2026-11-03T20:00:00Z"), markets, history, previous: null, baselineMargin: -15 });
    expect(p.locked).toBe(false);
    expect(p.pDem).toBe(0.2);
  });
  it("freezes at the last pre-close snapshot after polls close and never changes again", () => {
    const p = selectPrior("va-05", { nowMs: Date.parse("2026-11-04T00:30:00Z"), markets, history, previous: null, baselineMargin: -15 });
    expect(p.locked).toBe(true);
    expect(p.pDem).toBe(0.43);
    expect(p.asOf).toBe("2026-11-03T23:50:00.000Z");
    const again = selectPrior("va-05", { nowMs: Date.parse("2026-11-04T03:00:00Z"), markets: { ...markets, subjects: [] }, history: null, previous: { prior: p } as never, baselineMargin: -15 });
    expect(again).toEqual(p);
  });
  it("falls back to the current price (with a note) when no pre-close snapshot exists", () => {
    const p = selectPrior("va-05", { nowMs: Date.parse("2026-11-04T00:30:00Z"), markets, history: null, previous: null, baselineMargin: -15 });
    expect(p.locked).toBe(true);
    expect(p.pDem).toBe(0.2);
    expect(p.note).toMatch(/after polls closed/);
  });
});

describe("Texas baselines", () => {
  it("parses TLC candidate headers", () => {
    expect(parseCandidateHeader("AllredD_24G_U.S. Sen")).toEqual({ name: "Allred", party: "D" });
    expect(parseCandidateHeader("CruzR_18G_U.S. Sen")).toEqual({ name: "Cruz", party: "R" });
    expect(parseCandidateHeader("O'RourkeD_18G_U.S. Sen")).toEqual({ name: "O'Rourke", party: "D" });
    expect(parseCandidateHeader("VTDKEY")).toBeNull();
  });
  it("aggregates VTD rows to counties", () => {
    const codes = parseCountyCodes("STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT\nTX|48|001|x|Anderson County|H1|A\nTX|48|003|x|Andrews County|H1|A\n");
    const agg = aggregateVtdReturns('CNTYVTD,VTDKEY,AllredD_24G_U.S. Sen,BrownL_24G_U.S. Sen,CruzR_24G_U.S. Sen\n"0010001",1,100,5,200\n"0010002",2,50,5,100\n"0030001",3,10,0,90\n', codes);
    expect(agg.units.get("001")).toEqual({ dem: 150, rep: 300, other: 10, total: 460 });
    expect(agg.units.get("003")).toEqual({ dem: 10, rep: 90, other: 0, total: 100 });
    expect(agg.candidates.find((c) => c.party === "R")!.votes).toBe(390);
    const v = aggregateVoterData('CNTYVTD,VTDKEY,Voter_Registration,Turnout,X\n"0010001",1,1000,600,0\n"0010002",2,500,250,0\n');
    expect(v.get("001")).toEqual({ registered: 1500, ballots: 850 });
  });
  it("committed baseline matches the certified statewide 2024 and 2018 margins", () => {
    const c24 = txBaselines.contests.find((c) => c.year === 2024)!;
    const c18 = txBaselines.contests.find((c) => c.year === 2018)!;
    expect(c24.units).toHaveLength(254);
    expect(c24.marginDR).toBeCloseTo(-8.5, 1);
    expect(c18.marginDR).toBeCloseTo(-2.6, 1);
    const rb = raceBaseline("tx-sen", null, txBaselines)!;
    expect(rb.baseline.units).toHaveLength(254);
    expect(rb.midtermAdjustment).toBeCloseTo(c18.totalVotes / c24.totalVotes, 6);
    expect(baselineFromUnits(c24).registered).toBe(c24.registered);
  });
});

describe("appendForecastHistory", () => {
  it("appends one point per race and validates", () => {
    const f = forecastRace({ result: result(base.units.map((u) => loc(u.name, 0, 0, false))), baseline: base, prior, turnout });
    const snap: ForecastSnapshot = { schemaVersion: 1, generatedAt: "2026-11-04T00:00:00Z", model: "t", races: [f] };
    const now = Date.parse("2026-11-04T00:00:00Z");
    const h = appendForecastHistory(appendForecastHistory(null, snap, now), snap, now + 300_000);
    expect(h.series["va-05"]).toHaveLength(2);
    expect(h.series["va-05"][1][1]).toBe(f.pDem);
    expect(ForecastHistorySchema.safeParse(h).success).toBe(true);
  });
});
