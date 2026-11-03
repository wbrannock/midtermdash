/**
 * Download the Texas historical inputs into data/historical/tx/raw.
 * Outputs are committed; run this only to refresh them. No credentials required.
 *
 *   npm run fetch-historical-tx
 *
 * Sources: Texas Legislative Council election returns by VTD (ted.capitol.texas.gov,
 * catalogued at data.capitol.texas.gov) and the Census Bureau county code list.
 */
import fs from "node:fs";
import path from "node:path";
import { TX_COUNTY_CODES_URL, TX_HISTORICAL_CONTESTS, TX_TLC_API, TX_VOTER_DATA } from "@/lib/registry";
import { getText } from "../pipeline/http";

export const TX_RAW_SOURCES: { file: string; url: string; note: string }[] = [
  ...TX_HISTORICAL_CONTESTS.map((c) => ({
    file: c.file,
    url: `${TX_TLC_API}/${c.electionId}/${c.officeId}/vtd`,
    note: `${c.label} by VTD, Texas Legislative Council (election ${c.electionId}, office ${c.officeId})`,
  })),
  {
    file: TX_VOTER_DATA.file,
    url: `${TX_TLC_API}/${TX_VOTER_DATA.electionId}/${TX_VOTER_DATA.officeId}/vtd`,
    note: "2024 general election voter registration and turnout by VTD, Texas Legislative Council",
  },
  { file: "tx_county_codes_2020.txt", url: TX_COUNTY_CODES_URL, note: "Census Bureau 2020 county FIPS codes and names for Texas" },
];

async function main() {
  const dir = path.resolve("data/historical/tx/raw");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of TX_RAW_SOURCES) {
    const r = await getText(s.url, { timeoutMs: 60_000 });
    if (!r.ok || r.data.trimStart().startsWith("<")) {
      console.error(`FAILED ${s.file}: ${r.ok ? "HTML response (bot check?)" : r.error} ← ${s.url}`);
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(path.join(dir, s.file), r.data);
    console.log(`saved ${s.file} (${r.data.length} bytes) ← ${s.url}`);
  }
  fs.writeFileSync(path.join(dir, "SOURCES.md"), `# Raw Texas inputs\n\nDownloaded ${new Date().toISOString().slice(0, 10)} by scripts/fetch-historical-tx.ts.\n\n${TX_RAW_SOURCES.map((s) => `- \`${s.file}\` — ${s.note}\n  ${s.url}`).join("\n")}\n`);
}

if (process.argv[1]?.endsWith("fetch-historical-tx.ts")) main();
