/**
 * D-071 (P7) 애플워치 값 확인: 그럴듯하지 않은 운동 요약은 숫자 대신 "확인 중".
 * 요약 모양은 사용 분석(docs/사용분석_개선제안_20261019.md F8)의 실제 값: 최고 심박 240·225·223, 93분 3,320kcal, 운동 중 심박 4~11개
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { WorkoutDB } from '../src/db/db';
import { Clock, memoryClockStore } from '../src/core/hlc';
import { syncOnce, setHealthBatchHook } from '../src/db/sync';
import { watchPlausible, watchView, watchFor, healthBatchStats, healthStatText, lastRxOf, WATCH_GATE, workoutHeart } from '../src/core/health';
import type { HealthRow } from '../src/core/health';
import { HR_RANGE, parseLines } from '../src/core/healthIngest';

/** 서버가 저장한 운동 요약 ws-<운동ID> 모양 (D-059) */
const ws = (id: string, start: string, min: number, x: { hrAvg?: number; hrMax?: number; hrN: number; kcal?: number }): HealthRow => {
  const endedAt = new Date(Date.parse(start) + min * 60000).toISOString();
  return { id: `ws-${id}`, type: 'ws', workoutId: id, startedAt: start, endedAt, ...x, src: 'watch', computedAt: '2026-10-11T13:00:00.000Z' };
};
// 실제 4건 모양 (F8: 최고 240·225·223, 하체 93분 3,320kcal, 운동 중 심박 4~11개)
const REAL = [
  ws('w1', '2026-10-03T10:00:00.000Z', 70, { hrAvg: 131, hrMax: 240, hrN: 11, kcal: 1210 }),
  ws('w2', '2026-10-05T10:00:00.000Z', 62, { hrAvg: 124, hrMax: 225, hrN: 7, kcal: 980 }),
  ws('w3', '2026-10-07T10:00:00.000Z', 55, { hrAvg: 118, hrMax: 223, hrN: 4, kcal: 860 }),
  ws('w4', '2026-10-09T10:00:00.000Z', 93, { hrAvg: 112, hrMax: 171, hrN: 9, kcal: 3320 }),
];
const wOf = (r: HealthRow) => ({ id: String(r.workoutId), startedAt: String(r.startedAt), endedAt: String(r.endedAt) });

describe('D-071 표시 조건 (순수 함수)', () => {
  it('지금 받은 4건은 모두 "확인 중" (숨김)', () => {
    const got = REAL.map((r) => watchView(wOf(r), REAL));
    expect(got.every((x) => x && !x.ok)).toBe(true);
    expect(got.map((x) => (x && !x.ok ? x.why : []))).toEqual([
      ['hrMax', 'hrN'], // 240, 11개
      ['hrMax', 'hrN'], // 225, 7개
      ['hrMax', 'hrN'], // 223, 4개
      ['hrN', 'kcal'], // 9개, 93분 3,320kcal > 20×93 = 1,860
    ]);
  });
  it('조건마다 경계: 최고 220, 평균 40~200, 심박 20개, 분당 20kcal', () => {
    const ok = { n: 20, avg: 130, max: 220, kcal: 1200 };
    expect(watchPlausible(ok, 60).ok).toBe(true); // 1200 = 20×60
    expect(watchPlausible({ ...ok, max: 221 }, 60)).toEqual({ ok: false, why: ['hrMax'] });
    expect(watchPlausible({ ...ok, avg: 39 }, 60)).toEqual({ ok: false, why: ['hrAvg'] });
    expect(watchPlausible({ ...ok, avg: 40 }, 60).ok).toBe(true);
    expect(watchPlausible({ ...ok, avg: 200 }, 60).ok).toBe(true);
    expect(watchPlausible({ ...ok, avg: 201 }, 60)).toEqual({ ok: false, why: ['hrAvg'] });
    expect(watchPlausible({ ...ok, n: 19 }, 60)).toEqual({ ok: false, why: ['hrN'] });
    expect(watchPlausible({ ...ok, kcal: 1201 }, 60)).toEqual({ ok: false, why: ['kcal'] });
    expect(watchPlausible({ n: 25, avg: 120, max: 160 }, 30).ok).toBe(true); // kcal 없음 → kcal 조건은 따지지 않음
    expect(watchPlausible({ n: 0, kcal: 300 }, 60)).toEqual({ ok: false, why: ['hrN'] }); // 심박 없이 kcal만 → 확인 중
    expect(watchPlausible({ ...ok, kcal: 10 }, 0)).toEqual({ ok: false, why: ['kcal'] }); // 길이 0 운동에 kcal
    expect(WATCH_GATE).toEqual({ hrMax: 220, hrAvgMin: 40, hrAvgMax: 200, hrNMin: 20, kcalPerMin: 20 });
  });
  it('그럴듯한 요약(심박 400개·최고 170·60분 380kcal)은 그대로 보임', () => {
    const r = ws('w5', '2026-10-10T10:00:00.000Z', 60, { hrAvg: 133, hrMax: 170, hrN: 400, kcal: 380 });
    expect(watchView(wOf(r), [r])).toEqual({ ok: true, x: { n: 400, avg: 133, max: 170, kcal: 380 } });
  });
  it('원본에서 셀 때 30~220 밖 심박은 빼고 셈 (서버 범위가 25~250이던 때 받은 값)', () => {
    const t0 = Date.parse('2026-10-08T00:00:00+09:00');
    const rows: HealthRow[] = [{ id: 'hr-2026-10-08', type: 'hr', day: '2026-10-08', t0, p: [3600, 17, 3605, 120, 3610, 240, 3615, 140, 3620, 221, 3625, 30, 3630, 220] }];
    const w = { startedAt: new Date(t0 + 3500 * 1000).toISOString(), endedAt: new Date(t0 + 3700 * 1000).toISOString() };
    expect(workoutHeart(w, rows)).toEqual({ avg: 128, max: 220, n: 4 }); // 120·140·30·220 (17·240·221 뺌)
    expect(watchFor(w, rows)!.max).toBe(220);
  });
});

describe('D-071 범위 30~220 (healthIngest, 서버는 Apps Script를 다시 올린 뒤 적용)', () => {
  it('HR_RANGE = [30, 220], 받기에서 29·221은 건너뜀', () => {
    expect(HR_RANGE).toEqual([30, 220]);
    const NOW = Date.parse('2026-10-08T12:00:00+09:00');
    const r = parseLines('hr', ['2026-10-08T11:00:00+09:00 | 29', '2026-10-08T11:00:05+09:00 | 30', '2026-10-08T11:00:10+09:00 | 220', '2026-10-08T11:00:15+09:00 | 221'].join('\n'), NOW);
    expect(r.samples.map((s) => s.v)).toEqual([30, 220]);
    expect(r.why.value).toBe(2);
  });
});

describe('D-071 진단: 받은 묶음 요약 (개수·범위 밖·최소·최대만)', () => {
  it('종류별 요약, 원본 값·시각·ID는 글에 없음', () => {
    const list = [
      { id: 'hr-2026-10-11', data: { type: 'hr', day: '2026-10-11', t0: 1, p: [10, 17, 15, 120, 20, 240, 25, 130], rx: '2026-10-11T13:00:00.000Z' } },
      { id: 'en-2026-10-11', data: { type: 'energy', day: '2026-10-11', t0: 1, p: [0, 60, 300, 60, 60, 120, 120, 0, 50] } }, // 분당 30kcal(넘음)·12kcal·점 5kcal
      ...REAL.map((r) => ({ id: r.id, data: r as Record<string, unknown> })),
      { id: 'canary', data: { type: 'canary', at: 'x', received: 3, skipped: 2 } },
      { id: 'hr-2026-10-01', deleted: true },
    ];
    const s = healthBatchStats(list);
    expect(s).toEqual([
      { type: 'canary', rows: 1, n: 1, out: 0, skipped: 2 },
      { type: 'energy', rows: 1, n: 3, out: 1, min: 5, max: 30 },
      { type: 'hr', rows: 1, n: 4, out: 2, min: 17, max: 240 },
      { type: 'ws', rows: 4, n: 4, out: 4, min: 171, max: 240 },
    ]);
    const text = s.map(healthStatText);
    expect(text[2]).toBe('심박 기록 1개 · 점 4 · 30~220 밖 2 · 최소 17 · 최대 240');
    expect(text[3]).toBe('운동 요약 기록 4개 · 표시 조건 밖 4 · 최소 171 · 최대 240');
    expect(text[0]).toBe('연결 시험 기록 1개 · 서버가 건너뛴 줄 2');
    for (const x of text) { expect(x).not.toMatch(/2026|ws-|hr-|http/); expect(x.length).toBeLessThan(120); }
  });
  it('마지막 수신 시각: 원본·하루 요약의 rx 중 가장 늦은 것 (연결 시험·운동 요약은 뺌)', () => {
    const rows: HealthRow[] = [
      { id: 'hr-2026-10-10', type: 'hr', rx: '2026-10-10T13:00:00.000Z' },
      { id: 'dy-2026-10-11', type: 'daily', rx: '2026-10-11T13:31:00.000Z' },
      { id: 'canary', type: 'canary', rx: '2026-10-15T00:00:00.000Z' },
      { id: 'ws-a', type: 'ws', rx: '2026-10-16T00:00:00.000Z' },
    ];
    expect(lastRxOf(rows)).toBe('2026-10-11T13:31:00.000Z');
    expect(lastRxOf([])).toBeUndefined();
  });
});

describe('D-071 진단 고리: 동기화로 health 를 받으면 묶음을 넘김 (받은 게 없으면 안 부름)', () => {
  it('syncOnce → setHealthBatchHook 으로 받은 목록', async () => {
    const db = new WorkoutDB(`hook-${Math.random()}`, { clock: new Clock(memoryClockStore()), deviceId: () => 'A' });
    await db.open();
    await db.kv.put({ k: 'sync', v: { since: 1, epoch: 7, healthSince: 0 } });
    const got: number[] = [];
    setHealthBatchHook((list) => { got.push(list.length); });
    const rec = { table: 'health', id: 'hr-2026-10-11', hlc: '1', dev: 'srv', rev: 2, data: { type: 'hr', day: '2026-10-11', t0: 0, p: [0, 240, 5, 120] } };
    let health: unknown[] = [rec];
    const transport = async () => ({ ok: true as const, epoch: 7, rev: 2, results: [], changes: [], health: health as never });
    await syncOnce(db, transport);
    health = [];
    await syncOnce(db, transport);
    setHealthBatchHook(undefined);
    expect(got).toEqual([1]);
    expect(healthBatchStats([rec])[0]).toMatchObject({ type: 'hr', n: 2, out: 1, max: 240 });
    db.close();
  });
});
