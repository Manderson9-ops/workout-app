/**
 * 운동 중 화면의 "지난번" 열과 "★ 기록 갱신" 배지 (D-055 디자인 시스템 3장 2단계).
 * 둘 다 앱 규칙이다(근거 있는 운동 지표가 아님). 화면에는 "앱 기준"이라고 밝힌다.
 */
import type { SetLog, Workout } from './session';
import { epley1RM } from './session';

export interface PrevSets { work: SetLog[]; warm: SetLog[]; at?: string }
/**
 * 지난번 = 끝낸 운동 중 가장 최근에 이 운동을 한 기록 (건너뛰지 않고 완료한 세트가 있는 것).
 * 작업 세트·웜업을 따로 순서대로 (같은 번호끼리 비교: 이번 2세트 ↔ 지난번 2세트, 이번 W1 ↔ 지난번 W1)
 */
export function previousSetsFor(history: readonly Workout[], exerciseId: string, excludeId?: string): PrevSets {
  const done = history.filter((w) => w.endedAt && w.id !== excludeId).sort((a, b) => (a.endedAt! < b.endedAt! ? 1 : a.endedAt! > b.endedAt! ? -1 : 0));
  for (const w of done) for (const b of w.blocks) for (const it of b.items) {
    if (it.exerciseId !== exerciseId || it.skipped) continue;
    const fin = it.sets.filter((s) => s.done);
    if (!fin.length) continue;
    return { work: fin.filter((s) => !s.warmup), warm: fin.filter((s) => s.warmup), at: w.startedAt };
  }
  return { work: [], warm: [] };
}

/** 이 세트 줄의 지난번 세트 (작업 세트 k번째 ↔ 지난번 작업 세트 k번째, 웜업도 같은 방식). 없으면 undefined */
export function prevFor(prev: PrevSets, sets: readonly SetLog[], index: number): SetLog | undefined {
  const x = sets[index];
  if (!x) return undefined;
  const nth = sets.slice(0, index).filter((s) => !!s.warmup === !!x.warmup).length;
  return (x.warmup ? prev.warm : prev.work)[nth];
}

/** 지난번 칸 글자: "40×8", "30초", "맨몸×12", 없으면 "-" */
export function prevText(p: SetLog | undefined, timed: boolean): string {
  if (!p) return '-';
  if (timed) return p.seconds ? `${p.seconds}초` : '-';
  const kg = p.weight !== undefined ? String(p.weight) : '맨몸';
  return p.reps !== undefined ? `${kg}×${p.reps}` : p.weight !== undefined ? `${kg}kg` : '-';
}

/** 기록 갱신 판정에 쓰는 지난 최고 (무게가 있고 횟수가 있는 완료 작업 세트만) */
export interface Bests { best1RM: number; sets: { weight: number; reps: number }[] }
const counted = (s: SetLog): s is SetLog & { weight: number; reps: number } =>
  s.done && !s.warmup && s.seconds === undefined && s.weight !== undefined && s.weight > 0 && s.reps !== undefined && s.reps > 0;
export const PR_MAX_REPS = 12; // Epley 추정 1RM 은 12회 이하만 (stats ONE_RM_MAX_REPS 와 같음)

export function bestsFrom(sets: readonly SetLog[]): Bests {
  const xs = sets.filter(counted);
  return {
    best1RM: xs.filter((s) => s.reps <= PR_MAX_REPS).reduce((m, s) => Math.max(m, epley1RM(s.weight, s.reps)), 0),
    sets: xs.map((s) => ({ weight: s.weight, reps: s.reps })),
  };
}
/** 끝낸 운동들에서 이 운동의 모든 완료 작업 세트 (지금 운동 제외) */
export function historySets(history: readonly Workout[], exerciseId: string, excludeId?: string): SetLog[] {
  const out: SetLog[] = [];
  for (const w of history) {
    if (!w.endedAt || w.id === excludeId) continue;
    for (const b of w.blocks) for (const it of b.items) if (it.exerciseId === exerciseId && !it.skipped) out.push(...it.sets);
  }
  return out;
}

export type PrKind = '1rm' | 'weight' | 'reps';
/**
 * 기록 갱신 (앱 기준): 완료한 작업 세트(무게·횟수 있음, 시간 운동 제외)가 지난 기록보다 나을 때.
 * - '1rm': 추정 1RM(Epley, 12회 이하)이 지난 최고보다 큼
 * - 'weight': 지난 어떤 세트보다 무거움
 * - 'reps': 그 무게 이상으로 한 지난 세트들보다 횟수가 많음
 * 지난 기록이 전혀 없으면(처음 하는 운동) 갱신이 아님.
 */
export function isPR(set: SetLog, prev: Bests): PrKind | null {
  if (!counted(set) || !prev.sets.length) return null;
  if (set.reps <= PR_MAX_REPS && epley1RM(set.weight, set.reps) > prev.best1RM + 1e-9) return '1rm';
  const atOrAbove = prev.sets.filter((p) => p.weight >= set.weight);
  if (!atOrAbove.length) return 'weight';
  return set.reps > Math.max(...atOrAbove.map((p) => p.reps)) ? 'reps' : null;
}

/**
 * 지금 운동의 세트마다 기록 갱신 여부 (지난 기록 + 이 운동에서 앞서 끝낸 세트와 비교 → 같은 운동에서 더 나은 세트만 배지).
 * 돌려주는 키: "블록-운동-세트"
 */
export function workoutPRs(w: Workout, history: readonly Workout[]): Map<string, PrKind> {
  const out = new Map<string, PrKind>();
  w.blocks.forEach((b, bi) => b.items.forEach((it, ii) => {
    if (it.skipped) return;
    const before = historySets(history, it.exerciseId, w.id);
    // 완료한 순서대로 비교 (doneAt, 없으면 줄 순서)
    const order = it.sets.map((s, k) => ({ s, k })).filter(({ s }) => s.done).sort((a, b2) => (a.s.doneAt ?? '').localeCompare(b2.s.doneAt ?? '') || a.k - b2.k);
    const seen: SetLog[] = [...before];
    for (const { s, k } of order) {
      const kind = isPR(s, bestsFrom(seen));
      if (kind && bestsFrom(before).sets.length) out.set(`${bi}-${ii}-${k}`, kind);
      seen.push(s);
    }
  }));
  return out;
}
/** 끝낼 때 알림용: 기록 갱신한 운동 수 */
export function prExerciseCount(w: Workout, history: readonly Workout[]): number {
  return new Set([...workoutPRs(w, history).keys()].map((k) => k.split('-').slice(0, 2).join('-'))).size;
}

/**
 * 휴식 고리 (D-055 2단계): 남은 비율만큼 칠해진 고리 → 휴식이 흐를수록 줄어듦.
 * stroke-dasharray = 둘레, stroke-dashoffset = 둘레 × (1 − 남은 비율). total 이 0 이하이거나 값이 이상하면 빈 고리
 */
export function ringDash(remainingSec: number, totalSec: number, circumference: number): { dasharray: number; dashoffset: number; fraction: number } {
  const f = totalSec > 0 && Number.isFinite(remainingSec) ? Math.min(1, Math.max(0, remainingSec / totalSec)) : 0;
  return { dasharray: circumference, dashoffset: circumference * (1 - f), fraction: f };
}
