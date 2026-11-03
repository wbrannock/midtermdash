import type { ContractFlag, SubjectFlag } from "@/lib/schema";

type AnyFlag = ContractFlag | SubjectFlag;

const META: Record<AnyFlag, { label: string; tone: "warn" | "serious" | "critical" | "muted"; title: string }> = {
  WIDE_SPREAD: { label: "wide spread", tone: "warn", title: "Bid–ask spread above 5 points; the midpoint is a weak estimate." },
  THIN_LIQUIDITY: { label: "thin", tone: "warn", title: "Under $10k of resting liquidity / open interest; small orders can move the price." },
  STALE: { label: "stale", tone: "serious", title: "No trade for a long time (6h on election night, 48h otherwise); the quote may not reflect new information." },
  NO_QUOTE: { label: "no quote", tone: "critical", title: "No two-sided quote was available." },
  FETCH_FAILED: { label: "fetch failed", tone: "critical", title: "The last fetch from this venue failed." },
  RETAINED_PREVIOUS: { label: "retained", tone: "serious", title: "Showing the last valid quote because the latest fetch failed." },
  ONE_SIDED_BOOK: { label: "one-sided", tone: "serious", title: "Only one side of the order book had orders." },
  DISAGREEMENT: { label: "venues disagree", tone: "warn", title: "Polymarket and Kalshi differ by 3 points or more." },
  SINGLE_SOURCE: { label: "single source", tone: "serious", title: "Only one venue qualified for the consensus." },
  NO_CONSENSUS: { label: "no consensus", tone: "critical", title: "No venue had a usable quote." },
  INTERNAL_INCONSISTENCY: { label: "D/R mismatch", tone: "warn", title: "A venue's Democratic and Republican contracts imply different probabilities (sum ≠ 1 by more than 3 points)." },
};

const TONE: Record<string, string> = {
  warn: "border-warn/40 text-warn",
  serious: "border-serious/40 text-serious",
  critical: "border-critical/50 text-critical",
  muted: "border-line-strong text-fg-3",
};

export function Flag({ code }: { code: AnyFlag }) {
  const m = META[code] ?? { label: code.toLowerCase().replace(/_/g, " "), tone: "muted", title: code };
  return (
    <span title={m.title} className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none ${TONE[m.tone]}`}>
      {m.label}
    </span>
  );
}

export function Flags({ codes }: { codes: AnyFlag[] }) {
  if (!codes.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => (
        <Flag key={c} code={c} />
      ))}
    </span>
  );
}

export const FLAG_META = META;
