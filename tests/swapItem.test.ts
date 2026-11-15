import { describe, it, expect } from 'vitest';
import { replaceItem, swapItem, swapSplitsGroup, steps, currentStep, roundOf, roundSteps, completeSet } from '../src/core/session';
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
  it('남은 작업 세트가 없어도 새 운동은 1세트, 시간 운동은 초를 이어받음', () => {
    const w = wk([blk('single', [{ id: 'old', sets: [D({ reps: undefined, seconds: 30 }), D({ reps: undefined, seconds: 30 })] }])]);
    w.blocks[0]!.items[0]!.target = { sets: 2, reps: 0, seconds: 30 };
    const r = swapItem(w, 0, 0, 'new', []);
    expect(r.blocks[1]!.items[0]!.sets).toHaveLength(1);
    expect(r.blocks[1]!.items[0]!.sets[0]!.seconds).toBe(30);
  });
});
