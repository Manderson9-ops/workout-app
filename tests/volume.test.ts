import { describe, expect, it } from 'vitest';
import baseFile from '../data/exercises.base.json';
import wkFile from '../data/exercises.workout_k.json';
import stapleFile from '../data/staples.json';
import { buildExercises } from '../src/core/exercises';
import type { WorkoutKData } from '../src/core/exercises';
import { generatePlan } from '../src/core/planner';
import type { PlanRequest } from '../src/core/planner';
import { validatePlan } from '../src/core/validatePlan';
import { MUSCLE_GROUP, groupOf, setShares, sessionLoad, overCap, fmtSets, SESSION_CAP, MAX_SETS_BY_LEVEL } from '../src/core/volume';
import type { Exercise, Part, Level } from '../src/core/types';
import { LEVELS } from '../src/core/types';

const real = buildExercises(baseFile.exercises as Exercise[], wkFile as unknown as WorkoutKData, stapleFile.order as Partial<Record<Part, string[]>>);
const byId = new Map(real.map((e) => [e.id, e]));
const items = (p: ReturnType<typeof generatePlan>) => p.blocks.flatMap((b) => b.items);
const loadOfPlan = (p: ReturnType<typeof generatePlan>) => sessionLoad(items(p).map((i) => ({ muscles: byId.get(i.exerciseId)!.muscles, sets: i.sets })));
const legs = (level: Level, targetMinutes?: number): PlanRequest => ({ parts: [{ part: '하체', priority: 'high' }], level, minGrade: 'B-', ...(targetMinutes ? { targetMinutes } : {}) });

describe('근육 그룹과 fractional 세트 (D-041)', () => {
  it('운동 데이터의 모든 근육 이름이 그룹 표에 있음 (새 이름이 생기면 여기서 실패)', () => {
    const names = new Set(real.flatMap((e) => e.muscles));
    expect([...names].filter((m) => !(m in MUSCLE_GROUP))).toEqual([]);
  });
  it('주 근육 1세트, 보조 0.5세트, 같은 그룹은 큰 값 하나', () => {
    expect([...setShares(['대퇴사두', '둔근', '내전근'])]).toEqual([['대퇴사두', 1], ['둔근', 0.5], ['내전근', 0.5]]);
    expect([...setShares(['대퇴사두', '대퇴직근'])]).toEqual([['대퇴사두', 1]]);
    expect([...setShares(['둔근', '중둔근', '햄스트링'])]).toEqual([['둔근', 1], ['햄스트링', 0.5]]);
    expect(groupOf('하체')).toBe('하체'); // 직접 추가한 운동(근육 = 부위 이름)
    const load = sessionLoad([{ muscles: ['대퇴사두', '둔근'], sets: 4 }, { muscles: ['둔근'], sets: 3 }]);
    expect(load.get('대퇴사두')).toBe(4);
    expect(load.get('둔근')).toBe(5);
    expect(fmtSets(5)).toBe('5');
    expect(fmtSets(5.5)).toBe('5.5');
  });
  it('상한 초과 판정: 잠금만으로 넘으면 그 양까지 인정', () => {
    const load = new Map([['가슴', 12], ['삼두', 11]]);
    expect(overCap(load, 11)).toEqual(['가슴']);
    expect(overCap(load, 11, new Map([['가슴', 12]]))).toEqual([]);
    expect(overCap(new Map([['가슴', 12.5]]), 11, new Map([['가슴', 12]]))).toEqual(['가슴']);
  });
  it('수준별 값: 초보 8·3세트(앱 판단), 중급·상급 11·4세트', () => {
    expect(SESSION_CAP).toEqual({ 초보: 8, 중급: 11, 상급: 11 });
    expect(MAX_SETS_BY_LEVEL).toEqual({ 초보: 3, 중급: 4, 상급: 4 });
  });
});

describe('사용자 신고 재현: 하체 · 75분 · B- 이상 (이전 33분 12초)', () => {
  it('중급: 70분 이상 75분 이하, 운동 7개 이상, 햄스트링·둔근·종아리까지 들어감, 검증 위반 0', () => {
    const q = legs('중급', 75);
    const p = generatePlan(q, real);
    expect(p.estimatedSec).toBeGreaterThanOrEqual(70 * 60);
    expect(p.estimatedSec).toBeLessThanOrEqual(75 * 60);
    expect(items(p).length).toBeGreaterThanOrEqual(7);
    const groups = new Set(items(p).map((i) => groupOf(byId.get(i.exerciseId)!.muscles[0]!)));
    for (const g of ['대퇴사두', '햄스트링', '둔근', '종아리']) expect(groups.has(g)).toBe(true);
    expect(p.slack).toBeUndefined();
    expect(validatePlan(p, q, real)).toEqual([]);
  });
  it('수준이 결과를 바꿈: 초보는 운동당 3세트·근육별 8 이하, 남는 시간은 이유와 코어 추가 제안', () => {
    const q = legs('초보', 75);
    const p = generatePlan(q, real);
    expect(items(p).every((i) => i.sets <= 3)).toBe(true);
    expect(Math.max(...loadOfPlan(p).values())).toBeLessThanOrEqual(8);
    expect(validatePlan(p, q, real)).toEqual([]);
    expect(p.slack).toMatchObject({ cause: ['cap'], suggest: ['코어'], level: '초보', cap: 8, maxSets: 3 });
    expect(p.reasons.some((r) => r.includes('초보 8세트, 앱 판단'))).toBe(true);
    // 추천 순서 밖에서는 이미 있는 둔근보다 새 근육(내전근) 먼저
    expect(items(p).map((i) => i.exerciseId)).toContain('hip_adduction');
    const mid = generatePlan(legs('중급', 75), real);
    expect(items(p).reduce((s, i) => s + i.sets, 0)).toBeLessThan(items(mid).reduce((s, i) => s + i.sets, 0));
  });
  it('세 수준 × 45·60·75·90분: 목표 넘지 않음, 근육별 상한·운동당 최대 세트 지킴, 60분 이상이면 이전(33분)보다 김', () => {
    for (const level of LEVELS) for (const t of [45, 60, 75, 90]) {
      const q = legs(level, t);
      const p = generatePlan(q, real);
      expect(validatePlan(p, q, real)).toEqual([]);
      expect(p.estimatedSec).toBeLessThanOrEqual(t * 60);
      expect(items(p).every((i) => i.sets <= MAX_SETS_BY_LEVEL[level])).toBe(true);
      expect(Math.max(...loadOfPlan(p).values())).toBeLessThanOrEqual(SESSION_CAP[level]);
      if (t >= 60) expect(p.estimatedSec).toBeGreaterThan(1992 + 15 * 60);
    }
  });
});

describe('채울 수 없을 때는 이유와 제안 (D-041)', () => {
  it('가슴만 75분: 가슴 11/11에서 멈추고, 삼두·어깨 추가 제안', () => {
    const q: PlanRequest = { parts: [{ part: '가슴', priority: 'high' }], level: '중급', minGrade: 'B-', targetMinutes: 75 };
    const p = generatePlan(q, real);
    expect(loadOfPlan(p).get('가슴')).toBe(11);
    expect(p.slack).toMatchObject({ cause: ['cap'], suggest: ['삼두', '어깨'], level: '중급', cap: 11 });
    expect(p.reasons.some((r) => r.includes('가슴 지금 11/11'))).toBe(true);
    expect(p.reasons.some((r) => r.includes('여유') && r.includes('삼두·어깨를 더하면'))).toBe(true);
    // 제안대로 삼두를 더하면 더 길어짐
    const more = generatePlan({ ...q, parts: [...q.parts, { part: '삼두', priority: 'normal' }] }, real);
    expect(more.estimatedSec).toBeGreaterThan(p.estimatedSec + 15 * 60);
    expect(validatePlan(more, { ...q, parts: [...q.parts, { part: '삼두', priority: 'normal' }] }, real)).toEqual([]);
  });
  it('부위를 넘어 합산: 가슴 프레스의 삼두 0.5세트가 삼두 상한에 들어감', () => {
    const q: PlanRequest = { parts: [{ part: '가슴', priority: 'high' }, { part: '삼두', priority: 'normal' }], level: '중급', minGrade: 'B-', targetMinutes: 90 };
    const p = generatePlan(q, real);
    const direct = items(p).filter((i) => groupOf(byId.get(i.exerciseId)!.muscles[0]!) === '삼두').reduce((s, i) => s + i.sets, 0);
    expect(loadOfPlan(p).get('삼두')!).toBeGreaterThan(direct);
    expect(loadOfPlan(p).get('삼두')!).toBeLessThanOrEqual(11);
  });
  it('목표 시간 없음 + 초보 이두: 기본안 3개 중 상한을 넘는 하나는 "상한" 이유로 뺌 (시간 부족 아님)', () => {
    const p = generatePlan({ parts: [{ part: '이두', priority: 'high' }], level: '초보' }, real);
    expect(items(p)).toHaveLength(2);
    const r = p.reasons.find((x) => x.startsWith('이두:'))!;
    expect(r).toContain('상한');
    expect(r).not.toContain('시간 부족');
  });
  it('검증 함수가 근육별 상한 초과와 수준별 최대 세트 초과를 잡음', () => {
    const q = legs('중급', 75);
    const p = generatePlan(q, real);
    const forged = structuredClone(p);
    const ext = forged.blocks.flatMap((b) => b.items).find((i) => i.exerciseId === 'leg_extension')!;
    ext.sets = 4;
    forged.blocks.push({ kind: 'single', items: [{ ...ext, exerciseId: 'hack_squat', name: '핵 스쿼트 머신', sets: 5, rank: 50 }], timeSec: 0 });
    const errs = validatePlan(forged, q, real);
    expect(errs).toContain('근육별 상한 초과: 대퇴사두');
    const beginner = generatePlan(legs('초보', 45), real);
    const f2 = structuredClone(beginner); f2.blocks[0]!.items[0]!.sets = 4;
    expect(validatePlan(f2, legs('초보', 45), real)).toContain(`운동당 3세트 초과: ${f2.blocks[0]!.items[0]!.name}`);
  });
});

describe('짧을 때 원인이 사실과 맞음: 모든 부위 × 3수준 × 45~120분 (D-041 검토 1차 필수 1)', () => {
  const PARTS8: Part[] = ['가슴', '등', '어깨', '이두', '삼두', '전완·악력', '하체', '코어'];
  it('원인이 "시간"뿐이면 모자란 시간은 블록 하나(최대 약 12분) 이하, 상한·후보 소진이면 부위 제안이 있음', () => {
    for (const part of PARTS8) for (const level of LEVELS) for (const t of [45, 60, 75, 90, 120]) {
      const q: PlanRequest = { parts: [{ part, priority: 'high' }], level, minGrade: 'B-', targetMinutes: t };
      const p = generatePlan(q, real);
      expect(validatePlan(p, q, real), `${part} ${level} ${t}`).toEqual([]);
      if (!p.slack) continue;
      const short = t * 60 - p.estimatedSec;
      if (p.slack.cause.every((c) => c === 'time')) expect(short, `${part} ${level} ${t} 원인=시간인데 ${Math.round(short / 60)}분 짧음`).toBeLessThanOrEqual(12 * 60);
      else expect(p.slack.suggest.length, `${part} ${level} ${t}`).toBeGreaterThan(0);
      expect(p.slack.level).toBe(level);
    }
  });
  it('초보 등·어깨: 앞 순번 운동이 상한을 넘어도 뒤 후보로 채움 (이전: 시간과 상관없이 등 33분 33초, 어깨 46분 12초), 원인은 상한', () => {
    for (const [part, before] of [['등', 2013], ['어깨', 2772]] as [Part, number][]) {
      const p = generatePlan({ parts: [{ part, priority: 'high' }], level: '초보', minGrade: 'B-', targetMinutes: 90 }, real);
      expect(p.estimatedSec, part).toBeGreaterThan(before + 5 * 60);
      expect(p.slack?.cause, part).toEqual(['cap']);
    }
  });  it('부위 제안 조사: 받침 있으면 "을", 없으면 "를"', () => {
    const chest = generatePlan({ parts: [{ part: '가슴', priority: 'high' }], level: '중급', minGrade: 'B-', targetMinutes: 75 }, real);
    expect(chest.reasons.some((r) => r.includes('삼두·어깨를 더하면'))).toBe(true);
    const tri = generatePlan({ parts: [{ part: '삼두', priority: 'high' }], level: '중급', minGrade: 'B-', targetMinutes: 90 }, real);
    expect(tri.reasons.some((r) => r.includes('이두·가슴을 더하면'))).toBe(true);
  });
});

describe('짝 캐시는 실제로 고른 운동 기준 (D-041 검토 2차 필수 1)', () => {
  it('재현: 등(낮음)+전완·악력(높음) 중급 120분, 어깨 초보 90분 컴파운드 → 검증 위반 0', () => {
    const qs: PlanRequest[] = [
      { parts: [{ part: '전완·악력', priority: 'high' }, { part: '등', priority: 'low' }], level: '중급', minGrade: 'B-', targetMinutes: 120, groupings: ['superset', 'compound'] },
      { parts: [{ part: '어깨', priority: 'high' }], level: '초보', minGrade: 'B-', targetMinutes: 90, groupings: ['compound'] },
      // 이전 키(운동 수)였을 때 '무거운 운동 묶음: 뉴트럴 그립 풀업+랙풀' (검토 2차 재현을 격자 탐색으로 고정)
      { parts: [{ part: '전완·악력', priority: 'high' }, { part: '등', priority: 'high' }], level: '중급', minGrade: 'A-', targetMinutes: 60, groupings: ['compound'], groupingPreference: 'prefer' },
      { parts: [{ part: '전완·악력', priority: 'low' }, { part: '등', priority: 'low' }], level: '상급', minGrade: 'A-', targetMinutes: 60, groupings: ['compound'], groupingPreference: 'prefer' },
    ];
    for (const q of qs) expect(validatePlan(generatePlan(q, real), q, real)).toEqual([]);
  });
  it('여러 부위 + 묶음 허용 + 모든 수준 전수 (2부위 28쌍·3부위 일부 × 3수준 × 60·120분): 검증 위반 0, 원인 "시간"뿐이면 12분 이하', () => {
    const P: Part[] = ['가슴', '등', '어깨', '이두', '삼두', '전완·악력', '하체', '코어'];
    const combos: Part[][] = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) combos.push([P[i]!, P[j]!]);
    for (let i = 0; i < P.length; i++) combos.push([P[i]!, P[(i + 3) % 8]!, P[(i + 5) % 8]!]);
    const pr = ['high', 'low', 'normal'] as const;
    for (const parts of combos) for (const level of LEVELS) for (const t of [60, 120]) {
      const q: PlanRequest = { parts: parts.map((part, k) => ({ part, priority: pr[k]! })), level, minGrade: 'B-', targetMinutes: t, groupings: ['superset', 'compound'] };
      const p = generatePlan(q, real);
      const label = `${parts.join('+')} ${level} ${t}`;
      expect(validatePlan(p, q, real), label).toEqual([]);
      if (p.slack?.cause.every((c) => c === 'time')) expect(t * 60 - p.estimatedSec, label).toBeLessThanOrEqual(12 * 60);
    }
  });
});
