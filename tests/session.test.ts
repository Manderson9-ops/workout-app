import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { toChosung, matchesQuery } from '../src/core/search';
import {
  planToRoutine, startWorkout, steps, currentStep, restAfter, completeSet, undoSet, addSet, removeSet, skipItem, replaceItem,
  appendExercise, adjustTimer, clearTimer, timerRemaining, finishWorkout, progress, lastSets, updateSet, epley1RM,
  emptyRoutine, routineEstimate, mergeWithNext, splitBlock, applyRestToAll, stepSet, setItemMemo,
} from '../src/core/session';
import { patternFor } from '../src/core/exercises';
import type { Exercise } from '../src/core/types';
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

describe('P3 검토 반영', () => {
  const past = (): Workout => {
    const p: Workout = { ...startWorkout('w0', routine, '2026-09-29T10:00:00.000Z', []), endedAt: '2026-09-29T11:00:00.000Z' };
    p.blocks[0]!.items[0]!.sets = [{ weight: 60, reps: 8, warmup: false, done: true }, { weight: 60, reps: 8, warmup: false, done: true }];
    return p;
  };
  it('지난 기록이 있어도 앞 세트 무게를 바꾸면 뒤 자동 값이 따라감, 직접 고친 값은 유지', () => {
    const w = startWorkout('w1', routine, now, [past()]);
    expect(w.blocks[0]!.items[0]!.sets[1]).toMatchObject({ weight: 60, auto: true });
    let x = updateSet(w, { block: 0, item: 0, set: 0 }, { weight: 65 });
    expect(x.blocks[0]!.items[0]!.sets[0]!.auto).toBe(false);
    x = completeSet(x, { block: 0, item: 0, set: 0 }, t0);
    expect(x.blocks[0]!.items[0]!.sets[1]).toMatchObject({ weight: 65, auto: true });
    let y = updateSet(w, { block: 0, item: 0, set: 1 }, { weight: 55 });
    y = completeSet(updateSet(y, { block: 0, item: 0, set: 0 }, { weight: 70 }), { block: 0, item: 0, set: 0 }, t0);
    expect(y.blocks[0]!.items[0]!.sets[1]!.weight).toBe(55);
    expect(updateSet(w, { block: 0, item: 0, set: 0 }, { reps: 5 }).blocks[0]!.items[0]!.sets[0]!.auto).toBe(true);
  });
  it('교체 시 웜업 세트에는 작업 무게를 넣지 않고 작업 세트 순번으로 맞춤', () => {
    const w = addSet(startWorkout('w1', routine, now, []), 1, 0, true); // B: [W, 1, 2]
    const x = replaceItem(w, 1, 0, 'a', [past()]);
    expect(x.blocks[1]!.items[0]!.sets.map((s) => [s.warmup, s.weight])).toEqual([[true, undefined], [false, 60], [false, 60]]);
    expect(x.blocks[1]!.items[0]!.sets[0]!.reps).toBe(10);
  });
  it('휴식이 끝난 뒤 +15는 지금부터 15초', () => {
    const w = completeSet(startWorkout('w1', routine, now, []), { block: 0, item: 0, set: 0 }, t0);
    const later = t0 + 200000;
    expect(timerRemaining(adjustTimer(w, 15, later).timer, later)).toBe(15);
  });
  it('블록 사이 휴식은 시작할 때 설정값, 예정 대비 차이', () => {
    const w = startWorkout('w1', routine, now, [], { betweenSec: 45 });
    expect(restAfter(w, { block: 0, item: 0, set: 1 })).toMatchObject({ sec: 45, kind: 'between' });
    expect(w.plannedSec).toBe(1800);
    const p = progress(w, t0 + 600000, () => 40);
    expect(p.deltaSec).toBe(p.elapsedSec + p.remainingSec - 1800);
    expect(progress({ ...w, plannedSec: undefined }, t0, () => 40).deltaSec).toBeUndefined();
  });
  it('루틴 편집: 빈 루틴, 묶기·풀기, 휴식 한 번에, 예상 시간', () => {
    const ex = (id: string, mechanics: 'compound' | 'isolation', unilateral = false): Exercise => ({ id, name_ko: id, family: id, part: '등', muscles: ['m'], pattern: 'H_PULL', mechanics, equipment: ['cable'], unilateral });
    const byId = new Map([['a', ex('a', 'compound')], ['b', ex('b', 'isolation')], ['c', ex('c', 'isolation')], ['p', { ...ex('p', 'isolation'), measure: 'time' as const, default_seconds: 45 }]]);
    expect(emptyRoutine('r', '새 루틴', now)).toMatchObject({ blocks: [], name: '새 루틴' });
    // a: 2×(20+8×3)=88 + 150 = 238 / 묶음 b(2세트×10회)+c(3세트×12회): 2×50 + 3×56 + 2×10 + 2×120 = 528 / p: 2×65 + 90 = 220 / 사이 2×90
    expect(routineEstimate(routine, byId)).toBe(238 + 528 + 220 + 180);
    expect(routineEstimate({ ...routine, blocks: [...routine.blocks, { kind: 'single', items: [{ exerciseId: 'ghost', sets: 3, reps: 8 }], restSec: 90, roundRestSec: 120, transitionSec: 10 }] }, byId)).toBe(238 + 528 + 220 + 180);
    expect(routineEstimate(emptyRoutine('r', 'x', now), byId)).toBe(0);
    const m = mergeWithNext(routine, 0, 'superset');
    expect(m.blocks).toHaveLength(2);
    expect(m.blocks[0]).toMatchObject({ kind: 'superset', roundRestSec: 120 });
    expect(m.blocks[0]!.items.map((i) => i.exerciseId)).toEqual(['a', 'b', 'c']);
    expect(mergeWithNext(routine, 2, 'superset')).toBe(routine);
    expect(mergeWithNext(routine, 1, 'compound').blocks[1]!.roundRestSec).toBe(120);
    const sp = splitBlock(routine, 1, (id) => (id === 'b' ? 90 : 60));
    expect(sp.blocks.map((b) => [b.kind, b.restSec])).toEqual([['single', 150], ['single', 90], ['single', 60], ['single', 90]]);
    expect(splitBlock(routine, 0, () => 1)).toBe(routine);
    expect(applyRestToAll(routine, 75, 100).blocks.every((b) => b.restSec === 75 && b.roundRestSec === 100)).toBe(true);
  });
  it('−/+는 저장된 최신 값에 더함, 0 아래 금지, 무게를 바꾸면 자동 값 아님', () => {
    const w = updateSet(startWorkout('w1', routine, now, []), { block: 0, item: 0, set: 0 }, { weight: 40 });
    const x = stepSet(stepSet(w, { block: 0, item: 0, set: 0 }, 'weight', 2.5), { block: 0, item: 0, set: 0 }, 'weight', 2.5);
    expect(x.blocks[0]!.items[0]!.sets[0]).toMatchObject({ weight: 45, auto: false });
    expect(stepSet(w, { block: 0, item: 0, set: 1 }, 'reps', -20).blocks[0]!.items[0]!.sets[1]!.reps).toBe(0);
    expect(stepSet(w, { block: 2, item: 0, set: 0 }, 'seconds', 5).blocks[2]!.items[0]!.sets[0]!.seconds).toBe(50);
    expect(stepSet(updateSet(w, { block: 0, item: 0, set: 1 }, { reps: 7.6 }), { block: 0, item: 0, set: 1 }, 'reps', 1).blocks[0]!.items[0]!.sets[1]!.reps).toBe(9); // 횟수는 정수
    expect(setItemMemo(w, 0, 0, '그립 넓게').blocks[0]!.items[0]!.memo).toBe('그립 넓게');
  });
  it('직접 추가 운동의 동작 유형', () => {
    expect(patternFor('가슴', 'compound')).toBe('H_PUSH');
    expect(patternFor('하체', 'compound')).toBe('SQUAT');
    expect(patternFor('등', 'compound')).toBe('H_PULL');
    expect(patternFor('코어', 'isolation')).toBe('CORE');
    expect(patternFor('이두', 'isolation')).toBe('ISOLATION');
  });
  it('저장된 예전 설정에 휴식 기본값이 없어도 채워짐', async () => {
    const db = new WorkoutDB(`test-${Math.random()}`);
    await db.settings.put({ key: 'main', level: '초보' } as never);
    const st = await getSettings(db);
    expect(st.level).toBe('초보');
    expect(st.rest).toEqual(DEFAULT_SETTINGS.rest);
    db.close();
  });
});