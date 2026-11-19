import { describe, expect, it } from 'vitest';
import { parsePeriodPref, serializePeriodPref } from '../src/core/periodPref';
import type { PeriodPref } from '../src/core/periodPref';

const DEFAULT: PeriodPref = { kind: 'week', metric: 'sets', mode: 'both' };

describe('parsePeriodPref (stats.period.v1)', () => {
  it('없으면 처음 보기 = 주·작업 세트·막대+누적', () => {
    expect(parsePeriodPref(null)).toEqual(DEFAULT);
    expect(parsePeriodPref(undefined)).toEqual(DEFAULT);
    expect(parsePeriodPref('')).toEqual(DEFAULT);
  });
  it('옛 값(mode 없음)은 mode = both 로, 나머지는 그대로', () => {
    expect(parsePeriodPref('{"kind":"month","metric":"volume"}')).toEqual({ kind: 'month', metric: 'volume', mode: 'both' });
  });
  it('모르는 mode 는 both, 아는 mode 는 유지', () => {
    expect(parsePeriodPref('{"kind":"week","metric":"sets","mode":"x"}').mode).toBe('both');
    expect(parsePeriodPref('{"kind":"week","metric":"sets","mode":null}').mode).toBe('both');
    expect(parsePeriodPref('{"kind":"year","metric":"time","mode":"bar"}')).toEqual({ kind: 'year', metric: 'time', mode: 'bar' });
    expect(parsePeriodPref('{"mode":"cum"}')).toEqual({ ...DEFAULT, mode: 'cum' });
  });
  it("kind 'all' 허용, 모르는 kind·metric 은 기본값", () => {
    expect(parsePeriodPref('{"kind":"all","metric":"count","mode":"cum"}')).toEqual({ kind: 'all', metric: 'count', mode: 'cum' });
    expect(parsePeriodPref('{"kind":"decade","metric":"calories","mode":"bar"}')).toEqual({ kind: 'week', metric: 'sets', mode: 'bar' });
    expect(parsePeriodPref('{"kind":3,"metric":{},"mode":[]}')).toEqual(DEFAULT);
  });
  it('깨진 JSON·객체가 아닌 값은 기본값', () => {
    for (const raw of ['{', 'not json', '5', '"month"', '[]', 'true', 'null']) expect(parsePeriodPref(raw), raw).toEqual(DEFAULT);
  });
});

describe('serializePeriodPref', () => {
  it('쓰고 다시 읽으면 같은 값 (kind 4 × metric 4 × mode 3 전부)', () => {
    for (const kind of ['week', 'month', 'year', 'all'] as const) for (const metric of ['count', 'sets', 'volume', 'time'] as const) for (const mode of ['cum', 'bar', 'both'] as const) {
      const p: PeriodPref = { kind, metric, mode };
      expect(parsePeriodPref(serializePeriodPref(p)), `${kind}/${metric}/${mode}`).toEqual(p);
    }
  });
  it('저장 모양은 {kind, metric, mode}', () => {
    expect(JSON.parse(serializePeriodPref({ kind: 'month', metric: 'volume', mode: 'bar' }))).toEqual({ kind: 'month', metric: 'volume', mode: 'bar' });
  });
});
