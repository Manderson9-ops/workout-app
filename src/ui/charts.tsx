/**
 * 가벼운 SVG 차트 (라이브러리 없이, D-020). 점이 많아도 폰에서 빠르게.
 * 폭을 재서 그 폭 그대로 그린다: 넓은 화면에서도 글자 11px·높이 고정 (viewBox 확대로 글자가 커지지 않게).
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface Point { label: string; value: number }
export interface PairPoint { label: string; planned: number; actual: number }

const FS = 11; // 글자 크기(px)

/** 컨테이너 폭(px). ResizeObserver 가 없으면 340 */
function useWidth(): [{ current: HTMLDivElement | null }, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(340);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { const cw = Math.round(el.clientWidth); if (cw > 0) setW(cw); };
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Frame({ label, h, children, render }: { label: string; h: number; children?: ComponentChildren; render: (w: number) => ComponentChildren }) {
  const [ref, w] = useWidth();
  return (
    <div class="chart" ref={ref}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>{render(w)}</svg>
      {children}
    </div>
  );
}

export function LineChart({ points, unit, label, height = 140 }: { points: Point[]; unit: string; label: string; height?: number }) {
  if (points.length === 0) return <p class="sub small">기록이 쌓이면 그래프가 보여요</p>;
  const h = height, pad = { l: 40, r: 8, t: 10, b: 22 };
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1) { const mid = (max + min) / 2; min = mid - 0.5; max = mid + 0.5; }
  // 범위가 좁으면 축에 소수 한 자리 (예: 72.0 ~ 73.0)
  const fmt = (v: number) => (max - min < 10 ? v.toFixed(1) : String(Math.round(v)));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const last = points[points.length - 1]!;
  return (
    <Frame h={h} label={`${label}: ${points.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}`} render={(w) => {
      const x = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
      return (
        <>
          <line x1={pad.l} x2={w - pad.r} y1={y(max)} y2={y(max)} class="ch-grid" />
          <line x1={pad.l} x2={w - pad.r} y1={y(min)} y2={y(min)} class="ch-grid" />
          <text x={pad.l - 4} y={y(max) + 4} class="ch-text" font-size={FS} text-anchor="end">{fmt(max)}</text>
          <text x={pad.l - 4} y={y(min) + 4} class="ch-text" font-size={FS} text-anchor="end">{fmt(min)}</text>
          <path d={d} class="ch-line" />
          {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" class="ch-dot" />)}
          <text x={pad.l} y={h - 6} class="ch-text" font-size={FS}>{points[0]!.label}</text>
          <text x={w - pad.r} y={h - 6} class="ch-text" font-size={FS} text-anchor="end">{last.label} · {last.value}{unit}</text>
        </>
      );
    }} />
  );
}

/** 막대 폭: 칸의 70%, 최대 44px */
const barW = (slot: number) => Math.min(44, slot * 0.7);

export function BarChart({ points, unit, label, height = 130, highlightLast = true }: { points: Point[]; unit: string; label: string; height?: number; highlightLast?: boolean }) {
  if (points.length === 0) return <p class="sub small">기록이 쌓이면 그래프가 보여요</p>;
  const h = height, pad = { l: 8, r: 8, t: 16, b: 20 };
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <Frame h={h} label={`${label}: ${points.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}`} render={(w) => {
      const slot = (w - pad.l - pad.r) / points.length, bw = barW(slot);
      return points.map((p, i) => {
        const bh = ((h - pad.t - pad.b) * p.value) / max;
        const cx = pad.l + i * slot + slot / 2;
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={h - pad.b - bh} width={bw} height={bh} rx="3" class={highlightLast && i === points.length - 1 ? 'ch-bar last' : 'ch-bar'} />
            {p.value > 0 && <text x={cx} y={h - pad.b - bh - 4} class="ch-val" font-size={FS} text-anchor="middle">{p.value.toLocaleString()}</text>}
            <text x={cx} y={h - 6} class="ch-text" font-size={FS} text-anchor="middle">{p.label}</text>
          </g>
        );
      });
    }} />
  );
}

/** 예상(테두리 막대) 위에 실제(채운 막대)를 겹쳐 그림. 실제가 0에 가까워도 2px 는 보이게 */
export function PairBarChart({ points, unit, label, height = 150 }: { points: PairPoint[]; unit: string; label: string; height?: number }) {
  if (points.length === 0) return <p class="sub small">기록이 쌓이면 그래프가 보여요</p>;
  const h = height, pad = { l: 8, r: 8, t: 16, b: 20 };
  const max = Math.max(1, ...points.flatMap((p) => [p.planned, p.actual]));
  const inner = h - pad.t - pad.b;
  const hh = (v: number) => (v > 0 ? Math.max(2, (inner * v) / max) : 0);
  return (
    <Frame h={h} label={`${label}: ${points.map((p) => `${p.label} 예상 ${p.planned}${unit} 실제 ${p.actual}${unit}`).join(', ')}`}
      render={(w) => {
        const slot = (w - pad.l - pad.r) / points.length, bw = barW(slot);
        return points.map((p, i) => {
          const cx = pad.l + i * slot + slot / 2, ph = hh(p.planned), ah = hh(p.actual);
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={h - pad.b - ph} width={bw} height={ph} rx="3" class="ch-plan" />
              <rect x={cx - bw * 0.3} y={h - pad.b - ah} width={bw * 0.6} height={ah} rx="2" class={i === points.length - 1 ? 'ch-bar last' : 'ch-bar'} />
              <text x={cx} y={h - pad.b - Math.max(ph, ah) - 4} class="ch-val" font-size={FS} text-anchor="middle">{p.actual}</text>
              <text x={cx} y={h - 6} class="ch-text" font-size={FS} text-anchor="middle">{p.label}</text>
            </g>
          );
        });
      }}>
      <p class="sub small ch-legend"><span class="lg-plan" aria-hidden="true" />예상 <span class="lg-act" aria-hidden="true" />실제 (분, 막대 위 숫자 = 실제)</p>
    </Frame>
  );
}
