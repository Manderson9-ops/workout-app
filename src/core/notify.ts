/**
 * D-056 실험: 휴식 끝을 시스템 알림(Notification)으로 (서버 없음, 앱이 떠 있을 때).
 * 알림은 아이폰 무음 모드에서도 시스템 진동이 날 수 있고 음악을 멈추지 않음 → 될지는 실기기 확인 항목 (실험).
 * 순수 함수만 (화면·브라우저 쪽은 src/ui/notify.ts)
 */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** 휴식 끝 알림을 지금 보낼지: 켜 둠 + 허용됨 + 늦지 않음(끝난 지 graceMs 이내). 휴식마다 한 번은 부르는 쪽(wasAlerted)이 지킴 */
export function shouldNotify(x: { on: boolean; permission: NotifyPermission; endsAt: number; now: number; graceMs?: number }): boolean {
  if (!x.on || x.permission !== 'granted') return false;
  return x.now - x.endsAt <= (x.graceMs ?? 5000);
}

/** 아이폰·아이패드 (iPadOS 데스크톱 모드: Macintosh + 터치) */
export const isIosLike = (ua: string, touchPoints = 0): boolean => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

/** 알림이 막혔을 때 다시 허용하는 법 (기기별) */
export const deniedText = (ios: boolean): string => (ios
  ? '알림이 막혀 있어요. 아이폰 설정 앱 → 알림 → 이 앱 이름(운동 기록)에서 알림 허용을 켜 주세요'
  : '알림이 막혀 있어요. 브라우저 주소창 왼쪽 자물쇠(사이트 설정) → 알림 → 허용으로 바꿔 주세요');

/** [10초 뒤 알림 시험] 결과: 실제로 걸린 초. 15초 넘게 늦으면 이유 */
export function delayedResultText(elapsedMs: number): string {
  const n = Math.round(elapsedMs / 1000);
  return `${n}초 뒤 보냈어요${n > 15 ? ' · 화면을 잠그면 아이폰이 앱을 멈춰 늦어져요' : ''}. 배너가 보였는지, 무음 모드에서 진동이 왔는지 직접 확인해 주세요`;
}

/** 알림 본문: "다음: 바벨 컬 2세트" (너무 길면 자름). 다음이 없으면 "운동 화면으로 돌아오세요" */
export function restNotifyBody(next: string): string {
  const t = next.replace(/\s+/g, ' ').trim();
  if (!t) return '운동 화면으로 돌아오세요';
  return `다음: ${t.length > 40 ? `${t.slice(0, 39)}…` : t}`;
}

/** 설정 화면에 보일 권한 상태 글 */
export function permissionText(p: NotifyPermission, ios = true): string {
  switch (p) {
    case 'granted': return '알림 허용됨';
    case 'denied': return deniedText(ios);
    case 'default': return '켜면 알림 허용을 물어요';
    default: return '이 브라우저에서는 알림을 쓸 수 없어요 (아이폰은 홈 화면에 추가한 앱에서만, iOS 16.4 이상)';
  }
}
