/**
 * 기록과 통계 (BLUEPRINT 4.5), 도구 (4.6). 화면과 분리된 순수 함수.
 * - 볼륨 = 무게 × 횟수 (웜업 제외). 맨몸 운동에 무게가 비어 있으면 그날 체중을 씀 (D-002)
 * - 1RM은 Epley 추정 (화면에 "추정" 표시)
 * - 날짜는 기기 현지 시간 기준 (한국 시간)
 */
import type { Workout, SetLog } from './session';
import { epley1RM } from './session';
import type { Exercise, Part } from './types';
import { PARTS } from './types';

export interface BodyweightEntry { date: string; kg: number }

/** 현지 날짜 'YYYY-MM-DD' */
export function localDate(iso: string | number | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 그 날짜(포함) 이전의 가장 최근 체중 */
export function bodyweightOn(entries: BodyweightEntry[], date: string): number | undefined {
  let best: BodyweightEntry | undefined;
  for (const e of entries) if (e.date <= date && (!best || e.date > best.date)) best = e;
  return best?.kg;
}

const workSets = (sets: SetLog[]) => sets.filter((s) => s.done && !s.warmup);

/** 세트 하나의 무게 (맨몸 운동이고 무게가 비었으면 체중) */
function setWeight(s: SetLog, ex: Exercise | undefined, bw: number | undefined): number | undefined {
  if (s.weight !== undefined && s.weight > 0) return s.weight;
  if (ex && ex.equipment.includes('bodyweight') && bw) return bw;
  return s.weight;
}

export interface ExerciseDay { date: string; workoutId: string; sets: number; bestSet?: { weight: number; reps: number }; best1RM?: number; volume: number; maxWeight?: number; seconds?: number }

/** 운동 하나의 날짜별 기록 (오래된 순) */
export function exerciseHistory(workouts: Workout[], exerciseId: string, ex: Exercise | undefined, bw: BodyweightEntry[] = []): ExerciseDay[] {
  const out: ExerciseDay[] = [];
  for (const w of workouts.filter((x) => x.endedAt).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))) {
    const date = localDate(w.startedAt);
    const bwKg = bodyweightOn(bw, date);
    const sets = w.blocks.flatMap((b) => b.items.filter((i) => i.exerciseId === exerciseId).flatMap((i) => workSets(i.sets)));
    if (!sets.length) continue;
    let volume = 0, best1RM: number | undefined, bestSet: ExerciseDay['bestSet'], maxWeight: number | undefined, seconds = 0;
    for (const s of sets) {
      const kg = setWeight(s, ex, bwKg);
      if (s.seconds) seconds += s.seconds;
      if (kg === undefined || !s.reps) continue;
      volume += kg * s.reps;
      const orm = epley1RM(kg, s.reps);
      if (best1RM === undefined || orm > best1RM) { best1RM = orm; bestSet = { weight: kg, reps: s.reps }; }
      if (maxWeight === undefined || kg > maxWeight) maxWeight = kg;
    }
    out.push({ date, workoutId: w.id, sets: sets.length, volume: Math.round(volume * 10) / 10, ...(best1RM !== undefined ? { best1RM, bestSet } : {}), ...(maxWeight !== undefined ? { maxWeight } : {}), ...(seconds ? { seconds } : {}) });
  }
  return out;
}

export interface WorkoutSummary { id: string; name: string; date: string; durationSec: number; plannedSec?: number; workSets: number; volume: number; parts: Partial<Record<Part, number>> }

export function summarize(w: Workout, byId: Map<string, Exercise>, bw: BodyweightEntry[] = []): WorkoutSummary {
  const date = localDate(w.startedAt);
  const bwKg = bodyweightOn(bw, date);
  let volume = 0, n = 0;
  const parts: Partial<Record<Part, number>> = {};
  for (const b of w.blocks) for (const it of b.items) {
    const ex = byId.get(it.exerciseId);
    for (const s of workSets(it.sets)) {
      n++;
      if (ex) parts[ex.part] = (parts[ex.part] ?? 0) + 1;
      const kg = setWeight(s, ex, bwKg);
      if (kg !== undefined && s.reps) volume += kg * s.reps;
    }
  }
  const end = w.endedAt ?? w.startedAt;
  return { id: w.id, name: w.name, date, durationSec: Math.max(0, Math.round((Date.parse(end) - Date.parse(w.startedAt)) / 1000)), ...(w.plannedSec ? { plannedSec: w.plannedSec } : {}), workSets: n, volume: Math.round(volume), parts };
}

/** 주의 시작(월요일) 날짜 */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  const dow = (dt.getDay() + 6) % 7; // 월=0
  dt.setDate(dt.getDate() - dow);
  return localDate(dt);
}

/** 부위별 주간 작업 세트 수 (끝난 운동, 운동의 기본 부위 기준). 최근 weeks 주, 오래된 순 */
export function weeklyPartSets(workouts: Workout[], byId: Map<string, Exercise>, today: string, weeks = 4): { week: string; parts: Record<Part, number>; total: number }[] {
  const starts: string[] = [];
  let cur = weekStart(today);
  for (let i = 0; i < weeks; i++) {
    starts.unshift(cur);
    const [y, m, d] = cur.split('-').map(Number);
    cur = localDate(new Date(y!, m! - 1, d! - 7));
  }
  return starts.map((week) => {
    const parts = Object.fromEntries(PARTS.map((p) => [p, 0])) as Record<Part, number>;
    for (const w of workouts) {
      if (!w.endedAt || weekStart(localDate(w.startedAt)) !== week) continue;
      for (const b of w.blocks) for (const it of b.items) {
        const ex = byId.get(it.exerciseId);
        if (ex) parts[ex.part] += workSets(it.sets).length;
      }
    }
    return { week, parts, total: PARTS.reduce((s, p) => s + parts[p], 0) };
  });
}

/** 달력: 그 달의 날짜별 운동 수 (끝난 운동) */
export function monthDays(workouts: Workout[], year: number, month: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const w of workouts) {
    if (!w.endedAt) continue;
    const d = new Date(w.startedAt);
    if (d.getFullYear() === year && d.getMonth() + 1 === month) out.set(d.getDate(), (out.get(d.getDate()) ?? 0) + 1);
  }
  return out;
}

/** 연속 운동 주 (이번 주 포함, 한 번이라도 운동한 주가 이어진 수) */
export function weekStreak(workouts: Workout[], today: string): number {
  const weeks = new Set(workouts.filter((w) => w.endedAt).map((w) => weekStart(localDate(w.startedAt))));
  let n = 0;
  let cur = weekStart(today);
  if (!weeks.has(cur)) { const [y, m, d] = cur.split('-').map(Number); cur = localDate(new Date(y!, m! - 1, d! - 7)); } // 이번 주는 아직 안 했어도 끊긴 것 아님
  while (weeks.has(cur)) { n++; const [y, m, d] = cur.split('-').map(Number); cur = localDate(new Date(y!, m! - 1, d! - 7)); }
  return n;
}

// ---------- 도구 (4.6) ----------

const biggerFirst = (a: number[], b: number[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! > b[i]!; return false; };
export interface PlateResult { perSide: number[]; achieved: number; remainder: number }
export const ONE_RM_MAX_REPS = 12;
export const PLATE_MAX_KG = 500;
/**
 * 원판 계산: 목표 무게를 만들기 위해 한쪽에 끼울 원판 (큰 것부터).
 * 가진 원판으로 **정확히** 만들 수 있으면 원판 수가 가장 적은 조합, 안 되면 목표 아래에서 가장 가까운 무게.
 * (큰 것부터 채우는 방식은 [15, 10]으로 한쪽 20kg을 못 찾는 문제가 있어 동적 계획법으로 모든 조합을 봄)
 * plates: 쓸 수 있는 원판 무게, pairs: 원판별 쌍 개수 (없으면 무제한)
 */
export function plateCalc(target: number, bar: number, plates: number[] = [25, 20, 15, 10, 5, 2.5, 1.25], pairs?: Record<string, number>): PlateResult {
  const U = 0.25; // 계산 단위 kg (1.25·2.5·0.5 원판 모두 정수로)
  // 목표는 PLATE_MAX_KG까지만 계산 (잘못 친 10000kg에 화면이 멈추지 않게)
  const side = Math.floor(((Math.min(target, PLATE_MAX_KG) - bar) / 2) / U + 1e-9);
  // 목표가 바 무게 이하: 원판 없음. remainder가 음수면 바만으로도 목표보다 무거움
  if (side <= 0) return { perSide: [], achieved: bar, remainder: Math.round((target - bar) * 100) / 100 };
  // 한쪽에 쓸 수 있는 원판 목록 (쌍 개수만큼, 한쪽 목표를 넘지 않는 만큼만)
  const items: number[] = [];
  // 0.25kg 단위로 딱 떨어지는 원판만 (0.1kg 같은 값은 무한 반복을 막기 위해 제외)
  for (const p of [...new Set(plates)].filter((p) => p >= U && Math.abs(p / U - Math.round(p / U)) < 1e-9).sort((a, b) => b - a)) {
    const u = Math.round(p / U);
    const n = Math.min(pairs?.[String(p)] ?? Infinity, Math.floor(side / u));
    for (let i = 0; i < n; i++) items.push(u);
  }
  // best[w] = 한쪽 무게 w를 만드는 최소 원판 수, from[w] = 마지막에 넣은 원판 (0/1 배낭)
  const best = new Array<number>(side + 1).fill(Infinity); best[0] = 0;
  const pick: number[][] = Array.from({ length: side + 1 }, () => []);
  for (const u of items) {
    for (let w = side; w >= u; w--) {
      const n = best[w - u]! + 1;
      if (n > best[w]!) continue;
      const cand = [...pick[w - u]!, u].sort((a, b) => b - a);
      // 원판 수가 같으면 큰 원판 먼저인 조합 (25+15를 20+20보다 먼저: 끼우고 빼기 쉬움, 헬스장 관례)
      if (n < best[w]! || biggerFirst(cand, pick[w]!)) { best[w] = n; pick[w] = cand; }
    }
  }
  let w = side; while (w > 0 && best[w] === Infinity) w--;
  const perSide = pick[w]!.map((u) => u * U).sort((a, b) => b - a);
  const achieved = Math.round((bar + 2 * perSide.reduce((s, x) => s + x, 0)) * 100) / 100;
  return { perSide, achieved, remainder: Math.round((target - achieved) * 100) / 100 };
}

/**
 * 1RM 계산기: Epley 추정과 %별 무게. 100% 줄은 추정값 그대로, 나머지는 2.5kg 단위 반올림.
 * Epley는 1~12회 정도에서만 믿을 만해서 그보다 많은 횟수는 reliable=false (화면에 경고)
 */
export function oneRMTable(weight: number, reps: number): { oneRM: number; reliable: boolean; rows: { pct: number; kg: number; reps: number }[] } {
  const oneRM = epley1RM(weight, reps);
  const rows = [100, 95, 90, 85, 80, 75, 70, 65, 60, 50].map((pct) => {
    const kg = pct === 100 ? oneRM : Math.round((oneRM * pct) / 100 / 2.5) * 2.5;
    // Epley 역산: 이 무게로 할 수 있는 대략의 횟수
    const r = pct >= 100 ? 1 : Math.max(1, Math.round(30 * (100 / pct - 1)));
    return { pct, kg, reps: r };
  });
  return { oneRM, reliable: reps >= 1 && reps <= ONE_RM_MAX_REPS, rows };
}

/** 주별 총 볼륨·작업 세트·운동 수 (최근 weeks 주, 오래된 순). 볼륨 추이 그래프용 */
export function weeklyTotals(workouts: Workout[], byId: Map<string, Exercise>, today: string, weeks = 8, bw: BodyweightEntry[] = []): { week: string; volume: number; sets: number; count: number }[] {
  const starts: string[] = [];
  let cur = weekStart(today);
  for (let i = 0; i < weeks; i++) {
    starts.unshift(cur);
    const [y, m, d] = cur.split('-').map(Number);
    cur = localDate(new Date(y!, m! - 1, d! - 7));
  }
  const out = new Map(starts.map((w) => [w, { week: w, volume: 0, sets: 0, count: 0 }]));
  for (const w of workouts) {
    if (!w.endedAt) continue;
    const row = out.get(weekStart(localDate(w.startedAt)));
    if (!row) continue;
    const s = summarize(w, byId, bw);
    row.volume += s.volume; row.sets += s.workSets; row.count++;
  }
  return [...out.values()];
}

/** 예상 대비 실제 시간: 예상이 있는 끝난 운동들의 평균 차이(초, +면 더 오래 걸림)와 개수 */
export function plannedVsActual(sums: WorkoutSummary[], last = 10): { n: number; avgDiffSec: number; avgRatio: number } | undefined {
  const xs = sums.filter((x) => x.plannedSec && x.durationSec > 0).slice(0, last);
  if (!xs.length) return undefined;
  const avgDiffSec = Math.round(xs.reduce((s, x) => s + (x.durationSec - x.plannedSec!), 0) / xs.length);
  const avgRatio = Math.round((xs.reduce((s, x) => s + x.durationSec / x.plannedSec!, 0) / xs.length) * 100) / 100;
  return { n: xs.length, avgDiffSec, avgRatio };
}