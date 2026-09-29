/**
 * 서비스 워커 등록과 "새 버전 있음" 안내 (BLUEPRINT app-release 3.3: 운동 중에는 강제로 새로고침하지 않음)
 */
import { useEffect, useState } from 'preact/hooks';

let waiting: ServiceWorker | null = null;
const listeners = new Set<(v: boolean) => void>();
const notify = () => listeners.forEach((l) => l(!!waiting));

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; notify(); } });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; notify(); }
      reg.addEventListener('updatefound', () => track(reg.installing));
      // 앱을 다시 열 때마다 새 버전 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    } catch { /* 등록 실패해도 앱은 동작 */ }
  });
}

export function useUpdateAvailable(): [boolean, () => void] {
  const [v, set] = useState(!!waiting);
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set); }; }, []);
  return [v, () => waiting?.postMessage('skipWaiting')];
}
