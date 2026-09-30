/**
 * 자동 보내기(T2, D-023): 운동을 끝내면 백업 파일(+진단)을 구글 Apps Script로 보내 드라이브 WORK_OUT_APP/sync/inbox 에 저장.
 * - 아이폰은 앱이 숨겨지면 몇 초 안에 멈추므로, 운동 종료 뒤 홈 화면이 보이는 동안 보내고 결과를 보여 줌.
 *   실패하면 "보낼 것 있음"으로 두고 앱을 다시 열 때 다시 보냄.
 * - 설정(주소#키)은 이 기기 localStorage 'send.cfg' 에만. 백업·진단·화면에 넣지 않음 (D-025, 테스트로 확인)
 */
import { lsGet, lsSet, lsRemove } from './appName';
import { useEffect, useState } from 'preact/hooks';
import { db, flushPending, getState, activeOf, whenReady } from './store';
import { exportAll } from '../db/db';
import { makeBackup } from '../core/backup';
import { APP_VERSION } from '../core/version';
import { parseSendConfig } from '../core/autoSendConfig';
import { diag, flushDiag, deviceInfo } from './diag';

const CFG = 'send.cfg', PENDING = 'send.pending', LAST = 'send.lastAt', BLOCKED = 'send.blocked';
/** 다시 해도 안 되는 오류: 자동 재시도를 멈추고 직접 보내기·새 설정 때만 다시 (데이터 낭비 방지) */
const PERMANENT = ['bad_key', 'too_big', 'not_backup', 'bad_response', 'not_json'];
const today = () => new Date().toDateString();

export type SendState = { phase: 'idle' | 'sending' | 'sent' | 'failed'; at?: string; error?: string };
let state: SendState = { phase: 'idle' };
const listeners = new Set<(s: SendState) => void>();
const set = (s: SendState) => { state = s; listeners.forEach((l) => l(s)); };
export const getSendState = () => state;
export function useSendState(): SendState {
  const [s, setS] = useState(state);
  // 처음 그린 뒤 구독하기 전에 상태가 바뀌었을 수 있어서, 구독하면서 최신 상태로 맞춤
  useEffect(() => { listeners.add(setS); setS(state); return () => { listeners.delete(setS); }; }, []);
  return s;
}

export function getSendConfig() {
  const raw = lsGet(CFG);
  if (!raw) return undefined;
  const r = parseSendConfig(raw);
  return r.ok ? r : undefined;
}
export function saveSendConfig(text: string): { ok: true } | { ok: false; error: string } {
  const r = parseSendConfig(text);
  if (!r.ok) return r;
  lsSet(CFG, `${r.url}#${r.key}`);
  lsRemove(BLOCKED);
  return { ok: true };
}
export function clearSendConfig() { lsRemove(CFG); lsRemove(PENDING); lsRemove(BLOCKED); set({ phase: 'idle' }); }
/** 멈춘 이유를 사람 말로 */
export const blockedReason = () => { const c = retryBlocked(); return c ? (ERR[c] ?? c) : undefined; };
/** 자동 재시도를 멈춘 이유 (없으면 undefined). 하루 한도는 다음 날 풀림 */
export function retryBlocked(): string | undefined {
  const b = lsGet(BLOCKED);
  if (!b) return undefined;
  const [code, day] = b.split('|');
  if (code === 'daily_limit' && day !== today()) { lsRemove(BLOCKED); return undefined; }
  return code;
}
export const lastSentAt = () => lsGet(LAST) ?? undefined;
export const hasPending = () => lsGet(PENDING) === '1';

const ERR: Record<string, string> = {
  bad_key: '키가 맞지 않아요 (키가 바뀌었으면 새 설정을 붙여넣어 주세요)',
  daily_limit: '오늘 보낼 수 있는 횟수(50번)를 넘었어요',
  too_big: '파일이 너무 커요',
  not_backup: '보낸 내용이 백업 형식이 아니에요',
  not_json: '보낸 내용이 깨졌어요', server: '받는 쪽에서 문제가 생겼어요',
  network: '인터넷에 연결되지 않았어요',
  timeout: '응답이 너무 늦어요 (인터넷이 느림). 받는 쪽에 이미 저장됐을 수 있어요',
  bad_response: '받는 쪽 응답이 이상해요 (구글 로그인 화면 등). 연결 설정을 확인해 주세요',
};

/** 보내는 시간 한도: 아이폰 데이터 통신으로 1~2MB도 보낼 수 있게 넉넉히 */
export const SEND_TIMEOUT_MS = 45000;

async function post(url: string, body: unknown, timeoutMs = SEND_TIMEOUT_MS): Promise<{ ok: boolean; error?: string; name?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    // text/plain = 사전 확인 요청 없이 보내는 방식 (Apps Script가 받을 수 있는 형태, 카나리아로 확인)
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: (e as Error).name === 'AbortError' ? 'timeout' : 'network' };
  }
  try {
    const j = (await r.json()) as { ok?: boolean; error?: string; name?: string };
    return { ok: j.ok === true, ...(j.error ? { error: j.error } : {}), ...(j.name ? { name: j.name } : {}) };
  } catch (e) {
    return { ok: false, error: (e as Error).name === 'AbortError' ? 'timeout' : 'bad_response' };
  } finally { clearTimeout(t); }
}

/** 연결 확인: 키만 보내 보고 파일은 만들지 않음 */
export async function pingSend(): Promise<{ ok: boolean; message: string }> {
  const c = getSendConfig();
  if (!c) return { ok: false, message: '설정이 없어요' };
  const r = await post(c.url, { key: c.key, ping: true }, 20000);
  diag('send', { m: r.ok ? '연결 확인' : `연결 확인 실패: ${r.error}`, ok: r.ok });
  return { ok: r.ok, message: r.ok ? '연결됐어요' : ERR[r.error ?? 'server'] ?? '연결하지 못했어요' };
}

let sending: Promise<boolean> | null = null;
/** 보내는 중에 또 보내 달라는 요청(예: 재시도 중 운동 종료)이 오면, 지금 보내기가 끝난 뒤 한 번 더 보냄 (검토 2차) */
let again: Promise<boolean> | null = null;
/**
 * 지금 보내기. 설정이 없으면 아무것도 안 함. 동시에 하나만.
 * "보낼 것 있음"은 보내기 **시작 전에** 켜고 성공했을 때만 끈다: 보내는 도중 앱이 닫히거나 멈춰도 다음에 다시 보냄 (검토 1차)
 */
export function sendNow(reason: 'workout' | 'manual' | 'retry'): Promise<boolean> {
  const c = getSendConfig();
  if (!c) return Promise.resolve(false);
  lsSet(PENDING, '1');
  if (sending) {
    again ??= sending.then(() => { again = null; return sendNow(reason); });
    return again;
  }
  if (reason !== 'retry') lsRemove(BLOCKED);
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
        lsSet(LAST, at);
        if (!again) lsRemove(PENDING); // 한 번 더 보낼 예정이면 표시를 남겨 둠 (그 사이 앱이 닫혀도 다시 보냄)
        diag('send', { m: `자동 (${reason})`, ok: true });
        set({ phase: 'sent', at });
        return true;
      }
      diag('send', { m: `자동 실패 (${reason}): ${r.error}`, ok: false });
      if (r.error && PERMANENT.includes(r.error)) lsSet(BLOCKED, r.error);
      if (r.error === 'daily_limit') lsSet(BLOCKED, `daily_limit|${today()}`);
      set({ phase: 'failed', error: ERR[r.error ?? 'server'] ?? '보내지 못했어요' });
      return false;
    } catch {
      set({ phase: 'failed', error: '보내기를 준비하다 문제가 생겼어요' });
      return false;
    } finally { sending = null; }
  })();
  return sending;
}

let lastRetry = 0;
/** 못 보낸 것이 있으면 다시 보냄. 앱을 열 때·다시 보일 때·인터넷이 다시 연결될 때. 30초에 한 번까지 */
export function retryPending(): void {
  if (!hasPending() || !getSendConfig() || sending || retryBlocked()) return;
  // 운동 중에는 다시 보내지 않음 (전체 내보내기로 입력이 잠깐 느려질 수 있음). 운동이 끝나면 어차피 보냄
  if (activeOf(getState())) return;
  if (Date.now() - lastRetry < 30000) return;
  lastRetry = Date.now();
  void sendNow('retry');
}
/** 앱 시작 때 한 번 부름: 시작 시 재시도 + 다시 보일 때·온라인 될 때 재시도 연결 */
export function retryPendingOnStart(): void {
  // 데이터를 다 불러온 뒤 재시도 (그래야 진행 중인 운동이 있는지 알 수 있음, 검토 3차)
  void whenReady().then(retryPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryPending(); });
  window.addEventListener('online', () => { lastRetry = 0; retryPending(); });
}
