/**
 * D-056 실험: 휴식 끝을 시스템 알림(Notification)으로 (서버 없음, 앱이 떠 있을 때).
 * 알림은 아이폰 무음 모드에서도 시스템 진동이 날 수 있고 음악을 멈추지 않음 → 될지는 실기기 확인 항목 (실험).
 * 순수 함수만 (화면·브라우저 쪽은 src/ui/notify.ts)
 */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** 휴식 끝 알림을 지금 보낼지: 켜 둠 + 허용됨 + 이 휴식에 아직 안 보냄 + 늦지 않음(끝난 지 graceMs 이내) */
export function shouldNotify(x: { on: boolean; permission: NotifyPermission; endsAt: number; now: number; sentFor: number | null; graceMs?: number }): boolean {
  if (!x.on || x.permission !== 'granted') return false;
  if (x.sentFor === x.endsAt) return false;
  return x.now - x.endsAt <= (x.graceMs ?? 5000);
}

/** 알림 본문: "다음: 바벨 컬 2세트" (너무 길면 자름). 다음이 없으면 "운동 화면으로 돌아오세요" */
export function restNotifyBody(next: string): string {
  const t = next.replace(/\s+/g, ' ').trim();
  if (!t) return '운동 화면으로 돌아오세요';
  return `다음: ${t.length > 40 ? `${t.slice(0, 39)}…` : t}`;
}

/** 설정 화면에 보일 권한 상태 글 */
export function permissionText(p: NotifyPermission): string {
  switch (p) {
    case 'granted': return '알림 허용됨';
    case 'denied': return '알림이 막혀 있어요. 아이폰 설정 앱 → 알림 → 이 앱에서 허용으로 바꿔 주세요';
    case 'default': return '켜면 알림 허용을 물어요';
    default: return '이 브라우저에서는 알림을 쓸 수 없어요 (아이폰은 홈 화면에 추가한 앱에서만, iOS 16.4 이상)';
  }
}
