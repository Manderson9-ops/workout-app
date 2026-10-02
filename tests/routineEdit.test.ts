import { describe, it, expect } from 'vitest';
import { bulkRoutineSets, bulkRoutineReps, routineChangedCount, routineParts, stepItemReps } from '../src/core/routineEdit';
import { rangeText } from '../src/core/planEdit';
import type { Routine, RoutineBlock, RoutineItem } from '../src/core/session';
import type { Part } from '../src/core/types';

const it_ = (id: string, o: Partial<RoutineItem> = {}): RoutineItem => ({ exerciseId: id, sets: 3, reps: 10, ...o });
const blk = (items: RoutineItem[], kind: RoutineBlock['kind'] = items.length > 1 ? 'superset' : 'single'): RoutineBlock => ({ kind, items, restSec: 90, roundRestSec: 120, transitionSec: 10 });
const routine = (blocks: RoutineBlock[]): Routine => ({ id: 'r', name: 't', createdAt: '', updatedAt: '', blocks });

describe('routineEdit (D-052)', () => {
  const r = routine([blk([it_('a'), it_('b', { sets: 4, reps: 12 })]), blk([it_('c')])]);

  it('모든 운동 세트·횟수 ±1', () => {
    const s = bulkRoutineSets(r, 1);
    expect(s.blocks.flatMap((b) => b.items.map((i) => i.sets))).toEqual([4, 5, 4]);
    const p = bulkRoutineReps(r, -1);
    expect(p.blocks.flatMap((b) => b.items.map((i) => i.reps))).toEqual([9, 11, 9]);
    expect(r.blocks[0]!.items[0]!.sets).toBe(3); // 원본은 그대로
  });

  it('bi를 주면 그 블록만', () => {
    const s = bulkRoutineSets(r, 1, 0);
    expect(s.blocks.flatMap((b) => b.items.map((i) => i.sets))).toEqual([4, 5, 3]);
    const p = bulkRoutineReps(r, 1, 1);
    expect(p.blocks.flatMap((b) => b.items.map((i) => i.reps))).toEqual([10, 12, 11]);
  });

  it('세트는 1~99, 횟수는 1~50에서 멈추고 안 바뀌면 같은 객체', () => {
    const lo = routine([blk([it_('a', { sets: 1, reps: 1 })])]);
    expect(bulkRoutineSets(lo, -1)).toBe(lo);
    expect(bulkRoutineReps(lo, -1)).toBe(lo);
    const hi = routine([blk([it_('a', { sets: 99, reps: 50 })])]);
    expect(bulkRoutineSets(hi, 1)).toBe(hi);
    expect(bulkRoutineReps(hi, 1)).toBe(hi);
    const mix = routine([blk([it_('a', { sets: 99 }), it_('b', { sets: 98 })])]);
    expect(bulkRoutineSets(mix, 1).blocks[0]!.items.map((i) => i.sets)).toEqual([99, 99]);
  });

  it('시간 운동은 5초씩, 5~300초', () => {
    const t = routine([blk([it_('a', { reps: 0, seconds: 30 }), it_('b', { reps: 10 })])]);
    const up = bulkRoutineReps(t, 1);
    expect(up.blocks[0]!.items.map((i) => [i.reps, i.seconds])).toEqual([[0, 35], [11, undefined]]);
    expect(bulkRoutineReps(routine([blk([it_('a', { reps: 0, seconds: 5 })])]), -1).blocks[0]!.items[0]!.seconds).toBe(5);
    const lo = routine([blk([it_('a', { reps: 0, seconds: 5 })])]);
    expect(bulkRoutineReps(lo, -1)).toBe(lo);
    const hi = routine([blk([it_('a', { reps: 0, seconds: 300 })])]);
    expect(bulkRoutineReps(hi, 1)).toBe(hi);
    expect(bulkRoutineReps(routine([blk([it_('a', { reps: 0, seconds: 298 })])]), 1).blocks[0]!.items[0]!.seconds).toBe(300);
  });

  it('범위 밖 옛 값(60회·305초)은 버튼 방향을 거스르지 않음', () => {
    const old = routine([blk([it_('a', { reps: 60 })])]);
    expect(bulkRoutineReps(old, 1)).toBe(old);
    expect(bulkRoutineReps(old, -1).blocks[0]!.items[0]!.reps).toBe(59);
    const longT = routine([blk([it_('a', { reps: 0, seconds: 305 })])]);
    expect(bulkRoutineReps(longT, 1)).toBe(longT);
    expect(bulkRoutineReps(longT, -1).blocks[0]!.items[0]!.seconds).toBe(300);
    expect(stepItemReps(it_('a', { reps: 60 }), 1).reps).toBe(60);
    expect(stepItemReps(it_('a', { reps: 60 }), -1).reps).toBe(59);
    const lowT = routine([blk([it_('a', { reps: 0, seconds: 3 })])]);
    expect(bulkRoutineReps(lowT, -1)).toBe(lowT);
    expect(bulkRoutineReps(lowT, 1).blocks[0]!.items[0]!.seconds).toBe(8);
  });

  it('routineChangedCount: 바뀐 운동 수', () => {
    expect(routineChangedCount(r, bulkRoutineSets(r, 1))).toBe(3);
    expect(routineChangedCount(r, bulkRoutineSets(r, 1, 0))).toBe(2);
    expect(routineChangedCount(r, r)).toBe(0);
    const edge = routine([blk([it_('a', { sets: 99 }), it_('b', { sets: 5 })])]);
    expect(routineChangedCount(edge, bulkRoutineSets(edge, 1))).toBe(1);
  });

  it('routineParts: 부위별 운동 수, 모르는 운동은 뺌', () => {
    const map: Record<string, Part> = { a: '이두', b: '이두', c: '가슴' };
    const m = routineParts(r, (id) => map[id]);
    expect(m.get('이두')).toBe(2);
    expect(m.get('가슴')).toBe(1);
    expect(m.size).toBe(2);
    expect(routineParts(routine([blk([it_('zz')])]), (id) => map[id]).size).toBe(0);
  });

  it('rangeText가 루틴 항목에도 쓰임', () => {
    expect(rangeText(r.blocks.flatMap((b) => b.items), 'sets')).toBe('3~4세트');
    expect(rangeText(r.blocks.flatMap((b) => b.items), 'reps')).toBe('10~12회');
  });
});
