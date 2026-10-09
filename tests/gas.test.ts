import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { buildGas } from '../tools/gas/build';
import { WorkoutDB, softDelete } from '../src/db/db';
import { Clock, memoryClockStore } from '../src/core/hlc';
import { syncOnce, getKv } from '../src/db/sync';
import type { Transport } from '../src/db/sync';
import { planToRoutine } from '../src/core/session';

/** Apps Script 서비스 흉내 (드라이브는 메모리) */
function gas() {
  let today = '20261001';
  const props = new Map<string, string>();
  let reads = 0;
  type F = { name: string; content: string; parent: D; trashed?: boolean; id: string };
  const byId = new Map<string, F>(); let nid = 0;
  const mk = (name: string, content: string, parent: D): F => { const f = { name, content, parent, id: `f${++nid}` }; byId.set(f.id, f); return f; };
  type D = { name: string; files: F[]; folders: D[]; parent?: D; id?: string };
  const root: D = { name: 'WORK_OUT_APP', files: [], folders: [] };
  const sync: D = { name: 'sync', files: [], folders: [], parent: root };
  const inbox: D = { name: 'inbox', files: [], folders: [], parent: sync, id: '__INBOX_ID__' };
  sync.folders.push(inbox); root.folders.push(sync);
  const iter = <X,>(xs: X[]) => { let i = 0; return { hasNext: () => i < xs.length, next: () => xs[i++]! }; };
  const fileApi = (f: F): Record<string, unknown> => ({
    getName: () => f.name,
    getBlob: () => ({ getDataAsString: () => { reads++; return f.content; } }),
    setContent: (s: string) => { f.content = s; },
    makeCopy: (name: string, d: ReturnType<typeof folderApi>) => { const nf = mk(name, f.content, (d as { _d: D })._d); (d as { _d: D })._d.files.push(nf); return fileApi(nf); },
    setTrashed: () => { f.trashed = true; f.parent.files = f.parent.files.filter((x) => x !== f); },
    isTrashed: () => !!f.trashed,
    getId: () => f.id,
  });
  const folderApi = (d: D): Record<string, unknown> & { _d: D } => ({
    _d: d,
    getParents: () => iter(d.parent ? [folderApi(d.parent)] : []),
    getFoldersByName: (n: string) => iter(d.folders.filter((x) => x.name === n).map(folderApi)),
    createFolder: (n: string) => { const nd: D = { name: n, files: [], folders: [], parent: d }; d.folders.push(nd); return folderApi(nd); },
    getFilesByName: (n: string) => iter(d.files.filter((x) => x.name === n).map(fileApi)),
    getFiles: () => iter(d.files.map(fileApi)),
    createFile: (name: string, content: string) => { const f = mk(name, content, d); d.files.push(f); return fileApi(f); },
  });
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => void props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => undefined, tryLock: () => true, releaseLock: () => undefined }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ text: s, setMimeType() { return this; } }) },
    Utilities: { formatDate: (_d: Date, _tz: string, f: string) => (f === 'yyyyMMdd' ? today : today + '-120000'), getUuid: () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) },
    DriveApp: { getFolderById: (id: string) => { if (id !== '__INBOX_ID__') throw new Error('no folder'); return folderApi(inbox); }, getFileById: (id: string) => { const f = byId.get(id); if (!f) throw new Error('no file'); return fileApi(f); } },
    console: { error: () => undefined, warn: () => undefined, log: () => undefined },
  };
  const code = buildGas();
  const api = new Function(...Object.keys(env), code + '\nreturn { doPost, setup, restoreSnapshot };')(...Object.values(env)) as { doPost: (e: unknown) => { text: string }; setup: () => void; restoreSnapshot: (d: string) => unknown };
  api.setup();
  const cfg = sync.files.find((f) => f.name === '설정.txt')!.content.split('\n')[1]!;
  const key = cfg.split('#')[1]!;
  const post = (o: Record<string, unknown>) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(o) } }).text);
  const transport: Transport = async (req) => post({ ...req, key });
  const dbFolder = () => sync.folders.find((x) => x.name === 'db');
  return { api, post, key, transport, props, sync, inbox, dbFolder, reads: () => reads, setDay: (d: string) => { today = d; } };
}
const dev = (id: string) => new WorkoutDB(`gas-${id}-${Math.random()}`, { clock: new Clock(memoryClockStore()), deviceId: () => id });
const R = (id: string, name: string) => planToRoutine(id, name, '2026-09-30T10:00:00.000Z', [{ kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 3, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 90, timeSec: 0 }], 900);

describe('Apps Script 서버 코드 (실제 빌드 결과를 가짜 구글 서비스로 실행)', () => {
  it('키가 틀리면 거절, 설정 파일에는 /exec 주소#키', () => {
    const g = gas();
    expect(g.post({ key: 'x', op: 'sync' })).toEqual({ ok: false, error: 'bad_key' });
    expect(g.post({ key: g.key, ping: true })).toEqual({ ok: true, ping: true });
    expect(g.sync.files.find((f) => f.name === '설정.txt')!.content).toContain('__EXEC_URL__#');
  });
  it('두 기기가 실제 서버 코드를 거쳐 동기화, 드라이브 db/records.json에 저장', async () => {
    const g = gas(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', 'PC에서 만든 루틴'));
    await syncOnce(A, g.transport); await syncOnce(B, g.transport);
    expect((await B.routines.toArray()).map((r) => r.name)).toEqual(['PC에서 만든 루틴']);
    await softDelete(B, 'routines', 'r1');
    await syncOnce(B, g.transport); await syncOnce(A, g.transport);
    expect(await A.routines.count()).toBe(0);
    expect(g.dbFolder()!.files.map((f) => f.name)).toContain('records.json');
  });
  it('바뀐 것도 보낼 것도 없으면 드라이브를 읽지 않음, 힌트가 pending이면 읽음', async () => {
    const g = gas(); const A = dev('A');
    await A.routines.put(R('r1', 'x')); await syncOnce(A, g.transport);
    const n = g.reads();
    await syncOnce(A, g.transport);
    expect(g.reads()).toBe(n);
    g.props.set('HINT', 'pending');
    await syncOnce(A, g.transport);
    expect(g.reads()).toBe(n + 1);
  });
  it('하루 한 번 스냅숏, 최근 7개만', async () => {
    const g = gas(); const A = dev('A');
    for (let d = 1; d <= 9; d++) { g.setDay(`202610${String(d).padStart(2, '0')}`); await A.routines.put(R('r1', `v${d}`)); await syncOnce(A, g.transport); }
    const snaps = g.dbFolder()!.files.map((f) => f.name).filter((n) => /^records-\d{8}\.json$/.test(n)).sort();
    expect(snaps).toHaveLength(7);
    expect(snaps[snaps.length - 1]).toBe('records-20261009.json');
  });
  it('스냅숏으로 되돌리기 → epoch가 올라 다른 기기가 전체를 다시 받음', async () => {
    const g = gas(); const A = dev('A'), B = dev('B');
    g.setDay('20261001'); await A.routines.put(R('r1', '처음')); await syncOnce(A, g.transport);
    g.setDay('20261002'); await A.routines.put({ ...(await A.routines.get('r1'))!, name: '실수로 바꿈' }); await syncOnce(A, g.transport);
    await syncOnce(B, g.transport);
    g.setDay('20261003'); await syncOnce(A, g.transport); // 02일 스냅숏 = '처음' 상태
    g.api.restoreSnapshot('20261002');
    const r = await syncOnce(B, g.transport);
    expect(r.full).toBe(true);
    expect((await B.routines.toArray()).map((x) => x.name)).toEqual(['처음']);
    expect((await getKv(B)).epoch).toBe(2);
  });
  it('예전 "PC로 보내기" 파일 전송도 그대로 (inbox)', () => {
    const g = gas();
    const r = g.post({ key: g.key, file: { app: 'workout-app', schema: 2, data: {}, device: { id: 'ph' } } });
    expect(r.ok).toBe(true);
    expect(g.inbox.files.map((f) => f.name)[0]).toMatch(/^auto-ph-/);
  });
});

describe('D-058 애플워치 받기 (실제 빌드한 서버 코드)', () => {
  const now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const hrText = [at(30) + ' | 120 count/min', at(29) + ' | 131 count/min', '아무 글'].join('\n');
  it('키가 틀리면 거절, JSON 으로 받기, 같은 샘플을 또 보내도 한 번만', () => {
    const g = gas();
    expect(g.post({ op: 'health', key: 'x', kind: 'workout', hr: hrText })).toEqual({ ok: false, error: 'bad_key' });
    const r = g.post({ op: 'health', key: g.key, kind: 'workout', samples: { hr: hrText } });
    expect(r).toMatchObject({ ok: true, received: 2, skipped: 1 });
    expect(r.stored[0]).toMatch(/^hr-\d{4}-\d{2}-\d{2}$/);
    g.post({ op: 'health', key: g.key, kind: 'workout', samples: { hr: hrText } });
    const recs = JSON.parse(g.dbFolder()!.files.find((x) => x.name === 'records.json')!.content).recs as Record<string, { data: { p: number[] } }>;
    const hr = Object.entries(recs).filter(([k]) => k.startsWith('health/hr-'));
    expect(hr.reduce((a, [, v]) => a + v.data.p.length / 2, 0)).toBe(2);
  });
  it('폼(a=b&c=d)으로도 받음 (단축어 "양식"), 너무 많으면 거절', () => {
    const g = gas();
    const form = 'key=' + encodeURIComponent(g.key) + '&kind=daily&hr=' + encodeURIComponent(hrText);
    const r = JSON.parse(g.api.doPost({ postData: { contents: form } }).text);
    expect(r).toMatchObject({ ok: true, received: 2 });
    const big = Array.from({ length: 30001 }, () => at(10) + ' | 100').join('\n');
    expect(g.post({ op: 'health', key: g.key, kind: 'daily', hr: big })).toEqual({ ok: false, error: 'too_many' });
    expect(JSON.parse(g.api.doPost({ postData: { contents: 'hello' } }).text)).toEqual({ ok: false, error: 'not_json' });
  });
  it('새 앱은 다음 동기화로 health 를 받고, 옛 앱(healthSince 없음)은 받지 않음, 이미 받은 위치면 힌트로 바로 답함', async () => {
    const g = gas(); const A = dev('A');
    await A.routines.put(R('r1', '루틴')); await syncOnce(A, g.transport);
    g.post({ op: 'health', key: g.key, kind: 'workout', hr: hrText });
    const r = await syncOnce(A, g.transport);
    expect(r.received).toBeGreaterThan(0);
    const rows = await A.health.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('hr');
    const kv = await getKv(A);
    expect(kv.healthSince).toBe(kv.since);
    // 옛 앱 흉내: healthSince 없이
    const old = g.post({ key: g.key, op: 'sync', schema: 1, epoch: 0, since: 0, muts: [] });
    expect(old.changes.some((c: { table: string }) => c.table === 'health')).toBe(false);
    expect(old.health).toBeUndefined();
    // 바뀐 것 없음 + 다 받음 → 드라이브를 읽지 않음
    const reads = g.reads();
    await syncOnce(A, g.transport);
    expect(g.reads()).toBe(reads);
  });
  it('옛 앱 시절에 since 가 이미 앞선 기기(업그레이드)도 healthSince 0 부터 한 번 받음 (힌트가 맞아도 읽음)', async () => {
    const g = gas(); const A = dev('A');
    g.post({ op: 'health', key: g.key, kind: 'workout', hr: hrText });
    await A.routines.put(R('r1', '루틴')); await syncOnce(A, g.transport);
    await A.health.clear();
    const { setKv } = await import('../src/db/sync');
    await setKv(A, { healthSince: undefined });
    await syncOnce(A, g.transport);
    expect(await A.health.count()).toBe(1);
  });
  it('연결 시험(canary): canary 기록 하나만, 다음 동기화로 앱에 옴 (앱 화면은 무시)', async () => {
    const g = gas(); const A = dev('A');
    expect(g.post({ op: 'health', key: g.key, kind: 'canary', hr: hrText })).toMatchObject({ ok: true, received: 2, skipped: 1, stored: ['canary'] });
    await syncOnce(A, g.transport);
    expect((await A.health.get('canary'))?.type).toBe('canary');
  });
});

describe('D-058 연결 시험 스크립트 (tools/watch_canary.mjs) 를 가짜 서버에 실제로 돌림', () => {
  it('보내기 → 받기(canary 방금) → 옛 앱 경로에 health 없음 → 통과, 키는 출력에 없음', async () => {
    const { createServer } = await import('node:http');
    const { execFile } = await import('node:child_process');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const g = gas();
    const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(g.api.doPost({ postData: { contents: b } }).text); }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), 'canary-'));
    const cfg = join(dir, '설정.txt');
    writeFileSync(cfg, `설명 줄\nhttp://127.0.0.1:${port}/macros/s/TEST/exec#${g.key}\n`);
    const out = await new Promise<{ code: number; text: string }>((resolve) => {
      execFile(process.execPath, ['tools/watch_canary.mjs', cfg], { timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? (err as { code?: number }).code ?? 1 : 0, text: stdout + stderr }));
    });
    srv.close();
    expect(out.text).toContain('결과: 통과');
    expect(out.text).toContain('옛 앱 경로(healthSince 없음): health 0건');
    expect(out.text).not.toContain(g.key);
    expect(out.code).toBe(0);
  });
});

describe('D-058 검토 G4: 기록 파일에 120일 health(약 3MB) 가 있을 때 서버 시간', () => {
  it('파일 읽기·합치기·쓰기 시간 (옛 앱 동기화 + health 받기)', async () => {
    const g = gas(); const A = dev('A');
    await A.routines.put(R('r1', '루틴')); await syncOnce(A, g.transport);
    const file = g.dbFolder()!.files.find((f) => f.name === 'records.json')!;
    const state = JSON.parse(file.content);
    const now = Date.now();
    const day = (ms: number) => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
    for (let i = 0; i < 120; i++) {
      const dd = day(now - i * 86400000); const p = dd.split('-').map(Number); const t0 = Date.UTC(p[0]!, p[1]! - 1, p[2]!) - 9 * 3600000;
      const hr: number[] = []; for (let k = 0; k < 1000; k++) hr.push(k * 80, 60 + (k % 90));
      const en: number[] = []; for (let k = 0; k < 1440; k++) en.push(k * 60, 60, 12 + (k % 30));
      for (const [id, data] of [[`hr-${dd}`, { id: `hr-${dd}`, type: 'hr', day: dd, t0, p: hr }], [`en-${dd}`, { id: `en-${dd}`, type: 'energy', day: dd, t0, p: en }]] as const) {
        state.rev += 1; state.recs[`health/${id}`] = { table: 'health', id, data, hlc: '0', dev: 'srv', rev: state.rev };
      }
    }
    file.content = JSON.stringify(state);
    g.props.set('HINT', 'pending');
    const mb = file.content.length / 1024 / 1024;
    const t1 = performance.now();
    const old = g.post({ key: g.key, op: 'sync', schema: 1, epoch: state.epoch, since: 0, muts: [{ mid: 'x:routines:r9:1', table: 'routines', id: 'r9', hlc: '0000000000001.0000.x', dev: 'x', data: { id: 'r9', name: 'n', blocks: [] } }] });
    const syncMs = performance.now() - t1;
    const t2 = performance.now();
    const ing = g.post({ op: 'health', key: g.key, kind: 'workout', hr: Array.from({ length: 720 }, (_, k) => `${new Date(now - k * 5000).toISOString()} | 120`).join('\n') });
    const ingMs = performance.now() - t2;
    console.log(`G4 측정: 기록 파일 ${mb.toFixed(2)}MB · 옛 앱 동기화(읽기+합치기+쓰기) ${syncMs.toFixed(0)}ms · health 받기(720줄) ${ingMs.toFixed(0)}ms`);
    expect(old.ok).toBe(true);
    expect(old.changes.some((c: { table: string }) => c.table === 'health')).toBe(false);
    expect(ing.ok).toBe(true);
    expect(mb).toBeGreaterThan(2.5);
    expect(syncMs).toBeLessThan(5000);
    expect(ingMs).toBeLessThan(5000);
  });
});

describe('D-059 운동별 요약 (실제 빌드한 서버 코드)', () => {
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
  it('운동을 먼저 올리고 심박을 받으면 ws 생김 → 새 앱은 받고, 옛 앱 경로에는 없음', async () => {
    const g = gas(); const A = dev('A');
    const w = { id: 'wk1', name: '등', startedAt: at(60), endedAt: at(10), blocks: [], timer: null };
    await A.workouts.put(w as never); await syncOnce(A, g.transport);
    g.post({ op: 'health', key: g.key, kind: 'workout', hr: [`${at(50)} | 120`, `${at(40)} | 150`].join('\n') });
    await syncOnce(A, g.transport);
    expect(await A.health.get('ws-wk1')).toMatchObject({ hrAvg: 135, hrMax: 150, hrN: 2 });
    const old = g.post({ key: g.key, op: 'sync', schema: 1, epoch: 0, since: 0, muts: [] });
    expect(old.changes.some((c: { table: string }) => c.table === 'health')).toBe(false);
  });
  it('심박을 먼저 받고 운동이 나중에 올라오면 그 동기화 응답에 바로 ws, 지우면 ws 지움', async () => {
    const g = gas(); const A = dev('A');
    await A.routines.put(R('r1', '루틴')); await syncOnce(A, g.transport);
    g.post({ op: 'health', key: g.key, kind: 'daily', hr: [`${at(50)} | 110`, `${at(40)} | 130`].join('\n') });
    await A.workouts.put({ id: 'wk2', name: '하체', startedAt: at(60), endedAt: at(10), blocks: [], timer: null } as never);
    await syncOnce(A, g.transport);
    expect(await A.health.get('ws-wk2')).toMatchObject({ hrAvg: 120, hrN: 2 });
    const { softDelete } = await import('../src/db/db');
    await softDelete(A, 'workouts', 'wk2');
    await syncOnce(A, g.transport);
    expect(await A.health.get('ws-wk2')).toBeUndefined();
  });
});

