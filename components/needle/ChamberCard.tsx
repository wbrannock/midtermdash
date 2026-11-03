import type { MarketSubjectSnapshot } from "@/lib/schema";
import { MARKET_SUBJECTS } from "@/lib/registry";
import { Needle } from "./Needle";
import { Flags } from "@/components/common/Flag";
import { Card, Details } from "@/components/common/Section";
import { MarketTable, VenueSummary } from "@/components/markets/MarketTable";
import { pct } from "@/lib/format";

export function ChamberCard({ subject, now }: { subject: MarketSubjectSnapshot; now: number }) {
  const reg = MARKET_SUBJECTS.find((s) => s.id === subject.id);
  const p = subject.consensus.pDem;
  const ticks = subject.venues
    .filter((v) => v.pDem != null)
    .map((v) => ({ label: v.venue === "polymarket" ? "Polymarket" : "Kalshi", value: v.pDem as number, color: v.venue === "polymarket" ? "var(--color-poly)" : "var(--color-kalshi)" }));
  const lean = p == null ? "No consensus" : p >= 0.85 ? "Democrats likely" : p >= 0.65 ? "Lean Democratic" : p > 0.35 ? "Toss-up" : p > 0.15 ? "Lean Republican" : "Republicans likely";
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">{subject.label}</h3>
        <span className="text-xs text-fg-3">market consensus</span>
      </div>
      <div className="mx-auto mt-2 w-full max-w-[340px]">
        <Needle pDem={p} band={subject.consensus.band} ticks={ticks} />
      </div>
      <div className="-mt-2 flex items-end justify-between">
        <div>
          <div className="text-xs text-fg-3">Republican control</div>
          <div className="text-2xl font-semibold" style={{ fontVariantNumeric: "proportional-nums" }}>
            {p == null ? "–" : pct(1 - p, 0)}
          </div>
        </div>
        <div className="pb-1 text-center text-sm text-fg-2">{lean}</div>
        <div className="text-right">
          <div className="text-xs text-fg-3">Democratic control</div>
          <div className="text-2xl font-semibold" style={{ fontVariantNumeric: "proportional-nums" }}>
            {p == null ? "–" : pct(p, 0)}
          </div>
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <VenueSummary subject={subject} />
      </div>
      {subject.flags.length ? (
        <div className="mt-3">
          <Flags codes={subject.flags} />
        </div>
      ) : null}
      <div className="mt-3">
        <Details summary="Contracts and settlement rules">
          <div className="overflow-x-auto">
            <MarketTable subject={subject} now={now} />
          </div>
          {reg ? (
            <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-fg-2 md:grid-cols-2">
              <div>
                <dt className="font-medium text-fg-2">Polymarket settles</dt>
                <dd>{reg.settlementNotes.polymarket}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg-2">Kalshi settles</dt>
                <dd>{reg.settlementNotes.kalshi}</dd>
              </div>
            </dl>
          ) : null}
        </Details>
      </div>
    </Card>
  );
}
