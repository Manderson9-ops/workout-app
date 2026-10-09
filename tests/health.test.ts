import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { parseDate, parseNumber, parseStage, parseLines, ingestHealth, readHealthBody, kstDay, kstDayStart, asleepMinutes, sleepDay, RAW_KEEP_DAYS, MAX_LINES } from '../src/core/healthIngest';
import type { HState } from '../src/core/healthIngest';
import { workoutHeart, activeKcal, watchFor, watchLine, lastNight, nightLine, watchStatus, hm } from '../src/core/health';
import type { HealthRow } from '../src/core/health';
import { emptyState, handleSync, replaceState } from '../src/core/syncMerge';
import { SYNC_TABLES } from '../src/core/syncStamp';
import { parseBackup as parseBackupV095 } from './fixtures/backup_v0_9_5';
import type { ServerState } from '../src/core/syncMerge';
import { WorkoutDB, exportAll, importAll } from '../src/db/db';
import { makeBackup, parseBackup } from '../src/core/backup';
import { Clock, memoryClockStore } from '../src/core/hlc';
import { planToRoutine } from '../src/core/session';

const NOW = Date.parse('2026-10-08T14:00:00+09:00');
const iso = (s: string) => Date.parse(s);

describe('D-058 단축어 글 읽기 (한국어 단축어 형식)', () => {
  it('날짜: ISO, 단축어 한국어 기본 형식, 년월일, 숫자 형식, 영어', () => {
    expect(parseDate('2026-10-08T11:24:05+09:00')).toBe(iso('2026-10-08T11:24:05+09:00'));
    expect(parseDate('2026-10-08T02:24:05Z')).toBe(iso('2026-10-08T11:24:05+09:00'));
    expect(parseDate('2026-10-08T11:24:05')).toBe(iso('2026-10-08T11:24:05+09:00')); // 시간대 없음 = 한국 시간
    expect(parseDate('2026. 10. 8. 오전 11:24')).toBe(iso('2026-10-08T11:24:00+09:00'));
    expect(parseDate('2026. 10. 8. 오후 11:24')).toBe(iso('2026-10-08T23:24:00+09:00'));
    expect(parseDate('2026. 10. 8. 오전 12:05')).toBe(iso('2026-10-08T00:05:00+09:00'));
    expect(parseDate('2026. 10. 8. 오후 12:05')).toBe(iso('2026-10-08T12:05:00+09:00'));
    expect(parseDate('2026년 10월 8일 오전 11:24:05')).toBe(iso('2026-10-08T11:24:05+09:00'));
    expect(parseDate('2026년 10월 8일 (목) 오후 3:07')).toBe(iso('2026-10-08T15:07:00+09:00'));
    expect(parseDate('2026-10-08 23:10:30')).toBe(iso('2026-10-08T23:10:30+09:00'));
    expect(parseDate('2026/10/08 07:01')).toBe(iso('2026-10-08T07:01:00+09:00'));
    expect(parseDate('Oct 8, 2026 at 11:24 AM')).toBe(iso('2026-10-08T11:24:00+09:00'));
    expect(parseDate('2026. 10. 8. 오전 11:24\u202f')).toBe(iso('2026-10-08T11:24:00+09:00'));
    for (const bad of ['', '어제', '2026. 13. 8. 오전 11:24', '2026-10-08T25:00:00', '11:24']) expect(parseDate(bad), bad).toBeUndefined();
  });
  it('값: 단위·쉼표', () => {
    expect(parseNumber('128 count/min')).toBe(128);
    expect(parseNumber('128회/분')).toBe(128);
    expect(parseNumber('45.2 ms')).toBe(45.2);
    expect(parseNumber('1,234.5 kcal')).toBe(1234.5);
    expect(parseNumber('kcal')).toBeUndefined();
    expect([parseStage('코어 수면'), parseStage('깊은 수면'), parseStage('REM 수면'), parseStage('깨어 있음'), parseStage('침대에 있음'), parseStage('수면 중'), parseStage('asleepCore'), parseStage('???')]).toEqual([1, 2, 3, 4, 5, 0, 1, undefined]);
  });
  it('여러 줄: 탭·| 구분, 못 읽은 줄·범위 밖·미래는 건너뜀(개수)', () => {
    const text = [
      '2026. 10. 8. 오전 11:24 | 128 count/min',
      '2026-10-08T11:24:05+09:00\t131 회/분',
      '2026년 10월 8일 오전 11:24:10 | 1,62 count/min', // "1,62" → 162
      '알 수 없는 줄',
      '2026. 10. 8. 오전 11:25 | 300 count/min', // 범위 밖
      '2026. 12. 8. 오전 11:25 | 100 count/min', // 미래
      '',
    ].join('\r\n');
    const r = parseLines('hr', text, NOW);
    expect(r.samples.map((s) => s.v)).toEqual([128, 131, 162]);
    expect(r.skipped).toBe(3);
    const sl = parseLines('sleep', ['2026. 10. 7. 오후 11:40 | 코어 수면 | 2026. 10. 8. 오전 1:10', '2026-10-08T01:10:00+09:00 | 2026-10-08T01:50:00+09:00 | 깊은 수면', '2026. 10. 8. 오전 1:50 | 수면 | 없음'].join('\n'), NOW);
    expect(sl.samples.map((s) => [s.stage, (s.end! - s.t) / 60000])).toEqual([[1, 90], [2, 40]]);
    expect(sl.skipped).toBe(1);
  });
  it('보낸 모양 읽기: JSON 글, 폼 글, Apps Script 폼 매개변수', () => {
    expect(readHealthBody('{"op":"health","key":"k","hr":"a"}')).toEqual({ op: 'health', key: 'k', hr: 'a' });
    expect(readHealthBody('key=k&kind=daily&hr=2026-10-08T11%3A24%3A05%20%7C%20128')).toEqual({ key: 'k', kind: 'daily', hr: '2026-10-08T11:24:05 | 128' });
    expect(readHealthBody('', { key: 'k', kind: 'workout' })).toEqual({ key: 'k', kind: 'workout' });
    expect(readHealthBody('not json')).toBeUndefined();
  });
});

const st = (): HState => ({ rev: 10, recs: {} });
const rec = (s: HState, id: string) => s.recs[`health/${id}`]!;
describe('D-058 서버 저장: 날짜 묶음·중복 없애기·정리', () => {
  it('심박은 날짜별 기록 하나, 5초 칸·같은 시작이면 하나, 정렬, 받은 개수·건너뛴 개수', () => {
    const s = st();
    const r1 = ingestHealth(s, { kind: 'workout', samples: { hr: ['2026-10-08T11:24:01+09:00 | 120', '2026-10-08T11:24:03+09:00 | 121', '2026-10-08T11:24:10+09:00 | 130', 'x'].join('\n') } }, NOW);
    expect(r1).toEqual({ ok: true, received: 3, skipped: 1, stored: ['hr-2026-10-08'] });
    const d = rec(s, 'hr-2026-10-08').data!;
    expect(d.t0).toBe(kstDayStart('2026-10-08'));
    expect(d.p).toEqual([41040, 121, 41050, 130]); // 11:24:00 칸(01·03 → 나중 값 121), 11:24:10
    // 다시 보냄(같은 샘플 + 새 샘플) → 늘어나지 않고 합쳐짐, rev 오름
    const rev0 = s.rev;
    ingestHealth(s, { kind: 'daily', hr: ['2026-10-08T11:24:10+09:00 | 131', '2026-10-08T09:00:00+09:00 | 60'].join('\n') }, NOW);
    expect(rec(s, 'hr-2026-10-08').data!.p).toEqual([32400, 60, 41040, 121, 41050, 131]);
    expect(s.rev).toBeGreaterThan(rev0);
    expect(rec(s, 'hr-2026-10-08').data!.rx).toBe(new Date(NOW).toISOString());
  });
  it('활동 에너지 [시작, 길이, kcal×10], 수면(겹침은 합쳐서 셈)·안정 심박(마지막)·HRV(평균) 요약', () => {
    const s = st();
    ingestHealth(s, { kind: 'daily', samples: {
      energy: '2026-10-08T11:00:00+09:00 | 12.5 kcal | 2026-10-08T11:10:00+09:00',
      sleep: ['2026-10-07T23:40:00+09:00 | 코어 수면 | 2026-10-08T03:00:00+09:00', '2026-10-08T02:30:00+09:00 | 깊은 수면 | 2026-10-08T04:00:00+09:00', '2026-10-08T04:00:00+09:00 | 깨어 있음 | 2026-10-08T04:10:00+09:00', '2026-10-08T04:10:00+09:00 | REM 수면 | 2026-10-08T06:00:00+09:00'].join('\n'),
      rhr: ['2026-10-08T07:00:00+09:00 | 58 count/min', '2026-10-08T12:00:00+09:00 | 56 count/min'].join('\n'),
      hrv: ['2026-10-08T03:00:00+09:00 | 40.0 ms', '2026-10-08T05:00:00+09:00 | 56.0 ms'].join('\n'),
    } }, NOW);
    expect(rec(s, 'en-2026-10-08').data!.p).toEqual([39600, 600, 125]);
    const dy = rec(s, 'dy-2026-10-08').data!;
    expect(dy.sleepMin).toBe(4 * 60 + 20 + 1 * 60 + 50); // 23:40~04:00 (겹친 30분 한 번) + 04:10~06:00
    expect(dy.rhr).toBe(56);
    expect(dy.hrv).toBe(48);
    expect(rec(s, 'sl-2026-10-08').data!.day).toBe('2026-10-08');
    expect(sleepDay(iso('2026-10-07T23:30:00+09:00'))).toBe('2026-10-08'); // 자정 전에 끝난 조각도 그 밤(다음 날)
  });
  it('원본은 120일만: 오래된 날 기록은 지움 표시, 요약은 남음 · 너무 많으면 거절 · 연결 시험은 canary 하나만', () => {
    const s = st();
    s.recs['health/hr-2026-05-01'] = { table: 'health', id: 'hr-2026-05-01', data: { id: 'hr-2026-05-01', type: 'hr', p: [] }, hlc: '0', dev: 'srv', rev: 1 };
    s.recs['health/dy-2026-05-01'] = { table: 'health', id: 'dy-2026-05-01', data: { id: 'dy-2026-05-01', type: 'daily', rhr: 50 }, hlc: '0', dev: 'srv', rev: 2 };
    ingestHealth(s, { kind: 'daily', hr: '2026-10-08T11:00:00+09:00 | 70' }, NOW);
    expect(rec(s, 'hr-2026-05-01').deleted).toBe(true);
    expect(rec(s, 'dy-2026-05-01').deleted).toBeUndefined();
    expect(RAW_KEEP_DAYS).toBe(120);
    expect(ingestHealth(s, { kind: 'daily', hr: Array.from({ length: MAX_LINES + 1 }, () => '2026-10-08T11:00:00+09:00 | 70').join('\n') }, NOW)).toEqual({ ok: false, error: 'too_many' });
    const before = Object.keys(s.recs).length;
    expect(ingestHealth(s, { kind: 'canary', hr: '2026-10-08T11:00:00+09:00 | 70\nbad' }, NOW)).toEqual({ ok: true, received: 1, skipped: 1, stored: ['canary'] });
    expect(Object.keys(s.recs).length).toBe(before + 1);
  });
  it('크기: 하루 내내 5초마다(17,280개) 넣어도 기록 하나 약 170KB 이하', () => {
    const s = st();
    const t0 = kstDayStart('2026-10-08');
    const lines = Array.from({ length: 17280 }, (_, i) => `${new Date(t0 + i * 5000).toISOString()} | ${60 + (i % 100)}`);
    const r = ingestHealth(s, { kind: 'daily', hr: lines.join('\n') }, t0 + 86400000);
    expect(r.ok && r.received).toBe(17280);
    expect(JSON.stringify(rec(s, 'hr-2026-10-08')).length).toBeLessThan(170000);
  });
});

describe('D-058 동기화: 옛 앱에는 health 를 보내지 않음 (호환)', () => {
  const withHealth = (): ServerState => {
    const s = emptyState();
    s.recs['routines/r1'] = { table: 'routines', id: 'r1', data: { id: 'r1', name: 'A' }, hlc: '1', dev: 'A', rev: 1 };
    s.rev = 1;
    ingestHealth(s as unknown as HState, { kind: 'daily', hr: '2026-10-08T11:00:00+09:00 | 70' }, NOW);
    return s;
  };
  it('healthSince 없는 요청(옛 앱): changes·full 어디에도 health 없음', () => {
    const s = withHealth();
    const full = handleSync(s, { op: 'sync', schema: 1, epoch: 0, since: 0, muts: [] }, NOW);
    expect(full.ok && full.changes.map((c) => c.table)).toEqual(['routines']);
    expect(full.ok && 'health' in full).toBe(false);
    const inc = handleSync(s, { op: 'sync', schema: 1, epoch: s.epoch, since: 0, muts: [] }, NOW);
    expect(inc.ok && inc.changes.some((c) => c.table === 'health')).toBe(false);
  });
  it('healthSince 있는 요청(새 앱): health 따로, since 보다 앞서 있어도 healthSince 기준으로', () => {
    const s = withHealth();
    const r = handleSync(s, { op: 'sync', schema: 1, epoch: s.epoch, since: s.rev, muts: [], healthSince: 0 }, NOW);
    expect(r.ok && r.changes).toEqual([]);
    expect(r.ok && r.health!.map((c) => c.id)).toEqual(['hr-2026-10-08']);
    const r2 = handleSync(s, { op: 'sync', schema: 1, epoch: s.epoch, since: s.rev, muts: [], healthSince: s.rev }, NOW);
    expect(r2.ok && r2.health).toEqual([]);
  });
  it('기기가 health 를 고쳐 보내도 받지 않음 (서버만 씀)', () => {
    const s = withHealth();
    const rev = s.rev;
    const r = handleSync(s, { op: 'sync', schema: 1, epoch: s.epoch, since: rev, muts: [{ mid: 'm1', table: 'health', id: 'hr-2026-10-08', hlc: '9', dev: 'X', data: { p: [] } }], healthSince: rev }, NOW);
    expect(r.ok && r.results).toEqual([]);
    expect(s.rev).toBe(rev);
  });
  it('근거: 옛 앱(health 표 없음)이 health 기록을 받으면 Dexie 가 오류를 냄 → 그래서 서버가 걸러야 함', async () => {
    const old = new Dexie(`oldapp-${Math.random()}`);
    old.version(5).stores({ routines: 'id', kv: 'k' });
    await old.open();
    expect(() => old.table('health')).toThrow();
    old.close();
  });
});

describe('D-058 기기: 저장소 v6 옮김·백업', () => {
  it('v5 → v6: 기존 기록 100% 그대로, health 표 비어 있음', async () => {
    const name = `mig6-${Math.random()}`;
    const old = new Dexie(name);
    old.version(5).stores({ routines: 'id, updatedAt', workouts: 'id, startedAt, endedAt', meta: 'exerciseId', custom: 'id', settings: 'key', bodyweight: 'date', diag: '++id, t', tombs: 'k, table', kv: 'k', feedback: 'id' });
    const rows = {
      routines: [{ id: 'r1', name: '등', updatedAt: 'x', blocks: [], _s: { h: '0', d: 'A', q: 1, y: 0, r: 3 } }],
      workouts: [{ id: 'w1', name: '등', startedAt: '2026-10-08T01:00:00.000Z', endedAt: '2026-10-08T02:00:00.000Z', blocks: [], timer: null, _s: { h: '0', d: 'A', q: 1, y: 0, r: 4 } }],
      bodyweight: [{ date: '2026-10-08', kg: 72.5, _s: { h: '0', d: 'A', q: 1, y: 0, r: 5 } }],
      feedback: [{ id: 'FB-1', text: '좋아요', _s: { h: '0', d: 'A', q: 1, y: 0, r: 6 } }],
      kv: [{ k: 'sync', v: { epoch: 3, since: 42 } }],
    } as Record<string, Record<string, unknown>[]>;
    for (const [t, xs] of Object.entries(rows)) await old.table(t).bulkPut(xs);
    old.close();
    const db = new WorkoutDB(name, { clock: new Clock(memoryClockStore()), deviceId: () => 'A' });
    expect(db.verno).toBe(6);
    for (const [t, xs] of Object.entries(rows)) expect(await db.table(t).toArray(), t).toEqual(xs);
    expect(await db.health.count()).toBe(0);
    db.close();
  });
  it('백업: health 가 들어가고 다시 불러옴, 옛 백업(health 없음)은 그대로 불러오고 기존 health 는 남김, 형식 번호는 3 그대로', async () => {
    const db = new WorkoutDB(`bk6-${Math.random()}`, { clock: new Clock(memoryClockStore()), deviceId: () => 'A' });
    const hr: HealthRow = { id: 'hr-2026-10-08', type: 'hr', day: '2026-10-08', t0: kstDayStart('2026-10-08'), p: [41040, 121] };
    await db.health.put(hr);
    const f = makeBackup(await exportAll(db), '0.9.6-preview', new Date(NOW).toISOString());
    expect(f.schema).toBe(3);
    expect(f.counts.health).toBe(1);
    const parsed = parseBackup(JSON.stringify(f));
    expect(parsed.ok).toBe(true);
    await db.health.clear();
    await importAll(db, parsed.ok ? parsed.file.data : (null as never));
    expect(await db.health.toArray()).toEqual([hr]);
    // 옛 백업: health 칸 없음
    const { health: _h, ...oldData } = f.data;
    const p2 = parseBackup(JSON.stringify({ ...f, appVersion: '0.9.5-preview', counts: { ...f.counts, health: undefined }, data: oldData }));
    expect(p2.ok).toBe(true);
    await importAll(db, p2.ok ? p2.file.data : (null as never));
    expect(await db.health.count()).toBe(1);
    expect(parseBackup(JSON.stringify({ ...f, data: { ...f.data, health: [{ nope: 1 }] } })).ok).toBe(false);
    db.close();
  });
});

describe('D-058 앱 계산: 운동 심박·칼로리, 어젯밤', () => {
  const t0 = kstDayStart('2026-10-08');
  const rows: HealthRow[] = [
    { id: 'hr-2026-10-08', type: 'hr', day: '2026-10-08', t0, p: [36000 - 60, 200, 36000, 120, 36300, 140, 37800, 160, 39600 + 60, 210], rx: '2026-10-08T05:00:00.000Z' },
    { id: 'en-2026-10-08', type: 'energy', day: '2026-10-08', t0, p: [35400, 1200, 100, 39000, 0, 25] , rx: '2026-10-08T05:00:01.000Z' }, // 9:50~10:10 10kcal(절반 겹침) + 10:50 점 2.5kcal
    { id: 'dy-2026-10-08', type: 'daily', day: '2026-10-08', sleepMin: 350, rhr: 56, hrv: 48.4 },
  ];
  const w = { startedAt: new Date(t0 + 36000 * 1000).toISOString(), endedAt: new Date(t0 + 39600 * 1000).toISOString() }; // 10:00~11:00
  it('운동 시간 안 심박만 (경계 포함), 겹친 만큼 칼로리', () => {
    expect(workoutHeart(w, rows)).toEqual({ avg: 140, max: 160, n: 3 });
    expect(activeKcal(w, rows)).toBe(8); // 5 + 2.5 → 7.5 → 8
    expect(watchLine(watchFor(w, rows)!)).toBe('평균 심박 140 · 최고 160 · 8kcal (애플워치)');
    expect(watchFor(w, [])).toBeUndefined();
    expect(watchFor({ startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z' }, rows)).toBeUndefined();
  });
  it('어젯밤: 수면·안정 심박·HRV (참고), 없으면 없음', () => {
    const n = lastNight(rows, t0 + 15 * 3600000)!;
    expect(nightLine(n)).toBe('어젯밤 수면 5시간 50분 · 안정 심박 56 · HRV 48ms (애플워치, 참고)');
    expect(lastNight(rows, t0 + 2 * 86400000)).toBeUndefined();
    expect([hm(370), hm(360), hm(45)]).toEqual(['6시간 10분', '6시간', '45분']);
    expect(asleepMinutes([0, 3600, 1, 1800, 5400, 2])).toBe(90);
    expect(kstDay(t0)).toBe('2026-10-08');
  });
  it('연동 상태: 종류별 마지막으로 받은 시각, 최근 7일 개수', () => {
    const s = watchStatus(rows, t0 + 15 * 3600000);
    expect(s.find((x) => x.kind === 'hr')).toEqual({ kind: 'hr', label: '심박', lastRx: '2026-10-08T05:00:00.000Z', recent: 5 });
    expect(s.find((x) => x.kind === 'sleep')!.recent).toBe(0);
  });
});

describe('D-058 검토 G3: 킬로줄·숫자 수면 값', () => {
  it('활동 에너지 kJ·킬로줄 → kcal (÷4.184), kcal 는 그대로', () => {
    const r = parseLines('energy', ['2026-10-08T11:00:00+09:00 | 418.4 kJ', '2026-10-08T11:01:00+09:00 | 41.84 킬로줄', '2026-10-08T11:02:00+09:00 | 10 kcal', '2026-10-08T11:03:00+09:00 | 1,046 kJ'].join('\n'), NOW);
    expect(r.samples.map((s) => s.v)).toEqual([100, 10, 10, 250]);
  });
  it('수면 값이 숫자(0~5, HealthKit 수면 분석)면 단계로: 0 침대 1 잠 2 깨어 3 코어 4 깊은 5 렘, 그 밖 숫자는 건너뜀', () => {
    const line = (v: string) => `2026-10-08T01:00:00+09:00 | ${v} | 2026-10-08T02:00:00+09:00`;
    const r = parseLines('sleep', ['0', '1', '2', '3', '4', '5', '7'].map(line).join('\n'), NOW);
    expect(r.samples.map((s) => s.stage)).toEqual([5, 0, 4, 1, 2, 3]);
    expect(r.skipped).toBe(1);
    // 글 단계가 있으면 글이 먼저
    expect(parseLines('sleep', '2026-10-08T01:00:00+09:00 | 3 | 2026-10-08T02:00:00+09:00 | 깊은 수면', NOW).samples[0]!.stage).toBe(2);
  });
});

describe('D-058 검토 T2: 바꾸기 뒤 health 유지 · 옛 앱이 새 백업 읽기', () => {
  it('앱의 "서버까지 이 백업으로 바꾸기"(앱이 아는 표만) 뒤에도 health 는 남고, 새 앱은 epoch 가 바뀌어 전체(health 포함)를 다시 받음', () => {
    const s0 = emptyState();
    ingestHealth(s0 as unknown as HState, { kind: 'daily', hr: '2026-10-08T11:00:00+09:00 | 70' }, NOW);
    s0.recs['routines/r1'] = { table: 'routines', id: 'r1', data: { id: 'r1', name: '옛' }, hlc: '1', dev: 'A', rev: ++s0.rev };
    const s1 = replaceState(s0, [{ table: 'routines', id: 'r2', data: { id: 'r2', name: '백업' }, hlc: '2', dev: 'A', rev: 1 }], [...SYNC_TABLES]);
    expect(Object.keys(s1.recs).sort()).toEqual(['health/hr-2026-10-08', 'routines/r2']);
    expect(s1.epoch).toBe(s0.epoch + 1);
    const r = handleSync(s1, { op: 'sync', schema: 1, epoch: s0.epoch, since: s0.rev, muts: [], healthSince: s0.rev }, NOW);
    expect(r.ok && r.full).toBe(true);
    expect(r.ok && r.health!.map((x) => x.id)).toEqual(['hr-2026-10-08']);
    expect(r.ok && r.changes.map((x) => x.id)).toEqual(['r2']);
  });
  it('0.9.5 앱의 parseBackup(5d1f175 그대로) 이 health 칸이 든 새 백업을 읽음 (health 는 무시)', async () => {
    const db = new WorkoutDB(`bkold-${Math.random()}`, { clock: new Clock(memoryClockStore()), deviceId: () => 'A' });
    await db.health.put({ id: 'hr-2026-10-08', type: 'hr', day: '2026-10-08', t0: kstDayStart('2026-10-08'), p: [41040, 121] });
    await db.routines.put(planToRoutine('r1', '등', '2026-10-08T01:00:00.000Z', [{ kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 3, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 90, timeSec: 0 }], 900));
    const text = JSON.stringify(makeBackup(await exportAll(db), '0.9.6-preview', new Date(NOW).toISOString()));
    expect(JSON.parse(text).data.health).toHaveLength(1);
    const old = parseBackupV095(text);
    expect(old.ok ? 'ok' : old.error).toBe('ok');
    expect(parseBackup(text).ok).toBe(true);
    expect(old.ok && old.file.data.routines.map((r) => r.id)).toEqual(['r1']);
    db.close();
  });
});

