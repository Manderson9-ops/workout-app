/**
 * 사용 분석 개선 1단계: D-065 끝내기 시각, D-066 묶음 라운드 한 번에, D-070 웜업 미리 표시, D-072 빈 운동
 */
import { describe, expect, it } from 'vitest';
import type { Workout, Routine, SetLog } from '../src/core/session';
import { startWorkout, completeSet, completeRound, roundSteps, currentStep, undoSet, steps, replaceItem, appendExercise, isGroup } from '../src/core/session';
import {
  doneCount, lastDoneMs, endAtLastSet, shouldAskEndTime, shouldAskEnded, whenText, endFixes, longFixes, mainCluster, emptyFinished, applyEnd, FINISH_RULE,
} from '../src/core/finishTime';
import { looksLikeWarmup, preMarkWarmup, isAutoWarmup, warmupFixes, applyWarmups } from '../src/core/warmupGuess';
import { summarize } from '../src/core/stats';

const T0 = Date.parse('2026-10-19T02:00:00.000Z'); // 한국 오전 11:00
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const done = (weight: number, reps: number, at: number, warmup = false): SetLog => ({ weight, reps, warmup, done: true, doneAt: iso(at) });

function finished(id: string, sets: SetLog[], startMs: number, endMs: number, ex = 'barbell_curl'): Workout {
  return { id, name: `운동 ${id}`, startedAt: iso(startMs), endedAt: iso(endMs), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: ex, target: { sets: sets.length, reps: 10 }, sets }] }] };
}
const routine = (blocks: Routine['blocks']): Routine => ({ id: 'r1', name: '루틴', createdAt: iso(T0), updatedAt: iso(T0), blocks });

describe('D-065 끝내기 시각', () => {
  const w = finished('a', [done(30, 10, T0 + 5 * MIN), done(30, 10, T0 + 10 * MIN)], T0, T0 + 60 * MIN);
  const active = { ...w, endedAt: undefined };

  it('완료 세트 수·마지막 세트 시각', () => {
    expect(doneCount(w)).toBe(2);
    expect(lastDoneMs(w)).toBe(T0 + 10 * MIN);
  });

  it('마지막 세트 + 3분 (지금보다 늦지 않게)', () => {
    expect(endAtLastSet(active, T0 + 60 * MIN)).toBe(iso(T0 + 13 * MIN));
    expect(endAtLastSet(active, T0 + 11 * MIN)).toBe(iso(T0 + 11 * MIN));
    // 세트가 없으면 시작 + 3분
    const empty = { ...active, blocks: [] };
    expect(endAtLastSet(empty, T0 + 60 * MIN)).toBe(iso(T0 + 3 * MIN));
  });

  it('끝내기 때 묻기: 마지막 세트 뒤 15분 넘으면', () => {
    expect(shouldAskEndTime(active, T0 + 25 * MIN)).toBe(false); // 15분 정각
    expect(shouldAskEndTime(active, T0 + 25 * MIN + 1)).toBe(true);
    expect(shouldAskEndTime({ ...active, blocks: [] }, T0 + 99 * MIN)).toBe(false); // 세트 없음은 따로 (버리기)
  });

  it('띠: 30분 넘게 지남, 세트 없으면 시작 기준, 휴식 중이면 안 띄움', () => {
    expect(shouldAskEnded(active, T0 + 40 * MIN)).toBe(false);
    expect(shouldAskEnded(active, T0 + 41 * MIN)).toBe(true);
    expect(shouldAskEnded({ ...active, blocks: [] }, T0 + 31 * MIN)).toBe(true);
    const resting = { ...active, timer: { startedAt: T0 + 40 * MIN, endsAt: T0 + 50 * MIN, label: '세트 간 휴식', kind: 'set' as const } };
    expect(shouldAskEnded(resting, T0 + 45 * MIN)).toBe(false);
    expect(shouldAskEnded(w, T0 + 99 * MIN)).toBe(false); // 끝난 운동
  });

  it('글자: 오늘이면 시각만, 아니면 날짜 이름 + 시각 (D-060)', () => {
    process.env.TZ = 'Asia/Seoul';
    expect(whenText(T0 + 13 * MIN, T0 + 60 * MIN)).toMatch(/^오전 11:13$/);
    expect(whenText(T0 - 24 * 60 * MIN, T0)).toMatch(/^어제 오전 11:00$/);
  });

  it('기존 기록: 15분 넘게 늦게 끝낸 것만, 새 끝 = 마지막 세트 + 3분', () => {
    const ok = finished('ok', [done(30, 10, T0 + 10 * MIN)], T0, T0 + 20 * MIN);
    const late = finished('late', [done(30, 10, T0 + 10 * MIN)], T0, T0 + 50 * MIN);
    const empty = finished('empty', [{ warmup: false, done: false, reps: 10 }], T0, T0 + 1 * MIN);
    const f = endFixes([ok, late, empty]);
    expect(f.map((x) => x.id)).toEqual(['late']);
    expect(f[0]!.newEnd).toBe(iso(T0 + 13 * MIN));
    expect(emptyFinished([ok, late, empty]).map((x) => x.id)).toEqual(['empty']);
  });

  it('12시간 넘는 기록: 다음 날 떨어진 세트는 빼고 본 묶음 마지막 + 3분, 일반 목록에는 안 나옴', () => {
    const sets = [done(60, 8, T0 + 5 * MIN), done(60, 8, T0 + 10 * MIN), done(60, 8, T0 + 50 * MIN), done(60, 8, T0 + 25 * 60 * MIN)];
    const long = finished('long', sets, T0, T0 + 25 * 60 * MIN + 2 * MIN);
    expect(endFixes([long])).toEqual([]);
    const f = longFixes([long]);
    expect(f).toHaveLength(1);
    expect(f[0]!.newEnd).toBe(iso(T0 + 53 * MIN));
    expect(f[0]!.stragglers).toBe(1);
    expect(mainCluster([1, 2, 3 + FINISH_RULE.clusterGapMs + 10])).toEqual({ first: 1, last: 2, count: 2 });
  });

  it('고치기: 끝난 시각과 고친 시각(editedAt)만 바뀜, 주인 표시는 그대로', () => {
    const w2 = { ...w, ownerDeviceId: 'abc', ownerSeq: 2 };
    const n = applyEnd(w2, iso(T0 + 13 * MIN), iso(T0 + 999 * MIN));
    expect(n.endedAt).toBe(iso(T0 + 13 * MIN));
    expect(n.editedAt).toBe(iso(T0 + 999 * MIN));
    expect(n.ownerDeviceId).toBe('abc');
    expect(n.ownerSeq).toBe(2);
    expect(n.blocks).toBe(w2.blocks);
  });
});

describe('D-070 웜업 미리 표시', () => {
  const hist = [finished('h1', [done(20, 15, T0 + 1 * MIN), done(50, 8, T0 + 3 * MIN), done(50, 8, T0 + 5 * MIN), done(50, 8, T0 + 7 * MIN)], T0, T0 + 10 * MIN)];
  const r = routine([{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', sets: 4, reps: 10 }] }]);

  it('규칙: 50% 이하 + 15회 이상', () => {
    expect(looksLikeWarmup(25, 15, 50)).toBe(true);
    expect(looksLikeWarmup(26, 15, 50)).toBe(false);
    expect(looksLikeWarmup(20, 14, 50)).toBe(false);
    expect(looksLikeWarmup(undefined, 20, 50)).toBe(false);
    expect(looksLikeWarmup(10, 20, 0)).toBe(false);
  });

  it('시작할 때 첫 세트를 W로 미리 표시, 뒤 세트는 지난번 작업 무게, 순서는 웜업 먼저', () => {
    const w = startWorkout('w1', r, iso(T0 + 999 * MIN), hist);
    const sets = w.blocks[0]!.items[0]!.sets;
    expect(sets[0]).toMatchObject({ warmup: true, weight: 20, reps: 15, auto: true });
    expect(isAutoWarmup(sets[0]!)).toBe(true);
    expect(sets.slice(1).map((s) => [s.warmup, s.weight])).toEqual([[false, 50], [false, 50], [false, 50]]);
    expect(steps(w)[0]).toEqual({ block: 0, item: 0, set: 0 });
  });

  it('W 세트를 완료해도 가벼운 무게가 뒤 세트로 이어지지 않음, 통계는 작업 세트만', () => {
    const w = startWorkout('w1', r, iso(T0), hist);
    const after = completeSet(w, { block: 0, item: 0, set: 0 }, T0 + MIN);
    expect(after.blocks[0]!.items[0]!.sets.slice(1).map((s) => s.weight)).toEqual([50, 50, 50]);
    expect(after.timer?.kind).toBe('warmup');
    const sum = summarize({ ...after, endedAt: iso(T0 + 2 * MIN) }, new Map(), []);
    expect(sum.workSets).toBe(0);
  });

  it('지난번이 무거운 세트만이면 표시 안 함, 세트가 1개면 안 함, 해제(warmup false) 가능', () => {
    const heavy = [finished('h2', [done(50, 8, T0), done(50, 8, T0 + MIN)], T0, T0 + 5 * MIN)];
    expect(startWorkout('w2', r, iso(T0), heavy).blocks[0]!.items[0]!.sets.some((s) => s.warmup)).toBe(false);
    const one = routine([{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', sets: 1, reps: 10 }] }]);
    expect(startWorkout('w3', one, iso(T0), hist).blocks[0]!.items[0]!.sets[0]!.warmup).toBe(false);
    // 직접 입력한 값(auto 아님)은 건드리지 않음
    expect(preMarkWarmup([{ warmup: false, done: false, weight: 20, reps: 15 }, { warmup: false, done: false }], [done(50, 8, T0)])[0]!.warmup).toBe(false);
  });

  it('운동 추가·교체에도 같은 규칙', () => {
    const base = startWorkout('w4', routine([]), iso(T0), []);
    const added = appendExercise(base, 'barbell_curl', 3, 10, 60, hist);
    expect(added.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
    const other = startWorkout('w5', routine([{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'x', sets: 3, reps: 10 }] }]), iso(T0), []);
    const swapped = replaceItem(other, 0, 0, 'barbell_curl', hist);
    expect(swapped.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
  });

  it('기존 기록 후보: 그날 최고 무게 기준, 이미 W·시간 운동·완료 안 한 세트는 제외 → 고르면 W, editedAt', () => {
    const a = hist[0]!;
    const b = finished('h3', [done(20, 15, T0, true), done(50, 8, T0 + MIN)], T0, T0 + 5 * MIN);
    const c = finished('h4', [done(30, 15, T0), done(50, 8, T0 + MIN)], T0, T0 + 5 * MIN); // 60% → 아님
    const f = warmupFixes([a, b, c]);
    expect(f).toEqual([expect.objectContaining({ id: 'h1', block: 0, item: 0, set: 0, weight: 20, reps: 15, top: 50 })]);
    const fixed = applyWarmups(a, f, iso(T0 + 999 * MIN));
    expect(fixed.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
    expect(fixed.editedAt).toBe(iso(T0 + 999 * MIN));
    expect(warmupFixes([fixed])).toEqual([]);
    expect(applyWarmups(fixed, f, iso(T0))).toBe(fixed); // 이미 바뀜 → 그대로
  });
});

describe('D-066 묶음 라운드 한 번에', () => {
  const r = routine([{ kind: 'superset', restSec: 60, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'a', sets: 3, reps: 10 }, { exerciseId: 'b', sets: 3, reps: 12 }] }, { kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'c', sets: 2, reps: 10 }] }]);
  const base = () => { const w = startWorkout('s1', r, iso(T0), []); w.blocks[0]!.items[0]!.sets[0]!.weight = 40; return w; };

  it('큰 ✓ = A1·B1 함께 완료, 라운드 휴식 한 번(roundRestSec), 무게 이어받기', () => {
    const w = base();
    expect(isGroup(w, 0)).toBe(true);
    expect(roundSteps(w, currentStep(w)!)).toEqual([{ block: 0, item: 0, set: 0 }, { block: 0, item: 1, set: 0 }]);
    const n = completeRound(w, currentStep(w)!, T0);
    expect(n.blocks[0]!.items.map((it) => it.sets[0]!.done)).toEqual([true, true]);
    expect(n.timer).toMatchObject({ kind: 'round', startedAt: T0, endsAt: T0 + 120_000 });
    expect(n.blocks[0]!.items[0]!.sets[1]!.weight).toBe(40);
    expect(currentStep(n)).toEqual({ block: 0, item: 0, set: 1 });
    // 끝낸 시각은 서로 다름 (늦은 기록 합치기용)
    expect(n.blocks[0]!.items[0]!.sets[0]!.doneAt).not.toBe(n.blocks[0]!.items[1]!.sets[0]!.doneAt);
  });

  it('A1을 줄에서 따로 체크했으면 큰 ✓는 B1만, 마지막 라운드 뒤는 다음 운동으로 이동 휴식', () => {
    let w = completeSet(base(), { block: 0, item: 0, set: 0 }, T0);
    expect(w.timer?.kind).toBe('transition');
    expect(roundSteps(w, currentStep(w)!)).toEqual([{ block: 0, item: 1, set: 0 }]);
    w = completeRound(w, currentStep(w)!, T0 + 1000);
    expect(w.timer?.kind).toBe('round');
    w = completeRound(w, currentStep(w)!, T0 + 2000);
    w = completeRound(w, currentStep(w)!, T0 + 3000);
    expect(w.timer?.kind).toBe('between');
    expect(currentStep(w)).toEqual({ block: 1, item: 0, set: 0 });
  });

  it('되돌리기: 라운드의 한 줄을 취소하면 그 세트만 다시, 타이머 꺼짐, 큰 ✓는 그 세트만', () => {
    const n = completeRound(base(), { block: 0, item: 0, set: 0 }, T0);
    const u = undoSet(n, { block: 0, item: 1, set: 0 });
    expect(u.timer).toBeNull();
    expect(currentStep(u)).toEqual({ block: 0, item: 1, set: 0 });
    expect(roundSteps(u, currentStep(u)!)).toHaveLength(1);
    const u2 = undoSet(undoSet(n, { block: 0, item: 0, set: 0 }), { block: 0, item: 1, set: 0 });
    expect(roundSteps(u2, currentStep(u2)!)).toHaveLength(2);
  });

  it('웜업·단일 블록·건너뛴 묶음은 한 세트씩', () => {
    const w = base();
    w.blocks[0]!.items[0]!.sets.unshift({ warmup: true, done: false, weight: 20, reps: 10 });
    expect(roundSteps(w, currentStep(w)!)).toHaveLength(1);
    const single = { block: 1, item: 0, set: 0 };
    expect(roundSteps(w, single)).toEqual([single]);
    const skipped = { ...w, blocks: w.blocks.map((b, i) => (i === 0 ? { ...b, items: b.items.map((it, j) => (j === 1 ? { ...it, skipped: true } : it)) } : b)) };
    expect(isGroup(skipped, 0)).toBe(false);
    const n = completeRound(skipped, { block: 0, item: 0, set: 1 }, T0);
    expect(n.timer?.kind).toBe('set');
  });
});
