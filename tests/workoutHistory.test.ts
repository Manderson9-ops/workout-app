import { describe, it, expect } from 'vitest';
import { ringDash, previousSetsFor, prevFor, prevText, isPR, bestsFrom, workoutPRs, prExerciseCount } from '../src/core/workoutHistory';
import type { Workout, SetLog } from '../src/core/session';

const S = (weight: number | undefined, reps: number | undefined, o: Partial<SetLog> = {}): SetLog => ({ weight, reps, warmup: false, done: true, ...o });
const W = (id: string, endedAt: string | undefined, sets: SetLog[], ex = 'bench', skipped = false): Workout => ({
  id, name: id, startedAt: endedAt ?? '2026-10-06T10:00:00.000Z', ...(endedAt ? { endedAt } : {}), timer: null,
  blocks: [{ kind: 'single', restSec: 90, roundRestSec: 0, transitionSec: 0, items: [{ exerciseId: ex, target: { sets: 3, reps: 8 }, sets, ...(skipped ? { skipped } : {}) }] }],
} as Workout);

describe('D-055 2단계: 지난번 (previousSetsFor)', () => {
  const h = [
    W('old', '2026-10-01T10:00:00.000Z', [S(30, 10)]),
    W('last', '2026-10-04T10:00:00.000Z', [S(20, 10, { warmup: true }), S(40, 8), S(42.5, 6), S(45, 3, { done: false })]),
    W('skip', '2026-10-05T10:00:00.000Z', [S(99, 1)], 'bench', true),
    W('other', '2026-10-05T11:00:00.000Z', [S(10, 10)], 'curl'),
    W('active', undefined, [S(50, 5)]),
  ];
  it('가장 최근에 끝낸 운동의 완료 세트 (건너뛴 운동·진행 중·안 한 세트 제외), 웜업 따로', () => {
    const p = previousSetsFor(h, 'bench');
    expect(p.work.map((s) => s.weight)).toEqual([40, 42.5]);
    expect(p.warm.map((s) => s.weight)).toEqual([20]);
    expect(previousSetsFor(h, 'squat')).toEqual({ work: [], warm: [] });
  });
  it('같은 번호끼리: 작업 2세트 ↔ 지난번 작업 2세트, W1 ↔ 지난번 W1, 없으면 -', () => {
    const p = previousSetsFor(h, 'bench');
    const cur = [S(undefined, undefined, { warmup: true, done: false }), S(undefined, 8, { done: false }), S(undefined, 8, { done: false }), S(undefined, 8, { done: false })];
    expect(prevText(prevFor(p, cur, 0), false)).toBe('20×10');
    expect(prevText(prevFor(p, cur, 1), false)).toBe('40×8');
    expect(prevText(prevFor(p, cur, 2), false)).toBe('42.5×6');
    expect(prevText(prevFor(p, cur, 3), false)).toBe('-');
    expect(prevText(S(undefined, undefined, { seconds: 30 }), true)).toBe('30초');
    expect(prevText(S(undefined, 12), false)).toBe('맨몸×12');
  });
});

describe('D-055 2단계: 기록 갱신 (isPR, 앱 기준)', () => {
  const prev = bestsFrom([S(60, 5), S(50, 10), S(70, 1)]); // 1RM: 60×5=70, 50×10=66.7, 70×1=70
  it('추정 1RM 이 지난 최고보다 크면', () => { expect(isPR(S(62.5, 5), prev)).toBe('1rm'); });
  it('지난 어떤 세트보다 무거우면 (1RM 은 낮아도)', () => { expect(isPR(S(72.5, 1), prev)).toBe('1rm'); expect(isPR(S(75, 1), bestsFrom([S(60, 12)]))).toBe('weight'); });
  it('그 무게 이상으로 한 지난 세트들보다 횟수가 많으면', () => {
    expect(isPR(S(50, 11), prev)).toBe('reps'); // 50 이상: 50×10·60×5·70×1 → 최다 10
    expect(isPR(S(50, 10), prev)).toBeNull();
    expect(isPR(S(40, 16), bestsFrom([S(40, 15), S(60, 5)]))).toBe('reps'); // 13회 이상은 1RM 대신 횟수로
  });
  it('갱신 아님: 처음 하는 운동, 웜업, 안 끝낸 세트, 무게 없는 맨몸·시간 운동', () => {
    expect(isPR(S(100, 5), bestsFrom([]))).toBeNull();
    expect(isPR(S(100, 5, { warmup: true }), prev)).toBeNull();
    expect(isPR(S(100, 5, { done: false }), prev)).toBeNull();
    expect(isPR(S(undefined, 30), prev)).toBeNull();
    expect(isPR(S(0, 30), prev)).toBeNull();
    expect(isPR(S(20, undefined, { seconds: 60 }), prev)).toBeNull();
  });
  it('운동 안에서는 앞서 끝낸 세트보다 나을 때만 배지, 끝낼 때 운동 수', () => {
    const h = [W('h', '2026-10-01T10:00:00.000Z', [S(60, 5)])];
    const cur = W('cur', undefined, [S(62.5, 5, { doneAt: '2026-10-06T10:01:00.000Z' }), S(62.5, 5, { doneAt: '2026-10-06T10:03:00.000Z' }), S(65, 5, { doneAt: '2026-10-06T10:05:00.000Z' })]);
    const m = workoutPRs(cur, h);
    expect([...m.keys()]).toEqual(['0-0-0', '0-0-2']);
    expect(prExerciseCount(cur, h)).toBe(1);
    expect(workoutPRs(cur, []).size).toBe(0); // 지난 기록이 없으면 없음
  });
});

describe('D-055 2단계: 휴식 고리는 남은 비율 (줄어듦)', () => {
  const C = 100;
  it('시작 = 꽉 참, 절반 = 반, 10/120초 = 거의 빔, 끝 = 빔', () => {
    expect(ringDash(120, 120, C)).toEqual({ dasharray: 100, dashoffset: 0, fraction: 1 });
    expect(ringDash(60, 120, C).dashoffset).toBeCloseTo(50);
    expect(ringDash(10, 120, C).fraction).toBeCloseTo(10 / 120);
    expect(ringDash(10, 120, C).dashoffset).toBeCloseTo(100 - 100 / 12);
    expect(ringDash(0, 120, C).dashoffset).toBe(100);
  });
  it('이상한 값은 빈 고리, 남은 시간이 더 길면 꽉 참', () => {
    expect(ringDash(5, 0, C).fraction).toBe(0);
    expect(ringDash(Number.NaN, 60, C).fraction).toBe(0);
    expect(ringDash(200, 120, C).fraction).toBe(1);
  });
});
