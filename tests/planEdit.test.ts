import { describe, it, expect } from 'vitest';
import { stepSets, stepReps, moveBlock, addBlock, hasDbInfo } from '../src/core/planEdit';
import type { Plan, PlanItem } from '../src/core/planner';

const item = (id: string, o: Partial<PlanItem> = {}): PlanItem => ({
  exerciseId: id, name: id, part: '가슴', sets: 3, reps: 10, grade: 'B', gradeSource: 'APP_DEFAULT', estimated: true, substituted: false, locked: false, why: '', rank: 0, ...o,
});
const plan = (...ids: string[]): Plan => ({
  status: 'ok', blocks: ids.map((id) => ({ kind: 'single', items: [item(id)], timeSec: 0 })), warmup: { seconds: 0, label: '' } as Plan['warmup'],
  estimatedSec: 0, rest: { compound: 150, isolation: 90, round: 120 }, reasons: [], missingParts: [], candidateCount: 0,
});

describe('D-036 플랜 바로 고치기', () => {
  it('세트와 횟수를 따로 바꾼다', () => {
    const a = item('a');
    expect(stepSets(a, 1)).toMatchObject({ sets: 4, reps: 10 });
    expect(stepReps(a, 1)).toMatchObject({ sets: 3, reps: 11 });
    expect(stepReps(a, -1)).toMatchObject({ sets: 3, reps: 9 });
  });
  it('범위 밖으로 나가지 않는다', () => {
    expect(stepSets(item('a', { sets: 1 }), -1).sets).toBe(1);
    expect(stepSets(item('a', { sets: 8 }), 1).sets).toBe(8);
    expect(stepReps(item('a', { reps: 1 }), -1).reps).toBe(1);
    expect(stepReps(item('a', { reps: 50 }), 1).reps).toBe(50);
  });
  it('시간 운동은 5초씩, 5~300초', () => {
    const t = item('plank', { reps: 0, seconds: 30 });
    expect(stepReps(t, 1)).toMatchObject({ seconds: 35, reps: 0 });
    expect(stepReps(item('p', { reps: 0, seconds: 5 }), -1).seconds).toBe(5);
    expect(stepReps(item('p', { reps: 0, seconds: 300 }), 1).seconds).toBe(300);
  });
  it('블록 순서를 한 칸씩 바꾸고, 끝에서는 그대로', () => {
    const p = plan('a', 'b', 'c');
    const ids = (x: Plan) => x.blocks.map((b) => b.items[0]!.exerciseId).join('');
    expect(ids(moveBlock(p, 0, 1))).toBe('bac');
    expect(ids(moveBlock(p, 2, -1))).toBe('acb');
    expect(moveBlock(p, 0, -1)).toBe(p);
    expect(moveBlock(p, 2, 1)).toBe(p);
    expect(ids(p)).toBe('abc'); // 원본 불변
  });
  it('운동 추가는 맨 뒤 단일 블록, 중복은 무시', () => {
    const p = plan('a');
    const n = addBlock(p, item('b'));
    expect(n.blocks).toHaveLength(2);
    expect(n.blocks[1]).toMatchObject({ kind: 'single', items: [{ exerciseId: 'b' }] });
    expect(addBlock(n, item('a'))).toBe(n);
  });
  it('내 운동 DB 정보 판별: 영상 등급 또는 자세 포인트', () => {
    expect(hasDbInfo(undefined)).toBe(false);
    expect(hasDbInfo({ grades: [], guide: [] })).toBe(false);
    expect(hasDbInfo({ grades: [{ source: 'APP_DEFAULT' } as never], guide: [] })).toBe(false);
    expect(hasDbInfo({ grades: [{ source: 'VIDEO' } as never], guide: [] })).toBe(true);
    expect(hasDbInfo({ grades: [], guide: [{ type: 'x', text: 't', video_id: 'v', timestamp: '0:01' }] })).toBe(true);
  });
});
