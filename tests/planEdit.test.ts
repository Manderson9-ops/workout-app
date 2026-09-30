import { describe, it, expect } from 'vitest';
import { stepSets, stepReps, moveBlock, addBlock, hasDbInfo, regenerateWithLocks } from '../src/core/planEdit';
import type { Plan, PlanItem, PlanRequest } from '../src/core/planner';
import { setTime, blockTime } from '../src/core/time';
import type { Exercise } from '../src/core/types';

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
  it('시간 운동: 세트당 초를 넘기면 시간 계산에 반영, 없으면 기본값 (예전과 같음)', () => {
    const plank = { id: 'plank', measure: 'time', default_seconds: 45, setup_sec: 10 } as unknown as Exercise;
    expect(setTime(plank, 0)).toBe(55);
    expect(setTime(plank, 0, undefined, 60)).toBe(70);
    const b = (s?: number) => blockTime({ kind: 'single', items: [{ exercise: plank, sets: 3, reps: 0, seconds: s }], rest: 60 });
    expect(b(60) - b(45)).toBe(45);
    expect(b(undefined)).toBe(b(45));
  });
  it('잠금 다시 생성: 바꾼 횟수·초 유지, 고르지 않은 부위 잠금은 뒤에 붙임', () => {
    const old = plan('a', 'b');
    old.blocks[0]!.items[0] = item('a', { reps: 15 });
    old.blocks.push({ kind: 'single', items: [item('plank', { part: '코어', reps: 0, seconds: 60 })], timeSec: 0 });
    const req = { parts: [{ part: '가슴', priority: 'high' }] } as PlanRequest;
    let seen: PlanRequest | undefined;
    const gen = (r: PlanRequest) => { seen = r; return plan('a', 'c'); };
    const out = regenerateWithLocks(old, new Set(['a', 'plank']), req, gen);
    expect(seen!.locked).toEqual([{ exerciseId: 'a', part: '가슴', sets: 3 }]); // 코어는 생성기에 안 넘김
    expect(seen!.lockedOnly).toBe(false);
    expect(out.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['a', 'c', 'plank']);
    expect(out.blocks[0]!.items[0]!.reps).toBe(15);
    expect(out.blocks[2]!.items[0]).toMatchObject({ seconds: 60, locked: true });
  });
  it('잠금 다시 생성: 모두 잠갔는데 고른 부위 운동이 없으면 지금 플랜 그대로, 생성 결과가 비면 잠긴 추가 운동으로 정상 플랜', () => {
    const old = plan('x');
    old.blocks[0]!.items[0] = item('x', { part: '코어' });
    const req = { parts: [{ part: '가슴', priority: 'high' }] } as PlanRequest;
    expect(regenerateWithLocks(old, new Set(['x']), req, () => { throw new Error('부르면 안 됨'); })).toBe(old);
    const old2 = plan('a');
    old2.blocks.push({ kind: 'single', items: [item('x', { part: '코어' })], timeSec: 0 });
    const empty = { ...plan(), status: 'too_short' as const };
    const out = regenerateWithLocks(old2, new Set(['x']), req, () => empty);
    expect(out.status).toBe('ok');
    expect(out.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['x']);
  });
  it('내 운동 DB 정보 판별: 영상 등급 또는 자세 포인트', () => {
    expect(hasDbInfo(undefined)).toBe(false);
    expect(hasDbInfo({ grades: [], guide: [] })).toBe(false);
    expect(hasDbInfo({ grades: [{ source: 'APP_DEFAULT' } as never], guide: [] })).toBe(false);
    expect(hasDbInfo({ grades: [{ source: 'VIDEO' } as never], guide: [] })).toBe(true);
    expect(hasDbInfo({ grades: [], guide: [{ type: 'x', text: 't', video_id: 'v', timestamp: '0:01' }] })).toBe(true);
  });
});
