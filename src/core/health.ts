/**
 * 애플워치 기록 읽기 (D-058, 앱 쪽 계산). 기록 모양은 healthIngest.ts (서버가 씀) 설명 참고.
 * - 운동: 그 운동 시작~끝 안의 심박(평균·최고·개수), 겹치는 활동 에너지(겹친 비율만큼) 합
 * - 하루: 어젯밤 수면(잠든 시간 합), 안정 심박, HRV (참고용 · 회복 계산에는 안 씀)
 */
import type { Workout } from './session';
import { kstDay, kstDayStart, kcalNoOverlap, enIntervals, HR_RANGE } from './healthIngest';

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
      if (v < HR_RANGE[0] || v > HR_RANGE[1]) continue; // D-071 사람 기준 밖 값은 빼고 셈 (서버 범위가 넓던 때 받은 값)
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

// ---------- D-071 (P7) 애플워치 값 확인: 원인을 찾기 전까지 믿기 어려운 값은 사실처럼 보여 주지 않음 ----------
/**
 * 운동 요약을 보여 줄 조건 (모두 맞아야 보여 줌, 하나라도 어긋나면 "확인 중"):
 *  - 최고 심박 ≤ 220 (Tanaka 2001: 208 − 0.7 × 나이, 20세도 약 194 → 220은 넉넉한 위 한계)
 *  - 평균 심박 40~200
 *  - 운동 시간 안 심박 20개 이상 (4~11개로는 평균이 의미가 약함)
 *  - kcal ≤ 분당 20kcal × 운동 시간(분) (고강도 근력 6 MET·80kg ≈ 분당 8kcal, Compendium 02050 → 20은 넉넉한 위 한계)
 * 심박이 없으면(kcal만) 심박 개수 조건에서 걸림 → 확인 중. kcal이 없으면 kcal 조건은 따지지 않음
 */
export const WATCH_GATE = { hrMax: 220, hrAvgMin: 40, hrAvgMax: 200, hrNMin: 20, kcalPerMin: 20 } as const;
export type WatchWhy = 'hrMax' | 'hrAvg' | 'hrN' | 'kcal';
export type WatchCheck = { ok: true; x: WorkoutWatch } | { ok: false; why: WatchWhy[] };
/** 순수 함수: 운동 요약이 사람 기준으로 그럴듯한가 (durMin = 운동 시간 분) */
export function watchPlausible(x: WorkoutWatch, durMin: number): WatchCheck {
  const why: WatchWhy[] = [];
  const g = WATCH_GATE;
  if (x.max !== undefined && x.max > g.hrMax) why.push('hrMax');
  if (x.avg !== undefined && (x.avg < g.hrAvgMin || x.avg > g.hrAvgMax)) why.push('hrAvg');
  if (!(x.n >= g.hrNMin) || x.avg === undefined || x.max === undefined) why.push('hrN');
  if (x.kcal !== undefined && !(x.kcal <= g.kcalPerMin * Math.max(0, durMin))) why.push('kcal');
  return why.length ? { ok: false, why } : { ok: true, x };
}
/** 화면에서 쓰는 한 번에: 값이 없으면 undefined, 그럴듯하면 ok, 아니면 확인 중 */
export function watchView(w: Pick<Workout, 'startedAt' | 'endedAt'> & { id?: string }, rows: readonly HealthRow[], nowMs = Date.now()): WatchCheck | undefined {
  const x = watchFor(w, rows, nowMs);
  if (!x) return undefined;
  const a = Date.parse(w.startedAt), b = w.endedAt ? Date.parse(w.endedAt) : nowMs;
  return watchPlausible(x, (b - a) / 60000);
}
export const WATCH_PENDING = '애플워치 값 확인 중';

/**
 * D-071 진단: 이 기기가 받은 애플워치 기록 묶음(동기화 한 번)을 종류별로 요약. 값은 개수·범위 밖 개수·최소·최대만 (원본 값·시각·ID 없음, D-025)
 *  - hr: 심박 점 개수, 30~220 밖 개수
 *  - energy: 에너지 조각 개수, 분당 25kcal 넘는 조각 수(길이가 있는 조각만), 최소·최대는 조각 kcal
 *  - ws: 운동 요약 개수, 표시 조건(watchPlausible)에 걸린 수, 최소·최대는 최고 심박
 *  - 그 밖(sleep·daily·canary 등): 기록 수만. canary 는 서버가 셈한 받은/건너뛴 줄 수를 함께 (서버가 기기에 주는 건너뜀 정보는 이것뿐)
 * 기록 하나(hr-날짜 등)는 그날 전체라서 개수는 "새로 온 점"이 아니라 "받은 날 기록 안의 점"
 */
export interface HealthBatchStat { type: string; rows: number; n: number; out: number; min?: number; max?: number; skipped?: number }
export const EN_RATE_MAX = 25; // kcal/분 (사용 분석 F8의 기준)
export function healthBatchStats(list: readonly { id: string; deleted?: boolean; data?: Record<string, unknown> }[]): HealthBatchStat[] {
  const by = new Map<string, HealthBatchStat>();
  const stat = (type: string) => { let s = by.get(type); if (!s) { s = { type, rows: 0, n: 0, out: 0 }; by.set(type, s); } return s; };
  const mm = (s: HealthBatchStat, v: number) => { if (s.min === undefined || v < s.min) s.min = v; if (s.max === undefined || v > s.max) s.max = v; };
  for (const c of list) {
    if (c.deleted || !c.data) continue;
    const d = c.data;
    const type = typeof d.type === 'string' ? d.type : 'unknown';
    const s = stat(type); s.rows++;
    const p = Array.isArray(d.p) ? (d.p as unknown[]).filter((v): v is number => typeof v === 'number') : [];
    if (type === 'hr') {
      for (let i = 1; i < p.length; i += 2) { const v = p[i]!; s.n++; mm(s, v); if (v < HR_RANGE[0] || v > HR_RANGE[1]) s.out++; }
    } else if (type === 'energy') {
      for (let i = 0; i + 2 < p.length; i += 3) { const len = p[i + 1]!, k = p[i + 2]! / 10; s.n++; mm(s, Math.round(k * 10) / 10); if (len > 0 && k / (len / 60) > EN_RATE_MAX) s.out++; }
    } else if (type === 'ws') {
      s.n++;
      const x = fromSummary(d as HealthRow);
      const a = Date.parse(String(d.startedAt)), b = Date.parse(String(d.endedAt));
      if (typeof d.hrMax === 'number') mm(s, d.hrMax);
      if (!x || !watchPlausible(x, (b - a) / 60000).ok) s.out++;
    } else {
      s.n++;
      if (type === 'canary' && typeof d.skipped === 'number') s.skipped = d.skipped;
    }
  }
  return [...by.values()].sort((a, b) => a.type.localeCompare(b.type));
}
const HEALTH_TYPE_KO: Record<string, string> = { hr: '심박', energy: '활동 에너지', ws: '운동 요약', sleep: '수면', daily: '하루 요약', canary: '연결 시험', wsmeta: '요약 위치' };
/** 진단 한 줄 (숫자는 개수와 최소·최대만): "심박 기록 2개 · 점 525 · 30~220 밖 88 · 최소 17 · 최대 240" */
export function healthStatText(x: HealthBatchStat): string {
  const name = HEALTH_TYPE_KO[x.type] ?? '기타';
  const parts = [`${name} 기록 ${x.rows}개`];
  if (x.type === 'hr') parts.push(`점 ${x.n}`, `30~220 밖 ${x.out}`);
  else if (x.type === 'energy') parts.push(`조각 ${x.n}`, `분당 ${EN_RATE_MAX}kcal 넘음 ${x.out}`);
  else if (x.type === 'ws') parts.push(`표시 조건 밖 ${x.out}`);
  if (x.min !== undefined) parts.push(`최소 ${x.min}`);
  if (x.max !== undefined) parts.push(`최대 ${x.max}`);
  if (x.skipped !== undefined) parts.push(`서버가 건너뛴 줄 ${x.skipped}`);
  return parts.join(' · ');
}

/** D-071 연동 화면 맨 위: "마지막 수신: 10월 11일(토) 오후 10:31 · 8일 전" (D-060 날짜 규칙). 받은 적 없으면 undefined */
export function lastRxOf(rows: readonly HealthRow[]): string | undefined {
  let last: string | undefined;
  for (const r of rows) if (r.type !== 'canary' && r.type !== 'ws' && r.type !== 'wsmeta' && typeof r.rx === 'string' && (!last || r.rx > last)) last = r.rx;
  return last;
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
