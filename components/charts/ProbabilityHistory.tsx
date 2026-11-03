"use client";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistorySnapshot, MarketSubjectSnapshot } from "@/lib/schema";
import { Card } from "@/components/common/Section";

const RANGES = [
  { key: "24h", ms: 24 * 3600_000 },
  { key: "72h", ms: 72 * 3600_000 },
  { key: "7d", ms: 7 * 24 * 3600_000 },
  { key: "all", ms: Infinity },
] as const;

type Row = { t: number; polymarket: number | null; kalshi: number | null; consensus: number | null };

function fmtTick(t: number, spanMs: number): string {
  const d = new Date(t * 1000);
  if (spanMs <= 72 * 3600_000) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TipContent({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  const line = (label: string, v: number | null, color: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-fg-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="num">{v == null ? "–" : `${(v * 100).toFixed(1)}%`}</span>
    </div>
  );
  return (
    <div className="rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-none">
      <div className="mb-1 text-fg-3">{new Date(row.t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
      {line("Consensus", row.consensus, "var(--color-fg)")}
      {line("Polymarket", row.polymarket, "var(--color-poly)")}
      {line("Kalshi", row.kalshi, "var(--color-kalshi)")}
    </div>
  );
}

export function ProbabilityHistory({ history, subjects, now }: { history: HistorySnapshot | null; subjects: MarketSubjectSnapshot[]; now: number }) {
  const [subjectId, setSubjectId] = useState("house");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("72h");
  const spanMs = RANGES.find((r) => r.key === range)!.ms;
  const rows = useMemo<Row[]>(() => {
    const pts = history?.series[subjectId] ?? [];
    const cutoff = Number.isFinite(spanMs) ? (now - spanMs) / 1000 : -Infinity;
    return pts.filter((p) => p[0] >= cutoff).map((p) => ({ t: p[0], polymarket: p[1], kalshi: p[2], consensus: p[3] }));
  }, [history, subjectId, spanMs, now]);
  const subject = subjects.find((s) => s.id === subjectId);
  const latest = rows.at(-1);
  const first = rows[0];
  const delta = latest?.consensus != null && first?.consensus != null ? latest.consensus - first.consensus : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Subject">
          {subjects.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === subjectId} onClick={() => setSubjectId(s.id)} className={`rounded-sm px-2.5 py-1 text-sm ${s.id === subjectId ? "bg-surface-2 text-fg" : "text-fg-3 hover:text-fg-2"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.key} role="tab" aria-selected={r.key === range} onClick={() => setRange(r.key)} className={`rounded-sm px-2 py-1 text-xs ${r.key === range ? "bg-surface-2 text-fg" : "text-fg-3 hover:text-fg-2"}`}>
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-3">
        <span>P(Democratic) over time, {subject?.label.toLowerCase() ?? subjectId}</span>
        {delta != null ? <span className="num">change over range {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)} pt</span> : null}
        <span className="num">{rows.length} snapshots</span>
      </div>
      <div className="mt-3 h-[280px] w-full">
        {rows.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-3">History accumulates as the pipeline runs. {rows.length === 1 ? "One snapshot so far." : "No snapshots yet."}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => fmtTick(t, spanMs)} tick={{ fill: "var(--color-fg-3)", fontSize: 11 }} axisLine={{ stroke: "var(--color-line-strong)" }} tickLine={false} minTickGap={48} />
              <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--color-fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={(p) => <TipContent active={p.active} payload={p.payload} />} cursor={{ stroke: "var(--color-line-strong)" }} isAnimationActive={false} />
              <Line type="linear" dataKey="polymarket" stroke="var(--color-poly)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              <Line type="linear" dataKey="kalshi" stroke="var(--color-kalshi)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              <Line type="linear" dataKey="consensus" stroke="var(--color-fg)" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-fg" /> Consensus</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-poly" /> Polymarket</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-kalshi" /> Kalshi</span>
        <span>Points are pipeline snapshots (≈5 min on election night, hourly beyond 72 h, 30-day retention).</span>
      </div>
    </Card>
  );
}
