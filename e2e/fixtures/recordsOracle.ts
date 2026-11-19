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
/** 받침 여부 (한글 음절, 'g'(kg)는 있음으로 봄 — 앱 hasBatchim 규칙) */
const batchim = (w: string): boolean => { const c = w.charCodeAt(w.length - 1); return w.endsWith('g') || (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0); }; // 앱 규칙: kg 는 받침 있음
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
const tonAll = (...v: number[]): boolean => Math.max(0, ...v) >= 1_000_000;
const PAST: Record<Exclude<Kind, 'all'>, string> = { week: '그 전 주', month: '그 전 달', year: '전년' };
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

/** off 기간 전의 범위 (전체는 늘 처음~이번 달, off 0 은 이번 기간) */
export function rangeAt(kind: Kind, today: string, first: string | null, off: number): { r0: string; r1: string } {
  if (kind === 'all' || off === 0) return rangeOf(kind, today, first ?? today);
  if (kind === 'week') return rangeOf(kind, add(today, -7 * off), today);
  if (kind === 'month') return rangeOf(kind, monthShift(monthFirst(today), -off), today);
  return rangeOf(kind, `${yNum(today) - off}-06-15`, today);
}
/** 이동줄 이름 (앱 periodLabel): 이번·지난·그 전 */
function labelOf(kind: Kind, r0: string, off: number, today: string): string {
  if (kind === 'all' || off === 0) return LABEL[kind];
  const yp = yNum(r0) === yNum(today) ? '' : `${yNum(r0)}년 `;
  if (kind === 'week') return off === 1 ? '지난주' : `${yp}${mdK(r0)}부터 한 주`;
  if (kind === 'month') return off === 1 ? '지난달' : `${yp}${mNum(r0)}월`;
  return off === 1 ? '작년' : `${yNum(r0)}년`;
}

/** 이전 기간과 견주는 방법 (SPEC #12·#13): none = 전체 탭 · nohist = 이전 기간(또는 비교 구간)이 첫 기록일 전(기록이 하나도 없어도) · waiting = 기간 첫날 운동 전 · ok. whole = 이번 달이 더 길어 지난달 전체와 견줌 (R9) */
export interface Plan { mode: 'none' | 'nohist' | 'waiting' | 'ok'; from: string | null; curFrom: string; through: string | null; full: boolean; ps: string; pe: string; whole: boolean }
export function planOf(kind: Kind, today: string, first: string | null, done: boolean, off = 0): Plan {
  const { r0 } = rangeAt(kind, today, first, off);
  if (kind === 'all') return { mode: 'none', from: null, curFrom: r0, through: null, full: false, ps: r0, pe: r0, whole: false };
  const ps = prevStartOf(kind, r0), pe = r0;
  if (first === null || first >= pe) return { mode: 'nohist', from: null, curFrom: r0, through: null, full: false, ps, pe, whole: false };
  const from = first > ps ? first : null;
  const curFrom = from ? alignFwd(kind, from) : r0;
  if (off > 0) return { mode: 'ok', from, curFrom, through: null, full: true, ps, pe, whole: false }; // 지난 기간은 이전 기간 전체와 견줌
  if (!done && today === r0) return { mode: 'waiting', from, curFrom, through: null, full: true, ps, pe, whole: false };
  const basis = done ? today : add(today, -1);
  const through = kind === 'week' ? add(basis, -7) : kind === 'month' ? monthShift(basis, -1) : monthShift(basis, -12);
  const whole = kind === 'month' && Number(today.slice(8)) - (done ? 0 : 1) > Number(through.slice(8));
  if (from && from > through) return { mode: 'nohist', from, curFrom, through: null, full: true, ps, pe, whole: false };
  return { mode: 'ok', from, curFrom, through, full: true, ps, pe, whole };
}

export const firstOf = (W: MockRow[], today: string): string | null => W.filter((r) => r.date <= today).map((r) => r.date).sort()[0] ?? null;

// ---------- 기간 카드 기대값 ----------
export interface CardExpect { metric: Metric; hero: string; small: string[]; glyph: '' | '▲' | '▼' | '='; aria: string }
export interface HistExpect { title: string; rows: { d: string; n: string; m: string }[]; more: string | null; empty: string | null; total: number }
export interface ViewExpect {
  label: string; range: string; heroLabel: string; hero: string;
  /** 한 문장 칸의 글자 전체: 이름이 문장 앞에 없으면 화면 읽기용 "이번 주: " 가 붙음 */
  headline: string; sentence: string; subs: string[];
  cards: CardExpect[];
  noteShown: boolean; foot: string;
  caption: string; legend: string[] | null; avg: string | null;
  chart: 'bars' | 'cum' | 'empty'; emptyText: string;
  counts: { slots: number; cur: number; prev: number; polyCur: number; polyPrev: number; end: number };
  hist: HistExpect;
  plan: Plan; values: number[]; prevValues: number[] | null; buckets: Bucket[]; ton: boolean;
}

/** 이번 기간(off 0) 또는 off 기간 전의 모든 기대값. first = 첫 기록일 (기록이 하나도 없으면 null: 새 설치) */
export function expectView(W: MockRow[], today: string, kind: Kind, metric: Metric, mode: Mode, sel: number | null = null, off = 0): ViewExpect {
  const first = firstOf(W, today);
  const done = W.some((r) => r.date === today);
  const cur = off === 0 || kind === 'all'; // 이번 기간을 보는 중
  const { r0, r1 } = rangeAt(kind, today, first, off);
  const upTo = add(r1, -1) < today ? add(r1, -1) : today; // 이번 기간은 오늘까지, 지난 기간은 끝까지
  const plan = planOf(kind, today, first, done, off);
  const buckets = bucketsOf(kind, r0, r1);
  const wide = kind === 'year' || kind === 'all';
  const label = labelOf(kind, r0, off, today);
  const pw = kind === 'all' ? '' : cur ? PW[kind] : PAST[kind]; // 짧은 이전 기간 이름
  const values = buckets.map((b) => (b.start > today ? 0 : sumRows(W, metric, b.start, add(b.end, -1) < today ? add(b.end, -1) : today)));
  const upto = buckets.findIndex((b) => b.start > today) === -1 ? buckets.length : buckets.findIndex((b) => b.start > today);
  const prevBuckets = plan.full && kind !== 'all' ? bucketsOf(kind, plan.ps, plan.pe) : null;
  const prevValues = prevBuckets ? prevBuckets.map((b) => sumRows(W, metric, b.start, add(b.end, -1))) : null;

  // 합계들 (지표별)
  const cmpFrom = plan.from ?? plan.ps, cmpTo = plan.through ?? add(plan.pe, -1);
  const tot = (m: Metric) => sumRows(W, m, r0, upTo);
  const curCmp = (m: Metric) => sumRows(W, m, plan.from ? plan.curFrom : r0, upTo);
  const prevCmp = (m: Metric) => (plan.mode === 'ok' ? sumRows(W, m, cmpFrom, cmpTo) : 0);
  const prevFull = (m: Metric) => (plan.full ? sumRows(W, m, plan.ps, add(plan.pe, -1)) : 0);
  const nCur = countRows(W, r0, upTo);
  const nPrev = plan.mode === 'ok' ? countRows(W, cmpFrom, cmpTo) : 0;
  const ton = tonAll(tot('volume'), curCmp('volume'), prevCmp('volume'), prevFull('volume')); // 한 화면(큰 숫자·한 문장·둘째 줄·카드·범례·칸 문구)이 같은 단위: 어느 값이든 100만 kg 이상이면 모두 톤

  // 한 문장
  let sentence: string; let lead = false; // lead = 한 문장 조각 중 기간 이름으로 시작하는 것이 있음 (그러면 화면 읽기용 이름 접두어가 안 붙음)
  const full = tot(metric);
  const none = (): void => { if (cur) { sentence = `${josa(label, '은', '는')} 아직 운동 기록이 없어요`; lead = true; } else sentence = '이 기간에는 운동 기록이 없어요'; };
  const pn = plan.whole ? '지난달 전체' : cur ? `${pw} 이맘때` : pw;
  sentence = '';
  if (kind === 'all') sentence = first === null ? '아직 운동 기록이 없어요' : `${ymK(first)}부터 운동 ${comma(nCur)}회 · 작업 세트 ${comma(tot('sets'))}세트`;
  else if (first === null) none();
  else if (plan.mode === 'nohist') {
    sentence = `${josa(cur ? `${pw} 이맘때` : pw, '은', '는')} 기록을 시작하기 전이에요`;
    if (nCur > 0) { sentence += ` · ${label} ${val(metric, full, metric === 'volume' && ton)}`; lead = true; }
  } else if (nCur === 0 && nPrev === 0) none();
  else if (nPrev === 0) { sentence = `${josa(pn, '은', '는')} 운동이 없었어요 · ${label} ${val(metric, full, metric === 'volume' && ton)}`; lead = true; }
  else {
    const cc = curCmp(metric), p = prevCmp(metric), t = metric === 'volume' && ton;
    const [sc, sp] = cmpV(metric, cc, p, t), nm = josa(NAME[metric], '이', '가');
    sentence = sc === sp ? `${josa(pn, '과', '와')} ${nm} 같아요`
      : `${pn}보다 ${nm} ${diffText(metric, sc, sp, t)} ${metric === 'time' ? (sc > sp ? '길어요' : '짧아요') : (sc > sp ? '많아요' : '적어요')}`;
  }
  const headline = (lead ? '' : `${label}: `) + sentence;

  // 둘째 줄들
  const subs: string[] = [];
  if (plan.mode === 'ok' && plan.from) subs.push(`${pw} 기록이 ${mdK(plan.from)}부터라 ${mdK(plan.curFrom)} 이후끼리 견줬어요`);
  if (cur && plan.full && mode !== 'bar' && prevFull(metric) > 0) {
    const t = metric === 'volume' && ton, pf = prevFull(metric);
    const [sc, sp] = cmpV(metric, full, pf, t);
    subs.push((sp - sc > 0 ? `${pw} 전체까지 ${diffText(metric, sp, sc, t)} 남았어요` : `${pw} 전체(${val(metric, pf, t)})를 넘었어요`) + (plan.from ? ` (${josa(pw, '은', '는')} ${mdS(plan.from)}부터 기록)` : ''));
  }

  // 카드 4개 (작은 줄·▲▼·읽기 문구)
  const phrase = cur ? `${PW[kind === 'all' ? 'week' : kind]} ${kind === 'week' ? '같은 요일까지' : '같은 날까지'}` : pw;
  const partialPhrase = (th: string): string => (kind === 'week' ? `지난주 ${WDN[dow(th)]}요일까지` : kind === 'month' ? `지난달 ${dNum(th)}일까지` : `작년 ${mNum(th)}월 ${dNum(th)}일까지`);
  const cards: CardExpect[] = METRICS.map((m) => {
    const tn = m === 'volume' && ton, cc = curCmp(m), pv = prevCmp(m);
    let small: string[]; let aria: string;
    const head0 = `${NAME[m]} ${val(m, tot(m), tn)}`;
    if (plan.mode === 'none') { small = ['처음부터']; aria = `${head0}, 처음부터`; }
    else if (plan.mode === 'nohist') { small = ['이전 기록 없음']; aria = `${head0}, 이전 기록 없음`; }
    else if (plan.mode === 'waiting') { small = ['운동하면 비교해요']; aria = `${head0}, 오늘 운동하면 ${phrase}와 비교해요`; }
    else {
      small = plan.from ? [`${mdS(plan.curFrom)}~ ${val(m, cc, tn)}`, `이전 ${val(m, pv, tn)}`] : [`이전 ${val(m, pv, tn)}`];
      const fd = plan.from ? dNum(plan.from) : 1, wd = plan.through ? dNum(plan.through) : 0;
      const pp = plan.whole ? `지난달 전체(${fd === wd ? `${wd}일` : `${fd}~${wd}일`})` : cur && !done ? partialPhrase(plan.through!) : phrase;
      const [a, b] = cmpV(m, cc, pv, tn);
      const head = `${head0}, ${plan.from ? `${mdK(plan.curFrom)}부터 ${val(m, cc, tn)}, ` : ''}${pp} `;
      aria = a === b ? `${head}${josa(val(m, pv, tn), '과', '와')} 같음` : `${head}${val(m, pv, tn)}보다 ${diffText(m, a, b, tn)} ${m === 'time' ? (a > b ? '김' : '짧음') : (a > b ? '많음' : '적음')}`;
    }
    let glyph: CardExpect['glyph'] = '';
    if (plan.mode === 'ok') { const [a, b] = cmpV(m, cc, pv, tn); glyph = a > b ? '▲' : a < b ? '▼' : '='; }
    return { metric: m, hero: val(m, tot(m), tn), small, glyph, aria };
  });

  // 범위 줄
  let range: string;
  if (kind === 'all') range = `${ymK(r0)}부터`;
  else {
    const cmpWord = plan.whole ? 'vs. 지난달 전체' : `vs. ${pw}`;
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
  const curName = kind === 'all' ? (mode === 'cum' ? '처음부터 누적' : '처음부터') : `${label}${cur ? ' (오늘까지)' : ''}`;
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

  // 내역
  const sa = sel !== null && mode !== 'cum' ? buckets[sel]!.start : r0, sb = sel !== null && mode !== 'cum' ? buckets[sel]!.end : r1;
  const hist = first === null ? { title: '', rows: [], more: null, empty: null, total: 0 } : histOf(W, today, sa, sb, sel !== null && mode !== 'cum' ? (wide ? ymK(sa) : mdK(sa)) : label, 5);

  return {
    label, range, heroLabel: `${label} ${NAME[metric]}${kind === 'all' ? ' 합계' : ''}`, hero: val(metric, full, metric === 'volume' && ton), headline, sentence, subs, cards,
    noteShown: plan.mode === 'ok', foot: footOf(W, today, kind, off, plan, first, done, r0), caption, legend, avg,
    chart: empty ? 'empty' : mode === 'cum' ? 'cum' : 'bars', emptyText: '운동을 끝내면 여기에 막대가 생겨요', counts, hist,
    plan, values, prevValues, buckets, ton,
  };
}

/** 연속 운동 주 수 (이번 주 포함, 이번 주에 아직 없으면 지난주부터) */
function streakOf(W: MockRow[], today: string): number {
  const weeks = new Set(W.filter((r) => r.date <= today).map((r) => add(r.date, -dow(r.date))));
  let c = add(today, -dow(today));
  if (!weeks.has(c)) c = add(c, -7);
  let n = 0;
  while (weeks.has(c)) { n++; c = add(c, -7); }
  return n;
}

/** 각주 전체 글자 (SPEC 이 못 박지 않은 부분은 앱 D-081 문구): 전체 탭 · 기록 전 · 첫날 운동 전 · 같은 구간 · 지난달 전체 · 지난 기간 */
function footOf(W: MockRow[], today: string, kind: Kind, off: number, plan: Plan, first: string | null, done: boolean, r0: string): string {
  if (kind === 'all') return '전체 = 처음 기록한 달부터. 비교할 이전 기간이 없어 ▲▼ 는 없어요.';
  const cur = off === 0, pw = cur ? PW[kind] : PAST[kind];
  if (plan.mode === 'nohist' && first !== null) return `${josa(cur && plan.full ? `${PW[kind]} 이맘때` : pw, '은', '는')} 기록을 시작하기 전이라 ▲▼ 비교를 하지 않아요 (첫 기록 ${yNum(first) === yNum(today) ? '' : `${yNum(first)}년 `}${mdK(first)})`;
  const from = plan.mode === 'ok' ? plan.from : null;
  const same = from ? `(${josa(pw, '은', '는')} ${mdK(from)}부터 기록이라 같은 구간끼리)` : '';
  const sameTail = from ? ` · ${josa(pw, '은', '는')} ${mdK(from)}부터 기록이라 같은 구간끼리` : '';
  const dayGap = (n: number) => (n === 1 ? '하루' : `${n}일`);
  if (!cur) {
    if (kind === 'month') {
      const a = dim(yNum(r0), mNum(r0)), pm = monthShift(r0, -1), b = dim(yNum(pm), mNum(pm));
      if (a !== b) return `▲▼ = 그 전 달 전체(${b}일)와 비교 · 이 달이 ${dayGap(Math.abs(a - b))} ${a > b ? '더 길어요' : '더 짧아요'}${sameTail}`;
    }
    if (kind === 'year') {
      const ly = (y: number) => (new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1 ? 366 : 365);
      const a = ly(yNum(r0)), b = ly(yNum(r0) - 1);
      if (a !== b) return `▲▼ = 전년 전체와 비교 · 이 해가 하루 ${a > b ? '더 길어요' : '더 짧아요'}${sameTail}`;
    }
    return `▲▼ = ${PAST[kind]} 전체와 비교${sameTail}`;
  }
  // 이번 기간: 견주는 끝(through)·오늘 운동하면 견줄 끝(base)은 plan 이 아니라 날짜에서 다시 구함 (기록이 없는 새 설치도 같은 일반 각주)
  const back = (d: string): string => (kind === 'week' ? add(d, -7) : monthShift(d, kind === 'month' ? -1 : -12));
  const waiting = !done && today === r0;
  const base = back(today), through = done ? back(today) : back(add(today, -1));
  const later = !done && through !== base;
  const streak = streakOf(W, today), streakText = streak > 0 ? ` · 연속 ${streak}주` : '';
  if (waiting) return kind === 'week' ? `▲▼ = 오늘 운동하면 지난주 같은 요일(일)까지와 비교${streakText} · 일요일~토요일 기준` : kind === 'month' ? '▲▼ = 오늘 운동하면 지난달 같은 날(1일)까지와 비교' : '▲▼ = 오늘 운동하면 작년 같은 날(1월 1일)까지와 비교';
  const span = (a: string, b: string, text: string): string => (a === b ? `(${mdK(a)})` : `(${text})`);
  const days = (a: number, b: number): string => (a === b ? `(${a}일)` : `(${a}~${b}일)`);
  if (kind === 'week') {
    const w = dow(through), wf = from ? dow(from) : 0;
    const rng = from ? (wf === w ? `(${WDN[w]})` : `(${WDN[wf]}~${WDN[w]})`) : `(일${w > 0 ? `~${WDN[w]}` : ''})`;
    return `▲▼ = 지난주 같은 요일${rng}까지와 비교${same}${later ? ` · 오늘 운동하면 ${WDN[dow(base)]}요일까지` : ''}${streakText} · 일요일~토요일 기준`;
  }
  if (kind === 'month') {
    const fd = from ? dNum(from) : 1, td = dNum(today) - (done ? 0 : 1);
    if (td > dNum(through)) return `▲▼ = 지난달 전체${days(fd, dNum(through))}와 비교 · 이번 달 구간${days(fd, td)}이 ${dayGap(td - dNum(through))} 더 길어요${same}`;
    return `▲▼ = 지난달 같은 날${from ? span(from, through, `${mdK(from)}~${mdK(through)}`) : dNum(through) === 1 ? '(1일)' : `(1~${dNum(through)}일)`}까지와 비교${same}${later ? ` · 오늘 운동하면 ${dNum(base)}일까지` : ''}`;
  }
  const dn = (s: string): number => uT(s) / 86400000;
  const curLen = dn(today) - (done ? 0 : 1) - dn(from ? plan.curFrom : `${yNum(today)}-01-01`) + 1, prevLen = dn(through) - dn(from ?? `${yNum(through)}-01-01`) + 1;
  return `▲▼ = 작년 같은 날${from ? span(from, through, `${mdK(from)}~${mdK(through)}`) : mNum(through) === 1 && dNum(through) === 1 ? '(1월 1일)' : `(1월 1일~${mdK(through)})`}까지와 비교${same}${later ? ` · 오늘 운동하면 ${mdK(base)}까지` : ''}${curLen !== prevLen ? ` · 올해 구간이 하루 ${curLen > prevLen ? '더 길어요' : '더 짧아요'}` : ''}`;
}

/** 칸을 골랐을 때 한 칸 문구 (SPEC #7: "11월 16일 (월) · 작업 세트 22세트 · 누적 22세트 · 지난주 같은 요일 15세트"). 이번 기간만 */
export function selectedCaption(W: MockRow[], today: string, kind: Kind, metric: Metric, mode: Mode, i: number): string {
  const first = firstOf(W, today), done = W.some((r) => r.date === today);
  const { r0, r1 } = rangeOf(kind, today, first ?? today), plan = planOf(kind, today, first, done), buckets = bucketsOf(kind, r0, r1);
  const wide = kind === 'year' || kind === 'all';
  const b = buckets[i]!, endIn = add(b.end, -1) < today ? add(b.end, -1) : today;
  const v = sumRows(W, metric, b.start, endIn), active = countRows(W, b.start, endIn) > 0;
  const cmpFrom = plan.from ?? plan.ps;
  const ton = tonAll(sumRows(W, 'volume', r0, today), sumRows(W, 'volume', plan.from ? plan.curFrom : r0, today), plan.mode === 'ok' ? sumRows(W, 'volume', cmpFrom, plan.through!) : 0, plan.full ? sumRows(W, 'volume', plan.ps, add(plan.pe, -1)) : 0);
  const name = wide ? ymK(b.start) : `${mdK(b.start)} (${WDN[dow(b.start)]})`;
  if (mode === 'bar') return active ? `${name} · ${NAME[metric]} ${val(metric, v, ton)}${!wide && metric !== 'count' ? ` · 운동 ${countRows(W, b.start, endIn)}회` : ''}` : `${name} · 운동 안 함`;
  const cum = sumRows(W, metric, r0, endIn);
  const parts = [name, active ? `${NAME[metric]} ${val(metric, v, ton)}` : '운동 안 함', `누적 ${val(metric, cum, ton)}`];
  if (plan.full && kind !== 'all') {
    const pb = bucketsOf(kind, plan.ps, plan.pe);
    if (i < pb.length) {
      const pv = sumRows(W, metric, pb[i]!.start, add(pb[i]!.end, -1));
      const zero = plan.from && pb[i]!.end <= plan.from ? '기록 전' : '운동 안 함'; // 이전 칸이 통째로 첫 기록일 전
      parts.push(`${PW[kind]} 같은 ${kind === 'week' ? '요일' : kind === 'month' ? '날' : '달'} ${pv > 0 ? val(metric, pv, ton) : zero}`);
    }
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
  const first = firstOf(W, today);
  if (first === null) return { show: false, wait: '기록이 3주 쌓이면 부하 비율을 보여 드려요.' };
  const histDays = daysBetween(first, today) + 1;
  const wait = `기록이 3주 쌓이면 부하 비율을 보여 드려요. 지금 ${histDays}일째예요.`;
  if (histDays < 21) return { show: false, wait };
  const vd = loadVdOn(W, first, today)!, zone = zoneOf(vd), nd = Math.min(28, histDays);
  const pv = loadVdOn(W, first, add(today, -7)), wdn = WDN[dow(today)]!;
  const cur = Math.round(vd * 100), prev = pv === null ? 0 : Math.round(pv * 100);
  // 4주 창(오늘·지난주 같은 요일)에 세트가 하나도 없으면(비율 0) 안내 문구
  const d7 = add(today, -7), ndp = Math.min(28, histDays - 7);
  const emptyNow = sumRows(W, 'sets', add(today, -(nd - 1)), today) === 0, emptyPrev = pv !== null && sumRows(W, 'sets', add(d7, -(ndp - 1)), d7) === 0;
  const week = emptyNow && emptyPrev ? '지난주와 이번 주 모두 최근 4주 기록이 없어요.' : pv === null ? `지난주 ${wdn}요일은 기록이 3주가 안 돼 견줄 비율이 없어요.`
    : `지난주 ${wdn}요일 ${pv.toFixed(2)} → 오늘 ${vd.toFixed(2)}` + (cur === prev ? ' · 지난주와 같아요' : ` · 지난주보다 ${(Math.abs(cur - prev) / 100).toFixed(2)} ${cur > prev ? '높아요' : '낮아요'}`);
  const last7 = sumRows(W, 'sets', add(today, -6), today);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => add(today, i - 6));
  return {
    show: true, wait, vd, ratio: vd.toFixed(2), zone, zoneName: ZONE_NAME[zone], mk: Math.min(100, vd / 2 * 100), week,
    say: `${emptyNow ? '최근 4주 동안 운동 기록이 없어요. 다시 운동하면 평소와 견줘 보여 드려요.' : ZONE_SAY[zone]} (오늘까지 7일 ${comma(last7)}세트${nd < 28 ? ` · 기록이 ${nd}일이라 ${nd}일 평균과 비교` : ''})`,
    rs: days.map((d) => loadVdOn(W, first, d)), rp: days.map((d) => loadVdOn(W, first, add(d, -7))),
  };
}
