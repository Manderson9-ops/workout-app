/**
 * 앱 이름 (D-031): 배포 경로의 마지막 폴더. 본판 = "workout-app", 미리 보기 판 = "workout-app-next".
 * 같은 주소(manderson9-ops.github.io)의 두 판이 저장소(IndexedDB)·localStorage를 섞지 않도록 이름으로 나눈다.
 * 본판은 예전 키 이름을 그대로 써서 기존 데이터를 유지한다.
 */
const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/workout-app/';
/** 배포 경로 → 앱 이름 ('/workout-app/' → 'workout-app', '/workout-app-next/' → 'workout-app-next') */
export const appFromBase = (b: string) => b.split('/').filter(Boolean).pop() || 'workout-app';
export const APP = appFromBase(base);
export const DB_NAME = APP;
/** 미리 보기 판(D-031): 동기화·자동 보내기를 하지 않음 (본판 데이터와 섞이지 않게) */
export const IS_PREVIEW = APP !== 'workout-app';
const key = (k: string) => (APP === 'workout-app' ? k : `${APP}:${k}`);
/** sessionStorage 키도 앱 이름별로 */
export const scopedKey = key;
const ls = (): Storage | undefined => { try { return typeof localStorage !== 'undefined' ? localStorage : undefined; } catch { return undefined; } };
const mem = new Map<string, string>();
/** 저장 실패(용량 초과·사생활 모드)해도 앱이 멈추지 않게 메모리로 대신함 */
export function lsGet(k: string): string | null { const s = ls(); try { return s ? s.getItem(key(k)) : mem.get(key(k)) ?? null; } catch { return mem.get(key(k)) ?? null; } }
export function lsSet(k: string, v: string): void { const s = ls(); mem.set(key(k), v); try { s?.setItem(key(k), v); } catch { /* 메모리 값으로 계속 */ } }
export function lsRemove(k: string): void { const s = ls(); mem.delete(key(k)); try { s?.removeItem(key(k)); } catch { /* 무시 */ } }
