import type { RaceResult } from "@/lib/schema";
import { ago, clock, marginLabel, num, pct } from "@/lib/format";

const PARTY_COLOR: Record<string, string> = { D: "var(--color-dem)", R: "var(--color-rep)" };

export function ReportingBadge({ r }: { r: RaceResult }) {
  const rep = r.reporting;
  const tone = rep.complete ? "border-good/50 text-good" : rep.unitsReporting > 0 ? "border-warn/50 text-warn" : "border-line-strong text-fg-3";
  const label = rep.complete ? (r.source.isOfficial ? "official" : "all units fully reported") : rep.unitsReporting === 0 && (rep.precinctsReporting ?? 0) === 0 ? "no results yet" : "partial returns";
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none ${tone}`} title={rep.note}>
      {label}
    </span>
  );
}

export function ResultsBlock({ r, now }: { r: RaceResult; now: number }) {
  const main = r.candidates.filter((c) => c.party === "D" || c.party === "R");
  const other = r.candidates.filter((c) => !(c.party === "D" || c.party === "R"));
  const otherVotes = other.reduce((a, c) => a + c.votes, 0);
  const rep = r.reporting;
  const groups = r.countGroups?.filter((g) => g.votes > 0) ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <ReportingBadge r={r} />
        <span>
          {rep.unitsReporting}/{rep.unitsTotal} {rep.unitKind === "locality" ? "localities" : "counties"} reporting
          {rep.precinctsTotal ? ` · ${num(rep.precinctsReporting)}/${num(rep.precinctsTotal)} precincts` : ""}
        </span>
        {rep.fully != null && rep.unitKind === "locality" ? (
          <span>
            ({rep.fully} fully, {rep.partially} partially, {rep.notReported} not)
          </span>
        ) : null}
        {r.status !== "ok" ? <span className="text-serious">{r.status === "retained" ? "showing last valid fetch" : "unavailable"}: {r.error}</span> : null}
      </div>
      <div className="mt-3 space-y-2">
        {main.map((c) => (
          <div key={c.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PARTY_COLOR[c.party] }} aria-hidden />
              <span>{c.name}</span>
              <span className="text-xs text-fg-3">{c.party}</span>
            </div>
            <div className="num text-right text-sm">
              <span className="font-semibold text-fg">{pct(c.share)}</span>
              <span className="ml-2 text-fg-3">{num(c.votes)}</span>
            </div>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-surface-2">
              <div className="h-full rounded-sm" style={{ width: `${Math.max(0, (c.share ?? 0) * 100)}%`, background: PARTY_COLOR[c.party] }} />
            </div>
          </div>
        ))}
        {other.length ? (
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm text-fg-2">
            <span>
              Other ({other.map((c) => c.name).join(", ")})
            </span>
            <span className="num text-right">
              {pct(r.totalVotes ? otherVotes / r.totalVotes : null)} <span className="ml-2 text-fg-3">{num(otherVotes)}</span>
            </span>
          </div>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-3">D−R margin</dt>
          <dd className="num font-medium">{marginLabel(r.marginDR)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Votes counted</dt>
          <dd className="num font-medium">{num(r.totalVotes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Turnout so far</dt>
          <dd className="num font-medium" title={r.turnout.registeredSource ?? ""}>
            {r.turnout.rate == null ? "–" : pct(r.turnout.rate)} <span className="text-xs font-normal text-fg-3">of {num(r.turnout.registered)} registered</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Source updated</dt>
          <dd className="font-medium" title={r.source.asOf ?? ""}>
            {ago(r.source.asOf, now)} <span className="text-xs font-normal text-fg-3">{clock(r.source.asOf)}</span>
          </dd>
        </div>
      </dl>
      {groups.length ? (
        <div className="mt-3 text-xs text-fg-3">
          Counted by method:{" "}
          {groups.map((g, i) => (
            <span key={g.name} className="num">
              {i ? " · " : ""}
              {g.name} {num(g.votes)} ({pct(r.totalVotes ? g.votes / r.totalVotes : null, 0)})
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-fg-3">
        Counted votes from the {r.source.name}; unofficial until certified. Turnout here is votes in this contest ÷ registered voters, so it excludes ballots that skipped the race.{" "}
        <a className="underline decoration-line-strong hover:text-fg-2" href={r.source.url} target="_blank" rel="noreferrer">
          source
        </a>
      </p>
    </div>
  );
}
