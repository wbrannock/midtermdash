/**
 * Re-download the official Virginia historical inputs into data/historical/va/raw.
 * Outputs are committed; run this only to refresh them. No credentials required.
 *
 *   npm run fetch-historical
 */
import fs from "node:fs";
import path from "node:path";
import { VA_HISTORICAL_CONTESTS, VA_HISTORICAL_CSV } from "@/lib/registry";
import { getText } from "../pipeline/http";

export const RAW_SOURCES: { file: string; url: string; note: string }[] = [
  ...VA_HISTORICAL_CONTESTS.map((c) => ({
    file: `${c.contestId}_table.csv`,
    url: VA_HISTORICAL_CSV(c.contestId),
    note: `${c.year} ${c.race.toUpperCase()} U.S. House results by locality and precinct (historical.elections.virginia.gov contest ${c.contestId})`,
  })),
  {
    file: "registration_2018_congressional.csv",
    url: "https://www.elections.virginia.gov/media/registration-statistics/2018/11/Registrant_Count_By_Congressional.csv",
    note: "Registrant count by congressional district, November 2018 (2016 court-ordered map)",
  },
  {
    file: "registration_2024_congressional.csv",
    url: "https://www.elections.virginia.gov/media/registration-statistics/2024/10/csv/Daily_Registrant_Count_By_Congressional_2024_11_01_054927.csv",
    note: "Daily registrant count by congressional district, 2024-11-01 (2021 map)",
  },
  {
    file: "registration_2026_congressional.csv",
    url: "https://www.elections.virginia.gov/media/registration-statistics/2026/10/csv/Daily_Registrant_Count_By_Congressional_2026_11_01_054459.csv",
    note: "Daily registrant count by congressional district, 2026-11-01 (2021 map)",
  },
];

async function main() {
  const dir = path.resolve("data/historical/va/raw");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of RAW_SOURCES) {
    const r = await getText(s.url, { timeoutMs: 30_000 });
    if (!r.ok || r.data.trimStart().startsWith("<")) {
      console.error(`FAILED ${s.file}: ${r.ok ? "HTML response (blocked?)" : r.error}`);
      continue;
    }
    fs.writeFileSync(path.join(dir, s.file), r.data);
    console.log(`ok ${s.file} (${r.data.length} bytes)`);
  }
}
if (process.argv[1]?.endsWith("fetch-historical.ts")) main();
