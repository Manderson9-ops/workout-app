export const go = (h: string) => { location.hash = h; };

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
