/**
 * 애플워치 기록 읽기 (D-058, 앱 쪽 계산). 기록 모양은 healthIngest.ts (서버가 씀) 설명 참고.
 * - 운동: 그 운동 시작~끝 안의 심박(평균·최고·개수), 겹치는 활동 에너지(겹친 비율만큼) 합
 * - 하루: 어젯밤 수면(잠든 시간 합), 안정 심박, HRV (참고용 · 회복 계산에는 안 씀)
 */
import type { Workout } from './session';
import { kstDay, kstDayStart, kcalNoOverlap, enIntervals } from './healthIngest';

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

/** 운동 시간과 겹치는 활동 에너지 합 (kcal, 소스 겹침 정리: 시간 조각마다 가장 큰 kcal/초, 검토 E1). 없으면 undefined */
export function activeKcal(w: Pick<Workout, 'startedAt' | 'endedAt'>, rows: readonly HealthRow[], nowMs = Date.now()): number | undefined {
  const a = Date.parse(w.startedAt), b = w.endedAt ? Date.parse(w.endedAt) : nowMs;
  if (!(b > a)) return undefined;
  const m = byId(rows);
  const iv: [number, number, number][] = [];
  // 샘플이 전날에서 시작해 걸칠 수 있어 하루 앞도 봄
  for (const day of daysBetween(a - DAY_MS, b)) for (const x of enIntervals(m.get(`en-${day}`))) iv.push(x);
  const k = kcalNoOverlap(iv, a, b);
  return k === undefined ? undefined : Math.round(k);
}

/** 서버가 저장한 운동별 요약(ws-운동ID, D-059) → 화면 값 */
function fromSummary(r: HealthRow): WorkoutWatch | undefined {
  const n = typeof r.hrN === 'number' ? r.hrN : 0;
  const kcal = typeof r.kcal === 'number' ? r.kcal : undefined;
  if (!n && kcal === undefined) return undefined;
  return { n, ...(n && typeof r.hrAvg === 'number' ? { avg: r.hrAvg, max: r.hrMax as number } : {}), ...(kcal !== undefined ? { kcal } : {}) };
}
/**
 * 운동 카드 값: 서버가 저장한 운동별 요약(ws-운동ID)을 먼저 (원본이 120일 뒤 정리돼도 남음, D-059).
 * 요약이 없거나(서버 갱신 전·아직 동기화 전) 운동 시간을 고쳐 요약과 다르면 원본으로 계산, 원본도 없으면 있는 요약
 */
export function watchFor(w: Pick<Workout, 'startedAt' | 'endedAt'> & { id?: string }, rows: readonly HealthRow[], nowMs = Date.now()): WorkoutWatch | undefined {
  if (!rows.length) return undefined;
  const ws = w.id ? byId(rows).get(`ws-${w.id}`) : undefined;
  if (ws && ws.startedAt === w.startedAt && ws.endedAt === w.endedAt) { const s = fromSummary(ws); if (s) return s; }
  const h = workoutHeart(w, rows, nowMs);
  const kcal = activeKcal(w, rows, nowMs);
  if (!h.n && kcal === undefined) return ws ? fromSummary(ws) : undefined;
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
