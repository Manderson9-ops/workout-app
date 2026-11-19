/** D-081 기간 요약 카드: 주·월·년 전환, 이전 기간과 비교 한 문장, 지표 카드 4개, 막대 그래프 (Apple 피트니스 요약 모양) */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import type { Workout } from '../../core/session';
import type { Exercise } from '../../core/types';
import { weekStreak } from '../../core/stats';
import { periodOf, shiftPeriod, periodBuckets, compareThroughFor, hasWorkoutOn, waitingForToday, averageOver, offsetOf, daysInMonth, daysInYear, periodData, earliestPeriod } from '../../core/period';
import type { PeriodKind, PeriodMetric } from '../../core/period';
import { METRICS, METRIC_NAME, KIND_LABEL, valueText, bigParts, tonMode, cmpValues, wholePrevMonth, WAITING_LINE, prevNote, avgParts, metricValue, periodLabel, rangeText, compareLine, headline, cardAria, bucketText, footnoteParts } from '../../core/periodText';
import { WD } from '../../core/dateText';
import { parsePeriodPref, serializePeriodPref } from '../../core/periodPref';
import { PeriodBars } from '../charts';
import type { BucketState } from '../charts';

const KEY = 'stats.period.v1';
const KINDS: PeriodKind[] = ['week', 'month', 'year'];
const UNIT_WORD: Record<PeriodKind, string> = { week: '주', month: '달', year: '해', all: '전체' };

// 보기(mode)는 저장만 하고 아직 쓰지 않음, 전체 탭('all')도 이 화면에는 아직 없어 주로 되돌림
function readPref(): { kind: PeriodKind; metric: PeriodMetric } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 못 읽으면 기본값 */ }
  const p = parsePeriodPref(raw);
  return { kind: p.kind === 'all' ? 'week' : p.kind, metric: p.metric };
}
function writePref(kind: PeriodKind, metric: PeriodMetric) {
  try { localStorage.setItem(KEY, serializePeriodPref({ kind, metric, mode: parsePeriodPref(localStorage.getItem(KEY)).mode })); } catch { /* 저장 못 해도 화면은 동작 */ }
}

export function PeriodCard({ done, byId, today, bw }: { done: Workout[]; byId: Map<string, Exercise>; today: string; bw: AppState['bodyweight'] }) {
  const [pref, setPref] = useState(readPref);
  const { kind, metric } = pref;
  // 보는 기간: null = 이번 기간(자정·월말을 넘으면 새 이번 기간), 아니면 보던 지난 기간의 시작 날짜 (자정을 넘겨도 같은 날짜 범위). 몇 기간 전인지는 그리면서 셈
  const [anchor, setAnchor] = useState<string | null>(null);
  const off = anchor ? offsetOf(kind, anchor, today) : 0;
  const [sel, setSel] = useState<number | null>(null);
  const setKind = (k: PeriodKind) => { if (k === kind) return; setPref({ kind: k, metric }); writePref(k, metric); setAnchor(null); setSel(null); };
  const setMetric = (m: PeriodMetric) => { setPref({ kind, metric: m }); writePref(kind, m); };
  const day0 = useRef(today);
  useEffect(() => { if (day0.current !== today) { day0.current = today; setSel(null); } }, [today]); // 날이 바뀌면 고른 칸만 비움 (처음 그릴 때는 건드리지 않음)
  const go = (n: number) => { setAnchor(n <= 0 ? null : shiftPeriod(periodOf(kind, today), -n).start); setSel(null); };

  const current = off === 0;
  const range = useMemo(() => shiftPeriod(periodOf(kind, today), -off), [kind, today, off]);
  const earliest = useMemo(() => earliestPeriod(done, kind, today), [done, kind, today]);
  const todayDone = useMemo(() => hasWorkoutOn(done, today), [done, today]);
  const through = useMemo(() => compareThroughFor(periodOf(kind, today), today, todayDone), [kind, today, todayDone]);
  const baseThrough = useMemo(() => compareThroughFor(periodOf(kind, today), today, true), [kind, today]);
  const { cur, prev, buckets } = useMemo(() => ({
    cur: periodData(done, byId, range, bw, current ? today : undefined), // 오늘 뒤 날짜 기록은 이번 기간에 안 셈
    prev: periodData(done, byId, shiftPeriod(range, -1), bw, current ? through : undefined),
    buckets: periodBuckets(range),
  }), [done, byId, range, bw, current, through, today]);
  const streak = useMemo(() => weekStreak(done, today), [done, today]);

  const t = cur.totals, p = prev.totals;
  const label = periodLabel(range, off, today);
  const names = UNIT_WORD[kind];
  const vals = cur.series[metric];
  const state: BucketState[] = buckets.map((b) => (b.start > today ? 'future' : today < b.end ? 'now' : 'past'));
  const xLabels = buckets.map((b, i) => {
    const d = Number(b.start.slice(8));
    if (kind === 'week') return `${state[i] === 'now' ? '오늘' : WD[i]}\n${d}`;
    if (kind === 'month') return [1, 8, 15, 22, 29].includes(d) ? String(d) : '';
    return String(i + 1);
  });
  const lastOk = state.reduce((m, s, i) => (s !== 'future' ? i : m), 0);
  const selv = sel !== null && sel <= lastOk ? sel : null; // 날이 바뀌어 미래가 된 칸은 고른 것으로 안 침
  const { value: avgV, n: avgN, excluded: avgExcl } = averageOver(kind, vals, cur.active, state); // 년 보기는 진행 중인 이번 달을 평균에서 뺌
  const whole = wholePrevMonth(kind, current, { through, today, done: todayDone }); // 이번 달이 더 길어 지난달 전체와 견줌
  const wholeDays = whole ? Number(through.slice(8)) : 0;
  const empty = !cur.active.some(Boolean);
  const waiting = current && waitingForToday(periodOf(kind, today), today, todayDone); // 첫날·운동 전: 견줄 구간이 비어 있음
  // 평균선·범례: 운동한 칸이 둘 이상이고 평균이 최댓값과 같지 않을 때만 (한 칸뿐이면 같은 값이 되풀이됨)
  const showAvg = avgV > 0 && avgN >= 2 && avgV < Math.max(...vals) && !(metric === 'count' && kind !== 'year');
  const ton = tonMode(t.volume, p.volume);
  const avgLeg = avgParts(kind, metric, avgV, ton, avgExcl);
    /** 한 칸 문구: "11월 16일 (월) · 작업 세트 9세트 · 운동 1회" (일·월 보기에서 지표가 운동 수가 아니면 운동한 칸에 횟수를 덧붙임) */
  const bucketLine = (i: number) => !cur.active[i] ? `${bucketText(kind, buckets[i]!.start)} · 운동 안 함` : `${bucketText(kind, buckets[i]!.start)} · ${METRIC_NAME[metric]} ${valueText(metric, vals[i]!, ton)}${kind !== 'year' && metric !== 'count' ? ` · 운동 ${cur.series.count[i]}회` : ''}`;
  const total = `합계 · ${METRIC_NAME[metric]} ${valueText(metric, vals.reduce((a, b) => a + b, 0), ton)}`;
  const caption = empty ? '' : selv === null ? `막대를 누르거나 옆으로 밀면 ${kind === 'year' ? '달별' : '날짜별'} 값이 보여요` : bucketLine(selv!);
  const atEnd = range.start <= earliest;

  const headParts = headline({ kind, current, metric, cur: metricValue(metric, t), prev: metricValue(metric, p), curCount: t.count, prevCount: p.count, label, whole });
  return (
    <section class="card" data-testid="this-week">
      <div class="ps-seg" role="group" aria-label="기간 단위">
        {KINDS.map((k) => <button key={k} class={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      <div class="ps-nav">
        <button aria-label={`이전 ${names}`} disabled={atEnd} onClick={() => go(off + 1)}>‹</button>
        <div class="ps-mid">
          <strong data-testid="period-label">{label}</strong>
          <span class="sub small" data-testid="period-range">{off <= 1 && <><span class="nw">{rangeText(range, today)}</span>{' '}</>}<span class="nw">{compareLine(kind, current, whole)}</span></span>
        </div>
        <button aria-label={`다음 ${names}`} disabled={current} onClick={() => go(off - 1)}>›</button>
      </div>
      <p class="ps-headline" data-testid="period-headline" aria-live="polite" aria-atomic="true">{!headParts.some((h) => h.text.startsWith(label)) && <span class="sr-only">{label}: </span>}{headParts.map((h, i) => (h.nw ? <span key={i} class="nw">{h.text}</span> : h.text))}</p>
      <div class="sub small ps-caption" data-testid="period-caption">{caption}</div>
      {showAvg && !empty && <div class="sub small ps-legend" data-testid="period-avg"><span class="ps-swatch" aria-hidden="true" />{avgLeg.label} <span class="nw" data-testid="period-avg-value">{avgLeg.value}</span></div>}
      <PeriodBars values={vals} labels={xLabels} state={state} selected={selv} onSelect={setSel}
        dots={kind === 'year' ? undefined : cur.active} avg={showAvg ? avgV : undefined} fmt={(v) => valueText(metric, v, ton)}
        valueText={bucketLine} jump={kind === 'year' ? 3 : 7}
        labelClass={kind === 'week' ? ['sun', '', '', '', '', '', 'sat'] : undefined}
        empty={empty ? (current ? '운동을 끝내면 여기에 막대가 생겨요' : '이 기간에는 운동 기록이 없어요') : undefined}
        summary={`${total} · 방향키로 칸을 고르면 ${kind === 'year' ? '달별' : '날짜별'} 값`} label={`${kind === 'year' ? '월별' : '일별'} ${METRIC_NAME[metric]} 그래프`} />
      {!waiting && <p class="sub small pm-note" data-testid="pm-note">{prevNote(kind, current, whole)}</p>}
      <div class="pm-grid">
        {METRICS.map((m) => {
          const c = metricValue(m, t), pv = metricValue(m, p);
          const tn = m === 'volume' && ton;
          const parts = bigParts(m, c, tn);
          const [cc, cp] = cmpValues(m, c, pv, tn);
          const dir = cc > cp ? 'up' : cc < cp ? 'down' : 'same';
          return (
            <button key={m} class={`pm-card${metric === m ? ' on' : ''}`} aria-pressed={metric === m} data-testid={`pm-${m}`}
              aria-label={cardAria({ kind, current, metric: m, cur: c, prev: pv, ton: tn, waiting, partialThrough: current && !todayDone ? through : undefined, wholeDays })} onClick={() => setMetric(m)}>
              <span class="pm-top">{!waiting && <span class={`pm-badge ${dir}`} aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='}</span>}<span class="m-label" aria-hidden="true">{METRIC_NAME[m]}</span></span>
              <span class={`m-val${m === 'time' && c >= 3600000 ? ' xlong' : m === 'time' && c >= 360000 ? ' long' : ''}`} aria-hidden="true">{parts.map(([n, u], i) => <span key={i} class="m-pair"><span class="num">{n}</span>{u && <span class="unit">{u}</span>}</span>)}</span>
              <span class={`pm-prev${m === 'time' && pv >= 3600000 ? ' xlong' : ''}`} aria-hidden="true">{waiting ? WAITING_LINE : `이전 ${valueText(m, pv, tn)}`}</span>
            </button>
          );
        })}
      </div>
      <p class="sub small" style={{ margin: '8px 0 0' }}>{footnoteParts(kind, current, { through, base: baseThrough, done: todayDone, streak, today, waiting, lens: kind === 'year' ? [daysInYear(Number(range.start.slice(0, 4))), daysInYear(Number(range.start.slice(0, 4)) - 1)] : kind === 'month' ? [buckets.length, daysInMonth(Number(range.start.slice(0, 4)) - (range.start.slice(5, 7) === '01' ? 1 : 0), range.start.slice(5, 7) === '01' ? 12 : Number(range.start.slice(5, 7)) - 1)] : undefined }).map((h, i) => (h.nw ? <span key={i} class="nw">{h.text}</span> : h.text))}</p>
    </section>
  );
}
