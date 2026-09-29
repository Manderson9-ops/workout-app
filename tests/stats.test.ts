import { describe, expect, it } from 'vitest';
import { localDate, bodyweightOn, exerciseHistory, summarize, weekStart, weeklyPartSets, monthDays, weekStreak, plateCalc, oneRMTable } from '../src/core/stats';
import type { Workout, SetLog } from '../src/core/session';
import type { Exercise } from '../src/core/types';

const ex = (id: string, part: Exercise['part'], equipment: Exercise['equipment'] = ['barbell']): Exercise => ({ id, name_ko: id, family: id, part, muscles: ['m'], pattern: 'H_PUSH', mechanics: 'compound', equipment });
const byId = new Map([['bench', ex('bench', '가슴')], ['pull', ex('pull', '등', ['bodyweight'])], ['curl', ex('curl', '이두', ['dumbbell'])]]);
const s = (weight: number | undefined, reps: number, extra: Partial<SetLog> = {}): SetLog => ({ ...(weight !== undefined ? { weight } : {}), reps, warmup: false, done: true, ...extra });
/** 로컬 시각으로 만든 ISO (시간대와 무관하게 날짜가 맞도록) */
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
const wk = (id: string, start: string, items: { id: string; sets: SetLog[] }[], endedMin = 60, extra: Partial<Workout> = {}): Workout => ({
  id, name: id, startedAt: start, endedAt: new Date(Date.parse(start) + endedMin * 60000).toISOString(), timer: null,
  blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: items.map((i) => ({ exerciseId: i.id, target: { sets: 3, reps: 8 }, sets: i.sets })) }], ...extra,
});

describe('날짜·체중', () => {
  it('현지 날짜, 그날 이전 가장 최근 체중', () => {
    expect(localDate(at(2026, 9, 30, 23))).toBe('2026-09-30');
    const bw = [{ date: '2026-09-01', kg: 70 }, { date: '2026-09-20', kg: 72 }];
    expect(bodyweightOn(bw, '2026-09-19')).toBe(70);
    expect(bodyweightOn(bw, '2026-09-20')).toBe(72);
    expect(bodyweightOn(bw, '2026-08-01')).toBeUndefined();
  });
  it('주 시작은 월요일', () => {
    expect(weekStart('2026-09-30')).toBe('2026-09-28'); // 수 → 월
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // 일 → 그 주 월
  });
});

describe('운동별 기록', () => {
  const hist = [
    wk('w1', at(2026, 9, 21), [{ id: 'bench', sets: [s(60, 8), s(60, 8), s(40, 10, { warmup: true })] }]),
    wk('w2', at(2026, 9, 24), [{ id: 'bench', sets: [s(62.5, 8), s(65, 5), s(70, 1, { done: false })] }, { id: 'pull', sets: [s(undefined, 8), s(10, 5)] }]),
    { ...wk('w3', at(2026, 9, 26), [{ id: 'bench', sets: [s(100, 1)] }]), endedAt: undefined },
  ];
  it('날짜별 세트 수·볼륨·최고 1RM·최고 무게 (웜업·안 한 세트·진행 중 운동 제외)', () => {
    const h = exerciseHistory(hist, 'bench', byId.get('bench'));
    expect(h.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-24']);
    expect(h[0]).toMatchObject({ sets: 2, volume: 960, maxWeight: 60, best1RM: 76, bestSet: { weight: 60, reps: 8 } });
    // 62.5×8=500, 65×5=325 → 825. 1RM: 62.5×(1+8/30)=79.2, 65×(1+5/30)=75.8
    expect(h[1]).toMatchObject({ sets: 2, volume: 825, maxWeight: 65, best1RM: 79.2 });
  });
  it('맨몸 운동은 무게가 비면 체중으로 (D-002)', () => {
    const h = exerciseHistory(hist, 'pull', byId.get('pull'), [{ date: '2026-09-01', kg: 70 }]);
    expect(h[0]).toMatchObject({ volume: 70 * 8 + 10 * 5, maxWeight: 70 });
    const noBw = exerciseHistory(hist, 'pull', byId.get('pull'));
    expect(noBw[0]).toMatchObject({ volume: 50, maxWeight: 10 });
  });
  it('시간 운동은 초 합계', () => {
    const w = wk('t', at(2026, 9, 25), [{ id: 'plank', sets: [{ seconds: 45, warmup: false, done: true }, { seconds: 40, warmup: false, done: true }] }]);
    expect(exerciseHistory([w], 'plank', undefined)[0]).toMatchObject({ sets: 2, volume: 0, seconds: 85 });
  });
});

describe('운동 요약·주간·달력·연속', () => {
  const w1 = wk('w1', at(2026, 9, 29), [{ id: 'bench', sets: [s(60, 8), s(60, 8)] }, { id: 'curl', sets: [s(12, 10)] }], 50, { plannedSec: 2700 });
  const w2 = wk('w2', at(2026, 9, 30), [{ id: 'pull', sets: [s(undefined, 8)] }, { id: 'ghost', sets: [s(5, 5)] }]);
  const w0 = wk('w0', at(2026, 9, 14), [{ id: 'bench', sets: [s(50, 8)] }]);
  it('요약: 시간, 예정, 작업 세트, 볼륨, 부위별 세트', () => {
    expect(summarize(w1, byId)).toMatchObject({ date: '2026-09-29', durationSec: 3000, plannedSec: 2700, workSets: 3, volume: 1080, parts: { 가슴: 2, 이두: 1 } });
    expect(summarize(w2, byId, [{ date: '2026-09-30', kg: 80 }])).toMatchObject({ volume: 640 + 25, parts: { 등: 1 } });
    expect(summarize({ ...w2, endedAt: undefined }, byId).durationSec).toBe(0);
  });
  it('부위별 주간 세트 (최근 4주, 오래된 순)', () => {
    const r = weeklyPartSets([w0, w1, w2], byId, '2026-09-30');
    expect(r.map((x) => x.week)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(r[3]!.parts).toMatchObject({ 가슴: 2, 이두: 1, 등: 1, 하체: 0 });
    expect(r[3]!.total).toBe(4);
    expect(r[1]!.parts.가슴).toBe(1);
    expect(r[2]!.total).toBe(0);
  });
  it('달력: 날짜별 운동 수, 진행 중 제외', () => {
    const m = monthDays([w0, w1, w2, { ...w2, id: 'x', endedAt: undefined }], 2026, 9);
    expect([...m.entries()].sort()).toEqual([[14, 1], [29, 1], [30, 1]]);
    expect(monthDays([w0], 2026, 10).size).toBe(0);
  });
  it('연속 운동 주: 이번 주를 아직 안 했어도 끊긴 것 아님', () => {
    expect(weekStreak([w0, w1, w2], '2026-09-30')).toBe(1); // 9/21 주가 비어 끊김
    const w3 = wk('w3', at(2026, 9, 22), []);
    expect(weekStreak([w0, w1, w2, w3], '2026-09-30')).toBe(3);
    expect(weekStreak([w0, w3], '2026-09-30')).toBe(2); // 이번 주 아직
    expect(weekStreak([], '2026-09-30')).toBe(0);
  });
});

describe('도구', () => {
  it('원판 계산: 정확히, 안 되면 가까운 아래 + 남는 무게, 쌍 개수 제한, 바 이하', () => {
    expect(plateCalc(100, 20)).toEqual({ perSide: [25, 15], achieved: 100, remainder: 0 });
    expect(plateCalc(62.5, 20)).toEqual({ perSide: [20, 1.25], achieved: 62.5, remainder: 0 });
    expect(plateCalc(101, 20)).toEqual({ perSide: [25, 15], achieved: 100, remainder: 1 });
    expect(plateCalc(140, 20, [20, 10], { '20': 2 })).toEqual({ perSide: [20, 20, 10, 10], achieved: 140, remainder: 0 });
    expect(plateCalc(15, 20)).toEqual({ perSide: [], achieved: 20, remainder: -5 });
    expect(plateCalc(20, 20)).toEqual({ perSide: [], achieved: 20, remainder: 0 });
  });
  it('1RM 표: 100×5 → 116.7, 비율별 무게는 2.5kg 단위', () => {
    const t = oneRMTable(100, 5);
    expect(t.oneRM).toBe(116.7);
    expect(t.rows[0]).toEqual({ pct: 100, kg: 117.5, reps: 1 });
    expect(t.rows.find((r) => r.pct === 85)).toEqual({ pct: 85, kg: 100, reps: 5 });
    expect(t.rows.every((r) => (r.kg * 10) % 25 === 0)).toBe(true);
  });
});
