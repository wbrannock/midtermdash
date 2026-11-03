/** Where the frontend reads snapshots from. Override with NEXT_PUBLIC_DATA_BASE_URL. */
export const DATA_BASE_URL = (process.env.NEXT_PUBLIC_DATA_BASE_URL ?? "https://raw.githubusercontent.com/wbrannock/midtermdash/data").replace(/\/$/, "");
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/wbrannock/midtermdash";
/** Browser poll interval. raw.githubusercontent.com caches for up to 5 minutes, so polling faster buys little. */
export const POLL_MS = 60_000;
