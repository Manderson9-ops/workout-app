/**
 * 이 기기의 짧은 ID (진단·동기화에서 어느 기기인지 구분. 개인 정보 아님). 앱 이름별로 따로 (D-031)
 */
import { lsGet, lsSet } from './appName';

export function deviceId(): string {
  let id = lsGet('deviceId');
  if (!id) { id = Math.random().toString(36).slice(2, 8); lsSet('deviceId', id); }
  return id;
}
