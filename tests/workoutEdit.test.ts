import { describe, it, expect } from 'vitest';
import { planToRoutine, startWorkout, finishWorkout } from '../src/core/session';
import type { Workout } from '../src/core/session';
import { toLocalInput, fromLocalInput, durationMin, setTimes, patchSet, appendDoneSet, deleteSet, deleteItem, editProblem, finalizeEdit, sameWorkout, withKeys, keyOf, patchSetByKey, moveStart } from '../src/core/workoutEdit';
import { makeBackup, parseBackup } from '../src/core/backup';
import { summarize } from '../src/core/stats';

const item = (exerciseId: string) => ({ exerciseId, name: exerciseId, part: '등' as const, sets: 2, reps: 8, grade: 'S' as const, gradeSource: 'VIDEO' as const, estimated: false, substituted: false, locked: false, why: '', rank: 0 });
const routine = planToRoutine('r1', '등', '2026-09-30T10:00:00.000Z', [
  { kind: 'single', items: [item('a')], restSec: 120, timeSec: 0 },
  { kind: 'superset', items: [item('b'), item('c')], restSec: 90, timeSec: 0 },
], 1800);
const done = (): Workout => {
  const w = startWorkout('w1', routine, '2026-09-30T10:00:00.000Z', []);
  w.blocks[0]!.items[0]!.sets = [{ warmup: false, done: true, weight: 60, reps: 8, doneAt: '2026-09-30T10:05:00.000Z' }, { warmup: false, done: true, weight: 60, reps: 7, doneAt: '2026-09-30T10:08:00.000Z', auto: true }];
  return { ...finishWorkout(w, '2026-09-30T10:40:00.000Z'), ownerDeviceId: 'phone', ownerSeq: 1 };
};
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

describe('끝낸 운동 고치기 (D-035)', () => {
  it('날짜·시각 입력 변환은 왕복하고, 없는 날짜는 거절', () => {
    const iso = fromLocalInput('2026-09-30T19:05')!;
    expect(toLocalInput(iso)).toBe('2026-09-30T19:05');
    expect(fromLocalInput('2026-02-31T10:00')).toBeUndefined();
    expect(fromLocalInput('abc')).toBeUndefined();
  });
  it('시작·운동 시간 바꾸기: 끝 시각이 따라 바뀜', () => {
    const w = setTimes(done(), '2026-09-29T09:00:00.000Z', 55);
    expect(w.endedAt).toBe('2026-09-29T09:55:00.000Z');
    expect(durationMin(w)).toBe(55);
  });
  it('세트 값 고치기·추가·지우기, 고친 세트는 자동 표시(auto) 해제', () => {
    let w = patchSet(done(), 0, 0, 1, { weight: 62.5, rir: 1 });
    expect(w.blocks[0]!.items[0]!.sets[1]).toMatchObject({ weight: 62.5, rir: 1, auto: false });
    w = appendDoneSet(w, 0, 0);
    expect(w.blocks[0]!.items[0]!.sets[2]).toMatchObject({ weight: 62.5, reps: 7, done: true, warmup: false });
    w = deleteSet(w, 0, 0, 0);
    expect(w.blocks[0]!.items[0]!.sets.map((s) => s.weight)).toEqual([62.5, 62.5]);
  });
  it('운동 지우기: 묶음에 하나 남으면 단일, 블록이 비면 블록째', () => {
    let w = deleteItem(done(), 1, 0);
    expect(w.blocks[1]!.kind).toBe('single');
    expect(w.blocks[1]!.items.map((i) => i.exerciseId)).toEqual(['c']);
    w = deleteItem(w, 1, 0);
    expect(w.blocks).toHaveLength(1);
  });
  it('검사: 이름·시간·미래·빈 운동·세트 값 범위', () => {
    const w = done();
    expect(editProblem(w, NOW)).toBeNull();
    expect(editProblem({ ...w, name: '  ' }, NOW)).toMatch(/이름/);
    expect(editProblem({ ...w, endedAt: w.startedAt }, NOW)).toMatch(/1 이상/);
    expect(editProblem(setTimes(w, w.startedAt, 13 * 60), NOW)).toMatch(/12시간/);
    expect(editProblem(setTimes(w, '2026-10-02T10:00:00.000Z', 30), NOW)).toMatch(/미래/);
    expect(editProblem({ ...w, blocks: [] }, NOW)).toMatch(/삭제/);
    expect(editProblem(patchSet(w, 0, 0, 0, { weight: 1200 }), NOW, () => '랫풀다운')).toMatch(/1번째 운동\(랫풀다운\) 1번째 세트: 무게/);
    expect(editProblem(patchSet(w, 0, 0, 0, { reps: 7.5 }), NOW)).toMatch(/횟수/);
    expect(editProblem(patchSet(w, 0, 0, 0, { rir: 11 }), NOW)).toMatch(/RIR/);
  });
  it('정리: 완료 세트에 겹치지 않는 끝낸 시각, 완료 끈 세트는 시각 없음, 건너뜀 해제, 고친 시각, 주인 그대로, 백업 검사 통과', () => {
    let w = patchSet(done(), 0, 0, 0, { done: false });
    w = patchSet(w, 1, 0, 0, { done: true, weight: 20, reps: 10 });
    w = patchSet(w, 1, 0, 1, { done: true, weight: 20, reps: 10 });
    w = { ...w, blocks: w.blocks.map((b, bi) => (bi === 1 ? { ...b, items: b.items.map((i, ii) => (ii === 0 ? { ...i, skipped: true } : i)) } : b)), memo: '  좋았음 ', name: ' 등 (고침) ' };
    const out = finalizeEdit(w, '2026-09-30T12:00:00.000Z');
    const s0 = out.blocks[0]!.items[0]!.sets;
    expect(s0[0]!.doneAt).toBeUndefined();
    expect(s0[1]!.doneAt).toBe('2026-09-30T10:08:00.000Z');
    expect('auto' in s0[1]!).toBe(false);
    const ats = out.blocks[1]!.items[0]!.sets.map((s) => s.doneAt);
    expect(new Set(ats).size).toBe(2);
    expect(out.blocks[1]!.items[0]!.skipped).toBe(false);
    expect(out).toMatchObject({ name: '등 (고침)', memo: '좋았음', editedAt: '2026-09-30T12:00:00.000Z', ownerDeviceId: 'phone', ownerSeq: 1, timer: null });
    expect(parseBackup(JSON.stringify(makeBackup({ routines: [], workouts: [out], meta: [], custom: [], settings: [], bodyweight: [], diag: [], feedback: [] }, '0.7.0', '2026-09-30T12:00:00.000Z'))).ok).toBe(true);
    expect(parseBackup(JSON.stringify(makeBackup({ routines: [], workouts: [{ ...out, editedAt: '어제' }], meta: [], custom: [], settings: [], bodyweight: [], diag: [], feedback: [] }, '0.7.0', '2026-09-30T12:00:00.000Z'))).ok).toBe(false);
  });
  it('고친 값이 통계(작업 세트·볼륨·시간)에 반영', () => {
    const before = summarize(done(), new Map(), []);
    const after = summarize(setTimes(patchSet(done(), 0, 0, 0, { weight: 100 }), '2026-09-30T10:00:00.000Z', 60), new Map(), []);
    expect(after.durationSec).toBe(3600);
    expect(after.volume).toBeGreaterThan(before.volume);
    expect(after.workSets).toBe(before.workSets);
  });
  it('같은지 비교는 동기화 표시(_s)를 무시', () => {
    const a = done();
    expect(sameWorkout(a, { ...a, _s: { h: 'x' } } as unknown as Workout)).toBe(true);
    expect(sameWorkout(a, patchSet(a, 0, 0, 0, { weight: 61 }))).toBe(false);
  });
  it('편집 열쇠: 세트를 지운 뒤 늦게 온 입력은 원래 세트로만 (다른 세트에 안 들어감), 저장·비교 때 열쇠는 사라짐', () => {
    const w = withKeys(done());
    const k0 = keyOf(w.blocks[0]!.items[0]!.sets[0]!), k1 = keyOf(w.blocks[0]!.items[0]!.sets[1]!);
    expect(k0 && k1 && k0 !== k1).toBeTruthy();
    const afterDel = deleteSet(w, 0, 0, 0);
    const late = patchSetByKey(afterDel, k0, { weight: 409 });
    expect(late.blocks[0]!.items[0]!.sets.map((s) => s.weight)).toEqual([60]);
    expect(patchSetByKey(afterDel, k1, { weight: 65 }).blocks[0]!.items[0]!.sets[0]!.weight).toBe(65);
    expect(sameWorkout(w, done())).toBe(true);
    const out = finalizeEdit(appendDoneSet(w, 0, 0), '2026-09-30T12:00:00.000Z');
    expect(JSON.stringify(out)).not.toContain('_k');
  });
  it('시작을 옮기면 세트의 끝낸 시각도 같은 만큼, 운동 시간은 그대로', () => {
    const w = setTimes(done(), '2026-09-29T10:00:00.000Z', durationMin(done()));
    expect(w.blocks[0]!.items[0]!.sets[0]!.doneAt).toBe('2026-09-29T10:05:00.000Z');
    expect(durationMin(w)).toBe(40);
  });
  it('시작만 옮기면 길이가 초 단위까지 그대로 (20초 기록이 0분이 되지 않음)', () => {
    const short = { ...done(), endedAt: '2026-09-30T10:00:20.000Z' };
    const m = moveStart(short, '2026-09-29T08:00:00.000Z');
    expect(m.endedAt).toBe('2026-09-29T08:00:20.000Z');
  });
  it('원래 1분 미만 기록은 시간을 안 건드리면 이름만 고쳐도 저장 가능', () => {
    const short = { ...done(), endedAt: '2026-09-30T10:00:20.000Z' };
    expect(editProblem({ ...short, name: '새 이름' }, NOW)).toMatch(/1 이상/);
    expect(editProblem({ ...short, name: '새 이름' }, NOW, undefined, { allowShort: true })).toBeNull();
  });
  it('시간 운동의 세트 추가는 초로 이어받음', () => {
    const w = done();
    w.blocks[0]!.items[0]!.target = { sets: 2, reps: 0, seconds: 45 };
    w.blocks[0]!.items[0]!.sets = [{ warmup: false, done: true, seconds: 50 }];
    const s = appendDoneSet(w, 0, 0).blocks[0]!.items[0]!.sets[1]!;
    expect(s).toMatchObject({ seconds: 50, done: true });
    expect(s.reps).toBeUndefined();
  });
});
