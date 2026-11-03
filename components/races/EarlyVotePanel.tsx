import type { EarlyVoteStats } from "@/lib/schema";
import { num, pct } from "@/lib/format";

export function EarlyVotePanel({ ev, registered, baselineVotes }: { ev: EarlyVoteStats | null; registered: number | null; baselineVotes?: { year: number; total: number } | null }) {
  if (!ev) return <p className="text-sm text-fg-3">No pre-election early-vote statistics available for this race.</p>;
  const reg = ev.totals.registered ?? registered;
  const returned = ev.totals.returned;
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-3">{ev.kind === "va-absentee-applications" ? "Ballots returned" : "Early ballots cast"}</dt>
          <dd className="num font-medium">{num(returned)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">In person</dt>
          <dd className="num font-medium">{num(ev.totals.inPerson)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Mail / drop-off</dt>
          <dd className="num font-medium">{num(ev.totals.mail)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">{ev.totals.outstanding != null ? "Requested, not returned" : "Share of registered"}</dt>
          <dd className="num font-medium">{ev.totals.outstanding != null ? num(ev.totals.outstanding) : pct(reg && returned != null ? returned / reg : null)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-fg-3">
        {reg && returned != null ? <span className="num">{pct(returned / reg)} of {num(reg)} registered. </span> : null}
        {baselineVotes && returned != null ? <span className="num">Equivalent to {pct(returned / baselineVotes.total, 0)} of all {baselineVotes.year} votes in this contest. </span> : null}
        {ev.note} As of {ev.asOf ?? "–"}.{" "}
        <a className="underline decoration-line-strong hover:text-fg-2" href={ev.sourceUrl} target="_blank" rel="noreferrer">
          source
        </a>
      </p>
    </div>
  );
}
