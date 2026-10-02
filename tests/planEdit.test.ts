import { describe, it, expect } from 'vitest';
import { bulkSets, bulkReps, addToGroup, stepRoundRest, stepTransition, stepSets, stepReps, moveBlock, addBlock, hasDbInfo, regenerateWithLocks, rangeText, changedCount } from '../src/core/planEdit';
import type { Plan, PlanBlock, PlanItem, PlanRequest } from '../src/core/planner';
import { setTime, blockTime, warmupFor } from '../src/core/time';
import { routineEstimate } from '../src/core/session';
import type { Routine } from '../src/core/session';
import { KEEP_ALL, ONLY_LOCKED, groupKindWithNext, mergeWithNextBlock, splitPlanBlock } from '../src/core/planEdit';
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
    expect(stepSets(item('a', { sets: 8 }), 1).sets).toBe(9); // D-042: 8 넘게 가능
    expect(stepSets(item('a', { sets: 99 }), 1).sets).toBe(99);
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
    // 웜업 세트·루틴 편집 예상 시간도 같은 초 기준
    expect(warmupFor(15, false, { exercise: plank, sets: 1, reps: 0, seconds: 60 }).seconds).toBe(70 + 60);
    const r = (s: number): Routine => ({ id: 'r', name: 'r', createdAt: '', updatedAt: '', blocks: [{ kind: 'single', items: [{ exerciseId: 'plank', sets: 3, reps: 0, seconds: s }], restSec: 60, roundRestSec: 120, transitionSec: 10 }] } as unknown as Routine);
    const m = new Map([['plank', plank]]);
    expect(routineEstimate(r(60), m) - routineEstimate(r(45), m)).toBe(45);
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
    const same = regenerateWithLocks(old, new Set(['x']), req, () => { throw new Error('부르면 안 됨'); });
    expect(same.blocks).toBe(old.blocks);
    expect(same.reasons[0]).toBe(KEEP_ALL); // 조용히 아무 일 없는 것처럼 보이지 않게 이유 표시
    expect(regenerateWithLocks(same, new Set(['x']), req, () => old).reasons.filter((r) => r === KEEP_ALL)).toHaveLength(1);
    const old2 = plan('a');
    old2.blocks.push({ kind: 'single', items: [item('x', { part: '코어' })], timeSec: 0 });
    const empty = { ...plan(), status: 'too_short' as const };
    const out = regenerateWithLocks(old2, new Set(['x']), req, () => ({ ...empty, reasons: ['60분 이상 필요'] }));
    expect(out.status).toBe('ok');
    expect(out.reasons).toEqual([ONLY_LOCKED]);
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

describe('플랜에서 다음 운동과 묶기 (D-046)', () => {
  const it2 = (id: string, part: PlanItem['part']): PlanItem => ({ exerciseId: id, name: id, part, sets: 3, reps: 10, grade: 'B', gradeSource: 'APP_DEFAULT', estimated: true, substituted: false, locked: false, why: '', rank: 0 });
  const single = (i: PlanItem): PlanBlock => ({ kind: 'single', items: [i], timeSec: 0 });
  const base = { status: 'ok', warmup: { kind: 'none', seconds: 0, label: '' }, estimatedSec: 0, rest: { compound: 150, isolation: 90, round: 105 }, reasons: [], missingParts: [], candidateCount: 0 } as unknown as Plan;
  const plan = { ...base, blocks: [single(it2('a', '가슴')), single(it2('b', '등')), single(it2('c', '등')), single(it2('d', '삼두')), single(it2('e', '이두'))] } as Plan;
  it('다른 부위는 슈퍼세트, 같은 부위는 컴파운드 세트, 라운드 휴식은 플랜 값', () => {
    expect(groupKindWithNext(plan, 0)).toBe('superset');
    expect(groupKindWithNext(plan, 1)).toBe('compound');
    const m = mergeWithNextBlock(plan, 0);
    expect(m.blocks).toHaveLength(4);
    expect(m.blocks[0]).toMatchObject({ kind: 'superset', roundRestSec: 105, transitionSec: 10 });
    expect(m.blocks[0]!.items.map((i) => i.exerciseId)).toEqual(['a', 'b']);
    expect(plan.blocks).toHaveLength(5); // 원본은 그대로
  });
  it('마지막 블록·4개 넘는 묶음은 묶지 않음, 풀면 운동마다 단일 블록', () => {
    expect(groupKindWithNext(plan, 4)).toBeNull();
    expect(mergeWithNextBlock(plan, 4)).toBe(plan);
    let m = mergeWithNextBlock(mergeWithNextBlock(mergeWithNextBlock(plan, 0), 0), 0); // a+b+c+d
    expect(m.blocks[0]!.items).toHaveLength(4);
    expect(groupKindWithNext(m, 0)).toBeNull();
    m = splitPlanBlock(m, 0);
    expect(m.blocks.map((b) => b.kind)).toEqual(['single', 'single', 'single', 'single', 'single']);
    expect(m.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitPlanBlock(plan, 0)).toBe(plan);
  });
});

describe('D-051 일괄·묶음 고치기', () => {
  const grp = (...ids: string[]): PlanBlock => ({ kind: 'superset', items: ids.map((i) => item(i)), roundRestSec: 120, transitionSec: 10, timeSec: 0 });
  const withGroup = (): Plan => { const p = plan('a', 'b', 'c'); return { ...p, blocks: [grp('a', 'b'), p.blocks[2]!] }; };
  const sets = (p: Plan) => p.blocks.flatMap((b) => b.items.map((i) => i.sets));

  it('bulkSets/bulkReps: 전체와 블록 하나', () => {
    const p = withGroup();
    expect(sets(bulkSets(p, 1))).toEqual([4, 4, 4]);
    expect(sets(bulkSets(p, 1, 0))).toEqual([4, 4, 3]);
    expect(sets(bulkSets(p, -1, 1))).toEqual([3, 3, 2]);
    expect(bulkReps(p, -1).blocks.flatMap((b) => b.items.map((i) => i.reps))).toEqual([9, 9, 9]);
    expect(bulkReps(p, 1, 1).blocks.flatMap((b) => b.items.map((i) => i.reps))).toEqual([10, 10, 11]);
  });
  it('bulk: 범위 끝에서 막히고, 바뀐 게 없으면 같은 객체', () => {
    const lo = { ...plan('a'), blocks: [{ kind: 'single', items: [item('a', { sets: 1, reps: 1 })], timeSec: 0 } as PlanBlock] };
    expect(bulkSets(lo, -1)).toBe(lo);
    expect(bulkReps(lo, -1)).toBe(lo);
    const hi = { ...lo, blocks: [{ kind: 'single', items: [item('a', { sets: 99, reps: 50 })], timeSec: 0 } as PlanBlock] };
    expect(bulkSets(hi, 1)).toBe(hi);
    expect(bulkReps(hi, 1)).toBe(hi);
    expect(bulkSets(plan('a'), 1, 5).blocks[0]!.items[0]!.sets).toBe(3); // 없는 블록
    expect(bulkSets(plan('a'), 1, 5)).toBeTruthy();
  });
  it('bulk: 일부만 끝이면 나머지는 바뀜 (클램프)', () => {
    const p = { ...plan('a', 'b'), blocks: [{ kind: 'single', items: [item('a', { sets: 99 })], timeSec: 0 } as PlanBlock, { kind: 'single', items: [item('b')], timeSec: 0 } as PlanBlock] };
    expect(sets(bulkSets(p, 1))).toEqual([99, 4]);
  });
  it('bulkReps: 시간 운동은 5초씩', () => {
    const p = { ...plan('a'), blocks: [{ kind: 'single', items: [item('plank', { reps: 0, seconds: 30 })], timeSec: 0 } as PlanBlock, { kind: 'single', items: [item('b')], timeSec: 0 } as PlanBlock] };
    const n = bulkReps(p, 1);
    expect(n.blocks[0]!.items[0]).toMatchObject({ seconds: 35, reps: 0 });
    expect(n.blocks[1]!.items[0]!.reps).toBe(11);
    expect(bulkReps({ ...p, blocks: [{ kind: 'single', items: [item('p', { reps: 0, seconds: 5 })], timeSec: 0 } as PlanBlock] }, -1).blocks[0]!.items[0]!.seconds).toBe(5);
  });
  it('addToGroup: 단일 거부, 최대 4, 중복 거부', () => {
    const p = withGroup();
    expect(addToGroup(p, 1, item('z'))).toBe(p);
    expect(addToGroup(p, 0, item('c'))).toBe(p);
    expect(addToGroup(p, 9, item('z'))).toBe(p);
    const q = addToGroup(p, 0, item('z'));
    expect(q.blocks[0]!.items.map((i) => i.exerciseId)).toEqual(['a', 'b', 'z']);
    const r = addToGroup(q, 0, item('y'));
    expect(r.blocks[0]!.items).toHaveLength(4);
    expect(addToGroup(r, 0, item('x'))).toBe(r);
    // 같은 부위 묶음(컴파운드)에 다른 부위가 들어오면 슈퍼세트, 같은 부위만이면 컴파운드
    const same = { ...p, blocks: [{ ...p.blocks[0]!, kind: 'compound', items: [item('a', { part: '이두' }), item('b', { part: '이두' })] } as PlanBlock, p.blocks[1]!] };
    expect(addToGroup(same, 0, item('z', { part: '이두' })).blocks[0]!.kind).toBe('compound');
    expect(addToGroup(same, 0, item('z', { part: '코어' })).blocks[0]!.kind).toBe('superset');
  });
  it('stepRoundRest: 15초씩, 0~600, 단일은 그대로', () => {
    const p = withGroup();
    expect(stepRoundRest(p, 0, -1).blocks[0]!.roundRestSec).toBe(105);
    expect(stepRoundRest(p, 0, 1).blocks[0]!.roundRestSec).toBe(135);
    expect(stepRoundRest(p, 1, 1)).toBe(p);
    const lo = { ...p, blocks: [{ ...p.blocks[0]!, roundRestSec: 0 }, p.blocks[1]!] };
    expect(stepRoundRest(lo, 0, -1)).toBe(lo);
    const hi = { ...p, blocks: [{ ...p.blocks[0]!, roundRestSec: 595 }, p.blocks[1]!] };
    expect(stepRoundRest(hi, 0, 1).blocks[0]!.roundRestSec).toBe(600);
    expect(stepRoundRest({ ...hi, blocks: [{ ...hi.blocks[0]!, roundRestSec: 600 }, hi.blocks[1]!] }, 0, 1).blocks[0]!.roundRestSec).toBe(600);
    const none = { ...p, blocks: [{ ...p.blocks[0]!, roundRestSec: undefined }, p.blocks[1]!] };
    expect(stepRoundRest(none, 0, -1).blocks[0]!.roundRestSec).toBe(105); // 값 없으면 플랜 휴식값
  });
  it('stepTransition: 5초씩, 0~120, 단일은 그대로', () => {
    const p = withGroup();
    expect(stepTransition(p, 0, 1).blocks[0]!.transitionSec).toBe(15);
    expect(stepTransition(p, 0, -1).blocks[0]!.transitionSec).toBe(5);
    expect(stepTransition(p, 1, 1)).toBe(p);
    const lo = { ...p, blocks: [{ ...p.blocks[0]!, transitionSec: 0 }, p.blocks[1]!] };
    expect(stepTransition(lo, 0, -1)).toBe(lo);
    const hi = { ...p, blocks: [{ ...p.blocks[0]!, transitionSec: 120 }, p.blocks[1]!] };
    expect(stepTransition(hi, 0, 1)).toBe(hi);
    const none = { ...p, blocks: [{ ...p.blocks[0]!, transitionSec: undefined }, p.blocks[1]!] };
    expect(stepTransition(none, 0, 1).blocks[0]!.transitionSec).toBe(15);
  });
  it('blockTime: 블록 전환 시간을 따르고, 없으면 전체 값', () => {
    const e = { id: 'x', measure: 'reps', mechanics: 'isolation' } as unknown as Exercise;
    const items = [{ exercise: e, sets: 2, reps: 10 }, { exercise: e, sets: 2, reps: 10 }];
    const base = blockTime({ kind: 'group', items, roundRest: 60 });
    expect(blockTime({ kind: 'group', items, roundRest: 60, transition: undefined })).toBe(base);
    // 라운드 2번 × 전환 1번씩: 전환 10초 늘리면 20초 늘어남
    expect(blockTime({ kind: 'group', items, roundRest: 60, transition: 20 })).toBe(base + 20);
    expect(blockTime({ kind: 'group', items, roundRest: 60, transition: 0 })).toBe(base - 20);
  });
});
describe('D-051 후속: rangeText·addToGroup 세트·twoStations', () => {
  const it0 = (o: Partial<PlanItem>): PlanItem => ({ exerciseId: 'x', name: 'x', part: '이두', sets: 3, reps: 10, grade: 'B', gradeSource: 'estimated', estimated: true, substituted: false, locked: false, why: '', rank: 1, ...o } as PlanItem);
  it('rangeText: 세트·횟수·시간·섞임', () => {
    expect(rangeText([it0({ sets: 3 }), it0({ sets: 3 })], 'sets')).toBe('3세트');
    expect(rangeText([it0({ sets: 3 }), it0({ sets: 4 })], 'sets')).toBe('3~4세트');
    expect(rangeText([it0({ reps: 10 }), it0({ reps: 10 })], 'reps')).toBe('10회');
    expect(rangeText([it0({ reps: 12 }), it0({ reps: 8 })], 'reps')).toBe('8~12회');
    expect(rangeText([it0({ reps: 0, seconds: 30 })], 'reps')).toBe('30초');
    expect(rangeText([it0({ reps: 0, seconds: 30 }), it0({ reps: 0, seconds: 45 })], 'reps')).toBe('30~45초');
    expect(rangeText([it0({ reps: 8 }), it0({ reps: 12 }), it0({ reps: 0, seconds: 30 })], 'reps')).toBe('8~12회 · 30초');
    expect(rangeText([], 'sets')).toBe('');
  });
  it('changedCount: 바뀐 운동 수', () => {
    const b = (s: number[]): Plan => ({ blocks: [{ kind: 'superset', items: s.map((n) => it0({ sets: n })), timeSec: 0 }] } as unknown as Plan);
    expect(changedCount(b([3, 3, 99]), b([4, 4, 99]))).toBe(2);
    expect(changedCount(b([3]), b([3]))).toBe(0);
  });
  it('addToGroup: 새 운동 세트는 묶음 최대 세트, twoStations 삭제', () => {
    const p = { ...plan('a', 'b'), blocks: [{ kind: 'superset', twoStations: true, items: [it0({ exerciseId: 'a', sets: 3 }), it0({ exerciseId: 'b', sets: 5 })], roundRestSec: 120, transitionSec: 10, timeSec: 0 } as PlanBlock] };
    const q = addToGroup(p, 0, it0({ exerciseId: 'z', sets: 3 }));
    expect(q.blocks[0]!.items[2]!.sets).toBe(5);
    expect('twoStations' in q.blocks[0]!).toBe(false);
    expect(p.blocks[0]!.twoStations).toBe(true); // 원본은 그대로
  });
});