import { VA_ELECTION_SLUG, VA_ENR_BASE, VA_ENR_CDN, type WatchedRace } from "@/lib/registry";
import type { EarlyVoteStats, LocalityResult, Party, RaceResult, SourceStatus } from "@/lib/schema";
import { marginDR, shares } from "@/lib/historical";
import { getJson, getText, nowIso } from "../http";
import { parseCsv } from "../csv";

/* ---- Enhanced Voting ENR shapes (fields we read) ---- */
type LangText = { languageId: string | null; text: string }[];
export interface EnrMeta {
  asOf?: string | null;
  lastUpdated?: string | null;
  publishDate?: string | null;
  isOfficialResults?: boolean;
  publicReportCategories?: { reports?: { blobName?: string }[] }[];
  countGroups?: { groupId: string; groupName: LangText }[];
}
export interface EnrBallotOption {
  name: LangText;
  voteCount: number;
  party?: { abbreviation?: string | null } | null;
  groupResults?: { groupId: string; groupName?: LangText; voteCount: number }[];
}
export interface EnrReportingStatus {
  reportingUnits: number;
  totalUnits: number;
  asOf?: string;
  reportingStatusDetails?: { reportingStatusClientTextKey?: string; groupName?: LangText; value: number }[] | null;
}
export interface EnrBallotItem {
  id: string;
  name: LangText;
  reportingStatus?: EnrReportingStatus;
  voteTotal?: number;
  summaryResults?: { ballotOptions?: EnrBallotOption[] };
  breakdownResults?: {
    locality: { id?: string; name: LangText; shortName?: string; mapFeatureId?: string | null };
    voteTotal?: number;
    precinctReportingStatus?: EnrReportingStatus;
    ballotOptions?: EnrBallotOption[];
  }[];
}
export interface EnrVr {
  data?: { id: string; localityName: LangText; activeVoters: number; inactiveVoters: number; total: number }[];
}

export function en(t: LangText | string | undefined | null): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  return (t.find((x) => x.languageId === "en") ?? t[0])?.text ?? "";
}

function partyOf(abbr: string | null | undefined): Party {
  const a = (abbr ?? "").toUpperCase();
  if (a === "D" || a === "R" || a === "I" || a === "L" || a === "G") return a;
  return "O";
}

function detail(rs: EnrReportingStatus | undefined, key: string): number | null {
  const d = rs?.reportingStatusDetails?.find((x) => x.reportingStatusClientTextKey === key || en(x.groupName).toLowerCase().startsWith(key.replace("reporting-status-", "").replace("-", " ")));
  return d ? d.value : null;
}

/** Title-case "ALBEMARLE COUNTY" → "Albemarle County" to match historical CSV names. */
export function titleCaseLocality(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/\bOf\b/g, "of");
}

export function buildRaceResult(
  race: WatchedRace,
  meta: EnrMeta,
  item: EnrBallotItem,
  vr: EnrVr | null,
  earlyVote: EarlyVoteStats | null,
  registeredDistrict: { total: number; source: string } | null,
  fetchedAt: string,
): RaceResult {
  const groupNames = new Map((meta.countGroups ?? []).map((g) => [g.groupId, en(g.groupName)]));
  const opts = item.summaryResults?.ballotOptions ?? [];
  const candidates = shares(
    opts.map((o) => {
      const byGroup: Record<string, number> = {};
      for (const g of o.groupResults ?? []) byGroup[groupNames.get(g.groupId) ?? en(g.groupName) ?? g.groupId] = g.voteCount;
      return { name: en(o.name), party: partyOf(o.party?.abbreviation), votes: o.voteCount ?? 0, byGroup };
    }),
  );
  const totalVotes = candidates.reduce((a, c) => a + c.votes, 0);
  const countGroupTotals = new Map<string, number>();
  for (const c of candidates) for (const [g, v] of Object.entries(c.byGroup ?? {})) countGroupTotals.set(g, (countGroupTotals.get(g) ?? 0) + v);

  const vrByName = new Map((vr?.data ?? []).map((r) => [en(r.localityName).toUpperCase(), r.total]));
  const localities: LocalityResult[] = (item.breakdownResults ?? []).map((b) => {
    const rs = b.precinctReportingStatus;
    const fully = detail(rs, "reporting-status-fully-reported");
    const partially = detail(rs, "reporting-status-partially-reported");
    const notReported = detail(rs, "reporting-status-not-reported");
    const total = rs?.totalUnits ?? null;
    const nameUpper = en(b.locality.name).toUpperCase();
    return {
      name: titleCaseLocality(nameUpper),
      fips: b.locality.mapFeatureId ?? null,
      total: (b.ballotOptions ?? []).reduce((a, o) => a + (o.voteCount ?? 0), 0),
      candidates: (b.ballotOptions ?? []).map((o) => ({ party: partyOf(o.party?.abbreviation), name: en(o.name), votes: o.voteCount ?? 0 })),
      precinctsReporting: rs?.reportingUnits ?? null,
      precinctsTotal: total,
      fully,
      partially,
      notReported,
      complete: !!meta.isOfficialResults || (total != null && total > 0 && fully === total),
      registered: vrByName.get(nameUpper) ?? null,
    };
  });
  const unitsTotal = item.reportingStatus?.totalUnits ?? localities.length;
  const fullyUnits = localities.filter((l) => l.complete).length;
  const partialUnits = localities.filter((l) => !l.complete && (l.precinctsReporting ?? 0) > 0).length;
  const complete = !!meta.isOfficialResults || (unitsTotal > 0 && fullyUnits === unitsTotal);
  const registered = registeredDistrict?.total ?? null;
  return {
    id: race.id,
    label: race.label,
    state: "VA",
    office: race.office,
    status: "ok",
    source: {
      name: "Virginia Department of Elections (ENR)",
      url: race.sourceUrl,
      asOf: meta.asOf ?? meta.publishDate ?? null,
      fetchedAt,
      isOfficial: !!meta.isOfficialResults,
    },
    candidates: candidates.map((c) => ({ ...c, share: c.share })),
    totalVotes,
    marginDR: marginDR(candidates, totalVotes),
    reporting: {
      unitKind: "locality",
      unitsReporting: item.reportingStatus?.reportingUnits ?? fullyUnits + partialUnits,
      unitsTotal,
      fully: fullyUnits,
      partially: partialUnits,
      notReported: Math.max(0, unitsTotal - fullyUnits - partialUnits),
      precinctsReporting: localities.reduce((a, l) => a + (l.precinctsReporting ?? 0), 0),
      precinctsTotal: localities.reduce((a, l) => a + (l.precinctsTotal ?? 0), 0),
      complete,
      note: "Units are localities (counties/cities). A locality is complete when all its precincts are fully reported. Virginia publishes no expected-vote estimate.",
    },
    countGroups: countGroupTotals.size ? [...countGroupTotals].map(([name, votes]) => ({ name, votes })) : null,
    turnout: {
      ballotsCast: totalVotes,
      registered,
      rate: registered && registered > 0 ? Math.round((totalVotes / registered) * 10000) / 10000 : null,
      registeredSource: registeredDistrict?.source ?? null,
    },
    localities,
    earlyVote,
  };
}

/** Aggregate the ENR absentee CSV for a congressional district. Exported for tests. */
export function summarizeAbsentee(rows: Record<string, string>[], district: number, asOf: string | null, sourceUrl: string): EarlyVoteStats {
  const mine = rows.filter((r) => Number(r.CongressionalDistrict) === district);
  const byLoc = new Map<string, { inPerson: number; mail: number; returned: number }>();
  let returned = 0,
    inPerson = 0,
    mail = 0,
    outstanding = 0;
  for (const r of mine) {
    const n = Number(r.TheCount) || 0;
    const receipt = (r.ReceiptType ?? "").trim();
    const loc = titleCaseLocality((r.LocalityName ?? "").trim());
    const agg = byLoc.get(loc) ?? { inPerson: 0, mail: 0, returned: 0 };
    if (!receipt) outstanding += n;
    else {
      returned += n;
      agg.returned += n;
      if (/in person/i.test(receipt)) {
        inPerson += n;
        agg.inPerson += n;
      } else {
        mail += n;
        agg.mail += n;
      }
    }
    byLoc.set(loc, agg);
  }
  return {
    kind: "va-absentee-applications",
    asOf,
    sourceUrl,
    note: "Absentee/early ballots recorded as returned by the Department of Elections (in person + mail/drop-off). These are pre-election application statistics, not counted votes, and are updated roughly daily.",
    totals: { returned, inPerson, mail, outstanding, registered: null },
    byLocality: [...byLoc].map(([name, v]) => ({ name, inPerson: v.inPerson, mail: v.mail, returned: v.returned, registered: null })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface VaFetchResult {
  races: Record<string, RaceResult>;
  sources: Record<string, SourceStatus>;
  absenteeBlob: string | null;
}

export async function fetchVirginia(
  races: WatchedRace[],
  registered: Record<string, { total: number; source: string }>,
  previous: { absenteeBlob: string | null; earlyVote: Record<string, EarlyVoteStats | null> },
): Promise<VaFetchResult> {
  const sources: Record<string, SourceStatus> = {};
  const out: Record<string, RaceResult> = {};
  const base = `${VA_ENR_BASE}/virginia/${VA_ELECTION_SLUG}`;
  const rec = (key: string, r: { ok: boolean; status: number | null; durationMs: number; url: string; error?: string }, fetchedAt: string) => {
    sources[key] = { ok: r.ok, url: r.url, httpStatus: r.status, durationMs: r.durationMs, error: r.ok ? null : (r.error ?? "error"), fetchedAt, lastSuccessAt: r.ok ? fetchedAt : null };
  };

  const metaRes = await getJson<EnrMeta>(base);
  rec("va:meta", metaRes, nowIso());
  const meta: EnrMeta = metaRes.ok ? metaRes.data : {};

  const itemsRes = await getJson<{ data?: EnrBallotItem[] }>(`${base}/ballot-items`);
  rec("va:ballot-items", itemsRes, nowIso());
  const items = itemsRes.ok ? (itemsRes.data.data ?? []) : [];

  const vrRes = await getJson<EnrVr>(`${base}/vr`, { retries: 1 });
  rec("va:vr", vrRes, nowIso());

  // Absentee CSV: only re-download when the blob name changes (file updates ~daily).
  const blob = meta.publicReportCategories?.flatMap((c) => c.reports ?? []).map((r) => r.blobName ?? "").find((b) => /EnrAbsenteeRawCSV/i.test(b)) ?? null;
  let absenteeRows: Record<string, string>[] | null = null;
  if (blob && blob !== previous.absenteeBlob) {
    const url = `${VA_ENR_CDN}/${encodeURIComponent(blob)}`;
    const csv = await getText(url, { timeoutMs: 20_000, maxBytes: 30 * 1024 * 1024 });
    rec("va:absentee-csv", csv, nowIso());
    if (csv.ok) absenteeRows = parseCsv(csv.data);
  }

  for (const race of races.filter((r) => r.state === "VA")) {
    const fetchedAt = nowIso();
    const byName = items.find((i) => en(i.name).includes(race.officialNameMatch ?? "\u0000") && /house of representatives/i.test(en(i.name)));
    const contestId = byName?.id ?? race.officialId;
    const detailRes = await getJson<EnrBallotItem>(`${base}/ballot-items/${contestId}`);
    rec(`va:contest:${race.id}`, detailRes, fetchedAt);
    if (!metaRes.ok || !detailRes.ok) continue;
    const district = Number(race.id.split("-")[1]);
    const earlyVote = absenteeRows
      ? summarizeAbsentee(absenteeRows, district, meta.asOf ?? null, `${VA_ENR_CDN}/${encodeURIComponent(blob!)}`)
      : (previous.earlyVote[race.id] ?? null);
    out[race.id] = buildRaceResult(race, meta, detailRes.data, vrRes.ok ? vrRes.data : null, earlyVote, registered[race.id] ?? null, fetchedAt);
  }
  return { races: out, sources, absenteeBlob: absenteeRows ? blob : previous.absenteeBlob };
}
