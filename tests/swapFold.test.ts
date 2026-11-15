import { describe, it, expect } from 'vitest';
import { startWorkout, swapItem, completeSet } from '../src/core/session';
import type { Routine, RoutineBlock, Workout } from '../src/core/session';
import { routineDiff, routineFromWorkout, routineFromPastWorkout, diffText, foldSwaps } from '../src/core/routineDiff';

const T0 = Date.parse('2026-11-16T02:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const one = (id: string, sets: number, reps = 10): RoutineBlock => ({ kind: 'single', items: [{ exerciseId: id, sets, reps }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const pair = (a: string, b: string, sets: number): RoutineBlock => ({ kind: 'superset', items: [{ exerciseId: a, sets, reps: 10 }, { exerciseId: b, sets, reps: 10 }], restSec: 75, roundRestSec: 120, transitionSec: 10 });
const rt = (blocks: RoutineBlock[]): Routine => ({ id: 'r', name: 'r', createdAt: iso(T0), updatedAt: iso(T0), blocks });
const REPS = { measure: 'reps', mechanics: 'compound', default_reps: [12, 14] } as never; // 목표 13회
const names = (id: string) => id;
const doneN = (w: Workout, b: number, i: number, n: number) => { let x = w; for (let k = 0; k < n; k++) x = completeSet(x, { block: b, item: i, set: k }, T0 + (k + 1) * 60_000); return x; };
const ids = (r: Routine) => r.blocks.map((b) => b.items.map((i) => i.exerciseId));

describe('D-080 검토 F1: 갈라 교체한 운동을 끝낼 때 교체로 접기', () => {
  const r = rt([one('x', 4), one('z', 3)]);
  const start = () => startWorkout('w', r, iso(T0), []);

  it('단일 갈라 교체 → 교체: X → N (추가·빠짐 없음), 루틴은 X 자리에 N, 루틴의 X 세트 수, N 의 횟수', () => {
    const w = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [], REPS);
    expect(w.blocks).toHaveLength(3); // 기록은 그대로 갈라져 있음
    const d = routineDiff(r, w);
    expect(d).toMatchObject({ added: [], removed: [], swapped: [{ from: 'x', to: 'n' }], reordered: false, changed: true });
    expect(diffText(d, names)).toBe('교체: x → n');
    const n = routineFromWorkout(r, w, iso(T0 + 1));
    expect(ids(n)).toEqual([['n'], ['z']]);
    expect(n.blocks[0]!.items[0]).toEqual({ exerciseId: 'n', sets: 4, reps: 10 }); // 같은 횟수 운동끼리라 N 의 운동 때 목표 = 옛 목표 10
    expect(w.blocks).toHaveLength(3); // 접기는 운동을 바꾸지 않음
  });

  it('루틴에 없던 X 였으면 세트 수 = 남긴 세트 + 새 세트', () => {
    const w0 = startWorkout('w', rt([one('z', 3)]), iso(T0), []);
    const added = { ...w0, blocks: [...w0.blocks, { ...w0.blocks[0]!, items: [{ ...w0.blocks[0]!.items[0]!, exerciseId: 'x', target: { sets: 4, reps: 10 }, sets: Array.from({ length: 4 }, () => ({ warmup: false, done: false, reps: 10 })) }] }] };
    const w = swapItem(doneN(added, 1, 0, 1), 1, 0, 'n', [], REPS);
    const n = routineFromWorkout(rt([one('z', 3)]), w, iso(T0 + 1));
    expect(ids(n)).toEqual([['z'], ['n']]);
    expect(n.blocks[1]!.items[0]!.sets).toBe(1 + 3);
  });

  it('슈퍼세트: N 은 묶음 안 X 자리, 블록 하나 더 생기지 않음', () => {
    const rr = rt([pair('a', 'b', 3), one('z', 3)]);
    const w = swapItem(doneN(startWorkout('w', rr, iso(T0), []), 0, 0, 1), 0, 0, 'n', [], REPS);
    expect(w.blocks.map((b) => b.kind)).toEqual(['superset', 'single', 'single']);
    expect(routineDiff(rr, w)).toMatchObject({ added: [], removed: [], swapped: [{ from: 'a', to: 'n' }], reordered: false });
    const n = routineFromWorkout(rr, w, iso(T0 + 1));
    expect(ids(n)).toEqual([['n', 'b'], ['z']]);
    expect(n.blocks[0]!.kind).toBe('superset');
    expect(n.blocks[0]!.items[0]!.sets).toBe(3);
  });

  it('연쇄 X → N1 → N2: N2 가 X 자리', () => {
    let w = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n1', [], REPS);
    w = swapItem(doneN(w, 1, 0, 1), 1, 0, 'n2', [], REPS);
    expect(w.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['x', 'n1', 'n2', 'z']);
    expect(routineDiff(r, w)).toMatchObject({ added: [], removed: [], swapped: [{ from: 'x', to: 'n2' }] });
    const n = routineFromWorkout(r, w, iso(T0 + 1));
    expect(ids(n)).toEqual([['n2'], ['z']]);
    expect(n.blocks[0]!.items[0]!.sets).toBe(4);
  });

  it('swappedFrom 이 없는 id 를 가리키면 접지 않음 (예전 동작)', () => {
    const w0 = start();
    const w = { ...w0, blocks: [...w0.blocks, { ...w0.blocks[0]!, items: [{ ...w0.blocks[0]!.items[0]!, exerciseId: 'n', swappedFrom: 'ghost' }] }] };
    expect(foldSwaps(w)).toHaveLength(3);
    expect(routineDiff(r, w)).toMatchObject({ added: ['n'], swapped: [], removed: [] });
  });

  it('실제 세트 수: 새 운동에 세트를 하나 더하면 루틴에도 5세트 (옛 4세트 아님)', () => {
    const w0 = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [], REPS);
    const n0 = w0.blocks[1]!.items[0]!;
    const w = { ...w0, blocks: w0.blocks.map((b, i) => (i === 1 ? { ...b, items: [{ ...n0, sets: [...n0.sets, { ...n0.sets[0]! }] }] } : b)) };
    expect(routineFromWorkout(r, w, iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(2 + 3);
    expect(routineFromWorkout(r, w0, iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(4);
  });

  const preMarked = () => {
    const w0 = start();
    const it0 = w0.blocks[0]!.items[0]!;
    return { ...w0, blocks: w0.blocks.map((b, i) => (i === 0 ? { ...b, items: [{ ...it0, sets: it0.sets.map((s, k) => (k === 0 ? { ...s, warmup: true, auto: true } : s)) }] } : b)) };
  };

  it('D-070 미리 표시한 웜업 + 갈라 교체(웜업 + 작업 1세트 완료, 2세트 남음): 루틴 4세트 그대로', () => {
    const w = swapItem(doneN(preMarked(), 0, 0, 2), 0, 0, 'n', [], REPS);
    expect(w.blocks[0]!.items[0]!.sets).toHaveLength(2);
    expect(w.blocks[1]!.items[0]!.sets).toHaveLength(2);
    const n = routineFromWorkout(r, w, iso(T0 + 1));
    expect(ids(n)).toEqual([['n'], ['z']]);
    expect(n.blocks[0]!.items[0]!.sets).toBe(4);
    expect(routineFromPastWorkout(w, 'new', '다시', iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(4);
  });

  it('D-070 미리 표시한 웜업 + 갈라 교체(웜업 + 작업 2세트 완료, 1세트 남음): 루틴 4세트 그대로', () => {
    const w = swapItem(doneN(preMarked(), 0, 0, 3), 0, 0, 'n', [], REPS);
    expect(w.blocks[0]!.items[0]!.sets).toHaveLength(3);
    expect(w.blocks[1]!.items[0]!.sets).toHaveLength(1);
    expect(routineFromWorkout(r, w, iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(4);
  });

  it('웜업 없이 2세트 + 남은 2세트 = 4, "다시 하기"도 같은 세트 수', () => {
    const w = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [], REPS);
    expect(routineFromWorkout(r, w, iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(4);
    expect(routineFromPastWorkout(w, 'new', '다시', iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(4);
  });

  it('새 운동에 세트를 더하면(웜업 없음) 5, "다시 하기"도 5', () => {
    const w0 = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [], REPS);
    const n0 = w0.blocks[1]!.items[0]!;
    const w = { ...w0, blocks: w0.blocks.map((b, i) => (i === 1 ? { ...b, items: [{ ...n0, sets: [...n0.sets, { ...n0.sets[0]! }] }] } : b)) };
    expect(routineFromWorkout(r, w, iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(5);
    expect(routineFromPastWorkout(w, 'new', '다시', iso(T0 + 1)).blocks[0]!.items[0]!.sets).toBe(5);
  });

  it('연쇄 + 미리 표시한 웜업: 접어서 누적한 칸도 같은 세트 수 (X 웜업+1 → N1 → N2)', () => {
    let w = swapItem(doneN(preMarked(), 0, 0, 2), 0, 0, 'n1', [], REPS); // x: 웜업+1, n1: 2 남음
    w = swapItem(doneN(w, 1, 0, 1), 1, 0, 'n2', [], REPS); // n1: 1 완료, n2: 1 남음
    expect(w.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['x', 'n1', 'n2', 'z']);
    expect(routineFromWorkout(r, w, iso(T0 + 1)).blocks[0]!.items[0]).toMatchObject({ exerciseId: 'n2', sets: 4 });
    expect(routineFromPastWorkout(w, 'new', '다시', iso(T0 + 1)).blocks[0]!.items[0]).toMatchObject({ exerciseId: 'n2', sets: 4 });
  });

  it('갈라 낸 새 운동의 남은 세트에는 웜업을 미리 표시하지 않음 (이미 몸이 풀림)', () => {
    const hist: Workout = { ...startWorkout('h', rt([one('n', 2)]), iso(T0 - 86_400_000), []), endedAt: iso(T0 - 80_000_000) };
    const h = { ...hist, blocks: [{ ...hist.blocks[0]!, items: [{ ...hist.blocks[0]!.items[0]!, sets: [{ weight: 100, reps: 5, warmup: false, done: true }, { weight: 100, reps: 5, warmup: false, done: true }] }] }] };
    const w = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [h], REPS);
    const sets = w.blocks[1]!.items[0]!.sets;
    expect(sets.length).toBe(2);
    expect(sets.some((s) => s.warmup)).toBe(false);
    expect(sets[0]).toMatchObject({ weight: 100, auto: true });
  });

  it('"다시 하기": 갈라 교체는 새 운동이 원래 자리에 한 번만 (둘 다 나오지 않음), 웜업·건너뜀 처리', () => {
    const w = swapItem(doneN(start(), 0, 0, 2), 0, 0, 'n', [], REPS);
    const n = routineFromPastWorkout(w, 'new', '다시', iso(T0 + 1));
    expect(ids(n)).toEqual([['n'], ['z']]);
    expect(n.blocks[0]!.items[0]).toMatchObject({ exerciseId: 'n', sets: 4 });
    expect(n).toMatchObject({ id: 'new', name: '다시', createdAt: iso(T0 + 1) });
    // 건너뛴 운동은 뺌
    const z = { ...w, blocks: w.blocks.map((b) => (b.items[0]!.exerciseId === 'z' ? { ...b, items: [{ ...b.items[0]!, skipped: true }] } : b)) };
    expect(ids(routineFromPastWorkout(z, 'new', '다시', iso(T0 + 1)))).toEqual([['n']]);
  });
});
