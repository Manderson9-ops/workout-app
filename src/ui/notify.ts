/**
 * D-056 실험: 휴식 끝 시스템 알림 (서버 없음). 이 기기만 켜고 끔 (localStorage).
 * - 켤 때(사용자 탭 안에서) 알림 권한을 물음
 * - 휴식 끝에 서비스 워커의 showNotification (아이폰 홈 화면 앱은 new Notification 이 안 되고 이 방법만 됨)
 * - 앱이 뒤에 있으면 타이머가 느려지거나 멈출 수 있어 제때 안 올 수 있음 (서버 푸시가 아니라서)
 */
import { lsGet, lsSet, lsRemove } from './appName';
import { diag } from './diag';
import type { NotifyPermission } from '../core/notify';

export const NOTIFY_KEY = 'notify.restEnd';
export const notifySupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
export const notifyPermission = (): NotifyPermission => (notifySupported() ? (Notification.permission as NotifyPermission) : 'unsupported');
export const notifyOn = (): boolean => lsGet(NOTIFY_KEY) === '1';
export function setNotifyOff(): void { lsRemove(NOTIFY_KEY); }

/** 켜기: 권한을 물어 허용되면 켬. 결과 권한을 돌려줌 */
export async function enableNotify(): Promise<NotifyPermission> {
  if (!notifySupported()) { diag('notify', { m: 'unsupported', ok: false }); return 'unsupported'; }
  let p = Notification.permission as NotifyPermission;
  if (p === 'default') {
    try { p = (await Notification.requestPermission()) as NotifyPermission; } catch { p = Notification.permission as NotifyPermission; }
  }
  diag('notify', { m: p, ok: p === 'granted' });
  if (p === 'granted') lsSet(NOTIFY_KEY, '1'); else lsRemove(NOTIFY_KEY);
  return p;
}

type TestWin = Window & { __wkTest?: boolean; __notifyCalls?: { title: string; body: string; t: number }[] };

/** 알림 하나 보내기. 'shown' | 'error' | 'unsupported' | 'denied' */
export async function showAppNotification(title: string, body: string, tag = 'rest-end'): Promise<'shown' | 'error' | 'unsupported' | 'denied'> {
  const w = window as TestWin;
  if (w.__wkTest) (w.__notifyCalls ??= []).push({ title, body, t: Date.now() });
  if (!notifySupported()) { diag('notify', { m: 'unsupported', ok: false }); return 'unsupported'; }
  if (Notification.permission !== 'granted') { diag('notify', { m: 'denied', ok: false }); return 'denied'; }
  const opts = { body, tag, renotify: true, silent: false, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, data: { url: '#/workout' } } as NotificationOptions;
  try {
    // 서비스 워커가 준비될 때까지 (최대 3초). 없으면 일반 알림 시도 (아이폰은 안 됨)
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
    diag('notify', { m: 'shown', ok: true });
    return 'shown';
  } catch (e) {
    diag('notify', { m: `error: ${(e as Error).name}`, ok: false });
    return 'error';
  }
}
