/**
 * Static registry of everything the pipeline tracks.
 *
 * Identifiers were verified against live, credential-free endpoints on
 * 2026-11-03. Adapters resolve by slug/ticker/name at runtime and use the ids
 * here only as fallbacks; no price or vote value is ever hardcoded.
 */

export type Party = "D" | "R" | "I" | "L" | "G" | "W" | "O";
export type Venue = "polymarket" | "kalshi";

export type ChamberId = "house" | "senate";
export type RaceId = "va-05" | "va-09" | "tx-sen";
export type MarketSubjectId = ChamberId | RaceId;

export interface PolymarketContract {
  venue: "polymarket";
  /** Gamma event slug (resolved at runtime). */
  eventSlug: string;
  /** `groupItemTitle` of the market inside the event, matched case-insensitively. */
  groupItemTitle: string;
  /** Fallback Gamma market id if title matching fails. */
  marketId: string;
  /** Fallback YES token id (CLOB asset id) if the market cannot be resolved. */
  yesTokenId: string;
  party: Party;
}

export interface KalshiContract {
  venue: "kalshi";
  ticker: string;
  party: Party;
}

export type Contract = PolymarketContract | KalshiContract;

export interface MarketSubject {
  id: MarketSubjectId;
  kind: "chamber" | "race";
  label: string;
  /** The question each contract answers, written for the methodology panel. */
  question: string;
  contracts: Contract[];
  settlementNotes: { polymarket: string; kalshi: string };
}

export const POLYMARKET_GAMMA = "https://gamma-api.polymarket.com";
export const POLYMARKET_CLOB = "https://clob.polymarket.com";
export const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

export const MARKET_SUBJECTS: MarketSubject[] = [
  {
    id: "house",
    kind: "chamber",
    label: "House control",
    question: "Which party controls the U.S. House after the 2026 midterms?",
    contracts: [
      {
        venue: "polymarket",
        eventSlug: "which-party-will-win-the-house-in-2026",
        groupItemTitle: "Democratic Party",
        marketId: "562802",
        yesTokenId:
          "83247781037352156539108067944461291821683755894607244160607042790356561625563",
        party: "D",
      },
      {
        venue: "polymarket",
        eventSlug: "which-party-will-win-the-house-in-2026",
        groupItemTitle: "Republican Party",
        marketId: "562803",
        yesTokenId:
          "65139230827417363158752884968303867495725894165574887635816574090175320800482",
        party: "R",
      },
      { venue: "kalshi", ticker: "CONTROLH-2026-D", party: "D" },
      { venue: "kalshi", ticker: "CONTROLH-2026-R", party: "R" },
    ],
    settlementNotes: {
      polymarket:
        "Resolves to the party winning a majority of House seats as elected (members count for the party they were elected under). If no majority, the party of the first elected Speaker. Independents count toward a party only if they state they will caucus with it; may stay open until Jan 4, 2027.",
      kalshi:
        "May settle early on a consensus of media calls projecting control. Otherwise settles on the party identification of the Speaker of the House on Feb 1, 2027.",
    },
  },
  {
    id: "senate",
    kind: "chamber",
    label: "Senate control",
    question: "Which party controls the U.S. Senate after the 2026 midterms?",
    contracts: [
      {
        venue: "polymarket",
        eventSlug: "which-party-will-win-the-senate-in-2026",
        groupItemTitle: "Democratic Party",
        marketId: "562793",
        yesTokenId:
          "113287701564209339913693347405685749986285999146352375265161592243948562084773",
        party: "D",
      },
      {
        venue: "polymarket",
        eventSlug: "which-party-will-win-the-senate-in-2026",
        groupItemTitle: "Republican Party",
        marketId: "562794",
        yesTokenId:
          "51939490109676186832507970701169130490548061087912630009168726706475001411420",
        party: "R",
      },
      { venue: "kalshi", ticker: "CONTROLS-2026-D", party: "D" },
      { venue: "kalshi", ticker: "CONTROLS-2026-R", party: "R" },
    ],
    settlementNotes: {
      polymarket:
        "Resolves to the party holding a majority of Senate seats; seats not up in 2026 count for the party holding them on election day. A 50/50 split goes to the Vice President's party; if unclear, the party of the first President pro tempore.",
      kalshi:
        "May settle early on a consensus of media calls. Otherwise settles on the party of the President pro tempore on Feb 1, 2027.",
    },
  },
  {
    id: "tx-sen",
    kind: "race",
    label: "Texas U.S. Senate",
    question: "Who wins the 2026 Texas U.S. Senate general election?",
    contracts: [
      {
        venue: "polymarket",
        eventSlug: "texas-senate-election-winner",
        groupItemTitle: "James Talarico",
        marketId: "630963",
        yesTokenId:
          "15290572385458522370285732869432740297199321382471116558439914335588167718663",
        party: "D",
      },
      {
        venue: "polymarket",
        eventSlug: "texas-senate-election-winner",
        groupItemTitle: "Ken Paxton",
        marketId: "630964",
        yesTokenId:
          "21265207456609426291246075480390336499088453711419597084147957999650569091884",
        party: "R",
      },
      { venue: "kalshi", ticker: "SENATETX-26-D", party: "D" },
      { venue: "kalshi", ticker: "SENATETX-26-R", party: "R" },
    ],
    settlementNotes: {
      polymarket:
        "Resolves per the Associated Press or a consensus of credible reporting on the winner (including any runoff), by party as listed on the ballot.",
      kalshi:
        "Settles on who is sworn in for the term beginning in 2027, unless determined early by media calls.",
    },
  },
  {
    id: "va-05",
    kind: "race",
    label: "Virginia 5th District",
    question: "Who wins the 2026 VA-05 U.S. House general election?",
    contracts: [
      {
        venue: "polymarket",
        eventSlug: "va-05-house-election-winner",
        groupItemTitle: "Tom Perriello",
        marketId: "1285080",
        yesTokenId:
          "30424541292784877350495001354252975055952568624850695789713995653053526735723",
        party: "D",
      },
      {
        venue: "polymarket",
        eventSlug: "va-05-house-election-winner",
        groupItemTitle: "John McGuire",
        marketId: "1285079",
        yesTokenId:
          "83253007588985953900662535978265304048199216427463571583210985764316132662845",
        party: "R",
      },
      { venue: "kalshi", ticker: "KXHOUSERACE-VA05-26-D", party: "D" },
      { venue: "kalshi", ticker: "KXHOUSERACE-VA05-26-R", party: "R" },
    ],
    settlementNotes: {
      polymarket: "Resolves per AP / credible-reporting consensus on the winner.",
      kalshi: "Settles on who is sworn in, unless determined early by media calls.",
    },
  },
  {
    id: "va-09",
    kind: "race",
    label: "Virginia 9th District",
    question: "Who wins the 2026 VA-09 U.S. House general election?",
    contracts: [
      {
        venue: "polymarket",
        eventSlug: "va-09-house-election-winner",
        groupItemTitle: "Joy Powers",
        marketId: "1285104",
        yesTokenId:
          "81773156633575289505028825940728682190525277298296062454764556212611714929690",
        party: "D",
      },
      {
        venue: "polymarket",
        eventSlug: "va-09-house-election-winner",
        groupItemTitle: "Morgan Griffith",
        marketId: "1285103",
        yesTokenId:
          "97985266253695226432158738374848770894053769898088393951805500827663583868955",
        party: "R",
      },
      { venue: "kalshi", ticker: "KXHOUSERACE-VA09-26-D", party: "D" },
      { venue: "kalshi", ticker: "KXHOUSERACE-VA09-26-R", party: "R" },
    ],
    settlementNotes: {
      polymarket: "Resolves per AP / credible-reporting consensus on the winner.",
      kalshi: "Settles on who is sworn in, unless determined early by media calls.",
    },
  },
];

/* ------------------------------------------------------------------ */
/* Official results feeds                                              */
/* ------------------------------------------------------------------ */

export const VA_ENR_BASE =
  "https://enr.elections.virginia.gov/results/public/api/elections";
export const VA_ENR_CDN =
  "https://enr.elections.virginia.gov/cdn/results/d2c804ee-4ec2-46bb-91d7-5b41526eab03";
export const VA_ELECTION_SLUG = "2026-November-General";

export const TX_CIVIX_BASE =
  "https://goelect.txelections.civixapps.com/api-ivis-system";
export const TX_ELECTION_ID = 53815; // 2026 November General, from electionConstants
export const TX_SENATE_RACE_ID = 5075; // "U. S. SENATOR" in the Federal block

export interface CandidateRef {
  name: string;
  party: Party;
  /** Substrings used to match official feed names (upper/lower-case insensitive). */
  match: string[];
}

export interface WatchedRace {
  id: RaceId;
  label: string;
  state: "VA" | "TX";
  office: string;
  candidates: CandidateRef[];
  /** VA: contest id fallback; TX: race id. */
  officialId: string;
  /** VA contest name fragment used for runtime resolution. */
  officialNameMatch?: string;
  historicalYears: number[];
  sourceUrl: string;
}

export const WATCHED_RACES: WatchedRace[] = [
  {
    id: "va-05",
    label: "VA-05 · U.S. House",
    state: "VA",
    office: "Member, House of Representatives (5th District)",
    candidates: [
      { name: "Tom S. P. Perriello", party: "D", match: ["perriello"] },
      { name: "John J. McGuire III", party: "R", match: ["mcguire"] },
      { name: "Cooke C. Harvey", party: "I", match: ["harvey"] },
    ],
    officialId: "01000000-f030-c43d-608c-08df1fee52fa",
    officialNameMatch: "(5th District)",
    historicalYears: [2024, 2018],
    sourceUrl:
      "https://enr.elections.virginia.gov/results/public/virginia/elections/2026-November-General",
  },
  {
    id: "va-09",
    label: "VA-09 · U.S. House",
    state: "VA",
    office: "Member, House of Representatives (9th District)",
    candidates: [
      { name: "Joy A. Powers", party: "D", match: ["powers"] },
      { name: "H. Morgan Griffith", party: "R", match: ["griffith"] },
    ],
    officialId: "01000000-f030-c43d-e187-08df1fee5306",
    officialNameMatch: "(9th District)",
    historicalYears: [2024, 2018],
    sourceUrl:
      "https://enr.elections.virginia.gov/results/public/virginia/elections/2026-November-General",
  },
  {
    id: "tx-sen",
    label: "Texas · U.S. Senate",
    state: "TX",
    office: "U.S. Senator",
    candidates: [
      { name: "James Talarico", party: "D", match: ["talarico"] },
      { name: "Ken Paxton", party: "R", match: ["paxton"] },
      { name: "Ted Brown", party: "L", match: ["ted brown"] },
    ],
    officialId: String(TX_SENATE_RACE_ID),
    historicalYears: [],
    sourceUrl: "https://results.texas-election.com/",
  },
];

/* ------------------------------------------------------------------ */
/* Historical Virginia contests (historical.elections.virginia.gov)    */
/* ------------------------------------------------------------------ */

export interface HistoricalContest {
  race: "va-05" | "va-09";
  year: number;
  contestId: number;
  map: "2016-court" | "2021-sms";
  candidates: CandidateRef[];
}

export const VA_HISTORICAL_CONTESTS: HistoricalContest[] = [
  {
    race: "va-05",
    year: 2024,
    contestId: 161288,
    map: "2021-sms",
    candidates: [
      { name: "John J. McGuire, III", party: "R", match: ["mcguire"] },
      { name: "Gloria Tinsley Witt", party: "D", match: ["witt"] },
    ],
  },
  {
    race: "va-09",
    year: 2024,
    contestId: 161312,
    map: "2021-sms",
    candidates: [
      { name: "Howard Morgan Griffith", party: "R", match: ["griffith"] },
      { name: "Karen G. H. Baker", party: "D", match: ["baker"] },
    ],
  },
  {
    race: "va-05",
    year: 2018,
    contestId: 134059,
    map: "2016-court",
    candidates: [
      { name: "Denver Lee Riggleman, III", party: "R", match: ["riggleman"] },
      { name: "Leslie Corkill Cockburn", party: "D", match: ["cockburn"] },
    ],
  },
  {
    race: "va-09",
    year: 2018,
    contestId: 134060,
    map: "2016-court",
    candidates: [
      { name: "Howard Morgan Griffith", party: "R", match: ["griffith"] },
      { name: "Anthony Jude Flaccavento", party: "D", match: ["flaccavento"] },
    ],
  },
];

export const VA_HISTORICAL_CSV = (contestId: number) =>
  `https://historical.elections.virginia.gov/api/download_contest/${contestId}_table.csv`;

/**
 * Localities that are split between congressional districts under each map.
 * A locality-level comparison is invalid for these (part of the locality's
 * vote belongs to another district).
 */
export const VA_SPLIT_LOCALITIES: Record<
  "2016-court" | "2021-sms",
  Record<"va-05" | "va-09", string[]>
> = {
  "2016-court": {
    "va-05": ["Bedford County", "Henry County", "Fauquier County"],
    "va-09": ["Henry County", "Roanoke County"],
  },
  "2021-sms": {
    "va-05": ["Albemarle County", "Bedford County", "Hanover County"],
    "va-09": ["Bedford County", "Roanoke County"],
  },
};

/* ------------------------------------------------------------------ */
/* Pipeline configuration                                              */
/* ------------------------------------------------------------------ */

export const ELECTION_NIGHT_WINDOW = {
  /** Inclusive start (UTC). 16:00Z = 11:00 ET on election day. */
  start: "2026-11-03T16:00:00Z",
  /** Exclusive end (UTC). */
  end: "2026-11-05T12:00:00Z",
};

export const DATA_BRANCH = "data";

/* ------------------------------------------------------------------ */
/* Live forecast inputs                                                */
/* ------------------------------------------------------------------ */

/**
 * When statewide results may begin to post (UTC). The market prior for the
 * live forecast is frozen at the last snapshot before this instant, so prices
 * that already react to returns are never fed back in as a "prior".
 * VA: polls close 7:00 pm ET. TX: 7:00 pm CT for all but the two Mountain-time
 * counties (El Paso, Hudspeth) which close an hour later; posting begins at 7 pm CT.
 */
export const POLL_CLOSE_UTC: Record<RaceId, string> = {
  "va-05": "2026-11-04T00:00:00Z",
  "va-09": "2026-11-04T00:00:00Z",
  "tx-sen": "2026-11-04T01:00:00Z",
};

/**
 * Texas statewide returns by voting-tabulation district from the Texas
 * Legislative Council's election data service (data.capitol.texas.gov).
 * Public, no key. Aggregated to counties by the first three characters of
 * CNTYVTD (the county FIPS code within Texas).
 */
export const TX_TLC_API = "https://ted.capitol.texas.gov/api/Offices";
export const TX_HISTORICAL_CONTESTS = [
  { year: 2024, electionId: 510, officeId: 2, label: "2024 U.S. Senate (Cruz vs Allred)", file: "tx_2024_us_senate_vtd.csv" },
  { year: 2018, electionId: 456, officeId: 2, label: "2018 U.S. Senate (Cruz vs O'Rourke)", file: "tx_2018_us_senate_vtd.csv" },
] as const;
export const TX_VOTER_DATA = { year: 2024, electionId: 510, officeId: 1428, file: "tx_2024_voter_data_vtd.csv" } as const;
export const TX_COUNTY_CODES_URL = "https://www2.census.gov/geo/docs/reference/codes2020/cou/st48_tx_cou2020.txt";
