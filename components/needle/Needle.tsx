/**
 * Semicircular gauge: Republican side on the left, Democratic on the right.
 * The needle sits at the consensus probability; the translucent band spans the
 * usable venue values ± half their spread. Venue ticks sit just outside the arc.
 * No animation or jitter: the band is the uncertainty display.
 */
export interface NeedleTick {
  label: string;
  value: number;
  color: string;
}

export function Needle({ pDem, band, ticks, size = 300, compact = false }: { pDem: number | null; band: { lo: number; hi: number } | null; ticks: NeedleTick[]; size?: number; compact?: boolean }) {
  const w = size;
  const cx = w / 2;
  const r = w * 0.4;
  const cy = r + 18;
  const h = cy + (compact ? 14 : 30);
  const angle = (p: number) => Math.PI * (1 - p); // p=0 → π (left, R), p=1 → 0 (right, D)
  const pt = (p: number, rad: number) => [cx + rad * Math.cos(angle(p)), cy - rad * Math.sin(angle(p))] as const;
  const arc = (a: number, b: number, rad: number) => {
    const [x1, y1] = pt(a, rad);
    const [x2, y2] = pt(b, rad);
    const large = Math.abs(b - a) > 0.5 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const zones = [
    { from: 0, to: 0.15, color: "var(--color-rep)", alpha: 0.55 },
    { from: 0.15, to: 0.35, color: "var(--color-rep)", alpha: 0.28 },
    { from: 0.35, to: 0.65, color: "var(--color-oth)", alpha: 0.22 },
    { from: 0.65, to: 0.85, color: "var(--color-dem)", alpha: 0.28 },
    { from: 0.85, to: 1, color: "var(--color-dem)", alpha: 0.55 },
  ];
  const gap = 0.004;
  const stroke = compact ? 7 : 10;
  const needleLen = r - stroke - 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={pDem == null ? "No consensus available" : `Consensus probability of Democratic control ${(pDem * 100).toFixed(1)} percent`} className="block overflow-visible">
      {zones.map((z) => (
        <path key={z.from} d={arc(z.from + gap, z.to - gap, r)} stroke={z.color} strokeOpacity={z.alpha} strokeWidth={stroke} fill="none" strokeLinecap="butt" />
      ))}
      {band && band.hi > band.lo ? <path d={arc(band.lo, band.hi, r)} stroke="var(--color-fg)" strokeOpacity={0.35} strokeWidth={stroke + 6} fill="none" /> : null}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const [x1, y1] = pt(p, r + stroke / 2 + 2);
        const [x2, y2] = pt(p, r + stroke / 2 + 6);
        return <line key={p} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-line-strong)" strokeWidth={1} />;
      })}
      {ticks.map((t) => {
        const [x1, y1] = pt(t.value, r + stroke / 2 + 3);
        const [x2, y2] = pt(t.value, r + stroke / 2 + 11);
        return (
          <g key={t.label}>
            <title>{`${t.label}: ${(t.value * 100).toFixed(1)}%`}</title>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={t.color} strokeWidth={2.5} strokeLinecap="round" />
          </g>
        );
      })}
      {pDem != null ? (
        <g>
          <line x1={cx} y1={cy} x2={pt(pDem, needleLen)[0]} y2={pt(pDem, needleLen)[1]} stroke="var(--color-fg)" strokeWidth={2} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={compact ? 3.5 : 5} fill="var(--color-fg)" />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={compact ? 3.5 : 5} fill="var(--color-fg-3)" />
      )}
      {!compact ? (
        <>
          <text x={pt(0, r)[0] - 2} y={cy + 20} fontSize={12} fill="var(--color-fg-3)" textAnchor="start">
            R
          </text>
          <text x={pt(1, r)[0] + 2} y={cy + 20} fontSize={12} fill="var(--color-fg-3)" textAnchor="end">
            D
          </text>
          <text x={cx} y={cy - r - stroke - 6} fontSize={11} fill="var(--color-fg-3)" textAnchor="middle">
            50
          </text>
        </>
      ) : null}
    </svg>
  );
}
