"use client";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastHistory, ForecastSnapshot, MarketSubjectSnapshot, RaceForecast } from "@/lib/schema";
import { WATCHED_RACES } from "@/lib/registry";
import { Card, Details, Empty } from "@/components/common/Section";
import { Needle, type NeedleTick } from "@/components/needle/Needle";
import { ago, clock, marginLabel, num, pct, pts } from "@/lib/format";

/** Surname for compact labels: drops generational suffixes. */
function surname(name: string | undefined): string {
  if (!name) return "";
  const parts = name.split(/\s+/).filter((t) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(t));
  return parts.at(-1) ?? name;
}

const PHASE: Record<RaceForecast["phase"], { label: string; tone: string }> = {
  "pre-results": { label: "polls open · prior only", tone: "border-line-strong text-fg-3" },
  counting: { label: "counting", tone: "border-warn/50 text-warn" },
  complete: { label: "all units reported", tone: "border-good/50 text-good" },
  official: { label: "official", tone: "border-good/50 text-good" },
};

function Sparkline({ points }: { points: ForecastHistory["series"][string] }) {
  const rows = points.map((p) => ({ t: p[0], p: p[1], w: p[4], f: p[5] }));
  if (rows.length < 2) return <div className="flex h-[72px] items-center text-xs text-fg-3">{rows.length === 1 ? "One forecast snapshot so far." : "Forecast history accumulates as the pipeline runs."}</div>;
  return (
    <div className="h-[72px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
          <YAxis domain={[0, 1]} hide />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--color-line-strong)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as (typeof rows)[number];
              return (
                <div className="rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-xs">
                  <div className="text-fg-3">{new Date(r.t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
                  <div className="num">P(D) {pct(r.p)} · prior {pct(r.w, 0)} · counted {pct(r.f, 0)}</div>
                </div>
              );
            }}
          />
          <Line type="linear" dataKey="p" stroke="var(--color-fg)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RaceForecastCard({ f, market, points }: { f: RaceForecast; market: MarketSubjectSnapshot | null; points: ForecastHistory["series"][string] }) {
  const reg = WATCHED_RACES.find((r) => r.id === f.id);
  const dem = surname(reg?.candidates.find((c) => c.party === "D")?.name);
  const rep = surname(reg?.candidates.find((c) => c.party === "R")?.name);
  const ticks: NeedleTick[] = [];
  if (f.prior.pDem != null) ticks.push({ label: `Market prior${f.prior.locked ? " (frozen at poll close)" : ""}`, value: f.prior.pDem, color: "var(--color-oth)" });
  if (f.data) ticks.push({ label: "Returns only, no prior", value: f.data.pDem, color: "var(--color-warn)" });
  if (market?.consensus.pDem != null) ticks.push({ label: "Market now", value: market.consensus.pDem, color: "var(--color-poly)" });
  const phase = PHASE[f.phase];
  const outstanding = [...f.units].filter((u) => !u.complete).sort((a, b) => b.expected - b.counted - (a.expected - a.counted)).slice(0, 12);
  const lean = f.pDem >= 0.95 ? `${dem} very likely` : f.pDem >= 0.8 ? `${dem} likely` : f.pDem >= 0.6 ? `Lean ${dem}` : f.pDem > 0.4 ? "Toss-up" : f.pDem > 0.2 ? `Lean ${rep}` : f.pDem > 0.05 ? `${rep} likely` : `${rep} very likely`;
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{reg?.label ?? f.label}</h3>
        <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none ${phase.tone}`}>{phase.label}</span>
      </div>
      <div className="mx-auto mt-1 w-full max-w-[280px]">
        <Needle pDem={f.pDem} band={null} ticks={ticks} compact />
      </div>
      <div className="-mt-1 flex items-end justify-between">
        <div>
          <div className="text-xs text-fg-3">{rep} (R)</div>
          <div className="text-xl font-semibold" style={{ fontVariantNumeric: "proportional-nums" }}>{pct(1 - f.pDem, 0)}</div>
        </div>
        <div className="pb-1 text-center text-sm text-fg-2">{lean}</div>
        <div className="text-right">
          <div className="text-xs text-fg-3">{dem} (D)</div>
          <div className="text-xl font-semibold" style={{ fontVariantNumeric: "proportional-nums" }}>{pct(f.pDem, 0)}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-xs text-fg-3">Forecast final margin</dt>
          <dd className="num font-medium" title="Posterior mean ± sd of the final D−R margin">
            {marginLabel(f.marginMean)} <span className="text-xs font-normal text-fg-3">± {f.marginSd.toFixed(1)}</span>
          </dd>
          <dd className="num text-[11px] text-fg-3">80%: {marginLabel(f.interval80.lo)} to {marginLabel(f.interval80.hi)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Market prior weight</dt>
          <dd className="num font-medium">{pct(f.priorWeight, 0)}</dd>
          <dd className="num text-[11px] text-fg-3">prior {f.prior.pDem == null ? "baseline fallback" : `${pct(f.prior.pDem, 0)} D`}{f.prior.asOf ? ` · ${clock(f.prior.asOf)}` : ""}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Counted vs expected</dt>
          <dd className="num font-medium">{pct(f.reportedFraction, 0)}</dd>
          <dd className="num text-[11px] text-fg-3">{num(f.countedVotes)} of ≈{num(f.expectedVotes)} · {f.unitsComplete}/{f.unitsTotal} units complete</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Swing vs {f.baseline.year} ({marginLabel(f.baseline.marginDR)})</dt>
          <dd className="num font-medium">{f.data ? `${pts(f.data.swing)} pt` : "–"}</dd>
          <dd className="num text-[11px] text-fg-3">{f.data ? `± ${f.data.swingSd.toFixed(1)} · returns-only P(D) ${pct(f.data.pDem, 0)}` : "awaiting first counted votes"}</dd>
        </div>
      </dl>
      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 text-xs text-fg-3">Forecast P(D) over time</div>
        <Sparkline points={points} />
      </div>
      {f.notes.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-fg-3">
          {f.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2">
        <Details summary={`Outstanding vote by ${f.state === "VA" ? "locality" : "county"} (${outstanding.length} largest)`}>
          {outstanding.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th className="r">Counted</th>
                    <th className="r">Expected</th>
                    <th className="r">In</th>
                    <th className="r">{f.baseline.year} margin</th>
                    <th className="r">Counted margin</th>
                    <th className="r">Projected</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((u) => (
                    <tr key={u.name}>
                      <td>{u.name}</td>
                      <td className="r">{num(u.counted)}</td>
                      <td className="r">{num(u.expected)}</td>
                      <td className="r">{pct(u.fraction, 0)}</td>
                      <td className="r">{marginLabel(u.baselineMargin)}</td>
                      <td className="r">{marginLabel(u.observedMargin)}</td>
                      <td className="r font-medium text-fg">{marginLabel(u.projectedMargin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-fg-3">Expected vote = {f.baseline.year} vote share of the unit × expected total, scaled by the turnout factor {f.turnoutFactor.toFixed(2)} learned from completed units. Projected = counted votes at their margin plus outstanding votes at the {f.baseline.year} margin plus the estimated swing.</p>
            </div>
          ) : (
            <p className="text-xs text-fg-3">Every unit is fully reported.</p>
          )}
        </Details>
      </div>
      <p className="mt-2 text-[11px] text-fg-3">{f.prior.locked ? "Prior frozen at poll close; it no longer moves with the market." : "Prior tracks the market consensus until polls close, then freezes."}</p>
    </Card>
  );
}

export function ForecastPanel({ forecast, history, subjects, now }: { forecast: ForecastSnapshot | null; history: ForecastHistory | null; subjects: MarketSubjectSnapshot[]; now: number }) {
  const ordered = useMemo(() => WATCHED_RACES.map((w) => forecast?.races.find((r) => r.id === w.id) ?? null).filter((r): r is RaceForecast => r != null), [forecast]);
  if (!forecast) return <Empty>Forecast snapshot not loaded yet. It is written by the same pipeline run as the results; the first run after this feature deploys creates it.</Empty>;
  if (!ordered.length) return <Empty>No race forecasts in the latest snapshot.</Empty>;
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ordered.map((f) => (
          <RaceForecastCard key={f.id} f={f} market={subjects.find((s) => s.id === f.id) ?? null} points={history?.series[f.id] ?? []} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-fg" /> Forecast</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-0.5 bg-oth" /> Market prior</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-0.5 bg-warn" /> Returns only</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-0.5 bg-poly" /> Market now</span>
        <span>Model {forecast.model} · snapshot {ago(forecast.generatedAt, now)}</span>
      </div>
    </div>
  );
}
