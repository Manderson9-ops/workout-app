import { describe, expect, it } from 'vitest';
import { localDate, bodyweightOn, exerciseHistory, summarize, weekStart, weeklyPartSets, weeklyTotals, plannedVsActual, monthDays, weekStreak, plateCalc, oneRMTable, addDays, weekSummary, bestSetLabel, exerciseLines } from '../src/core/stats';
import type { Workout, SetLog } from '../src/core/session';
import type { Exercise } from '../src/core/types';
import { heatBucket } from '../src/ui/bodyMapView';

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
  it('주 시작은 일요일 (D-054)', () => {
    expect(weekStart('2026-09-30')).toBe('2026-09-27'); // 수 → 일
    expect(weekStart('2026-09-27')).toBe('2026-09-27'); // 일은 자기 자신
    expect(weekStart('2026-10-03')).toBe('2026-09-27'); // 토 → 그 주 일
    expect(weekStart('2026-10-04')).toBe('2026-10-04'); // 다음 일요일은 새 주
    expect(weekStart('2026-09-28')).toBe('2026-09-27'); // 월 → 일
    expect(weekStart('2026-01-01')).toBe('2025-12-28'); // 해를 넘어감
  });
  it('addDays: 월·해 경계', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-09-27', -7)).toBe('2026-09-20');
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
    expect(r.map((x) => x.week)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
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
    expect(t.rows[0]).toEqual({ pct: 100, kg: 116.7, reps: 1 }); // 100%는 추정값 그대로
    expect(t.reliable).toBe(true);
    expect(oneRMTable(60, 20).reliable).toBe(false);
    expect(t.rows.find((r) => r.pct === 85)).toEqual({ pct: 85, kg: 100, reps: 5 });
    expect(t.rows.slice(1).every((r) => (r.kg * 10) % 25 === 0)).toBe(true);
  });
});

describe('원판 계산: 모든 조합 검사 (검토 M4)', () => {
  it('큰 것부터 채우면 놓치는 정확한 조합을 찾음', () => {
    expect(plateCalc(60, 20, [15, 10])).toEqual({ perSide: [10, 10], achieved: 60, remainder: 0 });
    expect(plateCalc(80, 20, [25, 20, 15, 10])).toEqual({ perSide: [20, 10], achieved: 80, remainder: 0 }); // 25+5 불가 → 20+10
  });
  it('정확한 조합 중 원판 수가 가장 적은 것', () => {
    expect(plateCalc(100, 20, [20, 15, 10, 5]).perSide).toEqual([20, 20]);
    expect(plateCalc(70, 20, [20, 15, 10, 5]).perSide).toEqual([20, 5]);
  });
  it('쌍 개수 제한 안에서, 못 만들면 목표 아래 가장 가까운 무게', () => {
    expect(plateCalc(100, 20, [20, 5], { '20': 1, '5': 1 })).toEqual({ perSide: [20, 5], achieved: 70, remainder: 30 });
    expect(plateCalc(21, 20, [1.25])).toEqual({ perSide: [], achieved: 20, remainder: 1 });
    expect(plateCalc(22.5, 20, [1.25])).toEqual({ perSide: [1.25], achieved: 22.5, remainder: 0 });
    expect(plateCalc(25, 20, [])).toEqual({ perSide: [], achieved: 20, remainder: 5 });
  });
  it('0.25kg로 안 떨어지는 원판은 무시, 너무 큰 목표는 500kg까지만 (멈춤 방지)', () => {
    expect(plateCalc(60, 20, [0.1, 20])).toEqual({ perSide: [20], achieved: 60, remainder: 0 });
    const t0 = performance.now();
    expect(plateCalc(10000, 20).achieved).toBe(500);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it('무거운 목표도 빠르게 (300kg, 모든 원판)', () => {
    const t0 = performance.now();
    expect(plateCalc(300, 20).achieved).toBe(300);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('주간 합계·예상 대비 실제', () => {
  const w = (id: string, start: string, sets: SetLog[], min: number, planned?: number) => wk(id, start, [{ id: 'bench', sets }], min, planned ? { plannedSec: planned } : {});
  const a = w('a', at(2026, 9, 29), [s(60, 10), s(60, 10)], 50, 3000);
  const b = w('b', at(2026, 9, 30), [s(50, 10)], 70, 3000);
  const old = w('o', at(2026, 8, 3), [s(40, 10)], 30);
  it('주별 볼륨·세트·운동 수 (8주, 범위 밖 제외)', () => {
    const t = weeklyTotals([a, b, old], byId, '2026-09-30', 8);
    expect(t).toHaveLength(8);
    expect(t[7]).toEqual({ week: '2026-09-27', volume: 1700, sets: 3, count: 2 });
    expect(t.slice(0, 7).every((x) => x.count === 0)).toBe(true);
  });
  it('예상이 있는 운동만 평균 (최신순 입력)', () => {
    const sums = [b, a, old].map((x) => summarize(x, byId));
    expect(plannedVsActual(sums)).toEqual({ n: 2, avgDiffSec: 600, avgRatio: 1.2 }); // +20분, -10분 → 평균 +10분
    expect(plannedVsActual([summarize(old, byId)])).toBeUndefined();
  });
});

describe('다른 시간대에서도 날짜가 같음 (검토: 시간대)', () => {
  const orig = process.env.TZ;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Seoul', 'Pacific/Kiritimati']) {
    it(tz, () => {
      process.env.TZ = tz;
      try {
        // 현지 밤 11시 운동은 그 현지 날짜, 일요일 시작, 달력 날짜 일치
        const late = at(2026, 9, 27, 23); // 일요일 밤
        expect(localDate(late)).toBe('2026-09-27');
        expect(weekStart('2026-09-27')).toBe('2026-09-27');
        const x = wk('tz', late, [{ id: 'bench', sets: [s(60, 5)] }], 30);
        expect([...monthDays([x], 2026, 9).keys()]).toEqual([27]);
        expect(weeklyPartSets([x], byId, '2026-09-30', 2)[1]!.parts.가슴).toBe(1); // 일요일 운동은 그 일요일에 시작하는 주
      } finally { process.env.TZ = orig; }
    });
  }
});

describe('이번 주 요약·최고 세트·종목 줄 (D-054)', () => {
  const sun = wk('sun', at(2026, 9, 27, 9), [{ id: 'bench', sets: [s(60, 8), s(60, 8)] }], 30);        // 일요일 = 새 주 시작
  const sat = wk('sat', at(2026, 10, 3, 9), [{ id: 'curl', sets: [s(12, 10)] }], 20);                   // 토요일 = 같은 주 끝
  const prevSat = wk('ps', at(2026, 9, 26, 22), [{ id: 'bench', sets: [s(50, 10)] }], 45);              // 전 주 토요일 밤
  const open = { ...wk('open', at(2026, 9, 28), [{ id: 'bench', sets: [s(99, 9)] }]), endedAt: undefined };
  it('weekSummary: 일~토 합계 (진행 중 제외), 날짜 집합', () => {
    const r = weekSummary([sun, sat, prevSat, open], byId, '2026-09-27');
    expect(r.count).toBe(2);
    expect(r.sets).toBe(3);
    expect(r.volume).toBe(960 + 120);
    expect(r.durationSec).toBe((30 + 20) * 60);
    expect([...r.days].sort()).toEqual(['2026-09-27', '2026-10-03']);
    const p = weekSummary([sun, sat, prevSat], byId, '2026-09-20');
    expect(p).toMatchObject({ count: 1, sets: 1, volume: 500, durationSec: 45 * 60 });
    expect(weekSummary([], byId, '2026-09-27')).toMatchObject({ count: 0, sets: 0, volume: 0, durationSec: 0 });
    expect(weekSummary([sun], byId, '2026-09-30').count).toBe(1); // 주 중간 날짜를 줘도 그 주
  });
  it('bestSetLabel: 가장 무거운 세트, 같으면 횟수 많은 쪽', () => {
    expect(bestSetLabel([s(10, 12), s(12, 2), s(12, 5), s(15, 3, { done: false }), s(20, 1, { warmup: true })])).toBe('12kg × 5회');
    expect(bestSetLabel([s(12, 2)])).toBe('12kg × 2회');
  });
  it('bestSetLabel: 맨몸·시간·없음', () => {
    expect(bestSetLabel([s(undefined, 8), s(undefined, 12), s(undefined, 10)])).toBe('12회');
    expect(bestSetLabel([{ seconds: 45, warmup: false, done: true }, { seconds: 60, warmup: false, done: true }])).toBe('60초');
    expect(bestSetLabel([s(30, 5, { done: false })])).toBeUndefined();
    expect(bestSetLabel([])).toBeUndefined();
  });
  it('exerciseLines: 완료 세트가 있는 종목만, 이름·세트 수·최고', () => {
    const w = wk('x', at(2026, 10, 3), [
      { id: 'curl', sets: [s(12, 10), s(12, 12), s(10, 12, { done: false })] },
      { id: 'bench', sets: [s(60, 5, { done: false })] },
      { id: 'ghost', sets: [s(5, 5)] },
    ]);
    expect(exerciseLines(w, byId)).toEqual([
      { exerciseId: 'curl', name: 'curl', sets: 2, best: '12kg × 12회' },
      { exerciseId: 'ghost', name: 'ghost', sets: 1, best: '5kg × 5회' },
    ]);
    expect(exerciseLines(wk('e', at(2026, 10, 3), []), byId)).toEqual([]);
  });
  it('heatBucket 경계: 0 / 1~4 / 5~9 / 10+', () => {
    expect([0, 1, 4, 5, 9, 10, 25].map(heatBucket)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});
