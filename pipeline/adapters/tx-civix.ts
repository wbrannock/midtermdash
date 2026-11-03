import { TX_CIVIX_BASE, TX_ELECTION_ID, TX_SENATE_RACE_ID, type WatchedRace } from "@/lib/registry";
import type { EarlyVoteStats, LocalityResult, Party, RaceResult, SourceStatus } from "@/lib/schema";
import { marginDR, shares } from "@/lib/historical";
import { getJson, nowIso } from "../http";

/* ---- Civix ENR shapes (values are base64-encoded JSON) ---- */
export interface TxCandidate {
  ID?: number;
  id?: number;
  N: string;
  P: string;
  V: number;
  PE?: number;
  EV?: number;
}
export interface TxRace {
  id: number;
  N: string;
  Candidates: TxCandidate[];
  T: number;
}
export interface TxHome {
  ElecDate?: string;
  CountiesReporting?: { CR: number; CT: number };
  PrecinctsReporting?: { PR: number; PT: number };
  PollingReporting?: { PLR: number; PLT: number };
  LastUpdatedTime?: string;
}
export interface TxCountyRace {
  N: string;
  T: number;
  C: Record<string, TxCandidate>;
  PR?: number;
  TP?: number;
}
export interface TxCounty {
  N: string;
  TV?: number;
  Races?: Record<string, TxCountyRace>;
  Summary?: { RV?: number; VC?: number; VT?: number; PLR?: number; PLP?: number };
}
export interface TxEarlyVoting {
  date_updated?: string;
  early_voting_date?: string;
  turnout_by_county?: {
    name: string;
    id: number;
    registered_voters: number;
    in_person_votes_on_date: number;
    total_in_person_votes_for_election: number;
    total_mail_votes_for_election: number;
  }[];
}

export function decodeB64Json<T>(s: unknown): T | null {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function partyOf(p: string): Party {
  const u = (p ?? "").toUpperCase();
  if (u === "REP") return "R";
  if (u === "DEM") return "D";
  if (u === "LIB" || u === "L") return "L";
  if (u === "GRN") return "G";
  if (u === "IND") return "I";
  if (u === "W") return "W";
  return "O";
}

function niceName(n: string): string {
  return n
    .replace(/\s*\(I\)\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s"'(-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

/** "Oct 29, 2026 22:13:17" (America/Chicago) → ISO string, or null. */
export function parseCentralTime(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mo = months.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  const guess = Date.UTC(+m[3], mo, +m[2], +m[4], +m[5], +m[6]);
  // Determine Chicago's UTC offset at that instant (handles DST).
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" });
  const part = fmt.formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const off = part.match(/GMT([+-]\d+)/);
  const hours = off ? Number(off[1]) : -6;
  return new Date(guess - hours * 3600_000).toISOString();
}

export function buildTexasResult(
  race: WatchedRace,
  home: TxHome | null,
  senate: TxRace | null,
  counties: Record<string, TxCounty> | null,
  earlyVote: EarlyVoteStats | null,
  fetchedAt: string,
): RaceResult {
  const cands = (senate?.Candidates ?? []).map((c) => {
    const ev = c.EV ?? 0;
    return { name: niceName(c.N), party: partyOf(c.P), votes: c.V ?? 0, byGroup: { "Early voting": ev, "Election day": Math.max(0, (c.V ?? 0) - ev) } };
  });
  const candidates = shares(cands);
  const totalVotes = candidates.reduce((a, c) => a + c.votes, 0);
  const localities: LocalityResult[] = [];
  let registered = 0;
  let registeredCount = 0;
  let precinctsReporting = 0;
  let precinctsTotal = 0;
  if (counties) {
    for (const [id, c] of Object.entries(counties)) {
      const r = c.Races?.[String(TX_SENATE_RACE_ID)];
      if (!r) continue;
      const cc = Object.values(r.C ?? {}).map((x) => ({ party: partyOf(x.P), name: niceName(x.N), votes: x.V ?? 0 }));
      const tp = r.TP ?? null;
      const pr = r.PR ?? null;
      if (tp != null) precinctsTotal += tp;
      if (pr != null) precinctsReporting += pr;
      const reg = c.Summary?.RV != null ? Math.round(c.Summary.RV) : null;
      if (reg != null) {
        registered += reg;
        registeredCount++;
      }
      localities.push({
        name: niceName(c.N) + " County",
        fips: null,
        total: cc.reduce((a, x) => a + x.votes, 0),
        candidates: cc,
        precinctsReporting: pr,
        precinctsTotal: tp,
        fully: null,
        partially: null,
        notReported: null,
        complete: tp != null && tp > 0 && pr === tp,
        registered: reg,
      });
      void id;
    }
    localities.sort((a, b) => a.name.localeCompare(b.name));
  }
  const unitsTotal = home?.CountiesReporting?.CT ?? localities.length;
  const unitsReporting = home?.CountiesReporting?.CR ?? localities.filter((l) => (l.precinctsReporting ?? 0) > 0).length;
  const fully = localities.filter((l) => l.complete).length;
  const complete = unitsTotal > 0 && precinctsTotal > 0 && precinctsReporting >= precinctsTotal;
  const countGroups = [
    { name: "Early voting", votes: candidates.reduce((a, c) => a + (c.byGroup?.["Early voting"] ?? 0), 0) },
    { name: "Election day", votes: candidates.reduce((a, c) => a + (c.byGroup?.["Election day"] ?? 0), 0) },
  ];
  const regTotal = registeredCount > 0 ? registered : null;
  return {
    id: race.id,
    label: race.label,
    state: "TX",
    office: race.office,
    status: senate ? "ok" : "error",
    error: senate ? undefined : "U.S. Senate race not found in Federal block",
    source: {
      name: "Texas Secretary of State (election night returns)",
      url: race.sourceUrl,
      asOf: parseCentralTime(home?.LastUpdatedTime) ?? home?.LastUpdatedTime ?? null,
      fetchedAt,
      isOfficial: false,
    },
    candidates,
    totalVotes,
    marginDR: marginDR(candidates, totalVotes),
    reporting: {
      unitKind: "county",
      unitsReporting,
      unitsTotal,
      fully,
      partially: Math.max(0, unitsReporting - fully),
      notReported: Math.max(0, unitsTotal - unitsReporting),
      precinctsReporting,
      precinctsTotal,
      complete,
      note: "Counties reporting per the SOS; precinct counts summed from county detail. 'Complete' requires every precinct reporting; results stay unofficial until the canvass.",
    },
    countGroups,
    turnout: {
      ballotsCast: totalVotes,
      registered: regTotal,
      rate: regTotal && regTotal > 0 ? Math.round((totalVotes / regTotal) * 10000) / 10000 : null,
      registeredSource: regTotal ? "SOS county summary (RV), summed" : null,
    },
    localities,
    earlyVote,
  };
}

export function summarizeEarlyVoting(ev: TxEarlyVoting, sourceUrl: string): EarlyVoteStats {
  const rows = ev.turnout_by_county ?? [];
  const inPerson = rows.reduce((a, r) => a + (r.total_in_person_votes_for_election ?? 0), 0);
  const mail = rows.reduce((a, r) => a + (r.total_mail_votes_for_election ?? 0), 0);
  const registered = rows.reduce((a, r) => a + (r.registered_voters ?? 0), 0);
  return {
    kind: "tx-early-voting-turnout",
    asOf: ev.date_updated ?? null,
    sourceUrl,
    note: `Cumulative early-voting turnout through ${ev.early_voting_date ?? "the last reported day"} as published by the SOS (in-person + mail ballots received). Pre-election turnout statistics, not counted results.`,
    totals: { returned: inPerson + mail, inPerson, mail, outstanding: null, registered },
    byLocality: rows
      .map((r) => ({ name: niceName(r.name) + " County", inPerson: r.total_in_person_votes_for_election ?? null, mail: r.total_mail_votes_for_election ?? null, returned: (r.total_in_person_votes_for_election ?? 0) + (r.total_mail_votes_for_election ?? 0), registered: r.registered_voters ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchTexas(race: WatchedRace, previousEarlyVote: EarlyVoteStats | null): Promise<{ race: RaceResult | null; sources: Record<string, SourceStatus> }> {
  const sources: Record<string, SourceStatus> = {};
  const rec = (key: string, r: { ok: boolean; status: number | null; durationMs: number; url: string; error?: string }, fetchedAt: string, extraErr?: string) => {
    sources[key] = { ok: r.ok && !extraErr, url: r.url, httpStatus: r.status, durationMs: r.durationMs, error: r.ok ? (extraErr ?? null) : (r.error ?? "error"), fetchedAt, lastSuccessAt: r.ok && !extraErr ? fetchedAt : null };
  };
  const fetchedAt = nowIso();
  const elRes = await getJson<Record<string, unknown>>(`${TX_CIVIX_BASE}/api/s3/enr/election/${TX_ELECTION_ID}`, { timeoutMs: 20_000 });
  let home: TxHome | null = null;
  let senate: TxRace | null = null;
  if (elRes.ok) {
    home = decodeB64Json<TxHome>(elRes.data.Home);
    const fed = decodeB64Json<{ Races?: TxRace[] }>(elRes.data.Federal);
    senate = fed?.Races?.find((r) => r.id === TX_SENATE_RACE_ID) ?? fed?.Races?.find((r) => /U\.? ?S\.? SENATOR/i.test(r.N)) ?? null;
  }
  rec("tx:election", elRes, fetchedAt, elRes.ok && !senate ? "Senate race missing (decode failed or feed shape changed)" : undefined);

  const ctyRes = await getJson<{ upload?: string }>(`${TX_CIVIX_BASE}/api/s3/enr/election/countyInfo/${TX_ELECTION_ID}`, { timeoutMs: 25_000, maxBytes: 40 * 1024 * 1024 });
  const counties = ctyRes.ok ? decodeB64Json<Record<string, TxCounty>>(ctyRes.data.upload) : null;
  rec("tx:county", ctyRes, nowIso(), ctyRes.ok && !counties ? "county blob decode failed" : undefined);

  // Early voting: discover the last reported EV date, then fetch that day's cumulative file.
  let earlyVote: EarlyVoteStats | null = previousEarlyVote;
  const evList = await getJson<{ upload?: string }>(`${TX_CIVIX_BASE}/api/v1/getFile?type=EVR_ELECTION`, { retries: 1 });
  rec("tx:ev-elections", evList, nowIso());
  if (evList.ok) {
    const list = decodeB64Json<unknown>(evList.data.upload);
    const dates = findEvDates(list, TX_ELECTION_ID);
    const lastDate = dates.at(-1);
    if (lastDate) {
      const url = `${TX_CIVIX_BASE}/api/v1/getFile?type=EVR_EARLYVOTING&electionId=${TX_ELECTION_ID}&electionDate=${encodeURIComponent(lastDate)}`;
      const evRes = await getJson<{ upload?: string }>(url, { retries: 1 });
      const ev = evRes.ok ? decodeB64Json<TxEarlyVoting>(evRes.data.upload) : null;
      rec("tx:early-voting", evRes, nowIso(), evRes.ok && !ev ? "decode failed" : undefined);
      if (ev) earlyVote = summarizeEarlyVoting(ev, "https://earlyvoting.texas-election.com/");
    }
  }
  if (!elRes.ok) return { race: null, sources };
  return { race: buildTexasResult(race, home, senate, counties, earlyVote, fetchedAt), sources };
}

/** EVR_ELECTION shape: { elections: [{ id, early_voting_dates: [{ date: "MM/DD/YYYY" }] }] }. Returns dates ascending. */
export function findEvDates(list: unknown, electionId: number): string[] {
  const root = list as { elections?: { id?: number | string; early_voting_dates?: { date?: string }[] }[] } | null;
  const el = root?.elections?.find((e) => Number(e.id) === electionId);
  const dates = (el?.early_voting_dates ?? []).map((d) => d.date ?? "").filter((d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d));
  return [...new Set(dates)].sort((a, b) => Date.parse(a) - Date.parse(b));
}
