import { describe, it, expect } from 'vitest';
import { lastRecordMap, setBrief, lastLineText, lastShortText, similarExercises, similarTier } from '../src/core/similar';
import type { Workout, SetLog } from '../src/core/session';
import type { Exercise, Pattern, Part } from '../src/core/types';

const ex = (id: string, o: Partial<Exercise> = {}): Exercise => ({
  id, name_ko: id, family: id, part: '가슴' as Part, muscles: ['pec'], pattern: 'H_PUSH' as Pattern, mechanics: 'compound', equipment: ['barbell'], ...o,
});
const DAY = 86_400_000;
const set = (o: Partial<SetLog>): SetLog => ({ warmup: false, done: true, ...o });
const wk = (id: string, daysAgo: number, items: [string, SetLog[]][]): Workout => {
  const start = Date.parse('2026-11-16T00:00:00Z') - daysAgo * DAY;
  return { id, name: id, startedAt: new Date(start).toISOString(), endedAt: new Date(start + 3_600_000).toISOString(), timer: null,
    blocks: items.map(([exerciseId, sets]) => ({ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId, target: { sets: sets.length, reps: 8 }, sets }] })) } as Workout;
};
const NOW = Date.parse('2026-11-16T00:00:00Z');

describe('D-080 지난 기록 한 줄', () => {
  it('가장 무거운 완료 작업 세트 (웜업·미완료 제외), 가장 최근 날짜 기준 한 번에 훑음', () => {
    const m = lastRecordMap([
      wk('old', 10, [['bench', [set({ weight: 100, reps: 5 })]]]),
      wk('new', 3, [['bench', [set({ weight: 20, reps: 10, warmup: true }), set({ weight: 60, reps: 8 }), set({ weight: 62.5, reps: 6 }), set({ weight: 80, reps: 3, done: false })]]]),
    ]);
    expect(m.get('bench')!.set).toMatchObject({ weight: 62.5, reps: 6 });
    expect(lastLineText(m.get('bench'), NOW)).toBe('지난번 62.5kg×6 · 3일 전');
    expect(lastShortText(m.get('bench'))).toBe('지난 62.5kg×6');
  });
  it('건너뛴 운동·완료 세트 없는 운동은 기록 없음 → "아직 안 해 봄" / "처음"', () => {
    const w = wk('w', 2, [['a', [set({ weight: 10, reps: 5, done: false })]]]);
    w.blocks.push({ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'b', skipped: true, target: { sets: 1, reps: 5 }, sets: [set({ weight: 5, reps: 5 })] }] });
    const m = lastRecordMap([w]);
    expect(m.size).toBe(0);
    expect(lastLineText(m.get('a'), NOW)).toBe('아직 안 해 봄');
    expect(lastShortText(m.get('a'))).toBe('처음');
  });
  it('형식: 무게×횟수 · 맨몸×횟수 · 시간 초', () => {
    expect(setBrief(set({ weight: 60, reps: 8 }))).toBe('60kg×8');
    expect(setBrief(set({ reps: 12 }))).toBe('맨몸×12');
    expect(setBrief(set({ weight: 0, reps: 12 }))).toBe('맨몸×12');
    expect(setBrief(set({ seconds: 30 }))).toBe('30초');
    const m = lastRecordMap([wk('t', 0, [['plank', [set({ seconds: 30 })]]])]);
    expect(lastLineText(m.get('plank'), NOW)).toBe('지난번 30초 · 오늘');
  });
});

describe('D-080 비슷한 운동 순위', () => {
  const from = ex('from', { family: 'press', pattern: 'H_PUSH', muscles: ['pec', 'tri'], part: '가슴' });
  const t1 = ex('t1', { family: 'press' });
  const t2 = ex('t2', { family: 'fly', pattern: 'H_PUSH', muscles: ['pec'] });
  const t3 = ex('t3', { family: 'dip', pattern: 'H_PUSH', muscles: ['tri'], part: '가슴' });
  const far = ex('far', { family: 'row', pattern: 'H_PULL', muscles: ['lat'], part: '등' });
  const all = [far, t3, t2, t1, from];
  const none = new Map();

  it('1단계 같은 family → 2단계 같은 pattern·첫 근육 → 3단계 같은 pattern·같은 부위, 닮지 않은 것은 뺌', () => {
    expect(similarTier(from, t1)).toBe(1);
    expect(similarTier(from, t2)).toBe(2);
    expect(similarTier(from, t3)).toBe(3);
    expect(similarTier(from, far)).toBe(0);
    expect(similarExercises('from', all, { last: none }).map((e) => e.id)).toEqual(['t1', 't2', 't3']);
  });
  it('같은 단계 안에서는 해 본 운동(최근 순)이 먼저, 그다음 등급순', () => {
    const a = ex('a', { family: 'press' }), b = ex('b', { family: 'press' }), c = ex('c', { family: 'press' }), d = ex('d', { family: 'press' });
    const last = lastRecordMap([wk('w1', 20, [['c', [set({ weight: 1, reps: 1 })]]]), wk('w2', 5, [['b', [set({ weight: 1, reps: 1 })]]])]);
    const grade: Record<string, number> = { a: 3, d: 1 };
    const ids = similarExercises('from', [from, a, b, c, d], { last, gradeRank: (e) => grade[e.id] ?? 9 }).map((e) => e.id);
    expect(ids).toEqual(['b', 'c', 'd', 'a']); // 해 본 b(최근) c, 안 해 본 d(등급 1) a(등급 3)
  });
  it('해 본 3단계 운동도 안 해 본 1단계 운동보다 뒤 (단계가 먼저)', () => {
    const last = lastRecordMap([wk('w', 1, [['t3', [set({ weight: 1, reps: 1 })]]])]);
    expect(similarExercises('from', all, { last }).map((e) => e.id)).toEqual(['t1', 't2', 't3']);
  });
  it('제외: 자기 자신·exclude·내가 뺀 운동·장비 없음', () => {
    const o = { last: none, exclude: ['t1'], excluded: (id: string) => id === 't2', available: (e: Exercise) => e.id !== 't3' };
    expect(similarExercises('from', all, o)).toEqual([]);
    expect(similarExercises('from', all, { last: none, exclude: ['from'] }).map((e) => e.id)).not.toContain('from');
  });
  it('최대 5개, 바꿀 운동이 목록에 없으면 빈 목록', () => {
    const many = [from, ...Array.from({ length: 9 }, (_, i) => ex(`p${i}`, { family: 'press' }))];
    expect(similarExercises('from', many, { last: none })).toHaveLength(5);
    expect(similarExercises('nope', many, { last: none })).toEqual([]);
    expect(similarExercises(undefined, many, { last: none })).toEqual([]);
  });
});
