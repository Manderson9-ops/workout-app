/**
 * 서비스 워커 등록과 "새 버전 있음" 안내 (BLUEPRINT app-release 3.3: 운동 중에는 강제로 새로고침하지 않음)
 * D-055:
 * - 새 서비스 워커가 기다리면 version.json(빌드 때 생성, 네트워크로만 읽음)을 읽어 "새 버전 0.9.1 준비됨 · 바뀐 점 한 줄". 읽지 못하면 "새 버전이 있어요"
 * - 대비책 (검토 A1): 앱을 열 때·다시 볼 때 version.json 을 직접 읽어 지금 버전보다 새로우면 서비스 워커 갱신을 요청하고,
 *   그래도 대기 워커가 없으면 배너를 띄우고 [지금 적용] = 새로 고침 (같은 실행에서 같은 버전으로 두 번은 새로 고치지 않음: 무한 새로 고침 방지)
 * - [나중에] = 이번 실행 동안만 숨김 (다음에 앱을 열면 다시 보임)
 */
import { useEffect, useState } from 'preact/hooks';
import { parseVersionInfo, cmpVersion, waitingDecision } from '../core/changelog';
import type { VersionInfo } from '../core/changelog';
import { APP_VERSION } from '../core/version';
import { scopedKey } from './appName';

let waiting: ServiceWorker | null = null;
let info: VersionInfo | undefined;
let later = false;
/** 서버에 더 새 버전이 있는데 대기 워커가 없음 → 적용 = 새로 고침 */
let stale = false;
/** 새로 고쳐도 옛 버전이면 보이는 안내 (무한 새로 고침 대신) */
let note: string | undefined;
/** 화면 시험용 흉내 (e2e·스크린샷): 실제 서비스 워커 없이 배너만 띄움. 적용을 누르면 새로 고침만 함 */
let simulated = false;
let reg: ServiceWorkerRegistration | null = null;
export interface UpdateState { ready: boolean; info?: VersionInfo; note?: string }
const listeners = new Set<(v: UpdateState) => void>();
const state = (): UpdateState => ({ ready: (!!waiting || simulated || stale) && !later, ...(info ? { info } : {}), ...(note ? { note } : {}) });
const notify = () => { const v = state(); listeners.forEach((l) => l(v)); };
const RELOAD_KEY = scopedKey('upd.reloadFor');

async function fetchInfo(): Promise<VersionInfo | undefined> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    return r.ok ? parseVersionInfo(await r.json()) : undefined;
  } catch { return undefined; }
}
/** 이번 controllerchange 는 새로 고치지 않음 (이미 새 코드로 도는 페이지에서 조용히 워커만 바꿈, 검토 R1) */
let quietSwap = false;
async function setWaiting(w: ServiceWorker) {
  // 서버 버전을 먼저 보고 정함: 페이지가 이미 그 버전이면 배너 없이 조용히 ("새로 바뀐 점" 시트와 같은 버전으로 겹치지 않게)
  const v = await fetchInfo();
  if (waitingDecision(v?.version, APP_VERSION) === 'silent') {
    quietSwap = true;
    w.postMessage('skipWaiting');
    return;
  }
  if (v) info = v;
  waiting = w;
  notify();
}
/** 새 서비스 워커가 설치를 마칠 때까지 잠깐 기다림 (최대 8초) */
async function updateAndWait(): Promise<void> {
  if (!reg) return;
  try {
    await reg.update();
    for (let i = 0; i < 16 && reg.installing; i++) await new Promise((res) => setTimeout(res, 500));
    if (reg.waiting && navigator.serviceWorker.controller && !waiting) await setWaiting(reg.waiting);
  } catch { /* 오프라인 등: 아래에서 새로 고침 배너로 대신 */ }
}

export type CheckResult = { kind: 'ready' | 'latest'; version: string } | { kind: 'unavailable' };
let lastCheck = 0;
/**
 * 서버의 version.json 과 지금 버전 비교 (앱 시작·다시 볼 때·[새 버전 확인]).
 * 더 새로우면 서비스 워커 갱신 → 대기 워커가 생기면 그걸로, 아니면 새로 고침 배너
 */
export async function checkRemote(force = false): Promise<CheckResult> {
  if (!force && Date.now() - lastCheck < 30_000) return { kind: 'unavailable' };
  lastCheck = Date.now();
  const v = await fetchInfo();
  if (!v) return { kind: 'unavailable' };
  if (cmpVersion(v.version, APP_VERSION) <= 0) return { kind: 'latest', version: v.version };
  info = v;
  if (force) later = false;
  if (!waiting) await updateAndWait();
  if (!waiting) stale = true;
  notify();
  return { kind: 'ready', version: v.version };
}

export function registerServiceWorker(): void {
  // 시험용: e2e·스크린샷이 'app:sim-update' 이벤트로 배너를 띄움 (detail = version.json 모양 또는 null = 읽기 실패 흉내).
  // 개발 서버이거나 시험이 window.__wkTest = true 를 세운 때만 반응 (본판에서는 우연히 배너가 뜨지 않게)
  window.addEventListener('app:sim-update', (e) => {
    if (!import.meta.env.DEV && !(window as Window & { __wkTest?: boolean }).__wkTest) return;
    simulated = true; later = false; info = parseVersionInfo((e as CustomEvent).detail); notify();
  });
  if (!import.meta.env.PROD) return;
  // 앱을 다시 볼 때마다 새 버전 확인 (서비스 워커 갱신 + version.json 직접 비교, 30초에 한 번까지)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void reg?.update().catch(() => undefined);
    void checkRemote();
  });
  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
      try {
        reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
        const r = reg;
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) void setWaiting(w); });
        };
        if (r.waiting && navigator.serviceWorker.controller) void setWaiting(r.waiting);
        r.addEventListener('updatefound', () => track(r.installing));
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (quietSwap) { quietSwap = false; return; } // 조용한 교체: 쓰는 도중 갑자기 새로 고치지 않음 (다음에 열 때 새 워커가 화면을 맡음)
          if (!reloaded) { reloaded = true; location.reload(); }
        });
      } catch { reg = null; /* 등록 실패해도 앱은 동작 */ }
    }
    void checkRemote(true);
  });
}

/** 설정 → 앱 정보의 [새 버전 확인] */
export async function checkForUpdate(): Promise<CheckResult> {
  if (simulated) { later = false; notify(); return { kind: 'ready', version: info?.version ?? '' }; }
  return checkRemote(true);
}

/** [지금 적용]: 대기 워커가 있으면 그걸로 바꾸고(바뀌면 한 번 새로 고침), 없으면 새로 고침. 같은 실행에서 같은 버전으로 두 번은 새로 고치지 않음 */
export function applyUpdate(): void {
  if (waiting) { waiting.postMessage('skipWaiting'); return; }
  if (!stale && !simulated) return;
  const v = info?.version ?? '?';
  let tried: string | null = null;
  try { tried = sessionStorage.getItem(RELOAD_KEY); } catch { /* 사생활 모드 */ }
  if (tried === v) {
    note = '아직 새 버전을 받지 못했어요. 잠시 뒤 앱을 완전히 닫았다 다시 열어 주세요';
    notify();
    return;
  }
  try { sessionStorage.setItem(RELOAD_KEY, v); } catch { /* 그래도 한 번은 새로 고침 */ }
  location.reload();
}

export function useUpdateAvailable(): [UpdateState, () => void, () => void] {
  const [v, set] = useState<UpdateState>(state);
  useEffect(() => { listeners.add(set); set(state()); return () => { listeners.delete(set); }; }, []);
  const dismiss = () => { later = true; notify(); };
  return [v, applyUpdate, dismiss];
}
