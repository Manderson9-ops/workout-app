import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { toChosung, matchesQuery } from '../src/core/search';
import {
  planToRoutine, startWorkout, steps, currentStep, restAfter, completeSet, undoSet, addSet, removeSet, skipItem, replaceItem,
  appendExercise, adjustTimer, clearTimer, timerRemaining, finishWorkout, progress, lastSets, updateSet, epley1RM,
} from '../src/core/session';
import type { Routine, Workout } from '../src/core/session';
import { WorkoutDB, getSettings, activeWorkout, finishedWorkouts, newId, DEFAULT_SETTINGS, requestPersist } from '../src/db/db';

describe('검색 (초성 포함)', () => {
  it('초성 변환', () => {
    expect(toChosung('랫풀다운')).toBe('ㄹㅍㄷㅇ');
    expect(toChosung('EZ바 컬')).toBe('ezㅂㅋ');
  });
  it('부분 일치, 공백 무시, 초성, 별칭', () => {
    expect(matchesQuery('', ['아무거나'])).toBe(true);
    expect(matchesQuery('풀다운', ['랫풀다운'])).toBe(true);
    expect(matchesQuery('랫 풀', ['랫풀다운'])).toBe(true);
    expect(matchesQuery('ㄹㅍㄷ', ['랫풀다운'])).toBe(true);
    expect(matchesQuery('ㅋㅋ', ['바벨 벤치프레스'])).toBe(false);
    expect(matchesQuery('ㅂㅂㅂㅊ', ['바벨 벤치프레스'])).toBe(true);
    expect(matchesQuery('사레레', ['덤벨 사이드 레터럴 레이즈', '사레레'])).toBe(true);
    expect(matchesQuery('jm', ['스미스머신 JM프레스'])).toBe(true);
    expect(matchesQuery('스쿼트', ['랫풀다운'])).toBe(false);
  });
});

const now = '2026-09-30T10:00:00.000Z';
const t0 = Date.parse(now);
const routine: Routine = planToRoutine('r1', '등+삼두', now, [
  { kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 2, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 150, timeSec: 0 },
  { kind: 'superset', items: [
    { exerciseId: 'b', name: 'B', part: '등', sets: 2, reps: 10, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 1 },
    { exerciseId: 'c', name: 'C', part: '삼두', sets: 3, reps: 12, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 },
  ], roundRestSec: 120, transitionSec: 10, timeSec: 0 },
  { kind: 'single', items: [{ exerciseId: 'p', name: 'P', part: '코어', sets: 2, reps: 0, seconds: 45, grade: 'B', gradeSource: 'APP_DEFAULT', estimated: true, substituted: false, locked: false, why: '', rank: 0 }], timeSec: 0 },
], 1800);

describe('운동 세션', () => {
  it('루틴 → 운동 시작: 지난 기록으로 무게·횟수 미리 채움', () => {
    const past: Workout = { ...startWorkout('w0', routine, '2026-09-29T10:00:00.000Z', []), endedAt: '2026-09-29T11:00:00.000Z' };
    past.blocks[0]!.items[0]!.sets = [{ weight: 60, reps: 8, warmup: false, done: true }, { weight: 62.5, reps: 7, warmup: false, done: true }];
    const w = startWorkout('w1', routine, now, [past]);
    expect(w.blocks[0]!.items[0]!.sets.map((s) => [s.weight, s.reps])).toEqual([[60, 8], [62.5, 7]]);
    expect(w.blocks[1]!.items[0]!.sets[0]).toEqual({ warmup: false, done: false, reps: 10 });
    expect(w.blocks[2]!.items[0]!.sets[0]).toEqual({ warmup: false, done: false, seconds: 45 });
    expect(lastSets([past], 'zzz')).toEqual([]);
    expect(routine.blocks[2]!.restSec).toBe(90);
  });
  const w = startWorkout('w1', routine, now, []);
  it('순서: 단일은 세트 순, 묶음은 라운드마다 번갈아 (세트 수가 달라도)', () => {
    expect(steps(w).map((s) => `${s.block}${s.item}${s.set}`)).toEqual(['000', '001', '100', '110', '101', '111', '112', '200', '201']);
  });
  it('휴식: 세트 간 → 다음 운동 → 묶음 전환 → 라운드 후 → 마지막은 없음', () => {
    expect(restAfter(w, { block: 0, item: 0, set: 0 })).toMatchObject({ sec: 150, kind: 'set' });
    expect(restAfter(w, { block: 0, item: 0, set: 1 })).toMatchObject({ sec: 60, kind: 'between' });
    expect(restAfter(w, { block: 1, item: 0, set: 0 })).toMatchObject({ sec: 10, kind: 'transition' });
    expect(restAfter(w, { block: 1, item: 1, set: 0 })).toMatchObject({ sec: 120, kind: 'round' });
    expect(restAfter(w, { block: 1, item: 1, set: 1 })).toMatchObject({ sec: 120, kind: 'round' }); // 다음은 C 3세트째 (B 없음)
    expect(restAfter(w, { block: 2, item: 0, set: 1 })).toBeNull();
  });
  it('세트 완료 → 타이머 자동 시작, 조정, 되돌리기', () => {
    const s0 = currentStep(w)!;
    let x = completeSet(w, s0, t0);
    expect(x.timer).toMatchObject({ kind: 'set', endsAt: t0 + 150000 });
    expect(timerRemaining(x.timer, t0 + 10000)).toBe(140);
    x = adjustTimer(x, 15, t0); expect(timerRemaining(x.timer, t0)).toBe(165);
    x = adjustTimer(x, -500, t0); expect(timerRemaining(x.timer, t0)).toBe(0);
    expect(adjustTimer(clearTimer(x), 15, t0).timer).toBeNull();
    expect(timerRemaining(null, t0)).toBe(0);
    expect(currentStep(x)).toEqual({ block: 0, item: 0, set: 1 });
    const u = undoSet(x, s0);
    expect(u.blocks[0]!.items[0]!.sets[0]!.done).toBe(false);
    expect(u.timer).toBeNull();
    const last = completeSet(w, { block: 2, item: 0, set: 1 }, t0);
    expect(last.timer).toBeNull();
  });
  it('세트 완료 시 뒤 세트의 빈 무게를 채움 (웜업·이미 입력한 값은 그대로)', () => {
    let x = updateSet(w, { block: 0, item: 0, set: 0 }, { weight: 70 });
    x = completeSet(x, { block: 0, item: 0, set: 0 }, t0);
    expect(x.blocks[0]!.items[0]!.sets[1]!.weight).toBe(70);
    let y = updateSet(w, { block: 0, item: 0, set: 1 }, { weight: 80 });
    y = completeSet(updateSet(y, { block: 0, item: 0, set: 0 }, { weight: 70 }), { block: 0, item: 0, set: 0 }, t0);
    expect(y.blocks[0]!.items[0]!.sets[1]!.weight).toBe(80);
    const wu = addSet(updateSet(w, { block: 0, item: 0, set: 0 }, { weight: 60 }), 0, 0, true);
    const z = completeSet(updateSet(wu, { block: 0, item: 0, set: 0 }, { weight: 20 }), { block: 0, item: 0, set: 0 }, t0);
    expect(z.blocks[0]!.items[0]!.sets[2]!.weight).toBeUndefined();
  });
  it('세트 추가·삭제·웜업, 값 수정', () => {
    let x = updateSet(w, { block: 0, item: 0, set: 0 }, { weight: 80, reps: 6, rir: 1 });
    x = addSet(x, 0, 0, true);
    expect(x.blocks[0]!.items[0]!.sets[0]).toMatchObject({ warmup: true, weight: 40, reps: 10 });
    x = addSet(x, 0, 0);
    expect(x.blocks[0]!.items[0]!.sets).toHaveLength(4);
    expect(steps(x).filter((s) => s.block === 0)).toHaveLength(4);
    expect(restAfter(x, { block: 0, item: 0, set: 0 })).toMatchObject({ kind: 'warmup', sec: 60 });
    x = removeSet(x, { block: 0, item: 0, set: 3 });
    expect(x.blocks[0]!.items[0]!.sets).toHaveLength(3);
    const one = removeSet(removeSet(removeSet(x, { block: 0, item: 0, set: 0 }), { block: 0, item: 0, set: 0 }), { block: 0, item: 0, set: 0 });
    expect(one.blocks[0]!.items[0]!.sets).toHaveLength(1);
    const sec = addSet(w, 2, 0);
    expect(sec.blocks[2]!.items[0]!.sets[2]).toMatchObject({ seconds: 45 });
    const empty = addSet({ ...w, blocks: [{ ...w.blocks[0]!, items: [{ ...w.blocks[0]!.items[0]!, sets: [] }] }] }, 0, 0);
    expect(empty.blocks[0]!.items[0]!.sets[0]).toMatchObject({ reps: 8 });
    // 묶음 블록의 웜업은 묶음 시작 전에
    const gw = addSet(w, 1, 1, true);
    expect(steps(gw).filter((s) => s.block === 1)[0]).toEqual({ block: 1, item: 1, set: 0 });
    expect(restAfter(gw, { block: 1, item: 1, set: 0 })).toMatchObject({ kind: 'warmup' });
    expect(restAfter(gw, { block: 1, item: 0, set: 0 })).toMatchObject({ kind: 'transition' });
  });
  it('운동 건너뛰기, 교체, 추가', () => {
    const past: Workout = { ...startWorkout('w0', routine, now, []), endedAt: now };
    past.blocks[0]!.items[0]!.sets = [{ weight: 50, reps: 9, warmup: false, done: true }];
    let x = skipItem(w, 1, 0);
    expect(steps(x).filter((s) => s.block === 1).map((s) => s.item)).toEqual([1, 1, 1]);
    expect(restAfter(x, { block: 1, item: 1, set: 0 })).toMatchObject({ kind: 'set', sec: 90 });
    x = skipItem(x, 1, 0, false);
    x = replaceItem(x, 1, 0, 'a', [past]);
    expect(x.blocks[1]!.items[0]).toMatchObject({ exerciseId: 'a', skipped: false });
    expect(x.blocks[1]!.items[0]!.sets[0]).toMatchObject({ weight: 50, reps: 9 });
    const done = completeSet(w, { block: 1, item: 0, set: 0 }, t0);
    const rep = replaceItem(done, 1, 0, 'zz', []);
    expect(rep.blocks[1]!.items[0]!.sets[0]!.done).toBe(true);
    expect(replaceItem(w, 2, 0, 'q', []).blocks[2]!.items[0]!.sets[0]).toMatchObject({ seconds: 45 });
    x = appendExercise(w, 'a', 3, 10, 90, [past]);
    expect(x.blocks).toHaveLength(4);
    expect(x.blocks[3]!.items[0]!.sets.map((s) => s.weight)).toEqual([50, undefined, undefined]);
    expect(appendExercise(w, 'p', 2, 0, 60, [], 30).blocks[3]!.items[0]!.sets[0]).toMatchObject({ seconds: 30 });
  });
  it('진행 상황과 남은 예상 시간, 종료, 1RM', () => {
    const per = () => 40;
    const p0 = progress(w, t0 + 60000, per);
    expect(p0).toMatchObject({ doneSets: 0, totalSets: 9, elapsedSec: 60 });
    // 세트 9개 × 40초 + 휴식: 150 + 60 + 10 + 120 + 10 + 120 + 60 + 90 = 620
    expect(p0.remainingSec).toBe(9 * 40 + 620);
    const x = completeSet(w, currentStep(w)!, t0);
    expect(progress(x, t0, per)).toMatchObject({ doneSets: 1, remainingSec: 8 * 40 + 470 + 150 });
    expect(finishWorkout(x, now)).toMatchObject({ endedAt: now, timer: null });
    expect(epley1RM(100, 5)).toBe(116.7);
    expect(epley1RM(100, 1)).toBe(100);
  });
});

describe('저장소 (IndexedDB, 스키마 v1)', () => {
  it('설정 기본값, 진행 중 운동, 끝난 운동 목록', async () => {
    const db = new WorkoutDB(`test-${Math.random()}`);
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await db.settings.put({ ...DEFAULT_SETTINGS, level: '상급' });
    expect((await getSettings(db)).level).toBe('상급');
    const a = startWorkout(newId('w'), routine, '2026-09-30T09:00:00.000Z', []);
    const b = startWorkout(newId('w'), routine, '2026-09-30T10:00:00.000Z', []);
    const c = { ...startWorkout(newId('w'), routine, '2026-09-29T10:00:00.000Z', []), endedAt: '2026-09-29T11:00:00.000Z' };
    const d = { ...startWorkout(newId('w'), routine, '2026-09-28T10:00:00.000Z', []), endedAt: '2026-09-28T11:00:00.000Z' };
    await db.workouts.bulkPut([a, b, c, d]);
    expect((await activeWorkout(db))!.id).toBe(b.id);
    expect((await finishedWorkouts(db)).map((w) => w.id)).toEqual([c.id, d.id]);
    await db.routines.put(routine);
    expect((await db.routines.get('r1'))!.blocks).toHaveLength(3);
    db.close();
  });
  it('저장공간 유지 요청은 지원 안 되면 false', async () => {
    expect(typeof (await requestPersist())).toBe('boolean');
  });
});
