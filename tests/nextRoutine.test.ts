import { describe, it, expect } from 'vitest';
import { pickNextRoutine } from '../src/core/routineList';
import type { RoutineUse } from '../src/core/routineList';
import type { Routine } from '../src/core/session';
import { changeHeadline } from '../src/core/changelog';
import { localDate, durParts, durText } from '../src/core/stats';

const R = (id: string, updatedAt = '2026-10-01T00:00:00.000Z', items = 1): Routine => ({
  id, name: id, createdAt: updatedAt, updatedAt,
  blocks: items ? [{ kind: 'single', restSec: 60, roundRestSec: 0, transitionSec: 0, items: Array.from({ length: items }, () => ({ exerciseId: 'x', sets: 3, reps: 10 })) }] as unknown as Routine['blocks'] : [],
});
// 지역 시각으로 날짜를 만들어 시간대와 상관없이 같은 결과
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const today = localDate(at(2026, 10, 6));
const use = (o: Record<string, string | undefined>) => new Map<string, RoutineUse>(Object.entries(o).filter(([, v]) => v).map(([k, v]) => [k, { lastAt: v, count: 1 }]));

describe('D-055 다음 운동 고르기 (앱 판단: 돌아가며 하기)', () => {
  it('오늘 한 루틴은 빼고, 한 적 있는 것 중 가장 오래전에 한 루틴', () => {
    const p = pickNextRoutine([R('A'), R('B'), R('C')], use({ A: at(2026, 10, 6, 9), B: at(2026, 10, 3), C: at(2026, 10, 5) }), today);
    expect(p).toEqual({ routine: expect.objectContaining({ id: 'B' }), reason: 'oldest', lastAt: at(2026, 10, 3) });
  });
  it('한 적 있는 루틴이 있으면 안 한 루틴보다 먼저 (안 한 것은 초안일 수 있음)', () => {
    expect(pickNextRoutine([R('N', '2026-10-05T00:00:00.000Z'), R('B')], use({ B: at(2026, 9, 1) }), today)?.routine.id).toBe('B');
  });
  it('남은 것이 안 한 루틴뿐이면 가장 최근에 만들거나 고친 것', () => {
    const p = pickNextRoutine([R('old', '2026-09-01T00:00:00.000Z'), R('new', '2026-10-05T00:00:00.000Z'), R('A')], use({ A: at(2026, 10, 6, 8) }), today);
    expect(p?.routine.id).toBe('new');
    expect(p?.reason).toBe('never');
  });
  it('모두 오늘 했으면 가장 최근에 한 루틴 + doneToday', () => {
    const p = pickNextRoutine([R('A'), R('B')], use({ A: at(2026, 10, 6, 8), B: at(2026, 10, 6, 10) }), today);
    expect(p?.routine.id).toBe('B');
    expect(p?.reason).toBe('doneToday');
  });
  it('운동이 없는 루틴은 고르지 않음, 고를 게 없으면 undefined', () => {
    expect(pickNextRoutine([R('E', undefined, 0)], use({}), today)).toBeUndefined();
    expect(pickNextRoutine([R('E', undefined, 0), R('A')], use({}), today)?.routine.id).toBe('A');
  });
});

describe('D-055 새로 바뀐 점 짧은 제목', () => {
  it('첫 ":" 앞이 제목, 뒤가 설명', () => {
    expect(changeHeadline('새 버전 안내: 버전 번호가 보여요')).toEqual({ head: '새 버전 안내', rest: '버전 번호가 보여요' });
  });
  it('":" 가 없고 짧으면 제목만, 길면 28자 안 띄어쓰기에서 자르고 …', () => {
    expect(changeHeadline('P0 프로젝트 뼈대')).toEqual({ head: 'P0 프로젝트 뼈대' });
    const long = '운동 끝내기를 앱 안 확인 창으로 물음 (확인 창이 안 보이고 조용히 취소되던 문제)';
    const h = changeHeadline(long);
    expect(h.head.endsWith('…')).toBe(true);
    expect(h.head.length).toBeLessThanOrEqual(29);
    expect(`${h.head.slice(0, -1)} ${h.rest}`.replace(/\s+/g, ' ')).toBe(long);
  });
  it('":" 가 너무 뒤에 있으면 쓰지 않음', () => {
    const t = '아주 긴 문장이 이어지고 또 이어지고 또 이어지다가 한참 뒤에야: 나옴';
    expect(changeHeadline(t).head.endsWith('…')).toBe(true);
  });
});

describe('D-055 기록 탭 숫자: durParts 는 durText 와 같은 값', () => {
  it('초·분·시간 경계', () => {
    for (const sec of [0, 1, 59, 60, 89, 90, 3599, 3600, 3629, 3631, 7200, 7260, 36000]) {
      expect(durParts(sec).map(([n, u]) => `${n}${u}`).join(' ')).toBe(durText(sec));
    }
  });
});
