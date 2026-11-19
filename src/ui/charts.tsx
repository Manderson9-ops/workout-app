/**
 * 가벼운 SVG 차트 (라이브러리 없이, D-020). 점이 많아도 폰에서 빠르게.
 * 폭을 재서 그 폭 그대로 그린다: 넓은 화면에서도 글자 11px·높이 고정 (viewBox 확대로 글자가 커지지 않게).
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { loadVd, loadZone } from '../core/stats';
import { WD } from '../core/dateText';

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

export type BucketState = 'past' | 'now' | 'future';

/**
 * D-081 기간 막대 그래프 (주·월·년). 그래프 전체가 슬라이더 하나: 화살표(↑↓ 포함)·PageUp/Down·Home·End·Esc, 손가락·마우스로 훑어 고름.
 * 손가락: 세로로 끌면 화면 스크롤(고르지 않음), 가로로 8px 넘게 끌면 훑기, 거의 안 움직이고 떼면 탭(고름/다시 탭하면 해제).
 * 미래 칸은 못 고름. x 라벨의 줄바꿈('\n')은 두 줄. 맨 위 줄은 최댓값 눈금, 평균선은 점선(글씨는 그래프 밖 범례)
 */
export function PeriodBars({ values, labels, labelClass, empty, state, dots, avg, selected, onSelect, valueText, fmt, label, summary, jump = 7, height = 150 }: {
  values: number[]; labels: string[]; state: BucketState[];
  /** x 라벨별 글자색 클래스 ('sun' · 'sat', D-054 일요일 빨강·토요일 파랑) */
  labelClass?: string[];
  /** 기록이 없을 때 그래프 대신 보여 줄 한 줄 (슬라이더 없음) */
  empty?: string;
  /** 운동한 칸 표시 (기준선 아래 작은 점) */
  dots?: boolean[];
  /** 평균선 값 (글씨 없음) */
  avg?: number;
  selected: number | null; onSelect: (i: number | null) => void;
  /** 고른 칸 문구 (aria-valuetext) */
  valueText: (i: number) => string;
  /** 맨 위 눈금 값 문구 */
  fmt: (v: number) => string;
  label: string;
  /** 고른 칸이 없을 때 aria-valuetext */
  summary: string;
  /** PageUp/PageDown 으로 건너뛰는 칸 수 */
  jump?: number;
  height?: number;
}) {
  const [ref, w] = useWidth();
  const n = values.length;
  const twoLine = labels.some((l) => l.includes('\n'));
  const h = height, pad = { l: 8, r: 8, t: 20, b: twoLine ? 40 : 26 };
  const inner = h - pad.t - pad.b;
  const max = Math.max(1, ...values, avg ?? 0);
  const slot = (w - pad.l - pad.r) / n;
  const bw = Math.min(34, slot * 0.64);
  const lastOk = (() => { for (let i = n - 1; i >= 0; i--) if (state[i] !== 'future') return i; return 0; })();
  const gest = useRef<{ x: number; y: number; before: number | null; mode: 'wait' | 'scrub' | 'dead' } | null>(null);
  const raw = (e: PointerEvent) => slot > 0 ? Math.floor((e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left - pad.l) / slot) : -1;
  const clamp = (i: number) => Math.max(0, Math.min(lastOk, i));
  const key = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // 브라우저 뒤로 가기 등 단축키는 막지 않음
    if (e.key === 'Escape' && selected !== null) { e.preventDefault(); onSelect(null); return; }
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? jump : e.key === 'PageDown' ? -jump : 0;
    const to = d ? (selected === null ? lastOk : selected + d) : e.key === 'Home' ? 0 : e.key === 'End' ? lastOk : null; // 고른 칸이 없으면 첫 키는 오늘(현재) 칸을 고름
    if (to === null) return;
    e.preventDefault();
    onSelect(clamp(to));
  };
  const y = (v: number) => pad.t + inner - inner * (v / max);
  const hasData = values.some((v) => v > 0);
  if (empty) return <div class="pb-empty" ref={ref} data-testid="period-chart-empty">{empty}</div>;
  return (
    <div class="pbars" ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={1} aria-valuemax={lastOk + 1}
      aria-valuenow={(selected ?? lastOk) + 1} aria-valuetext={selected === null ? summary : valueText(selected)} data-testid="period-chart"
      onKeyDown={key}
      onPointerDown={(e) => {
        if (slot <= 0 || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return; // 폭 0·둘째 손가락·오른쪽 버튼은 무시
        gest.current = { x: e.clientX, y: e.clientY, before: selected, mode: 'wait' };
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* 합성 이벤트 등 */ }
      }}
      onPointerMove={(e) => {
        if (!e.isPrimary) return;
        if (e.pointerType === 'mouse' && e.buttons === 0) { gest.current = null; return; } // 버튼을 이미 뗀 마우스: 제스처 끝 (고름 그대로)
        const g = gest.current; if (!g || g.mode === 'dead') return;
        if (g.mode === 'wait') {
          const adx = Math.abs(e.clientX - g.x), ady = Math.abs(e.clientY - g.y);
          if (adx >= 8 && adx > ady) g.mode = 'scrub';
          else if (ady >= 8) { g.mode = 'dead'; return; }
          else return;
        }
        onSelect(clamp(raw(e)));
      }}
      onPointerUp={(e) => {
        if (!e.isPrimary) return;
        const g = gest.current; gest.current = null;
        if (!g || g.mode !== 'wait') return;
        const i = raw(e);
        if (i < 0 || i > lastOk) return; // 미래 칸·바깥은 못 고름
        onSelect(selected === i ? null : i);
      }}
      onLostPointerCapture={() => { gest.current = null; }}
      onPointerCancel={() => { const g = gest.current; gest.current = null; if (g && g.mode === 'scrub') onSelect(g.before); }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
        {hasData && <line x1={pad.l} x2={w - pad.r} y1={pad.t} y2={pad.t} class="ch-grid pb-top" />}
        {hasData && <text x={w - pad.r} y={pad.t - 5} class="ch-text" font-size={FS} text-anchor="end">{fmt(max)}</text>}
        <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} class="ch-grid" />
        {values.map((v, i) => {
          const cx = pad.l + i * slot + slot / 2;
          const bh = v > 0 ? Math.max(2, inner * (v / max)) : 2;
          const cls = `pb-bar ${state[i]}${selected === null ? '' : selected === i ? ' sel' : ' dim'}`;
          const lines = (labels[i] ?? '').split('\n');
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={h - pad.b - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)} class={cls} />
              {dots?.[i] && <circle cx={cx} cy={h - pad.b + 5} r="2.5" class="pb-dot" />}
              {lines.map((t, k) => t && <text key={k} x={cx} y={h - pad.b + 20 + k * 13} class={`ch-text${selected === i ? ' pb-sel-text' : ''}${labelClass?.[i] ? ` ${labelClass[i]}` : ''}`} font-size={FS} text-anchor="middle">{t}</text>)}
            </g>
          );
        })}
        {avg !== undefined && avg > 0 && <line x1={pad.l} x2={w - pad.r} y1={y(avg)} y2={y(avg)} class="pb-avg" />}
      </svg>
    </div>
  );
}

/**
 * D-082 훈련 부하 7일 점 그래프: 실선 = 최근 7일 비율, 점선 = 각각 7일 전. 점 위치·세로 범위는 원래 값, 점 옆 숫자·오늘 점 색은 화면 값(vd).
 * 구간 색 띠·기준선은 세로 범위 안에서만. 비율이 없는 날은 점 대신 "–", 실선은 빈 날을 건너뛰어 잇는다
 */
export function LoadDots({ days, rs, rp, lo, hi, label, height = 130 }: { days: string[]; rs: (number | null)[]; rp: (number | null)[]; lo: number; hi: number; label: string; height?: number }) {
  const pl = 20, pr = 34, pt = 16, pb = 34, inner = height - pt - pb;
  const y = (v: number) => pt + inner - (inner * (Math.min(Math.max(v, lo), hi) - lo)) / (hi - lo);
  return (
    <Frame h={height} label={label} render={(w) => {
      const sx = (w - pl - pr) / 6, x = (i: number) => pl + i * sx;
      const pts = (arr: (number | null)[]) => arr.flatMap((r, i) => (r === null ? [] : [{ i, r }]));
      const ps = pts(rp), ss = pts(rs);
      const poly = (a: { i: number; r: number }[]) => a.map((p) => `${x(p.i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
      return (
        <>
          {([[0, 0.8, 'low'], [0.8, 1.3, 'ok'], [1.3, 1.5, 'warn'], [1.5, 99, 'bad']] as const).map(([a, b, z]) => {
            const a2 = Math.max(a, lo), b2 = Math.min(b, hi);
            return b2 > a2 ? <rect key={z} x={pl} y={y(b2)} width={w - pl - pr} height={y(a2) - y(b2)} class={`ld-band ${z}`} /> : null;
          })}
          {[0.8, 1.3, 1.5].filter((t) => t > lo && t < hi).map((t) => (
            <g key={t}>
              <line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} class="ch-grid" />
              <text x={w - 4} y={y(t) + 4} class="ch-text" font-size={FS} text-anchor="end">{t.toFixed(1)}</text>
            </g>
          ))}
          {ps.length > 1 && <polyline points={poly(ps)} class="ld-prev-line" />}
          {ps.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.r)} r="2.5" class="ld-prev-dot" />)}
          {ss.length > 1 && <polyline points={poly(ss)} class="ld-line" />}
          {rs.map((r, i) => {
            const last = i === rs.length - 1, [yy, mm, dd] = (days[i] ?? '').split('-').map(Number);
            const wd = WD[new Date(yy!, mm! - 1, dd!).getDay()];
            return (
              <g key={i}>
                {r === null
                  ? <text x={x(i)} y={pt + inner / 2} class="ch-text" font-size={FS} text-anchor="middle">–</text>
                  : <>
                      <circle cx={x(i)} cy={y(r)} r={last ? 6 : 4} class={last ? `ld-today ${loadZone(loadVd(r))}` : 'ld-dot'} />
                      <text x={x(i)} y={Math.max(FS, y(r) - 9)} class="ch-val" font-size={FS} text-anchor="middle">{loadVd(r).toFixed(2)}</text>
                    </>}
                <text x={x(i)} y={height - 18} class={last ? 'ch-val ld-today-text' : 'ch-text'} font-size={FS} text-anchor="middle">{wd}</text>
                <text x={x(i)} y={height - 5} class="ch-text" font-size={FS} text-anchor="middle">{dd}</text>
              </g>
            );
          })}
        </>
      );
    }} />
  );
}
