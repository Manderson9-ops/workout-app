/**
 * 운동 끝내기 (D-038): 끝내지 못하면 이유를 돌려주고 진단 기록에 남긴다. 조용히 아무 일도 안 일어나는 경우가 없어야 한다.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { decideFinish, emptyRoutine, startWorkout } from '../src/core/session';
import type { Workout } from '../src/core/session';
import { finishActiveWorkout, FINISH_MSG } from '../src/ui/actions';
import { askConfirm } from '../src/ui/confirm';
import { db, registerPending, getState } from '../src/ui/store';
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

  it('입력 먼저 저장이 실패하면 끝내지 않고 알림. 다시 누르면 끝남 (막히지 않음)', async () => {
    await db.workouts.put(mk('w3', deviceId()));
    registerPending('k', async () => { throw new Error('저장 실패 시험'); });
    const r = await finishActiveWorkout('w3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('input');
    expect((await db.workouts.get('w3'))!.endedAt).toBeUndefined();
    expect((await diagErrors())[0]).toMatch(/^운동 끝내기 안 됨: input · /);
    expect(await finishActiveWorkout('w3')).toEqual({ ok: true });
    expect((await db.workouts.get('w3'))!.endedAt).toBeTruthy();
  });
});

describe('askConfirm', () => {
  it('확인 창을 띄울 곳(ConfirmHost)이 없으면 취소로 끝나고 진단 기록에 남김 (멈추지 않음)', async () => {
    await db.diag.clear();
    expect(await askConfirm({ title: '시험', ok: '확인' })).toBe(false);
    expect(await diagErrors()).toEqual(['확인 창을 띄울 곳이 없음']);
  });
});
