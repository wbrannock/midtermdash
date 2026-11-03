"use client";
import { useEffect, useState } from "react";
import type { StatusSnapshot } from "@/lib/schema";
import { ago, clock } from "@/lib/format";
import { REPO_URL } from "@/lib/config";

export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Freshness({ status, generatedAt, fetchedAt, error }: { status: StatusSnapshot | null; generatedAt: string | null; fetchedAt: number | null; error: string | null }) {
  const now = useNow();
  const sources = status ? Object.values(status.sources) : [];
  const ok = sources.filter((s) => s.ok).length;
  const ageMs = generatedAt ? now - Date.parse(generatedAt) : null;
  const tone = ageMs == null ? "bg-fg-3" : ageMs < 12 * 60_000 ? "bg-good" : ageMs < 60 * 60_000 ? "bg-warn" : "bg-critical";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />
        <span>
          snapshot {generatedAt ? `${ago(generatedAt, now)} (${clock(generatedAt)})` : "not loaded"}
        </span>
      </span>
      <span>browser fetch {fetchedAt ? ago(new Date(fetchedAt).toISOString(), now) : "–"}</span>
      {status ? (
        <span>
          sources {ok}/{sources.length} ok · mode {status.windowMode}
          {status.retained.length ? ` · ${status.retained.length} retained` : ""}
        </span>
      ) : null}
      {status?.runUrl ? (
        <a className="underline decoration-line-strong hover:text-fg-2" href={status.runUrl} target="_blank" rel="noreferrer">
          run {status.runId}
        </a>
      ) : null}
      <a className="underline decoration-line-strong hover:text-fg-2" href={REPO_URL} target="_blank" rel="noreferrer">
        source
      </a>
      {error ? <span className="text-critical">fetch error: {error}</span> : null}
    </div>
  );
}
