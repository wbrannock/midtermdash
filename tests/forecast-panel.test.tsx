import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ForecastPanel } from "@/components/forecast/ForecastPanel";
import type { ForecastHistory, ForecastSnapshot } from "@/lib/schema";

const snap: ForecastSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-11-04T01:30:00Z",
  model: "needle-test",
  races: [
    {
      id: "va-05",
      label: "VA-05 · U.S. House",
      state: "VA",
      phase: "counting",
      pDem: 0.38,
      marginMean: -2.1,
      marginSd: 4.3,
      interval80: { lo: -7.6, hi: 3.4 },
      prior: { pDem: 0.43, marginMean: -1.23, sigma: 7, source: "market-consensus", asOf: "2026-11-03T23:55:00Z", locked: true },
      priorWeight: 0.62,
      data: { pDem: 0.3, marginMean: -3.5, marginSd: 5.6, swing: 11.5, swingSd: 3.1 },
      baseline: { year: 2024, label: "2024", marginDR: -14.99, unitsMatched: 24, unitsTotal: 24 },
      expectedVotes: 319_000,
      countedVotes: 110_000,
      reportedFraction: 0.34,
      effectiveFraction: 0.2,
      turnoutFactor: 1.02,
      unitsComplete: 5,
      unitsTotal: 24,
      units: [
        { name: "Albemarle County", expected: 48_000, counted: 20_000, fraction: 0.42, complete: false, baselineMargin: 29.5, observedMargin: 38.2, projectedMargin: 40.1 },
        { name: "Amelia County", expected: 5_700, counted: 5_700, fraction: 1, complete: true, baselineMargin: -47.9, observedMargin: -36.1, projectedMargin: -36.1 },
      ],
      notes: [],
    },
  ],
};
const history: ForecastHistory = {
  schemaVersion: 1,
  generatedAt: snap.generatedAt,
  columns: ["t", "pDem", "lo80", "hi80", "priorWeight", "reportedFraction"],
  series: { "va-05": [[1, 0.43, -10, 7, 1, 0], [2, 0.38, -7.6, 3.4, 0.62, 0.34]] },
};

describe("ForecastPanel", () => {
  it("renders a counting race without throwing and shows key figures", () => {
    const html = renderToStaticMarkup(<ForecastPanel forecast={snap} history={history} subjects={[]} now={Date.parse("2026-11-04T01:31:00Z")} />);
    expect(html).toContain("VA-05");
    expect(html).toContain("62%"); // prior weight
    expect(html).toContain("R +2.1"); // forecast margin
    expect(html).toContain("Albemarle County");
    expect(html).toContain("counting");
  });
  it("renders the empty state when no snapshot is loaded", () => {
    const html = renderToStaticMarkup(<ForecastPanel forecast={null} history={null} subjects={[]} now={0} />);
    expect(html).toContain("not loaded");
  });
});
