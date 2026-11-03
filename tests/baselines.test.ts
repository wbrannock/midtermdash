import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BaselinesSchema } from "@/lib/schema";
import { aggregateLocalities, classifyLocality, normalizeLocality, swingPoints } from "@/lib/historical";
import { VA_SPLIT_LOCALITIES } from "@/lib/registry";

const baselines = BaselinesSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/historical/va/baselines.json"), "utf8")));
const get = (race: string, year: number) => baselines.contests.find((c) => c.race === race && c.year === year)!;

describe("bundled Virginia baselines", () => {
  it("match the official district totals", () => {
    expect(get("va-05", 2024).totalVotes).toBe(435839);
    expect(get("va-05", 2024).candidates.find((c) => c.party === "R")?.votes).toBe(249564);
    expect(get("va-05", 2024).candidates.find((c) => c.party === "D")?.votes).toBe(184229);
    expect(get("va-09", 2024).totalVotes).toBe(400963);
    expect(get("va-05", 2018).totalVotes).toBe(310929);
    expect(get("va-09", 2018).candidates.find((c) => c.party === "D")?.votes).toBe(85833);
  });
  it("locality rows sum to the district totals", () => {
    for (const c of baselines.contests) {
      const sum = c.localities.reduce((a, l) => a + l.total, 0);
      expect(sum).toBe(c.totalVotes);
    }
  });
  it("has the expected locality counts and split flags", () => {
    expect(get("va-05", 2024).localities).toHaveLength(24);
    expect(get("va-09", 2024).localities).toHaveLength(28);
    expect(get("va-05", 2018).localities).toHaveLength(23);
    expect(get("va-09", 2018).localities).toHaveLength(29);
    expect(get("va-05", 2024).localities.find((l) => l.name === "Bedford County")?.split).toBe(true);
    expect(get("va-05", 2024).localities.find((l) => l.name === "Danville City")?.split).toBe(false);
  });
  it("comparable-geography sets exclude split and moved localities", () => {
    const c5 = baselines.comparableGeography["va-05:2018"].localities;
    expect(c5).toHaveLength(14);
    for (const s of [...VA_SPLIT_LOCALITIES["2016-court"]["va-05"], ...VA_SPLIT_LOCALITIES["2021-sms"]["va-05"]]) expect(c5).not.toContain(s);
    expect(c5).not.toContain("Lynchburg City"); // moved in 2021
    expect(c5).toContain("Danville City");
    expect(baselines.comparableGeography["va-09:2018"].localities).toHaveLength(24);
  });
  it("registration gives sensible turnout rates", () => {
    for (const c of baselines.contests) {
      expect(c.turnout.rate).toBeGreaterThan(0.4);
      expect(c.turnout.rate).toBeLessThan(0.9);
    }
    expect(baselines.registration2026["va-05"].total).toBe(626743);
  });
});

describe("historical helpers", () => {
  it("aggregates a comparable subset", () => {
    const c = get("va-05", 2018);
    const agg = aggregateLocalities(c.localities, baselines.comparableGeography["va-05:2018"].localities);
    expect(agg.localities).toHaveLength(14);
    expect(agg.total).toBeLessThan(c.totalVotes);
    expect(agg.marginDR).not.toBeNull();
  });
  it("classifies localities", () => {
    const base2018 = get("va-05", 2018);
    const base2024 = get("va-05", 2024);
    const comparable = new Set(baselines.comparableGeography["va-05:2018"].localities.map(normalizeLocality));
    const splitNow = new Set(VA_SPLIT_LOCALITIES["2021-sms"]["va-05"].map(normalizeLocality));
    expect(classifyLocality("Danville City", base2018, comparable, splitNow)).toBe("comparable");
    expect(classifyLocality("Lynchburg City", base2018, comparable, splitNow)).toBe("moved");
    expect(classifyLocality("Bedford County", base2018, comparable, splitNow)).toBe("split");
    expect(classifyLocality("Lynchburg City", base2024, null, splitNow)).toBe("same-map");
    expect(classifyLocality("Albemarle County", base2024, null, splitNow)).toBe("split");
  });
  it("only produces a swing when the live side is complete", () => {
    expect(swingPoints(-10, -15, false)).toBeNull();
    expect(swingPoints(-10, -15, true)).toBe(5);
  });
});
