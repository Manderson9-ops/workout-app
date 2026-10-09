/**
 * 애플워치 기록 읽기 (D-058, 앱 쪽 계산). 기록 모양은 healthIngest.ts (서버가 씀) 설명 참고.
 * - 운동: 그 운동 시작~끝 안의 심박(평균·최고·개수), 겹치는 활동 에너지(겹친 비율만큼) 합
 * - 하루: 어젯밤 수면(잠든 시간 합), 안정 심박, HRV (참고용 · 회복 계산에는 안 씀)
 */
import type { Workout } from './session';
import { kstDay, kstDayStart } from './healthIngest';

export interface HealthRow { id: string; type: string; day?: string; t0?: number; p?: number[]; seg?: number[]; rhr?: number; hrv?: number; hrvN?: number; sleepMin?: number; rx?: string; [k: string]: unknown }
export interface WorkoutWatch { avg?: number; max?: number; n: number; kcal?: number }

const DAY_MS = 86400000;
/** 그 기간에 걸친 한국 날짜들 */
function daysBetween(a: number, b: number): string[] {
  const out: string[] = [];
  for (let d = kstDayStart(kstDay(a)); d <= b; d += DAY_MS) out.push(kstDay(d));
  return out;
}
/** 행 ID 표 (같은 배열이면 한 번만 만듦: 기록 탭은 1초마다 다시 그림, D-058 검토 G4) */
const idxCache = new WeakMap<readonly HealthRow[], Map<string, HealthRow>>();
const byId = (rows: readonly HealthRow[]) => { let m = idxCache.get(rows); if (!m) { m = new Map(rows.map((r) => [r.id, r])); idxCache.set(rows, m); } return m; };

/** 운동 시간 안 심박 (startedAt~endedAt, 끝이 없으면 지금까지) */
export function workoutHeart(w: Pick<Workout, 'startedAt' | 'endedAt'>, rows: readonly HealthRow[], nowMs = Date.now()): { avg?: number; max?: number; n: number } {
  const a = Date.parse(w.startedAt), b = w.endedAt ? Date.parse(w.endedAt) : nowMs;
  if (!(b > a)) return { n: 0 };
  const m = byId(rows);
  let sum = 0, n = 0, max = 0;
  for (const day of daysBetween(a, b)) {
    const r = m.get(`hr-${day}`);
    if (!r || !Array.isArray(r.p) || typeof r.t0 !== 'number') continue;
    for (let i = 0; i + 1 < r.p.length; i += 2) {
      const t = r.t0 + r.p[i]! * 1000;
      if (t < a || t > b) continue;
      const v = r.p[i + 1]!;
      sum += v; n++; if (v > max) max = v;
    }
  }
  return n ? { avg: Math.round(sum / n), max, n } : { n: 0 };
}

/** 운동 시간과 겹치는 활동 에너지 합 (kcal, 겹친 비율만큼). 없으면 undefined */
export function activeKcal(w: Pick<Workout, 'startedAt' | 'endedAt'>, rows: readonly HealthRow[], nowMs = Date.now()): number | undefined {
  const a = Date.parse(w.startedAt), b = w.endedAt ? Date.parse(w.endedAt) : nowMs;
  if (!(b > a)) return undefined;
  const m = byId(rows);
  let total = 0, any = false;
  // 샘플이 전날에서 시작해 걸칠 수 있어 하루 앞도 봄
  for (const day of daysBetween(a - DAY_MS, b)) {
    const r = m.get(`en-${day}`);
    if (!r || !Array.isArray(r.p) || typeof r.t0 !== 'number') continue;
    for (let i = 0; i + 2 < r.p.length; i += 3) {
      const s = r.t0 + r.p[i]! * 1000, dur = r.p[i + 1]! * 1000, kcal = r.p[i + 2]! / 10;
      if (dur <= 0) { if (s >= a && s <= b) { total += kcal; any = true; } continue; }
      const ov = Math.min(b, s + dur) - Math.max(a, s);
      if (ov > 0) { total += kcal * (ov / dur); any = true; }
    }
  }
  return any ? Math.round(total) : undefined;
}

export function watchFor(w: Pick<Workout, 'startedAt' | 'endedAt'>, rows: readonly HealthRow[], nowMs = Date.now()): WorkoutWatch | undefined {
  if (!rows.length) return undefined;
  const h = workoutHeart(w, rows, nowMs);
  const kcal = activeKcal(w, rows, nowMs);
  if (!h.n && kcal === undefined) return undefined;
  return { ...h, ...(kcal !== undefined ? { kcal } : {}) };
}

/** "평균 심박 128 · 최고 162 · 412kcal (애플워치)" */
export function watchLine(x: WorkoutWatch): string {
  const parts = [x.avg !== undefined ? `평균 심박 ${x.avg}` : '', x.max !== undefined ? `최고 ${x.max}` : '', x.kcal !== undefined ? `${x.kcal}kcal` : ''].filter(Boolean);
  return `${parts.join(' · ')} (애플워치)`;
}

export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`);

/** 어젯밤(오늘 날짜의 밤: 전날 12시~오늘 12시) 수면·오늘 안정 심박·HRV. 하나도 없으면 undefined */
export function lastNight(rows: readonly HealthRow[], nowMs = Date.now()): { day: string; sleepMin?: number; rhr?: number; hrv?: number } | undefined {
  const day = kstDay(nowMs);
  const r = byId(rows).get(`dy-${day}`);
  if (!r) return undefined;
  const out = { day, ...(typeof r.sleepMin === 'number' && r.sleepMin > 0 ? { sleepMin: r.sleepMin } : {}), ...(typeof r.rhr === 'number' ? { rhr: r.rhr } : {}), ...(typeof r.hrv === 'number' ? { hrv: r.hrv } : {}) };
  return out.sleepMin === undefined && out.rhr === undefined && out.hrv === undefined ? undefined : out;
}

/** "어젯밤 수면 6시간 10분 · 안정 심박 56 · HRV 48ms (애플워치, 참고)" */
export function nightLine(x: NonNullable<ReturnType<typeof lastNight>>): string {
  const parts = [x.sleepMin !== undefined ? `어젯밤 수면 ${hm(x.sleepMin)}` : '', x.rhr !== undefined ? `안정 심박 ${x.rhr}` : '', x.hrv !== undefined ? `HRV ${Math.round(x.hrv)}ms` : ''].filter(Boolean);
  return `${parts.join(' · ')} (애플워치, 참고)`;
}
export const SHORT_SLEEP_MIN = 360;

/** 연동 화면 상태: 종류별 마지막으로 받은 시각, 최근 7일 기록 수 */
export function watchStatus(rows: readonly HealthRow[], nowMs = Date.now()): { kind: string; label: string; lastRx?: string; recent: number }[] {
  const since = kstDay(nowMs - 7 * DAY_MS);
  const kinds: [string, string, (r: HealthRow) => number][] = [
    ['hr', '심박', (r) => (r.p?.length ?? 0) / 2],
    ['energy', '활동 에너지', (r) => (r.p?.length ?? 0) / 3],
    ['sleep', '수면', (r) => (r.seg?.length ?? 0) / 3],
    ['daily', '안정 심박·HRV 요약', (r) => (typeof r.rhr === 'number' || typeof r.hrv === 'number' ? 1 : 0)],
  ];
  return kinds.map(([kind, label, count]) => {
    const xs = rows.filter((r) => r.type === kind);
    const last = xs.map((r) => r.rx).filter((x): x is string => !!x).sort().pop();
    const recent = xs.filter((r) => (r.day ?? '') >= since).reduce((a, r) => a + count(r), 0);
    return { kind, label, ...(last ? { lastRx: last } : {}), recent };
  });
}
