/**
 * 끝낼 때 루틴 반영 묻기 (D-068, 사용 분석 P4). 화면과 분리된 순수 함수.
 * 루틴으로 시작한 운동이 루틴과 운동 구성이 달라졌는지: 더함·지움(건너뛰고 한 세트도 안 함)·교체·순서 바꿈.
 * 순서는 블록·운동 자리로 비교 (완료 시각 아님). 무게·횟수·세트 수만 바뀐 것은 묻지 않음 (Hevy 방식)
 */
import type { Routine, RoutineBlock, RoutineItem, Workout, WorkoutItem } from './session';

export interface RoutineDiff {
  added: string[];
  removed: string[];
  swapped: { from: string; to: string }[];
  reordered: boolean;
  changed: boolean;
}

/** 운동에 남은 운동: 건너뛰고 완료 세트가 없는 것은 지운 것으로 봄 */
const present = (it: WorkoutItem) => !(it.skipped && !it.sets.some((s) => s.done));

export function routineDiff(r: Routine, w: Workout): RoutineDiff {
  const rb = r.blocks.map((b) => b.items.map((i) => i.exerciseId)).filter((b) => b.length);
  const wb = w.blocks.map((b) => b.items.filter(present).map((i) => i.exerciseId)).filter((b) => b.length);
  const R = new Set(rb.flat()), W = new Set(wb.flat());
  let added = [...new Set(wb.flat().filter((id) => !R.has(id)))];
  let removed = [...new Set(rb.flat().filter((id) => !W.has(id)))];
  // 운동 블록 ↔ 루틴 블록 짝짓기: 같은 운동이 있으면 짝, 남은 것은 같은 운동 수끼리 순서대로 (교체한 단일 블록 등)
  const match: (number | undefined)[] = wb.map(() => undefined);
  const used = new Set<number>();
  wb.forEach((ids, j) => {
    const i = rb.findIndex((rids, k) => !used.has(k) && rids.some((x) => ids.includes(x)));
    if (i >= 0) { match[j] = i; used.add(i); }
  });
  wb.forEach((ids, j) => {
    if (match[j] !== undefined) return;
    const i = rb.findIndex((rids, k) => !used.has(k) && rids.length === ids.length && rids.every((x) => !W.has(x)));
    if (i >= 0) { match[j] = i; used.add(i); }
  });
  const swapped: { from: string; to: string }[] = [];
  let reordered = false;
  wb.forEach((ids, j) => {
    const i = match[j];
    if (i === undefined) return;
    const rids = rb[i]!;
    const gone = rids.filter((x) => removed.includes(x)), fresh = ids.filter((x) => added.includes(x));
    for (let k = 0; k < Math.min(gone.length, fresh.length); k++) swapped.push({ from: gone[k]!, to: fresh[k]! });
    // 블록 안 순서 (둘 다 있는 운동끼리)
    const a = rids.filter((x) => W.has(x) && ids.includes(x)), b = ids.filter((x) => R.has(x) && rids.includes(x));
    if (a.join('\n') !== b.join('\n')) reordered = true;
  });
  added = added.filter((id) => !swapped.some((s) => s.to === id));
  removed = removed.filter((id) => !swapped.some((s) => s.from === id));
  // 블록 순서: 짝지은 루틴 블록 번호가 운동 순서대로 커지는지
  const seq = match.filter((x): x is number => x !== undefined);
  if (seq.some((x, k) => k > 0 && x < seq[k - 1]!)) reordered = true;
  return { added, removed, swapped, reordered, changed: !!(added.length || removed.length || swapped.length || reordered) };
}

/** 바뀐 점 한 줄 (확인 창): "추가 1개 · 교체 1개 · 순서 바뀜" */
export function diffText(d: RoutineDiff, nameOf: (id: string) => string): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`추가: ${d.added.map(nameOf).join(', ')}`);
  if (d.swapped.length) parts.push(`교체: ${d.swapped.map((s) => `${nameOf(s.from)} → ${nameOf(s.to)}`).join(', ')}`);
  if (d.removed.length) parts.push(`빠짐: ${d.removed.map(nameOf).join(', ')}`);
  if (d.reordered) parts.push('순서 바뀜');
  return parts.join('\n');
}

/**
 * 운동 칸 하나의 세트 수 = 웜업이 아닌 세트 수 (웜업은 루틴 세트 수에 넣지 않음).
 * 단, 시작 때 루틴 세트의 첫 세트를 웜업으로 미리 표시(D-070)했고 세트 수를 그대로 뒀으면 루틴 세트 수 그대로
 */
export function setCount(it: WorkoutItem): number {
  const work = it.sets.filter((s) => !s.warmup).length;
  const preMarked = it.sets.length === it.target.sets && !!it.sets[0]?.warmup && work === it.target.sets - 1;
  return Math.max(1, preMarked ? it.target.sets : work);
}

/**
 * 이번 운동의 운동 목록·순서·세트 수로 바꾼 루틴 (이름·웜업·메모는 그대로, 예상 시간은 부르는 쪽이 다시 계산).
 * 루틴에 있던 운동은 루틴의 목표 횟수·초를 유지, 새 운동은 운동 때 목표를 씀
 */
export function routineFromWorkout(r: Routine, w: Workout, now: string): Routine {
  const old = new Map<string, RoutineItem>();
  for (const b of r.blocks) for (const i of b.items) if (!old.has(i.exerciseId)) old.set(i.exerciseId, i);
  const blocks: RoutineBlock[] = [];
  for (const b of w.blocks) {
    const items: RoutineItem[] = b.items.filter(present).map((it) => {
      const o = old.get(it.exerciseId);
      const reps = o ? o.reps : it.target.reps;
      const seconds = o ? o.seconds : it.target.seconds;
      return { exerciseId: it.exerciseId, sets: setCount(it), reps, ...(seconds !== undefined ? { seconds } : {}) };
    });
    if (!items.length) continue;
    blocks.push({ kind: items.length > 1 ? (b.kind === 'single' ? 'superset' : b.kind) : 'single', items, restSec: b.restSec, roundRestSec: b.roundRestSec, transitionSec: b.transitionSec });
  }
  return { ...r, blocks, updatedAt: now };
}

/** 새 루틴으로 저장 */
export function newRoutineFromWorkout(r: Routine, w: Workout, id: string, name: string, now: string): Routine {
  const base = routineFromWorkout(r, w, now);
  const { estimatedSec: _e, ...rest } = base;
  return { ...rest, id, name, createdAt: now, updatedAt: now };
}

/** 운동을 시작한 뒤 루틴이 고쳐졌는지 (루틴 updatedAt > 운동 startedAt). 그러면 [루틴 업데이트]로 덮어쓰지 않음 (P4) */
export const routineChangedDuring = (r: Pick<Routine, 'updatedAt'>, w: Pick<Workout, 'startedAt'>): boolean => Date.parse(r.updatedAt) > Date.parse(w.startedAt);
