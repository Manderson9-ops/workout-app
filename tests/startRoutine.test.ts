/**
 * 진행 중에 다른 루틴 시작 (D-038 검토 M1): 앱 안 확인 창이 열린 사이 동기화로 운동이 바뀌어도
 * 옛 상태로 덮어쓰지 않고, 앞 운동을 끝내지 못하면 새 운동을 만들지 않는다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

let answer: (v: boolean | null | 'alt') => void = () => undefined;
const asked: string[] = [];
// askChoice(빈 운동, D-072): true → 'ok', 'alt' → 'alt'
vi.mock('../src/ui/confirm', () => ({
  askConfirm: (o: { ok: string }) => new Promise<boolean | null>((r) => { asked.push(o.ok); answer = (v) => r(v === 'alt' ? true : v); }),
  askChoice: (o: { ok: string }) => new Promise<'ok' | 'alt' | false | null>((r) => { asked.push(o.ok); answer = (v) => r(v === true ? 'ok' : v); }),
}));
const went: string[] = [];
vi.mock('../src/ui/nav', () => ({ go: (h: string) => { went.push(h); } }));

const { startRoutine, getFinishError, FINISH_MSG } = await import('../src/ui/actions');
const { db, load, getState, activeOf } = await import('../src/ui/store');
const { deviceId } = await import('../src/ui/deviceId');
const { emptyRoutine, startWorkout } = await import('../src/core/session');

const NOW = '2026-10-01T10:00:00.000Z';
const routine = emptyRoutine('r-new', '새 루틴', NOW);
/** 완료 세트 1개가 있는 진행 중 운동 (끝내기 경로) */
const withDone = (id: string) => ({ ...startWorkout(id, routine, NOW, []), blocks: [{ kind: 'single' as const, restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', target: { sets: 1, reps: 10 }, sets: [{ warmup: false, done: true, doneAt: NOW, weight: 30, reps: 10 }] }] }], ownerDeviceId: deviceId() });
const setOwner = async (id: string, owner: string) => { const w = (await db.workouts.get(id))!; await db.workouts.put({ ...w, ownerDeviceId: owner }); };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('startRoutine (진행 중 운동이 있을 때)', () => {
  beforeEach(() => { went.length = 0; });

  it('확인 창이 열린 사이 다른 기기로 넘어가면(화면 상태는 옛것): 끝내지 않고, 새 운동도 안 만들고, 운동 화면에 이유', async () => {
    await db.workouts.put(withDone('old1'));
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
    await db.workouts.put(withDone('old2'));
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

describe('빈 운동 버리기 (D-072)', () => {
  const clearActive = async () => { for (const w of await db.workouts.toArray()) if (!w.endedAt) await db.workouts.put({ ...w, endedAt: NOW }); await load(); };
  beforeEach(async () => { went.length = 0; asked.length = 0; await clearActive(); });

  it('완료 세트 0개 → "버리고 새로 시작": 앞 운동은 지움 표시로 지워지고 기록에 안 남음, 새 운동 시작', async () => {
    await db.workouts.put({ ...startWorkout('empty1', routine, NOW, []), ownerDeviceId: deviceId() });
    await load();
    const p = startRoutine(getState(), routine); await tick(); answer(true); await p;
    expect(asked).toEqual(['버리고 새로 시작']);
    expect(await db.workouts.get('empty1')).toBeUndefined();
    expect(await db.tombs.get('workouts/empty1')).toBeTruthy();
    expect(activeOf(getState())?.id).not.toBe('empty1');
    expect(went).toEqual(['#/workout']);
  });

  it('"기록 남기고 새로 시작" → 끝난 기록으로 남김', async () => {
    await db.workouts.put({ ...startWorkout('empty2', routine, NOW, []), ownerDeviceId: deviceId() });
    await load();
    const p = startRoutine(getState(), routine); await tick(); answer('alt'); await p;
    expect((await db.workouts.get('empty2'))!.endedAt).toBeTruthy();
  });

  it('묻는 사이 세트가 생기면(동기화 등) 지우지 않고 끝냄', async () => {
    await db.workouts.put({ ...startWorkout('empty3', routine, NOW, []), ownerDeviceId: deviceId() });
    await load();
    const p = startRoutine(getState(), routine); await tick();
    await db.workouts.put(withDone('empty3')); await load();
    answer(true); await p;
    const w = await db.workouts.get('empty3');
    expect(w?.endedAt).toBeTruthy();
    expect(w?.blocks[0]!.items[0]!.sets[0]!.done).toBe(true);
  });

  it('discardActiveWorkout: 세트가 있거나 다른 기기 운동이면 지우지 않음', async () => {
    const { discardActiveWorkout } = await import('../src/ui/actions');
    await db.workouts.put(withDone('has1'));
    expect(await discardActiveWorkout('has1')).toMatchObject({ ok: false, reason: 'has-sets' });
    expect(await db.workouts.get('has1')).toBeTruthy();
    await db.workouts.put({ ...startWorkout('other1', routine, NOW, []), ownerDeviceId: 'zzzzzz' });
    expect(await discardActiveWorkout('other1')).toMatchObject({ ok: false, reason: 'other-device' });
    expect(await db.workouts.get('other1')).toBeTruthy();
  });
});

describe('끝난 시각 = 마지막 세트 + 3분 (D-065)', () => {
  it("finishActiveWorkout(id, 'last'): 저장된 기록의 마지막 세트 + 3분으로 끝냄", async () => {
    const { finishActiveWorkout } = await import('../src/ui/actions');
    const w = withDone('last1');
    await db.workouts.put({ ...w, startedAt: '2026-10-01T09:00:00.000Z' });
    await load();
    expect(await finishActiveWorkout('last1', 'last')).toEqual({ ok: true });
    expect((await db.workouts.get('last1'))!.endedAt).toBe('2026-10-01T10:03:00.000Z');
  });
});
