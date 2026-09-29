/**
 * 화면에서 쓰는 저장 동작 모음
 */
import { mutate, activeOf, historyOf } from './store';
import type { AppState } from './store';
import { newId } from '../db/db';
import { startWorkout, planToRoutine } from '../core/session';
import type { Routine, Workout } from '../core/session';
import type { PlanBlock } from '../core/planner';
import { go } from './nav';

export async function saveWorkout(w: Workout) { await mutate((d) => d.workouts.put(w)); }

/**
 * 진행 중 운동 변경: 저장된 최신 상태를 읽어 바꾼다 (쓰기 트랜잭션이라 연속 입력이 서로 덮어쓰지 않음).
 * 예: 무게 입력 직후 세트 완료를 눌러도 무게가 사라지지 않는다.
 */
export async function updateWorkout(id: string, fn: (w: Workout) => Workout) {
  await mutate((d) => d.transaction('rw', d.workouts, async () => {
    const cur = await d.workouts.get(id);
    if (cur) await d.workouts.put(fn(cur));
  }));
}

export async function startRoutine(s: AppState, r: Routine) {
  const cur = activeOf(s);
  if (cur && !confirm(`진행 중인 운동 "${cur.name}"이 있어요. 그 운동을 끝내고 새로 시작할까요?`)) { go('#/workout'); return; }
  const w = startWorkout(newId('w'), r, new Date().toISOString(), historyOf(s));
  await mutate(async (d) => {
    if (cur) await d.workouts.put({ ...cur, endedAt: new Date().toISOString(), timer: null });
    await d.workouts.put(w);
  });
  go('#/workout');
}

export async function savePlanAsRoutine(name: string, blocks: PlanBlock[], estimatedSec: number): Promise<Routine> {
  const r = planToRoutine(newId('r'), name, new Date().toISOString(), blocks, estimatedSec);
  await mutate((d) => d.routines.put(r));
  return r;
}

export async function setMeta(exerciseId: string, patch: { favorite?: boolean; userGrade?: string | undefined; excluded?: boolean }) {
  await mutate(async (d) => {
    const cur = (await d.meta.get(exerciseId)) ?? { exerciseId };
    const next = { ...cur, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await d.meta.put(next as never);
  });
}
