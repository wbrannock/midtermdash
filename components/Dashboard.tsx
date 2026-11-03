"use client";
import baselinesJson from "@/data/historical/va/baselines.json";
import { BaselinesSchema, HistorySnapshotSchema, MarketsSnapshotSchema, ResultsSnapshotSchema, StatusSnapshotSchema } from "@/lib/schema";
import { useSnapshot } from "@/lib/useSnapshot";
import { WATCHED_RACES } from "@/lib/registry";
import { Section, Empty } from "@/components/common/Section";
import { Freshness, useNow } from "@/components/common/Freshness";
import { ChamberCard } from "@/components/needle/ChamberCard";
import { ProbabilityHistory } from "@/components/charts/ProbabilityHistory";
import { Watchlist } from "@/components/watchlist/Watchlist";
import { RacePanel } from "@/components/races/RacePanel";
import { CoverageGaps, Methodology } from "@/components/common/Methodology";

const baselines = BaselinesSchema.parse(baselinesJson);

export default function Dashboard() {
  const markets = useSnapshot("latest/markets.json", MarketsSnapshotSchema);
  const results = useSnapshot("latest/results.json", ResultsSnapshotSchema);
  const status = useSnapshot("latest/status.json", StatusSnapshotSchema);
  const history = useSnapshot("history/markets.json", HistorySnapshotSchema);
  const now = useNow();

  const subjects = markets.data?.subjects ?? [];
  const chambers = subjects.filter((s) => s.kind === "chamber");
  const raceSubjects = subjects.filter((s) => s.kind === "race");
  const firstError = markets.error ?? results.error ?? status.error ?? history.error;

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1180px] overflow-x-clip px-4 pb-24 pt-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-[28px] font-semibold leading-none tracking-tight">Midterms 2026</h1>
            <p className="mt-2 max-w-prose text-sm text-fg-2">
              Market-implied House and Senate control from Polymarket and Kalshi, counted returns for three watched races from state election offices, and official 2024 and 2018 baselines. Nonpartisan, zero credentials, refreshed by a public GitHub Actions workflow.
            </p>
          </div>
        </div>
        <Freshness status={status.data} generatedAt={markets.data?.generatedAt ?? null} fetchedAt={markets.fetchedAt} error={firstError} />
      </header>

      <Section title="Chamber control" lede="Probability of Democratic control implied by chamber-control contracts only. Needle = consensus; band = range of usable venue values ± half spread; ticks = each venue." id="chambers">
        {chambers.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {chambers.map((s) => (
              <ChamberCard key={s.id} subject={s} now={now} />
            ))}
          </div>
        ) : (
          <Empty>{markets.loading ? "Loading market snapshot…" : "Market snapshot unavailable. The data branch may not have been generated yet; run the refresh-data workflow."}</Empty>
        )}
      </Section>

      <Section title="Probability history" id="history">
        <ProbabilityHistory history={history.data} subjects={subjects} now={now} />
      </Section>

      <Section title="Watchlist" lede="Every tracked market. Sort by any column. Gap is |Polymarket − Kalshi|; 24h Δ is the change in consensus against the snapshot nearest 24 hours ago." id="watchlist">
        {subjects.length ? <Watchlist subjects={subjects} history={history.data} now={now} /> : <Empty>No markets loaded.</Empty>}
      </Section>

      <Section title="Watched races" lede="Markets on the left, counted official results on the right. They are kept apart because prices already reflect returns." id="races">
        <div className="space-y-6">
          {WATCHED_RACES.map((w) => (
            <RacePanel key={w.id} subject={raceSubjects.find((s) => s.id === w.id) ?? null} result={results.data?.races.find((r) => r.id === w.id) ?? null} baselines={baselines} now={now} />
          ))}
        </div>
      </Section>

      <Section title="Coverage gaps" id="gaps">
        <CoverageGaps status={status.data} />
      </Section>

      <Section title="Methodology" id="methodology">
        <Methodology />
      </Section>
    </main>
  );
}
