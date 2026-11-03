import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKET_SUBJECTS, WATCHED_RACES, type PolymarketContract } from "@/lib/registry";
import { ContractQuoteSchema, RaceResultSchema } from "@/lib/schema";
import { bestOfBook, pickYesTrade, quoteFromParts, resolveMarket, type GammaEvent } from "@/pipeline/adapters/polymarket";
import { quoteFromMarket, type KalshiMarket } from "@/pipeline/adapters/kalshi";
import { buildRaceResult, summarizeAbsentee, titleCaseLocality, type EnrBallotItem, type EnrMeta, type EnrVr } from "@/pipeline/adapters/va-enr";
import { buildTexasResult, decodeB64Json, findEvDates, parseCentralTime, summarizeEarlyVoting, type TxCounty, type TxEarlyVoting, type TxHome, type TxRace } from "@/pipeline/adapters/tx-civix";
import { parseCsv } from "@/pipeline/csv";

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

describe("polymarket adapter", () => {
  const house = MARKET_SUBJECTS.find((s) => s.id === "house")!;
  const demContract = house.contracts.find((c) => c.venue === "polymarket" && c.party === "D") as PolymarketContract;
  const event: GammaEvent = fx("polymarket_event_house.json")[0];

  it("resolves the market by groupItemTitle and ignores inactive placeholder markets", () => {
    const m = resolveMarket(event, demContract)!;
    expect(m.id).toBe("562802");
    expect(m.active).toBe(true);
    expect(resolveMarket(event, { ...demContract, groupItemTitle: "Party A", marketId: "nope" })).toBeNull();
  });
  it("double-parses clobTokenIds and takes best bid = max bid, best ask = min ask", () => {
    const book = fx("polymarket_book.json");
    const best = bestOfBook(book);
    expect(best.bid).toBeGreaterThan(0.5);
    expect(best.ask).toBeGreaterThan(best.bid!);
    const quote = quoteFromParts(demContract, resolveMarket(event, demContract), book, { timestamp: 1793731842, price: 0.95 }, "2026-11-03T19:00:00Z", "House");
    expect(quote.tokenId).toBe(demContract.yesTokenId);
    expect(quote.mid).toBeCloseTo((best.bid! + best.ask!) / 2, 6);
    expect(quote.lastTradeAt).toBe("2026-11-03T18:50:42.000Z");
    expect(ContractQuoteSchema.safeParse(quote).success).toBe(true);
  });
  it("marks the quote as error when the book is missing", () => {
    const quote = quoteFromParts(demContract, resolveMarket(event, demContract), null, null, "2026-11-03T19:00:00Z", "House");
    expect(quote.status).toBe("error");
    expect(quote.mid).not.toBeNull(); // falls back to Gamma bestBid/bestAsk
  });
  it("keeps only YES-token trades from the interleaved trade feed", () => {
    const t = pickYesTrade([{ timestamp: 10, price: 0.95, token_id: "no" }, { timestamp: 5, price: 0.06, token_id: "yes" }, { timestamp: 7, price: 0.05, token_id: "yes" }], "yes");
    expect(t).toEqual({ timestamp: 7, price: 0.05, token_id: "yes" });
    expect(pickYesTrade([{ timestamp: 1, price: 0.5, token_id: "no" }], "yes")).toBeNull();
  });
});

describe("kalshi adapter", () => {
  const house = MARKET_SUBJECTS.find((s) => s.id === "house")!;
  const c = house.contracts.find((x) => x.venue === "kalshi" && x.party === "D")!;
  it("reads dollar-string fields and derives the ask from the NO bid when needed", () => {
    const m: KalshiMarket = fx("kalshi_market.json").market;
    const q = quoteFromMarket(c as never, m, { created_time: "2026-11-03T18:55:26Z", yes_price_dollars: "0.9330" }, "2026-11-03T19:00:00Z", "House");
    expect(q.bid).toBe(0.93);
    expect(q.ask).toBe(0.931);
    expect(q.mid).toBe(0.9305);
    expect(q.liquidity).toBeCloseTo(21785932.81);
    expect(q.last).toBe(0.933);
    const noDirect = quoteFromMarket(c as never, { ...m, yes_ask_dollars: null }, null, "t", "House");
    expect(noDirect.ask).toBe(0.931); // 1 − no_bid 0.069
    expect(ContractQuoteSchema.safeParse(q).success).toBe(true);
  });
});

describe("virginia ENR adapter", () => {
  const meta: EnrMeta = fx("va_meta.json");
  const item: EnrBallotItem = fx("va_contest_va05.json");
  const vr: EnrVr = fx("va_vr.json");
  const race = WATCHED_RACES.find((r) => r.id === "va-05")!;
  it("builds a schema-valid race result with locality reporting detail", () => {
    const r = buildRaceResult(race, meta, item, vr, null, { total: 626743, source: "test" }, "2026-11-03T19:00:00Z");
    expect(RaceResultSchema.safeParse(r).success).toBe(true);
    expect(r.candidates.map((c) => c.party)).toEqual(["D", "R", "I", "O"]);
    expect(r.reporting.unitsTotal).toBe(24);
    expect(r.reporting.complete).toBe(false);
    expect(r.localities[0].name).toBe("Albemarle County");
    expect(r.localities[0].precinctsTotal).toBe(30);
    expect(r.localities[0].registered).toBeGreaterThan(50000);
    expect(r.countGroups?.map((g) => g.name)).toContain("Early Voting");
    expect(r.turnout.registered).toBe(626743);
  });
  it("title-cases locality names to match historical CSVs", () => {
    expect(titleCaseLocality("PRINCE EDWARD COUNTY")).toBe("Prince Edward County");
    expect(titleCaseLocality("CHARLOTTESVILLE CITY")).toBe("Charlottesville City");
  });
  it("summarizes the absentee CSV by district, separating returned vs outstanding", () => {
    const csv = ["LocalityName,CongressionalDistrict,AgeRange,Gender,Reason,ApplicationType,ReceiptType,TheCount", "ALBEMARLE COUNTY,5,18-24,F,x,y,In Person,10", "ALBEMARLE COUNTY,5,18-24,F,x,y,Mail,3", "ALBEMARLE COUNTY,5,18-24,F,x,y,,2", "BRISTOL CITY,9,18-24,F,x,y,In Person,7"].join("\n");
    const ev = summarizeAbsentee(parseCsv(csv), 5, null, "u");
    expect(ev.totals).toEqual({ returned: 13, inPerson: 10, mail: 3, outstanding: 2, registered: null });
    expect(ev.byLocality).toEqual([{ name: "Albemarle County", inPerson: 10, mail: 3, returned: 13, registered: null }]);
  });
});

describe("texas civix adapter", () => {
  const el = fx("tx_election.json");
  const home = decodeB64Json<TxHome>(el.Home)!;
  const fed = decodeB64Json<{ Races: TxRace[] }>(el.Federal)!;
  const counties = decodeB64Json<Record<string, TxCounty>>(fx("tx_county.json").upload)!;
  const race = WATCHED_RACES.find((r) => r.id === "tx-sen")!;
  it("decodes base64 blobs and finds the Senate race", () => {
    expect(home.CountiesReporting?.CT).toBe(254);
    expect(fed.Races[0].id).toBe(5075);
  });
  it("builds a schema-valid result with early/election-day split and county registration", () => {
    const r = buildTexasResult(race, home, fed.Races[0], counties, null, "2026-11-03T19:00:00Z");
    expect(RaceResultSchema.safeParse(r).success).toBe(true);
    expect(r.candidates.find((c) => c.party === "R")?.name).toBe("Ken Paxton");
    expect(r.candidates.find((c) => c.party === "D")?.name).toBe("James Talarico");
    expect(r.reporting.unitKind).toBe("county");
    expect(r.reporting.unitsTotal).toBe(254);
    expect(r.localities).toHaveLength(3);
    expect(r.localities[0].registered).toBeGreaterThan(0);
    expect(r.countGroups?.map((g) => g.name)).toEqual(["Early voting", "Election day"]);
  });
  it("converts the SOS Central-time stamp to UTC with DST awareness", () => {
    expect(parseCentralTime("Oct 29, 2026 22:13:17")).toBe("2026-10-30T03:13:17.000Z"); // CDT (UTC−5)
    expect(parseCentralTime("Nov 3, 2026 20:00:00")).toBe("2026-11-04T02:00:00.000Z"); // CST (UTC−6)
    expect(parseCentralTime("garbage")).toBeNull();
  });
  it("summarizes early voting and finds EV dates for the election", () => {
    const ev = decodeB64Json<TxEarlyVoting>(fx("tx_early_voting.json").upload)!;
    const s = summarizeEarlyVoting(ev, "u");
    expect(s.totals.registered).toBeGreaterThan(0);
    expect(s.totals.returned).toBe((s.totals.inPerson ?? 0) + (s.totals.mail ?? 0));
    expect(findEvDates({ elections: [{ id: 53815, election_date: "11/03/2026", early_voting_dates: [{ date: "10/30/2026" }, { date: "10/19/2026" }] }] }, 53815)).toEqual(["10/19/2026", "10/30/2026"]);
    expect(findEvDates({ elections: [{ id: 1, early_voting_dates: [{ date: "10/30/2026" }] }] }, 53815)).toEqual([]);
  });
});
