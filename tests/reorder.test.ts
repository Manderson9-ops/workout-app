import { describe, it, expect } from 'vitest';
import { moveItem, remapIndex } from '../src/core/reorder';
import { moveBlockTo, moveBlock } from '../src/core/planEdit';
import { moveRoutineBlock, moveWorkoutBlock, currentStep, completeSet, mergeLate } from '../src/core/session';
import type { Workout, Routine } from '../src/core/session';
import type { Plan } from '../src/core/planner';
import { nearestIndex } from '../src/ui/dragSort';

describe('moveItem (D-037)', () => {
  const a = ['a', 'b', 'c', 'd'];
  it('앞→뒤, 뒤→앞, 사이는 한 칸씩 밀림', () => {
    expect(moveItem(a, 0, 2).join('')).toBe('bcad');
    expect(moveItem(a, 3, 0).join('')).toBe('dabc');
    expect(moveItem(a, 1, 2).join('')).toBe('acbd');
    expect(a.join('')).toBe('abcd'); // 원본 안 바뀜
  });
  it('같은 자리·범위 밖·정수 아님이면 원본 그대로 (===)', () => {
    for (const [f, t] of [[1, 1], [-1, 0], [0, 4], [4, 0], [0.5, 1], [NaN, 0]] as const) expect(moveItem(a, f, t)).toBe(a);
  });
  it('모든 from/to 쌍: 길이·구성 유지, 옮긴 항목이 to에 있음, remapIndex와 일치', () => {
    const n = 6; const arr = [...Array(n).keys()];
    for (let f = 0; f < n; f++) for (let t = 0; t < n; t++) {
      const out = moveItem(arr, f, t);
      expect([...out].sort((x, y) => x - y)).toEqual(arr);
      expect(out[t]).toBe(f);
      for (let i = 0; i < n; i++) expect(out[remapIndex(i, f, t)]).toBe(i);
    }
  });
});

describe('화면별 순서 바꾸기', () => {
  it('플랜: moveBlockTo, moveBlock(±1)은 같은 결과', () => {
    const p = { blocks: ['a', 'b', 'c'].map((id) => ({ kind: 'single', items: [{ exerciseId: id }], timeSec: 0 })) } as unknown as Plan;
    const ids = (x: Plan) => x.blocks.map((b) => b.items[0]!.exerciseId).join('');
    expect(ids(moveBlockTo(p, 0, 2))).toBe('bca');
    expect(ids(moveBlock(p, 0, 1))).toBe(ids(moveBlockTo(p, 0, 1)));
    expect(moveBlockTo(p, 1, 1)).toBe(p);
  });
  it('루틴: 블록(묶음 통째) 옮김, 설정값 유지', () => {
    const blk = (id: string, rest: number) => ({ kind: 'single' as const, items: [{ exerciseId: id, sets: 3, reps: 10 }], restSec: rest, roundRestSec: 120, transitionSec: 10 });
    const r: Routine = { id: 'r', name: 'n', createdAt: '', updatedAt: '', blocks: [blk('a', 60), { ...blk('b', 90), kind: 'superset', items: [{ exerciseId: 'b', sets: 3, reps: 10 }, { exerciseId: 'b2', sets: 3, reps: 10 }] }, blk('c', 120)] };
    const out = moveRoutineBlock(r, 1, 0);
    expect(out.blocks.map((b) => b.items.map((i) => i.exerciseId).join('+'))).toEqual(['b+b2', 'a', 'c']);
    expect(out.blocks[1]!.restSec).toBe(60);
    expect(moveRoutineBlock(r, 0, 0)).toBe(r);
  });
  it('운동 중: 끝낸 세트는 블록과 함께 옮겨지고, 현재 세트는 새 순서의 첫 미완료 세트', () => {
    const blk = (id: string) => ({ kind: 'single' as const, items: [{ exerciseId: id, target: { sets: 2, reps: 10 }, sets: [{ reps: 10, done: false }, { reps: 10, done: false }] }], restSec: 60, roundRestSec: 120, transitionSec: 10 });
    let w = { id: 'w', name: 'n', startedAt: '2026-10-01T00:00:00Z', timer: null, blocks: [blk('a'), blk('b'), blk('c')] } as unknown as Workout;
    w = completeSet(w, { block: 0, item: 0, set: 0 }, 1000);
    const timer = w.timer;
    const m = moveWorkoutBlock(w, 2, 0); // c를 맨 앞으로
    expect(m.blocks.map((b) => b.items[0]!.exerciseId).join('')).toBe('cab');
    expect(m.blocks[1]!.items[0]!.sets[0]!.done).toBe(true); // a의 끝낸 세트 유지
    expect(currentStep(m)).toEqual({ block: 0, item: 0, set: 0 }); // 이제 c부터
    expect(m.timer).toBe(timer); // 휴식 타이머 그대로
    expect(moveWorkoutBlock(w, 5, 0)).toBe(w);
  });
});

describe('nearestIndex (놓을 자리 찾기)', () => {
  const col = [0, 1, 2].map((i) => ({ l: 0, r: 100, t: i * 110, b: i * 110 + 100 }));
  it('카드 안이면 그 카드, 사이·밖이면 가장 가까운 카드', () => {
    expect(nearestIndex(col, 50, 150)).toBe(1);
    expect(nearestIndex(col, 50, 104)).toBe(0);
    expect(nearestIndex(col, 50, 107)).toBe(1);
    expect(nearestIndex(col, 50, -500)).toBe(0);
    expect(nearestIndex(col, 50, 9999)).toBe(2);
    expect(nearestIndex([], 0, 0)).toBe(-1);
  });
  it('2단(PC) 배치: 왼쪽·오른쪽 구분', () => {
    const grid = [{ l: 0, r: 100, t: 0, b: 100 }, { l: 110, r: 210, t: 0, b: 100 }, { l: 0, r: 100, t: 110, b: 210 }];
    expect(nearestIndex(grid, 150, 50)).toBe(1);
    expect(nearestIndex(grid, 50, 150)).toBe(2);
  });
});

describe('늦은 기록 합치기 (mergeLate, D-037)', () => {
  const blk = (id: string, done = 0) => ({ kind: 'single' as const, restSec: 60, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: id, target: { sets: 3, reps: 10 }, sets: [0, 1, 2].map((k) => ({ reps: 10, done: k < done, ...(k < done ? { doneAt: `${id}${k}`, weight: 50 + k } : {}) })) }] });
  const W = (blocks: ReturnType<typeof blk>[]) => ({ id: 'w', name: 'n', startedAt: '', timer: null, blocks } as unknown as Workout);
  const doneOf = (w: Workout, id: string) => w.blocks.flatMap((b) => b.items).filter((i) => i.exerciseId === id).flatMap((i) => i.sets.filter((s) => s.done).map((s) => s.doneAt));
  it('원래 운동 순서를 바꾼 뒤에도 같은 운동에 채움 (자리로만 찾으면 버려지던 경우)', () => {
    const orig = moveWorkoutBlock(W([blk('x'), blk('y')]), 1, 0); // [y, x]
    const copy = W([blk('x', 2)]); // 옛 순서의 x (블록 0)
    const m = mergeLate(orig, copy);
    expect(m.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['y', 'x']);
    expect(doneOf(m, 'x')).toEqual(['x0', 'x1']);
    expect(doneOf(m, 'y')).toEqual([]);
  });
  it('사본의 빈 블록이 빠져 번호가 당겨져도 맞는 운동에 채움', () => {
    const m = mergeLate(W([blk('x'), blk('y')]), W([blk('y', 1)])); // y가 블록 0으로 당겨진 사본
    expect(doneOf(m, 'y')).toEqual(['y0']);
    expect(doneOf(m, 'x')).toEqual([]);
  });
  it('원래 운동에 없는 운동(그사이 교체)은 버리지 않고 맨 뒤 새 블록으로', () => {
    const m = mergeLate(W([blk('x')]), W([blk('z', 2)]));
    expect(m.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['x', 'z']);
    expect(doneOf(m, 'z')).toEqual(['z0', 'z1']);
  });
  it('이미 있는 세트(doneAt 같음)는 두 번 넣지 않음', () => {
    const m = mergeLate(W([blk('x', 1)]), W([blk('x', 2)]));
    expect(doneOf(m, 'x')).toEqual(['x0', 'x1']);
  });
});
