/**
 * 플랜 화면에서 바로 고치기 (D-036): 세트·횟수 따로 조절, 블록 순서 바꾸기, 운동 직접 추가.
 * 시간 계산은 화면의 recompute가 한다. 여기서는 구조만 바꾼다 (순수 함수).
 */
import type { Plan, PlanBlock, PlanItem, PlanRequest } from './planner';
import type { BuiltExercise } from './types';
import { moveItem } from './reorder';
import { DEFAULT_TIME } from './time';

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

/**
 * D-046: 플랜에서 다음 운동과 묶기 (루틴 편집과 같은 규칙). 두 블록 모두 한 부위이고 같은 부위면 컴파운드 세트, 아니면 슈퍼세트.
 * 묶음은 최대 4개 운동. 라운드 후 휴식은 플랜 휴식값, 전환 10초. 시간은 부르는 쪽(recompute)이 다시 계산한다.
 */
export const GROUP_MAX = 4;
export function groupKindWithNext(plan: Plan, bi: number): 'superset' | 'compound' | null {
  const a = plan.blocks[bi], b = plan.blocks[bi + 1];
  if (!a || !b || a.items.length + b.items.length > GROUP_MAX) return null;
  const pa = new Set(a.items.map((i) => i.part)), pb = new Set(b.items.map((i) => i.part));
  return pa.size === 1 && pb.size === 1 && [...pa][0] === [...pb][0] ? 'compound' : 'superset';
}
export function mergeWithNextBlock(plan: Plan, bi: number): Plan {
  const kind = groupKindWithNext(plan, bi);
  if (!kind) return plan;
  const a = plan.blocks[bi]!, b = plan.blocks[bi + 1]!;
  const merged: PlanBlock = { kind, items: [...a.items, ...b.items], roundRestSec: a.kind === 'single' ? plan.rest.round : (a.roundRestSec ?? plan.rest.round), transitionSec: a.transitionSec ?? DEFAULT_TIME.transitionSec, timeSec: 0 };
  return { ...plan, blocks: [...plan.blocks.slice(0, bi), merged, ...plan.blocks.slice(bi + 2)] };
}
/** 묶음 풀기: 운동마다 단일 블록으로 (세트 간 휴식은 recompute가 다관절·단관절 기본값으로) */
export function splitPlanBlock(plan: Plan, bi: number): Plan {
  const b = plan.blocks[bi];
  if (!b || b.items.length < 2) return plan;
  const singles: PlanBlock[] = b.items.map((i) => ({ kind: 'single', items: [i], timeSec: 0 }));
  return { ...plan, blocks: [...plan.blocks.slice(0, bi), ...singles, ...plan.blocks.slice(bi + 1)] };
}

/**
 * D-051: 일괄·묶음 고치기. 모두 순수 함수이고 시간은 부르는 쪽(recompute)이 다시 계산한다.
 * bi를 주면 그 블록만, 아니면 플랜 전체. 바뀐 게 없으면 같은 plan 객체를 돌려줌.
 */
export const ROUND_REST_MIN = 0, ROUND_REST_MAX = 600, ROUND_REST_STEP = 15;
export const TRANSITION_MIN = 0, TRANSITION_MAX = 120, TRANSITION_STEP = 5;

function mapItems(plan: Plan, bi: number | undefined, fn: (i: PlanItem) => PlanItem): Plan {
  let changed = false;
  const blocks = plan.blocks.map((b, x) => {
    if (bi !== undefined && x !== bi) return b;
    const items = b.items.map((it) => { const n = fn(it); if (n.sets !== it.sets || n.reps !== it.reps || n.seconds !== it.seconds) changed = true; return n; });
    return { ...b, items };
  });
  return changed ? { ...plan, blocks } : plan;
}
export function bulkSets(plan: Plan, d: number, bi?: number): Plan { return mapItems(plan, bi, (i) => stepSets(i, d)); }
export function bulkReps(plan: Plan, d: number, bi?: number): Plan { return mapItems(plan, bi, (i) => stepReps(i, d)); }

/** 묶음에 운동 추가 (묶음만, 최대 GROUP_MAX개, 플랜에 없는 운동만) */
export function addToGroup(plan: Plan, bi: number, item: PlanItem): Plan {
  const b = plan.blocks[bi];
  if (!b || b.kind === 'single' || b.items.length >= GROUP_MAX) return plan;
  if (plan.blocks.some((x) => x.items.some((i) => i.exerciseId === item.exerciseId))) return plan;
  // 다른 부위 운동이 들어오면 컴파운드 세트(같은 부위) → 슈퍼세트 (묶기 규칙 D-046과 같은 용어)
  // 새 운동의 세트는 묶음 안 최대 세트에 맞춤 (라운드가 어긋나지 않게)
  const maxSets = Math.max(...b.items.map((i) => i.sets));
  const items = [...b.items, { ...item, sets: maxSets }];
  const kind: PlanBlock['kind'] = new Set(items.map((i) => i.part)).size === 1 ? 'compound' : 'superset';
  // 구성이 바뀌었으니 '기구 두 개' 표시는 더 이상 맞지 않음
  const nb: PlanBlock = { ...b, kind, items };
  delete nb.twoStations;
  return { ...plan, blocks: plan.blocks.map((x, y) => (y === bi ? nb : x)) };
}

function setGroupField(plan: Plan, bi: number, key: 'roundRestSec' | 'transitionSec', cur: number, v: number): Plan {
  const b = plan.blocks[bi];
  if (!b || b.kind === 'single' || v === cur) return plan;
  return { ...plan, blocks: plan.blocks.map((x, y) => (y === bi ? { ...x, [key]: v } : x)) };
}
export function stepRoundRest(plan: Plan, bi: number, d: -1 | 1): Plan {
  const b = plan.blocks[bi];
  if (!b) return plan;
  const cur = b.roundRestSec ?? plan.rest.round;
  return setGroupField(plan, bi, 'roundRestSec', cur, clamp(cur + d * ROUND_REST_STEP, ROUND_REST_MIN, ROUND_REST_MAX));
}
export function stepTransition(plan: Plan, bi: number, d: -1 | 1): Plan {
  const b = plan.blocks[bi];
  if (!b) return plan;
  const cur = b.transitionSec ?? DEFAULT_TIME.transitionSec;
  return setGroupField(plan, bi, 'transitionSec', cur, clamp(cur + d * TRANSITION_STEP, TRANSITION_MIN, TRANSITION_MAX));
}

/** 일괄 버튼 가운데 글자: 세트는 "3세트"/"3~4세트", 횟수는 "10회"/"8~12회", 시간 운동은 "30초"/"30~45초", 섞이면 "8~12회 · 30초" */
export function rangeText(items: readonly PlanItem[], kind: 'sets' | 'reps'): string {
  const rng = (v: number[], unit: string) => {
    if (!v.length) return '';
    const lo = Math.min(...v), hi = Math.max(...v);
    return (lo === hi ? `${lo}` : `${lo}~${hi}`) + unit;
  };
  if (kind === 'sets') return rng(items.map((i) => i.sets), '세트');
  const reps = rng(items.filter((i) => i.seconds === undefined).map((i) => i.reps), '회');
  const secs = rng(items.filter((i) => i.seconds !== undefined).map((i) => i.seconds!), '초');
  return [reps, secs].filter(Boolean).join(' · ');
}

/** 일괄 고치기로 값이 바뀐 운동 수 (같은 자리끼리 비교) */
export function changedCount(before: Plan, after: Plan): number {
  let n = 0;
  before.blocks.forEach((b, x) => b.items.forEach((it, y) => {
    const o = after.blocks[x]?.items[y];
    if (o && (o.sets !== it.sets || o.reps !== it.reps || o.seconds !== it.seconds)) n++;
  }));
  return n;
}