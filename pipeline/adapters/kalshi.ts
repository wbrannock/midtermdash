import { KALSHI_API, type KalshiContract, type MarketSubject } from "@/lib/registry";
import type { ContractQuote, SourceStatus } from "@/lib/schema";
import { midpoint, round4 } from "@/lib/consensus";
import { getJson, mapLimit, nowIso } from "../http";

/** Only the fields we read. Prices are dollar strings; integer-cent fields are null in the current API. */
export interface KalshiMarket {
  ticker: string;
  title?: string;
  yes_sub_title?: string;
  status?: string;
  yes_bid_dollars?: string | null;
  yes_ask_dollars?: string | null;
  no_bid_dollars?: string | null;
  no_ask_dollars?: string | null;
  last_price_dollars?: string | null;
  volume_fp?: string | null;
  open_interest_fp?: string | null;
  close_time?: string;
  rules_primary?: string;
  result?: string;
}
export interface KalshiTrade {
  created_time: string;
  yes_price_dollars?: string;
}

function num(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function quoteFromMarket(
  c: KalshiContract,
  m: KalshiMarket | null,
  lastTrade: KalshiTrade | null,
  fetchedAt: string,
  subjectLabel: string,
  error?: string,
): ContractQuote {
  const bid = num(m?.yes_bid_dollars);
  // YES ask falls back to 1 − NO bid when the direct field is absent.
  const noBid = num(m?.no_bid_dollars);
  const ask = num(m?.yes_ask_dollars) ?? (noBid != null ? round4(1 - noBid) : null);
  const mid = midpoint(bid, ask);
  const last = num(lastTrade?.yes_price_dollars) ?? num(m?.last_price_dollars);
  return {
    venue: "kalshi",
    party: c.party,
    id: c.ticker,
    label: `${subjectLabel} · ${m?.yes_sub_title ?? c.ticker}`,
    question: m?.title,
    bid,
    ask,
    mid,
    last: last != null ? round4(last) : null,
    spread: bid != null && ask != null ? round4(ask - bid) : null,
    liquidity: num(m?.open_interest_fp),
    volume: num(m?.volume_fp),
    lastTradeAt: lastTrade?.created_time ?? null,
    fetchedAt,
    sourceUrl: `https://kalshi.com/markets/${c.ticker.split("-")[0].toLowerCase()}`,
    status: m ? "ok" : "error",
    error: m ? undefined : (error ?? "market unavailable"),
    flags: [],
  };
}

export async function fetchKalshi(subjects: MarketSubject[]): Promise<{ quotes: ContractQuote[]; sources: Record<string, SourceStatus> }> {
  const sources: Record<string, SourceStatus> = {};
  const contracts = subjects.flatMap((s) =>
    s.contracts.filter((c): c is KalshiContract => c.venue === "kalshi").map((c) => ({ c, label: s.label })),
  );
  const quotes = await mapLimit(contracts, 4, async ({ c, label }) => {
    const url = `${KALSHI_API}/markets/${encodeURIComponent(c.ticker)}`;
    const r = await getJson<{ market?: KalshiMarket }>(url);
    const fetchedAt = nowIso();
    const m = r.ok ? (r.data.market ?? null) : null;
    sources[`kalshi:market:${c.ticker}`] = {
      ok: r.ok && !!m,
      url,
      httpStatus: r.status,
      durationMs: r.durationMs,
      error: r.ok ? (m ? null : "missing market object") : r.error,
      fetchedAt,
      lastSuccessAt: r.ok && m ? fetchedAt : null,
    };
    let lastTrade: KalshiTrade | null = null;
    if (m) {
      const tr = await getJson<{ trades?: KalshiTrade[] }>(
        `${KALSHI_API}/markets/trades?ticker=${encodeURIComponent(c.ticker)}&limit=1`,
        { retries: 1 },
      );
      if (tr.ok && Array.isArray(tr.data.trades) && tr.data.trades[0]) lastTrade = tr.data.trades[0];
    }
    return quoteFromMarket(c, m, lastTrade, fetchedAt, label, r.ok ? undefined : r.error);
  });
  return { quotes, sources };
}
