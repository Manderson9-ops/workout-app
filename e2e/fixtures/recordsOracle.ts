/**
 * D-082 기록판 시험 기대값 (독립 구현). 앱 코드(src/)를 부르지 않고, 예시 데이터(MockRow 목록)에서 SPEC 식(docs/mockups/records/SPEC.md)·D-081 규칙으로
 * 기간 합·비교 구간·남은 양·부하 비율·막대 개수·내역을 다시 계산한다. 날짜 계산은 모두 UTC.
 * 한 문장 틀·구간 한 문장은 사용자가 목업에서 보고 승인한 문구를 고정값으로 쓰고, 숫자(합계·차이·비교 구간)만 여기서 계산한다(SPEC 시험 항목).
 * 하네스(harness.cjs oGen·oVd·oracleCards)의 계산 방식을 TS 로 옮겨 오되, 목업 함수·EXPECT 상수는 쓰지 않는다. 앱 규칙(D-081)은 목업에 없는 부분만 앱 문구를 따른다:
 * 주 범위 형식(해 넘는 주), 년 범위 줄 "2026년 1월~12월", 볼륨 톤 단계, 시간 보이는 값(1분 미만 초, 그 이상 분 반올림) 비교
 */
import type { MockRow } from './recordsMock';

export type Kind = 'week' | 'month' | 'year' | 'all';
export type Metric = 'count' | 'sets' | 'volume' | 'time';
export type Mode = 'cum' | 'bar' | 'both';
export const KINDS: Kind[] = ['week', 'month', 'year', 'all'];
export const METRICS: Metric[] = ['count', 'sets', 'volume', 'time'];
export const MODES: Mode[] = ['cum', 'bar', 'both'];
export const KIND_BUTTON: Record<Kind, string> = { week: '주', month: '월', year: '년', all: '전체' };
export const MODE_BUTTON: Record<Mode, string> = { cum: '누적', bar: '막대', both: '막대+누적' };

// ---------- 날짜 (UTC) ----------
const uT = (s: string): number => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
const uS = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const add = (s: string, n: number): string => uS(uT(s) + n * 86400000);
export const dow = (s: string): number => new Date(uT(s)).getUTCDay();
export const daysBetween = (a: string, b: string): number => Math.round((uT(b) - uT(a)) / 86400000);
const dim = (y: number, m1: number): number => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const p2 = (n: number) => String(n).padStart(2, '0');
/** k 달 뒤 같은 날 (없는 날이면 말일) */
export function monthShift(s: string, k: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + k, 1));
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth() + 1;
  return `${yy}-${p2(mm)}-${p2(Math.min(d!, dim(yy, mm)))}`;
}
const monthFirst = (s: string): string => s.slice(0, 8) + '01';
const nextMonthFirst = (s: string): string => monthShift(monthFirst(s), 1);
const WDN = ['일', '월', '화', '수', '목', '금', '토'];
const mNum = (s: string) => Number(s.slice(5, 7));
const dNum = (s: string) => Number(s.slice(8, 10));
const yNum = (s: string) => Number(s.slice(0, 4));
const mdK = (s: string) => `${mNum(s)}월 ${dNum(s)}일`;
const mdS = (s: string) => `${mNum(s)}/${dNum(s)}`;
const ymK = (s: string) => `${yNum(s)}년 ${mNum(s)}월`;

// ---------- 글자 ----------
export const comma = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const commaDec = (v: number): string => { const x = Number.isInteger(v) ? v : Math.round(v * 10) / 10; const [i, f] = String(x).split('.'); return comma(Number(i)) + (f ? '.' + f : ''); };
/** 한글 받침 여부 (한글 음절만 본다. 이 시험이 쓰는 낱말은 모두 한글) */
const batchim = (w: string): boolean => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
export const josa = (w: string, a: string, b: string): string => w + (batchim(w) ? a : b);
export function durText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s === 0) return '0분';
  if (s < 60) return `${s}초`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분`;
  return m % 60 ? `${comma(Math.floor(m / 60))}시간 ${m % 60}분` : `${comma(m / 60)}시간`;
}
const NAME: Record<Metric, string> = { count: '운동', sets: '작업 세트', volume: '볼륨', time: '시간' };
const LABEL: Record<Kind, string> = { week: '이번 주', month: '이번 달', year: '올해', all: '처음부터 지금까지' };
const PW: Record<Exclude<Kind, 'all'>, string> = { week: '지난주', month: '지난달', year: '작년' };
const tonMode = (cur: number, prev: number): boolean => Math.max(cur, prev) >= 1_000_000;
const tonNum = (kg: number): string => commaDec(kg / 1000 < 9.95 ? Math.round(kg / 100) / 10 : Math.round(kg / 1000));
/** 값 문구: 운동 "3회", 세트 "9세트", 볼륨 "1,200kg"(톤 모드면 "1.7톤"), 시간 durText */
export function val(m: Metric, v: number, ton = false): string {
  if (m === 'count') return `${commaDec(v)}회`;
  if (m === 'sets') return `${commaDec(v)}세트`;
  if (m === 'volume') return ton ? (v > 0 && v < 50 ? '0.1톤 미만' : `${tonNum(v)}톤`) : `${comma(v)}kg`;
  return durText(v);
}
/** 화면에 보이는 정밀도로 맞춘 값 둘 (D-081): 시간 = 1분 미만 초·그 이상 분, 볼륨 = kg 정수(톤은 보이는 단계) */
export function cmpV(m: Metric, cur: number, prev: number, ton: boolean): [number, number] {
  if (m === 'time') { const sh = (v: number) => (v < 60 ? Math.round(v) : Math.round(v / 60) * 60); return [sh(cur), sh(prev)]; }
  if (m !== 'volume') return [cur, prev];
  if (!ton) return [Math.round(cur), Math.round(prev)];
  const step = (v: number) => (v <= 0 ? 0 : v < 50 ? 25 : v / 1000 < 9.95 ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000);
  return [step(cur), step(prev)];
}
/** 보이는 값 두 개의 차이 문구 */
function diffText(m: Metric, a: number, b: number, ton: boolean): string {
  const d = Math.abs(a - b);
  if (m !== 'time') return val(m, d, ton);
  if (d < 60) return `${d}초`;
  return d % 60 ? `${durText(d - (d % 60))} ${d % 60}초` : durText(d);
}

// ---------- 기간 ----------
const rowValue = (r: MockRow, m: Metric): number => (m === 'count' ? 1 : m === 'sets' ? r.sets : m === 'volume' ? r.volume : r.time);
/** a ~ b (둘 다 포함) 날짜의 합 */
export const sumRows = (W: MockRow[], m: Metric, a: string, b: string): number => W.filter((r) => r.date >= a && r.date <= b).reduce((t, r) => t + rowValue(r, m), 0);
const countRows = (W: MockRow[], a: string, b: string): number => W.filter((r) => r.date >= a && r.date <= b).length;

interface Bucket { start: string; end: string }
function rangeOf(kind: Kind, d: string, first: string): { r0: string; r1: string } {
  if (kind === 'week') { const r0 = add(d, -dow(d)); return { r0, r1: add(r0, 7) }; }
  if (kind === 'month') return { r0: monthFirst(d), r1: nextMonthFirst(d) };
  if (kind === 'year') return { r0: `${yNum(d)}-01-01`, r1: `${yNum(d) + 1}-01-01` };
  return { r0: monthFirst(first), r1: nextMonthFirst(d) };
}
function bucketsOf(kind: Kind, r0: string, r1: string): Bucket[] {
  const out: Bucket[] = [];
  if (kind === 'week' || kind === 'month') { for (let s = r0; s < r1; s = add(s, 1)) out.push({ start: s, end: add(s, 1) }); return out; }
  for (let s = r0; s < r1; s = nextMonthFirst(s)) out.push({ start: s, end: nextMonthFirst(s) });
  return out;
}
const prevStartOf = (kind: Kind, r0: string): string => (kind === 'week' ? add(r0, -7) : kind === 'month' ? monthShift(r0, -1) : `${yNum(r0) - 1}-01-01`);
const alignFwd = (kind: Kind, s: string): string => (kind === 'week' ? add(s, 7) : monthShift(s, kind === 'month' ? 1 : 12));

/** 이전 기간과 견주는 방법 (SPEC #12·#13): none = 전체 탭 · nohist = 이전 기간(또는 비교 구간)이 첫 기록일 전 · waiting = 기간 첫날 운동 전 · ok */
export interface Plan { mode: 'none' | 'nohist' | 'waiting' | 'ok'; from: string | null; curFrom: string; through: string | null; full: boolean; ps: string; pe: string }
export function planOf(kind: Kind, today: string, first: string, done: boolean): Plan {
  const { r0 } = rangeOf(kind, today, first);
  if (kind === 'all') return { mode: 'none', from: null, curFrom: r0, through: null, full: false, ps: r0, pe: r0 };
  const ps = prevStartOf(kind, r0), pe = r0;
  if (first >= pe) return { mode: 'nohist', from: null, curFrom: r0, through: null, full: false, ps, pe };
  const from = first > ps ? first : null;
  const curFrom = from ? alignFwd(kind, from) : r0;
  if (!done && today === r0) return { mode: 'waiting', from, curFrom, through: null, full: true, ps, pe };
  const basis = done ? today : add(today, -1);
  const through = kind === 'week' ? add(basis, -7) : kind === 'month' ? monthShift(basis, -1) : monthShift(basis, -12);
  if (kind === 'month' && Number(today.slice(8)) - (done ? 0 : 1) > Number(through.slice(8))) throw new Error(`월말 지난달 전체 비교(wholePrevMonth)는 오라클이 다루지 않음: ${today}`);
  if (from && from > through) return { mode: 'nohist', from, curFrom, through: null, full: true, ps, pe };
  return { mode: 'ok', from, curFrom, through, full: true, ps, pe };
}

export const firstOf = (W: MockRow[], today: string): string => W.filter((r) => r.date <= today).map((r) => r.date).sort()[0]!;

// ---------- 기간 카드 기대값 ----------
export interface CardExpect { metric: Metric; hero: string; small: string[]; glyph: '' | '▲' | '▼' | '=' }
export interface HistExpect { title: string; rows: { d: string; n: string; m: string }[]; more: string | null; empty: string | null; total: number }
export interface ViewExpect {
  label: string; range: string; heroLabel: string; hero: string;
  /** 한 문장 칸의 글자 전체: 이름이 문장 앞에 없으면 화면 읽기용 "이번 주: " 가 붙음 */
  headline: string; sentence: string; subs: string[];
  cards: CardExpect[];
  noteShown: boolean; foot: { exact?: string; includes?: string; startsWith?: string };
  caption: string; legend: string[] | null; avg: string | null;
  chart: 'bars' | 'cum' | 'empty'; emptyText: string;
  counts: { slots: number; cur: number; prev: number; polyCur: number; polyPrev: number; end: number };
  hist: HistExpect;
  plan: Plan; values: number[]; prevValues: number[] | null; buckets: Bucket[]; ton: boolean;
}

/** 이번 기간(off 0)의 모든 기대값 */
export function expectView(W: MockRow[], today: string, kind: Kind, metric: Metric, mode: Mode, sel: number | null = null): ViewExpect {
  const first = firstOf(W, today);
  const done = W.some((r) => r.date === today);
  const { r0, r1 } = rangeOf(kind, today, first);
  const plan = planOf(kind, today, first, done);
  const buckets = bucketsOf(kind, r0, r1);
  const wide = kind === 'year' || kind === 'all';
  const label = LABEL[kind];
  const pw = kind === 'all' ? '' : PW[kind];
  const values = buckets.map((b) => (b.start > today ? 0 : sumRows(W, metric, b.start, add(b.end, -1) < today ? add(b.end, -1) : today)));
  const upto = buckets.findIndex((b) => b.start > today) === -1 ? buckets.length : buckets.findIndex((b) => b.start > today);
  const prevBuckets = plan.full && kind !== 'all' ? bucketsOf(kind, plan.ps, plan.pe) : null;
  const prevValues = prevBuckets ? prevBuckets.map((b) => sumRows(W, metric, b.start, add(b.end, -1))) : null;

  // 합계들 (지표별)
  const cmpFrom = plan.from ?? plan.ps;
  const tot = (m: Metric) => sumRows(W, m, r0, today);
  const curCmp = (m: Metric) => sumRows(W, m, plan.from ? plan.curFrom : r0, today);
  const prevCmp = (m: Metric) => (plan.mode === 'ok' ? sumRows(W, m, cmpFrom, plan.through!) : 0);
  const prevFull = (m: Metric) => (plan.full ? sumRows(W, m, plan.ps, add(plan.pe, -1)) : 0);
  const nCur = countRows(W, r0, today);
  const nPrev = plan.mode === 'ok' ? countRows(W, cmpFrom, plan.through!) : 0;
  const ton = tonMode(tot('volume'), prevCmp('volume')); // 카드 큰 숫자·이전 값 줄·남은 양 문구의 볼륨 단위

  // 한 문장
  let sentence: string; let lead = false; // lead = 한 문장이 기간 이름으로 시작하는 낱말을 가짐 (그러면 화면 읽기용 이름 접두어가 안 붙음)
  const full = tot(metric);
  if (kind === 'all') sentence = `${ymK(first)}부터 운동 ${comma(nCur)}회 · 작업 세트 ${comma(tot('sets'))}세트`;
  else if (plan.mode === 'nohist') {
    sentence = `${josa(`${pw} 이맘때`, '은', '는')} 기록을 시작하기 전이에요`;
    if (nCur > 0) { sentence += ` · ${label} ${val(metric, full, metric === 'volume' && tonMode(full, 0))}`; lead = true; }
  } else if (nCur === 0 && nPrev === 0) { sentence = `${josa(label, '은', '는')} 아직 운동 기록이 없어요`; lead = true; }
  else if (nPrev === 0) { sentence = `${josa(`${pw} 이맘때`, '은', '는')} 운동이 없었어요 · ${label} ${val(metric, full, metric === 'volume' && tonMode(full, prevCmp(metric)))}`; lead = true; }
  else {
    const cc = curCmp(metric), p = prevCmp(metric), t = metric === 'volume' && tonMode(cc, p);
    const [sc, sp] = cmpV(metric, cc, p, t), pwx = `${pw} 이맘때`, nm = josa(NAME[metric], '이', '가');
    sentence = sc === sp ? `${josa(pwx, '과', '와')} ${nm} 같아요`
      : `${pwx}보다 ${nm} ${diffText(metric, sc, sp, t)} ${metric === 'time' ? (sc > sp ? '길어요' : '짧아요') : (sc > sp ? '많아요' : '적어요')}`;
  }
  const headline = (lead ? '' : `${label}: `) + sentence;

  // 둘째 줄들
  const subs: string[] = [];
  if (plan.mode === 'ok' && plan.from) subs.push(`${pw} 기록이 ${mdK(plan.from)}부터라 ${mdK(plan.curFrom)} 이후끼리 견줬어요`);
  if (plan.full && mode !== 'bar' && prevFull(metric) > 0) {
    const t = metric === 'volume' && ton, pf = prevFull(metric);
    const [sc, sp] = cmpV(metric, full, pf, t);
    subs.push((sp - sc > 0 ? `${pw} 전체까지 ${diffText(metric, sp, sc, t)} 남았어요` : `${pw} 전체(${val(metric, pf, t)})를 넘었어요`) + (plan.from ? ` (${josa(pw, '은', '는')} ${mdS(plan.from)}부터 기록)` : ''));
  }

  // 카드 4개
  const cards: CardExpect[] = METRICS.map((m) => {
    const tn = m === 'volume' && ton, cc = curCmp(m), pv = prevCmp(m);
    let small: string[];
    if (plan.mode === 'none') small = ['처음부터'];
    else if (plan.mode === 'nohist') small = ['이전 기록 없음'];
    else if (plan.mode === 'waiting') small = ['운동하면 비교해요'];
    else small = plan.from ? [`${mdS(plan.curFrom)}~ ${val(m, cc, tn)}`, `이전 ${val(m, pv, tn)}`] : [`이전 ${val(m, pv, tn)}`];
    let glyph: CardExpect['glyph'] = '';
    if (plan.mode === 'ok') { const [a, b] = cmpV(m, cc, pv, tn); glyph = a > b ? '▲' : a < b ? '▼' : '='; }
    return { metric: m, hero: val(m, tot(m), tn), small, glyph };
  });

  // 범위 줄
  let range: string;
  if (kind === 'all') range = `${ymK(first)}부터`;
  else {
    const cmpWord = `vs. ${pw}`;
    if (kind === 'week') {
      const e = add(r0, 6), ty = yNum(today);
      const r = yNum(r0) !== yNum(e) ? `${yNum(r0)}년 ${mdK(r0)}~${yNum(e)}년 ${mdK(e)}`
        : `${yNum(r0) === ty ? '' : `${yNum(r0)}년 `}${mdK(r0)}~${mNum(r0) === mNum(e) ? `${dNum(e)}일` : mdK(e)}`;
      range = `${r} ${cmpWord}`;
    } else if (kind === 'month') range = `${yNum(r0) === yNum(today) ? '' : `${yNum(r0)}년 `}${mNum(r0)}월 1일~${dim(yNum(r0), mNum(r0))}일 ${cmpWord}`;
    else range = `${yNum(r0)}년 1월~12월 ${cmpWord}`;
  }

  // 그래프
  const hasCur = nCur > 0;
  const empty = !hasCur && !(mode !== 'bar' && !!prevValues?.some((v) => v > 0));
  const slots = mode === 'bar' ? buckets.length : Math.max(buckets.length, prevValues ? prevValues.length : 0);
  const showPrev = mode !== 'bar' && !!prevValues;
  const counts = {
    slots,
    cur: mode === 'both' ? values.filter((v, i) => v > 0 && buckets[i]!.start <= today).length : 0,
    prev: mode === 'both' && prevValues ? prevValues.filter((v) => v > 0).length : 0,
    polyCur: mode !== 'bar' && upto > 1 ? 1 : 0,
    polyPrev: showPrev && prevValues!.length > 1 ? 1 : 0,
    end: mode !== 'bar' ? 1 : 0,
  };

  // 평균선·범례
  const state = buckets.map((b) => (b.start > today ? 'future' : today < b.end ? 'now' : 'past'));
  const mask = buckets.map((b, i) => countRows(W, b.start, add(b.end, -1) < today ? add(b.end, -1) : today) > 0 && b.start <= today && !(wide && state[i] === 'now'));
  const act = values.filter((_, i) => mask[i]);
  const avgV = act.length ? act.reduce((a, b) => a + b, 0) / act.length : 0;
  const excluded = buckets.some((b, i) => wide && state[i] === 'now' && countRows(W, b.start, today) > 0);
  const showAvg = mode === 'bar' && !empty && avgV > 0 && act.length >= 2 && avgV < Math.max(...values) && !(metric === 'count' && (kind === 'week' || kind === 'month'));
  const avg = showAvg ? `${wide ? '운동한 달' : '운동한 날'} 평균${excluded ? '(이번 달 제외)' : ''} ${metric === 'time' ? durText(avgV) : metric === 'volume' ? val('volume', Math.round(avgV), ton) : val(metric, avgV)}` : null;
  const curName = kind === 'all' ? (mode === 'cum' ? '처음부터 누적' : '처음부터') : `${label} (오늘까지)`;
  let legend: string[] | null = null;
  if (mode !== 'bar' && !empty) {
    legend = [curName];
    if (kind !== 'all' && plan.full) legend.push(`${pw}${plan.from ? ` (${mdS(plan.from)}부터 기록)` : ''}${mode === 'cum' ? ' 전체' : ''}`);
  }
  const unit = wide ? '달별' : '날짜별', firstWord = kind === 'all' ? '처음부터' : '기간 첫날부터';
  let caption: string;
  if (empty) caption = '';
  else if (sel !== null && mode !== 'cum') caption = selectedCaption(W, today, kind, metric, mode, sel);
  else if (mode === 'cum') caption = `선 = ${firstWord} 쌓인 합계 · ${unit} 값은 [막대]나 [막대+누적]에서 볼 수 있어요`;
  else {
    const tap = `막대를 누르거나 옆으로 밀면 ${unit} 값이 보여요`;
    caption = mode === 'both' ? `막대 = ${unit} 값, 선 = ${firstWord} 쌓인 합계${prevValues ? ` (파랑 ${label} · 회색 ${pw})` : ''} · ${tap}` : tap;
  }

  // 각주
  const foot = kind === 'all' ? { exact: '전체 = 처음 기록한 달부터. 비교할 이전 기간이 없어 ▲▼ 는 없어요.' }
    : plan.mode === 'nohist' ? { includes: '기록을 시작하기 전이라 ▲▼ 비교를 하지 않아요' } : { startsWith: '▲▼ = ' };

  // 내역
  const sa = sel !== null && mode !== 'cum' ? buckets[sel]!.start : r0, sb = sel !== null && mode !== 'cum' ? buckets[sel]!.end : r1;
  const hist = histOf(W, today, sa, sb, sel !== null && mode !== 'cum' ? (wide ? ymK(sa) : mdK(sa)) : label, 5);

  return {
    label, range, heroLabel: `${label} ${NAME[metric]}${kind === 'all' ? ' 합계' : ''}`, hero: val(metric, full, metric === 'volume' && ton), headline, sentence, subs, cards,
    noteShown: plan.mode === 'ok', foot, caption, legend, avg,
    chart: empty ? 'empty' : mode === 'cum' ? 'cum' : 'bars', emptyText: '운동을 끝내면 여기에 막대가 생겨요', counts, hist,
    plan, values, prevValues, buckets, ton,
  };
}

/** 칸을 골랐을 때 한 칸 문구 (SPEC #7: "11월 16일 (월) · 작업 세트 22세트 · 누적 22세트 · 지난주 같은 요일 15세트") */
export function selectedCaption(W: MockRow[], today: string, kind: Kind, metric: Metric, mode: Mode, i: number): string {
  const first = firstOf(W, today), done = W.some((r) => r.date === today);
  const { r0, r1 } = rangeOf(kind, today, first), plan = planOf(kind, today, first, done), buckets = bucketsOf(kind, r0, r1);
  const wide = kind === 'year' || kind === 'all';
  const b = buckets[i]!, endIn = add(b.end, -1) < today ? add(b.end, -1) : today;
  const v = sumRows(W, metric, b.start, endIn), active = countRows(W, b.start, endIn) > 0;
  const ton = tonMode(sumRows(W, 'volume', r0, today), plan.mode === 'ok' ? sumRows(W, 'volume', plan.from ?? plan.ps, plan.through!) : 0);
  const name = wide ? ymK(b.start) : `${mdK(b.start)} (${WDN[dow(b.start)]})`;
  if (mode === 'bar') return active ? `${name} · ${NAME[metric]} ${val(metric, v, ton)}${!wide && metric !== 'count' ? ` · 운동 ${countRows(W, b.start, endIn)}회` : ''}` : `${name} · 운동 안 함`;
  const cum = sumRows(W, metric, r0, endIn);
  const parts = [name, active ? `${NAME[metric]} ${val(metric, v, ton)}` : '운동 안 함', `누적 ${val(metric, cum, ton)}`];
  if (plan.full && kind !== 'all') {
    const pb = bucketsOf(kind, plan.ps, plan.pe);
    if (i < pb.length) { const pv = sumRows(W, metric, pb[i]!.start, add(pb[i]!.end, -1)); parts.push(`${PW[kind]} 같은 ${kind === 'week' ? '요일' : kind === 'month' ? '날' : '달'} ${pv > 0 ? val(metric, pv, ton) : '운동 안 함'}`); }
  }
  return parts.join(' · ');
}

/** 내역: [a, b) 날짜(오늘까지)의 운동, 최신이 먼저 */
export function histOf(W: MockRow[], today: string, a: string, b: string, name: string, shown: number): HistExpect {
  const list = W.filter((r) => r.date >= a && r.date < b && r.date <= today).sort((x, y) => (x.date < y.date ? 1 : -1));
  const rows = list.slice(0, shown).map((r) => ({ d: `${mNum(r.date)}/${dNum(r.date)} (${WDN[dow(r.date)]})`, n: r.name, m: `${r.sets}세트 · ${comma(r.volume)}kg · ${durText(r.time)}` }));
  const left = list.length - rows.length;
  return { title: `${name} 운동 ${list.length}개`, rows, more: left > 0 ? `${Math.min(5, left)}개 더 보기 (남은 ${left}개)` : null, empty: list.length === 0 ? '이 기간에는 운동 기록이 없어요.' : null, total: list.length };
}

// ---------- 훈련 부하 (SPEC '부하 계산식') ----------
export type Zone = 'low' | 'ok' | 'warn' | 'bad';
export const ZONE_NAME: Record<Zone, string> = { low: '평소보다 적음', ok: '평소 수준', warn: '평소보다 많음', bad: '평소보다 크게 많음' };
/** 승인 목업 zoneOf 의 한 문장 (고정값) */
export const ZONE_SAY: Record<Zone, string> = {
  low: '최근 7일이 평소(4주 평균)보다 가벼워요. 쉬거나 일부러 줄인 주라면 자연스러워요.',
  ok: '최근 7일이 평소(4주 평균)와 비슷한 양이에요.',
  warn: '최근 7일이 평소보다 많아요. 쉬었다가 돌아온 주라면 흔히 이렇게 나와요.',
  bad: '최근 7일이 평소보다 크게 많아요. 쉬었다 돌아온 주라면 자연스러운 숫자예요. 통증이나 피로가 쌓이면 다음 운동 양을 줄여 보세요.',
};
export const LOAD_NOTE = "구간 값(0.8·1.3·1.5)은 팀 스포츠 연구에서 온 참고값이에요. 세트 수로 센 근력 운동에서는 근거가 약해서, 판단보다 '평소와 얼마나 다른가'를 보는 참고로 쓰세요. 첫 기록 21일째부터 보이고, 4주가 안 되면 첫 기록일부터 지난 날 수(쉰 날 포함)로 평균을 내요.";
export const zoneOf = (vd: number): Zone => (vd < 0.8 ? 'low' : vd <= 1.3 ? 'ok' : vd <= 1.5 ? 'warn' : 'bad');
/** 날짜 d 의 부하 비율의 화면 값(소수 둘째 자리). 첫 기록 21일 전이면 null */
export function loadVdOn(W: MockRow[], first: string, d: string): number | null {
  const nd = Math.min(28, daysBetween(first, d) + 1);
  if (nd < 21) return null;
  const a7 = sumRows(W, 'sets', add(d, -6), d), c = sumRows(W, 'sets', add(d, -(nd - 1)), d);
  return Number((c ? a7 / (c / (nd / 7)) : 0).toFixed(2));
}
export interface LoadExpect {
  show: boolean; wait: string; vd?: number; ratio?: string; zone?: Zone; zoneName?: string; mk?: number; week?: string; say?: string;
  rs?: (number | null)[]; rp?: (number | null)[];
}
export function loadExpect(W: MockRow[], today: string): LoadExpect {
  const first = firstOf(W, today), histDays = daysBetween(first, today) + 1;
  const wait = `기록이 3주 쌓이면 부하 비율을 보여 드려요. 지금 ${histDays}일째예요.`;
  if (histDays < 21) return { show: false, wait };
  const vd = loadVdOn(W, first, today)!, zone = zoneOf(vd), nd = Math.min(28, histDays);
  const pv = loadVdOn(W, first, add(today, -7)), wdn = WDN[dow(today)]!;
  const cur = Math.round(vd * 100), prev = pv === null ? 0 : Math.round(pv * 100);
  const week = pv === null ? `지난주 ${wdn}요일은 기록이 3주가 안 돼 견줄 비율이 없어요.`
    : `지난주 ${wdn}요일 ${pv.toFixed(2)} → 오늘 ${vd.toFixed(2)}` + (cur === prev ? ' · 지난주와 같아요' : ` · 지난주보다 ${(Math.abs(cur - prev) / 100).toFixed(2)} ${cur > prev ? '높아요' : '낮아요'}`);
  const last7 = sumRows(W, 'sets', add(today, -6), today);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => add(today, i - 6));
  return {
    show: true, wait, vd, ratio: vd.toFixed(2), zone, zoneName: ZONE_NAME[zone], mk: Math.min(100, vd / 2 * 100), week,
    say: `${ZONE_SAY[zone]} (오늘까지 7일 ${comma(last7)}세트${nd < 28 ? ` · 기록이 ${nd}일이라 ${nd}일 평균과 비교` : ''})`,
    rs: days.map((d) => loadVdOn(W, first, d)), rp: days.map((d) => loadVdOn(W, first, add(d, -7))),
  };
}
