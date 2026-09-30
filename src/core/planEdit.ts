/**
 * 플랜 화면에서 바로 고치기 (D-036): 세트·횟수 따로 조절, 블록 순서 바꾸기, 운동 직접 추가.
 * 시간 계산은 화면의 recompute가 한다. 여기서는 구조만 바꾼다 (순수 함수).
 */
import type { Plan, PlanBlock, PlanItem } from './planner';
import type { BuiltExercise } from './types';

export const SETS_MIN = 1, SETS_MAX = 8;
export const REPS_MIN = 1, REPS_MAX = 50;
export const SECS_MIN = 5, SECS_MAX = 300, SECS_STEP = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function stepSets(it: PlanItem, d: number): PlanItem {
  return { ...it, sets: clamp(it.sets + d, SETS_MIN, SETS_MAX) };
}

/** 횟수 운동은 1회씩, 시간 운동은 5초씩 */
export function stepReps(it: PlanItem, d: number): PlanItem {
  if (it.seconds !== undefined) return { ...it, seconds: clamp(it.seconds + d * SECS_STEP, SECS_MIN, SECS_MAX) };
  return { ...it, reps: clamp(it.reps + d, REPS_MIN, REPS_MAX) };
}

/** 블록(묶음은 통째로) 한 칸 위/아래로. 범위 밖이면 그대로 */
export function moveBlock(plan: Plan, bi: number, d: -1 | 1): Plan {
  const to = bi + d;
  if (bi < 0 || bi >= plan.blocks.length || to < 0 || to >= plan.blocks.length) return plan;
  const blocks = [...plan.blocks];
  [blocks[bi], blocks[to]] = [blocks[to]!, blocks[bi]!];
  return { ...plan, blocks };
}

/** 운동 하나를 단일 블록으로 맨 뒤에 추가. 이미 있는 운동이면 그대로 */
export function addBlock(plan: Plan, item: PlanItem): Plan {
  if (plan.blocks.some((b) => b.items.some((i) => i.exerciseId === item.exerciseId))) return plan;
  const block: PlanBlock = { kind: 'single', items: [item], timeSec: 0 };
  return { ...plan, blocks: [...plan.blocks, block] };
}

/** 사용자가 만든 운동 DB(WORK_OUT_K: 영상 등급·자세 포인트)가 연결된 운동인지 */
export function hasDbInfo(e: Pick<BuiltExercise, 'grades' | 'guide'> | undefined): boolean {
  if (!e) return false;
  return e.grades.some((g) => g.source === 'VIDEO') || e.guide.length > 0;
}
