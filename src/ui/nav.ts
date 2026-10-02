export const go = (h: string) => { location.hash = h; };

// 루틴 편집 화면의 "뒤로" 목적지 (해시 경로엔 쿼리를 못 실어서 모듈 변수로 둠). 기본은 홈
export type EditReturn = '#/' | '#/workout';
let editReturn: EditReturn = '#/';
export const setEditReturn = (h: EditReturn) => { editReturn = h; };
export const editReturnTo = (): EditReturn => editReturn;
