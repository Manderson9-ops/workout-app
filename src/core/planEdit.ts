/**
 * 플랜 화면에서 바로 고치기 (D-036): 세트·횟수 따로 조절, 블록 순서 바꾸기, 운동 직접 추가.
 * 시간 계산은 화면의 recompute가 한다. 여기서는 구조만 바꾼다 (순수 함수).
 */
import type { Plan, PlanBlock, PlanItem, PlanRequest } from './planner';
import type { BuiltExercise } from './types';
import { moveItem } from './reorder';

/** 직접 고치는 세트 범위 (D-042: 사실상 제한 없음. 이전 D-036은 1~8, 앱 판단). 자동 생성 기준(수준별 3·4, 근육별 상한)과는 별개 */
export const SETS_MIN = 1, SETS_MAX = 99;
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
  return moveBlockTo(plan, bi, bi + d);
}

/** 블록을 from 자리에서 to 자리로 (끌어서 놓기, D-037). 사이 블록은 한 칸씩 밀림. 범위 밖·같은 자리면 그대로 */
export function moveBlockTo(plan: Plan, from: number, to: number): Plan {
  const blocks = moveItem(plan.blocks, from, to);
  return blocks === plan.blocks ? plan : { ...plan, blocks: blocks as PlanBlock[] };
}

/** 운동 하나를 단일 블록으로 맨 뒤에 추가. 이미 있는 운동이면 그대로 */
export function addBlock(plan: Plan, item: PlanItem): Plan {
  if (plan.blocks.some((b) => b.items.some((i) => i.exerciseId === item.exerciseId))) return plan;
  const block: PlanBlock = { kind: 'single', items: [item], timeSec: 0 };
  return { ...plan, blocks: [...plan.blocks, block] };
}

/**
 * 잠금 유지하고 다시 생성 (D-015 + D-036).
 * - 고른 부위의 잠긴 운동은 생성기에 넘기고, 바꾼 횟수·초는 결과에 다시 입힘
 * - 고르지 않은 부위의 잠긴 운동(직접 추가 등)은 생성기가 무시하므로 결과 뒤에 그대로 붙임
 * - 모두 잠갔는데 고른 부위 운동이 하나도 없으면 지금 플랜 그대로
 * 시간은 부르는 쪽이 다시 계산한다.
 */
export const KEEP_ALL = '잠근 운동이 모두 고르지 않은 부위라 플랜을 그대로 둠 (부위를 더 고르거나 잠금을 풀면 새로 짬)';
export const ONLY_LOCKED = '고른 부위로는 조건에 맞게 짤 수 없어 잠근 운동만 남김';
export function regenerateWithLocks(old: Plan, locks: ReadonlySet<string>, req: PlanRequest, gen: (r: PlanRequest) => Plan): Plan {
  const items = old.blocks.flatMap((b) => b.items);
  const locked = items.filter((i) => locks.has(i.exerciseId));
  const wanted = new Set(req.parts.map((p) => p.part));
  const inPart = locked.filter((i) => wanted.has(i.part));
  const offPart = locked.filter((i) => !wanted.has(i.part));
  const allLocked = items.length > 0 && locked.length === items.length;
  if (allLocked && !inPart.length) return { ...old, reasons: [KEEP_ALL, ...old.reasons.filter((r) => r !== KEEP_ALL)] };
  const p = gen({ ...req, locked: inPart.map((i) => ({ exerciseId: i.exerciseId, part: i.part, sets: i.sets })), lockedOnly: allLocked });
  const byId = new Map(locked.map((i) => [i.exerciseId, i]));
  let out: Plan = { ...p, blocks: p.blocks.map((b) => ({ ...b, items: b.items.map((it) => {
    const o = byId.get(it.exerciseId);
    if (!o) return it;
    return o.seconds !== undefined ? { ...it, seconds: o.seconds } : { ...it, reps: o.reps };
  }) })) };
  if (offPart.length) {
    if (!out.blocks.length) out = { ...out, status: 'ok', warmup: old.warmup, reasons: [ONLY_LOCKED] };
    for (const i of offPart) out = addBlock(out, { ...i, locked: true });
  }
  return out;
}

/** 사용자가 만든 운동 DB(WORK_OUT_K: 영상 등급·자세 포인트)가 연결된 운동인지 */
export function hasDbInfo(e: Pick<BuiltExercise, 'grades' | 'guide'> | undefined): boolean {
  if (!e) return false;
  return e.grades.some((g) => g.source === 'VIDEO') || e.guide.length > 0;
}
