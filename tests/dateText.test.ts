import { describe, it, expect } from 'vitest';
import { timeText, dateText, dayText, dateTimeText, sinceText, agoText, weekRangeText, headerDateText, fullText, fullDateText, axisText, toDate, daysAgo } from '../src/core/dateText';

// 고정 시각: 2026-10-08(목) 오전 11:24 현지. 현지 생성자만 써서 시험 PC 시간대와 상관없게
const L = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const NOW = L(2026, 10, 8, 11, 24);

describe('D-060 날짜·시각 표시 규칙 (core/dateText)', () => {
  it('시각: 12시간 + 오전/오후, 0시·12시', () => {
    expect(timeText(L(2026, 10, 8, 11, 24))).toBe('오전 11:24');
    expect(timeText(L(2026, 10, 8, 19, 5))).toBe('오후 7:05');
    expect(timeText(L(2026, 10, 8, 0, 0))).toBe('오전 12:00');
    expect(timeText(L(2026, 10, 8, 12, 30))).toBe('오후 12:30');
    expect(timeText(L(2026, 10, 8, 9, 3, 7), { seconds: true })).toBe('오전 9:03:07');
  });
  it('날짜: 요일 괄호는 붙여 씀, 다른 해만 연도', () => {
    expect(dateText(L(2026, 10, 8), NOW)).toBe('10월 8일(목)');
    expect(dateText(L(2025, 10, 8), NOW)).toBe('2025년 10월 8일(수)');
    expect(dateText(L(2026, 1, 1), NOW, { weekday: false })).toBe('1월 1일');
    expect(dateText('2026-10-04', NOW)).toBe('10월 4일(일)'); // 날짜만 문자열은 현지 0시
  });
  it('날짜 이름: 오늘·어제·이번 주 요일(일요일 시작)·그 밖 날짜·내일', () => {
    expect(dayText(L(2026, 10, 8, 0, 1), NOW)).toBe('오늘');
    expect(dayText(L(2026, 10, 7, 23, 59), NOW)).toBe('어제');
    expect(dayText(L(2026, 10, 5, 9), NOW)).toBe('월요일');
    expect(dayText(L(2026, 10, 4, 9), NOW)).toBe('일요일'); // 이번 주 첫날
    expect(dayText(L(2026, 10, 3, 9), NOW)).toBe('10월 3일(토)'); // 지난주 토요일 → 날짜 (5일 전이어도)
    expect(dayText(L(2026, 10, 9, 9), NOW)).toBe('내일');
    expect(dayText(L(2026, 10, 12, 9), NOW)).toBe('10월 12일(월)');
    // 일요일 아침: 어제(토)는 "어제", 그 전은 지난주라 날짜
    const SUN = L(2026, 10, 11, 8);
    expect([dayText(L(2026, 10, 10), SUN), dayText(L(2026, 10, 9), SUN)]).toEqual(['어제', '10월 9일(금)']);
  });
  it('해 바뀜: 1월 1일에 어제는 "어제", 그 전 해 날짜는 연도 붙음', () => {
    const NY = L(2027, 1, 1, 9);
    expect(dayText(L(2026, 12, 31, 22), NY)).toBe('어제');
    expect(dayText(L(2026, 12, 25, 22), NY)).toBe('2026년 12월 25일(금)');
    expect(dateTimeText(L(2026, 12, 31, 22, 15), NY)).toBe('어제 오후 10:15');
  });
  it('날짜·시각', () => {
    expect(dateTimeText(L(2026, 10, 8, 11, 24), NOW)).toBe('오늘 오전 11:24');
    expect(dateTimeText(L(2026, 10, 6, 19, 5), NOW)).toBe('화요일 오후 7:05');
    expect(dateTimeText(L(2026, 9, 30, 19, 5), NOW)).toBe('9월 30일(수) 오후 7:05');
    expect(dateTimeText(L(2026, 10, 8, 11, 24), NOW, { relative: false })).toBe('10월 8일(목) 오전 11:24');
  });
  it('지난 정도: 오늘·어제·N일·N주·N개월 전, 1년 넘으면 날짜', () => {
    const r = (y: number, m: number, d: number) => sinceText(L(y, m, d, 20), NOW);
    expect(sinceText(L(2026, 10, 8, 1), NOW)).toBe('오늘');
    expect([r(2026, 10, 7), r(2026, 10, 6), r(2026, 9, 25)]).toEqual(['어제', '2일 전', '13일 전']);
    expect([r(2026, 9, 24), r(2026, 9, 9)]).toEqual(['2주 전', '4주 전']);
    expect([r(2026, 9, 8), r(2026, 7, 1), r(2025, 10, 9)]).toEqual(['1개월 전', '3개월 전', '12개월 전']);
    expect(r(2025, 10, 8)).toBe('2025년 10월 8일');
    expect(sinceText(L(2026, 10, 9), NOW)).toBe('오늘'); // 미래(시계 차이)는 오늘로
  });
  it('방금·N분 전, 1시간 넘으면 날짜·시각', () => {
    expect(agoText(L(2026, 10, 8, 11, 23, 30), NOW)).toBe('방금');
    expect(agoText(L(2026, 10, 8, 11, 0), NOW)).toBe('24분 전');
    expect(agoText(L(2026, 10, 8, 9, 10), NOW)).toBe('오늘 오전 9:10');
  });
  it('주 범위: 같은 달·다른 달·다른 해', () => {
    expect(weekRangeText('2026-10-04', NOW)).toBe('10월 4일~10일');
    expect(weekRangeText('2026-09-27', NOW)).toBe('9월 27일~10월 3일');
    expect(weekRangeText('2025-09-28', NOW)).toBe('2025년 9월 28일~10월 4일');
    expect(weekRangeText('2026-12-27', NOW)).toBe('2026년 12월 27일~2027년 1월 2일');
  });
  it('머리 날짜·화면 읽기 전체 형태·그래프 축', () => {
    expect(headerDateText(NOW)).toBe('10월 8일 목요일');
    expect(fullText(NOW)).toBe('2026년 10월 8일 목요일 오전 11시 24분');
    expect(fullText(L(2026, 10, 8, 15))).toBe('2026년 10월 8일 목요일 오후 3시');
    expect(fullDateText('2026-10-04')).toBe('2026년 10월 4일 일요일');
    expect(axisText('2026-10-04')).toBe('10/4');
  });
  it('ISO(UTC) 문자열은 기기 현지 시각으로 읽음', () => {
    const iso = L(2026, 10, 8, 0, 30).toISOString();
    expect(toDate(iso).getDate()).toBe(8);
    expect(daysAgo(iso, NOW)).toBe(0);
  });
});
