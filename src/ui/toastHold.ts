import { useEffect, useRef, useState } from 'preact/hooks';
import { NO_HOLD, setHold, isHeld } from '../core/undoWindow';

/**
 * 알림 자동 닫힘 타이머 (기본 5초). 알림에 키보드 초점이 있거나 포인터가 위에 있는 동안은 멈추고,
 * 벗어나면 새 5초부터 다시 잼. key 가 바뀌면(새 알림·새 글) 5초를 새로 잼. 반환값 = 알림 요소에 펼칠 속성
 */
export function useToastHold(active: boolean, key: unknown, onExpire: () => void, ms = 5000) {
  const [hold, setH] = useState(NO_HOLD);
  const exp = useRef(onExpire);
  exp.current = onExpire;
  const held = isHeld(hold);
  useEffect(() => { if (!active || held) return; const t = setTimeout(() => exp.current(), ms); return () => clearTimeout(t); }, [active, key, held, ms]);
  useEffect(() => { if (!active) setH(NO_HOLD); }, [active]);
  return {
    onFocusCapture: () => setH((h) => setHold(h, 'focus', true)),
    onBlurCapture: () => setH((h) => setHold(h, 'focus', false)),
    onPointerEnter: () => setH((h) => setHold(h, 'pointer', true)),
    onPointerDown: () => setH((h) => setHold(h, 'pointer', true)),
    onPointerLeave: () => setH((h) => setHold(h, 'pointer', false)),
    onPointerCancel: () => setH((h) => setHold(h, 'pointer', false)),
  };
}
