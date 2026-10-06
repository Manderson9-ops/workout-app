/**
 * 가벼운 SVG 차트 (라이브러리 없이, D-020). 점이 많아도 폰에서 빠르게.
 */
export interface Point { label: string; value: number }

export function LineChart({ points, unit, label, height = 140 }: { points: Point[]; unit: string; label: string; height?: number }) {
  if (points.length === 0) return <p class="sub small">기록이 쌓이면 그래프가 보여요</p>;
  const w = 340, h = height, pad = { l: 36, r: 8, t: 10, b: 22 };
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1) { const mid = (max + min) / 2; min = mid - 0.5; max = mid + 0.5; }
  // 범위가 좁으면 축에 소수 한 자리 (예: 72.0 ~ 73.0)
  const fmt = (v: number) => (max - min < 10 ? v.toFixed(1) : String(Math.round(v)));
  const x = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${label}: ${points.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}`}>
      <line x1={pad.l} x2={w - pad.r} y1={y(max)} y2={y(max)} class="ch-grid" />
      <line x1={pad.l} x2={w - pad.r} y1={y(min)} y2={y(min)} class="ch-grid" />
      <text x={pad.l - 4} y={y(max) + 4} class="ch-text" font-size="10" text-anchor="end">{fmt(max)}</text>
      <text x={pad.l - 4} y={y(min) + 4} class="ch-text" font-size="10" text-anchor="end">{fmt(min)}</text>
      <path d={d} class="ch-line" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" class="ch-dot" />)}
      <text x={pad.l} y={h - 6} class="ch-text" font-size="10">{points[0]!.label}</text>
      <text x={w - pad.r} y={h - 6} class="ch-text" font-size="10" text-anchor="end">{last.label} · {last.value}{unit}</text>
    </svg>
  );
}

export function BarChart({ points, unit, label, height = 120, highlightLast = true }: { points: Point[]; unit: string; label: string; height?: number; highlightLast?: boolean }) {
  if (points.length === 0) return <p class="sub small">기록이 쌓이면 그래프가 보여요</p>;
  const w = 340, h = height, pad = { l: 8, r: 8, t: 14, b: 18 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const bw = (w - pad.l - pad.r) / points.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${label}: ${points.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}`}>
      {points.map((p, i) => {
        const bh = ((h - pad.t - pad.b) * p.value) / max;
        const x = pad.l + i * bw + bw * 0.15;
        return (
          <g key={i}>
            <rect x={x} y={h - pad.b - bh} width={bw * 0.7} height={bh} rx="3" class={highlightLast && i === points.length - 1 ? 'ch-bar last' : 'ch-bar'} />
            {p.value > 0 && <text x={x + bw * 0.35} y={h - pad.b - bh - 3} class="ch-val" font-size="10" text-anchor="middle">{p.value}</text>}
            <text x={x + bw * 0.35} y={h - 5} class="ch-text" font-size="10" text-anchor="middle">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
