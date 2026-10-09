import { describe, it, expect } from 'vitest';
import { parseLines, parseDate, findDates, normalizeHealthReq, normalizeTop, valueText, skipHint, ingestHealth } from '../src/core/healthIngest';
import type { HState } from '../src/core/healthIngest';

// 고정 시각: 2026-10-09 금요일 23:00 (한국)
const NOW = Date.parse('2026-10-09T23:00:00+09:00');
const T = (s: string) => Date.parse(s);
const hr = (text: unknown) => parseLines('hr', text, NOW);

describe('D-061 AI 가 만든 단축어가 보낼 수 있는 모양 (서버 파서)', () => {
  it('한국어·영어 날짜 형식: 요일 붙음·마침표·두 자리 연도·연도 없음·일 월 연', () => {
    expect(parseDate('2026년 10월 9일 금요일 오후 10:53:05')).toBe(T('2026-10-09T22:53:05+09:00'));
    expect(parseDate('2026. 10. 9. (금) 오후 10:53:05')).toBe(T('2026-10-09T22:53:05+09:00'));
    expect(parseDate('2026. 10. 9. 오후 10:53:05')).toBe(T('2026-10-09T22:53:05+09:00'));
    expect(parseDate('Friday, October 9, 2026 at 10:53 PM')).toBe(T('2026-10-09T22:53:00+09:00'));
    expect(parseDate('26. 10. 9. 오후 10:20', NOW)).toBe(T('2026-10-09T22:20:00+09:00'));
    expect(parseDate('10월 9일 오후 10:20', NOW)).toBe(T('2026-10-09T22:20:00+09:00'));
    expect(parseDate('10월 9일 금요일 오후 10:20', NOW)).toBe(T('2026-10-09T22:20:00+09:00'));
    // 연도 없는 날짜가 하루 넘게 미래면 작년 (1월 초에 받은 12월 31일)
    expect(parseDate('12월 31일 오후 11:00', T('2027-01-01T09:00:00+09:00'))).toBe(T('2026-12-31T23:00:00+09:00'));
    expect(parseDate('9 Oct 2026 22:20')).toBe(T('2026-10-09T22:20:00+09:00'));
    expect(parseDate('Fri, 9 October 2026 at 10:20 PM')).toBe(T('2026-10-09T22:20:00+09:00'));
    // 시각만은 날짜가 아님 (검토 P2·P3)
    expect(findDates('128 회/분 오후 10:53', NOW)).toEqual([]);
    expect(parseDate('오후 10:53', NOW)).toBeUndefined();
  });

  it('줄 안 날짜 위치: 앞·뒤·가운데, 구분자 | 쉼표 탭 빈칸', () => {
    const r = hr([
      '2026-10-09T22:53:05+09:00 | 128 count/min',
      '128 BPM, 2026-10-09T22:54:05+09:00',
      '129 회/분 2026년 10월 9일 금요일 오후 10:55:05',
      '2026. 10. 9. 오후 10:56:05\t130',
      '심박수: 131 BPM (2026-10-09 22:57:05)',
      '2026-10-09T22:58:05+09:00 132',
    ].join('\n'));
    expect(r.skipped).toBe(0);
    expect(r.samples.map((s) => s.v)).toEqual([128, 128, 129, 130, 131, 132]);
    expect(r.samples[1]!.t).toBe(T('2026-10-09T22:54:05+09:00'));
  });

  it('검토 재현 4줄: 날짜 조각을 값으로 읽지 않음, 새 형식은 바른 값', () => {
    // 이전에는 심박 26 / 10 kcal / 9 kcal / 오늘 22:35 로 잘못 저장됨
    const h = hr('26. 10. 9. 오후 10:20 | 72');
    expect(h.samples).toEqual([{ t: T('2026-10-09T22:20:00+09:00'), v: 72 }]);
    const e1 = parseLines('energy', '10월 9일 오후 10:20 | 0.5 kcal', NOW);
    expect(e1.samples).toEqual([{ t: T('2026-10-09T22:20:00+09:00'), v: 0.5 }]);
    const e2 = parseLines('energy', '9 Oct 2026 22:20 | 0.4 kcal', NOW);
    expect(e2.samples).toEqual([{ t: T('2026-10-09T22:20:00+09:00'), v: 0.4 }]);
    const t1 = hr('오후 10:35 | 80');
    expect(t1.samples).toEqual([]);
    expect(t1.why).toEqual({ date: 0, time: 1, range: 0, value: 0 });
  });

  it('부정 시험: 모르는 날짜 조각·연도 같은 숫자·시각만은 저장하지 않음', () => {
    const lines = [
      '2026. 10. 9. | 72', // 시각 없는 날짜 → 날짜로 못 읽고, 날짜 조각이 남음
      '72 BPM 10. 9. 오후 10:20', // 연도 없는 마침표 날짜 (모름)
      '10/9 22:20 | 72', // 빗금 날짜 (순서 모호)
      '2026 | 72', // 연도만
      '72 2026', // 날짜 없음
      '9 Okt 2026 22:20 | 72', // 모르는 달 이름
      '오후 10:20 128 BPM', // 시각만
      '22:20 | 128', // 시각만 (24시간)
      '10월 9일 | 72', // 시각 없는 연도 없음 날짜
      '128 BPM, 9일 오후 10:20', // 일만
    ];
    const r = hr(lines.join('\n'));
    expect(r.samples).toEqual([]);
    expect(r.skipped).toBe(lines.length);
    expect(r.why.time).toBe(2);
    expect(r.why.date).toBe(lines.length - 2);
    // 값 칸에 연도처럼 큰 수: 범위 밖으로 건너뜀
    expect(hr('2026-10-09T22:53:05+09:00 | 2026').why.value).toBe(1);
    expect(parseLines('energy', '2026-10-09T22:53:05+09:00 | 2026 kcal', NOW).why.value).toBe(1);
    // 값 칸이 날짜 조각이면 다음 칸의 숫자를 씀, 없으면 건너뜀
    expect(hr('2026-10-09T22:53:05+09:00 | 10월 9일 | 72').samples.map((s) => s.v)).toEqual([72]);
    expect(hr('2026-10-09T22:53:05+09:00 | 10월 9일').why.value).toBe(1);
  });

  it('에너지: 날짜 두 개(시작·끝) 어디에 있든, kJ 바꿈', () => {
    const r = parseLines('energy', ['12.5 kcal, 2026-10-09T22:00:00+09:00 ~ 2026-10-09T22:10:00+09:00', '2026-10-09T22:10:00+09:00 | 41.84 kJ | 2026-10-09T22:20:00+09:00'].join('\n'), NOW);
    expect(r.samples).toEqual([
      { t: T('2026-10-09T22:00:00+09:00'), v: 12.5, end: T('2026-10-09T22:10:00+09:00') },
      { t: T('2026-10-09T22:10:00+09:00'), v: 10, end: T('2026-10-09T22:20:00+09:00') },
    ]);
  });

  it('수면: "단계, 시작, 끝" 순서도', () => {
    const r = parseLines('sleep', '깊은 수면, 2026-10-09T01:00:00+09:00, 2026-10-09T01:40:00+09:00\n코어 2026. 10. 9. 오전 1:40 ~ 2026. 10. 9. 오전 3:00', NOW);
    expect(r.samples.map((s) => s.stage)).toEqual([2, 1]);
    expect(r.samples[1]!.end).toBe(T('2026-10-09T03:00:00+09:00'));
  });

  it('값 모양: 글 목록, 사전 목록(date|startDate|start, value, endDate, unit), JSON 글, 숫자', () => {
    expect(valueText(['2026-10-09T22:53:05+09:00 | 128', '2026-10-09T22:54:05+09:00 | 129'])).toBe('2026-10-09T22:53:05+09:00 | 128\n2026-10-09T22:54:05+09:00 | 129');
    expect(valueText([{ startDate: '2026-10-09T22:00:00+09:00', value: 30, unit: 'kcal', endDate: '2026-10-09T22:10:00+09:00' }])).toBe('2026-10-09T22:00:00+09:00 | 30 kcal | 2026-10-09T22:10:00+09:00');
    expect(valueText('[{"date":"2026-10-09T22:53:05+09:00","value":"128 BPM"}]')).toBe('2026-10-09T22:53:05+09:00 | 128 BPM');
    expect(valueText({ samples: [{ Start: '2026-10-09T22:53:05+09:00', Value: 128 }] })).toBe('2026-10-09T22:53:05+09:00 | 128');
    expect(valueText(55)).toBe('55');
    const r = hr(valueText([{ date: '2026-10-09T22:53:05+09:00', value: 128 }, { start: '2026년 10월 9일 오후 10:54', value: '130 count/min' }]));
    expect(r.samples.map((s) => s.v)).toEqual([128, 130]);
  });

  it('칸 이름: 한국어·대문자·밑줄, samples/data 안, kind 별칭', () => {
    const n = normalizeHealthReq({ Kind: '하루', 심박: '2026-10-09T22:53:05+09:00 | 61', ActiveEnergy: ['2026-10-09T22:00:00+09:00 | 5 | 2026-10-09T22:10:00+09:00'], data: { 수면: 'x', Resting_Heart_Rate: '2026-10-09T07:00:00+09:00 | 55', HRV: '2026-10-09T07:00:00+09:00 | 48 ms' } });
    expect(n.kind).toBe('daily');
    expect(n.fields.hr).toContain('| 61');
    expect(n.fields.energy).toContain('| 5 |');
    expect(n.fields.sleep).toBe('x');
    expect(n.fields.rhr).toContain('55');
    expect(n.fields.hrv).toContain('48 ms');
    expect(normalizeHealthReq({ heartRate: 'a', kind: 'workout' }).fields.hr).toBe('a');
    expect(normalizeHealthReq({ 에너지: 'b' }).kind).toBe('workout');
  });

  it('맨 위 칸: Key·OP·키 → key·op, 키 앞뒤 빈칸, 원래 소문자 칸은 그대로(같은 객체)', () => {
    expect(normalizeTop({ OP: 'Health', Key: ' abc ', Kind: 'workout' })).toMatchObject({ op: 'health', key: 'abc', kind: 'workout' });
    expect(normalizeTop({ 키: 'abc', 종류: '운동' })).toMatchObject({ key: 'abc', kind: '운동' });
    const sync = { op: 'sync', key: 'k', muts: [] };
    expect(normalizeTop(sync)).toBe(sync);
  });

  it('건너뛴 이유 hint (한국어), 비었을 때 안내', () => {
    const s: HState = { rev: 1, recs: {} };
    const r = ingestHealth(s, { kind: 'workout', hr: '128\n2020-01-01T00:00:00+09:00 | 70\n2026-10-09T22:53:05+09:00 | 999\n2026-10-09T22:54:05+09:00 | 120' }, NOW);
    expect(r).toMatchObject({ ok: true, received: 1, skipped: 3 });
    const hint = (r as { hint: string }).hint;
    expect(hint).toContain('날짜를 못 읽음 1줄');
    expect(hint).toContain('값을 못 읽음 1줄');
    expect(hint).toContain('400일보다 오래됨 1줄');
    const tm = ingestHealth({ rev: 1, recs: {} }, { kind: 'workout', hr: '오후 10:20 | 72' }, NOW);
    expect((tm as { hint: string }).hint).toContain('날짜 없이 시각만 있어요 1줄 — 단축어에서 날짜 형식을 ISO 8601로');
    const e = ingestHealth({ rev: 1, recs: {} }, { kind: 'workout', hr: '' }, NOW);
    expect((e as { hint: string }).hint).toContain('보낸 값이 비어 있어요');
    expect(skipHint({ date: 0, time: 0, range: 0, value: 0 }, 3, 3)).toBeUndefined();
    // 모두 읽으면 hint 없음
    const ok = ingestHealth({ rev: 1, recs: {} }, { kind: 'workout', hr: '2026-10-09T22:54:05+09:00 | 120' }, NOW);
    expect('hint' in ok).toBe(false);
  });

  it('AI 모양 그대로 받아 저장 (사전 목록 + 한국어 칸 이름), 시각만 줄은 빼고 hint', () => {
    const s: HState = { rev: 1, recs: {} };
    const r = ingestHealth(s, { 종류: '운동', 심박: [{ 시작: '2026년 10월 9일 금요일 오후 10:53:05', 값: '128 회/분' }, '오후 10:54 130 BPM'], 에너지: '[{"startDate":"2026-10-09T22:50:00+09:00","value":12,"endDate":"2026-10-09T22:55:00+09:00"}]' }, NOW);
    expect(r).toMatchObject({ ok: true, received: 2, skipped: 1, stored: ['en-2026-10-09', 'hr-2026-10-09'] });
    expect('approx' in r).toBe(false);
    expect((r as { hint: string }).hint).toContain('시각만');
  });
});
