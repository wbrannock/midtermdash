import { POLYMARKET_CLOB, POLYMARKET_GAMMA, type MarketSubject, type PolymarketContract } from "@/lib/registry";
import type { ContractQuote, SourceStatus } from "@/lib/schema";
import { midpoint, round4 } from "@/lib/consensus";
import { getJson, mapLimit, nowIso } from "../http";

/* ---- Gamma shapes (only the fields we read) ---- */
export interface GammaMarket {
  id: string;
  question?: string;
  groupItemTitle?: string;
  outcomes?: string; // JSON-encoded string array
  outcomePrices?: string | null; // JSON-encoded string array
  clobTokenIds?: string; // JSON-encoded string array
  bestBid?: number | null;
  bestAsk?: number | null;
  lastTradePrice?: number | null;
  liquidity?: string | number | null;
  volume?: string | number | null;
  spread?: number | null;
  active?: boolean;
  closed?: boolean;
  conditionId?: string;
}
export interface GammaEvent {
  id: string;
  slug: string;
  title?: string;
  markets: GammaMarket[];
}
export interface ClobBook {
  bids?: { price: string; size: string }[];
  asks?: { price: string; size: string }[];
}
export interface DataApiTrade {
  timestamp: number;
  price: number;
  token_id?: string;
}

/** Most recent trade on the YES token (the feed interleaves YES and NO trades). Exported for tests. */
export function pickYesTrade(trades: DataApiTrade[], yesTokenId: string): DataApiTrade | null {
  const mine = trades.filter((t) => t.token_id === yesTokenId && Number.isFinite(t.timestamp) && Number.isFinite(t.price));
  if (!mine.length) return null;
  return mine.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
}

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Pick the market inside an event matching the contract. Exported for tests. */
export function resolveMarket(ev: GammaEvent, c: PolymarketContract): GammaMarket | null {
  const active = ev.markets.filter((m) => m.active !== false);
  const want = c.groupItemTitle.toLowerCase();
  const byTitle = active.find((m) => (m.groupItemTitle ?? "").toLowerCase() === want);
  if (byTitle) return byTitle;
  const byQuestion = active.find((m) => (m.question ?? "").toLowerCase().includes(want));
  if (byQuestion) return byQuestion;
  return ev.markets.find((m) => m.id === c.marketId) ?? null;
}

/** Best bid is the highest bid; best ask the lowest ask. Order-independent. */
export function bestOfBook(book: ClobBook): { bid: number | null; ask: number | null } {
  const bids = (book.bids ?? []).map((l) => Number(l.price)).filter(Number.isFinite);
  const asks = (book.asks ?? []).map((l) => Number(l.price)).filter(Number.isFinite);
  return { bid: bids.length ? Math.max(...bids) : null, ask: asks.length ? Math.min(...asks) : null };
}

export function quoteFromParts(
  c: PolymarketContract,
  m: GammaMarket | null,
  book: ClobBook | null,
  lastTrade: DataApiTrade | null,
  fetchedAt: string,
  subjectLabel: string,
): ContractQuote {
  const tokens = parseJsonArray(m?.clobTokenIds);
  const tokenId = tokens[0] ?? c.yesTokenId;
  const fromBook = book ? bestOfBook(book) : { bid: null, ask: null };
  const bid = fromBook.bid ?? m?.bestBid ?? null;
  const ask = fromBook.ask ?? m?.bestAsk ?? null;
  const mid = midpoint(bid, ask);
  const last = lastTrade?.price ?? m?.lastTradePrice ?? null;
  return {
    venue: "polymarket",
    party: c.party,
    id: m?.id ?? c.marketId,
    tokenId,
    label: `${subjectLabel} · ${c.groupItemTitle}`,
    question: m?.question,
    bid,
    ask,
    mid,
    last: last != null ? round4(last) : null,
    spread: bid != null && ask != null ? round4(ask - bid) : null,
    liquidity: m?.liquidity != null ? Number(m.liquidity) : null,
    volume: m?.volume != null ? Number(m.volume) : null,
    lastTradeAt: lastTrade ? new Date(lastTrade.timestamp * 1000).toISOString() : null,
    fetchedAt,
    sourceUrl: `https://polymarket.com/event/${c.eventSlug}`,
    status: m && book ? "ok" : "error",
    error: !m ? "market not found in event" : !book ? "order book unavailable" : undefined,
    flags: [],
  };
}

export async function fetchPolymarket(subjects: MarketSubject[]): Promise<{ quotes: ContractQuote[]; sources: Record<string, SourceStatus> }> {
  const sources: Record<string, SourceStatus> = {};
  const contracts = subjects.flatMap((s) =>
    s.contracts.filter((c): c is PolymarketContract => c.venue === "polymarket").map((c) => ({ c, label: s.label })),
  );
  const slugs = [...new Set(contracts.map((x) => x.c.eventSlug))];
  const events = new Map<string, GammaEvent | null>();
  await mapLimit(slugs, 3, async (slug) => {
    const url = `${POLYMARKET_GAMMA}/events?slug=${encodeURIComponent(slug)}`;
    const r = await getJson<GammaEvent[]>(url);
    const fetchedAt = nowIso();
    const ev = r.ok && Array.isArray(r.data) ? (r.data[0] ?? null) : null;
    events.set(slug, ev);
    sources[`polymarket:gamma:${slug}`] = {
      ok: r.ok && !!ev,
      url,
      httpStatus: r.status,
      durationMs: r.durationMs,
      error: r.ok ? (ev ? null : "empty event list") : r.error,
      fetchedAt,
      lastSuccessAt: r.ok && ev ? fetchedAt : null,
    };
  });

  const quotes = await mapLimit(contracts, 4, async ({ c, label }) => {
    const ev = events.get(c.eventSlug) ?? null;
    const m = ev ? resolveMarket(ev, c) : null;
    const tokenId = parseJsonArray(m?.clobTokenIds)[0] ?? c.yesTokenId;
    const bookUrl = `${POLYMARKET_CLOB}/book?token_id=${tokenId}`;
    const bookRes = await getJson<ClobBook>(bookUrl);
    const fetchedAt = nowIso();
    sources[`polymarket:clob:${c.eventSlug}:${c.party}`] = {
      ok: bookRes.ok,
      url: bookUrl,
      httpStatus: bookRes.status,
      durationMs: bookRes.durationMs,
      error: bookRes.ok ? null : bookRes.error,
      fetchedAt,
      lastSuccessAt: bookRes.ok ? fetchedAt : null,
    };
    let lastTrade: DataApiTrade | null = null;
    if (m?.conditionId) {
      // The trade feed covers both outcome tokens of the condition; keep only YES-token trades.
      const tr = await getJson<{ data?: DataApiTrade[] }>(
        `https://data-api.polymarket.com/v2/trades?conditionId=${m.conditionId}&limit=10`,
        { retries: 1 },
      );
      if (tr.ok && Array.isArray(tr.data?.data)) lastTrade = pickYesTrade(tr.data.data, tokenId);
    }
    return quoteFromParts(c, m, bookRes.ok ? bookRes.data : null, lastTrade, fetchedAt, label);
  });
  return { quotes, sources };
}
