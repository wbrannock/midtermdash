import type { Baselines, MarketSubjectSnapshot, RaceResult } from "@/lib/schema";
import { WATCHED_RACES } from "@/lib/registry";
import { Card, Details, Empty } from "@/components/common/Section";
import { Flags } from "@/components/common/Flag";
import { Needle } from "@/components/needle/Needle";
import { MarketTable, VenueSummary } from "@/components/markets/MarketTable";
import { ResultsBlock } from "./ResultsBlock";
import { HistoricalComparison } from "./HistoricalComparison";
import { EarlyVotePanel } from "./EarlyVotePanel";
import { num, pct } from "@/lib/format";

/** Surname for compact labels: drops generational suffixes ("John J. McGuire III" → "McGuire"). */
function surname(name: string | undefined): string {
  if (!name) return "";
  const parts = name.split(/\s+/).filter((t) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(t));
  return parts.at(-1) ?? name;
}

export function RacePanel({ subject, result, baselines, now }: { subject: MarketSubjectSnapshot | null; result: RaceResult | null; baselines: Baselines; now: number }) {
  const reg = WATCHED_RACES.find((r) => r.id === (subject?.id ?? result?.id));
  const title = reg?.label ?? subject?.label ?? result?.label ?? "Race";
  const dem = reg?.candidates.find((c) => c.party === "D")?.name;
  const rep = reg?.candidates.find((c) => c.party === "R")?.name;
  const c2024 = reg?.state === "VA" ? baselines.contests.find((c) => c.race === reg.id && c.year === 2024) : null;
  const ticks = subject?.venues.filter((v) => v.pDem != null).map((v) => ({ label: v.venue, value: v.pDem as number, color: v.venue === "polymarket" ? "var(--color-poly)" : "var(--color-kalshi)" })) ?? [];
  return (
    <Card className="scroll-mt-20" >
      <div id={reg?.id} className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-sm text-fg-2">
          {dem} (D) vs {rep} (R)
          {reg?.candidates.filter((c) => c.party !== "D" && c.party !== "R").length ? <span className="text-fg-3"> and others</span> : null}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-line lg:border-r lg:pr-6">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium">Markets</h4>
            <span className="text-xs text-fg-3">P(Democrat wins)</span>
          </div>
          {subject ? (
            <>
              <div className="mx-auto mt-2 w-full max-w-[260px]">
                <Needle pDem={subject.consensus.pDem} band={subject.consensus.band} ticks={ticks} compact />
              </div>
              <div className="-mt-1 flex items-end justify-between text-sm">
                <span className="num text-fg-2">{surname(rep)} {subject.consensus.pDem == null ? "–" : pct(1 - subject.consensus.pDem, 0)}</span>
                <span className="num text-fg-2">{surname(dem)} {pct(subject.consensus.pDem, 0)}</span>
              </div>
              <div className="mt-3">
                <VenueSummary subject={subject} />
              </div>
              {subject.flags.length ? (
                <div className="mt-2">
                  <Flags codes={subject.flags} />
                </div>
              ) : null}
              <div className="mt-2">
                <Details summary="Contracts">
                  <div className="overflow-x-auto">
                    <MarketTable subject={subject} now={now} />
                  </div>
                </Details>
              </div>
              <p className="mt-2 text-xs text-fg-3">Market prices already incorporate the returns on the right; they are not an independent forecast of them.</p>
            </>
          ) : (
            <Empty>No market data loaded for this race.</Empty>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium">Counted results</h4>
            <span className="text-xs text-fg-3">official feed</span>
          </div>
          <div className="mt-2">{result ? <ResultsBlock r={result} now={now} /> : <Empty>No results snapshot loaded.</Empty>}</div>
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-sm font-medium">Pre-election early vote and absentee statistics</h4>
            <p className="mb-2 text-xs text-fg-3">Separate from counted ballots above. These are applications and check-ins recorded before election day.</p>
            <EarlyVotePanel ev={result?.earlyVote ?? null} registered={result?.turnout.registered ?? null} baselineVotes={c2024 ? { year: 2024, total: c2024.totalVotes } : null} />
          </div>
        </div>
      </div>
      {result && reg?.state === "VA" ? (
        <div className="mt-6 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium">2026 vs 2024 and 2018</h4>
            <span className="text-xs text-fg-3">official final results, bundled</span>
          </div>
          <div className="mt-2">
            <HistoricalComparison live={result} baselines={baselines} />
          </div>
        </div>
      ) : null}
      {result && reg?.state === "TX" && result.localities.length ? (
        <div className="mt-6 border-t border-line pt-4">
          <Details summary={`County detail (${result.localities.length} counties)`}>
            <TexasCountyTable r={result} />
          </Details>
        </div>
      ) : null}
    </Card>
  );
}

function TexasCountyTable({ r }: { r: RaceResult }) {
  const rows = [...r.localities].sort((a, b) => b.total - a.total);
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="data">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th>County</th>
            <th className="r">Precincts</th>
            <th className="r">D</th>
            <th className="r">R</th>
            <th className="r">Total</th>
            <th className="r">D−R</th>
            <th className="r">Registered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const d = l.candidates.filter((c) => c.party === "D").reduce((a, c) => a + c.votes, 0);
            const rr = l.candidates.filter((c) => c.party === "R").reduce((a, c) => a + c.votes, 0);
            return (
              <tr key={l.name} className={l.complete ? "" : "text-fg-2"}>
                <td>{l.name}</td>
                <td className="r">
                  {l.precinctsReporting ?? "–"}/{l.precinctsTotal ?? "–"}
                </td>
                <td className="r">{num(d)}</td>
                <td className="r">{num(rr)}</td>
                <td className="r">{num(l.total)}</td>
                <td className="r">{l.total ? `${(((d - rr) / l.total) * 100).toFixed(1)}` : "–"}</td>
                <td className="r">{num(l.registered)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
