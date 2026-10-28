export const go = (h: string) => { location.hash = h; };

/**
 * 주소의 ?쿼리(?tab= · ?open=)를 쓰고 난 뒤 쿼리 없는 주소로 바꿔 둠 (기록 쌓지 않음 → 뒤로 가기가 고른 값을 되살림).
 * hashchange 를 일으키지 않으므로 앱의 주소 상태만 따로 알림 (뒤로 가기 판단용 이동 횟수에도 안 셈)
 */
export function dropQuery(plain: string): void {
  if (location.hash === plain) return;
  history.replaceState(history.state, '', plain);
  window.dispatchEvent(new Event('hashsync'));
}

/** 이 문서에서 앱 안 이동(해시 바뀜) 횟수. 0이면 주소로 바로 연 화면 → [뒤로]를 history.back() 하면 앱 밖으로 나갈 수 있음 */
let inAppMoves = 0;
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { inAppMoves++; });
/** [뒤로]: 앱 안에서 온 경우만 history.back(), 아니면 fallback(기본 기록 탭) */
export function backOr(fallback = '#/stats'): void {
  if (inAppMoves > 0 && history.length > 1) history.back(); else go(fallback);
}

// 루틴 편집 화면의 "뒤로" 목적지 (해시 경로엔 쿼리를 못 실어서 모듈 변수로 둠). 기본은 홈
export type EditReturn = '#/' | '#/workout';
let editReturn: EditReturn = '#/';
export const setEditReturn = (h: EditReturn) => { editReturn = h; };
export const editReturnTo = (): EditReturn => editReturn;
