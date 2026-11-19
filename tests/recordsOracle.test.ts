/**
 * D-082 e2e 오라클(e2e/fixtures/recordsOracle.ts)과 예시 데이터(e2e/fixtures/recordsMock.ts)가 승인 목업 하네스(docs/mockups/records/harness.cjs)의
 * 상수와 같은 값을 내는지 대조한다. 하네스 상수는 여기서 비교에만 쓰고, e2e 의 기대값으로는 쓰지 않는다 (목업과 앱이 같은 오답을 나눠 갖지 않게 — SPEC 시험 항목).
 * 다르면 SPEC 식이 정답이고 목업·하네스 쪽을 다시 본다
 */
import { describe, expect, it } from 'vitest';
import { SCEN_IDS, SCENS, gen, toWorkout } from '../e2e/fixtures/recordsMock';
import { expectView, loadExpect, zoneOf, ZONE_NAME, monthShift, add } from '../e2e/fixtures/recordsOracle';
import type { ScenId } from '../e2e/fixtures/recordsMock';

const data = (sc: ScenId) => gen(sc);
const view = (sc: ScenId, kind: Parameters<typeof expectView>[2], metric: Parameters<typeof expectView>[3], mode: Parameters<typeof expectView>[4]) => {
  const { W, today } = data(sc);
  return expectView(W, today, kind, metric, mode);
};

describe('하네스 EXPECT 상수 대조 (부하 카드)', () => {
  // harness.cjs:184-187 의 EXPECT·EXPECT_WEEK·EXPECT_MK (승인된 목업 출력)
  const EXPECT: Record<string, [string, string]> = { normal: ['1.08', '평소 수준'], back1: ['1.42', '평소보다 많음'], back2: ['1.95', '평소보다 크게 많음'], deload: ['0.63', '평소보다 적음'], week3: ['1.00', '평소 수준'], day20: ['HIDDEN', ''], newbie: ['HIDDEN', ''] };
  const EXPECT_WEEK: Record<string, string> = { normal: '지난주 화요일 1.31 → 오늘 1.08 · 지난주보다 0.23 낮아요', back1: '지난주 화요일 0.46 → 오늘 1.42 · 지난주보다 0.96 높아요' };
  for (const [sc, [ratio, zone]] of Object.entries(EXPECT)) {
    it(`${sc}: ${ratio} ${zone}`, () => {
      const { W, today } = data(sc as ScenId), l = loadExpect(W, today);
      if (ratio === 'HIDDEN') { expect(l.show).toBe(false); return; }
      expect([l.ratio, l.zoneName]).toEqual([ratio, zone]);
    });
  }
  for (const [sc, week] of Object.entries(EXPECT_WEEK)) it(`${sc}: 지난주 같은 요일 줄`, () => { const { W, today } = data(sc as ScenId); expect(loadExpect(W, today).week).toBe(week); });
  it('normal: 띠 위치 = min(100, 1.08/2) = 54%', () => { const { W, today } = data('normal'); expect(loadExpect(W, today).mk).toBeCloseTo(54, 9); });
  it('20일째는 숨김·일수 안내, 21일째는 보임', () => {
    const d20 = loadExpect(data('day20').W, data('day20').today), w3 = loadExpect(data('week3').W, data('week3').today);
    expect(d20.show).toBe(false); expect(d20.wait).toBe('기록이 3주 쌓이면 부하 비율을 보여 드려요. 지금 20일째예요.');
    expect(w3.show).toBe(true);
  });
  it('구간 경계 0.8·1.3·1.5 (harness ZONES)', () => {
    for (const [v, name] of [[0.79, '평소보다 적음'], [0.8, '평소 수준'], [1.3, '평소 수준'], [1.31, '평소보다 많음'], [1.5, '평소보다 많음'], [1.51, '평소보다 크게 많음']] as const) expect(ZONE_NAME[zoneOf(v)]).toBe(name);
  });
});

describe('하네스 의미 검사 상수 대조 (기간 카드·막대·내역)', () => {
  it('normal 년: 3,316세트 · 작년 이맘때보다 작업 세트가 80세트 많아요 · 3월 3일 이후끼리 · 3/3~ 2,596세트 / 이전 2,516세트', () => {
    const v = view('normal', 'year', 'sets', 'both');
    expect(v.hero).toBe('3,316세트');
    expect(v.sentence).toBe('작년 이맘때보다 작업 세트가 80세트 많아요');
    expect(v.subs[0]).toContain('3월 3일 이후끼리');
    expect(v.cards[1]!.small).toEqual(['3/3~ 2,596세트', '이전 2,516세트']);
  });
  it('rest 주: 지난주 이맘때보다 작업 세트가 7세트 많아요 (어제까지 비교)', () => { expect(view('rest', 'week', 'sets', 'both').sentence).toBe('지난주 이맘때보다 작업 세트가 7세트 많아요'); });
  it('first 주: 카드 작은 줄 "운동하면 비교해요"', () => {
    const v = view('first', 'week', 'sets', 'both');
    expect(v.cards.map((c) => c.small)).toEqual([['운동하면 비교해요'], ['운동하면 비교해요'], ['운동하면 비교해요'], ['운동하면 비교해요']]);
    expect(v.cards.map((c) => c.glyph)).toEqual(['', '', '', '']);
  });
  it('newbie 월: 기록을 시작하기 전', () => { expect(view('newbie', 'month', 'sets', 'both').sentence).toContain('기록을 시작하기 전'); });
  it('normal 주: 지난주 전체까지 47세트 남았어요', () => { expect(view('normal', 'week', 'sets', 'both').subs).toContain('지난주 전체까지 47세트 남았어요'); });
  it('막대 개수: normal 주 파랑 2·회색 4, 월 파랑 10·회색 14 (harness V8)', () => {
    const w = view('normal', 'week', 'sets', 'both').counts, m = view('normal', 'month', 'sets', 'both').counts;
    expect([w.cur, w.prev, m.cur, m.prev]).toEqual([2, 4, 10, 14]);
  });
  it('내역: normal 주 11/17 (화),11/16 (월) · 이번 주 운동 2개 / 월 이번 달 운동 10개 + 5개 더 보기 (남은 5개)', () => {
    const w = view('normal', 'week', 'sets', 'both').hist, m = view('normal', 'month', 'sets', 'both').hist;
    expect(w.rows.map((r) => r.d)).toEqual(['11/17 (화)', '11/16 (월)']); expect(w.title).toBe('이번 주 운동 2개');
    expect(m.title).toBe('이번 달 운동 10개'); expect(m.rows).toHaveLength(5); expect(m.more).toBe('5개 더 보기 (남은 5개)');
  });
  it('막대 보기 평균: normal 월 운동한 날 평균 19.1세트', () => { expect(view('normal', 'month', 'sets', 'bar').avg).toBe('운동한 날 평균 19.1세트'); });
  it('달력 사실: monthend 월 범위 11월 1일~30일, newyear 해 넘는 주(앱 형식)·올해 이름', () => {
    expect(view('monthend', 'month', 'sets', 'both').range).toContain('11월 1일~30일');
    expect(view('newyear', 'week', 'sets', 'both').range).toBe('2026년 12월 27일~2027년 1월 2일 vs. 지난주'); // 하네스 목업 형식은 '…~1월 2일', 앱은 weekRangeText 형식(R4)
    expect(view('newyear', 'year', 'sets', 'both').label).toBe('올해');
  });
  it('전체 탭: 첫 기록 달부터 문장·카드 처음부터', () => {
    const v = view('normal', 'all', 'sets', 'both');
    expect(v.label).toBe('처음부터 지금까지'); expect(v.sentence).toMatch(/^2025년 3월부터 운동 \d[\d,]*회 · 작업 세트 6,307세트$/);
    expect(v.cards.map((c) => [c.small.join('|'), c.glyph])).toEqual([['처음부터', ''], ['처음부터', ''], ['처음부터', ''], ['처음부터', '']]);
  });
});

describe('예시 데이터·오라클 도구', () => {
  it('상황 11개, 오늘 날짜가 목업 SCENS 와 같다', () => {
    expect(SCEN_IDS).toHaveLength(11);
    expect(Object.fromEntries(SCEN_IDS.map((s) => [s, SCENS[s].today]))).toEqual({ normal: '2026-11-17', rest: '2026-11-17', first: '2026-11-15', back1: '2026-11-17', back2: '2026-11-17', deload: '2026-11-17', week3: '2026-11-17', day20: '2026-11-17', newbie: '2026-11-17', monthend: '2026-11-30', newyear: '2027-01-02' });
  });
  it('toWorkout: 세트 수·볼륨 합이 한 줄(row)과 정확히 같고, 끝 시각 = 시작 + time 초', () => {
    for (const sc of SCEN_IDS) for (const r of data(sc).W) {
      const w = toWorkout(r), sets = w.blocks[0]!.items[0]!.sets;
      expect(sets).toHaveLength(r.sets);
      expect(sets.reduce((t, s) => t + s.weight * s.reps, 0)).toBe(r.volume);
      expect(Date.parse(w.endedAt) - Date.parse(w.startedAt)).toBe(r.time * 1000);
    }
  });
  it('날짜 도우미: 말일 처리·윤년', () => {
    expect(monthShift('2025-01-31', 1)).toBe('2025-02-28'); expect(monthShift('2024-02-29', 12)).toBe('2025-02-28'); expect(monthShift('2026-03-31', -1)).toBe('2026-02-28');
    expect(add('2026-12-31', 1)).toBe('2027-01-01');
  });
});
