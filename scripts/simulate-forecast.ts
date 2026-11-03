/**
 * Sanity-check the live forecast on a synthetic election night.
 *
 *   npx tsx scripts/simulate-forecast.ts [race] [trueSwing] [seed]
 *
 * Takes a watched race's 2024 baseline, invents a "true" 2026 result (uniform
 * swing + unit noise), then reports units in a realistic order (early vote
 * first, which leans D relative to the final count) and prints the forecast at
 * each step. Writes nothing. Use it to eyeball calibration, not to prove it.
 */
import fs from "node:fs";
import path from "node:path";
import { WATCHED_RACES, type RaceId } from "@/lib/registry";
import { BaselinesSchema, UnitBaselinesSchema, type LocalityResult, type RaceResult } from "@/lib/schema";
import { buildPrior, forecastRace, phi } from "@/lib/forecast";
import { raceBaseline } from "@/pipeline/forecast";

const raceId = (process.argv[2] ?? "va-05") as RaceId;
const trueSwing = Number(process.argv[3] ?? 12);
let seed = Number(process.argv[4] ?? 7);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const va = BaselinesSchema.parse(JSON.parse(fs.readFileSync(path.resolve("data/historical/va/baselines.json"), "utf8")));
const tx = UnitBaselinesSchema.parse(JSON.parse(fs.readFileSync(path.resolve("data/historical/tx/baselines.json"), "utf8")));
const w = WATCHED_RACES.find((r) => r.id === raceId)!;
const bl = raceBaseline(raceId, va, tx)!;
const office = raceId === "tx-sen" ? "senate" : "house";
const registeredNow = raceId === "tx-sen" ? 19_041_684 : va.registration2026[raceId].total;
const turnoutScale = (registeredNow / (bl.baseline.registered ?? registeredNow)) * bl.midtermAdjustment * (0.9 + 0.2 * rand());

/* Truth per unit: final votes and margin. */
const truth = bl.baseline.units.map((u) => {
  const noise = 5 * gauss() * Math.min(2.5, Math.max(1, Math.sqrt(10_000 / Math.max(1, u.total * turnoutScale))));
  const margin = Math.max(-98, Math.min(98, ((u.dem - u.rep) / u.total) * 100 + trueSwing + noise));
  const total = Math.round(u.total * turnoutScale * (0.85 + 0.3 * rand()));
  return { name: u.name, total, margin, early: 0.45 + 0.2 * rand(), order: rand() };
});
const finalD = truth.reduce((a, t) => a + (t.total * (1 + t.margin / 100)) / 2, 0);
const finalTotal = truth.reduce((a, t) => a + t.total, 0);
const finalMargin = ((2 * finalD - finalTotal) / finalTotal) * 100;

const marketP = phi((bl.baseline.marginDR! + trueSwing + 3 * gauss()) / (office === "house" ? 7 : 5)); // market roughly right, with error
const prior = buildPrior({ pDem: Math.min(0.99, Math.max(0.01, marketP)), asOf: "2026-11-03T23:55:00Z", locked: true, office, baselineMargin: bl.baseline.marginDR });

function snapshot(step: number, steps: number): RaceResult {
  const localities: LocalityResult[] = truth.map((t) => {
    // Each unit starts reporting at a staggered time, posts early vote first (leans D by +8 vs its final), then election-day precincts.
    const start = t.order * 0.5;
    const prog = Math.max(0, Math.min(1, (step / steps - start) / 0.5));
    const earlyFrac = Math.min(1, prog / 0.3) * t.early; // early vote posts in the first 30% of the unit's window
    const edFrac = Math.max(0, (prog - 0.3) / 0.7) * (1 - t.early);
    const earlyMargin = t.margin + 8 * (1 - t.early);
    const edMargin = (t.margin - earlyMargin * t.early) / (1 - t.early);
    const ev = t.total * earlyFrac;
    const ed = t.total * edFrac;
    const total = Math.round(ev + ed);
    const d = Math.round((ev * (1 + earlyMargin / 100)) / 2 + (ed * (1 + edMargin / 100)) / 2);
    const complete = prog >= 1;
    const precincts = 20;
    return { name: t.name, fips: null, total, candidates: [{ party: "D", name: "D", votes: d }, { party: "R", name: "R", votes: total - d }], precinctsReporting: complete ? precincts : Math.floor(prog * precincts), precinctsTotal: precincts, fully: null, partially: null, notReported: null, complete, registered: null };
  });
  const total = localities.reduce((a, l) => a + l.total, 0);
  const d = localities.reduce((a, l) => a + l.candidates[0].votes, 0);
  return {
    id: raceId, label: w.label, state: w.state, office: w.office, status: "ok",
    source: { name: "sim", url: "", asOf: null, fetchedAt: "", isOfficial: false },
    candidates: [{ name: "D", party: "D", votes: d, share: null }, { name: "R", party: "R", votes: total - d, share: null }],
    totalVotes: total, marginDR: total ? ((2 * d - total) / total) * 100 : null,
    reporting: { unitKind: w.state === "VA" ? "locality" : "county", unitsReporting: localities.filter((l) => l.total > 0).length, unitsTotal: localities.length, fully: null, partially: null, notReported: null, precinctsReporting: null, precinctsTotal: null, complete: localities.every((l) => l.complete) },
    countGroups: null, turnout: { ballotsCast: total, registered: registeredNow, rate: null, registeredSource: null }, localities, earlyVote: null,
  };
}

console.log(`${raceId}: baseline ${bl.baseline.marginDR}, true swing ${trueSwing}, true final margin ${finalMargin.toFixed(2)} (${finalMargin > 0 ? "D" : "R"} wins), market prior P(D)=${prior.pDem} → margin ${prior.marginMean}±${prior.sigma}`);
console.log("step  counted%  eff%   P(D)   mean    sd    prior-w  swing±sd   counted-margin");
const steps = 24;
for (let s = 0; s <= steps; s++) {
  const r = snapshot(s, steps);
  const f = forecastRace({ result: r, baseline: bl.baseline, prior, turnout: { registeredNow, midtermAdjustment: bl.midtermAdjustment } });
  const inInterval = finalMargin >= f.interval80.lo && finalMargin <= f.interval80.hi ? " " : "!";
  console.log(`${String(s).padStart(4)}  ${(f.reportedFraction * 100).toFixed(0).padStart(6)}%  ${(f.effectiveFraction * 100).toFixed(0).padStart(3)}%  ${f.pDem.toFixed(3)}  ${f.marginMean.toFixed(2).padStart(6)}  ${f.marginSd.toFixed(2).padStart(5)}  ${f.priorWeight.toFixed(2).padStart(6)}  ${f.data ? `${f.data.swing.toFixed(1).padStart(5)}±${f.data.swingSd.toFixed(1)}` : "     –    "}  ${r.marginDR == null ? "–" : r.marginDR.toFixed(2)} ${inInterval}`);
}
