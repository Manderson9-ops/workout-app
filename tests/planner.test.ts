import { describe, expect, it } from 'vitest';
import baseFile from '../data/exercises.base.json';
import wkFile from '../data/exercises.workout_k.json';
import stapleFile from '../data/staples.json';
import { buildExercises, validateStaples } from '../src/core/exercises';
import type { WorkoutKData } from '../src/core/exercises';
import { generatePlan } from '../src/core/planner';
import type { PlanRequest, Priority, Grouping } from '../src/core/planner';
import { validatePlan } from '../src/core/validatePlan';
import { setTime, blockTime, warmupFor, planTime, targetReps, DEFAULT_TIME } from '../src/core/time';
import type { Exercise, BuiltExercise, Part, Level, Equipment } from '../src/core/types';
import { PARTS, LEVELS, EQUIPMENT } from '../src/core/types';
import { GRADES } from '../src/core/version';
import type { Grade } from '../src/core/version';

const real = buildExercises(baseFile.exercises as Exercise[], wkFile as unknown as WorkoutKData, stapleFile.order as Partial<Record<Part, string[]>>);
/** 5.7.1 예시 가정: 다관절 8회, 단관절 12회 */
const ex571 = real.map((e) => ({ ...e, default_reps: (e.mechanics === 'compound' ? [8, 8] : [12, 12]) as [number, number] }));
const names = (p: ReturnType<typeof generatePlan>) => p.blocks.map((b) => b.items.map((i) => i.exerciseId).join('+'));
const req571 = (t: number | undefined, extra: Partial<PlanRequest> = {}): PlanRequest => ({
  parts: [{ part: '등', priority: 'high' }, { part: '삼두', priority: 'normal' }], level: '중급', minGrade: 'A-', targetMinutes: t, groupings: ['superset'], ...extra,
});

describe('시간 모델 (BLUEPRINT 5.6)', () => {
  const e = (x: Partial<Exercise>): Exercise => ({ id: 'x', name_ko: 'x', family: 'f', part: '등', muscles: ['m'], pattern: 'V_PULL', mechanics: 'compound', equipment: ['cable'], ...x });
  it('세트 시간: 양쪽, 한쪽씩, 시간 운동', () => {
    expect(setTime(e({}), 8)).toBe(44);
    expect(setTime(e({ unilateral: true }), 8)).toBe(76);
    expect(setTime(e({ measure: 'time', default_seconds: 45 }), 0)).toBe(65);
    expect(setTime(e({ measure: 'time' }), 0)).toBe(50);
    expect(setTime(e({ sec_per_rep: 4, setup_sec: 10 }), 5)).toBe(30);
  });
  it('목표 횟수 = 기본 범위 가운데(내림)', () => {
    expect(targetReps(e({}))).toBe(8);
    expect(targetReps(e({ mechanics: 'isolation' }))).toBe(12);
    expect(targetReps(e({ default_reps: [8, 12] }))).toBe(10);
  });
  it('블록 시간: 단일, 묶음(세트 수가 다름), 드롭세트', () => {
    const a = e({}), b = e({ mechanics: 'isolation' });
    expect(blockTime({ kind: 'single', items: [{ exercise: a, sets: 3, reps: 8 }], rest: 150 })).toBe(3 * 44 + 2 * 150);
    // 라운드 1~3: 44+56+10, 라운드 4: 56만
    expect(blockTime({ kind: 'group', items: [{ exercise: a, sets: 3, reps: 8 }, { exercise: b, sets: 4, reps: 12 }], roundRest: 120 })).toBe(3 * 110 + 56 + 3 * 120);
    // 마지막 세트에 드롭 2회 × (4회×3초 + 10초)
    expect(blockTime({ kind: 'single', items: [{ exercise: a, sets: 2, reps: 8, drops: 2, dropReps: 4 }], rest: 90 })).toBe(2 * 44 + 90 + 2 * 22);
    expect(blockTime({ kind: 'single', items: [{ exercise: a, sets: 1, reps: 8, drops: 1 }], rest: 90 })).toBe(44 + 22);
  });
  it('웜업: 목표 없음·30분 이상 8분, 20~30분 4분, 20분 미만 웜업 세트, 하체 +2분', () => {
    const it1 = { exercise: e({}), sets: 1, reps: 8 };
    expect(warmupFor(undefined, false, it1).seconds).toBe(480);
    expect(warmupFor(45, true, it1).seconds).toBe(600);
    expect(warmupFor(25, false, it1).seconds).toBe(240);
    expect(warmupFor(15, true, it1)).toMatchObject({ kind: 'sets', seconds: 44 + 60 });
    expect(warmupFor(15, false, undefined).kind).toBe('none');
    expect(planTime(100, [])).toBe(100);
    expect(planTime(0, [{ kind: 'single', items: [it1], rest: 0 }, { kind: 'single', items: [it1], rest: 0 }])).toBe(44 + 44 + 90);
    expect(DEFAULT_TIME.restStep).toBe(15);
  });
});

describe('BLUEPRINT 5.7.1 계산 예시 (고정 사례)', () => {
  it('기본안 51분 00초: 등 원암 랫풀다운·뉴트럴 풀업·켈소 슈러그, 삼두 JM·오버헤드 케이블', () => {
    const p = generatePlan(req571(undefined), ex571);
    expect(p.estimatedSec).toBe(3060);
    expect(names(p)).toEqual(['one_arm_lat_pulldown', 'pull_up_neutral', 'kelso_shrug', 'smith_jm_press', 'oh_cable_ext_single']);
  });
  it('60분: 등은 상한(11)에 걸려 그대로, 삼두 긴 로프 푸시다운 추가 → 58분 18초', () => {
    const p = generatePlan(req571(60), ex571);
    expect(p.estimatedSec).toBe(3498);
    expect(names(p)).toContain('long_rope_pushdown');
    expect(p.rest).toEqual({ compound: 150, isolation: 90, round: 120 });
    expect(p.reasons.some((r) => r.startsWith('등:') && r.includes('상한에 걸려'))).toBe(true);
  });
  it('45분: 슈퍼세트 2쌍(원암+오버헤드 케이블, 켈소+JM) → 41분 00초, 휴식 그대로', () => {
    const p = generatePlan(req571(45), ex571);
    expect(p.estimatedSec).toBe(2460);
    expect(names(p)).toEqual(['one_arm_lat_pulldown+oh_cable_ext_single', 'pull_up_neutral', 'kelso_shrug+smith_jm_press']);
    expect(p.blocks.filter((b) => b.kind === 'superset')).toHaveLength(2);
  });
  it('45분 변형(풀업 즐겨찾기): 짝이 바뀌어 2쌍이면 39분(창 밖) → 3쌍 + 긴 로프 추가, 43분 18초 (D-013 정정)', () => {
    const p = generatePlan(req571(45, { favorites: ['pull_up_neutral'] }), ex571);
    expect(p.estimatedSec).toBe(2598);
    expect(names(p)).toEqual(['pull_up_neutral+smith_jm_press', 'one_arm_lat_pulldown+oh_cable_ext_single', 'kelso_shrug+long_rope_pushdown']);
  });
  it('같은 입력 → 같은 결과, 잠금 재생성 → 같은 결과', () => {
    for (const t of [undefined, 30, 45, 60, 90]) {
      const r = req571(t);
      const a = generatePlan(r, ex571), b = generatePlan(r, ex571);
      expect(b).toEqual(a);
      const locked = a.blocks.flatMap((bl) => bl.items.map((i) => ({ exerciseId: i.exerciseId, part: i.part, sets: i.sets })));
      const c = generatePlan({ ...r, locked }, ex571);
      expect(names(c)).toEqual(names(a));
      expect(c.estimatedSec).toBe(a.estimatedSec);
    }
  });
});

describe('앱 기본 추천 순서 (M-14)', () => {
  it('영상 등급 없는 부위는 대표 운동부터: 가슴 벤치프레스, 하체 백스쿼트', () => {
    const chest = generatePlan({ parts: [{ part: '가슴', priority: 'high' }], level: '중급' }, real);
    expect(chest.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))).toEqual(expect.arrayContaining(['bench_press', 'incline_db_press', 'cable_fly']));
    const legs = generatePlan({ parts: [{ part: '하체', priority: 'high' }], level: '중급' }, real);
    expect(legs.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))).toEqual(expect.arrayContaining(['back_squat', 'romanian_deadlift', 'leg_press']));
  });
  it('영상 등급 운동의 순서에는 영향 없음 (5.7.1 기본안 동일)', () => {
    const withStaples = buildExercises(baseFile.exercises as Exercise[], wkFile as unknown as WorkoutKData, { 등: ['kelso_shrug'] });
    expect(generatePlan(req571(undefined), withStaples.map((e) => ({ ...e, default_reps: (e.mechanics === 'compound' ? [8, 8] : [12, 12]) as [number, number] }))).blocks.map((b) => b.items[0]!.exerciseId))
      .toEqual(['one_arm_lat_pulldown', 'pull_up_neutral', 'kelso_shrug', 'smith_jm_press', 'oh_cable_ext_single']);
  });
  it('추천 순서 데이터 검증', () => {
    expect(validateStaples(real, stapleFile.order as Partial<Record<Part, string[]>>)).toEqual([]);
    expect(validateStaples(real, { 가슴: ['ghost', 'lat_pulldown', 'bench_press', 'bench_press'], ['목' as Part]: [] })).toEqual(['중복: 가슴', '없는 운동: 가슴 ghost', '부위 후보 아님: 가슴 lat_pulldown', '부위 값: 목']);
  });
});

describe('특수 상황', () => {
  const base: PlanRequest = { parts: [{ part: '가슴', priority: 'high' }], level: '중급' };
  it('등급 미달 대체: 가슴은 영상 등급이 없어 S 이상이 없음 → 최고 등급 1개로 대체', () => {
    const p = generatePlan({ ...base, minGrade: 'S' }, real);
    expect(p.blocks.flatMap((b) => b.items).every((i) => i.substituted)).toBe(true);
    expect(p.reasons.some((r) => r.includes('등급 미달 대체'))).toBe(true);
    expect(validatePlan(p, { ...base, minGrade: 'S' }, real)).toEqual([]);
  });
  it('장비가 없으면 부위가 빠지고 이유 표시', () => {
    const r: PlanRequest = { ...base, parts: [{ part: '가슴', priority: 'high' }, { part: '등', priority: 'normal' }], equipment: ['band'] };
    const p = generatePlan(r, real);
    expect(p.missingParts).toContain('가슴');
    const none = generatePlan({ ...base, equipment: [] }, real);
    expect(none.status).toBe('empty');
    expect(validatePlan(none, { ...base, equipment: [] }, real)).toEqual([]);
    expect(validatePlan(p, r, real)).toEqual([]);
  });
  it('시간이 너무 짧으면 우선순위 높은 부위만(reduced), 그래도 안 되면 too_short', () => {
    const r: PlanRequest = { parts: [{ part: '하체', priority: 'high' }, { part: '등', priority: 'normal' }, { part: '가슴', priority: 'low' }], level: '중급', targetMinutes: 12 };
    const p = generatePlan(r, real);
    expect(p.status).toBe('reduced');
    expect(p.missingParts).toEqual(expect.arrayContaining(['등', '가슴']));
    expect(p.estimatedSec).toBeLessThanOrEqual(720);
    expect(validatePlan(p, r, real)).toEqual([]);
    const tiny = generatePlan({ ...r, targetMinutes: 2 }, real);
    expect(tiny.status).toBe('too_short');
    expect(tiny.reasons.some((x) => /분 이상 필요/.test(x))).toBe(true);
    expect(validatePlan(tiny, { ...r, targetMinutes: 2 }, real)).toEqual([]);
    const tinyOne = generatePlan({ parts: [{ part: '등', priority: 'high' }], level: '중급', targetMinutes: 1 }, real);
    expect(tinyOne.status).toBe('too_short');
  });
  it('무거운 힌지 1개 (M-12): 하체+등, 최소 등급 D', () => {
    const r: PlanRequest = { parts: [{ part: '하체', priority: 'high' }, { part: '등', priority: 'high' }], level: '상급', minGrade: 'D', favorites: ['deadlift', 'rack_pull', 'romanian_deadlift', 'good_morning'] };
    const p = generatePlan(r, real);
    const heavyHinges = p.blocks.flatMap((b) => b.items).filter((i) => ['deadlift', 'rack_pull', 'romanian_deadlift', 'good_morning', 'sumo_deadlift', 'trap_bar_deadlift'].includes(i.exerciseId));
    expect(heavyHinges.length).toBeLessThanOrEqual(1);
    expect(validatePlan(p, r, real)).toEqual([]);
  });
  it('컴파운드 세트: 부위 하나, 목표 시간 부족', () => {
    const r: PlanRequest = { parts: [{ part: '삼두', priority: 'high' }], level: '중급', targetMinutes: 22, groupings: ['superset', 'compound'] };
    const p = generatePlan(r, real);
    expect(p.blocks.some((b) => b.kind === 'compound')).toBe(true);
    expect(validatePlan(p, r, real)).toEqual([]);
  });
  it('묶음 "우선"이면 시간 목표가 없어도 묶음', () => {
    const r: PlanRequest = { ...req571(undefined), groupingPreference: 'prefer' };
    expect(generatePlan(r, ex571).blocks.some((b) => b.kind === 'superset')).toBe(true);
  });
  it('휴식 줄이기 순서: 단관절 → 묶음 → 다관절', () => {
    const r: PlanRequest = { parts: [{ part: '이두', priority: 'high' }], level: '중급', targetMinutes: 24 };
    const p = generatePlan(r, real);
    expect(validatePlan(p, r, real)).toEqual([]);
    if (p.rest.compound < 150) expect(p.rest.isolation).toBe(60);
  });
  it('사용자 등급과 세부 목표 반영', () => {
    const r: PlanRequest = { parts: [{ part: '전완·악력', priority: 'high' }], level: '중급', minGrade: 'A', subGoals: { '전완·악력': '악력' }, userGrades: { farmers_walk: 'S' } };
    const ids = generatePlan(r, real).blocks.flatMap((b) => b.items.map((i) => i.exerciseId));
    expect(ids).toEqual(expect.arrayContaining(['farmers_walk', 'towel_pull_up']));
  });
});

// ---------- 무작위 검증 500건 (고정 시드) ----------
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randomRequest(r: () => number): PlanRequest {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const n = 1 + Math.floor(r() * 8);
  const parts = [...PARTS].sort(() => r() - 0.5).slice(0, n).map((part) => ({ part: part as Part, priority: pick(['high', 'normal', 'low'] as Priority[]) }));
  const eq = [...EQUIPMENT].filter(() => r() > 0.25) as Equipment[];
  return {
    parts, level: pick(LEVELS) as Level, minGrade: pick(['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D'] as Grade[]),
    targetMinutes: r() < 0.2 ? undefined : 10 + Math.floor(r() * 111),
    groupings: (['superset', 'compound'] as Grouping[]).filter(() => r() > 0.5),
    groupingPreference: r() < 0.2 ? 'prefer' : 'when_needed',
    equipment: eq.length ? eq : ['bodyweight'],
    excluded: real.filter(() => r() < 0.05).map((e) => e.id),
  };
}

describe('무작위 입력 500건 + 경계 사례: 검증 규칙 위반 0 (BLUEPRINT 5.9, 7.1)', () => {
  const r = rng(20260930);
  const reqs = Array.from({ length: 500 }, () => randomRequest(r));
  const edge: PlanRequest[] = [
    ...PARTS.map((part) => ({ parts: [{ part, priority: 'high' as Priority }], level: '초보' as Level, targetMinutes: 20 })),
    ...PARTS.map((part) => ({ parts: [{ part, priority: 'high' as Priority }], level: '상급' as Level, minGrade: 'S' as Grade, targetMinutes: 120, groupings: ['compound'] as Grouping[] })),
    { parts: PARTS.map((part) => ({ part, priority: 'high' as Priority })), level: '중급', targetMinutes: 120, groupings: ['superset', 'compound'] },
    { parts: PARTS.map((part) => ({ part, priority: 'low' as Priority })), level: '중급', targetMinutes: 30 },
    { parts: PARTS.map((part) => ({ part, priority: 'normal' as Priority })), level: '중급' },
    { parts: [{ part: '하체', priority: 'high' }], level: '중급', targetMinutes: 5 },
    { parts: [{ part: '하체', priority: 'high' }], level: '중급', targetMinutes: 180 },
    { parts: [{ part: '등', priority: 'high' }], level: '중급', equipment: [] },
    { parts: [{ part: '등', priority: 'high' }], level: '중급', excluded: real.map((e) => e.id) },
    { parts: [{ part: '가슴', priority: 'high' }, { part: '등', priority: 'high' }], level: '중급', targetMinutes: 40, groupings: ['superset'], allowHeavyInGroups: true },
    { parts: [{ part: '가슴', priority: 'high' }, { part: '등', priority: 'high' }], level: '중급', targetMinutes: 40, groupings: ['superset'], groupingPreference: 'prefer' },
    { parts: [{ part: '삼두', priority: 'high' }, { part: '이두', priority: 'normal' }], level: '초보', minGrade: 'F', targetMinutes: 35, groupings: ['superset'] },
    { parts: [{ part: '코어', priority: 'high' }, { part: '전완·악력', priority: 'normal' }], level: '중급', targetMinutes: 15 },
    { parts: [{ part: '하체', priority: 'high' }, { part: '등', priority: 'high' }], level: '상급', minGrade: 'D', targetMinutes: 90 },
    { parts: [{ part: '등', priority: 'high' }, { part: '삼두', priority: 'normal' }], level: '초보', targetMinutes: 50, groupings: ['superset'], locked: [{ exerciseId: 'lat_pulldown', part: '등', sets: 5 }, { exerciseId: 'dip', part: '삼두', sets: 1 }] },
    { parts: [{ part: '이두', priority: 'high' }], level: '중급', targetMinutes: 10, groupings: ['compound'] },
    { parts: [{ part: '등', priority: 'high' }, { part: '전완·악력', priority: 'low' }], level: '중급', subGoals: { '등': '광배 집중', '전완·악력': '전완 근성장' }, minGrade: 'D', targetMinutes: 45 },
  ];
  it(`무작위 ${reqs.length}건, 경계 ${edge.length}건 모두 통과`, () => {
    const failures: string[] = [];
    for (const q of [...reqs, ...edge]) {
      const p = generatePlan(q, real);
      const errs = validatePlan(p, q, real);
      if (errs.length) failures.push(`${JSON.stringify(q).slice(0, 200)} → ${errs.join('; ')}`);
      if (q.targetMinutes !== undefined && p.status === 'ok') expect(p.estimatedSec).toBeLessThanOrEqual(q.targetMinutes * 60);
      // 탐색 중 빠른 계산(증분)과 최종 블록으로 다시 계산한 시간이 같아야 함
      if (p.blocks.length) {
        const recomputed = p.warmup.seconds + p.blocks.reduce((s, b) => s + b.timeSec, 0) + (p.blocks.length - 1) * (DEFAULT_TIME.betweenRestSec + DEFAULT_TIME.moveSec);
        if (recomputed !== p.estimatedSec) failures.push(`시간 불일치 ${recomputed} != ${p.estimatedSec}: ${JSON.stringify(q).slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(edge.length).toBeGreaterThanOrEqual(30);
  });
  it('성능: 500건 중 95%가 200ms 이하, 최악 사례(부위 8개 모두 높음, 묶음 모두 허용, 120분) 200ms 이하', () => {
    const times = reqs.map((q) => { const t = performance.now(); generatePlan(q, real); return performance.now() - t; }).sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(200);
    const worst = edge[16]!;
    const t0 = performance.now(); generatePlan(worst, real); const worstMs = performance.now() - t0;
    expect(worstMs).toBeLessThan(200);
    const four: PlanRequest = { parts: (['가슴', '등', '어깨', '하체'] as Part[]).map((part) => ({ part, priority: 'high' as Priority })), level: '중급', targetMinutes: 120, groupings: ['superset'] };
    const t1 = performance.now(); generatePlan(four, real); expect(performance.now() - t1).toBeLessThan(200);
  });
});

describe('검증 함수가 위반을 잡는지', () => {
  const r = req571(45);
  const good = generatePlan(r, ex571);
  const clone = () => JSON.parse(JSON.stringify(good)) as typeof good;
  it('정상 플랜은 오류 0', () => expect(validatePlan(good, r, ex571)).toEqual([]));
  it('여러 위반', () => {
    const p = clone();
    const it0 = p.blocks[1]!.items[0]!;
    it0.grade = 'D'; it0.sets = 1;
    p.blocks[1]!.items.push({ ...it0 });
    p.estimatedSec = 9999;
    const errs = validatePlan(p, { ...r, excluded: [it0.exerciseId], equipment: ['band'] }, ex571);
    for (const x of ['최소 등급 미만', '2세트 미만', '제외한 운동', '없는 장비', '같은 운동 중복', '같은 묶음', '단일 블록', '목표 시간 초과']) expect(errs.some((e) => e.includes(x))).toBe(true);
  });
  it('묶음 위반, 세트 초과, 추정 표시, 부위 누락, 창 밖 이유, 무거운 힌지, 없는 운동', () => {
    const p = clone();
    const ss = p.blocks[0]!;
    ss.items[1]!.part = ss.items[0]!.part;
    ss.items[0]!.sets = 5; ss.items[0]!.estimated = true;
    p.blocks[2]!.kind = 'compound';
    p.blocks.push({ kind: 'superset', items: [{ ...p.blocks[1]!.items[0]!, exerciseId: 'deadlift' }], timeSec: 0 });
    p.blocks.push({ kind: 'single', items: [{ ...p.blocks[1]!.items[0]!, exerciseId: 'rack_pull' }], timeSec: 0 });
    p.estimatedSec = 100;
    const errs = validatePlan(p, { ...r, parts: [...r.parts, { part: '가슴', priority: 'low' }] }, ex571);
    for (const x of ['슈퍼세트가 같은 부위', '4세트 초과', '추정 표시', '컴파운드 세트가 다른 부위', '묶음 블록 운동 수', '무거운 힌지', '부위 누락', '이유 없음']) expect(errs.some((e) => e.includes(x))).toBe(true);
    const q = clone(); q.blocks[0]!.items[0]!.exerciseId = 'ghost';
    expect(validatePlan(q, r, ex571)).toContain('없는 운동 id');
  });
  it('슈퍼세트 근육 겹침, 무거운 운동 묶음, 부위 상한, 빈 플랜, 상태 이유', () => {
    const p = clone();
    p.blocks[0]!.items[0]!.exerciseId = 'pull_up';
    p.blocks[0]!.items[1]!.exerciseId = 'lat_pulldown';
    p.blocks[2]!.items[0]!.exerciseId = 'bench_press';
    p.blocks[1]!.items[0]!.sets = 12;
    let errs = validatePlan(p, r, ex571);
    for (const x of ['주 근육 겹침', '무거운 운동 묶음', '상한 초과']) expect(errs.some((e) => e.includes(x))).toBe(true);
    const empty = { ...clone(), blocks: [], status: 'reduced' as const, reasons: [] };
    errs = validatePlan(empty, r, ex571);
    expect(errs).toEqual(expect.arrayContaining(['운동이 없음', '상태 이유 없음']));
  });
});

// 등급 목록 사용 (타입 참조 유지)
it('등급 목록', () => expect(GRADES[0]).toBe('S'));
void (null as unknown as BuiltExercise);
