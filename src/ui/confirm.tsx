/**
 * 앱 안 확인 창 (D-038). 브라우저 기본 confirm() 대신 쓴다.
 * 이유: 기본 확인 창은 브라우저·탭 상태에 따라 화면에 안 뜨고 바로 "취소"가 될 수 있어(에이전트가 붙은 탭 등),
 * "운동 끝내기"가 아무 표시 없이 안 되는 일이 생겼다. 앱 안 창은 항상 보이고, 닫으면 취소로 돌아간다.
 * App에 <ConfirmHost />를 한 번 두고, 어디서든 `await askConfirm({...})`로 묻는다.
 * 주의: 기본 confirm과 달리 기다리는 동안 앱이 계속 돈다(동기화 등) → 확인 뒤에는 최신 상태로 다시 읽을 것.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './components';
import { diag } from './diag';

export interface ConfirmOpts { title: string; message?: string; ok: string; cancel?: string; danger?: boolean }
interface Req extends ConfirmOpts { resolve: (v: boolean | null) => void }

let show: ((r: Req | null) => void) | null = null;
let current: Req | null = null;

/**
 * 확인을 물음. true = 확인, false = 취소·닫기·Esc, null = 다른 확인 창이 이 창을 대신함(사용자가 고른 것이 아님).
 * 띄울 곳(ConfirmHost)이 없으면 false + 진단 기록 (App이 항상 그리므로 실제로는 생기지 않음).
 */
export function askConfirm(o: ConfirmOpts): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (!show) { diag('error', { m: '확인 창을 띄울 곳이 없음' }); resolve(false); return; }
    current?.resolve(null);
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backTo = useRef<HTMLElement | null>(null);
  useEffect(() => { show = setReq; return () => { if (show === setReq) show = null; }; }, []);
  // 그린 즉시(다음 그림 전) 초점·키를 붙임: useEffect는 한 프레임 늦어 그사이 누른 키를 놓침
  useLayoutEffect(() => {
    if (!req) return;
    if (!backTo.current) backTo.current = document.activeElement as HTMLElement | null;
    // 위험한 확인(끝내기 등)은 "취소"에 초점: PC에서 Enter 한 번으로 끝나지 않게. 나머지는 확인에
    (req.danger ? cancelRef : okRef).current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); answer(false); return; }
      if (e.key === 'Tab') { // 초점을 확인 창 안에 가둠
        const els = [...document.querySelectorAll<HTMLElement>('.sheet[aria-modal="true"] button')];
        if (!els.length) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
        e.preventDefault(); els[n]!.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [req]);
  // 닫히면 연 버튼으로 초점을 돌려줌 (그 버튼이 아직 화면에 있을 때)
  useLayoutEffect(() => {
    if (req || !backTo.current) return;
    const el = backTo.current; backTo.current = null;
    if (el.isConnected) el.focus();
  }, [req]);
  if (!req) return null;
  return (
    <Sheet title={req.title} onClose={() => answer(false)} modal>
      {req.message && <p style={{ whiteSpace: 'pre-line', margin: '4px 0 12px' }}>{req.message}</p>}
      <div class="row" style={{ marginTop: '10px' }}>
        <button ref={cancelRef} class="big grow" onClick={() => answer(false)}>{req.cancel ?? '취소'}</button>
        <button ref={okRef} class={`big grow ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => answer(true)}>{req.ok}</button>
      </div>
    </Sheet>
  );
}
