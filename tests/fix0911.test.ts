/**
 * 0.9.11 검토 고침 (리뷰 A·B): 수정 화면 기록 빼기(A1), 옛 앱 백업 호환(A2), 긴 기록 줄(B2), 맞추기 제자리 블록(B3),
 * 기록 정리 저장(동기화 표시·지움 표시·다시 계산·떨어진 세트), 루틴 세트 수(웜업 빼기), 운동 중 루틴 바뀜(P4)
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import type { Routine, RoutineBlock, SetLog, Workout } from '../src/core/session';
import { planToRoutine, startWorkout, addSet, completeRound, completeSet } from '../src/core/session';
import { endFixes, longFixes, hasEditStamps, endChangeText, emptyFinished } from '../src/core/finishTime';
import { personalPace, fitRoutine, paceEstimate, moveSummary, anchoredBlocks, isMainLift, routineSets } from '../src/core/routineFit';
import type { Pace, Recent } from '../src/core/routineFit';
import { finalizeEdit } from '../src/core/workoutEdit';
import { setCount, routineChangedDuring, routineFromWorkout } from '../src/core/routineDiff';
import { makeBackup, parseBackup } from '../src/core/backup';
import { diagForBackup, BACKUP_DIAG_KINDS, DIAG_KINDS } from '../src/core/diag';
import type { DiagEntry } from '../src/core/diag';
import { parseBackup as parseBackup0910 } from './legacy/backup_0910';
import { DIAG_KINDS as DIAG_KINDS_0910 } from './legacy/diag_0910';
import { WorkoutDB, exportAll } from '../src/db/db';
import { fixEndsIn, deleteEmptyIn, fixWarmupsIn } from '../src/db/recordFix';
import { warmupFixes, applyWarmups } from '../src/core/warmupGuess';
import { tombKey } from '../src/core/syncStamp';
import { Clock, memoryClockStore } from '../src/core/hlc';
import type { Part } from '../src/core/types';

const T0 = Date.parse('2026-10-19T02:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000, H = 3_600_000, DAY = 86_400_000;

/** 세트 n개를 start+lead부터 gap초 간격으로 끝낸 운동 */
function session(id: string, start: number, n: number, gapSec: number, endPadMin = 3, leadSec = 30): Workout {
  const sets: SetLog[] = Array.from({ length: n }, (_, k) => ({ warmup: false, done: true, weight: 50, reps: 10, doneAt: iso(start + leadSec * 1000 + k * gapSec * 1000) }));
  const end = start + leadSec * 1000 + (n - 1) * gapSec * 1000 + endPadMin * MIN;
  return { id, name: id, startedAt: iso(start), endedAt: iso(end), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench', target: { sets: n, reps: 10 }, sets }] }] };
}
/** 기록 수정 화면에서 세트를 완료로 바꾼 기록 (doneAt 이 없어서 finalizeEdit 이 "시작 + k초"를 붙임) */
function editedSession(id: string, start: number, n: number, endMin: number): Workout {
  const w = session(id, start, n, 150);
  const raw: Workout = { ...w, endedAt: iso(start + endMin * MIN), blocks: w.blocks.map((b) => ({ ...b, items: b.items.map((it) => ({ ...it, sets: it.sets.map(({ doneAt: _d, ...s }) => s) })) })) };
  return finalizeEdit(raw, iso(start + DAY));
}

describe('A1 수정 화면에서 완료한 세트(시작 + k초)는 속도·끝 시각 계산에서 뺌', () => {
  it('finalizeEdit 이 붙인 시각 모양을 알아봄, 그냥 고친(끝 시각만) 기록은 아님', () => {
    const e = editedSession('e', T0, 5, 60);
    const times = e.blocks[0]!.items[0]!.sets.map((s) => Date.parse(s.doneAt!) - T0);
    expect(times).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(hasEditStamps(e)).toBe(true);
    expect(hasEditStamps({ ...e, editedAt: undefined })).toBe(false);
    expect(hasEditStamps({ ...session('s', T0, 5, 150), editedAt: iso(T0 + DAY) })).toBe(false); // 실제 시각
  });
  it('endFixes·longFixes: editedAt 있는 기록은 후보가 아님 (사용자가 직접 고친 기록)', () => {
    const e = editedSession('e', T0, 5, 60); // 마지막 세트 = 시작 + 5초 → 예전에는 "끝 = 시작 + 3분" 후보였음
    expect(endFixes([{ ...e, editedAt: undefined }]).map((f) => f.id)).toEqual(['e']); // 예전 동작 확인
    expect(endFixes([e])).toEqual([]);
    const long = { ...session('l', T0, 10, 150), endedAt: iso(T0 + 20 * H) };
    expect(longFixes([long]).map((f) => f.id)).toEqual(['l']);
    expect(longFixes([{ ...long, editedAt: iso(T0 + DAY) }]).map((f) => f.id)).toEqual(['l']); // editedAt 만으로는 빼지 않음 (웜업 고치기도 붙임)
    expect(longFixes([{ ...editedSession('le', T0, 10, 20 * 60) }])).toEqual([]); // 수정 화면 기록(시각 모양)은 뺌
  });
  it('웜업 고치기를 먼저 해도 끝 시각 후보로 남음 (editedAt 순서 의존 없음)', () => {
    const w = { ...session('wu', T0, 5, 150), endedAt: iso(T0 + 2 * H) };
    expect(endFixes([w]).map((f) => f.id)).toEqual(['wu']);
    const fix = { id: 'wu', name: 'wu', startedAt: w.startedAt, block: 0, item: 0, set: 0, exerciseId: 'bench', weight: 50, reps: 10, top: 50 };
    const after = applyWarmups(w, [fix], iso(T0 + DAY));
    expect(after.editedAt).toBeDefined();
    expect(after.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
    expect(endFixes([after]).map((f) => f.id)).toEqual(['wu']);
    expect(hasEditStamps(after)).toBe(false);
  });
  it('personalPace: 수정 화면 기록은 빼고 셈 (세트당 1초가 섞이지 않음)', () => {
    const real = [session('a', T0, 20, 150), session('b', T0 + DAY, 20, 150), session('c', T0 + 2 * DAY, 20, 150)];
    const edited = [editedSession('e1', T0 + 3 * DAY, 20, 60), editedSession('e2', T0 + 4 * DAY, 20, 60), editedSession('e3', T0 + 5 * DAY, 20, 60)];
    expect(personalPace([...real, ...edited])).toEqual({ secPerSet: 150, leadSec: 30, n: 3 });
    expect(personalPace(edited)).toBeUndefined();
    // 끝 시각만 고친 기록(applyEnd → editedAt, 세트 시각은 실제)은 그대로 셈
    expect(personalPace(real.map((w) => ({ ...w, editedAt: iso(T0 + 9 * DAY) })))?.n).toBe(3);
  });
});

// ---------- A2 ----------
const dg = (k: string, t = '2026-10-19T02:00:00.000Z'): DiagEntry => ({ t, k: k as DiagEntry['k'], d: 'ab12', m: 'x', ok: true });
const emptyData = { routines: [], workouts: [], meta: [], custom: [], settings: [], bodyweight: [], diag: [] as DiagEntry[], feedback: [] };

describe('A2 백업 호환 (0.9.10 이하 앱)', () => {
  it('옛 종류 목록 = 지금 목록에서 health 만 뺀 것, 백업에 넣는 종류도 같음', () => {
    expect([...DIAG_KINDS_0910]).toEqual(DIAG_KINDS.filter((k) => k !== 'health'));
    expect([...BACKUP_DIAG_KINDS]).toEqual([...DIAG_KINDS_0910]);
    expect(diagForBackup([dg('timer'), dg('health'), dg('send')]).map((e) => e.k)).toEqual(['timer', 'send']);
  });
  it('0.9.11 백업(exportAll → makeBackup)을 0.9.10 검사가 받음: health 진단은 빠짐', async () => {
    const db = new WorkoutDB(`a2-${Math.random()}`);
    const routine = planToRoutine('r1', '등', iso(T0), [{ kind: 'superset', items: [
      { exerciseId: 'barbell_curl', name: 'A', part: '이두', sets: 3, reps: 10, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 },
      { exerciseId: 'rope_pushdown', name: 'B', part: '삼두', sets: 3, reps: 10, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 1 },
    ], restSec: 90, timeSec: 0 }], 1200);
    // 0.9.11 기능으로 만든 기록: 라운드 한 번에 완료, 웜업 미리 표시 이력(지난 기록), 끝 시각 고침(editedAt)
    const hist = { ...session('h', T0 - 2 * DAY, 3, 150), blocks: [{ kind: 'single' as const, restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', target: { sets: 3, reps: 10 }, sets: [{ warmup: false, done: true, weight: 40, reps: 10, doneAt: iso(T0 - 2 * DAY + 60_000) }] }] }] };
    let w = startWorkout('w1', routine, iso(T0), [hist]);
    w = completeRound(w, { block: 0, item: 0, set: 0 }, T0 + MIN);
    w = { ...w, endedAt: iso(T0 + 30 * MIN), editedAt: iso(T0 + DAY), timer: null };
    await db.routines.put(routine);
    await db.workouts.put(w);
    for (const k of ['start', 'health', 'timer', 'health']) await db.diag.add(dg(k));
    const data = await exportAll(db);
    expect(data.diag.map((e) => e.k)).toEqual(['start', 'timer']);
    const text = JSON.stringify(makeBackup(data, '0.9.11-preview', iso(T0 + DAY), { id: 'ab12', label: 'iPhone · Safari 26.0' }, true));
    expect(parseBackup0910(text)).toMatchObject({ ok: true });
    expect(parseBackup(text)).toMatchObject({ ok: true });
    // 뺐지 않았다면 옛 앱은 백업 전체를 거절했음 (이 시험이 의미 있는지 확인)
    const raw = JSON.stringify(makeBackup({ ...data, diag: [dg('health')] }, '0.9.11-preview', iso(T0 + DAY)));
    expect(parseBackup0910(raw)).toMatchObject({ ok: false, error: expect.stringContaining('진단 기록') });
    db.close();
  });
  it('새 앱(이 앱)이 모르는 진단 종류는 그 줄만 버리고 개수를 알려 줌', () => {
    const text = JSON.stringify(makeBackup({ ...emptyData, diag: [dg('start'), dg('future_kind'), dg('timer'), dg('future_kind')] }, '1.0.0', iso(T0)));
    const r = parseBackup(text);
    expect(r).toMatchObject({ ok: true, droppedDiag: 2 });
    if (r.ok) { expect(r.file.data.diag.map((e) => e.k)).toEqual(['start', 'timer']); expect(r.file.counts.diag).toBe(2); }
    expect(parseBackup(JSON.stringify(makeBackup({ ...emptyData, diag: [dg('start')] }, '1.0.0', iso(T0))))).not.toHaveProperty('droppedDiag');
  });
});

// ---------- B2 ----------
describe('B2 긴 기록 줄: 날짜가 바뀌면 날짜, 운동 시간 전 → 후', () => {
  it('25시간 17분 → 1시간 3분, 새 끝에 날짜', () => {
    const start = Date.parse('2026-10-02T10:00:00+09:00');
    const t = endChangeText({ startedAt: iso(start), endedAt: iso(start + 25 * H + 17 * MIN), newEnd: iso(start + 63 * MIN) });
    expect(t).toBe('끝 10월 3일(토) 오전 11:17 → 10월 2일(금) 오전 11:03 · 25시간 17분 → 1시간 3분');
  });
  it('같은 날이면 시각만', () => {
    const start = Date.parse('2026-10-02T10:00:00+09:00');
    expect(endChangeText({ startedAt: iso(start), endedAt: iso(start + 2 * H), newEnd: iso(start + 50 * MIN) })).toBe('끝 오후 12:00 → 오전 10:50 · 2시간 → 50분');
  });
});

// ---------- B3 ----------
const PART: Record<string, Part> = {
  bench_press: '가슴', deadlift: '등', incline_db: '가슴', crossover: '가슴', pecdeck: '가슴', dips: '가슴',
  latpull: '등', row: '등', onearm_row: '등', pullup: '등', rackpull: '등',
};
const MAIN = new Set(['bench_press', 'deadlift', 'rackpull']);
const partOf = (id: string) => PART[id];
const isMain = (id: string) => MAIN.has(id);
const one = (exerciseId: string, sets: number): RoutineBlock => ({ kind: 'single', items: [{ exerciseId, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const pair = (a: string, b: string, sets: number): RoutineBlock => ({ kind: 'superset', items: [{ exerciseId: a, sets, reps: 10 }, { exerciseId: b, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const PACE: Pace = { secPerSet: 150, leadSec: 30, n: 8 };
const est = (r: Routine) => paceEstimate(r, PACE);
const recent: Recent = { part: new Map<Part, number>([['가슴', 50], ['등', 16]]), ex: new Map([['bench_press', 20]]) };

describe('B3 맞추기: 첫 블록·주 운동은 제자리', () => {
  // 사용자 가슴+등 모양: 벤치+데드리프트 묶음이 맨 앞
  const cb: Routine = { id: 'r', name: '가슴+등 75분', createdAt: iso(T0), updatedAt: iso(T0), warmupSec: 480, blocks: [
    pair('bench_press', 'deadlift', 4), one('incline_db', 5), one('crossover', 4), one('latpull', 5), pair('pecdeck', 'row', 4), one('pullup', 5), one('dips', 4), one('onearm_row', 4),
  ] };
  it('주 운동 = 바벨 복합 운동', () => {
    expect(isMainLift({ mechanics: 'compound', equipment: ['barbell'] })).toBe(true);
    expect(isMainLift({ mechanics: 'compound', equipment: ['dumbbell'] })).toBe(false);
    expect(isMainLift({ mechanics: 'isolation', equipment: ['barbell'] })).toBe(false);
    expect(isMainLift(undefined)).toBe(false);
    expect(anchoredBlocks(cb, isMain)).toEqual([true, false, false, false, false, false, false, false]);
  });
  it('벤치+데드리프트 묶음은 맨 앞 그대로, 등 운동만 그 뒤로 앞당김, 주 운동 세트는 맨 나중에 줄임', () => {
    const f = fitRoutine({ routine: cb, targetSec: 75 * 60, estimate: est, partOf, recent, isMain });
    expect(f.fits).toBe(true);
    const ids = f.routine.blocks.map((b) => b.items.map((i) => i.exerciseId).join('+'));
    expect(ids[0]).toBe('bench_press+deadlift');
    expect(ids).toEqual(['bench_press+deadlift', 'latpull', 'pecdeck+row', 'pullup', 'onearm_row', 'incline_db', 'crossover', 'dips']);
    expect(f.routine.blocks[0]!.items.map((i) => i.sets)).toEqual([4, 4]); // 다른 운동으로 충분하면 안 줄임
    expect(moveSummary(f.rows, partOf)).toBe('등 운동 4개·가슴 운동 1개를 앞으로'); // 펙덱은 로우와 한 묶음이라 같이
  });
  it('가운데 주 운동 블록(랙풀)도 제자리, 다른 블록만 그 둘레에서 움직임', () => {
    const r: Routine = { ...cb, blocks: [one('incline_db', 4), one('crossover', 4), one('rackpull', 4), one('latpull', 4), one('pullup', 4)] };
    const f = fitRoutine({ routine: r, targetSec: 300 * 60, estimate: est, partOf, recent, isMain });
    expect(f.routine.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['incline_db', 'latpull', 'rackpull', 'pullup', 'crossover']);
  });
  it('다른 운동을 모두 2세트로 줄여도 길 때만 주 운동 세트를 줄임', () => {
    const f = fitRoutine({ routine: cb, targetSec: 45 * 60, estimate: est, partOf, recent, isMain });
    const others = f.routine.blocks.slice(1).flatMap((b) => b.items.map((i) => i.sets));
    expect(Math.max(...others)).toBe(2);
    expect(f.routine.blocks[0]!.items[0]!.sets).toBeLessThan(4);
    // 제자리 블록끼리는 고르게: 주 운동 둘이면 세트 차이 1 이하
    const r2: Routine = { ...cb, blocks: [one('bench_press', 5), one('latpull', 2), one('rackpull', 5)] };
    const g = fitRoutine({ routine: r2, targetSec: 19 * 60, estimate: est, partOf, recent, isMain }); // 8세트 = 75 + 7×150 = 1,125초
    expect(g.routine.blocks.map((b) => b.items[0]!.sets)).toEqual([3, 2, 3]);
    expect(routineSets(f.routine)).toBeLessThan(routineSets(cb));
  });
  it('옮긴 게 없으면 요약 없음, 여러 부위면 많은 쪽부터', () => {
    expect(moveSummary([], partOf)).toBe('');
    const rows = [
      { exerciseId: 'latpull', letter: '', fromBlock: 3, toBlock: 1, before: 5, after: 5 },
      { exerciseId: 'row', letter: 'B', fromBlock: 4, toBlock: 2, before: 4, after: 4 },
      { exerciseId: 'dips', letter: '', fromBlock: 6, toBlock: 5, before: 4, after: 4 },
      { exerciseId: 'incline_db', letter: '', fromBlock: 1, toBlock: 3, before: 5, after: 2 },
    ];
    expect(moveSummary(rows, partOf)).toBe('등 운동 2개·가슴 운동 1개를 앞으로');
  });
});

// ---------- 기록 정리 저장 ----------
const mkDb = () => new WorkoutDB(`rf-${Math.random()}`, { clock: new Clock(memoryClockStore(), () => Date.now()), deviceId: () => 'devA' });

describe('기록 정리 저장 (db/recordFix): 동기화 표시·지움 표시·다시 계산', () => {
  it('끝 시각 고치기: _s 가 올라가고(보낼 것), 저장된 최신 기록으로 다시 셈', async () => {
    const db = mkDb();
    const w = { ...session('w', T0, 5, 150), endedAt: iso(T0 + 3 * H) };
    await db.workouts.put(w);
    const before = (await db.workouts.get('w'))!;
    const [f] = endFixes([before]);
    // 화면에 보인 뒤 다른 세트가 더해짐 (끝 시각은 그대로) → 새 끝은 다시 읽은 기록의 마지막 세트 + 3분
    const more = { ...before, blocks: before.blocks.map((b) => ({ ...b, items: b.items.map((it) => ({ ...it, sets: [...it.sets, { warmup: false, done: true, weight: 50, reps: 10, doneAt: iso(T0 + 40 * MIN) }] })) })) };
    await db.workouts.put(more);
    const mid = (await db.workouts.get('w'))!;
    expect(await fixEndsIn(db, [f!], iso(T0 + DAY))).toBe(1);
    const after = (await db.workouts.get('w'))!;
    expect(after.endedAt).toBe(iso(T0 + 43 * MIN));
    expect(after.endedAt).not.toBe(f!.newEnd);
    expect(after.editedAt).toBe(iso(T0 + DAY));
    const s0 = (mid as unknown as { _s: { q: number; y: number } })._s, s1 = (after as unknown as { _s: { q: number; y: number } })._s;
    expect(s1.q).toBe(s0.q + 1);
    expect(s1.y).toBe(1);
    // 그사이 끝 시각이 바뀌었으면 건너뜀
    expect(await fixEndsIn(db, [f!], iso(T0 + DAY))).toBe(0);
    db.close();
  });
  it('12시간 넘는 기록: 떨어진 세트는 일부러 그대로 둠 (세트 기록 지우지 않음, 끝 시각만)', async () => {
    const db = mkDb();
    const base = session('l', T0, 6, 150);
    const sets = [...base.blocks[0]!.items[0]!.sets, { warmup: false, done: true, weight: 50, reps: 10, doneAt: iso(T0 + 20 * H) }];
    const long: Workout = { ...base, endedAt: iso(T0 + 21 * H), blocks: [{ ...base.blocks[0]!, items: [{ ...base.blocks[0]!.items[0]!, sets }] }] };
    await db.workouts.put(long);
    const [f] = longFixes([long]);
    expect(f!.stragglers).toBe(1);
    expect(await fixEndsIn(db, [f!], iso(T0 + DAY))).toBe(1);
    const after = (await db.workouts.get('l'))!;
    const done = after.blocks[0]!.items[0]!.sets.filter((s) => s.done);
    expect(done).toHaveLength(7);
    expect(Date.parse(done[6]!.doneAt!)).toBeGreaterThan(Date.parse(after.endedAt!)); // 떨어진 세트가 새 끝보다 늦음 (의도)
    db.close();
  });
  it('빈 기록 지우기: 지움 표시(tomb)를 남김, 그사이 세트를 완료했으면 건너뜀', async () => {
    const db = mkDb();
    const empty = (id: string): Workout => ({ ...session(id, T0, 2, 150), blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench', target: { sets: 2, reps: 10 }, sets: [{ warmup: false, done: false }, { warmup: false, done: false }] }] }] });
    await db.workouts.bulkPut([empty('e1'), empty('e2')]);
    const list = emptyFinished([empty('e1'), empty('e2')]);
    expect(list).toHaveLength(2);
    const e2 = (await db.workouts.get('e2'))!;
    await db.workouts.put(completeSet(e2, { block: 0, item: 0, set: 0 }, T0 + MIN));
    expect(await deleteEmptyIn(db, list)).toBe(1);
    expect(await db.workouts.get('e1')).toBeUndefined();
    expect(await db.tombs.get(tombKey('workouts', 'e1'))).toMatchObject({ table: 'workouts', id: 'e1', _s: { y: 1 } });
    expect(await db.workouts.get('e2')).toBeDefined();
    expect(await db.tombs.get(tombKey('workouts', 'e2'))).toBeUndefined();
    db.close();
  });
  it('웜업으로 바꾸기: _s 가 올라감', async () => {
    const db = mkDb();
    const w = session('ww', T0, 4, 150);
    w.blocks[0]!.items[0]!.sets[0] = { ...w.blocks[0]!.items[0]!.sets[0]!, weight: 20, reps: 15 };
    await db.workouts.put(w);
    const before = (await db.workouts.get('ww'))! as unknown as { _s: { q: number } };
    const fx = warmupFixes([w]);
    expect(fx).toHaveLength(1);
    expect(await fixWarmupsIn(db, fx, iso(T0 + DAY))).toBe(1);
    const after = (await db.workouts.get('ww'))!;
    expect(after.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
    expect((after as unknown as { _s: { q: number; y: number } })._s).toMatchObject({ q: before._s.q + 1, y: 1 });
    db.close();
  });
});

// ---------- 루틴 반영 ----------
describe('루틴 반영: 세트 수는 웜업 빼고, 운동 중 루틴이 바뀌면 덮어쓰지 않음', () => {
  const r: Routine = { id: 'r', name: 'r', createdAt: iso(T0), updatedAt: iso(T0), blocks: [one('bench_press', 4)] };
  it('웜업은 세트 수에 넣지 않음 (+ 웜업 하고 세트를 지운 경우)', () => {
    let w = startWorkout('w', r, iso(T0 + H), []);
    w = addSet(w, 0, 0, true);
    expect(setCount(w.blocks[0]!.items[0]!)).toBe(4); // 웜업 더함: 4
    const it = w.blocks[0]!.items[0]!;
    const shrunk = { ...it, sets: [{ warmup: true, done: true }, { warmup: false, done: true }, { warmup: false, done: true }] };
    expect(setCount(shrunk)).toBe(2); // 예전: 3 (웜업 포함)
    // 시작 때 첫 세트를 웜업으로 미리 표시하고 세트 수를 안 바꿨으면 루틴 세트 수 그대로
    const pre = { ...it, sets: [{ warmup: true, done: true }, { warmup: false, done: true }, { warmup: false, done: true }, { warmup: false, done: true }] };
    expect(setCount(pre)).toBe(4);
    expect(routineFromWorkout(r, { ...w, blocks: [{ ...w.blocks[0]!, items: [shrunk] }] }, iso(T0)).blocks[0]!.items[0]!.sets).toBe(2);
  });
  it('운동을 시작한 뒤 루틴이 고쳐졌는지', () => {
    const w = startWorkout('w', r, iso(T0 + H), []);
    expect(routineChangedDuring(r, w)).toBe(false);
    expect(routineChangedDuring({ updatedAt: iso(T0 + 2 * H) }, w)).toBe(true);
  });
});
