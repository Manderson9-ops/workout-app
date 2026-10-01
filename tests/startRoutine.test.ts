/**
 * 진행 중에 다른 루틴 시작 (D-038 검토 M1): 앱 안 확인 창이 열린 사이 동기화로 운동이 바뀌어도
 * 옛 상태로 덮어쓰지 않고, 앞 운동을 끝내지 못하면 새 운동을 만들지 않는다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

let answer: (v: boolean | null) => void = () => undefined;
vi.mock('../src/ui/confirm', () => ({ askConfirm: () => new Promise<boolean | null>((r) => { answer = r; }) }));
const went: string[] = [];
vi.mock('../src/ui/nav', () => ({ go: (h: string) => { went.push(h); } }));

const { startRoutine, getFinishError, FINISH_MSG } = await import('../src/ui/actions');
const { db, load, getState, activeOf } = await import('../src/ui/store');
const { deviceId } = await import('../src/ui/deviceId');
const { emptyRoutine, startWorkout } = await import('../src/core/session');

const NOW = '2026-10-01T10:00:00.000Z';
const routine = emptyRoutine('r-new', '새 루틴', NOW);
const setOwner = async (id: string, owner: string) => { const w = (await db.workouts.get(id))!; await db.workouts.put({ ...w, ownerDeviceId: owner }); };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('startRoutine (진행 중 운동이 있을 때)', () => {
  beforeEach(() => { went.length = 0; });

  it('확인 창이 열린 사이 다른 기기로 넘어가면(화면 상태는 옛것): 끝내지 않고, 새 운동도 안 만들고, 운동 화면에 이유', async () => {
    await db.workouts.put({ ...startWorkout('old1', routine, NOW, []), ownerDeviceId: deviceId() });
    await load();
    const before = (await db.workouts.toArray()).length;
    const p = startRoutine(getState(), routine);
    await tick();
    await setOwner('old1', 'zzzzzz'); // 동기화가 들어옴 (화면 상태는 아직 load 전)
    answer(true);
    await p;
    expect((await db.workouts.get('old1'))!.endedAt).toBeUndefined();
    expect((await db.workouts.toArray()).length).toBe(before);
    expect(getFinishError()).toBe(FINISH_MSG['other-device']);
    expect(went).toEqual(['#/workout']);
  });

  it('확인하면 앞 운동을 끝내고(다시 읽어 확인) 새 운동 시작, 두 번 눌러도 하나만', async () => {
    await db.workouts.put({ ...startWorkout('old2', routine, NOW, []), ownerDeviceId: deviceId() });
    await load();
    const before = (await db.workouts.toArray()).length;
    const p1 = startRoutine(getState(), routine);
    const p2 = startRoutine(getState(), routine); // 두 번째는 무시
    await tick();
    answer(true);
    await Promise.all([p1, p2]);
    expect((await db.workouts.get('old2'))!.endedAt).toBeTruthy();
    expect((await db.workouts.toArray()).length).toBe(before + 1);
    expect(activeOf(getState())?.name).toBe('새 루틴');
    expect(went).toEqual(['#/workout']);
    expect(getFinishError()).toBeNull();
  });

  it('취소 = 운동 화면으로, 다른 확인 창으로 바뀜(null) = 아무것도 안 함 (검토 N6)', async () => {
    const cur = activeOf(getState())!;
    const p1 = startRoutine(getState(), routine); await tick(); answer(false); await p1;
    expect(went).toEqual(['#/workout']);
    const p2 = startRoutine(getState(), routine); await tick(); answer(null); await p2;
    expect(went).toEqual(['#/workout']);
    expect((await db.workouts.get(cur.id))!.endedAt).toBeUndefined();
  });
});
