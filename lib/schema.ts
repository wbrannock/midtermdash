import { z } from "zod";

/**
 * Zod schemas for every JSON document written to the `data` branch.
 * Shared by the pipeline (validation before write) and the frontend
 * (validation after fetch) so a malformed snapshot is never rendered.
 */

export const PartySchema = z.enum(["D", "R", "I", "L", "G", "W", "O"]);
export type Party = z.infer<typeof PartySchema>;
export const VenueSchema = z.enum(["polymarket", "kalshi"]);

export const ContractFlagSchema = z.enum([
  "WIDE_SPREAD",
  "THIN_LIQUIDITY",
  "STALE",
  "NO_QUOTE",
  "FETCH_FAILED",
  "RETAINED_PREVIOUS",
  "ONE_SIDED_BOOK",
]);
export type ContractFlag = z.infer<typeof ContractFlagSchema>;

export const SubjectFlagSchema = z.enum([
  "DISAGREEMENT",
  "SINGLE_SOURCE",
  "NO_CONSENSUS",
  "INTERNAL_INCONSISTENCY",
  "WIDE_SPREAD",
  "THIN_LIQUIDITY",
  "STALE",
]);
export type SubjectFlag = z.infer<typeof SubjectFlagSchema>;

const nullableNum = z.number().finite().nullable();

export const ContractQuoteSchema = z.object({
  venue: VenueSchema,
  party: PartySchema,
  /** Kalshi ticker or Polymarket Gamma market id. */
  id: z.string(),
  /** Polymarket YES token id (CLOB asset id). */
  tokenId: z.string().optional(),
  label: z.string(),
  question: z.string().optional(),
  bid: nullableNum,
  ask: nullableNum,
  mid: nullableNum,
  last: nullableNum,
  spread: nullableNum,
  /** USD. Polymarket: Gamma `liquidity`; Kalshi: open interest (contracts ≈ $1 notional). */
  liquidity: nullableNum,
  volume: nullableNum,
  lastTradeAt: z.string().nullable(),
  fetchedAt: z.string(),
  sourceUrl: z.string(),
  status: z.enum(["ok", "error"]),
  error: z.string().optional(),
  flags: z.array(ContractFlagSchema),
});
export type ContractQuote = z.infer<typeof ContractQuoteSchema>;

export const VenueEstimateSchema = z.object({
  venue: VenueSchema,
  /** Probability the Democratic side wins (0–1). */
  pDem: nullableNum,
  fromDemContract: nullableNum,
  fromRepContract: nullableNum,
  maxSpread: nullableNum,
  usable: z.boolean(),
  reason: z.string().optional(),
  flags: z.array(SubjectFlagSchema),
});
export type VenueEstimate = z.infer<typeof VenueEstimateSchema>;

export const ConsensusSchema = z.object({
  pDem: nullableNum,
  method: z.literal("equal-weight-mean-of-usable-venue-midpoints"),
  inputs: z.array(z.object({ venue: VenueSchema, pDem: z.number() })),
  /** Range spanned by the usable venue values ± half their max spread. */
  band: z.object({ lo: z.number(), hi: z.number() }).nullable(),
  flags: z.array(SubjectFlagSchema),
});
export type Consensus = z.infer<typeof ConsensusSchema>;

export const MarketSubjectSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(["chamber", "race"]),
  label: z.string(),
  contracts: z.array(ContractQuoteSchema),
  venues: z.array(VenueEstimateSchema),
  consensus: ConsensusSchema,
  flags: z.array(SubjectFlagSchema),
});
export type MarketSubjectSnapshot = z.infer<typeof MarketSubjectSnapshotSchema>;

export const MarketsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  subjects: z.array(MarketSubjectSnapshotSchema),
});
export type MarketsSnapshot = z.infer<typeof MarketsSnapshotSchema>;

/* ---------------- results ---------------- */

export const CandidateResultSchema = z.object({
  name: z.string(),
  party: PartySchema,
  votes: z.number().int().nonnegative(),
  share: nullableNum,
  /** Votes by count group (VA: Early Voting / Election Day / …; TX: early / election-day). */
  byGroup: z.record(z.string(), z.number()).optional(),
});
export type CandidateResult = z.infer<typeof CandidateResultSchema>;

export const ReportingSchema = z.object({
  unitKind: z.enum(["locality", "county"]),
  unitsReporting: z.number().int().nonnegative(),
  unitsTotal: z.number().int().nonnegative(),
  /** Units by precinct-level reporting state (VA) — counts of units, not precincts. */
  fully: z.number().int().nonnegative().nullable(),
  partially: z.number().int().nonnegative().nullable(),
  notReported: z.number().int().nonnegative().nullable(),
  precinctsReporting: z.number().int().nonnegative().nullable(),
  precinctsTotal: z.number().int().nonnegative().nullable(),
  /** True only when every unit is fully reported or results are marked official. */
  complete: z.boolean(),
  note: z.string().optional(),
});
export type Reporting = z.infer<typeof ReportingSchema>;

export const LocalityResultSchema = z.object({
  name: z.string(),
  fips: z.string().nullable(),
  total: z.number().int().nonnegative(),
  candidates: z.array(z.object({ party: PartySchema, name: z.string(), votes: z.number().int().nonnegative() })),
  precinctsReporting: z.number().int().nonnegative().nullable(),
  precinctsTotal: z.number().int().nonnegative().nullable(),
  fully: z.number().int().nonnegative().nullable(),
  partially: z.number().int().nonnegative().nullable(),
  notReported: z.number().int().nonnegative().nullable(),
  complete: z.boolean(),
  registered: z.number().int().nonnegative().nullable(),
});
export type LocalityResult = z.infer<typeof LocalityResultSchema>;

export const EarlyVoteStatsSchema = z.object({
  kind: z.enum(["va-absentee-applications", "tx-early-voting-turnout"]),
  asOf: z.string().nullable(),
  sourceUrl: z.string(),
  note: z.string(),
  totals: z.object({
    returned: nullableNum,
    inPerson: nullableNum,
    mail: nullableNum,
    outstanding: nullableNum,
    registered: nullableNum,
  }),
  byLocality: z
    .array(
      z.object({
        name: z.string(),
        inPerson: nullableNum,
        mail: nullableNum,
        returned: nullableNum,
        registered: nullableNum,
      }),
    )
    .optional(),
});
export type EarlyVoteStats = z.infer<typeof EarlyVoteStatsSchema>;

export const RaceResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(["VA", "TX"]),
  office: z.string(),
  status: z.enum(["ok", "error", "retained"]),
  error: z.string().optional(),
  source: z.object({
    name: z.string(),
    url: z.string(),
    asOf: z.string().nullable(),
    fetchedAt: z.string(),
    isOfficial: z.boolean(),
  }),
  candidates: z.array(CandidateResultSchema),
  totalVotes: z.number().int().nonnegative(),
  /** Democratic share minus Republican share, in percentage points. */
  marginDR: nullableNum,
  reporting: ReportingSchema,
  countGroups: z.array(z.object({ name: z.string(), votes: z.number() })).nullable(),
  turnout: z.object({
    ballotsCast: nullableNum,
    registered: nullableNum,
    rate: nullableNum,
    registeredSource: z.string().nullable(),
  }),
  localities: z.array(LocalityResultSchema),
  earlyVote: EarlyVoteStatsSchema.nullable(),
});
export type RaceResult = z.infer<typeof RaceResultSchema>;

export const ResultsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  races: z.array(RaceResultSchema),
});
export type ResultsSnapshot = z.infer<typeof ResultsSnapshotSchema>;

/* ---------------- status ---------------- */

export const SourceStatusSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
  fetchedAt: z.string(),
  lastSuccessAt: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const StatusSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  pipelineVersion: z.string(),
  runId: z.string().nullable(),
  runUrl: z.string().nullable(),
  windowMode: z.enum(["election-night", "normal", "manual"]),
  sources: z.record(z.string(), SourceStatusSchema),
  /** Files whose previous content was retained because the new one failed validation/fetch. */
  retained: z.array(z.string()),
  notes: z.array(z.string()),
});
export type StatusSnapshot = z.infer<typeof StatusSnapshotSchema>;

/* ---------------- history ---------------- */

/** [unixSeconds, polymarket pDem | null, kalshi pDem | null, consensus pDem | null] */
export const HistoryPointSchema = z.tuple([
  z.number().int(),
  nullableNum,
  nullableNum,
  nullableNum,
]);
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;

export const HistorySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  columns: z.tuple([
    z.literal("t"),
    z.literal("polymarket"),
    z.literal("kalshi"),
    z.literal("consensus"),
  ]),
  series: z.record(z.string(), z.array(HistoryPointSchema)),
});
export type HistorySnapshot = z.infer<typeof HistorySnapshotSchema>;

/* ---------------- historical baselines (bundled on main) ---------------- */

export const BaselineLocalitySchema = z.object({
  name: z.string(),
  total: z.number().int().nonnegative(),
  candidates: z.array(z.object({ party: PartySchema, name: z.string(), votes: z.number().int().nonnegative() })),
  /** Locality is split across districts under this map → not comparable at locality level. */
  split: z.boolean(),
  registered: z.number().int().nonnegative().nullable(),
  ballotsCast: z.number().int().nonnegative().nullable(),
});
export type BaselineLocality = z.infer<typeof BaselineLocalitySchema>;

export const ContestBaselineSchema = z.object({
  race: z.enum(["va-05", "va-09"]),
  year: z.number().int(),
  map: z.enum(["2016-court", "2021-sms"]),
  contestId: z.number().int(),
  sourceUrl: z.string(),
  fetchedAt: z.string(),
  candidates: z.array(CandidateResultSchema),
  totalVotes: z.number().int().nonnegative(),
  marginDR: nullableNum,
  localities: z.array(BaselineLocalitySchema),
  turnout: z.object({
    ballotsCast: nullableNum,
    registered: nullableNum,
    rate: nullableNum,
    note: z.string(),
  }),
});
export type ContestBaseline = z.infer<typeof ContestBaselineSchema>;

export const BaselinesSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  contests: z.array(ContestBaselineSchema),
  /** For 2018↔2026: localities wholly inside the district under both maps. */
  comparableGeography: z.record(
    z.string(),
    z.object({ localities: z.array(z.string()), note: z.string() }),
  ),
  registration2026: z.record(
    z.string(),
    z.object({ active: z.number(), total: z.number(), asOf: z.string(), sourceUrl: z.string() }),
  ),
});
export type Baselines = z.infer<typeof BaselinesSchema>;
