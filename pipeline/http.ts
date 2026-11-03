/**
 * Minimal fetch wrapper: hard timeout, conservative retries with jittered
 * backoff on network errors / 429 / 5xx, and a structured result so callers
 * never throw on provider failure.
 */

export type FetchOk<T> = { ok: true; data: T; status: number; durationMs: number; url: string };
export type FetchErr = { ok: false; error: string; status: number | null; durationMs: number; url: string };
export type FetchResult<T> = FetchOk<T> | FetchErr;

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Maximum accepted body size in bytes (protects against runaway responses). */
  maxBytes?: number;
}

const DEFAULTS = { timeoutMs: 10_000, retries: 2, maxBytes: 12 * 1024 * 1024 };
const UA = "midtermdash-pipeline/1.0 (+https://github.com/wbrannock/midtermdash)";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function once(url: string, opts: FetchOptions): Promise<FetchResult<string>> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULTS.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json, text/csv, text/plain;q=0.9, */*;q=0.8", "user-agent": UA, ...opts.headers },
      redirect: "follow",
    });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > (opts.maxBytes ?? DEFAULTS.maxBytes)) {
      return { ok: false, error: `response too large (${len} bytes)`, status: res.status, durationMs: Date.now() - started, url };
    }
    const text = await res.text();
    if (text.length > (opts.maxBytes ?? DEFAULTS.maxBytes)) {
      return { ok: false, error: `response too large (${text.length} chars)`, status: res.status, durationMs: Date.now() - started, url };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: res.status, durationMs: Date.now() - started, url };
    }
    return { ok: true, data: text, status: res.status, durationMs: Date.now() - started, url };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
    return { ok: false, error: msg, status: null, durationMs: Date.now() - started, url };
  } finally {
    clearTimeout(timer);
  }
}

function retryable(r: FetchErr): boolean {
  return r.status == null || r.status === 429 || r.status >= 500;
}

export async function getText(url: string, opts: FetchOptions = {}): Promise<FetchResult<string>> {
  const retries = opts.retries ?? DEFAULTS.retries;
  let last: FetchResult<string> = await once(url, opts);
  for (let attempt = 1; attempt <= retries && !last.ok && retryable(last); attempt++) {
    await sleep(400 * 2 ** (attempt - 1) + Math.random() * 300);
    last = await once(url, opts);
  }
  return last;
}

export async function getJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<FetchResult<T>> {
  const r = await getText(url, opts);
  if (!r.ok) return r;
  try {
    return { ...r, data: JSON.parse(r.data) as T };
  } catch {
    return { ok: false, error: "invalid JSON", status: r.status, durationMs: r.durationMs, url };
  }
}

/** Run async tasks with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
