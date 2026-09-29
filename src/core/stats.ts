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

export interface PlateResult { perSide: number[]; achieved: number; remainder: number }
/**
 * 원판 계산: 목표 무게를 만들기 위해 한쪽에 끼울 원판 (큰 것부터). 정확히 안 되면 가장 가까운 아래 무게와 남는 무게.
 * plates: 쓸 수 있는 원판 무게, pairs: 원판별 쌍 개수 (없으면 무제한)
 */
export function plateCalc(target: number, bar: number, plates: number[] = [25, 20, 15, 10, 5, 2.5, 1.25], pairs?: Record<string, number>): PlateResult {
  let side = Math.round(((target - bar) / 2) * 1000) / 1000;
  const perSide: number[] = [];
  // 목표가 바 무게 이하: 원판 없음. remainder가 음수면 바만으로도 목표보다 무거움
  if (side <= 0) return { perSide, achieved: bar, remainder: Math.round((target - bar) * 100) / 100 };
  for (const p of [...plates].sort((a, b) => b - a)) {
    let left = pairs?.[String(p)] ?? Infinity;
    while (side >= p - 1e-9 && left > 0) { perSide.push(p); side = Math.round((side - p) * 1000) / 1000; left--; }
  }
  const achieved = Math.round((bar + 2 * perSide.reduce((s, x) => s + x, 0)) * 100) / 100;
  return { perSide, achieved, remainder: Math.round((target - achieved) * 100) / 100 };
}

/** 1RM 계산기: Epley 추정과 %별 무게 (2.5kg 단위 반올림) */
export function oneRMTable(weight: number, reps: number): { oneRM: number; rows: { pct: number; kg: number; reps: number }[] } {
  const oneRM = epley1RM(weight, reps);
  const rows = [100, 95, 90, 85, 80, 75, 70, 65, 60, 50].map((pct) => {
    const kg = Math.round((oneRM * pct) / 100 / 2.5) * 2.5;
    // Epley 역산: 이 무게로 할 수 있는 대략의 횟수
    const r = pct >= 100 ? 1 : Math.max(1, Math.round(30 * (oneRM / ((oneRM * pct) / 100) - 1)));
    return { pct, kg, reps: r };
  });
  return { oneRM, rows };
}
