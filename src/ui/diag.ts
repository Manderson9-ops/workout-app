/**
 * 진단 기록 남기기 (D-024). 운동 중 입력이 느려지지 않도록 메모리에 모았다가
 * 2초 조용할 때, 앱이 숨겨질 때 한꺼번에 저장한다. 최근 1,000건만 보관.
 * 설정에서 끌 수 있음 (localStorage 'diag.off' = '1').
 */
import { lsGet, lsSet, lsRemove } from './appName';
import { db } from './store';
import { DIAG_MAX, sanitize, browserLabel, classifyTimerEnd } from '../core/diag';
import type { DiagEntry, DiagKind } from '../core/diag';
import { APP_VERSION } from '../core/version';

const buf: DiagEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

import { deviceId } from './deviceId';
export { deviceId };
export const deviceInfo = () => ({ id: deviceId(), label: browserLabel(navigator.userAgent) });

export const diagEnabled = () => lsGet('diag.off') !== '1';
export function setDiagEnabled(on: boolean) { if (on) lsRemove('diag.off'); else lsSet('diag.off', '1'); }

export function diag(k: DiagKind, f: { m?: string; v?: number; ok?: boolean } = {}): void {
  if (!diagEnabled()) return;
  const e: DiagEntry = { t: new Date().toISOString(), k, d: deviceId() };
  if (f.m !== undefined) e.m = sanitize(f.m, { numbers: k === 'error' });
  if (f.v !== undefined && Number.isFinite(f.v)) e.v = Math.round(f.v);
  if (f.ok !== undefined) e.ok = f.ok;
  buf.push(e);
  if (buf.length > DIAG_MAX) buf.splice(0, buf.length - DIAG_MAX);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushDiag(); }, 2000);
}

/** 모아 둔 기록을 저장하고 1,000건 넘는 오래된 것 지움 */
export async function flushDiag(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!buf.length) return;
  const items = buf.splice(0, buf.length);
  try { await writeDiag(items); } catch { /* 저장 실패는 조용히 버림 (진단 때문에 앱이 멈추면 안 됨) */ }
}

/** 저장하고 최근 max건만 남김 (오래된 것부터 지움). 테스트에서 직접 부름 */
export async function writeDiag(items: DiagEntry[], max = DIAG_MAX): Promise<void> {
  await db.transaction('rw', db.diag, async () => {
    await db.diag.bulkAdd(items);
    const n = await db.diag.count();
    if (n > max) {
      const old = await db.diag.orderBy('id').limit(n - max).primaryKeys();
      await db.diag.bulkDelete(old);
    }
  });
}

export async function recentDiag(n = 50): Promise<DiagEntry[]> {
  await flushDiag();
  return (await db.diag.orderBy('id').reverse().limit(n).toArray()).map(({ id: _id, ...e }: DiagEntry & { id?: number }) => e);
}
export async function allDiag(): Promise<DiagEntry[]> {
  await flushDiag();
  return (await db.diag.orderBy('id').toArray()).map(({ id: _id, ...e }: DiagEntry & { id?: number }) => e);
}

let errorsToday = { day: '', n: 0 };
/** 앱 시작 때 한 번: 시작 정보, 잡히지 않은 오류(하루 20개까지), 앱 전환, 숨길 때 저장 */
export function startDiag(): void {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  void (async () => {
    let persisted: boolean | undefined; let usageKB: number | undefined;
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* 없음 */ }
    try { const est = await navigator.storage?.estimate?.(); if (est?.usage !== undefined) usageKB = est.usage / 1024; } catch { /* 없음 */ }
    diag('start', { m: `${APP_VERSION} · ${browserLabel(navigator.userAgent)} · ${standalone ? '홈 화면 앱' : '브라우저 탭'} · 저장 보호 ${persisted ? '켜짐' : '꺼짐'}`, ...(usageKB !== undefined ? { v: usageKB } : {}) });
  })();
  const err = (m: string) => {
    const day = new Date().toDateString();
    if (errorsToday.day !== day) errorsToday = { day, n: 0 };
    if (++errorsToday.n > 20) return;
    diag('error', { m });
  };
  window.addEventListener('error', (e) => err(`${e.message}${e.lineno ? ` (줄 ${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => err(`처리 안 된 오류: ${(e.reason as Error)?.message ?? String(e.reason)}`));
  document.addEventListener('visibilitychange', () => {
    diag('vis', { m: document.visibilityState === 'hidden' ? 'hidden' : 'visible' });
    if (document.visibilityState === 'hidden') { lastHiddenAt = Date.now(); void flushDiag(); } else lastVisibleAt = Date.now();
  });
  window.addEventListener('pagehide', () => { void flushDiag(); });
}

/** 마지막으로 앱이 숨겨진/보인 시각 (타이머 오차가 "앱이 떠 있을 때" 잰 것인지 구분) */
export let lastHiddenAt = 0;
export let lastVisibleAt = 0;

/** 휴식 끝을 알린 순간: 예정 시각보다 얼마나 늦었나. 운동 화면 밖이었거나 앱이 숨겨졌던 경우는 측정에서 뺌 (classifyTimerEnd) */
export function diagTimerEnd(endsAt: number, soundOn: boolean, audio: string, screenShownAt: number): void {
  const now = Date.now();
  const kind = classifyTimerEnd({ endsAt, now, screenShownAt, lastHiddenAt, lastVisibleAt, hiddenNow: document.visibilityState === 'hidden' });
  diag('timer', { v: now - endsAt, m: kind });
  if (soundOn) diag('audio', { m: audio, ok: audio === 'running' });
}
