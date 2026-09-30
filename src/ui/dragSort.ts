/**
 * 끌어서 순서 바꾸기 (D-037). 카드 왼쪽 손잡이(≡)를 누르고 끌어 다른 카드 위에 놓으면 그 자리로 옮긴다.
 * - Pointer Events 하나로 아이폰 터치·PC 마우스·펜 모두 처리 (HTML5 drag&drop은 iOS 터치에서 안 됨).
 * - 손잡이에만 touch-action:none → 카드 나머지 부분은 평소처럼 스크롤.
 * - 6px 넘게 움직여야 끌기 시작 (손잡이를 톡 누르는 것만으로는 아무 일도 없음).
 * - 화면 위·아래 끝(아래는 타이머·메뉴 위)에 가까우면 자동 스크롤.
 * - 키보드: 손잡이에 초점을 두고 ↑/↓ = 한 칸, Home/End = 맨 위/맨 아래. 끝나면 옮긴 카드의 손잡이에 초점, aria-live로 읽음.
 * 카드 요소에는 itemAttrs(i)를, 손잡이 버튼에는 handleProps(i)를 붙인다. 같은 화면에 목록이 하나뿐이라는 전제.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

interface Live {
  from: number; over: number; pid: number; started: boolean;
  handle: HTMLElement; el: HTMLElement;
  x0: number; y0: number; sx0: number; sy0: number; px: number; py: number;
  rects: { l: number; t: number; r: number; b: number }[]; // 문서 좌표 (끄는 동안 배치는 안 바뀜)
  grid: boolean; raf: number; off?: () => void;
}

const START_PX = 6;
const EDGE_PX = 70;
const MAX_SPEED = 16;

/** 화면 아래를 가리는 고정 요소(휴식 타이머·아래 메뉴) 윗선. PC 왼쪽 메뉴는 제외. 아이폰 키보드가 열려 있으면 보이는 영역(visualViewport) 기준 */
function bottomLimit(): number {
  const vv = window.visualViewport;
  let b = vv ? Math.min(window.innerHeight, vv.height + vv.offsetTop) : window.innerHeight;
  for (const e of document.querySelectorAll<HTMLElement>('.timer, .nav')) {
    const r = e.getBoundingClientRect();
    if (r.height > 0 && r.top > window.innerHeight / 2 && r.width > window.innerWidth / 2) b = Math.min(b, r.top);
  }
  return b;
}

/** 점(문서 좌표)에서 가장 가까운 카드. 카드 안이면 거리 0 */
export function nearestIndex(rects: Live['rects'], x: number, y: number): number {
  let best = -1, bd = Infinity;
  rects.forEach((r, i) => {
    const dx = x < r.l ? r.l - x : x > r.r ? x - r.r : 0;
    const dy = y < r.t ? r.t - y : y > r.b ? y - r.b : 0;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export function useDragSort(count: number, onMove: (from: number, to: number) => void, nameOf: (i: number) => string) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [msg, setMsg] = useState('');
  const live = useRef<Live | null>(null);
  const cb = useRef({ onMove, nameOf, count });
  cb.current = { onMove, nameOf, count };
  const focusTo = useRef<number | null>(null);

  // 키보드로 옮긴 뒤: 옮긴 카드의 손잡이에 초점 (카드가 DOM에서 옮겨지거나 다시 그려지면 초점이 풀림)
  useEffect(() => {
    if (focusTo.current === null) return;
    const i = focusTo.current; focusTo.current = null;
    document.querySelector<HTMLElement>(`[data-sort-i="${i}"] [data-sort-handle]`)?.focus();
  });
  // 화면을 떠나면 끌기 정리
  useEffect(() => () => { const L = live.current; if (L) { cancelAnimationFrame(L.raf); reset(L); } }, []);

  // 같은 문장이 이어지면 화면 읽기가 다시 안 읽음 → 보이지 않는 글자를 번갈아 붙임
  const flip = useRef(false);
  const announce = (from: number, to: number) => { flip.current = !flip.current; setMsg(`${cb.current.nameOf(from)}: ${to + 1}번째로 옮김 (전체 ${cb.current.count}개)${flip.current ? '\u200b' : ''}`); };
  const commit = (from: number, to: number) => {
    if (from === to || to < 0 || to >= cb.current.count) return false;
    announce(from, to);
    cb.current.onMove(from, to);
    return true;
  };

  function reset(L: Live) {
    L.el.style.transform = ''; L.el.classList.remove('dragging');
    document.documentElement.classList.remove('sorting');
  }

  function place(L: Live) {
    const dx = L.grid ? L.px - L.x0 + (window.scrollX - L.sx0) : 0;
    const dy = L.py - L.y0 + (window.scrollY - L.sy0);
    L.el.style.transform = `translate(${dx}px, ${dy}px)`;
    const over = nearestIndex(L.rects, L.px + window.scrollX, L.py + window.scrollY);
    if (over >= 0 && over !== L.over) { L.over = over; setDrag({ from: L.from, over }); }
  }

  function tick() {
    const L = live.current;
    if (!L || !L.started) return;
    if (!L.handle.isConnected) { end(false); return; } // 끄는 도중 카드가 사라짐 (다른 기기가 운동을 가져감 등)
    const top = EDGE_PX, bottom = bottomLimit() - EDGE_PX;
    let v = 0;
    if (L.py < top) v = -Math.ceil(MAX_SPEED * Math.min(1, (top - L.py) / EDGE_PX));
    else if (L.py > bottom) v = Math.ceil(MAX_SPEED * Math.min(1, (L.py - bottom) / EDGE_PX));
    if (v) { const before = window.scrollY; window.scrollBy(0, v); if (window.scrollY !== before) place(L); }
    L.raf = requestAnimationFrame(tick);
  }

  function start(L: Live) {
    const els = [...document.querySelectorAll<HTMLElement>('[data-sort-i]')].sort((a, b) => Number(a.dataset.sortI) - Number(b.dataset.sortI));
    L.rects = els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left + window.scrollX, t: r.top + window.scrollY, r: r.right + window.scrollX, b: r.bottom + window.scrollY }; });
    L.grid = L.rects.some((r, i) => L.rects.some((q, j) => j !== i && Math.abs(q.t - r.t) < 4));
    L.started = true;
    (document.activeElement as HTMLElement | null)?.blur?.(); // 입력 중이면 키보드 닫기 (아이폰은 버튼을 눌러도 초점이 안 빠짐)
    L.el.classList.add('dragging');
    document.documentElement.classList.add('sorting');
    setDrag({ from: L.from, over: L.from });
    L.raf = requestAnimationFrame(tick);
  }

  function end(commitIt: boolean) {
    const L = live.current;
    if (!L) return;
    live.current = null;
    cancelAnimationFrame(L.raf);
    L.off?.();
    try { if (L.handle.hasPointerCapture(L.pid)) L.handle.releasePointerCapture(L.pid); } catch { /* 이미 풀림 */ }
    reset(L);
    setDrag(null);
    if (commitIt && L.started) commit(L.from, L.over);
  }

  const handleProps = (i: number): JSX.HTMLAttributes<HTMLButtonElement> & Record<string, unknown> => ({
    'data-sort-handle': '',
    type: 'button',
    class: 'ghost drag-handle',
    title: '끌어서 순서 바꾸기 (키보드: ↑↓)',
    'aria-label': `${nameOf(i)} 순서 옮기기, 지금 ${i + 1}번째 (끌거나 ↑↓ 키)`,
    onClick: (e: MouseEvent) => { e.stopPropagation(); },
    onPointerDown: (e: PointerEvent) => {
      if (count < 2 || live.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      const el = handle.closest<HTMLElement>('[data-sort-i]');
      if (!el) return;
      e.preventDefault(); // 글자 선택·길게 누르기 메뉴 막기
      try { handle.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      live.current = { from: i, over: i, pid: e.pointerId, started: false, handle, el, x0: e.clientX, y0: e.clientY, sx0: window.scrollX, sy0: window.scrollY, px: e.clientX, py: e.clientY, rects: [], grid: false, raf: 0 };
      // 손잡이가 DOM에서 빠지면(끌기 시작 전이라도) 손잡이 이벤트가 안 옴 → 문서에서도 끝을 받음. 빠진 손잡이면 옮기지 않음
      const L = live.current;
      const up = (ev: PointerEvent) => { if (live.current === L && ev.pointerId === L.pid) end(ev.type === 'pointerup' && L.handle.isConnected); };
      document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
      L.off = () => { document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); };
    },
    onPointerMove: (e: PointerEvent) => {
      const L = live.current;
      if (!L || e.pointerId !== L.pid) return;
      L.px = e.clientX; L.py = e.clientY;
      if (!L.started) { if (Math.hypot(L.px - L.x0, L.py - L.y0) < START_PX) return; start(L); }
      e.preventDefault();
      place(L);
    },
    onPointerUp: (e: PointerEvent) => { if (live.current && e.pointerId === live.current.pid) end(true); },
    onPointerCancel: (e: PointerEvent) => { if (live.current && e.pointerId === live.current.pid) end(false); },
    // 손잡이가 다시 그려져 포인터를 놓치면 옮기지 않고 취소 (번호가 바뀜 수 있어 안전하게)
    onLostPointerCapture: (e: PointerEvent) => { if (live.current && e.pointerId === live.current.pid) end(false); },
    onKeyDown: (e: KeyboardEvent) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null;
      if (to === null) return;
      e.preventDefault(); e.stopPropagation();
      if (commit(i, to)) focusTo.current = to;
    },
  });

  const itemAttrs = (i: number) => ({
    'data-sort-i': String(i),
    ...(drag && drag.over === i && drag.from !== i ? { 'data-drop': drag.from < i ? 'after' : 'before', ...(live.current?.grid ? { 'data-drop-grid': '' } : {}) } : {}),
  });

  return { drag, msg, handleProps, itemAttrs };
}
