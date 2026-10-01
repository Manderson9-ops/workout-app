/**
 * 앱 안 확인 창 (D-038). 브라우저 기본 confirm() 대신 쓴다.
 * 이유: 기본 확인 창은 브라우저·탭 상태에 따라 화면에 안 뜨고 바로 "취소"가 될 수 있어(에이전트가 붙은 탭 등),
 * "운동 끝내기"가 아무 표시 없이 안 되는 일이 생겼다. 앱 안 창은 항상 보이고, 닫으면 취소로 돌아간다.
 * App에 <ConfirmHost />를 한 번 두고, 어디서든 `await askConfirm({...})`로 묻는다.
 * D-039: 앱 전체에서 기본 confirm/alert/prompt를 쓰지 않음 (두 갈래는 askChoice, 알림은 showNotice). tests/noNativeDialog.test.ts가 지킴.
 * 주의: 기본 confirm과 달리 기다리는 동안 앱이 계속 돈다(동기화 등) → 확인 뒤에는 최신 상태로 다시 읽을 것.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './components';
import { diag } from './diag';

export interface ConfirmOpts { title: string; message?: string; ok: string; cancel?: string; danger?: boolean }
/** 내부 요청: alt = 세 번째 선택지(askChoice), notice = 취소 없이 확인만(showNotice) */
interface Req extends ConfirmOpts { alt?: string; notice?: boolean; resolve: (v: Answer) => void }
/** true = 확인, 'alt' = 두 번째 선택지, false = 취소·닫기·Esc, null = 다른 창이 대신함 */
type Answer = boolean | 'alt' | null;

let show: ((r: Req | null) => void) | null = null;
let current: Req | null = null;

/**
 * 확인을 물음. true = 확인, false = 취소·닫기·Esc, null = 다른 확인 창이 이 창을 대신함(사용자가 고른 것이 아님).
 * 띄울 곳(ConfirmHost)이 없으면 false + 진단 기록 (App이 항상 그리므로 실제로는 생기지 않음).
 */
export function askConfirm(o: ConfirmOpts): Promise<boolean | null> {
  return open(o) as Promise<boolean | null>;
}

/**
 * 두 가지 중 고르기 + 취소 (예: "서버까지 바꾸기" / "이 기기만"). 'ok' | 'alt' | false(취소·닫기·Esc) | null(대신됨).
 * 기본 confirm의 [확인]/[취소]에 서로 다른 일을 맡기던 곳을 대신함: 닫기·Esc가 두 번째 일을 하지 않게.
 */
export async function askChoice(o: ConfirmOpts & { alt: string }): Promise<'ok' | 'alt' | false | null> {
  const v = await open(o);
  return v === true ? 'ok' : v;
}

/** 알림 (기본 alert 대신). 확인 버튼만 있고, 닫으면 끝남 */
export async function showNotice(title: string, message?: string): Promise<void> {
  await open({ title, message, ok: '확인', notice: true });
}

function open(o: Omit<Req, 'resolve'>): Promise<Answer> {
  return new Promise((resolve) => {
    if (!show) { diag('error', { m: '확인 창을 띄울 곳이 없음' }); resolve(false); return; }
    current?.resolve(null);
    current = { ...o, resolve };
    show(current);
  });
}

function answer(v: Answer) {
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
  // 화면이 바뀌면(뒤로 가기·스와이프·링크) 열린 확인을 닫음: 떠난 화면의 일을 나중에 하지 않게.
  // 기본 confirm은 페이지를 멈춰 이런 일이 없었지만 앱 안 창은 화면 전환 뒤에도 남을 수 있음 (D-039 검토)
  useEffect(() => {
    const on = () => { if (current) answer(null); }; // null = 사용자가 고른 것이 아님 (취소 때 하는 일도 하지 않음)
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // 그린 즉시(다음 그림 전) 초점·키를 붙임: useEffect는 한 프레임 늦어 그사이 누른 키를 놓침
  useLayoutEffect(() => {
    if (!req) return;
    if (!backTo.current) backTo.current = document.activeElement as HTMLElement | null;
    // 위험한 확인(끝내기 등)은 "취소"에 초점: PC에서 Enter 한 번으로 끝나지 않게. 나머지는 확인에
    (req.danger && !req.notice ? cancelRef : okRef).current?.focus();
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
      {req.alt ? (
        // 선택지가 셋이면 세로로 (폰에서 글자가 잘리지 않게). 취소는 맨 아래
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          <button ref={okRef} class={`big ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => answer(true)}>{req.ok}</button>
          <button class="big" onClick={() => answer('alt')}>{req.alt}</button>
          <button ref={cancelRef} class="big" onClick={() => answer(false)}>{req.cancel ?? '취소'}</button>
        </div>
      ) : (
        <div class="row" style={{ marginTop: '10px' }}>
          {!req.notice && <button ref={cancelRef} class="big grow" onClick={() => answer(false)}>{req.cancel ?? '취소'}</button>}
          <button ref={okRef} class={`big grow ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => answer(true)}>{req.ok}</button>
        </div>
      )}
    </Sheet>
  );
}
