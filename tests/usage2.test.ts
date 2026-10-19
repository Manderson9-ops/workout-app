/**
 * 사용 분석 개선 2단계: D-067 루틴을 내 속도에 맞추기, D-068 끝낼 때 루틴 반영 묻기 (순수 함수)
 */
import { describe, expect, it } from 'vitest';
import type { Routine, RoutineBlock, SetLog, Workout } from '../src/core/session';
import { startWorkout, replaceItem, appendExercise, moveWorkoutBlock, skipItem, addSet, completeSet } from '../src/core/session';
import {
  personalPace, paceEstimate, cutCount, paceLabel, targetMinutesOf, recentSets, fitRoutine, duplicateNames, routineSets, PACE_RULE, FIT_MIN_SETS,
} from '../src/core/routineFit';
import type { Pace, Recent } from '../src/core/routineFit';
import { routineDiff, diffText, routineFromWorkout, newRoutineFromWorkout } from '../src/core/routineDiff';
import type { Part } from '../src/core/types';

const T0 = Date.parse('2026-10-19T02:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

/** 세트 n개를 start+lead부터 gap초 간격으로 끝낸 운동 */
function session(id: string, start: number, n: number, gapSec: number, leadSec = 30, endPadMin = 3): Workout {
  const sets: SetLog[] = Array.from({ length: n }, (_, k) => ({ warmup: false, done: true, weight: 50, reps: 10, doneAt: iso(start + leadSec * 1000 + k * gapSec * 1000) }));
  const end = start + leadSec * 1000 + (n - 1) * gapSec * 1000 + endPadMin * MIN;
  return { id, name: id, startedAt: iso(start), endedAt: iso(end), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench', target: { sets: n, reps: 10 }, sets }] }] };
}
const DAY = 86_400_000;

describe('D-067 내 속도', () => {
  it('세 번 미만이면 없음 (앱 기본 예상을 씀)', () => {
    expect(personalPace([])).toBeUndefined();
    expect(personalPace([session('a', T0, 20, 150), session('b', T0 + DAY, 20, 150)])).toBeUndefined();
  });

  it('가운데 값, 시작 → 첫 세트도 기록에서', () => {
    const h = [session('a', T0, 20, 120, 20), session('b', T0 + DAY, 20, 150, 30), session('c', T0 + 2 * DAY, 20, 180, 40)];
    expect(personalPace(h)).toEqual({ secPerSet: 150, leadSec: 30, n: 3 });
  });

  it('0세트·12시간 넘는 기록·늦게 온 사본은 빼고, 최근 8회만', () => {
    const zero: Workout = { ...session('z', T0 + 9 * DAY, 1, 100), blocks: [] };
    const long = session('l', T0 + 10 * DAY, 20, 3000); // 16시간
    const copy = { ...session('p', T0 + 11 * DAY, 20, 300), pendingMerge: 'a' };
    const old = Array.from({ length: 8 }, (_, k) => session(`o${k}`, T0 - (k + 1) * DAY, 20, 300));
    const recent = Array.from({ length: 8 }, (_, k) => session(`r${k}`, T0 + k * DAY, 20, 140));
    const p = personalPace([zero, long, copy, ...old, ...recent])!;
    expect(p.secPerSet).toBe(140);
    expect(p.n).toBe(8);
  });

  it('웜업 세트는 세트당 시간에 넣지 않음, 시작 → 첫 세트에는 넣음', () => {
    const h = [0, 1, 2].map((k) => {
      const w = session(`w${k}`, T0 + k * DAY, 10, 150, 120);
      w.blocks[0]!.items[0]!.sets.unshift({ warmup: true, done: true, reps: 15, doneAt: iso(T0 + k * DAY + 40_000) });
      return w;
    });
    expect(personalPace(h)).toEqual({ secPerSet: 150, leadSec: 40, n: 3 });
  });

  it('범위 밖 값은 자름', () => {
    const fast = [0, 1, 2].map((k) => session(`f${k}`, T0 + k * DAY, 10, 5));
    expect(personalPace(fast)!.secPerSet).toBe(PACE_RULE.minSec);
    const slow = [0, 1, 2].map((k) => session(`s${k}`, T0 + k * DAY, 5, 1500, 2000));
    expect(personalPace(slow)).toMatchObject({ secPerSet: PACE_RULE.maxSec, leadSec: PACE_RULE.leadMaxSec });
  });

  it('목표 시간: 이름의 "N분", 없으면 설정값', () => {
    expect(targetMinutesOf('가슴+등 75분', 60)).toBe(75);
    expect(targetMinutesOf('이두+삼두+어깨 75분.2', 60)).toBe(75);
    expect(targetMinutesOf('하체 데이', 60)).toBe(60);
    expect(targetMinutesOf('5분 코어', 60)).toBe(60); // 10분 미만은 이름 숫자로 안 봄
  });
});

// ---- 사용자 루틴 모양 (실제 기록의 블록·세트 수, 운동 이름은 데이터 파일 ID 대신 짧은 이름) ----
const PART: Record<string, Part> = {
  bench: '가슴', incline_db: '가슴', crossover: '가슴', decline: '가슴', pecdeck: '가슴', dips: '가슴',
  latpull: '등', row: '등', onearm_row: '등', neutral_pullup: '등', rackpull: '등', kelso: '등',
  squat: '하체', legpress: '하체', legext: '하체', rdl: '하체', legcurl: '하체', calf: '하체',
  curl: '이두', db_curl: '이두', pushdown: '삼두', rope: '삼두', press: '어깨', lateral: '어깨', reardelt: '어깨',
};
const partOf = (id: string) => PART[id];
const one = (exerciseId: string, sets: number, restSec = 90): RoutineBlock => ({ kind: 'single', items: [{ exerciseId, sets, reps: 10 }], restSec, roundRestSec: 120, transitionSec: 10 });
const pair = (a: string, b: string, sets: number): RoutineBlock => ({ kind: 'superset', items: [{ exerciseId: a, sets, reps: 10 }, { exerciseId: b, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const mk = (id: string, name: string, blocks: RoutineBlock[], createdAt = iso(T0)): Routine => ({ id, name, createdAt, updatedAt: createdAt, blocks, warmupSec: 480 });
/** 가슴+등 75분: 9블록 56세트 */
const chestBack = mk('r-cb', '가슴+등 75분', [
  one('bench', 5), one('latpull', 5), pair('incline_db', 'row', 4), pair('crossover', 'onearm_row', 4), one('decline', 5),
  one('neutral_pullup', 5), one('pecdeck', 5), one('rackpull', 5), pair('kelso', 'dips', 5),
]);
/** 하체 75분: 6블록 28세트 */
const legs = mk('r-legs', '하체 75분', [one('squat', 5), one('legpress', 5), one('legext', 5), one('rdl', 4), one('legcurl', 5), one('calf', 4)]);
/** 이두+삼두+어깨 75분: 35세트 */
const arms = mk('r-arms', '이두+삼두+어깨 75분', [pair('curl', 'pushdown', 4), one('press', 5), pair('db_curl', 'rope', 4), one('lateral', 5), one('reardelt', 5), one('db_curl2', 4)]);
PART.db_curl2 = '이두';
const PACE: Pace = { secPerSet: 150, leadSec: 30, n: 8 };
/** 최근 2주: 가슴·하체 많이, 등·어깨·이두 적게 (F1) */
const recent: Recent = {
  part: new Map<Part, number>([['하체', 54], ['가슴', 50], ['삼두', 20], ['등', 16], ['어깨', 10], ['이두', 10]]),
  ex: new Map([['bench', 20], ['decline', 10], ['squat', 15], ['legext', 18], ['legpress', 12]]),
};

describe('D-067 루틴 예상·못 할 운동', () => {
  it('세트 수로 예상', () => {
    expect(routineSets(chestBack)).toBe(56);
    expect(paceEstimate(chestBack, PACE)).toBe(30 + 45 + 55 * 150);
    expect(paceEstimate(mk('e', 'e', []), PACE)).toBe(0);
  });

  it('목표 시간에 시작도 못 하는 운동 수 (묶음은 라운드로)', () => {
    // 75분 = 4500초 → 30번째 세트(0부터 29)까지 시작 가능
    expect(cutCount(chestBack, PACE, 75 * 60)).toBe(5); // 6~9블록: 풀업·펙덱·랙풀·켈소·딥스
    expect(cutCount(legs, PACE, 75 * 60)).toBe(0);
  });

  it('한 줄 글', () => {
    expect(paceLabel(chestBack, PACE, 75)?.text).toBe('내 속도로 약 139분 · 목표 75분이면 못 할 운동 5개');
    expect(paceLabel(legs, PACE, 75)?.text).toBe('내 속도로 약 69분 · 목표 75분 안');
    expect(paceLabel(legs, undefined, 75)).toBeUndefined();
    expect(paceLabel(mk('e', 'e', []), PACE, 75)).toBeUndefined();
  });

  it('최근 2주 부위·운동 세트', () => {
    const h = [session('a', T0 - 3 * DAY, 10, 150), session('b', T0 - 20 * DAY, 10, 150)];
    const r = recentSets(h, partOf, T0);
    expect(r.part.get('가슴')).toBe(10);
    expect(r.ex.get('bench')).toBe(10);
  });
});

describe('D-067 내 시간에 맞추기 (운동당 세트 줄이기)', () => {
  const est = (r: Routine) => paceEstimate(r, PACE);

  it('가슴+등 9블록 56세트 → 75분 안', () => {
    const f = fitRoutine({ routine: chestBack, targetSec: 75 * 60, estimate: est, partOf, recent });
    expect(f.fits).toBe(true);
    expect(f.afterSec).toBeLessThanOrEqual(75 * 60);
    expect(f.beforeSec).toBe(est(chestBack));
    expect(routineSets(f.routine)).toBe(30);
    // 운동은 하나도 빠지지 않음, 2세트 아래로 안 줄임
    expect(f.routine.blocks.flatMap((b) => b.items).length).toBe(12);
    expect(Math.min(...f.routine.blocks.flatMap((b) => b.items.map((i) => i.sets)))).toBeGreaterThanOrEqual(FIT_MIN_SETS);
    // 덜 한 부위(등)가 들어 있는 블록이 앞으로, 묶음은 통째로
    expect(f.moved).toBe(true);
    expect(f.routine.blocks.map((b) => b.items.map((i) => i.exerciseId).join('+'))).toEqual([
      'latpull', 'incline_db+row', 'crossover+onearm_row', 'neutral_pullup', 'rackpull', 'kelso+dips', 'bench', 'decline', 'pecdeck',
    ]);
    // 묶음 안 세트 수는 같음
    for (const b of f.routine.blocks) expect(new Set(b.items.map((i) => i.sets)).size).toBe(1);
    // 많이 한 가슴부터 줄임: 가슴 단일 블록은 모두 2세트, 등 단일은 덜 줄임
    const sets = (id: string) => f.routine.blocks.flatMap((b) => b.items).find((i) => i.exerciseId === id)!.sets;
    expect([sets('bench'), sets('decline'), sets('pecdeck')]).toEqual([2, 2, 2]);
    expect(sets('latpull')).toBeGreaterThan(2);
    // 미리 보기 줄: 전 → 후, 원래 자리
    const bench = f.rows.find((x) => x.exerciseId === 'bench')!;
    expect(bench).toMatchObject({ fromBlock: 0, toBlock: 6, before: 5, after: 2, letter: '' });
    expect(f.rows.find((x) => x.exerciseId === 'dips')).toMatchObject({ letter: 'B', before: 5 });
    // 이제 못 할 운동 없음
    expect(cutCount(f.routine, PACE, 75 * 60)).toBe(0);
  });

  it('하체 28세트는 이미 75분 안: 세트는 그대로', () => {
    const f = fitRoutine({ routine: legs, targetSec: 75 * 60, estimate: est, partOf, recent });
    expect(f.fits).toBe(true);
    expect(f.reduced).toBe(0);
    expect(routineSets(f.routine)).toBe(28);
  });

  it('이두+삼두+어깨 35세트 → 60분: 많이 한 삼두부터, 어깨·이두 블록이 앞으로', () => {
    const f = fitRoutine({ routine: arms, targetSec: 60 * 60, estimate: est, partOf, recent });
    expect(f.fits).toBe(true);
    expect(routineSets(f.routine)).toBeLessThanOrEqual(24);
    expect(f.routine.blocks[0]!.items[0]!.exerciseId).not.toBe('press'); // 어깨·이두(10) 먼저, 같으면 원래 순서
    expect(f.routine.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['curl', 'press', 'db_curl', 'lateral', 'reardelt', 'db_curl2']);
  });

  it('2세트까지 줄여도 길면 맞지 않음으로', () => {
    const f = fitRoutine({ routine: chestBack, targetSec: 30 * 60, estimate: est, partOf, recent });
    expect(f.fits).toBe(false);
    expect(routineSets(f.routine)).toBe(24);
  });

  it('원래 1세트·2세트 운동은 건드리지 않음, 원래 루틴은 바꾸지 않음', () => {
    const r = mk('s', '짧은 10분', [one('bench', 1), one('latpull', 2), one('row', 6)]);
    const f = fitRoutine({ routine: r, targetSec: 10 * 60, estimate: est, partOf, recent });
    const by = (id: string) => f.routine.blocks.flatMap((b) => b.items).find((i) => i.exerciseId === id)!.sets;
    expect(by('bench')).toBe(1);
    expect(by('latpull')).toBe(2);
    expect(by('row')).toBe(2);
    expect(r.blocks[2]!.items[0]!.sets).toBe(6);
  });

  it('세트가 다른 묶음은 많은 쪽부터 맞춤', () => {
    const r = mk('g', 'g 10분', [{ ...pair('bench', 'row', 4), items: [{ exerciseId: 'bench', sets: 5, reps: 10 }, { exerciseId: 'row', sets: 3, reps: 10 }] }]);
    const f = fitRoutine({ routine: r, targetSec: 15 * 60, estimate: est, partOf, recent });
    // 5·3 → 4·3 → 3·3 → 2·2 (많은 쪽만 줄이다가 같아지면 같이)
    expect(f.routine.blocks[0]!.items.map((i) => i.sets)).toEqual([3, 3]);
    expect(f.reduced).toBe(2);
  });

  it('내 속도가 없으면 넘겨준 앱 예상으로', () => {
    const appEst = (r: Routine) => routineSets(r) * 200;
    const f = fitRoutine({ routine: legs, targetSec: 60 * 60, estimate: appEst, partOf, recent });
    expect(f.afterSec).toBeLessThanOrEqual(3600);
    expect(routineSets(f.routine)).toBe(18);
  });
});

describe('D-067 같은 이름 루틴', () => {
  it('가장 최근에 만든 것을 남기고 나머지를 오래된 것으로', () => {
    const a = mk('a', '이두+삼두+어깨 75분.2', [], iso(T0));
    const b = mk('b', ' 이두+삼두+어깨 75분.2 ', [], iso(T0 + MIN));
    const c = mk('c', '하체 75분', []);
    const d = duplicateNames([a, b, c]);
    expect(d).toHaveLength(1);
    expect(d[0]!.keep.id).toBe('b');
    expect(d[0]!.older.map((x) => x.id)).toEqual(['a']);
    expect(duplicateNames([c])).toEqual([]);
  });
});

describe('D-068 끝낼 때 루틴 반영', () => {
  const r = mk('r', '가슴+등 75분', [one('bench', 4), pair('incline_db', 'row', 3), one('latpull', 3)]);
  const start = () => startWorkout('w', r, iso(T0), []);
  const names = (id: string) => ({ bench: '벤치', incline_db: '인클라인', row: '로우', latpull: '랫풀', legpress: '레그 프레스', decline: '디클라인' } as Record<string, string>)[id] ?? id;

  it('무게·횟수·세트 완료만 바뀐 것은 묻지 않음', () => {
    let w = start();
    w = completeSet(w, { block: 0, item: 0, set: 0 }, T0 + MIN);
    w = { ...w, blocks: w.blocks.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i, sets: i.sets.map((s) => ({ ...s, weight: 99, reps: 3 })) })) })) };
    w = addSet(w, 0, 0); // 세트 수만 바뀜
    expect(routineDiff(r, w).changed).toBe(false);
  });

  it('추가', () => {
    const w = appendExercise(start(), 'legpress', 3, 10, 90, []);
    const d = routineDiff(r, w);
    expect(d).toMatchObject({ added: ['legpress'], removed: [], swapped: [], reordered: false, changed: true });
    expect(diffText(d, names)).toBe('추가: 레그 프레스');
  });

  it('교체 (단일·묶음 안)', () => {
    let w = replaceItem(start(), 0, 0, 'decline', []);
    w = replaceItem(w, 1, 1, 'legpress', []);
    const d = routineDiff(r, w);
    expect(d.swapped).toEqual([{ from: 'bench', to: 'decline' }, { from: 'row', to: 'legpress' }]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.reordered).toBe(false);
    expect(diffText(d, names)).toBe('교체: 벤치 → 디클라인, 로우 → 레그 프레스');
  });

  it('건너뛰고 안 한 운동은 빠진 것, 한 세트라도 했으면 남은 것', () => {
    let w = skipItem(start(), 2, 0);
    expect(routineDiff(r, w)).toMatchObject({ removed: ['latpull'], changed: true });
    w = completeSet(start(), { block: 2, item: 0, set: 0 }, T0 + MIN);
    w = skipItem(w, 2, 0);
    expect(routineDiff(r, w).changed).toBe(false);
  });

  it('순서: 블록 자리로 (완료 시각 아님)', () => {
    const w = moveWorkoutBlock(start(), 2, 0);
    expect(routineDiff(r, w)).toMatchObject({ reordered: true, changed: true, added: [], removed: [] });
    // 뒤 블록을 먼저 체크해도 자리가 같으면 순서 바뀜 아님
    const w2 = completeSet(start(), { block: 2, item: 0, set: 0 }, T0 + MIN);
    expect(routineDiff(r, w2).reordered).toBe(false);
  });

  it('루틴 업데이트: 목록·순서·세트 수, 루틴 목표 횟수는 유지', () => {
    let w = moveWorkoutBlock(start(), 2, 0);
    w = appendExercise(w, 'legpress', 2, 12, 90, []);
    w = addSet(w, 1, 0); // 벤치 5세트
    w = skipItem(w, 2, 0); // 인클라인 빠짐 → 묶음이 로우 하나 = 단일
    const n = routineFromWorkout(r, w, iso(T0 + DAY));
    expect(n.blocks.map((b) => [b.kind, b.items.map((i) => `${i.exerciseId}:${i.sets}x${i.reps}`).join('+')])).toEqual([
      ['single', 'latpull:3x10'], ['single', 'bench:5x10'], ['single', 'row:3x10'], ['single', 'legpress:2x12'],
    ]);
    expect(n).toMatchObject({ id: 'r', name: '가슴+등 75분', warmupSec: 480, updatedAt: iso(T0 + DAY) });
  });

  it('웜업으로 미리 바뀐 첫 세트가 있어도 세트 수는 그대로', () => {
    let w = start();
    w = { ...w, blocks: w.blocks.map((b, bi) => bi ? b : { ...b, items: b.items.map((i) => ({ ...i, sets: i.sets.map((s, k) => (k === 0 ? { ...s, warmup: true } : s)) })) }) };
    w = appendExercise(w, 'legpress', 3, 10, 90, []);
    expect(routineFromWorkout(r, w, iso(T0)).blocks[0]!.items[0]!.sets).toBe(4);
  });

  it('새 루틴으로 저장: 새 ID·이름, 원래 루틴은 그대로', () => {
    const w = appendExercise(start(), 'legpress', 3, 10, 90, []);
    const n = newRoutineFromWorkout({ ...r, estimatedSec: 999 }, w, 'r2', '가슴+등 75분 (10월 20일)', iso(T0 + DAY));
    expect(n).toMatchObject({ id: 'r2', name: '가슴+등 75분 (10월 20일)', createdAt: iso(T0 + DAY) });
    expect(n.estimatedSec).toBeUndefined();
    expect(n.blocks).toHaveLength(4);
    expect(r.blocks).toHaveLength(3);
  });
});
