/**
 * D-081·D-082 기간 요약 (주·월·년·전체): 한 기간의 합계와 칸(일·월)별 계열, 같은 상대 위치의 이전 기간 끝 날짜.
 * 센 규칙은 weekSummary 와 같다 (끝났고 완료한 작업 세트가 있는 운동, 현지 날짜, 한 운동은 한 번만 summarize).
 * 모두 'YYYY-MM-DD' 문자열 날짜. 주는 일요일 시작 (D-054)
 */
import type { Workout } from './session';
import type { Exercise } from './types';
import { addDays, isCountedWorkout, localDate, summarize, weekStart } from './stats';
import type { BodyweightEntry } from './stats';

export type PeriodKind = 'week' | 'month' | 'year' | 'all';
export type PeriodMetric = 'count' | 'sets' | 'volume' | 'time';
/** start 포함, end 미포함 */
export interface PeriodRange { kind: PeriodKind; start: string; end: string }
export interface Bucket { start: string; end: string }
export interface PeriodTotals { count: number; sets: number; volume: number; durationSec: number }
export interface PeriodData { totals: PeriodTotals; series: Record<PeriodMetric, number[]>; active: boolean[] }

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (date: string): [number, number, number] => { const [y, m, d] = date.split('-').map(Number); return [y!, m!, d!]; };
/** 그 달의 날수 (month 1~12) */
export function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }

/** 전체('all') = first(첫 기록일)가 든 달 1일 ~ date 다음 달 1일. first 가 없거나 date 보다 늦으면 date 가 든 달부터 */
export function periodOf(kind: PeriodKind, date: string, first?: string | null): PeriodRange {
  const [y, m] = parts(date);
  if (kind === 'all') { const [fy, fm] = parts(first && first <= date ? first : date); return { kind, start: ymdOf(fy, fm, 1), end: m === 12 ? ymdOf(y + 1, 1, 1) : ymdOf(y, m + 1, 1) }; }
  if (kind === 'week') { const start = weekStart(date); return { kind, start, end: addDays(start, 7) }; }
  if (kind === 'month') return { kind, start: ymdOf(y, m, 1), end: m === 12 ? ymdOf(y + 1, 1, 1) : ymdOf(y, m + 1, 1) };
  return { kind, start: ymdOf(y, 1, 1), end: ymdOf(y + 1, 1, 1) };
}

/** n 기간 뒤 (음수 = 앞) */
export function shiftPeriod(r: PeriodRange, n: number): PeriodRange {
  if (r.kind === 'all') return r;
  if (r.kind === 'week') return periodOf('week', addDays(r.start, 7 * n));
  const [y, m] = parts(r.start);
  if (r.kind === 'month') { const t = y * 12 + (m - 1) + n; return periodOf('month', ymdOf(Math.floor(t / 12), (t % 12 + 12) % 12 + 1, 1)); }
  return periodOf('year', ymdOf(y + n, 1, 1));
}

/** 칸 목록: 주 = 7일, 월 = 그 달의 날들, 년 = 12개월 */
export function periodBuckets(r: PeriodRange): Bucket[] {
  if (r.kind === 'week' || r.kind === 'month') {
    const n = r.kind === 'week' ? 7 : monthLen(r.start);
    return Array.from({ length: n }, (_, i) => { const start = addDays(r.start, i); return { start, end: addDays(start, 1) }; });
  }
  if (r.kind === 'all') return Array.from({ length: monthCount(r) }, (_, i) => ({ start: monthStart(monthNo(r.start) + i), end: monthStart(monthNo(r.start) + i + 1) }));
  const [y] = parts(r.start);
  return Array.from({ length: 12 }, (_, i) => ({ start: ymdOf(y, i + 1, 1), end: i === 11 ? ymdOf(y + 1, 1, 1) : ymdOf(y, i + 2, 1) }));
}

/** 오늘이 든 기간(cur)과 견줄 이전 기간의 같은 상대 위치 날짜 (포함). 월·년은 없는 날이면 그 달 말일로 */
export function compareThrough(cur: PeriodRange, today: string): string {
  if (cur.kind === 'week') return addDays(today, -7);
  const prev = shiftPeriod(cur, -1);
  const [, tm, td] = parts(today);
  const [py, pm] = parts(prev.start);
  if (cur.kind === 'month') return ymdOf(py, pm, Math.min(td, daysInMonth(py, pm)));
  return ymdOf(py, tm, Math.min(td, daysInMonth(py, tm)));
}

/** 달 번호(연 × 12 + 월 − 1)와 그 달 1일, 전체 기간의 달 수 */
const monthNo = (date: string): number => { const [y, m] = parts(date); return y * 12 + m - 1; };
const monthStart = (no: number): string => ymdOf(Math.floor(no / 12), no % 12 + 1, 1);
const monthCount = (r: PeriodRange): number => monthNo(r.end) - monthNo(r.start);

/** 그 날짜가 든 달의 날수 */
const monthLen = (date: string) => { const [y, m] = parts(date); return daysInMonth(y, m); };

/** 그 날짜에 센 운동이 있나 */
export function hasWorkoutOn(workouts: Workout[], date: string): boolean {
  return workouts.some((w) => isCountedWorkout(w) && localDate(w.startedAt) === date);
}

/**
 * 비교할 이전 기간의 끝 날짜 (포함). 오늘 운동을 했으면 compareThrough 그대로, 아직이면 어제 기준(같은 위치의 어제까지):
 * 운동 전의 오늘(0)을 지난주 같은 요일의 완성된 하루와 견주면 늘 "적어요"로 나오는 편향을 막음.
 * 월·년은 어제 날짜로 다시 맞춰서 짧은 달 끝(3/31 → 2/28)도 이전 기간의 마지막 날을 놓치지 않음.
 * 기간의 첫날이면 어제가 이전 기간 밖이라 비교 구간이 빔 (이전 기간 시작보다 하루 앞 날짜를 돌려줌, waitingForToday 로 구분)
 */
export function compareThroughFor(cur: PeriodRange, today: string, todayDone: boolean): string {
  if (todayDone) return compareThrough(cur, today);
  if (today === cur.start) return addDays(shiftPeriod(cur, -1).start, -1);
  return compareThrough(cur, addDays(today, -1));
}
/** 기간 첫날이고 오늘 운동 전: 견줄 구간이 비어 있음 (▲▼ 를 보여 주지 않음) */
export const waitingForToday = (cur: PeriodRange, today: string, todayDone: boolean): boolean => !todayDone && today === cur.start;

/** start(기간 시작)가 today 가 든 기간에서 몇 기간 전인지 (0 = 이번 기간, 미래면 0) */
export function offsetOf(kind: PeriodKind, start: string, today: string): number {
  if (kind === 'all') return 0;
  const cur = periodOf(kind, today).start;
  const [cy, cm] = parts(cur), [sy, sm] = parts(start);
  const n = kind === 'year' ? cy - sy : kind === 'month' ? (cy * 12 + cm) - (sy * 12 + sm) : Math.round((Date.UTC(cy, cm - 1, parts(cur)[2]) - Date.UTC(sy, sm - 1, parts(start)[2])) / (7 * 86400000));
  return Math.max(0, n);
}

/** 평균에 쓸 칸 평균과 칸 수: 년·전체 보기는 아직 진행 중인 이번 달('now')을 뺌 (덜 찬 달이 평균을 끌어내리지 않게) */
export function averageOver(kind: PeriodKind, values: number[], active: boolean[], state: string[]): { value: number; n: number; excluded: boolean } {
  const skip = (i: number) => (kind === 'year' || kind === 'all') && state[i] === 'now';
  const mask = active.map((a, i) => a && !skip(i));
  return { value: activeAverage(values, mask), n: mask.filter(Boolean).length, excluded: active.some((a, i) => a && skip(i)) }; // excluded = 진행 중인 달에 운동이 있어 실제로 뺌
}

/** 그 해의 날수 (365·366) */
export const daysInYear = (y: number): number => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000);

/** 칸 번호: 주·월 = 날짜 차이, 년 = 달, 전체 = 첫 달부터 센 달 차이 */
function bucketIndex(r: PeriodRange, date: string): number {
  if (r.kind === 'all') return monthNo(date) - monthNo(r.start);
  if (r.kind === 'year') return Number(date.slice(5, 7)) - 1;
  if (r.kind === 'month') return Number(date.slice(8)) - 1;
  const [y1, m1, d1] = parts(r.start), [y2, m2, d2] = parts(date);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** through = 이 날짜(포함)까지만, from = 이 날짜(포함)부터만 (일부 기록 기간의 같은 구간 합) */
export function periodData(workouts: Workout[], byId: Map<string, Exercise>, r: PeriodRange, bw: BodyweightEntry[] = [], through?: string, from?: string): PeriodData {
  const n = r.kind === 'week' ? 7 : r.kind === 'month' ? monthLen(r.start) : r.kind === 'year' ? 12 : monthCount(r);
  const series: Record<PeriodMetric, number[]> = { count: Array(n).fill(0), sets: Array(n).fill(0), volume: Array(n).fill(0), time: Array(n).fill(0) };
  const totals: PeriodTotals = { count: 0, sets: 0, volume: 0, durationSec: 0 };
  const active: boolean[] = Array(n).fill(false);
  for (const w of workouts) {
    if (!isCountedWorkout(w)) continue;
    const date = localDate(w.startedAt);
    if (date < r.start || date >= r.end || (through !== undefined && date > through) || (from !== undefined && date < from)) continue;
    const s = summarize(w, byId, bw);
    const i = bucketIndex(r, date);
    series.count[i]!++; series.sets[i]! += s.workSets; series.volume[i]! += s.volume; series.time[i]! += s.durationSec; active[i] = true;
    totals.count++; totals.sets += s.workSets; totals.volume += s.volume; totals.durationSec += s.durationSec;
  }
  return { totals, series, active };
}

/** 첫 기록일: 센 운동 가운데 가장 이른 현지 날짜 (오늘 뒤 날짜는 무시, 없으면 null) */
export function firstRecordDate(workouts: Workout[], today: string): string | null {
  let min: string | null = null;
  for (const w of workouts) {
    if (!isCountedWorkout(w)) continue;
    const d = localDate(w.startedAt);
    if (d <= today && (min === null || d < min)) min = d;
  }
  return min;
}

/** 가장 오래된 센 운동이 든 기간의 시작 (없으면 오늘이 든 기간의 시작) */
export function earliestPeriod(workouts: Workout[], kind: PeriodKind, today: string): string {
  const first = firstRecordDate(workouts, today);
  return periodOf(kind, first ?? today, first).start;
}

/** 이전 기간의 날짜를 이번 기간의 같은 위치로: 주 +7일, 달 +1달, 해 +1년 (없는 날이면 그 달 말일) */
export function alignFwd(date: string, kind: PeriodKind): string {
  if (kind === 'week') return addDays(date, 7);
  const [y, m, d] = parts(date);
  if (kind === 'month') { const t = y * 12 + m; const ny = Math.floor(t / 12), nm = t % 12 + 1; return ymdOf(ny, nm, Math.min(d, daysInMonth(ny, nm))); }
  if (kind === 'year') return ymdOf(y + 1, m, Math.min(d, daysInMonth(y + 1, m)));
  return date;
}

/**
 * 이전 기간과 견주는 방법. none = 전체 탭(견줄 이전 기간 없음), nohist = 이전 기간(또는 비교 구간)이 첫 기록일 전,
 * waiting = 기간 첫날 운동 전, ok = 비교.
 * from = 이전 기간이 일부만 기록된 경우 첫 기록일(이전 쪽 비교 시작), curFrom = 이번 쪽 비교 시작(from 을 같은 위치로 옮긴 날, from 이 없으면 기간 시작),
 * through = 이전 쪽 비교 끝(현재 기간만), fullPrev = 이전 기간 전체 값(막대·누적선·남은 양)을 보여 줄 수 있음
 */
export interface ComparePlan { mode: 'none' | 'nohist' | 'waiting' | 'ok'; prev: PeriodRange | null; from?: string; curFrom?: string; through?: string; fullPrev: boolean }
export function comparePlan(range: PeriodRange, current: boolean, today: string, todayDone: boolean, first: string | null): ComparePlan {
  if (range.kind === 'all') return { mode: 'none', prev: null, fullPrev: false };
  const prev = shiftPeriod(range, -1);
  if (first === null || first >= prev.end) return { mode: 'nohist', prev, fullPrev: false };
  const from = first > prev.start ? first : undefined;
  const curFrom = from ? alignFwd(from, range.kind) : range.start;
  if (!current) return { mode: 'ok', prev, from, curFrom, fullPrev: true };
  if (waitingForToday(range, today, todayDone)) return { mode: 'waiting', prev, from, curFrom, fullPrev: true };
  const through = compareThroughFor(range, today, todayDone);
  if (from && from > through) return { mode: 'nohist', prev, from, fullPrev: true };
  return { mode: 'ok', prev, from, curFrom, through, fullPrev: true };
}

/** 운동한 칸만의 평균 (없으면 0) */
export function activeAverage(values: number[], active: boolean[]): number {
  let sum = 0, k = 0;
  values.forEach((v, i) => { if (active[i]) { sum += v; k++; } });
  return k ? sum / k : 0;
}
