/**
 * 화면에서 쓰는 저장 동작 모음
 */
import { mutate, activeOf, historyOf, db, setWorkoutLocal, askPersistOnce, flushPending, load } from './store';
import { askConfirm } from './confirm';
import { diag } from './diag';
import { deviceId } from './deviceId';
import type { AppState } from './store';
import { newId } from '../db/db';
import { startWorkout, planToRoutine, decideFinish } from '../core/session';
import type { FinishDecision } from '../core/session';
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
    // 다른 기기로 넘어간 운동은 이 기기에서 고치지 않음 (늦은 저장이 새 주인 기록과 부딪히지 않게)
    if (cur.ownerDeviceId && cur.ownerDeviceId !== deviceId()) return undefined;
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

/** 운동 끝내기 결과 (D-038): 실패하면 이유와 화면에 보일 문구 */
export type FinishFail = 'input' | 'missing' | 'other-device' | 'not-saved' | 'error';
export type FinishResult = { ok: true } | { ok: false; reason: FinishFail; message: string };
export const FINISH_MSG: Record<FinishFail, string> = {
  input: '마지막으로 입력한 값을 저장하지 못해 끝내지 않았어요. 값을 확인하고 다시 눌러 주세요.',
  missing: '이 운동 기록을 찾지 못했어요. 다른 기기에서 지워졌을 수 있어요.',
  'other-device': '이 운동은 다른 기기로 넘어가서 여기서 끝낼 수 없어요. 그 기기에서 끝내 주세요.',
  'not-saved': '끝내기가 저장되지 않았어요. 다시 눌러 주세요.',
  error: '끝내기를 저장하는 중 오류가 났어요. 다시 눌러 주세요.',
};
const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/**
 * 진행 중 운동 끝내기 (D-038). 입력 먼저 저장 → 끝낸 시각 저장 → 다시 읽어 저장됐는지 확인.
 * 끝내지 못하면 이유를 돌려주고 진단 기록(오류)에 남긴다. 성공일 때만 true.
 */
export async function finishActiveWorkout(id: string): Promise<FinishResult> {
  const fail = (reason: FinishFail, detail?: string): FinishResult => {
    diag('error', { m: `운동 끝내기 안 됨: ${reason}${detail ? ` · ${detail}` : ''}` });
    return { ok: false, reason, message: FINISH_MSG[reason] };
  };
  try {
    const n = await flushPending();
    if (n) diag('input', { v: n, m: '버튼 전에 입력 먼저 저장' });
  } catch (e) { return fail('input', errText(e)); }
  let d: FinishDecision;
  try {
    d = await db.transaction('rw', db.workouts, async () => {
      const r = decideFinish(await db.workouts.get(id), deviceId(), new Date().toISOString());
      if (r.kind === 'ok') await db.workouts.put(r.w);
      return r;
    });
  } catch (e) { return fail('error', errText(e)); }
  if (d.kind === 'missing' || d.kind === 'other-device') { await load().catch(() => undefined); return fail(d.kind); }
  const saved = await db.workouts.get(id).catch(() => undefined);
  if (!saved?.endedAt) return fail('not-saved');
  setWorkoutLocal(saved);
  return { ok: true };
}

export async function startRoutine(s: AppState, r: Routine) {
  const cur = activeOf(s);
  if (cur && !(await askConfirm({ title: '진행 중인 운동이 있어요', message: `"${cur.name}"을(를) 끝내고 새로 시작할까요?`, ok: '끝내고 새로 시작', danger: true }))) { go('#/workout'); return; }
  void askPersistOnce();
  const w = { ...startWorkout(newId('w'), r, new Date().toISOString(), historyOf(s), { betweenSec: s.settings.rest.between }), ownerDeviceId: deviceId(), ownerAt: new Date().toISOString(), ownerSeq: 1 };
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
