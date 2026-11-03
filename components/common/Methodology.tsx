import type { StatusSnapshot } from "@/lib/schema";
import { THRESHOLDS } from "@/lib/consensus";
import { ELECTION_NIGHT_WINDOW } from "@/lib/registry";
import { Card, Details } from "./Section";
import { FLAG_META } from "./Flag";

export function CoverageGaps({ status }: { status: StatusSnapshot | null }) {
  const failing = status ? Object.entries(status.sources).filter(([, s]) => !s.ok) : [];
  return (
    <Card>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-2">
        <li>
          <span className="text-fg">No nationwide live results.</span> There is no free, credential-free, redistributable feed of all House and Senate races (AP and Decision Desk are licensed; newspaper JSON is not licensed for reuse). Chamber control on this page is market-implied only, never a seat count.
        </li>
        <li>
          <span className="text-fg">Chamber probabilities are not built from race markets.</span> No aggregation of district probabilities into chamber control is performed anywhere; the needles read only the chamber-control contracts.
        </li>
        <li>
          <span className="text-fg">Results are unofficial until certified.</span> Virginia marks its feed official only after canvass; Texas county data stays unofficial until the state canvass. Precinct completeness is the only completeness signal available; neither state publishes an expected-vote estimate.
        </li>
        <li>
          <span className="text-fg">Early-vote statistics are not counted ballots.</span> Virginia&apos;s absentee file updates about once a day and counts returned ballots; Texas early-voting turnout stops at the last early-voting day. Both are shown separately from results.
        </li>
        <li>
          <span className="text-fg">Freshness is 5 to 10 minutes at best.</span> GitHub Actions schedules run every 5 minutes at most, can be delayed under load, and the raw-file CDN caches for up to 5 minutes. On-page timestamps show the snapshot time, not now.
        </li>
        <li>
          <span className="text-fg">VA-09 markets are thin.</span> Kalshi open interest on the VA-09 contracts is a few thousand dollars; its prices are flagged and should be read as indicative.
        </li>
        {failing.length ? (
          <li className="text-serious">
            Sources failing in the latest run: {failing.map(([k, s]) => `${k} (${s.error})`).join("; ")}. Affected values show their last valid snapshot.
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

export function Methodology() {
  return (
    <Card>
      <Details summary="Sources and endpoints" defaultOpen>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Polymarket: Gamma API events by slug for market metadata and liquidity; CLOB order book per YES token for best bid and ask; Data API for the last YES-token trade. Public, no key.
          </li>
          <li>Kalshi: elections API market objects (dollar-denominated bid, ask, last, volume, open interest) and the public trades endpoint for last-trade time. Public, no key.</li>
          <li>Virginia: Department of Elections election-night reporting API (contest summary, per-locality breakdown with precinct reporting status, registration by locality) and the absentee CSV it publishes. Public, no key.</li>
          <li>Texas: Secretary of State election-night backend (statewide Federal block, county detail with precincts reporting and registered voters) and the early-voting turnout files. Public, no key.</li>
          <li>Historical: historical.elections.virginia.gov contest CSVs (2024 and 2018, locality and precinct rows) and registrant counts by congressional district for Nov 1 of 2018, 2024 and 2026. Downloaded once and committed with their URLs.</li>
        </ul>
      </Details>
      <Details summary="Market midpoints, flags and the consensus needle">
        <p>
          Each contract&apos;s price is the bid–ask midpoint. Per venue, P(Democratic) is the mean of the Democratic contract&apos;s midpoint and one minus the Republican contract&apos;s midpoint; a gap above {THRESHOLDS.internalInconsistency * 100} points is flagged. The consensus is the equal-weighted mean of venue values that are not stale and whose worst spread is at most {THRESHOLDS.maxUsableSpread * 100} points; the inputs used are stored with every snapshot. No liquidity weighting is applied, so the number can be recomputed by hand. The band around the needle spans the usable venue values plus or minus half their spread.
        </p>
        <p className="mt-2">Flags: {Object.entries(FLAG_META).map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} (${v.title.replace(/\.$/, "")})`).join("; ")}.</p>
      </Details>
      <Details summary="Why Polymarket and Kalshi can legitimately differ">
        <p>
          The contracts answer slightly different questions. Polymarket&apos;s chamber markets resolve on the majority of seats as elected, with the Speaker or President pro tempore as a tiebreak and independents counted only if they declare a caucus. Kalshi&apos;s settle early on a consensus of media calls, otherwise on who holds the Speaker or President pro tempore office on Feb 1, 2027. Race markets differ too: Kalshi settles on who is sworn in; Polymarket on AP or credible-consensus calls by ballot party. Fees, collateral, and user base also differ. A gap at or above {THRESHOLDS.disagreement * 100} points is flagged rather than averaged away.
        </p>
      </Details>
      <Details summary="Results, completeness, and why swing is withheld">
        <p>
          Counted-vote blocks show candidate votes and shares, the D−R margin in points, votes by count method where the state publishes them, and completeness as localities or counties fully, partially and not reported. Partial returns are compared with historical finals only as a labelled partial comparison; a swing figure appears only once every locality in the comparison set is fully reported, because the mix of early-reporting localities and vote methods biases partial margins. Turnout is contest votes divided by registered voters (active plus inactive) on Nov 1 of that year, so it excludes ballots that skipped the contest.
        </p>
      </Details>
      <Details summary="District boundaries and comparable geography">
        <p>
          2026 uses the map adopted by the Supreme Court of Virginia in December 2021, the same lines as 2024. The April 2026 redistricting referendum was voided by that court on May 8, 2026, and the U.S. Supreme Court declined emergency relief on May 15. 2018 used the 2016 court-ordered map. VA-05 lost Brunswick, Franklin County, Greene, Madison, Rappahannock and parts of Fauquier and Henry, and gained Amelia, Amherst, Goochland, Louisa, Lynchburg, Nottoway, Powhatan and part of Hanover; VA-09 gained Franklin County, the rest of Henry and part of Bedford, and lost Alleghany, Covington and Salem. Localities split between districts (Albemarle, Bedford and Hanover for VA-05; Bedford and Roanoke County for VA-09 today; Bedford, Henry, Fauquier and Roanoke County in 2018) cannot be compared at the locality level. The comparable-geography set is the localities wholly inside the district under both maps: 14 for VA-05 and 24 for VA-09.
        </p>
      </Details>
      <Details summary="Update engine and limits">
        <p>
          A GitHub Actions workflow runs every 5 minutes inside the election-night window ({ELECTION_NIGHT_WINDOW.start} to {ELECTION_NIGHT_WINDOW.end}) and every 2 hours otherwise, plus on demand. It fetches every source with 10-second timeouts and up to two jittered retries, validates each output against a schema, keeps the previous file when a new one fails, and pushes compact JSON to the public <code>data</code> branch with the built-in token. This page polls those files every 60 seconds. Scheduled Actions can be delayed or skipped under load, are disabled after 60 days of repository inactivity, and the raw-file CDN adds up to 5 minutes of caching. The data branch is excluded from deployments, so refreshes never rebuild the site.
        </p>
      </Details>
    </Card>
  );
}
