import { useMemo } from 'react';

export type Point = { t: number; v: number | null };

/** Dependency-free SVG line/area chart. Gaps (null values) break the line. */
export function LineChart({ points, color = '#f5630f', height = 120, max, unit = '', format }: {
  points: Point[]; color?: string; height?: number; max?: number; unit?: string; format?: (v: number) => string;
}) {
  const W = 600, H = height, P = 6;
  const view = useMemo(() => {
    const vals = points.map(p => p.v).filter((v): v is number => v != null);
    if (!points.length || !vals.length) return null;
    const top = max ?? Math.max(1, ...vals) * 1.1;
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
    const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const y = (v: number) => H - P - (Math.min(v, top) / top) * (H - 2 * P);
    let d = '', area = '', open = false, lastX = 0;
    for (const p of points) {
      if (p.v == null) { if (open) area += `L${lastX},${H - P}Z`; open = false; continue; }
      const px = x(p.t), py = y(p.v);
      d += (open ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
      area += (open ? 'L' : `M${px.toFixed(1)},${H - P}L`) + px.toFixed(1) + ',' + py.toFixed(1);
      open = true; lastX = px;
    }
    if (open) area += `L${lastX},${H - P}Z`;
    return { d, area, top, last: vals[vals.length - 1], peak: Math.max(...vals) };
  }, [points, max, H]);
  const fmt = format ?? ((v: number) => v.toFixed(1) + unit);
  if (!view) return <div className="chart-empty">No data in this period yet.</div>;
  return <div className="chart-box">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Metric trend" style={{ height }}>
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - 2 * P)} y2={H - P - f * (H - 2 * P)} stroke="#2b3034" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
      <path d={view.area} fill={color} opacity=".14"/>
      <path d={view.d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
    </svg>
    <div className="chart-meta"><span>Now <b>{fmt(view.last)}</b></span><span>Peak <b>{fmt(view.peak)}</b></span><span>Scale 0–{fmt(view.top)}</span></div>
  </div>;
}

export function Sparkline({ values, color = '#22a447' }: { values: (number | null)[]; color?: string }) {
  const nums = values.map(v => v ?? 0);
  if (nums.length < 2) return null;
  const hi = Math.max(1, ...nums);
  const d = nums.map((v, i) => `${i ? 'L' : 'M'}${(i / (nums.length - 1)) * 100},${20 - (v / hi) * 18}`).join('');
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="sparkline"><path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg>;
}
