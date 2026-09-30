/**
 * 화면에서 쓰는 저장 동작 모음
 */
import { mutate, activeOf, historyOf, db, setWorkoutLocal, askPersistOnce, flushPending } from './store';
import { diag } from './diag';
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
  const next = await db.transaction('rw', db.workouts, async () => {
    const cur = await db.workouts.get(id);
    if (!cur) return undefined;
    const n = fn(cur);
    await db.workouts.put(n);
    return n;
  });
  if (next) setWorkoutLocal(next);
}

/** 입력 중인 값 먼저 저장한 뒤 변경 (세트 완료 등) */
export async function updateWorkoutAfterInputs(id: string, fn: (w: Workout) => Workout) {
  const n = await flushPending();
  if (n) diag('input', { v: n, m: '버튼 전에 입력 먼저 저장' });
  await updateWorkout(id, fn);
}

export async function startRoutine(s: AppState, r: Routine) {
  const cur = activeOf(s);
  if (cur && !confirm(`진행 중인 운동 "${cur.name}"이 있어요. 그 운동을 끝내고 새로 시작할까요?`)) { go('#/workout'); return; }
  void askPersistOnce();
  const w = startWorkout(newId('w'), r, new Date().toISOString(), historyOf(s), { betweenSec: s.settings.rest.between });
  await mutate(async (d) => {
    if (cur) await d.workouts.put({ ...cur, endedAt: new Date().toISOString(), timer: null });
    await d.workouts.put(w);
  });
  go('#/workout');
}

export async function savePlanAsRoutine(name: string, blocks: PlanBlock[], estimatedSec: number, warmupSec?: number): Promise<Routine> {
  void askPersistOnce();
  const r = planToRoutine(newId('r'), name, new Date().toISOString(), blocks, estimatedSec, warmupSec);
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
