/**
 * 웜업 미리 표시 (D-070). 첫 세트가 그 운동 지난번 작업 무게의 50% 이하이고 15회 이상이면 웜업(W)으로 봄.
 * 기존 기록은 같은 규칙을 "그날 그 운동 최고 무게" 기준으로 찾아, 목록을 보여 주고 확인받아 바꿈.
 */
import type { SetLog, Workout } from './session';

export const WARMUP_RULE = { maxRatio: 0.5, minReps: 15 } as const;

/** 무게·횟수가 웜업처럼 보이는지 (top = 비교할 작업 무게) */
export function looksLikeWarmup(weight: number | undefined, reps: number | undefined, top: number): boolean {
  return weight !== undefined && top > 0 && weight <= top * WARMUP_RULE.maxRatio && (reps ?? 0) >= WARMUP_RULE.minReps;
}

/** 작업 세트 중 가장 무거운 무게 (없으면 0) */
export const topWeight = (sets: readonly SetLog[]) => sets.reduce((m, s) => (!s.warmup && s.weight !== undefined && s.weight > m ? s.weight : m), 0);

/**
 * 새로 채운 세트들의 첫 세트를 웜업으로 미리 표시. prev = 지난번 작업 세트 (lastSets).
 * 조건: 첫 세트가 지난 기록에서 채워짐(auto), 아직 안 함, 횟수 운동, 세트가 2개 이상(작업 세트가 남게).
 * 미리 표시한 세트는 warmup + auto 로 구분 (사용자가 해제할 수 있음)
 */
export function preMarkWarmup(sets: SetLog[], prev: readonly SetLog[]): SetLog[] {
  const s0 = sets[0];
  if (!s0 || sets.length < 2 || s0.done || s0.warmup || !s0.auto || s0.seconds !== undefined) return sets;
  if (!looksLikeWarmup(s0.weight, s0.reps, topWeight(prev))) return sets;
  return [{ ...s0, warmup: true }, ...sets.slice(1)];
}

/** 미리 표시한 웜업인지 (화면의 "자동" 안내용) */
export const isAutoWarmup = (s: SetLog) => s.warmup && !!s.auto && !s.done;

export interface WarmupFix { id: string; name: string; startedAt: string; block: number; item: number; set: number; exerciseId: string; weight: number; reps: number; top: number }

/**
 * 끝난 기록에서 웜업으로 보이는 첫 작업 세트 (표시 안 됨). 첫 작업 세트 = 앞에 웜업만 있는 첫 세트.
 * 비교 무게 = 그날 그 운동의 다른 완료 작업 세트 중 최고
 */
export function warmupFixes(history: readonly Workout[]): WarmupFix[] {
  const out: WarmupFix[] = [];
  for (const w of history) {
    if (!w.endedAt || w.pendingMerge) continue;
    w.blocks.forEach((b, bi) => b.items.forEach((it, ii) => {
      if (it.target.seconds !== undefined) return;
      const k = it.sets.findIndex((s) => !s.warmup);
      const s = it.sets[k];
      if (!s || !s.done || s.weight === undefined) return;
      const top = topWeight(it.sets.filter((x, j) => j !== k && x.done));
      if (!looksLikeWarmup(s.weight, s.reps, top)) return;
      out.push({ id: w.id, name: w.name, startedAt: w.startedAt, block: bi, item: ii, set: k, exerciseId: it.exerciseId, weight: s.weight, reps: s.reps ?? 0, top });
    }));
  }
  return out;
}

/** 고른 세트를 웜업으로 (그 기록의 것만). 세트가 바뀌었으면(이미 웜업·없음) 건너뜀. 바꾼 게 있으면 editedAt */
export function applyWarmups(w: Workout, fixes: readonly WarmupFix[], nowIso: string): Workout {
  let changed = false;
  const blocks = w.blocks.map((b, bi) => ({ ...b, items: b.items.map((it, ii) => ({ ...it, sets: it.sets.map((s, k) => {
    const hit = fixes.some((f) => f.id === w.id && f.block === bi && f.item === ii && f.set === k && f.exerciseId === it.exerciseId);
    if (!hit || s.warmup || s.weight !== f0(fixes, w.id, bi, ii, k)) return s;
    changed = true;
    return { ...s, warmup: true };
  }) })) }));
  return changed ? { ...w, blocks, editedAt: nowIso } : w;
}
const f0 = (fixes: readonly WarmupFix[], id: string, b: number, i: number, k: number) => fixes.find((f) => f.id === id && f.block === b && f.item === i && f.set === k)?.weight;
