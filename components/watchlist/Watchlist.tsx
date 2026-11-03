"use client";
import { useMemo, useState } from "react";
import type { HistorySnapshot, MarketSubjectSnapshot } from "@/lib/schema";
import { Flags } from "@/components/common/Flag";
import { pct, usd } from "@/lib/format";

type Col = "label" | "consensus" | "polymarket" | "kalshi" | "gap" | "spread" | "liquidity" | "delta24h";

interface Row {
  id: string;
  label: string;
  kind: string;
  consensus: number | null;
  polymarket: number | null;
  kalshi: number | null;
  gap: number | null;
  spread: number | null;
  liquidity: number | null;
  delta24h: number | null;
  flags: MarketSubjectSnapshot["flags"];
}

function valueAt(history: HistorySnapshot | null, id: string, tSec: number): number | null {
  const pts = history?.series[id];
  if (!pts?.length) return null;
  let best: number | null = null;
  for (const p of pts) {
    if (p[0] <= tSec) best = p[3];
    else break;
  }
  return best;
}

export function Watchlist({ subjects, history, now }: { subjects: MarketSubjectSnapshot[]; history: HistorySnapshot | null; now: number }) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "gap", dir: -1 });
  const rows = useMemo<Row[]>(
    () =>
      subjects.map((s) => {
        const poly = s.venues.find((v) => v.venue === "polymarket")?.pDem ?? null;
        const kalshi = s.venues.find((v) => v.venue === "kalshi")?.pDem ?? null;
        const spreads = s.contracts.map((c) => c.spread).filter((x): x is number => x != null);
        const liqs = s.contracts.map((c) => c.liquidity).filter((x): x is number => x != null);
        const then = valueAt(history, s.id, now / 1000 - 86400);
        return {
          id: s.id,
          label: s.label,
          kind: s.kind,
          consensus: s.consensus.pDem,
          polymarket: poly,
          kalshi,
          gap: poly != null && kalshi != null ? Math.abs(poly - kalshi) : null,
          spread: spreads.length ? Math.max(...spreads) : null,
          liquidity: liqs.length ? Math.min(...liqs) : null,
          delta24h: then != null && s.consensus.pDem != null ? s.consensus.pDem - then : null,
          flags: s.flags,
        };
      }),
    [subjects, history, now],
  );
  const sorted = useMemo(() => {
    const v = (r: Row) => (sort.col === "label" ? r.label : (r[sort.col] ?? -Infinity));
    return [...rows].sort((a, b) => (v(a) < v(b) ? -sort.dir : v(a) > v(b) ? sort.dir : 0));
  }, [rows, sort]);
  const th = (col: Col, label: string, right = true) => (
    <th className={right ? "r" : ""} aria-sort={sort.col === col ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="hover:text-fg-2" onClick={() => setSort((s) => ({ col, dir: s.col === col ? ((s.dir * -1) as 1 | -1) : -1 }))}>
        {label}
        {sort.col === col ? <span className="ml-1 text-fg-3">{sort.dir === 1 ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
  const pt = (x: number | null, signed = false) => (x == null ? "–" : `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}`);
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="data">
        <thead>
          <tr>
            {th("label", "Market", false)}
            {th("consensus", "P(D) consensus")}
            {th("polymarket", "Polymarket")}
            {th("kalshi", "Kalshi")}
            {th("gap", "Gap (pt)")}
            {th("delta24h", "24h Δ (pt)")}
            {th("spread", "Max spread (pt)")}
            {th("liquidity", "Min liquidity")}
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={`#${r.id}`} className="hover:underline">
                  {r.label}
                </a>
                <span className="ml-2 text-[11px] text-fg-3">{r.kind}</span>
              </td>
              <td className="r font-medium text-fg">{pct(r.consensus)}</td>
              <td className="r">{pct(r.polymarket)}</td>
              <td className="r">{pct(r.kalshi)}</td>
              <td className={`r ${r.gap != null && r.gap >= 0.03 ? "text-warn" : ""}`}>{pt(r.gap)}</td>
              <td className="r">{pt(r.delta24h, true)}</td>
              <td className={`r ${r.spread != null && r.spread > 0.05 ? "text-warn" : ""}`}>{pt(r.spread)}</td>
              <td className={`r ${r.liquidity != null && r.liquidity < 10_000 ? "text-warn" : ""}`}>{usd(r.liquidity)}</td>
              <td>
                <Flags codes={r.flags} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
