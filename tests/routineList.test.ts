import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { emptyRoutine } from '../src/core/session';
import type { Routine, Workout } from '../src/core/session';
import { routineUse, routineParts, sortRoutines, filterRoutines, sinceText } from '../src/core/routineList';
import { makeBackup, parseBackup } from '../src/core/backup';
import { DEFAULT_SETTINGS } from '../src/db/db';
import { db } from '../src/ui/store';
import type { Part } from '../src/core/types';

const r = (id: string, name: string, ex: string[], updatedAt = '2026-10-01T00:00:00Z', estimatedSec?: number): Routine => ({
  ...emptyRoutine(id, name, updatedAt), updatedAt, ...(estimatedSec ? { estimatedSec } : {}),
  blocks: ex.map((e) => ({ kind: 'single', items: [{ exerciseId: e, sets: 3, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 })),
});
const w = (routineId: string | undefined, startedAt: string, ended = true) => ({ id: 'w' + startedAt, routineId, name: 'x', startedAt, ...(ended ? { endedAt: startedAt } : {}), blocks: [], timer: null }) as unknown as Workout;
const PART: Record<string, Part> = { bench: '가슴', row: '등', curl: '이두', squat: '하체' };

describe('내 루틴 목록 (D-048)', () => {
  it('사용 기록: 끝낸 운동만, 마지막 시각·횟수', () => {
    const u = routineUse([w('a', '2026-09-01T10:00:00Z'), w('a', '2026-09-20T10:00:00Z'), w('a', '2026-09-25T10:00:00Z', false), w('b', '2026-09-10T10:00:00Z'), w(undefined, '2026-09-30T10:00:00Z')]);
    expect(u.get('a')).toEqual({ count: 2, lastAt: '2026-09-20T10:00:00Z' });
    expect(u.get('b')).toEqual({ count: 1, lastAt: '2026-09-10T10:00:00Z' });
    expect(u.has('c')).toBe(false);
  });
  it('부위: 부위 목록 순서, 모르는 운동은 빼고', () => {
    expect(routineParts(r('a', 'A', ['squat', 'bench', 'ghost', 'row', 'bench']), (id) => PART[id])).toEqual(['가슴', '등', '하체']);
  });
  it('정렬: 최근 한 순(안 한 것은 최근 고친 순으로 뒤) / 이름(한국어) / 짧은 시간(시간 없는 것 뒤)', () => {
    const list = [r('1', '하체', [], '2026-09-01T00:00:00Z', 3600), r('2', '가슴', [], '2026-09-05T00:00:00Z', 1800), r('3', '등', [], '2026-09-03T00:00:00Z'), r('4', '이두', [], '2026-09-02T00:00:00Z', 1200)];
    const use = routineUse([w('1', '2026-09-28T00:00:00Z'), w('4', '2026-09-20T00:00:00Z')]);
    expect(sortRoutines(list, use, 'recent').map((x) => x.id)).toEqual(['1', '4', '2', '3']);
    expect(sortRoutines(list, use, 'name').map((x) => x.name)).toEqual(['가슴', '등', '이두', '하체']);
    expect(sortRoutines(list, use, 'short').map((x) => x.id)).toEqual(['4', '2', '1', '3']);
    expect(list.map((x) => x.id)).toEqual(['1', '2', '3', '4']); // 원본 그대로
  });
  it('검색: 루틴 이름·운동 이름(초성)·부위', () => {
    const list = [r('1', '월요일 루틴', ['bench']), r('2', '하체 데이', ['squat'])];
    const nameOf = (id: string) => ({ bench: '벤치프레스', squat: '스쿼트' })[id] ?? id;
    const partsOf = (x: Routine) => routineParts(x, (id) => PART[id]);
    expect(filterRoutines(list, '월요일', nameOf, partsOf).map((x) => x.id)).toEqual(['1']);
    expect(filterRoutines(list, 'ㅅㅋㅌ', nameOf, partsOf).map((x) => x.id)).toEqual(['2']);
    expect(filterRoutines(list, '가슴', nameOf, partsOf).map((x) => x.id)).toEqual(['1']);
    expect(filterRoutines(list, '  ', nameOf, partsOf)).toHaveLength(2);
  });
  it('마지막 날짜 글: 오늘·어제·N일 전·N주 전·날짜·아직 안 함 (지역 날짜 기준)', () => {
    const now = new Date(2026, 9, 3, 9, 0).getTime();
    const at = (d: number, h = 23) => new Date(2026, 9, d, h, 0).toISOString();
    expect(sinceText(undefined, now)).toBe('아직 안 함');
    expect(sinceText(at(3, 1), now)).toBe('오늘');
    expect(sinceText(at(2), now)).toBe('어제');
    expect(sinceText(at(1), now)).toBe('2일 전');
    expect(sinceText(new Date(2026, 8, 20).toISOString(), now)).toBe('13일 전');
    expect(sinceText(new Date(2026, 8, 19).toISOString(), now)).toBe('2주 전');
    expect(sinceText(new Date(2026, 6, 1).toISOString(), now)).toBe('3개월 전'); // D-060: 30일 넘으면 N개월 전
    expect(sinceText(new Date(2025, 11, 30).toISOString(), now)).toBe('9개월 전');
    expect(sinceText(new Date(2025, 8, 30).toISOString(), now)).toBe('2025년 9월 30일'); // 1년 넘으면 날짜
  });
  it('백업: routineHidden은 문자열 목록만', () => {
    const backup = (settings: unknown[]) => JSON.stringify(makeBackup({ routines: [], workouts: [], meta: [], custom: [], settings: settings as never, bodyweight: [], diag: [], feedback: [] }, '0.8.8', '2026-10-03T00:00:00.000Z'));
    const ok = parseBackup(backup([{ ...DEFAULT_SETTINGS, routineHidden: ['r1'] }]));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.file.data.settings[0]!.routineHidden).toEqual(['r1']);
    expect(parseBackup(backup([{ ...DEFAULT_SETTINGS, routineHidden: 'r1' }])).ok).toBe(false);
    expect(parseBackup(backup([{ ...DEFAULT_SETTINGS, routineHidden: [1] }])).ok).toBe(false);
  });
});

describe('숨기기·완전 삭제 저장 (D-048)', () => {
  it('숨기기는 다른 설정을 지키고 같은 값이면 저장 안 함, 완전 삭제는 루틴·숨긴 목록 모두 정리', async () => {
    const { setRoutineHidden, deleteRoutineForever } = await import('../src/ui/actions');
    const id = 'r-' + Math.random().toString(36).slice(2);
    await db.settings.put({ ...DEFAULT_SETTINGS, level: '상급', homeHidden: ['w1'], routineHidden: ['old'] });
    await db.routines.put(r(id, '지울 루틴', ['bench']));
    await setRoutineHidden(id, true);
    expect((await db.settings.get('main'))!).toMatchObject({ level: '상급', homeHidden: ['w1'], routineHidden: ['old', id] });
    const before = ((await db.settings.get('main')) as unknown as { _s?: { h?: string } })._s?.h;
    await setRoutineHidden(id, true);
    expect(((await db.settings.get('main')) as unknown as { _s?: { h?: string } })._s?.h).toBe(before);
    expect(await db.routines.get(id)).toBeDefined(); // 숨겨도 루틴은 그대로
    await deleteRoutineForever(id);
    expect(await db.routines.get(id)).toBeUndefined();
    expect(await db.tombs.get(`routines/${id}`)).toBeDefined();
    expect((await db.settings.get('main'))!.routineHidden).toEqual(['old']);
  });
});
