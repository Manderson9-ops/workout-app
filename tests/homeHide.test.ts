/**
 * 홈 "최근 운동"에서만 빼기 (D-040): 홈 목록에서만 빠지고 기록·통계·백업·고치기에는 그대로.
 */
import { describe, expect, it } from 'vitest';
import { emptyRoutine, startWorkout, hideFromHome, showOnHome, homeRecent } from '../src/core/session';
import type { Workout } from '../src/core/session';
import { summarize } from '../src/core/stats';
import { makeBackup, parseBackup } from '../src/core/backup';
import { withKeys, finalizeEdit } from '../src/core/workoutEdit';

const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const mk = (i: number): Workout => ({
  ...startWorkout(`w${i}`, emptyRoutine('r1', `운동 ${i}`, new Date(T0 - i * 864e5).toISOString()), new Date(T0 - i * 864e5).toISOString(), []),
  endedAt: new Date(T0 - i * 864e5 + 3600e3).toISOString(),
});
const backup = (workouts: unknown[]) => JSON.stringify(makeBackup({ routines: [], workouts: workouts as Workout[], meta: [], custom: [], settings: [], bodyweight: [], diag: [], feedback: [] }, '0.8.3', '2026-10-01T12:00:00.000Z'));

describe('hideFromHome / showOnHome / homeRecent', () => {
  it('뺀 것은 홈 목록에서 건너뛰고, 그만큼 다음 기록이 채움 (최신순 n개)', () => {
    const h = [0, 1, 2, 3, 4, 5, 6].map(mk);
    h[1] = hideFromHome(h[1]!); h[3] = hideFromHome(h[3]!);
    expect(homeRecent(h, 5).map((w) => w.id)).toEqual(['w0', 'w2', 'w4', 'w5', 'w6']);
    expect(homeRecent(h, 5).length).toBe(5);
  });
  it('다시 보이기는 표시를 지워 원래 기록과 같아짐 (다른 값은 그대로)', () => {
    const w = { ...mk(1), memo: '메모', editedAt: '2026-10-01T11:00:00.000Z' };
    const hidden = hideFromHome(w);
    expect(hidden.hiddenFromHome).toBe(true);
    expect(showOnHome(hidden)).toEqual(w);
    expect('hiddenFromHome' in showOnHome(hidden)).toBe(false);
  });
  it('통계 요약에는 그대로 들어가고 "홈에서 뺌"만 표시 (안 뺀 기록 요약 모양은 예전과 같음)', () => {
    const w = mk(1);
    const a = summarize(w, new Map());
    const b = summarize(hideFromHome(w), new Map());
    expect('hiddenFromHome' in a).toBe(false);
    expect(b).toEqual({ ...a, hiddenFromHome: true });
  });
  it('기록을 고쳐 저장해도 "홈에서 뺌"은 유지', () => {
    const out = finalizeEdit(withKeys(hideFromHome(mk(1))), '2026-10-01T12:00:00.000Z');
    expect(out.hiddenFromHome).toBe(true);
  });
  it('백업: 뺀 표시가 왕복되고, 참·거짓이 아닌 값은 거절', () => {
    const r = parseBackup(backup([hideFromHome(mk(1)), mk(2)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.data.workouts.map((w) => w.hiddenFromHome)).toEqual([true, undefined]);
    expect(parseBackup(backup([{ ...mk(1), hiddenFromHome: 'yes' }])).ok).toBe(false);
  });
});
