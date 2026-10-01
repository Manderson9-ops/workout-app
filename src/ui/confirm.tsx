/**
 * 앱 안 확인 창 (D-038). 브라우저 기본 confirm() 대신 쓴다.
 * 이유: 기본 확인 창은 브라우저·탭 상태에 따라 화면에 안 뜨고 바로 "취소"가 될 수 있어(에이전트가 붙은 탭 등),
 * "운동 끝내기"가 아무 표시 없이 안 되는 일이 생겼다. 앱 안 창은 항상 보이고, 닫으면 취소로 돌아간다.
 * App에 <ConfirmHost />를 한 번 두고, 어디서든 `await askConfirm({...})`로 묻는다.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './components';
import { diag } from './diag';

export interface ConfirmOpts { title: string; message?: string; ok: string; cancel?: string; danger?: boolean }
interface Req extends ConfirmOpts { resolve: (v: boolean) => void }

let show: ((r: Req | null) => void) | null = null;
let current: Req | null = null;

/** 확인을 물음. 확인 = true, 취소·닫기·다른 확인 창으로 바뀜 = false */
export function askConfirm(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) { diag('error', { m: '확인 창을 띄울 곳이 없음' }); resolve(false); return; }
    current?.resolve(false); // 앞의 확인 창은 취소로 끝냄 (두 번 묻지 않게)
    current = { ...o, resolve };
    show(current);
  });
}

function answer(v: boolean) {
  const r = current; current = null;
  show?.(null);
  r?.resolve(v);
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { show = setReq; return () => { if (show === setReq) show = null; }; }, []);
  // 그린 즉시(다음 그림 전) 초점·Esc를 붙임: useEffect는 한 프레임 늦어 그사이 누른 키를 놓침
  useLayoutEffect(() => {
    if (!req) return;
    okRef.current?.focus(); // PC: Enter = 확인
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); answer(false); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [req]);
  if (!req) return null;
  return (
    <Sheet title={req.title} onClose={() => answer(false)}>
      {req.message && <p style={{ whiteSpace: 'pre-line', margin: '4px 0 12px' }}>{req.message}</p>}
      <div class="row" style={{ marginTop: '10px' }}>
        <button class="big grow" onClick={() => answer(false)}>{req.cancel ?? '취소'}</button>
        <button ref={okRef} class={`big grow ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => answer(true)}>{req.ok}</button>
      </div>
    </Sheet>
  );
}
