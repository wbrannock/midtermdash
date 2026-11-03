import type { MarketSubjectSnapshot } from "@/lib/schema";
import { Flags } from "@/components/common/Flag";
import { ago, pct, usd } from "@/lib/format";

const VENUE_LABEL = { polymarket: "Polymarket", kalshi: "Kalshi" } as const;
const VENUE_COLOR = { polymarket: "var(--color-poly)", kalshi: "var(--color-kalshi)" } as const;

/** Per-contract quotes for one subject, grouped by venue. */
export function MarketTable({ subject, now }: { subject: MarketSubjectSnapshot; now: number }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Contract</th>
          <th className="r">Bid</th>
          <th className="r">Ask</th>
          <th className="r">Mid</th>
          <th className="r">Last</th>
          <th className="r">Spread</th>
          <th className="r">Liquidity</th>
          <th className="r">Last trade</th>
          <th>Flags</th>
        </tr>
      </thead>
      <tbody>
        {subject.contracts.map((c) => (
          <tr key={`${c.venue}-${c.id}`}>
            <td>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: VENUE_COLOR[c.venue] }} aria-hidden />
                <span>
                  {VENUE_LABEL[c.venue]} <span className="text-fg-3">{c.party === "D" ? "Democratic wins" : c.party === "R" ? "Republican wins" : c.party}</span>
                </span>
                <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-fg-3 underline decoration-line-strong hover:text-fg-2" title={c.question ?? c.id}>
                  {c.venue === "kalshi" ? c.id : "market"}
                </a>
              </span>
            </td>
            <td className="r">{pct(c.bid)}</td>
            <td className="r">{pct(c.ask)}</td>
            <td className="r font-medium text-fg">{pct(c.mid)}</td>
            <td className="r">{pct(c.last)}</td>
            <td className="r">{c.spread == null ? "–" : `${(c.spread * 100).toFixed(1)} pt`}</td>
            <td className="r" title={c.venue === "kalshi" ? "Open interest (USD notional)" : "Gamma liquidity (USD)"}>
              {usd(c.liquidity)}
            </td>
            <td className="r" title={c.lastTradeAt ?? ""}>
              {ago(c.lastTradeAt, now)}
            </td>
            <td>
              <Flags codes={c.flags} />
              {c.status === "error" && c.error ? <span className="ml-1 text-[11px] text-fg-3">{c.error}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VenueSummary({ subject }: { subject: MarketSubjectSnapshot }) {
  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      {subject.venues.map((v) => (
        <div key={v.venue}>
          <dt className="flex items-center gap-1.5 text-xs text-fg-3">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: VENUE_COLOR[v.venue] }} aria-hidden />
            {VENUE_LABEL[v.venue]}
          </dt>
          <dd className="num text-base font-medium">
            {pct(v.pDem)}
            {!v.usable ? (
              <span className="ml-1 text-xs font-normal text-serious" title={v.reason}>
                excluded
              </span>
            ) : null}
          </dd>
        </div>
      ))}
      <div>
        <dt className="text-xs text-fg-3">Consensus</dt>
        <dd className="num text-base font-semibold text-fg">
          {pct(subject.consensus.pDem)}
          {subject.consensus.band ? (
            <span className="ml-1 text-xs font-normal text-fg-3">
              {pct(subject.consensus.band.lo, 0)}–{pct(subject.consensus.band.hi, 0)}
            </span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}
