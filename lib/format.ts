export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}
export function pts(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s;
}
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function clock(iso: string | null | undefined): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t);
}
/** D−R margin formatted with the leading party. */
export function marginLabel(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "–";
  if (Math.abs(m) < 0.005) return "even";
  return `${m > 0 ? "D" : "R"} +${Math.abs(m).toFixed(1)}`;
}
