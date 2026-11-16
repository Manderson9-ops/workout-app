/** D-081 기간 요약 카드: 주·월·년 전환, 이전 기간과 비교 한 문장, 지표 카드 4개, 막대 그래프 (Apple 피트니스 요약 모양) */
import { useMemo, useState } from 'preact/hooks';
import type { AppState } from '../store';
import type { Workout } from '../../core/session';
import type { Exercise } from '../../core/types';
import { weekStreak } from '../../core/stats';
import { periodOf, shiftPeriod, periodBuckets, compareThrough, periodData, earliestPeriod, activeAverage } from '../../core/period';
import type { PeriodKind, PeriodMetric } from '../../core/period';
import { METRICS, METRIC_NAME, KIND_LABEL, valueText, bigParts, tonMode, avgText, metricValue, prevName, periodLabel, rangeText, compareLine, headline, cardAria, bucketText, footnote } from '../../core/periodText';
import { WD } from '../../core/dateText';
import { PeriodBars } from '../charts';
import type { BucketState } from '../charts';

const KEY = 'stats.period.v1';
const KINDS: PeriodKind[] = ['week', 'month', 'year'];
const UNIT_WORD: Record<PeriodKind, string> = { week: '주', month: '달', year: '해' };

function readPref(): { kind: PeriodKind; metric: PeriodMetric } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { kind?: unknown; metric?: unknown } | null;
    return { kind: KINDS.find((k) => k === v?.kind) ?? 'week', metric: METRICS.find((m) => m === v?.metric) ?? 'sets' };
  } catch { return { kind: 'week', metric: 'sets' }; }
}
function writePref(kind: PeriodKind, metric: PeriodMetric) { try { localStorage.setItem(KEY, JSON.stringify({ kind, metric })); } catch { /* 저장 못 해도 화면은 동작 */ } }

export function PeriodCard({ done, byId, today, bw }: { done: Workout[]; byId: Map<string, Exercise>; today: string; bw: AppState['bodyweight'] }) {
  const [pref, setPref] = useState(readPref);
  const { kind, metric } = pref;
  const [off, setOff] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const setKind = (k: PeriodKind) => { if (k === kind) return; setPref({ kind: k, metric }); writePref(k, metric); setOff(0); setSel(null); };
  const setMetric = (m: PeriodMetric) => { setPref({ kind, metric: m }); writePref(kind, m); };
  const go = (n: number) => { setOff(n); setSel(null); };

  const current = off === 0;
  const range = useMemo(() => shiftPeriod(periodOf(kind, today), -off), [kind, today, off]);
  const earliest = useMemo(() => earliestPeriod(done, kind, today), [done, kind, today]);
  const through = useMemo(() => compareThrough(periodOf(kind, today), today), [kind, today]);
  const { cur, prev, buckets } = useMemo(() => ({
    cur: periodData(done, byId, range, bw),
    prev: periodData(done, byId, shiftPeriod(range, -1), bw, current ? through : undefined),
    buckets: periodBuckets(range),
  }), [done, byId, range, bw, current, through]);
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
  const avgV = activeAverage(vals, cur.active);
  const activeN = cur.active.filter(Boolean).length;
  const empty = activeN === 0;
  // 평균선·범례: 운동한 칸이 둘 이상이고 평균이 최댓값과 같지 않을 때만 (한 칸뿐이면 같은 값이 되풀이됨)
  const showAvg = avgV > 0 && activeN >= 2 && avgV < Math.max(...vals) && !(metric === 'count' && kind !== 'year');
  const ton = tonMode(t.volume, p.volume);
    /** 한 칸 문구: "11월 16일 (월) · 작업 세트 9세트 · 운동 1회" (일·월 보기에서 지표가 운동 수가 아니면 운동한 칸에 횟수를 덧붙임) */
  const bucketLine = (i: number) => !cur.active[i] ? `${bucketText(kind, buckets[i]!.start)} · 운동 안 함` : `${bucketText(kind, buckets[i]!.start)} · ${METRIC_NAME[metric]} ${valueText(metric, vals[i]!, ton)}${kind !== 'year' && metric !== 'count' ? ` · 운동 ${cur.series.count[i]}회` : ''}`;
  const total = `합계 · ${METRIC_NAME[metric]} ${valueText(metric, vals.reduce((a, b) => a + b, 0), ton)}`;
  const caption = empty ? '' : sel === null ? `막대를 누르거나 옆으로 밀면 ${kind === 'year' ? '달별' : '날짜별'} 값이 보여요` : bucketLine(sel);
  const todayWd = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8))).getDay();
  const atEnd = range.start <= earliest;

  return (
    <section class="card" data-testid="this-week">
      <div class="ps-seg" role="group" aria-label="기간 단위">
        {KINDS.map((k) => <button key={k} class={`chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      <div class="ps-nav">
        <button aria-label={`이전 ${names}`} disabled={atEnd} onClick={() => go(off + 1)}>‹</button>
        <div class="ps-mid" aria-live="polite">
          <strong data-testid="period-label">{label}</strong>
          <span class="sub small" data-testid="period-range">{off <= 1 && <><span class="nw">{rangeText(range, today)}</span>{' '}</>}<span class="nw">{compareLine(kind, current)}</span></span>
        </div>
        <button aria-label={`다음 ${names}`} disabled={current} onClick={() => go(off - 1)}>›</button>
      </div>
      <p class="ps-headline" data-testid="period-headline" aria-live="polite">{headline({ kind, current, metric, cur: metricValue(metric, t), prev: metricValue(metric, p), curCount: t.count, prevCount: p.count, label })}</p>
      <div class="sub small ps-caption" data-testid="period-caption">{caption}</div>
      {showAvg && !empty && <div class="sub small ps-legend" data-testid="period-avg"><span class="ps-swatch" aria-hidden="true" />{avgText(kind, metric, avgV, ton)}</div>}
      <PeriodBars values={vals} labels={xLabels} state={state} selected={sel} onSelect={setSel}
        dots={kind === 'year' ? undefined : cur.active} avg={showAvg ? avgV : undefined} fmt={(v) => valueText(metric, v, ton)}
        valueText={bucketLine} jump={kind === 'year' ? 3 : 7}
        labelClass={kind === 'week' ? ['sun', '', '', '', '', '', 'sat'] : undefined}
        empty={empty ? (current ? '운동을 끝내면 여기에 막대가 생겨요' : '이 기간에는 운동 기록이 없어요') : undefined}
        summary={total} label={`${kind === 'year' ? '월별' : '일별'} ${METRIC_NAME[metric]} 그래프`} />
      <div class="pm-grid">
        {METRICS.map((m) => {
          const c = metricValue(m, t), pv = metricValue(m, p);
          const tn = m === 'volume' && ton;
          const parts = bigParts(m, c, tn);
          const dir = c > pv ? 'up' : c < pv ? 'down' : 'same';
          return (
            <button key={m} class={`pm-card${metric === m ? ' on' : ''}`} aria-pressed={metric === m} data-testid={`pm-${m}`}
              aria-label={cardAria({ kind, current, metric: m, cur: c, prev: pv, ton: tn })} onClick={() => setMetric(m)}>
              <span class="pm-top"><span class={`pm-badge ${dir}`} aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='}</span><span class="m-label" aria-hidden="true">{METRIC_NAME[m]}</span></span>
              <span class="m-val" aria-hidden="true">{parts.map(([n, u], i) => <span key={i} class="m-pair"><span class="num">{n}</span>{u && <span class="unit">{u}</span>}</span>)}</span>
              <span class="pm-prev" aria-hidden="true">{prevName(kind, current, true)} {valueText(m, pv, tn)}</span>
            </button>
          );
        })}
      </div>
      <p class="sub small" style={{ margin: '8px 0 0' }}>{footnote(kind, current, through, streak, todayWd)}</p>
    </section>
  );
}
