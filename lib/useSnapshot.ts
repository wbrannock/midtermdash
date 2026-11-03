"use client";
import { useEffect, useRef, useState } from "react";
import type { ZodType } from "zod";
import { DATA_BASE_URL, POLL_MS } from "./config";

export interface Snapshot<T> {
  data: T | null;
  error: string | null;
  /** When the browser last fetched successfully. */
  fetchedAt: number | null;
  loading: boolean;
}

/**
 * Poll a JSON file on the data branch, validate it, and keep the last good copy.
 * Fetches use `cache: "no-store"`; the GitHub raw CDN still serves a copy up to
 * ~5 minutes old, which the UI surfaces via the snapshot's own generatedAt.
 */
export function useSnapshot<T>(file: string, schema: ZodType<T>): Snapshot<T> {
  const [state, setState] = useState<Snapshot<T>>({ data: null, error: null, fetchedAt: null, loading: true });
  const tick = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const my = ++tick.current;
      try {
        const res = await fetch(`${DATA_BASE_URL}/${file}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new Error(`schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        if (!cancelled && my === tick.current) setState({ data: parsed.data, error: null, fetchedAt: Date.now(), loading: false });
      } catch (e) {
        if (!cancelled && my === tick.current) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
    };
    run();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [file, schema]);

  return state;
}
