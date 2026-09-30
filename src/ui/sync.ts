/**
 * 앱 쪽 양방향 동기화 연결 (S2b, D-027). 기기 동기화 규칙은 src/db/sync.ts, 서버 규칙은 src/core/syncMerge.ts.
 * - 연결 주소·키는 "자동 보내기"와 같은 설정(send.cfg)을 씀
 * - 동기화 때: 앱 시작 · 다시 보일 때 · 인터넷 재연결 · 고친 뒤 3초 조용할 때 · 화면이 떠 있는 동안 1분마다
 * - 한 기기에 탭이 여러 개면 navigator.locks로 한 곳에서만
 */
import { useEffect, useState } from 'preact/hooks';
import { db, load, whenReady, onLocalWrite } from './store';
import { syncOnce, getKv, setKv, restoreStash, dropStash, collectMutations } from '../db/sync';
import type { Transport, Conflict } from '../db/sync';
import type { SyncRequest, ServerRec } from '../core/syncMerge';
import { SYNC_TABLES, PK, FIELD_TABLES, syncedFields, withoutStamp } from '../core/syncStamp';
import type { SyncStamp } from '../core/syncStamp';
import { getSendConfig } from './autoSend';
import { lsGet, lsSet, APP } from './appName';
import { diag } from './diag';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error';
export interface SyncStatus { phase: SyncPhase; lastOkAt?: string; pending: number; error?: string; stash: number; conflicts?: Conflict[]; received?: number }

let status: SyncStatus = { phase: 'off', pending: 0, stash: 0 };
const listeners = new Set<(s: SyncStatus) => void>();
const set = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; listeners.forEach((l) => l(status)); };
export const getSyncStatus = () => status;
export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(status);
  useEffect(() => { listeners.add(setS); setS(status); return () => { listeners.delete(setS); }; }, []);
  return s;
}

export const syncEnabled = () => lsGet('sync.on') === '1';

const ERR: Record<string, string> = {
  bad_key: '키가 맞지 않아요 (새 설정을 붙여넣어 주세요)', update_app: '앱을 새 버전으로 업데이트해 주세요',
  busy: '서버가 바빠요. 잠시 뒤 다시 해요', network: '인터넷에 연결되지 않았어요', timeout: '응답이 너무 늦어요',
  bad_response: '서버 응답이 이상해요', server: '서버에서 문제가 생겼어요', no_config: 'PC 연결 설정(주소#키)이 없어요',
};
export const syncErrorText = (e?: string) => (e ? ERR[e] ?? e : '');

/** 실제 서버로 보내는 통로 (text/plain = 사전 확인 요청 없음, Apps Script) */
export const httpTransport: Transport = async (req: SyncRequest) => {
  const c = getSendConfig();
  if (!c) return { ok: false, error: 'no_config' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...req, key: c.key }), signal: ctl.signal });
    try { return await r.json(); } catch { return { ok: false, error: 'bad_response' }; }
  } catch (e) { return { ok: false, error: (e as Error).name === 'AbortError' ? 'timeout' : 'network' }; }
  finally { clearTimeout(t); }
};
let transport: Transport = httpTransport;
/** 테스트용: 가짜 서버로 바꾸기 */
export function setTransport(t: Transport) { transport = t; }

/** 처음 연결 때 충돌 고르기: 화면(SyncSection)이 답할 때까지 기다림 */
let resolveChoice: ((picks: Record<string, 'local' | 'server'>) => void) | null = null;
export function answerConflicts(picks: Record<string, 'local' | 'server'>) { const r = resolveChoice; resolveChoice = null; set({ conflicts: undefined }); r?.(picks); }
const chooseByUser = (cs: Conflict[]) => new Promise<Record<string, 'local' | 'server'>>((res) => { resolveChoice = res; set({ conflicts: cs }); });

async function refreshPending() {
  const [muts, kv] = await Promise.all([collectMutations(db), getKv(db)]);
  set({ pending: muts.length, stash: kv.stash?.length ?? 0, ...(kv.lastOkAt ? { lastOkAt: kv.lastOkAt } : {}) });
}

let running: Promise<void> | null = null;
let again = false;
/** 지금 동기화 (켜져 있을 때만). 도는 중이면 끝난 뒤 한 번 더 */
export function syncNow(reason: string): Promise<void> {
  if (!syncEnabled()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    const work = async () => {
      set({ phase: 'syncing', error: undefined });
      try {
        const r = await syncOnce(db, transport, chooseByUser);
        if (r.error) { set({ phase: 'error', error: r.error }); diag('send', { m: `동기화 실패 (${reason}): ${r.error}`, ok: false }); }
        else {
          set({ phase: 'idle', received: r.received });
          if (r.received || r.confirmed || r.full) await load();
          diag('send', { m: `동기화 (${reason}) 받음 ${r.received} 확정 ${r.confirmed}${r.full ? ' 전체' : ''}`, ok: true });
        }
      } catch (e) { set({ phase: 'error', error: (e as Error).message }); }
      await refreshPending();
    };
    const locks = (navigator as Navigator & { locks?: { request: (n: string, o: object, f: () => Promise<void>) => Promise<void> } }).locks;
    if (locks) await locks.request(`${APP}-sync`, { ifAvailable: false }, work); else await work();
  })().finally(() => {
    running = null;
    if (again) { again = false; void syncNow('again'); }
  });
  return running;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
let started = false;
/** 앱 시작 때 한 번: 동기화 때 연결 */
export function startSync(): void {
  if (started) return;
  started = true;
  void whenReady().then(async () => { await refreshPending(); if (syncEnabled()) { set({ phase: 'idle' }); void syncNow('start'); } });
  onLocalWrite(() => {
    void refreshPending();
    if (!syncEnabled()) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void syncNow('change'); }, 3000);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow('visible'); });
  window.addEventListener('online', () => { void syncNow('online'); });
  setInterval(() => { if (document.visibilityState === 'visible') void syncNow('interval'); }, 60_000);
}

/** 동기화 켜기 (연결 마법사 마지막 단계). 처음이면 받기 → 비교·선택 → 올리기 */
export async function enableSync(): Promise<void> {
  lsSet('sync.on', '1');
  set({ phase: 'idle' });
  await syncNow('connect');
}
export async function disableSync(): Promise<void> {
  lsSet('sync.on', '0');
  set({ phase: 'off' });
}

/** 서버가 되돌려진 뒤 보관한 수정: 다시 올리기 / 버리기 */
export async function reuploadStash() { await restoreStash(db); await load(); await syncNow('stash'); }
export async function discardStash() { await dropStash(db); await refreshPending(); }

/** 이 기기 데이터를 서버 레코드로 (서버까지 이 백업으로 바꾸기) */
async function localRecs(): Promise<ServerRec[]> {
  const out: ServerRec[] = [];
  for (const t of SYNC_TABLES) {
    for (const r of (await db.table(t).toArray()) as (Record<string, unknown> & { _s?: SyncStamp })[]) {
      const id = String(r[PK[t]]);
      const data = FIELD_TABLES.includes(t) ? syncedFields(t, r) : (withoutStamp(r) as Record<string, unknown>);
      out.push({ table: t, id, data, hlc: r._s?.h ?? '', dev: r._s?.d ?? '', rev: 0, ...(r._s?.f ? { f: r._s.f } : {}) });
    }
  }
  return out;
}
/** 서버를 이 기기 데이터로 바꿈: 서버가 먼저 스냅숏, epoch를 올려 다른 기기는 다시 받음. 이 기기는 다시 연결 */
export async function replaceServerWithLocal(): Promise<{ ok: boolean; error?: string }> {
  const c = getSendConfig();
  if (!c) return { ok: false, error: 'no_config' };
  try {
    const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: c.key, op: 'replace', recs: await localRecs() }) });
    const j = (await r.json()) as { ok: boolean; error?: string };
    if (!j.ok) return j;
    await setKv(db, { epoch: 0, since: 0, stash: undefined });
    await syncNow('replace');
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
}
/** 이 기기를 비우고 서버에서 다시 받기 (초기화 뒤) */
export async function pullFresh(): Promise<void> {
  await setKv(db, { epoch: 0, since: 0, stash: undefined });
  await syncNow('pull');
}
