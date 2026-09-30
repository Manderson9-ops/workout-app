/**
 * 이 기기의 짧은 ID (진단·동기화에서 어느 기기인지 구분. 개인 정보 아님).
 * localStorage가 없는 환경(테스트)에서는 메모리 값.
 */
let mem: string | null = null;
const ls = (): Storage | undefined => (typeof localStorage !== 'undefined' ? localStorage : undefined);

export function deviceId(): string {
  const s = ls();
  let id = s ? s.getItem('deviceId') : mem;
  if (!id) {
    id = Math.random().toString(36).slice(2, 8);
    if (s) s.setItem('deviceId', id); else mem = id;
  }
  return id;
}
