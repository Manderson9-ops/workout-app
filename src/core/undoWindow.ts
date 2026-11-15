/**
 * D-080: 바로 교체 알림의 되돌리기 창(5초) 순수 논리.
 * 같은 루틴에서 알림이 떠 있는 동안 또 바꾸면 처음 바꾸기 전 모습을 그대로 쥐고 횟수만 센다.
 */
export interface SwapWindow<T> {
  rid: string;
  /** 처음 바꾸기 전 루틴 (되돌리면 이 객체를 그대로 다시 저장 = 수정 시각까지 원래대로) */
  snap: T;
  count: number;
  /** 처음 바꾼 칸의 원래 운동 이름 (되돌린 뒤 초점이 갈 줄) */
  firstName: string;
  text: string;
}

/** prev = 지금 떠 있는 창. 같은 루틴이면 이어 세고, 다른 루틴이면 새 창 (이전 알림은 되돌리기 없이 닫힘) */
export function nextSwapWindow<T>(prev: SwapWindow<T> | null, rid: string, before: T, oldName: string, newName: string): SwapWindow<T> {
  const same = prev !== null && prev.rid === rid;
  const count = same ? prev.count + 1 : 1;
  return {
    rid,
    snap: same ? prev.snap : before,
    count,
    firstName: same ? prev.firstName : oldName,
    text: count >= 2 ? `${count}개 바꿨어요` : `${oldName} → ${newName}: 바꿨어요`,
  };
}

/** 알림 타이머를 멈추는 이유: 키보드 초점이 알림 안에 있음 / 포인터가 알림 위에 있거나 누르는 중 (WCAG 2.2.1) */
export interface Hold { focus: boolean; pointer: boolean }
export const NO_HOLD: Hold = { focus: false, pointer: false };
export const setHold = (h: Hold, kind: keyof Hold, on: boolean): Hold => (h[kind] === on ? h : { ...h, [kind]: on });
export const isHeld = (h: Hold): boolean => h.focus || h.pointer;
