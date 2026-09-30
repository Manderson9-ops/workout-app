/**
 * 자동 보내기(T2, D-023): 운동을 끝내면 백업 파일(+진단)을 구글 Apps Script로 보내 드라이브 WORK_OUT_APP/sync/inbox 에 저장.
 * - 아이폰은 앱이 숨겨지면 몇 초 안에 멈추므로, 운동 종료 뒤 홈 화면이 보이는 동안 보내고 결과를 보여 줌.
 *   실패하면 "보낼 것 있음"으로 두고 앱을 다시 열 때 다시 보냄.
 * - 설정(주소#키)은 이 기기 localStorage 'send.cfg' 에만. 백업·진단·화면에 넣지 않음 (D-025, 테스트로 확인)
 */
import { useEffect, useState } from 'preact/hooks';
import { db, flushPending } from './store';
import { exportAll } from '../db/db';
import { makeBackup } from '../core/backup';
import { APP_VERSION } from '../core/version';
import { parseSendConfig } from '../core/autoSendConfig';
import { diag, flushDiag, deviceInfo } from './diag';

const CFG = 'send.cfg', PENDING = 'send.pending', LAST = 'send.lastAt';

export type SendState = { phase: 'idle' | 'sending' | 'sent' | 'failed'; at?: string; error?: string };
let state: SendState = { phase: 'idle' };
const listeners = new Set<(s: SendState) => void>();
const set = (s: SendState) => { state = s; listeners.forEach((l) => l(s)); };
export function useSendState(): SendState {
  const [s, setS] = useState(state);
  // 처음 그린 뒤 구독하기 전에 상태가 바뀌었을 수 있어서, 구독하면서 최신 상태로 맞춤
  useEffect(() => { listeners.add(setS); setS(state); return () => { listeners.delete(setS); }; }, []);
  return s;
}

export function getSendConfig() {
  const raw = localStorage.getItem(CFG);
  if (!raw) return undefined;
  const r = parseSendConfig(raw);
  return r.ok ? r : undefined;
}
export function saveSendConfig(text: string): { ok: true } | { ok: false; error: string } {
  const r = parseSendConfig(text);
  if (!r.ok) return r;
  localStorage.setItem(CFG, `${r.url}#${r.key}`);
  return { ok: true };
}
export function clearSendConfig() { localStorage.removeItem(CFG); localStorage.removeItem(PENDING); set({ phase: 'idle' }); }
export const lastSentAt = () => localStorage.getItem(LAST) ?? undefined;
export const hasPending = () => localStorage.getItem(PENDING) === '1';

const ERR: Record<string, string> = {
  bad_key: '키가 맞지 않아요 (키가 바뀌었으면 새 설정을 붙여넣어 주세요)',
  daily_limit: '오늘 보낼 수 있는 횟수(50번)를 넘었어요',
  too_big: '파일이 너무 커요',
  not_backup: '보낸 내용이 백업 형식이 아니에요',
  not_json: '보낸 내용이 깨졌어요', server: '받는 쪽에서 문제가 생겼어요',
  network: '인터넷 연결을 확인해 주세요',
};

async function post(url: string, body: unknown, timeoutMs = 20000): Promise<{ ok: boolean; error?: string; name?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // text/plain = 사전 확인 요청 없이 보내는 방식 (Apps Script가 받을 수 있는 형태, 카나리아로 확인)
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = (await r.json()) as { ok?: boolean; error?: string; name?: string };
    return { ok: j.ok === true, ...(j.error ? { error: j.error } : {}), ...(j.name ? { name: j.name } : {}) };
  } catch { return { ok: false, error: 'network' }; }
  finally { clearTimeout(t); }
}

/** 연결 확인: 키만 보내 보고 파일은 만들지 않음 */
export async function pingSend(): Promise<{ ok: boolean; message: string }> {
  const c = getSendConfig();
  if (!c) return { ok: false, message: '설정이 없어요' };
  const r = await post(c.url, { key: c.key, ping: true });
  diag('send', { m: r.ok ? '연결 확인' : `연결 확인 실패: ${r.error}`, ok: r.ok });
  return { ok: r.ok, message: r.ok ? '연결됐어요' : ERR[r.error ?? 'server'] ?? '연결하지 못했어요' };
}

let sending: Promise<boolean> | null = null;
/** 지금 보내기. 설정이 없으면 아무것도 안 함. 동시에 하나만 */
export function sendNow(reason: 'workout' | 'manual' | 'retry'): Promise<boolean> {
  const c = getSendConfig();
  if (!c) return Promise.resolve(false);
  if (sending) return sending;
  sending = (async () => {
    set({ phase: 'sending' });
    try {
      await flushPending();
      diag('send', { m: `자동 보내기 시작 (${reason})` });
      await flushDiag();
      const file = makeBackup(await exportAll(db), APP_VERSION, new Date().toISOString(), deviceInfo());
      const r = await post(c.url, { key: c.key, file });
      if (r.ok) {
        const at = new Date().toISOString();
        localStorage.setItem(LAST, at); localStorage.removeItem(PENDING);
        diag('send', { m: `자동 (${reason})`, ok: true });
        set({ phase: 'sent', at });
        return true;
      }
      localStorage.setItem(PENDING, '1');
      diag('send', { m: `자동 실패 (${reason}): ${r.error}`, ok: false });
      set({ phase: 'failed', error: ERR[r.error ?? 'server'] ?? '보내지 못했어요' });
      return false;
    } finally { sending = null; }
  })();
  return sending;
}

/** 앱을 열 때: 못 보낸 것이 있으면 다시 보냄 */
export function retryPendingOnStart(): void {
  if (hasPending() && getSendConfig()) void sendNow('retry');
}
