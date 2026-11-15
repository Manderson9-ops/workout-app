import { describe, it, expect } from 'vitest';
import { replaceItem, swapItem, swapSplitsGroup, swapTarget, steps, currentStep, roundOf, roundSteps, completeSet } from '../src/core/session';
import type { Workout, SetLog, WorkoutBlock } from '../src/core/session';

const S = (o: Partial<SetLog> = {}): SetLog => ({ warmup: false, done: false, reps: 10, weight: 40, ...o });
const D = (o: Partial<SetLog> = {}): SetLog => S({ done: true, doneAt: '2026-11-16T00:00:00.000Z', ...o });
const blk = (kind: WorkoutBlock['kind'], items: { id: string; sets: SetLog[] }[], restSec = 90): WorkoutBlock => ({
  kind, restSec, roundRestSec: 120, transitionSec: 10,
  items: items.map((x) => ({ exerciseId: x.id, target: { sets: x.sets.length, reps: 10 }, sets: x.sets })),
});
const wk = (blocks: WorkoutBlock[]): Workout => ({ id: 'w', name: 'w', startedAt: '2026-11-16T00:00:00.000Z', timer: null, blocks });
const ids = (w: Workout) => w.blocks.flatMap((b) => b.items.map((i) => i.exerciseId));
const past: Workout = { ...wk([blk('single', [{ id: 'new', sets: [D({ weight: 55, reps: 9 }), D({ weight: 57.5, reps: 8 })] }])]), id: 'p', endedAt: '2026-11-15T01:00:00.000Z' };

describe('D-080 운동 중 바로 교체 (swapItem)', () => {
  it('완료 세트 0개: replaceItem 과 같음', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [S(), S(), S()] }]), blk('single', [{ id: 'z', sets: [S()] }])]);
    expect(swapItem(w, 0, 0, 'new', [past])).toEqual(replaceItem(w, 0, 0, 'new', [past]));
    expect(swapItem(w, 0, 0, 'new', [past]).blocks).toHaveLength(2);
  });
  it('단일 + 완료 2개 중 4세트: 원래 2세트(완료만) + 바로 다음에 새 블록 2세트(같은 휴식, 지난 무게)', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D(), D(), S(), S()] }], 75), blk('single', [{ id: 'z', sets: [S()] }])]);
    const r = swapItem(w, 0, 0, 'new', [past]);
    expect(ids(r)).toEqual(['old', 'new', 'z']);
    expect(r.blocks[0]!.items[0]!.sets).toHaveLength(2);
    expect(r.blocks[0]!.items[0]!.sets.every((s) => s.done)).toBe(true);
    expect(r.blocks[0]!.items[0]!.target.sets).toBe(2);
    const nb = r.blocks[1]!;
    expect(nb.kind).toBe('single');
    expect(nb.restSec).toBe(75);
    expect(nb.items[0]!.sets).toHaveLength(2);
    expect(nb.items[0]!.target.sets).toBe(2);
    expect(nb.items[0]!.sets.map((s) => [s.done, s.weight])).toEqual([[false, 55], [false, 57.5]]);
    expect(currentStep(r)).toEqual({ block: 1, item: 0, set: 0 });
    expect(w.blocks[0]!.items[0]!.sets).toHaveLength(4); // 원본은 그대로
  });
  it('묶음 + 완료: 묶음은 완료 세트만 남고 새 운동은 묶음 다음 단일 블록(묶음 휴식), 라운드가 어긋나지 않음', () => {
    const w = wk([blk('superset', [{ id: 'a', sets: [D(), S(), S()] }, { id: 'b', sets: [D(), S(), S()] }], 60), blk('single', [{ id: 'z', sets: [S()] }])]);
    expect(swapSplitsGroup(w, 0, 0)).toBe(true);
    const r = swapItem(w, 0, 0, 'new', [past]);
    expect(ids(r)).toEqual(['a', 'b', 'new', 'z']);
    expect(r.blocks[0]!.kind).toBe('superset');
    expect(r.blocks[0]!.items[0]!.sets).toHaveLength(1);
    expect(r.blocks[0]!.items[1]!.sets).toHaveLength(3);
    expect(r.blocks[1]!.kind).toBe('single');
    expect(r.blocks[1]!.restSec).toBe(60);
    expect(r.blocks[1]!.items[0]!.sets).toHaveLength(2);
    // 라운드: A 는 1라운드만, B 의 2·3라운드는 A 없이 이어짐 (묶음 안 운동 순번과 어긋나지 않음)
    expect(steps(r).filter((s) => s.block === 0).map((s) => `${s.item}:${s.set}`)).toEqual(['0:0', '1:0', '1:1', '1:2']);
    const cur = currentStep(r)!;
    expect(cur).toEqual({ block: 0, item: 1, set: 1 });
    expect(roundOf(r, cur)).toBe(2);
    expect(roundSteps(r, cur).map((s) => s.item)).toEqual([1]);
    // 끝까지 진행해도 모든 단계가 한 번씩
    let cw = r;
    for (let n = 0; n < 20 && currentStep(cw); n++) cw = completeSet(cw, currentStep(cw)!, 1_000 * n);
    expect(currentStep(cw)).toBeUndefined();
  });
  it('묶음에서 완료 세트가 없으면 제자리 교체(묶음 유지)', () => {
    const w = wk([blk('superset', [{ id: 'a', sets: [S(), S()] }, { id: 'b', sets: [S(), S()] }])]);
    expect(swapSplitsGroup(w, 0, 0)).toBe(false);
    expect(ids(swapItem(w, 0, 0, 'new', []))).toEqual(['new', 'b']);
  });
  it('같은 운동 두 번 금지: 이미 있는 id 로는 바꾸지 않음', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D(), S()] }]), blk('single', [{ id: 'z', sets: [S()] }])]);
    expect(swapItem(w, 0, 0, 'z', [])).toBe(w);
    expect(swapItem(w, 0, 0, 'old', [])).toBe(w);
    const r = swapItem(w, 0, 0, 'new', []);
    expect(new Set(ids(r)).size).toBe(ids(r).length);
  });
  it('남은 작업 세트가 없어도 새 운동은 1세트', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D(), D()] }])]);
    const r = swapItem(w, 0, 0, 'new', []);
    expect(r.blocks[1]!.items[0]!.sets).toHaveLength(1);
  });
  it('웜업만 끝낸 운동은 갈라지 않고 통째로 교체', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D({ warmup: true }), S(), S()] }]), blk('single', [{ id: 'z', sets: [S()] }])]);
    const r = swapItem(w, 0, 0, 'new', []);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]!.items[0]!.exerciseId).toBe('new');
    expect(r.blocks[0]!.items[0]!.swappedFrom).toBeUndefined();
    expect(r.blocks[0]!.items[0]!.sets[0]!.done).toBe(true); // 끝낸 웜업은 남음
    expect(swapSplitsGroup(wk([blk('superset', [{ id: 'a', sets: [D({ warmup: true }), S()] }, { id: 'b', sets: [S(), S()] }])]), 0, 0)).toBe(false);
  });
  it('건너뛴 운동에 완료 세트가 있으면 남긴 쪽은 skipped 해제, target.sets = 완료 작업 세트 수, 새 운동은 swappedFrom', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D(), S(), S()] }])]);
    w.blocks[0]!.items[0]!.skipped = true;
    const r = swapItem(w, 0, 0, 'new', []);
    expect(r.blocks[0]!.items[0]!.skipped).toBe(false);
    expect(r.blocks[0]!.items[0]!.target.sets).toBe(1);
    expect(r.blocks[1]!.items[0]!.swappedFrom).toBe('old');
    expect(r.blocks[0]!.items[0]!.swappedFrom).toBeUndefined();
  });
});

describe('D-080 검토 F2: 횟수·시간 운동 목표 (swapTarget)', () => {
  const timeEx = { measure: 'time', default_seconds: 45, mechanics: 'isolation' } as never;
  const timeNoDef = { measure: 'time', mechanics: 'isolation' } as never;
  const repsEx = { measure: 'reps', mechanics: 'compound', default_reps: [12, 14] } as never; // 13회
  const timed = () => { const w = wk([blk('single', [{ id: 'old', sets: [D({ reps: undefined, seconds: 30 }), S({ reps: undefined, seconds: 30 }), S({ reps: undefined, seconds: 30 })] }])]); w.blocks[0]!.items[0]!.target = { sets: 3, reps: 0, seconds: 30 }; return w; };
  const reps = () => wk([blk('single', [{ id: 'old', sets: [D({ reps: 10 }), S({ reps: 10 }), S({ reps: 10 })] }])]);

  it('swapTarget 규칙', () => {
    expect(swapTarget({ reps: 0, seconds: 30 }, timeEx)).toEqual({ reps: 0, seconds: 30 });
    expect(swapTarget({ reps: 8 }, repsEx)).toEqual({ reps: 8 });
    expect(swapTarget({ reps: 0, seconds: 30 }, repsEx)).toEqual({ reps: 13 });
    expect(swapTarget({ reps: 8 }, timeEx)).toEqual({ reps: 0, seconds: 45 });
    expect(swapTarget({ reps: 8 }, timeNoDef)).toEqual({ reps: 0, seconds: 30 });
    expect('seconds' in swapTarget({ reps: 0, seconds: 30 }, repsEx)).toBe(false);
  });
  it.each([['swapItem', (w: Workout, e: never) => swapItem(w, 0, 0, 'new', [], e)], ['replaceItem', (w: Workout, e: never) => replaceItem(w, 0, 0, 'new', [], e)]] as const)('%s: 시간 → 횟수는 횟수만(초 없음)', (_n, f) => {
    const r = f(timed(), repsEx);
    const it = r.blocks[r.blocks.length - 1]!.items[0]!;
    const open = it.sets.filter((s) => !s.done);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((s) => s.reps === 13 && !('seconds' in s))).toBe(true);
    expect(it.target.reps).toBe(13);
    expect('seconds' in it.target).toBe(false);
  });
  it.each([['swapItem', (w: Workout, e: never) => swapItem(w, 0, 0, 'new', [], e)], ['replaceItem', (w: Workout, e: never) => replaceItem(w, 0, 0, 'new', [], e)]] as const)('%s: 횟수 → 시간은 초만(횟수 없음)', (_n, f) => {
    const r = f(reps(), timeEx);
    const it = r.blocks[r.blocks.length - 1]!.items[0]!;
    const open = it.sets.filter((s) => !s.done);
    expect(open.every((s) => s.seconds === 45 && !('reps' in s))).toBe(true);
    expect(it.target).toMatchObject({ reps: 0, seconds: 45 });
  });
  it('같은 종류끼리는 옛 목표를 이어받음', () => {
    const t = swapItem(timed(), 0, 0, 'new', [], timeEx);
    expect(t.blocks[1]!.items[0]!.sets[0]!.seconds).toBe(30);
    expect(t.blocks[1]!.items[0]!.target.seconds).toBe(30);
    const w = reps(); w.blocks[0]!.items[0]!.target = { sets: 3, reps: 8 };
    const r = swapItem(w, 0, 0, 'new', [], repsEx);
    expect(r.blocks[1]!.items[0]!.sets[0]!.reps).toBe(8);
  });
});
