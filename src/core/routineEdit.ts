/**
 * D-052: 루틴 편집 화면의 일괄·묶음 고치기와 부위 집계 (순수 함수).
 * bi를 주면 그 블록만, 아니면 루틴 전체. 바뀐 게 없으면 같은 routine 객체를 돌려줌 (버튼 비활성 판단용).
 */
import type { Routine, RoutineItem } from './session';
import type { Part } from './types';
import { SETS_MIN, SETS_MAX, REPS_MIN, REPS_MAX, SECS_MIN, SECS_MAX, SECS_STEP } from './planEdit';

/** 버튼 방향을 거스르지 않는 한 칸 이동: 옛 루틴의 범위 밖 값(예: 60회)은 "+"에서 줄어들지 않고 그대로 둠 */
function stepWithin(cur: number, d: number, lo: number, hi: number, unit = 1): number {
  return d > 0 ? Math.max(cur, Math.min(hi, cur + d * unit)) : Math.min(cur, Math.max(lo, cur + d * unit));
}
export function stepItemSets(it: RoutineItem, d: number): RoutineItem {
  return { ...it, sets: stepWithin(it.sets, d, SETS_MIN, SETS_MAX) };
}
/** 횟수 운동은 1회씩, 시간 운동은 5초씩 */
export function stepItemReps(it: RoutineItem, d: number): RoutineItem {
  if (it.seconds !== undefined) return { ...it, seconds: stepWithin(it.seconds, d, SECS_MIN, SECS_MAX, SECS_STEP) };
  return { ...it, reps: stepWithin(it.reps, d, REPS_MIN, REPS_MAX) };
}

function mapItems(r: Routine, bi: number | undefined, fn: (i: RoutineItem) => RoutineItem): Routine {
  let changed = false;
  const blocks = r.blocks.map((b, x) => {
    if (bi !== undefined && x !== bi) return b;
    const items = b.items.map((it) => {
      const n = fn(it);
      if (n.sets !== it.sets || n.reps !== it.reps || n.seconds !== it.seconds) changed = true;
      return n;
    });
    return { ...b, items };
  });
  return changed ? { ...r, blocks } : r;
}
export function bulkRoutineSets(r: Routine, d: number, bi?: number): Routine { return mapItems(r, bi, (i) => stepItemSets(i, d)); }
export function bulkRoutineReps(r: Routine, d: number, bi?: number): Routine { return mapItems(r, bi, (i) => stepItemReps(i, d)); }

/** 일괄 고치기로 값이 바뀐 운동 수 (같은 자리끼리 비교) */
export function routineChangedCount(before: Routine, after: Routine): number {
  let n = 0;
  before.blocks.forEach((b, x) => b.items.forEach((it, y) => {
    const o = after.blocks[x]?.items[y];
    if (o && (o.sets !== it.sets || o.reps !== it.reps || o.seconds !== it.seconds)) n++;
  }));
  return n;
}

/** 부위별 운동 수 (부위를 모르는 운동은 셈에서 뺌) */
export function routineParts(r: Routine, partOf: (exerciseId: string) => Part | undefined): Map<Part, number> {
  const m = new Map<Part, number>();
  for (const b of r.blocks) for (const it of b.items) {
    const p = partOf(it.exerciseId);
    if (p) m.set(p, (m.get(p) ?? 0) + 1);
  }
  return m;
}
