/**
 * 화면에서 쓰는 저장 동작 모음
 */
import { useEffect, useState } from 'preact/hooks';
import { mutate, activeOf, historyOf, db, setWorkoutLocal, askPersistOnce, flushPending, load, getState } from './store';
import { askConfirm } from './confirm';
import { diag } from './diag';
import { deviceId } from './deviceId';
import type { AppState } from './store';
import { newId, DEFAULT_SETTINGS, softDelete } from '../db/db';
import { startWorkout, planToRoutine, decideFinish, withHidden, withoutHidden } from '../core/session';
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
  input: '마지막으로 입력한 값을 저장하지 못해 끝내지 않았어요. 다시 누르면 저장을 다시 시도해요.',
  missing: '이 운동 기록을 찾지 못했어요. 다른 기기에서 지워졌을 수 있어요.',
  'other-device': '이 운동은 다른 기기로 넘어가서 여기서 끝낼 수 없어요. 그 기기에서 끝내 주세요.',
  'not-saved': '끝내기가 저장되지 않았어요. 다시 눌러 주세요.',
  error: '끝내기를 저장하는 중 오류가 났어요. 다시 눌러 주세요.',
};
const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/** 마지막 끝내기 실패 문구. 운동 화면이 보여 줌 (시작 화면에서 실패해도 운동 화면으로 가서 보이게) */
let finishErr: string | null = null;
const finishErrListeners = new Set<(m: string | null) => void>();
export const getFinishError = () => finishErr;
export function setFinishError(m: string | null): void { finishErr = m; finishErrListeners.forEach((f) => f(m)); }
export function useFinishError(): string | null {
  const [m, setM] = useState(finishErr);
  useEffect(() => { finishErrListeners.add(setM); setM(finishErr); return () => { finishErrListeners.delete(setM); }; }, []);
  return m;
}

/**
 * 진행 중 운동 끝내기 (D-038). 입력 먼저 저장 → 끝낸 시각 저장(쓰기 트랜잭션 안에서 판단) → 다시 읽어 저장됐는지 확인.
 * 끝내지 못하면 이유를 돌려주고, 화면 문구(setFinishError)와 진단 기록(오류)에 남긴다.
 */
export async function finishActiveWorkout(id: string): Promise<FinishResult> {
  const fail = (reason: FinishFail, detail?: string): FinishResult => {
    diag('error', { m: `운동 끝내기 안 됨: ${reason}${detail ? ` · ${detail}` : ''}` });
    setFinishError(FINISH_MSG[reason]);
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
  let saved: Workout | undefined;
  try { saved = await db.workouts.get(id); } catch (e) { return fail('error', `다시 읽기 · ${errText(e)}`); }
  if (!saved?.endedAt) return fail('not-saved');
  setWorkoutLocal(saved);
  setFinishError(null);
  return { ok: true };
}

let starting = false;
/**
 * 루틴 시작. 진행 중인 운동이 있으면 앱 안 확인 창으로 묻고, 확인하면 그 운동을 finishActiveWorkout으로 끝낸 뒤 시작 (D-038).
 * 확인 창이 열린 사이 동기화로 바뀌었을 수 있으므로 확인 뒤 최신 상태로 다시 고른다 (검토 M1).
 * 앞 운동을 끝내지 못하면 새로 만들지 않고 운동 화면으로 가서 이유를 보여 준다. 두 번 눌러도 한 번만.
 */
export async function startRoutine(s: AppState, r: Routine) {
  if (starting) return;
  starting = true;
  try {
    const first = activeOf(s);
    if (first) {
      const ans = await askConfirm({ title: '진행 중인 운동이 있어요', message: `"${first.name}"을(를) 끝내고 새로 시작할까요?`, ok: '끝내고 새로 시작', danger: true });
      if (ans === null) return; // 다른 확인 창으로 바뀜: 아무것도 안 함
      if (!ans) { go('#/workout'); return; }
      const cur = activeOf(getState());
      if (cur) {
        const f = await finishActiveWorkout(cur.id);
        if (!f.ok) { go('#/workout'); return; }
      }
    }
    void askPersistOnce();
    const st = getState();
    const w = { ...startWorkout(newId('w'), r, new Date().toISOString(), historyOf(st), { betweenSec: st.settings.rest.between }), ownerDeviceId: deviceId(), ownerAt: new Date().toISOString(), ownerSeq: 1 };
    await mutate((d) => d.workouts.put(w));
    setFinishError(null); // 지난 운동의 실패 문구가 새 운동 화면에 남지 않게 (검토 R1)
    go('#/workout');
  } finally { starting = false; }
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

/**
 * 홈 "최근 운동"에서만 빼기·다시 보이기 (D-040). 설정의 지금 값을 저장소에서 읽어 이 ID만 더하거나 뺌
 * (화면이 들고 있던 설정으로 덮어써 다른 항목을 되돌리지 않게)
 */
export async function setHomeHidden(id: string, hidden: boolean): Promise<void> {
  await mutate(async (d) => {
    const st = (await d.settings.get('main')) ?? DEFAULT_SETTINGS;
    const next = hidden ? withHidden(st.homeHidden, id) : withoutHidden(st.homeHidden, id);
    if (next.length === (st.homeHidden ?? []).length) return; // 바뀐 게 없으면 저장·동기화하지 않음
    await d.settings.put({ ...st, key: 'main', homeHidden: next });
  });
}

/** 내 루틴 목록에서만 숨기기·다시 보이기 (D-048). 홈 최근 운동과 같은 방식: 저장소의 지금 설정에서 이 ID만 바꿈 */
export async function setRoutineHidden(id: string, hidden: boolean): Promise<void> {
  await mutate(async (d) => {
    const st = (await d.settings.get('main')) ?? DEFAULT_SETTINGS;
    const next = hidden ? withHidden(st.routineHidden, id) : withoutHidden(st.routineHidden, id);
    if (next.length === (st.routineHidden ?? []).length) return;
    await d.settings.put({ ...st, key: 'main', routineHidden: next });
  });
}

/** 루틴 완전 삭제 (지움 표시, 되돌릴 수 없음). 운동 기록은 남음. 숨긴 목록에서도 정리 */
export async function deleteRoutineForever(id: string): Promise<void> {
  await mutate(async (d) => {
    await softDelete(d, 'routines', id);
    const st = await d.settings.get('main');
    if (st && (st.routineHidden ?? []).includes(id)) await d.settings.put({ ...st, routineHidden: withoutHidden(st.routineHidden, id) });
  });
}
