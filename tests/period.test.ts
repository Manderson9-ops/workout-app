import { describe, expect, it } from 'vitest';
import { periodOf, shiftPeriod, periodBuckets, compareThrough, periodData, earliestPeriod, activeAverage, daysInMonth } from '../src/core/period';
import { hasBatchim, josa, valueText, metricValue, prevName, prevPhrase, periodLabel, rangeText, compareLine, bigParts, avgText, tonMode, headline, cardAria, bucketText, footnote } from '../src/core/periodText';
import { weekSummary } from '../src/core/stats';
import type { Workout, SetLog } from '../src/core/session';
import type { Exercise } from '../src/core/types';

const ex = (id: string, part: Exercise['part']): Exercise => ({ id, name_ko: id, family: id, part, muscles: ['m'], pattern: 'H_PUSH', mechanics: 'compound', equipment: ['barbell'] });
const byId = new Map([['bench', ex('bench', '가슴')]]);
const st = (weight: number, reps: number, extra: Partial<SetLog> = {}): SetLog => ({ weight, reps, warmup: false, done: true, ...extra });
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
const wk = (id: string, start: string, sets: SetLog[], endedMin: number | null = 60): Workout => ({
  id, name: id, startedAt: start, ...(endedMin === null ? {} : { endedAt: new Date(Date.parse(start) + endedMin * 60000).toISOString() }), timer: null,
  blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench', target: { sets: 3, reps: 8 }, sets }] }],
});

describe('periodOf / shiftPeriod / periodBuckets', () => {
  it('주(일요일 시작)·월·년 범위', () => {
    expect(periodOf('week', '2026-11-18')).toEqual({ kind: 'week', start: '2026-11-15', end: '2026-11-22' });
    expect(periodOf('week', '2026-11-15').start).toBe('2026-11-15');
    expect(periodOf('week', '2026-01-01')).toEqual({ kind: 'week', start: '2025-12-28', end: '2026-01-04' });
    expect(periodOf('month', '2026-11-16')).toEqual({ kind: 'month', start: '2026-11-01', end: '2026-12-01' });
    expect(periodOf('month', '2026-12-31')).toEqual({ kind: 'month', start: '2026-12-01', end: '2027-01-01' });
    expect(periodOf('year', '2026-11-16')).toEqual({ kind: 'year', start: '2026-01-01', end: '2027-01-01' });
  });
  it('shiftPeriod: 앞뒤로, 해 경계 넘기', () => {
    const w = periodOf('week', '2026-01-01');
    expect(shiftPeriod(w, 1).start).toBe('2026-01-04');
    expect(shiftPeriod(w, -1).start).toBe('2025-12-21');
    const m = periodOf('month', '2026-01-15');
    expect(shiftPeriod(m, -1).start).toBe('2025-12-01');
    expect(shiftPeriod(m, 12).start).toBe('2027-01-01');
    expect(shiftPeriod(periodOf('month', '2026-12-05'), 1).start).toBe('2027-01-01');
    expect(shiftPeriod(m, -13).start).toBe('2024-12-01');
    expect(shiftPeriod(periodOf('year', '2026-05-05'), -2).start).toBe('2024-01-01');
    expect(shiftPeriod(m, 0)).toEqual(m);
  });
  it('periodBuckets: 주 7일(해 경계), 월 28~31일(윤년), 년 12달', () => {
    const w = periodBuckets(periodOf('week', '2025-12-30'));
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ start: '2025-12-28', end: '2025-12-29' });
    expect(w[6]).toEqual({ start: '2026-01-03', end: '2026-01-04' });
    expect(periodBuckets(periodOf('month', '2027-02-10'))).toHaveLength(28);
    expect(periodBuckets(periodOf('month', '2028-02-10'))).toHaveLength(29);
    expect(periodBuckets(periodOf('month', '2026-04-10'))).toHaveLength(30);
    expect(periodBuckets(periodOf('month', '2026-12-10'))).toHaveLength(31);
    expect(periodBuckets(periodOf('month', '2028-02-10')).at(-1)).toEqual({ start: '2028-02-29', end: '2028-03-01' });
    const y = periodBuckets(periodOf('year', '2026-06-01'));
    expect(y).toHaveLength(12);
    expect(y[0]).toEqual({ start: '2026-01-01', end: '2026-02-01' });
    expect(y[11]).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe('compareThrough', () => {
  it('주: 지난주 같은 요일', () => {
    expect(compareThrough(periodOf('week', '2026-11-18'), '2026-11-18')).toBe('2026-11-11');
    expect(compareThrough(periodOf('week', '2026-01-01'), '2026-01-01')).toBe('2025-12-25');
  });
  it('월: 같은 날, 짧은 달은 말일로', () => {
    expect(compareThrough(periodOf('month', '2026-11-16'), '2026-11-16')).toBe('2026-10-16');
    expect(compareThrough(periodOf('month', '2026-03-31'), '2026-03-31')).toBe('2026-02-28');
    expect(compareThrough(periodOf('month', '2028-03-31'), '2028-03-31')).toBe('2028-02-29');
    expect(compareThrough(periodOf('month', '2026-01-10'), '2026-01-10')).toBe('2025-12-10');
  });
  it('년: 작년 같은 월·일, 2/29 는 2/28', () => {
    expect(compareThrough(periodOf('year', '2026-11-16'), '2026-11-16')).toBe('2025-11-16');
    expect(compareThrough(periodOf('year', '2028-02-29'), '2028-02-29')).toBe('2027-02-28');
  });
});

describe('periodData', () => {
  const ws: Workout[] = [
    wk('a', at(2026, 11, 15), [st(100, 5), st(100, 5)]), // 일, 2세트 1000kg 60분
    wk('b', at(2026, 11, 16), [st(50, 10)], 30), // 월
    wk('c', at(2026, 11, 18), [st(60, 5), st(60, 5, { warmup: true })]), // 수 (웜업 제외)
    wk('open', at(2026, 11, 17), [st(80, 5)], null), // 안 끝남
    wk('zero', at(2026, 11, 17), [st(80, 5, { done: false })]), // 완료 세트 0
    wk('prevwk', at(2026, 11, 10), [st(40, 5)]),
    wk('oct', at(2026, 10, 3), [st(30, 10)]),
    wk('last', at(2025, 6, 7), [st(20, 10)]),
  ];
  it('주: 센 규칙 = weekSummary, 제외 규칙', () => {
    const r = periodOf('week', '2026-11-16');
    const d = periodData(ws, byId, r, []);
    const sum = weekSummary(ws, byId, '2026-11-15', []);
    expect(d.totals).toEqual({ count: sum.count, sets: sum.sets, volume: sum.volume, durationSec: sum.durationSec });
    expect(d.totals.count).toBe(3);
    expect(d.series.sets).toEqual([2, 1, 0, 1, 0, 0, 0]);
    expect(d.active).toEqual([true, true, false, true, false, false, false]);
    for (const m of ['count', 'sets', 'volume', 'time'] as const) expect(d.series[m].reduce((a, b) => a + b, 0)).toBe({ count: d.totals.count, sets: d.totals.sets, volume: d.totals.volume, time: d.totals.durationSec }[m]);
  });
  it('through 로 자르기', () => {
    const d = periodData(ws, byId, periodOf('week', '2026-11-16'), [], '2026-11-16');
    expect(d.totals.count).toBe(2);
    expect(d.series.sets[3]).toBe(0);
  });
  it('월·년 칸', () => {
    const m = periodData(ws, byId, periodOf('month', '2026-11-16'), []);
    expect(m.series.count).toHaveLength(30);
    expect(m.series.count[9]).toBe(1); // 11/10
    expect(m.totals.count).toBe(4);
    const y = periodData(ws, byId, periodOf('year', '2026-11-16'), []);
    expect(y.series.count[10]).toBe(4);
    expect(y.series.count[9]).toBe(1);
    expect(y.totals.count).toBe(5);
    expect(periodData(ws, byId, periodOf('year', '2025-06-01'), []).series.count[5]).toBe(1);
  });
  it('earliestPeriod / activeAverage', () => {
    expect(earliestPeriod(ws, 'week', '2026-11-16')).toBe('2025-06-01');
    expect(earliestPeriod(ws, 'month', '2026-11-16')).toBe('2025-06-01');
    expect(earliestPeriod(ws, 'year', '2026-11-16')).toBe('2025-01-01');
    expect(earliestPeriod([ws[3]!, ws[4]!], 'month', '2026-11-16')).toBe('2026-11-01');
    expect(activeAverage([2, 1, 0, 3], [true, true, false, true])).toBe(2);
    expect(activeAverage([0, 0], [false, false])).toBe(0);
  });
});

describe('periodText', () => {
  it('조사', () => {
    expect(hasBatchim('볼륨')).toBe(true);
    expect(hasBatchim('세트')).toBe(false);
    expect(hasBatchim('1,200kg')).toBe(true);
    expect(hasBatchim('3')).toBe(false);
    expect(josa('작업 세트', '이', '가')).toBe('작업 세트가');
    expect(josa('시간', '이', '가')).toBe('시간이');
  });
  it('값·이름·라벨', () => {
    expect(valueText('count', 3)).toBe('3회');
    expect(valueText('count', 2.5)).toBe('2.5회');
    expect(valueText('sets', 9)).toBe('9세트');
    expect(valueText('volume', 12345.4)).toBe('12,345kg');
    expect(valueText('time', 720)).toBe('12분');
    expect(bigParts('count', 1894)).toEqual([['1,894', '회']]);
    expect(bigParts('sets', 1894)).toEqual([['1,894', '세트']]);
    expect(bigParts('volume', 12345)).toEqual([['12,345', 'kg']]);
    expect(bigParts('time', 4380)).toEqual([[1, '시간'], [13, '분']]);
    expect(bigParts('time', 35000)).toEqual([[9, '시간'], [43, '분']]);
    expect(bigParts('time', 36000)).toEqual([['10', '시간']]);
    expect(bigParts('time', 168 * 3600 + 1700)).toEqual([['168', '시간']]);
    expect(avgText('week', 'sets', 8.6)).toBe('운동한 날 평균 9세트');
    expect(avgText('year', 'count', 3.4)).toBe('운동한 달 평균 3회');
    expect(avgText('month', 'volume', 1234.5)).toBe('운동한 날 평균 1,235kg');
    expect(avgText('week', 'time', 2900)).toBe('운동한 날 평균 48분');
    expect(valueText('volume', 1234567, true)).toBe('1,235톤');
    expect(bigParts('volume', 1234567, true)).toEqual([['1,235', '톤']]);
    expect(valueText('volume', 300, true)).toBe('0.3톤');
    expect(valueText('volume', 9940, true)).toBe('9.9톤');
    expect(valueText('volume', 9960, true)).toBe('10톤');
    expect(bigParts('volume', 250253, true)).toEqual([['250', '톤']]);
    expect(avgText('year', 'volume', 250253.4, true)).toBe('운동한 달 평균 250톤');
    expect(tonMode(999999, 10)).toBe(false);
    expect(tonMode(10, 1_000_000)).toBe(true);
    const t = { count: 1, sets: 2, volume: 3, durationSec: 4 };
    expect([metricValue('count', t), metricValue('sets', t), metricValue('volume', t), metricValue('time', t)]).toEqual([1, 2, 3, 4]);
    expect(prevName('week', true)).toBe('지난주 이맘때');
    expect(prevName('year', true, true)).toBe('작년');
    expect(prevName('month', false)).toBe('그 전 달');
    expect(prevPhrase('week', true)).toBe('지난주 같은 요일까지');
    expect(prevPhrase('month', true)).toBe('지난달 같은 날까지');
    expect(prevPhrase('year', false)).toBe('전년');
    expect(compareLine('week', true)).toBe('vs. 지난주');
    expect(compareLine('month', true)).toBe('vs. 지난달');
    expect(compareLine('year', true)).toBe('vs. 작년');
    expect(compareLine('year', false)).toBe('vs. 전년');
    const today = '2026-11-16';
    expect(periodLabel(periodOf('week', today), 0, today)).toBe('이번 주');
    expect(periodLabel(periodOf('week', '2026-11-01'), 2, today)).toBe('11월 1일~7일');
    expect(periodLabel(periodOf('week', '2026-11-08'), 1, today)).toBe('지난주');
    expect(periodLabel(periodOf('month', today), 0, today)).toBe('이번 달');
    expect(periodLabel(periodOf('month', '2026-10-01'), 1, today)).toBe('지난달');
    expect(periodLabel(periodOf('month', '2026-09-01'), 2, today)).toBe('9월');
    expect(periodLabel(periodOf('month', '2025-09-01'), 14, today)).toBe('2025년 9월');
    expect(periodLabel(periodOf('year', today), 0, today)).toBe('올해');
    expect(periodLabel(periodOf('year', '2025-01-01'), 1, today)).toBe('작년');
    expect(periodLabel(periodOf('year', '2024-01-01'), 2, today)).toBe('2024년');
    expect(rangeText(periodOf('week', today), today)).toBe('11월 15일~21일');
    expect(rangeText(periodOf('month', today), today)).toBe('11월 1일~30일');
    expect(rangeText(periodOf('month', '2025-02-01'), today)).toBe('2025년 2월 1일~28일');
    expect(rangeText(periodOf('year', today), today)).toBe('2026년 1월~12월');
    expect(bucketText('week', '2026-11-16')).toBe('11월 16일 (월)');
    expect(bucketText('year', '2026-03-01')).toBe('2026년 3월');
  });
  it('한 문장', () => {
    const sp = (s: string) => s.replace(/ /g, ' ').replace(/⁠/g, ''); // 줄바꿈 안 되는 공백은 일반 공백으로 견줌
    const H = (o: Partial<Parameters<typeof headline>[0]>) => sp(headline({ kind: 'week', current: true, metric: 'sets', cur: 1, prev: 1, curCount: 1, prevCount: 1, label: '이번 주', ...o }));
    expect(H({ cur: 20, prev: 11 })).toBe('지난주 이맘때보다 작업 세트가 9세트 많아요');
    expect(H({ cur: 2, prev: 11 })).toBe('지난주 이맘때보다 작업 세트가 9세트 적어요');
    expect(H({ cur: 0, prev: 9 })).toBe('지난주 이맘때보다 작업 세트가 9세트 적어요');
    expect(H({ cur: 5, prev: 5 })).toBe('지난주 이맘때와 작업 세트가 같아요');
    expect(H({ cur: 9, prev: 0, prevCount: 0 })).toBe('지난주 이맘때는 운동이 없었어요 · 이번 주 9세트');
    expect(H({ cur: 0, prev: 0, curCount: 0, prevCount: 0 })).toBe('이번 주는 아직 운동 기록이 없어요');
    expect(H({ kind: 'month', cur: 0, prev: 0, curCount: 0, prevCount: 0, label: '이번 달' })).toBe('이번 달은 아직 운동 기록이 없어요');
    expect(H({ kind: 'year', cur: 0, prev: 0, curCount: 0, prevCount: 0, label: '올해' })).toBe('올해는 아직 운동 기록이 없어요');
    expect(H({ current: false, cur: 0, prev: 0, curCount: 0, prevCount: 0, label: '지난주' })).toBe('이 기간에는 운동 기록이 없어요');
    expect(H({ current: false, kind: 'month', metric: 'volume', cur: 1000, prev: 400, label: '9월' })).toBe('그 전 달보다 볼륨이 600kg 많아요');
    expect(H({ current: false, kind: 'month', cur: 5, prev: 5, label: '9월' })).toBe('그 전 달과 작업 세트가 같아요');
    expect(H({ current: false, kind: 'month', cur: 5, prev: 0, prevCount: 0, label: '9월' })).toBe('그 전 달은 운동이 없었어요 · 9월 5세트');
    expect(H({ current: false, kind: 'year', cur: 5, prev: 0, prevCount: 0, label: '2025년' })).toBe('전년은 운동이 없었어요 · 2025년 5세트');
    expect(H({ current: false, kind: 'year', cur: 5, prev: 3, label: '2025년' })).toBe('전년보다 작업 세트가 2세트 많아요');
    expect(H({ current: false, kind: 'year', metric: 'count', cur: 2, prev: 2, label: '2025년' })).toBe('전년과 운동이 같아요');
    expect(H({ metric: 'time', cur: 3600, prev: 2880 })).toBe('지난주 이맘때보다 시간이 12분 길어요');
    expect(H({ metric: 'time', cur: 2880, prev: 3600 })).toBe('지난주 이맘때보다 시간이 12분 짧아요');
    // 맨몸 운동만 한 주: 볼륨 0 이지만 운동은 있었음
    expect(H({ metric: 'volume', cur: 0, prev: 800 })).toBe('지난주 이맘때보다 볼륨이 800kg 적어요');
    expect(H({ metric: 'volume', cur: 800, prev: 0 })).toBe('지난주 이맘때보다 볼륨이 800kg 많아요');
    expect(H({ metric: 'volume', cur: 0, prev: 0 })).toBe('무게를 적은 세트가 없어 볼륨은 0kg이에요');
    expect(H({ metric: 'time', cur: 0, prev: 0 })).toBe('지난주 이맘때와 시간이 같아요');
    expect(H({ metric: 'volume', cur: 3003040, prev: 0, prevCount: 0, label: '작년', current: false, kind: 'year' })).toBe('전년은 운동이 없었어요 · 작년 3,003톤');
    expect(H({ metric: 'volume', cur: 2500000, prev: 1000000 })).toBe('지난주 이맘때보다 볼륨이 1,500톤 많아요');
    // 라벨·값의 띄어쓰기는 줄바꿈 안 되는 공백
    expect(headline({ kind: 'week', current: true, metric: 'time', cur: 4380, prev: 0, curCount: 1, prevCount: 0, label: '이번 주' })).toContain('이번 주 1시간 13분');
  });
  it('카드 읽기 문구·아래 글', () => {
    const o = { kind: 'week' as const, current: true, metric: 'count' as const };
    expect(cardAria({ ...o, cur: 1, prev: 0 })).toBe('운동 1회, 지난주 같은 요일까지 0회보다 1회 많음');
    expect(cardAria({ ...o, cur: 0, prev: 2 })).toBe('운동 0회, 지난주 같은 요일까지 2회보다 2회 적음');
    expect(cardAria({ ...o, current: false, cur: 2, prev: 2 })).toBe('운동 2회, 그 전 주 2회와 같음');
    expect(cardAria({ kind: 'year', current: true, metric: 'volume', cur: 1500000, prev: 900000, ton: true })).toBe('볼륨 1,500톤, 작년 같은 날까지 900톤보다 600톤 많음');
    expect(footnote('week', true, '2026-11-09', 3, 1)).toBe('▲▼ = 지난주 같은 요일(일~월)까지와 비교 · 연속 3주 · 일요일~토요일 기준');
    expect(footnote('week', true, '2026-11-08', 3, 0)).toContain('(일)까지');
    expect(footnote('week', false, '', 0, 0)).toBe('▲▼ = 그 전 주 전체와 비교');
    expect(footnote('month', true, '2026-10-16', 0, 1)).toBe('▲▼ = 지난달 같은 날(1~16일)까지와 비교');
    expect(footnote('month', true, '2026-10-01', 0, 1)).toBe('▲▼ = 지난달 같은 날(1일)까지와 비교');
    expect(footnote('year', true, '2025-11-16', 0, 1)).toBe('▲▼ = 작년 같은 날(1월 1일~11월 16일)까지와 비교');
    expect(footnote('year', true, '2025-01-01', 0, 1)).toBe('▲▼ = 작년 같은 날(1월 1일)까지와 비교');
    expect(cardAria({ ...o, metric: 'time', cur: 3600, prev: 2880 })).toBe('시간 1시간, 지난주 같은 요일까지 48분보다 12분 김');
    expect(cardAria({ ...o, metric: 'time', cur: 2880, prev: 3600 })).toBe('시간 48분, 지난주 같은 요일까지 1시간보다 12분 짧음');
    expect(footnote('year', false, '', 0, 0)).toBe('▲▼ = 전년 전체와 비교');
  });
});
