# midtermdash

A personal, nonpartisan dashboard for the 2026 U.S. midterms. Next.js 16, TypeScript, Tailwind 4, static export. No paid APIs, no API keys, no database, no external services beyond GitHub and Vercel.

- **Chamber control needles** for the House and Senate, read from Polymarket and Kalshi chamber-control contracts, shown separately and as a transparently computed consensus.
- **Probability history** and a **sortable watchlist** of every tracked market.
- **Watched races**: VA-05, VA-09 and the Texas Senate race, with counted returns from the Virginia Department of Elections and the Texas Secretary of State, kept visually separate from market prices.
- **Historical baselines** for VA-05 and VA-09: official 2024 and 2018 results by locality, turnout, boundary changes, and a comparable-geography view for 2018.

## How it works

```
GitHub Actions (main branch, cron + manual)        Vercel (static site, deploys only from main)
  pipeline/run.ts → adapters → zod validation →      browser polls raw.githubusercontent.com/
  compact JSON + bounded history → push `data`             <owner>/<repo>/data/latest/*.json every 60 s
```

Two branches. `main` holds the app, the pipeline, bundled historical data and workflows. `data` is an orphan branch containing only generated JSON. The frontend never fetches providers directly; it reads the `data` branch, so data refreshes never trigger a Vercel build.

## Setup

### 1. GitHub

1. Push this repository to GitHub as a **public** repo (the zero-credential design relies on public raw-file access and free Actions minutes).
2. Go to **Actions** and enable workflows if prompted. The `Refresh data` workflow needs only the built-in `GITHUB_TOKEN` with `contents: write`, which is declared in the workflow; no secrets are added.
3. Run **Actions → Refresh data → Run workflow** once. The first run creates the `data` branch. Later runs are scheduled:
   - every 5 minutes (offset from :00) inside the election-night window, by default `2026-11-03T16:00Z` to `2026-11-05T12:00Z` (edit `ELECTION_NIGHT_WINDOW` in `lib/registry.ts`; the 5-minute cron exits in seconds outside it);
   - every 2 hours otherwise.

If you fork under a different owner or name, change `DATA_BASE_URL` and `REPO_URL` in `lib/config.ts`, or set `NEXT_PUBLIC_DATA_BASE_URL` / `NEXT_PUBLIC_REPO_URL` in Vercel.

### 2. Vercel

Import the repository in Vercel with the defaults (framework: Next.js, root directory `/`). Nothing else to configure:

- `vercel.json` on `main` disables deployments for the `data` branch, and the `data` branch carries its own `vercel.json` with deployments disabled, so the 5-minute data pushes never count toward the Hobby plan's 100 deployments/day.
- The site is a static export (`output: "export"`); no server functions run.

### 3. Local development

```bash
npm ci
npm run pipeline -- --force          # writes out-data/latest/*.json and out-data/history/*.json
npx serve out-data --cors -l 8787    # serve the generated data locally
NEXT_PUBLIC_DATA_BASE_URL=http://localhost:8787 npm run dev
```

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run check-baselines`, `npm run build`.

## Data sources (all public, no credentials)

| Source | Used for | Endpoint family |
|---|---|---|
| Polymarket Gamma + CLOB + Data API | chamber control, TX-Sen, VA-05, VA-09 market quotes | `gamma-api.polymarket.com/events?slug=`, `clob.polymarket.com/book?token_id=`, `data-api.polymarket.com/v2/trades` |
| Kalshi | same contracts on the second venue | `api.elections.kalshi.com/trade-api/v2/markets/{ticker}`, `/markets/trades` |
| Virginia Dept. of Elections ENR | VA-05 and VA-09 counted results, per-locality precinct status, registration, absentee CSV | `enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General/...` |
| Texas Secretary of State ENR | TX-Sen counted results, county detail, early-voting turnout | `goelect.txelections.civixapps.com/api-ivis-system/...` |
| historical.elections.virginia.gov | 2024 and 2018 VA-05/VA-09 results by locality and precinct | `api/download_contest/{id}_table.csv` (committed under `data/historical/va/raw`) |
| elections.virginia.gov registration statistics | registered voters by congressional district, Nov 1 2018/2024/2026 | committed CSVs |

The specific contracts are listed in `lib/registry.ts` with their slugs and tickers. Settlement rules differ between venues (Polymarket: seats as elected; Kalshi: media-call consensus or officeholder on 2027-02-01) and are shown in the UI.

### Evaluated and not used

- AP Elections API, Decision Desk HQ: paid, keyed.
- Newspaper result JSON: undocumented and not licensed for reuse.
- civicAPI: free and keyless, but undisclosed data source and unreliable during testing; omitted.
- OpenElections: no 2024 Virginia file.

## Methodology in brief

- **Midpoints.** Each contract is priced at (bid + ask) / 2. Flags: wide spread (> 5 pt), thin liquidity (< $10k), stale (no trade for 6 h on election night, 48 h otherwise), no quote, fetch failed / retained.
- **Per venue.** P(D) = mean of the D contract midpoint and 1 − the R contract midpoint; flagged if they differ by > 3 pt.
- **Consensus.** Equal-weighted mean of venue values that are not stale and have a worst spread ≤ 10 pt. Inputs are stored in every snapshot. Venues disagreeing by ≥ 3 pt are flagged, not smoothed. No liquidity weighting; no blending with polls or models.
- **No aggregation.** Chamber needles read only chamber contracts; race probabilities are never combined into chamber control.
- **Results.** Shares, D−R margin in points, votes by count method, completeness as localities/counties fully, partially and not reported. A swing versus 2024 or 2018 is shown only once the relevant localities are all fully reported; before that the comparison is labelled partial.
- **Boundaries.** 2026 uses the 2021 map (same as 2024). The April 2026 redistricting referendum was voided by the Supreme Court of Virginia on 2026-05-08. 2018 used the 2016 court-ordered map; the comparable-geography set is the localities wholly inside the district under both maps (14 for VA-05, 24 for VA-09). Split localities are excluded from locality comparisons.
- **Turnout.** Votes in the contest ÷ registered voters (active + inactive) on Nov 1 of that year.
- **Early vote.** Virginia absentee statistics (returned ballots) and Texas early-voting turnout are shown as pre-election statistics, never as counted votes.

## Free-tier limits and known constraints

- GitHub Actions: cron minimum is 5 minutes; runs may be delayed or skipped when GitHub is busy (worst at the top of the hour, so the schedule is offset). Standard runners are free for public repositories. Scheduled workflows run only from the default branch and are disabled after 60 days without repository activity; a manual run re-enables them.
- `raw.githubusercontent.com` caches files for up to 5 minutes and applies unpublished rate limits to unauthenticated requests. Effective freshness is therefore 5–10 minutes.
- Vercel Hobby: 100 deployments/day. The `data` branch is excluded from Git deployments for this reason; do not switch to the Ignored Build Step, which still counts cancelled builds.
- The pipeline keeps the last valid file for any provider that fails and records the failure in `latest/status.json`. Each run has a 10-second per-request timeout, two jittered retries, an 8-minute job timeout, and a concurrency group so runs queue instead of overlapping.
- Election-day load may cause the state ENR hosts or Cloudflare to throttle requests from Actions runners; affected panels then show their last valid snapshot with a flag.

## Repository layout

```
.github/workflows/refresh-data.yml   scheduled + manual data refresh (pushes to `data`)
.github/workflows/ci.yml             typecheck, lint, tests, baseline check, build
app/                                 Next.js app router (static export)
components/                          needle, charts, watchlist, race panels, methodology
lib/                                 registry, zod schemas, consensus and historical math, polling hook
pipeline/                            run.ts orchestrator, http.ts, adapters/, history.ts, write.ts
scripts/                             fetch-historical.ts, build-baselines.ts
data/historical/va/                  raw official CSVs and the generated baselines.json
tests/                               vitest suites with recorded fixtures
```

## Data branch layout

```
latest/markets.json    quotes, per-venue estimates, consensus with inputs, flags
latest/results.json    VA-05, VA-09, TX-Sen counted results, completeness, localities, early-vote stats
latest/status.json     per-source status, run id/url, window mode, retained files, notes
history/markets.json   bounded series [t, polymarket, kalshi, consensus] per subject
vercel.json            disables deployments for this branch
```

## License and attribution

Code: MIT. Election results are public records of the Virginia Department of Elections and the Texas Secretary of State. Market data belongs to Polymarket and Kalshi and is displayed with source links.
