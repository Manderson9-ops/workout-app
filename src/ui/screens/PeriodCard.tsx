/** D-081·D-082 기간 요약 카드: 주·월·년·전체 전환, 큰 숫자, 이전 기간과 비교 한 문장, 그래프 보기 3종(누적·막대·막대+누적), 지표 카드 4개 (Apple 피트니스 요약 모양) */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import type { Workout } from '../../core/session';
import type { Exercise } from '../../core/types';
import { weekStreak } from '../../core/stats';
import { periodOf, shiftPeriod, periodBuckets, compareThroughFor, hasWorkoutOn, averageOver, offsetOf, daysInMonth, daysInYear, periodData, firstRecordDate, comparePlan } from '../../core/period';
import type { PeriodKind, PeriodMetric, ComparePlan, PeriodRange, Bucket } from '../../core/period';
import { METRICS, METRIC_NAME, KIND_LABEL, valueText, bigParts, tonMode, cmpValues, wholePrevMonth, prevNote, avgParts, metricValue, periodLabel, rangeText, compareLine, headline, headSubs, heroLabel, cardAria, cardSmall, bucketText, footnoteParts, chartCaption, comboLine, legendNames, prevName } from '../../core/periodText';
import { WD } from '../../core/dateText';
import { parsePeriodPref, serializePeriodPref } from '../../core/periodPref';
import type { ChartMode, PeriodPref } from '../../core/periodPref';
import { PeriodBars, PeriodCum } from '../charts';
import type { BucketState } from '../charts';

const KEY = 'stats.period.v1';
const KINDS: PeriodKind[] = ['week', 'month', 'year', 'all'];
const UNIT_WORD: Record<PeriodKind, string> = { week: '주', month: '달', year: '해', all: '기간' };
const MODES: { id: ChartMode; label: string }[] = [{ id: 'cum', label: '누적' }, { id: 'bar', label: '막대' }, { id: 'both', label: '막대+누적' }];
const ZERO = { count: 0, sets: 0, volume: 0, durationSec: 0 };
const SHOWN = 5;

function readPref(): PeriodPref {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 못 읽으면 기본값 */ }
  return parsePeriodPref(raw);
}
function writePref(p: PeriodPref) {
  try { localStorage.setItem(KEY, serializePeriodPref(p)); } catch { /* 저장 못 해도 화면은 동작 */ }
}

export interface PeriodView {
  kind: PeriodKind; metric: PeriodMetric; mode: ChartMode;
  /** 몇 기간 전인지 (0 = 이번 기간, 전체는 늘 0) */
  off: number; current: boolean;
  range: PeriodRange; first: string | null; todayDone: boolean; plan: ComparePlan;
  buckets: Bucket[]; state: BucketState[];
  /** 고른 칸 (누적 보기·미래 칸은 null) */
  selv: number | null;
  /** 기간 내역에 펼쳐 둔 개수 */
  shown: number;
  /** 가장 오래된 기간까지 갔나 */
  atEnd: boolean;
  setKind: (k: PeriodKind) => void; setMetric: (m: PeriodMetric) => void; setMode: (m: ChartMode) => void;
  go: (n: number) => void; pick: (i: number | null) => void; more: () => void;
}

/**
 * 기간 카드와 기간 내역이 함께 쓰는 보기 상태: 저장값(단위·지표·그래프 보기)·보는 기간·고른 칸·펼친 개수와 거기서 나오는 기간·비교 방법.
 * 단위·보기·기간·지표가 바뀌면 고른 칸을 비우고 펼친 개수를 5로 되돌림
 */
export function usePeriodView(done: Workout[], today: string): PeriodView {
  const [pref, setPref] = useState(readPref);
  const { kind, metric, mode } = pref;
  // 보는 기간: null = 이번 기간(자정·월말을 넘으면 새 이번 기간), 아니면 보던 지난 기간의 시작 날짜 (자정을 넘겨도 같은 날짜 범위). 몇 기간 전인지는 그리면서 셈
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [shown, setShown] = useState(SHOWN);
  const off = anchor && kind !== 'all' ? offsetOf(kind, anchor, today) : 0;
  const reset = () => { setSel(null); setShown(SHOWN); };
  const change = (next: Partial<PeriodPref>) => { const p = { ...pref, ...next }; setPref(p); writePref(p); reset(); };
  const day0 = useRef(today);
  useEffect(() => { if (day0.current !== today) { day0.current = today; setSel(null); } }, [today]); // 날이 바뀌면 고른 칸만 비움 (처음 그릴 때는 건드리지 않음)

  const first = useMemo(() => firstRecordDate(done, today), [done, today]);
  const current = off === 0;
  const range = useMemo(() => (kind === 'all' ? periodOf('all', today, first) : shiftPeriod(periodOf(kind, today), -off)), [kind, today, off, first]);
  const todayDone = useMemo(() => hasWorkoutOn(done, today), [done, today]);
  const plan = useMemo(() => comparePlan(range, current, today, todayDone, first), [range, current, today, todayDone, first]);
  const buckets = useMemo(() => periodBuckets(range), [range]);
  const state = useMemo<BucketState[]>(() => buckets.map((b) => (b.start > today ? 'future' : today < b.end ? 'now' : 'past')), [buckets, today]);
  const lastOk = state.reduce((m, s, i) => (s !== 'future' ? i : m), 0);
  const selv = mode !== 'cum' && sel !== null && sel <= lastOk ? sel : null; // 날이 바뀌어 미래가 된 칸은 고른 것으로 안 침
  const atEnd = kind === 'all' || range.start <= periodOf(kind, first ?? today).start;
  return {
    kind, metric, mode, off, current, range, first, todayDone, plan, buckets, state, selv, shown, atEnd,
    setKind: (k) => { if (k === kind) return; change({ kind: k }); setAnchor(null); },
    setMetric: (m) => { if (m !== metric) change({ metric: m }); },
    setMode: (m) => { if (m !== mode) change({ mode: m }); },
    go: (n) => { setAnchor(n <= 0 ? null : shiftPeriod(periodOf(kind, today), -n).start); reset(); },
    pick: (i) => { setSel(i); setShown(SHOWN); },
    more: () => setShown((s) => s + SHOWN),
  };
}

export function PeriodCard({ v, done, byId, today, bw }: { v: PeriodView; done: Workout[]; byId: Map<string, Exercise>; today: string; bw: AppState['bodyweight'] }) {
  const { kind, metric, mode, off, current, range, first, todayDone, plan, buckets, state, selv, atEnd } = v;
  const base = useMemo(() => periodOf(kind, today), [kind, today]);
  const through = useMemo(() => compareThroughFor(base, today, todayDone), [base, today, todayDone]);
  const baseThrough = useMemo(() => compareThroughFor(base, today, true), [base, today]);
  const { cur, curCmp, prevCmp, prevFull } = useMemo(() => {
    const upto = current ? today : undefined; // 오늘 뒤 날짜 기록은 이번 기간에 안 셈
    const cur = periodData(done, byId, range, bw, upto);
    const ok = plan.mode === 'ok' && plan.prev !== null;
    return {
      cur,
      curCmp: ok && plan.from ? periodData(done, byId, range, bw, upto, plan.curFrom) : cur, // 일부 기록 기간: 이번 쪽도 같은 구간만
      prevCmp: ok ? periodData(done, byId, plan.prev!, bw, plan.through, plan.from) : null,
      prevFull: plan.fullPrev && plan.prev ? periodData(done, byId, plan.prev, bw) : null,
    };
  }, [done, byId, range, bw, current, today, plan]);
  const streak = useMemo(() => weekStreak(done, today), [done, today]);

  const t = cur.totals, tc = curCmp.totals, p = prevCmp?.totals ?? ZERO;
  const label = periodLabel(range, off, today);
  const names = UNIT_WORD[kind];
  const wide = kind === 'year' || kind === 'all'; // 칸 = 달
  const vals = cur.series[metric];
  const prevVals = prevFull?.series[metric];
  const xLabels = buckets.map((b, i) => {
    const d = Number(b.start.slice(8)), mo = Number(b.start.slice(5, 7));
    if (kind === 'week') return `${state[i] === 'now' ? '오늘' : WD[i]}\n${d}`;
    if (kind === 'month') return [1, 8, 15, 22, 29].includes(d) ? String(d) : '';
    if (kind === 'all') return mo === 1 || i === 0 ? `${Number(b.start.slice(2, 4))}.${mo}` : (mo - 1) % 3 === 0 ? String(mo) : '';
    return String(i + 1);
  });
  const { value: avgV, n: avgN, excluded: avgExcl } = averageOver(kind, vals, cur.active, state); // 년·전체 보기는 진행 중인 이번 달을 평균에서 뺌
  const whole = plan.mode === 'ok' && wholePrevMonth(kind, current, { through, today, done: todayDone }); // 이번 달이 더 길어 지난달 전체와 견줌
  const wholeDays = whole ? Number(through.slice(8)) : 0;
  const waiting = plan.mode === 'waiting'; // 첫날·운동 전: 견줄 구간이 비어 있음
  const hasCur = cur.active.some(Boolean);
  const empty = !hasCur && !(mode !== 'bar' && !!prevVals?.some((x) => x > 0)); // 누적·막대+누적은 이전 기간 선이 있으면 이번 기록이 없어도 그림
  // 평균선·범례(막대 보기): 운동한 칸이 둘 이상이고 평균이 최댓값과 같지 않을 때만 (한 칸뿐이면 같은 값이 되풀이됨)
  const showAvg = mode === 'bar' && avgV > 0 && avgN >= 2 && avgV < Math.max(...vals) && !(metric === 'count' && (kind === 'week' || kind === 'month'));
  const ton = tonMode(t.volume, p.volume);
  const avgLeg = avgParts(kind, metric, avgV, ton, avgExcl);
  const unitWord = wide ? '달별' : '날짜별';
  /** 한 칸 문구(막대 보기): "11월 16일 (월) · 작업 세트 9세트 · 운동 1회" (일·월 보기에서 지표가 운동 수가 아니면 운동한 칸에 횟수를 덧붙임) */
  const bucketLine = (i: number) => !cur.active[i] ? `${bucketText(kind, buckets[i]!.start)} · 운동 안 함` : `${bucketText(kind, buckets[i]!.start)} · ${METRIC_NAME[metric]} ${valueText(metric, vals[i]!, ton)}${!wide && metric !== 'count' ? ` · 운동 ${cur.series.count[i]}회` : ''}`;
  const legend = legendNames({ mode, kind, current, label, plan });
  const pwName = prevVals ? prevName(kind, current, true) : undefined;
  /** 한 칸 문구(막대+누적 보기): "11월 16일 (월) · 작업 세트 22세트 · 누적 22세트 · 지난주 같은 요일 15세트" */
  const comboText = (i: number) => comboLine({ kind, start: buckets[i]!.start, metric, value: vals[i]!, active: cur.active[i]!, cum: vals.slice(0, i + 1).reduce((a, b) => a + b, 0), prev: prevVals ? (i < prevVals.length ? prevVals[i]! : null) : null, pw: pwName, ton });
  const total = `합계 · ${METRIC_NAME[metric]} ${valueText(metric, vals.reduce((a, b) => a + b, 0), ton)}`;
  const caption = empty ? '' : selv === null ? chartCaption({ mode, kind, label, pw: pwName }) : mode === 'both' ? comboText(selv) : bucketLine(selv);
  const cumLabel = `누적 ${METRIC_NAME[metric]} 그래프 · ${legend.cur} ${valueText(metric, vals.reduce((a, b) => a + b, 0), ton)}${legend.prev && prevVals ? ` · ${legend.prev} ${valueText(metric, prevVals.reduce((a, b) => a + b, 0), ton)}` : ''}`;
  const emptyText = current ? '운동을 끝내면 여기에 막대가 생겨요' : '이 기간에는 운동 기록이 없어요';

  const headParts = headline({ kind, current, metric, cur: metricValue(metric, tc), prev: metricValue(metric, p), curCount: t.count, prevCount: p.count, label, whole, mode: plan.mode, first: first ?? today, curSets: t.sets, curFull: metricValue(metric, t) });
  const subs = headSubs({ plan, kind, current, mode, metric, c: metricValue(metric, t), pf: prevFull ? metricValue(metric, prevFull.totals) : 0, ton: metric === 'volume' && ton });
  const hero = bigParts(metric, metricValue(metric, t), metric === 'volume' && ton);
  const heroV = metricValue(metric, t);
  const compare = compareLine(kind, current, whole);
  const lens: [number, number] | undefined = kind === 'year' ? [daysInYear(Number(range.start.slice(0, 4))), daysInYear(Number(range.start.slice(0, 4)) - 1)] : kind === 'month' ? [buckets.length, daysInMonth(Number(range.start.slice(0, 4)) - (range.start.slice(5, 7) === '01' ? 1 : 0), range.start.slice(5, 7) === '01' ? 12 : Number(range.start.slice(5, 7)) - 1)] : undefined;
  return (
    <section class="card" data-testid="this-week">
      <div class="ps-seg" role="group" aria-label="기간 단위">
        {KINDS.map((k) => <button key={k} class={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => v.setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      <div class="ps-nav">
        <button aria-label={`이전 ${names}`} disabled={atEnd} onClick={() => v.go(off + 1)}>‹</button>
        <div class="ps-mid">
          <strong data-testid="period-label">{label}</strong>
          <span class="sub small" data-testid="period-range"><span class="nw">{rangeText(range, today)}</span>{compare && <>{' '}<span class="nw">{compare}</span></>}</span>
        </div>
        <button aria-label={`다음 ${names}`} disabled={current} onClick={() => v.go(off - 1)}>›</button>
      </div>
      <div class={`m-val ps-hero${metric === 'time' && heroV >= 3600000 ? ' xlong' : metric === 'time' && heroV >= 360000 ? ' long' : ''}`} data-testid="period-hero">{hero.map(([n, u], i) => <span key={i} class="m-pair"><span class="num">{n}</span>{u && <span class="unit">{u}</span>}</span>)}</div>
      <div class="sub small ps-hero-l" data-testid="period-hero-label">{heroLabel(label, metric, kind)}</div>
      <div class="ps-head" aria-live="polite" aria-atomic="true">
        <p class="ps-headline" data-testid="period-headline">{!headParts.some((h) => h.text.startsWith(label)) && <span class="sr-only">{label}: </span>}{headParts.map((h, i) => (h.nw ? <span key={i} class="nw">{h.text}</span> : h.text))}</p>
        {subs.map((s, i) => <p key={i} class="sub small ps-sub" data-testid="period-sub">{s}</p>)}
      </div>
      <div class="ps-view"><div class="ps-viewseg" role="group" aria-label="그래프 보기">
        {MODES.map((m) => <button key={m.id} class={`ps-vbtn${mode === m.id ? ' on' : ''}`} aria-pressed={mode === m.id} data-testid={`view-${m.id}`} onClick={() => v.setMode(m.id)}>{m.label}</button>)}
      </div></div>
      <div class="sub small ps-caption" data-testid="period-caption">{caption}</div>
      {showAvg && !empty && <div class="sub small ps-legend" data-testid="period-avg"><span class="ps-swatch" aria-hidden="true" />{avgLeg.label} <span class="nw" data-testid="period-avg-value">{avgLeg.value}</span></div>}
      {mode !== 'bar' && !empty && (
        <div class="sub small ps-lg" data-testid="period-legend">
          <span class="ps-lg-i">{mode === 'both' && <i class="lg-bar cur" aria-hidden="true" />}<i class="lg-line cur" aria-hidden="true" />{legend.cur}</span>
          {legend.prev && <span class="ps-lg-i">{mode === 'both' && <i class="lg-bar prev" aria-hidden="true" />}<i class="lg-line prev" aria-hidden="true" />{legend.prev}</span>}
        </div>
      )}
      {mode === 'cum'
        ? <PeriodCum values={vals} prev={prevVals} state={state} labels={xLabels} fmt={(x) => valueText(metric, x, ton)} label={cumLabel} empty={empty ? emptyText : undefined} />
        : <PeriodBars mode={mode} prev={prevVals} values={vals} labels={xLabels} state={state} selected={selv} onSelect={v.pick}
          dots={wide ? undefined : cur.active} avg={showAvg ? avgV : undefined} fmt={(x) => valueText(metric, x, ton)}
          valueText={mode === 'both' ? comboText : bucketLine} jump={wide ? 3 : 7}
          labelClass={kind === 'week' ? ['sun', '', '', '', '', '', 'sat'] : undefined}
          empty={empty ? emptyText : undefined}
          summary={`${total} · 방향키로 칸을 고르면 ${unitWord} 값`} label={`${kind === 'year' || kind === 'all' ? '월별' : '일별'} ${METRIC_NAME[metric]} 그래프`} />}
      {plan.mode === 'ok' && <p class="sub small pm-note" data-testid="pm-note">{prevNote(kind, current, whole)}</p>}
      <div class="pm-grid">
        {METRICS.map((m) => {
          const c = metricValue(m, t), cc = metricValue(m, tc), pv = metricValue(m, p);
          const tn = m === 'volume' && ton;
          const parts = bigParts(m, c, tn);
          const [sc, sp] = cmpValues(m, cc, pv, tn);
          const dir = sc > sp ? 'up' : sc < sp ? 'down' : 'same';
          return (
            <button key={m} class={`pm-card${metric === m ? ' on' : ''}`} aria-pressed={metric === m} data-testid={`pm-${m}`}
              aria-label={cardAria({ kind, current, metric: m, cur: c, prev: pv, ton: tn, waiting, partialThrough: current && !todayDone ? through : undefined, wholeDays, plan, cc })} onClick={() => v.setMetric(m)}>
              <span class="pm-top">{plan.mode === 'ok' && <span class={`pm-badge ${dir}`} aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='}</span>}<span class="m-label" aria-hidden="true">{METRIC_NAME[m]}</span></span>
              <span class={`m-val${m === 'time' && c >= 3600000 ? ' xlong' : m === 'time' && c >= 360000 ? ' long' : ''}`} aria-hidden="true">{parts.map(([n, u], i) => <span key={i} class="m-pair"><span class="num">{n}</span>{u && <span class="unit">{u}</span>}</span>)}</span>
              {cardSmall(plan, m, cc, pv, tn).map((line, i) => <span key={i} class={`pm-prev${m === 'time' && pv >= 3600000 ? ' xlong' : ''}`} aria-hidden="true">{line}</span>)}
            </button>
          );
        })}
      </div>
      <p class="sub small" data-testid="period-foot" style={{ margin: '8px 0 0' }}>{footnoteParts(kind, current, { through, base: baseThrough, done: todayDone, streak, today, waiting, lens, plan, first: first ?? undefined }).map((h, i) => (h.nw ? <span key={i} class="nw">{h.text}</span> : h.text))}</p>
    </section>
  );
}
