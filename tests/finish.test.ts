/**
 * 운동 끝내기 (D-038): 끝내지 못하면 이유를 돌려주고 진단 기록에 남긴다. 조용히 아무 일도 안 일어나는 경우가 없어야 한다.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { decideFinish, emptyRoutine, startWorkout, setWorkoutMemo } from '../src/core/session';
import type { Workout } from '../src/core/session';
import { finishActiveWorkout, FINISH_MSG, updateWorkout, getFinishError as lastFinishError } from '../src/ui/actions';
import { askConfirm } from '../src/ui/confirm';
import { db, registerPending, getState, flushValue, flushPending, trackInflight } from '../src/ui/store';
import { deviceId } from '../src/ui/deviceId';
import { flushDiag } from '../src/ui/diag';

const NOW = '2026-10-01T10:00:00.000Z';
const mk = (id: string, owner?: string): Workout => ({ ...startWorkout(id, emptyRoutine('r1', '시험 루틴', NOW), NOW, []), ...(owner ? { ownerDeviceId: owner } : {}) });

describe('decideFinish (순수 판단)', () => {
  it('없음 → missing', () => { expect(decideFinish(undefined, 'me', NOW)).toEqual({ kind: 'missing' }); });
  it('다른 기기 운동 → other-device (바꾸지 않음)', () => { expect(decideFinish(mk('a', 'other'), 'me', NOW).kind).toBe('other-device'); });
  it('주인 없음·내 기기 → ok, 끝난 시각과 타이머 정리', () => {
    for (const w of [mk('a'), mk('b', 'me')]) {
      const d = decideFinish({ ...w, timer: { startedAt: 1, endsAt: 2, label: 'x', kind: 'set' } }, 'me', NOW);
      expect(d.kind).toBe('ok');
      if (d.kind === 'ok') { expect(d.w.endedAt).toBe(NOW); expect(d.w.timer).toBeNull(); }
    }
  });
  it('다른 기기 운동이라도 이미 끝났으면 already (검토 N1)', () => { expect(decideFinish({ ...mk('a', 'other'), endedAt: NOW }, 'me', NOW).kind).toBe('already'); });
  it('이미 끝남 → already, 원래 끝난 시각 유지', () => {
    const d = decideFinish({ ...mk('a', 'me'), endedAt: '2026-10-01T09:00:00.000Z' }, 'me', NOW);
    expect(d.kind).toBe('already');
    if (d.kind === 'already') expect(d.w.endedAt).toBe('2026-10-01T09:00:00.000Z');
  });
});

const diagErrors = async () => { await flushDiag(); return (await db.diag.toArray()).filter((e) => e.k === 'error').map((e) => e.m ?? ''); };

describe('finishActiveWorkout (저장까지)', () => {
  beforeEach(async () => { await flushDiag(); await db.diag.clear(); }); // 운동 ID는 시험마다 다르게 (지우기는 softDelete만 허용)

  it('내 운동: 끝나고, 다시 읽어도 끝난 시각이 있고, 화면 상태도 바뀜. 두 번 눌러도 성공·시각 유지', async () => {
    await db.workouts.put(mk('w1', deviceId()));
    expect(await finishActiveWorkout('w1')).toEqual({ ok: true });
    const first = (await db.workouts.get('w1'))!.endedAt;
    expect(first).toBeTruthy();
    expect(getState().workouts.find((w) => w.id === 'w1')?.endedAt).toBe(first);
    expect(await finishActiveWorkout('w1')).toEqual({ ok: true });
    expect((await db.workouts.get('w1'))!.endedAt).toBe(first);
    expect(await diagErrors()).toEqual([]);
  });

  it('다른 기기로 넘어간 운동: 실패 이유·문구, 기록은 그대로, 진단 기록에 남음', async () => {
    await db.workouts.put(mk('w2', 'zzzzzz'));
    const r = await finishActiveWorkout('w2');
    expect(r).toEqual({ ok: false, reason: 'other-device', message: FINISH_MSG['other-device'] });
    expect((await db.workouts.get('w2'))!.endedAt).toBeUndefined();
    expect(await diagErrors()).toEqual(['운동 끝내기 안 됨: other-device']);
  });

  it('기록이 없음(다른 기기에서 지움): missing', async () => {
    const r = await finishActiveWorkout('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing');
    expect(await diagErrors()).toEqual(['운동 끝내기 안 됨: missing']);
  });

  it('입력 먼저 저장이 실패하면 끝내지 않고 알림·화면 문구. 다시 누르면 그 값을 다시 저장한 뒤 끝남 (값 손실 없음, 검토 M2·M3)', async () => {
    await db.workouts.put(mk('w3', deviceId()));
    // 입력칸 흉내: NumInput과 같은 flushValue 사용. 첫 저장은 실패, 두 번째부터 성공
    const box: { current: string | null } = { current: '오른쪽 어깨 불편' };
    let calls = 0;
    const save = async (v: string) => { calls++; if (calls === 1) throw new Error('저장 실패 시험'); await updateWorkout('w3', (w) => setWorkoutMemo(w, v)); };
    const flush = (): Promise<void> => flushValue('memo', box, save, flush);
    registerPending('memo', flush);
    const r = await finishActiveWorkout('w3');
    expect(r).toEqual({ ok: false, reason: 'input', message: FINISH_MSG.input });
    expect(lastFinishError()).toBe(FINISH_MSG.input);
    expect((await db.workouts.get('w3'))!.endedAt).toBeUndefined();
    expect(box.current).toBe('오른쪽 어깨 불편'); // 값이 되돌아가 다시 대기
    expect((await diagErrors())[0]).toMatch(/^운동 끝내기 안 됨: input · /);
    expect(await finishActiveWorkout('w3')).toEqual({ ok: true });
    const saved = (await db.workouts.get('w3'))!;
    expect(saved.memo).toBe('오른쪽 어깨 불편'); // 다시 누를 때 저장됨
    expect(saved.endedAt).toBeTruthy();
    expect(calls).toBe(2);
    expect(lastFinishError()).toBeNull(); // 성공하면 문구 지움
  });

  it('여러 입력 중 하나가 실패해도 나머지는 저장되고, 이미 시작된 저장의 실패도 알림', async () => {
    const done: string[] = [];
    registerPending('a', async () => { throw new Error('a 실패'); });
    registerPending('b', async () => { done.push('b'); });
    await expect(flushPending()).rejects.toThrow('a 실패');
    expect(done).toEqual(['b']);
    trackInflight(Promise.reject(new Error('blur 저장 실패')));
    await expect(flushPending()).rejects.toThrow('blur 저장 실패');
    await expect(flushPending()).resolves.toBe(0); // 다음 호출은 막히지 않음
  });

  it('두 번 동시에 눌러도 둘 다 성공, 끝난 시각은 하나', async () => {
    await db.workouts.put(mk('w4', deviceId()));
    const [a, b] = await Promise.all([finishActiveWorkout('w4'), finishActiveWorkout('w4')]);
    expect(a).toEqual({ ok: true }); expect(b).toEqual({ ok: true });
    const t1 = (await db.workouts.get('w4'))!.endedAt;
    expect(await finishActiveWorkout('w4')).toEqual({ ok: true });
    expect((await db.workouts.get('w4'))!.endedAt).toBe(t1);
  });

  it('다른 기기에서 이미 끝낸 운동은 "넘어감" 오류가 아니라 성공 (검토 N1)', async () => {
    await db.workouts.put({ ...mk('w5', 'zzzzzz'), endedAt: '2026-10-01T09:30:00.000Z' });
    expect(await finishActiveWorkout('w5')).toEqual({ ok: true });
    expect((await db.workouts.get('w5'))!.endedAt).toBe('2026-10-01T09:30:00.000Z');
    expect(await diagErrors()).toEqual([]);
  });
});

describe('askConfirm', () => {
  it('확인 창을 띄울 곳(ConfirmHost)이 없으면 취소로 끝나고 진단 기록에 남김 (멈추지 않음)', async () => {
    await db.diag.clear();
    expect(await askConfirm({ title: '시험', ok: '확인' })).toBe(false);
    expect(await diagErrors()).toEqual(['확인 창을 띄울 곳이 없음']);
  });
});
