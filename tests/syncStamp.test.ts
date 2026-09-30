import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, memoryClockStore, fmtHlc, cmpHlc, hlcZero } from '../src/core/hlc';
import { stampValue, syncedFields, tombKey } from '../src/core/syncStamp';
import { WorkoutDB, softDelete, exportAll, importAll, DEFAULT_SETTINGS, clearAllLocal } from '../src/db/db';
import { planToRoutine, startWorkout } from '../src/core/session';

const mkDb = (dev = 'devA', now = () => 1_000_000) => new WorkoutDB(`s2a-${Math.random()}`, { clock: new Clock(memoryClockStore(), now), deviceId: () => dev });
const routine = planToRoutine('r1', '등', '2026-09-30T10:00:00.000Z', [{ kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 2, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 150, timeSec: 0 }], 1200);

describe('HLC (D-029)', () => {
  it('시계가 멈추거나 뒤로 가도 계속 커짐, 문자열 비교 = 시간 순서, 같으면 기기ID', () => {
    let t = 1000;
    const c = new Clock(memoryClockStore(), () => t);
    const a = c.tick('x'); const b = c.tick('x');
    t = 500; const d = c.tick('x');
    expect(cmpHlc(a, b)).toBeLessThan(0);
    expect(cmpHlc(b, d)).toBeLessThan(0);
    expect(d).toBe(fmtHlc(1000, 2, 'x'));
    expect(cmpHlc(fmtHlc(5, 0, 'a'), fmtHlc(5, 0, 'b'))).toBeLessThan(0);
    expect(cmpHlc(hlcZero('z'), fmtHlc(1, 0, 'a'))).toBeLessThan(0);
  });
  it('다른 기기 값을 보면 따라 올라가고(observe), 서버가 다시 찍은 값으로 낮출 수 있음(lower)', () => {
    const c = new Clock(memoryClockStore(), () => 100);
    c.observe(fmtHlc(9000, 3, 'o'));
    expect(c.tick('x')).toBe(fmtHlc(9000, 4, 'x'));
    c.lower(fmtHlc(200, 0, 'srv'));
    expect(c.tick('x')).toBe(fmtHlc(200, 1, 'x'));
  });
});

describe('동기화 표시 붙이기 (stampValue)', () => {
  let n = 0; const tick = () => fmtHlc(1000 + ++n, 0, 'd');
  it('처음 저장: 새 HLC, localSeq 1, dirty', () => {
    const v = stampValue('routines', undefined, { id: 'r', name: 'A' }, tick, 'd');
    expect(v._s).toMatchObject({ d: 'd', q: 1, y: 1 });
  });
  it('내용이 같으면 표시 그대로 (보낼 것 없음)', () => {
    const a = stampValue('routines', undefined, { id: 'r', name: 'A' }, tick, 'd');
    const b = stampValue('routines', a, { ...a, name: 'A' }, tick, 'd');
    expect(b._s).toEqual(a._s);
  });
  it('서버가 확정한 건을 고치면 baseRev = 그 serverRev, 확정 전 또 고치면 처음 base 유지', () => {
    const synced = { id: 'r', name: 'A', _s: { h: fmtHlc(1, 0, 'd'), d: 'd', q: 3, y: 0 as const, r: 7 } };
    const e1 = stampValue('routines', synced, { ...synced, name: 'B' }, tick, 'd');
    expect(e1._s).toMatchObject({ q: 4, y: 1, b: 7, r: 7 });
    const e2 = stampValue('routines', e1, { ...e1, name: 'C' }, tick, 'd');
    expect(e2._s).toMatchObject({ q: 5, y: 1, b: 7 });
  });
  it('설정: 바뀐 항목만 새 HLC, 기기별 항목(마지막 백업 등)만 바뀌면 보낼 것 없음', () => {
    const s0 = stampValue('settings', undefined, { ...DEFAULT_SETTINGS } as never, tick, 'd');
    const f0 = s0._s!.f!;
    expect(Object.keys(f0)).not.toContain('soundOn');
    expect(Object.keys(f0)).not.toContain('key');
    const s1 = stampValue('settings', s0, { ...s0, level: '상급' }, tick, 'd');
    expect(s1._s!.f!.level).not.toBe(f0.level);
    expect(s1._s!.f!.rest).toBe(f0.rest);
    const s2 = stampValue('settings', s1, { ...s1, lastBackupAt: '2026-09-30T10:00:00.000Z', soundOn: false }, tick, 'd');
    expect(s2._s).toEqual(s1._s);
    expect(syncedFields('settings', s2)).not.toHaveProperty('lastBackupAt');
  });
  it('서버에서 온 값(remote)은 표시를 그대로 둠', () => {
    const v = stampValue('routines', undefined, { id: 'r', _s: { h: 'x', d: 'o', q: 9, y: 0, r: 3, remote: true } } as never, tick, 'd');
    expect(v._s).toEqual({ h: 'x', d: 'o', q: 9, y: 0, r: 3 });
  });
});

describe('DB 층: 모든 저장에 자동 표시, 지우기는 지움 표시 (S2a)', () => {
  it('put마다 표시, 같은 내용 다시 저장은 그대로, 운동 세트 변경은 localSeq 증가', async () => {
    const db = mkDb();
    await db.routines.put(routine);
    const a = (await db.routines.get('r1')) as unknown as { _s: { q: number; y: number; d: string } };
    expect(a._s).toMatchObject({ q: 1, y: 1, d: 'devA' });
    await db.routines.put({ ...(await db.routines.get('r1'))! });
    expect(((await db.routines.get('r1')) as unknown as { _s: { q: number } })._s.q).toBe(1);
    const w = startWorkout('w1', routine, '2026-09-30T10:00:00.000Z', []);
    await db.workouts.put(w);
    const cur = (await db.workouts.get('w1'))!;
    cur.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true };
    await db.workouts.put(cur);
    expect(((await db.workouts.get('w1')) as unknown as { _s: { q: number } })._s.q).toBe(2);
    db.close();
  });
  it('트랜잭션 안의 저장도 표시 (updateWorkout처럼 workouts만 연 트랜잭션)', async () => {
    const db = mkDb();
    await db.transaction('rw', db.workouts, async () => { await db.workouts.put(startWorkout('w2', routine, '2026-09-30T10:00:00.000Z', [])); });
    expect(((await db.workouts.get('w2')) as unknown as { _s?: unknown })._s).toBeDefined();
    db.close();
  });
  it('softDelete: 기록은 없어지고 지움 표시가 남음 (baseRev 유지)', async () => {
    const db = mkDb();
    await db.routines.put(routine);
    await softDelete(db, 'routines', 'r1');
    expect(await db.routines.get('r1')).toBeUndefined();
    const t = await db.tombs.get(tombKey('routines', 'r1'));
    expect(t).toMatchObject({ table: 'routines', id: 'r1', _s: { q: 2, y: 1, d: 'devA' } });
    db.close();
  });
  it('백업 파일엔 표시(_s)가 없고, 불러오기는 지움 표시도 비움', async () => {
    const db = mkDb();
    await db.routines.put(routine);
    await db.settings.put({ ...DEFAULT_SETTINGS });
    await softDelete(db, 'routines', 'r1');
    await db.routines.put({ ...routine, id: 'r2' });
    const d = await exportAll(db);
    expect(JSON.stringify(d)).not.toContain('"_s"');
    await importAll(db, d);
    expect(await db.tombs.count()).toBe(0);
    expect(((await db.routines.get('r2')) as unknown as { _s: { y: number } })._s.y).toBe(1);
    await clearAllLocal(db);
    expect(await db.routines.count()).toBe(0);
    db.close();
  });
  it('v3 → v4 옮김: 기록 내용 그대로, HLC 0·아직 안 보냄 표시가 붙음', async () => {
    const name = `mig4-${Math.random()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({ routines: 'id, updatedAt', workouts: 'id, startedAt, endedAt', meta: 'exerciseId', custom: 'id', settings: 'key', bodyweight: 'date', diag: '++id, t' });
    await v3.table('routines').put(routine);
    await v3.table('settings').put({ ...DEFAULT_SETTINGS, level: '상급' });
    await v3.table('bodyweight').put({ date: '2026-09-30', kg: 70 });
    await v3.table('workouts').put({ ...startWorkout('w-open', routine, '2026-09-30T09:00:00.000Z', []) });
    v3.close();
    const db = new WorkoutDB(name, { clock: new Clock(memoryClockStore(), () => 5_000), deviceId: () => 'devM' });
    const r = (await db.routines.get('r1')) as unknown as { _s: { h: string; y: number; q: number }; name: string };
    expect(r.name).toBe('등');
    expect(r._s).toEqual({ h: hlcZero('devM'), d: 'devM', y: 1, q: 1 });
    const s = (await db.settings.get('main')) as unknown as { level: string; _s: { f: Record<string, string> } };
    expect(s.level).toBe('상급');
    expect(s._s.f.level).toBe(hlcZero('devM'));
    expect(s._s.f).not.toHaveProperty('soundOn');
    expect(((await db.bodyweight.get('2026-09-30')) as unknown as { _s?: unknown })._s).toBeDefined();
    expect(db.verno).toBe(5);
    // 옛 진행 중 운동은 이 기기가 주인
    expect(await db.workouts.get('w-open')).toMatchObject({ ownerDeviceId: 'devM', ownerAt: '2026-09-30T09:00:00.000Z' });
    db.close();
  });
  it('v4 → v5 옮김 (S3): 개선 메모 표 추가, 기록은 그대로, 받은 위치(since)만 0으로 (연결·보관본 유지)', async () => {
    const name2 = `mig5b-${Math.random()}`;
    const old = new Dexie(name2);
    old.version(4).stores({ routines: 'id, updatedAt', workouts: 'id, startedAt, endedAt', meta: 'exerciseId', custom: 'id', settings: 'key', bodyweight: 'date', diag: '++id, t', tombs: 'k, table', kv: 'k' });
    await old.table('routines').put({ ...routine, _s: { h: hlcZero('devM'), d: 'devM', y: 0, q: 1, r: 7 } });
    await old.table('kv').put({ k: 'sync', v: { epoch: 3, since: 42, stash: { muts: [] } } });
    old.close();
    const db = new WorkoutDB(name2, { clock: new Clock(memoryClockStore(), () => 5_000), deviceId: () => 'devM' });
    expect(db.verno).toBe(5);
    expect(await db.feedback.count()).toBe(0);
    expect((await db.routines.get('r1'))?.name).toBe('등');
    expect((await db.kv.get('sync'))?.v).toEqual({ epoch: 3, since: 0, stash: { muts: [] } });
    db.close();
  });
  it('백업 불러오기: 파일 안 _s는 떼고 새로 표시, 진행 중 운동은 이 기기가 주인', async () => {
    const db = mkDb('devI');
    const w = { ...startWorkout('w9', routine, '2026-09-30T10:00:00.000Z', []), ownerDeviceId: 'other', _s: { h: 'x', d: 'o', q: 1, y: 0, r: 5 } };
    await importAll(db, { routines: [], workouts: [w as never], meta: [], custom: [], settings: [], bodyweight: [], diag: [], feedback: [] });
    const got = (await db.workouts.get('w9')) as unknown as { ownerDeviceId: string; _s: { y: number; d: string } };
    expect(got.ownerDeviceId).toBe('devI');
    expect(got._s).toMatchObject({ y: 1, d: 'devI' });
    db.close();
  });
  it('운동 표시(meta)는 항목 단위 f, update·modify 경로도 표시됨', async () => {
    const db = mkDb();
    await db.meta.put({ exerciseId: 'a', favorite: true });
    const m1 = (await db.meta.get('a')) as unknown as { _s: { f: Record<string, string>; q: number } };
    expect(Object.keys(m1._s.f)).toEqual(['favorite']);
    await db.meta.update('a', { excluded: true });
    const m2 = (await db.meta.get('a')) as unknown as { _s: { f: Record<string, string>; q: number } };
    expect(m2._s.q).toBe(2);
    expect(m2._s.f.favorite).toBe(m1._s.f.favorite);
    expect(m2._s.f.excluded).toBeDefined();
    await db.routines.put(routine);
    await db.routines.toCollection().modify((r) => { r.name = '바뀜'; });
    expect(((await db.routines.get('r1')) as unknown as { _s: { q: number } })._s.q).toBe(2);
    db.close();
  });
  it('지움 표시 없이 직접 지우면 막힘 (softDelete로만)', async () => {
    const db = mkDb();
    await db.routines.put(routine);
    await expect(db.routines.delete('r1')).rejects.toThrow(/softDelete/);
    await expect(db.routines.where('id').equals('r1').delete()).rejects.toThrow(/softDelete/);
    expect(await db.routines.get('r1')).toBeDefined();
    db.close();
  });
  it('1,000건 한 번에 저장이 빠름 (불러오기)', async () => {
    const db = mkDb();
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...routine, id: `r${i}` }));
    const t0 = performance.now();
    await db.routines.bulkPut(many);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(await db.routines.count()).toBe(1000);
    db.close();
  });
});

describe('지우기는 softDelete로만 (빠뜨린 곳 찾기)', () => {
  it('src 안에서 동기화하는 표를 직접 지우거나 modify/update 하는 코드가 없음 (db.ts 제외)', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
    walk('src');
    const bad = files.filter((f) => !f.endsWith(join('db', 'db.ts'))).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i: i + 1, l })))
      .filter(({ l }) => /\.(routines|workouts|meta|custom|settings|bodyweight)\.(delete|bulkDelete|clear|update|modify)\(/.test(l));
    expect(bad.map((b) => `${b.f}:${b.i}`)).toEqual([]);
  });
});

describe('서비스 워커 캐시: 자기 앞머리만 지움 (D-031)', () => {
  const run = async (scope: string, keys: string[]) => {
    const src = readFileSync('public/sw.js', 'utf8');
    const deleted: string[] = []; const handlers: Record<string, (e: unknown) => void> = {};
    const self = { registration: { scope }, addEventListener: (n: string, h: (e: unknown) => void) => { handlers[n] = h; }, clients: { claim: async () => undefined }, skipWaiting: () => undefined };
    const caches = { keys: async () => keys, delete: async (k: string) => { deleted.push(k); return true; }, open: async () => ({ addAll: async () => undefined, put: async () => undefined }), match: async () => undefined };
    new Function('self', 'caches', 'location', 'fetch', src)(self, caches, new URL(scope), async () => undefined);
    let p: Promise<unknown> = Promise.resolve();
    handlers.activate!({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    return deleted.sort();
  };
  it('본판은 옛 workout-app-v1과 자기 옛 버전만 지우고, 미리 보기 판 캐시는 그대로', async () => {
    expect(await run('https://x.github.io/workout-app/', ['workout-app-v1', 'workout-app:v1', 'workout-app:v2', 'workout-app-next:v1', 'other'])).toEqual(['workout-app-v1', 'workout-app:v1']);
  });
  it('설치 때 화면을 새로 받아 assets까지 미리 담음', async () => {
    const src = readFileSync('public/sw.js', 'utf8');
    const added: string[] = []; const handlers: Record<string, (e: unknown) => void> = {};
    const html = '<script type="module" src="/workout-app/assets/index-AB.js"></script><link rel="stylesheet" href="/workout-app/assets/index-CD.css">';
    const cache = { addAll: async (xs: (string | Request)[]) => { for (const x of xs) added.push(typeof x === 'string' ? x : `${x.url}|${x.cache}`); }, match: async () => new Response(html), put: async () => undefined };
    const self = { registration: { scope: 'https://x.github.io/workout-app/' }, addEventListener: (n: string, h: (e: unknown) => void) => { handlers[n] = h; } };
    const caches = { open: async () => cache };
    new Function('self', 'caches', 'location', 'fetch', 'Request', src)(self, caches, new URL('https://x.github.io/workout-app/'), async () => undefined, class { url: string; cache: string; constructor(u: string, o: { cache: string }) { this.url = u; this.cache = o.cache; } });
    let p: Promise<unknown> = Promise.resolve();
    handlers.install!({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    expect(added).toContain('./|reload');
    expect(added).toContain('https://x.github.io/workout-app/assets/index-AB.js');
    expect(added).toContain('https://x.github.io/workout-app/assets/index-CD.css');
  });
  it('미리 보기 판은 본판 캐시를 지우지 않음', async () => {
    expect(await run('https://x.github.io/workout-app-next/', ['workout-app-v1', 'workout-app:v2', 'workout-app-next:v1'])).toEqual(['workout-app-next:v1']);
  });
});
