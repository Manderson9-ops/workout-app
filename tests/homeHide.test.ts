/**
 * 홈 "최근 운동"에서만 빼기 (D-040): 뺀 ID는 설정(homeHidden)에. 운동 기록 자체는 바꾸지 않는다.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { emptyRoutine, startWorkout, withHidden, withoutHidden, homeRecent } from '../src/core/session';
import type { Workout } from '../src/core/session';
import { makeBackup, parseBackup } from '../src/core/backup';
import { DEFAULT_SETTINGS } from '../src/db/db';
import { setHomeHidden } from '../src/ui/actions';
import { db } from '../src/ui/store';

const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const mk = (i: number): Workout => ({
  ...startWorkout(`w${i}`, emptyRoutine('r1', `운동 ${i}`, new Date(T0 - i * 864e5).toISOString()), new Date(T0 - i * 864e5).toISOString(), []),
  endedAt: new Date(T0 - i * 864e5 + 3600e3).toISOString(),
});
const backup = (settings: unknown[]) => JSON.stringify(makeBackup({ routines: [], workouts: [mk(1)], meta: [], custom: [], settings: settings as never, bodyweight: [], diag: [], feedback: [] }, '0.8.3', '2026-10-01T12:00:00.000Z'));

describe('뺀 목록 (순수)', () => {
  it('더하기는 중복 없이, 빼기는 그 ID만', () => {
    expect(withHidden(undefined, 'a')).toEqual(['a']);
    expect(withHidden(['a'], 'a')).toEqual(['a']);
    expect(withHidden(['a'], 'b')).toEqual(['a', 'b']);
    expect(withoutHidden(['a', 'b'], 'a')).toEqual(['b']);
    expect(withoutHidden(undefined, 'a')).toEqual([]);
  });
  it('홈 목록은 뺀 것을 건너뛰고 그만큼 다음 기록이 채움 (최신순 n개), 기록 배열은 그대로', () => {
    const h = [0, 1, 2, 3, 4, 5, 6].map(mk);
    const before = JSON.stringify(h);
    expect(homeRecent(h, ['w1', 'w3'], 5).map((w) => w.id)).toEqual(['w0', 'w2', 'w4', 'w5', 'w6']);
    expect(homeRecent(h, undefined, 5).map((w) => w.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
    expect(JSON.stringify(h)).toBe(before);
  });
  it('백업: 뺀 목록이 왕복되고, 글자 배열이 아니면 거절', () => {
    const r = parseBackup(backup([{ ...DEFAULT_SETTINGS, homeHidden: ['w1'] }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.data.settings[0]!.homeHidden).toEqual(['w1']);
    expect(parseBackup(backup([{ ...DEFAULT_SETTINGS, homeHidden: 'w1' }])).ok).toBe(false);
    expect(parseBackup(backup([{ ...DEFAULT_SETTINGS, homeHidden: [1] }])).ok).toBe(false);
  });
});

describe('setHomeHidden (저장)', () => {
  it('저장소의 지금 설정에 이 ID만 더하고 빼며, 다른 설정·운동 기록은 그대로', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, level: '상급', defaultMinutes: 45, homeHidden: ['old'] });
    await db.workouts.put(mk(1));
    const wBefore = JSON.stringify((await db.workouts.get('w1'))!);
    await setHomeHidden('w1', true);
    expect((await db.settings.get('main'))!).toMatchObject({ level: '상급', defaultMinutes: 45, homeHidden: ['old', 'w1'] });
    expect(JSON.stringify((await db.workouts.get('w1'))!)).toBe(wBefore); // 기록은 안 바뀜 (다른 기기 수정과 부딪히지 않음)
    await setHomeHidden('w1', false);
    expect((await db.settings.get('main'))!.homeHidden).toEqual(['old']);
  });
});
