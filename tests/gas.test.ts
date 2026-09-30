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
