/**
 * 서비스 워커 등록과 "새 버전 있음" 안내 (BLUEPRINT app-release 3.3: 운동 중에는 강제로 새로고침하지 않음)
 * D-055: 새 서비스 워커가 기다리면 version.json(빌드 때 생성, 네트워크로만 읽음)을 읽어 "새 버전 0.9.1 준비됨 · 바뀐 점 한 줄".
 * 읽지 못하면 info 없이 "새 버전이 있어요". [나중에] = 이번 실행 동안만 숨김 (다음에 앱을 열면 다시 보임).
 */
import { useEffect, useState } from 'preact/hooks';
import { parseVersionInfo } from '../core/changelog';
import type { VersionInfo } from '../core/changelog';

let waiting: ServiceWorker | null = null;
let info: VersionInfo | undefined;
let later = false;
/** 화면 시험용 흉내 (e2e·스크린샷): 실제 서비스 워커 없이 배너만 띄움. 적용을 누르면 새로 고침만 함 */
let simulated = false;
let reg: ServiceWorkerRegistration | null = null;
export interface UpdateState { ready: boolean; info?: VersionInfo }
const listeners = new Set<(v: UpdateState) => void>();
const state = (): UpdateState => ({ ready: (!!waiting || simulated) && !later, ...(info ? { info } : {}) });
const notify = () => { const v = state(); listeners.forEach((l) => l(v)); };

async function loadInfo(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    info = r.ok ? parseVersionInfo(await r.json()) : undefined;
  } catch { info = undefined; }
}
async function setWaiting(w: ServiceWorker) {
  waiting = w; notify(); // 먼저 "새 버전이 있어요"로 보이고, 파일을 읽으면 번호·바뀐 점으로 바꿈
  await loadInfo(); notify();
}

export function registerServiceWorker(): void {
  // 시험용: e2e·스크린샷이 'app:sim-update' 이벤트로 배너를 띄움 (detail = version.json 모양 또는 null = 읽기 실패 흉내).
  // 개발 서버이거나 시험이 window.__wkTest = true 를 세운 때만 반응 (본판에서는 우연히 배너가 뜨지 않게)
  window.addEventListener('app:sim-update', (e) => {
    if (!import.meta.env.DEV && !(window as Window & { __wkTest?: boolean }).__wkTest) return;
    simulated = true; later = false; info = parseVersionInfo((e as CustomEvent).detail); notify();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const r = reg;
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) void setWaiting(w); });
      };
      if (r.waiting && navigator.serviceWorker.controller) void setWaiting(r.waiting);
      r.addEventListener('updatefound', () => track(r.installing));
      // 앱을 다시 열 때마다 새 버전 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void r.update(); });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    } catch { /* 등록 실패해도 앱은 동작 */ }
  });
}

/** 설정 → 앱 정보의 [새 버전 확인]. 'ready' = 새 버전 준비됨(배너도 다시 보임), 'latest' = 최신, 'unavailable' = 이 화면에서는 확인 불가 */
export async function checkForUpdate(): Promise<'ready' | 'latest' | 'unavailable'> {
  if (waiting || simulated) { later = false; notify(); return 'ready'; }
  if (!reg) return 'unavailable';
  try {
    await reg.update();
    // 새 서비스 워커가 설치를 마칠 때까지 잠깐 기다림 (최대 8초)
    for (let i = 0; i < 16 && reg.installing; i++) await new Promise((res) => setTimeout(res, 500));
    if (reg.waiting && navigator.serviceWorker.controller) { later = false; await setWaiting(reg.waiting); return 'ready'; }
    return 'latest';
  } catch { return 'unavailable'; }
}

export function useUpdateAvailable(): [UpdateState, () => void, () => void] {
  const [v, set] = useState<UpdateState>(state);
  useEffect(() => { listeners.add(set); set(state()); return () => { listeners.delete(set); }; }, []);
  const apply = () => { if (waiting) waiting.postMessage('skipWaiting'); else if (simulated) location.reload(); };
  const dismiss = () => { later = true; notify(); };
  return [v, apply, dismiss];
}
