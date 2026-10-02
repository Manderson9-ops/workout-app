/**
 * D-047: 부위를 누르면 뜨는 우선순위 창. 처음 고른 부위는 '높음'으로 이미 골라져 있고, 여기서 높음·보통·낮음을 고르거나 뺀다.
 * 고르는 즉시 반영(창을 닫아도 그대로). 우선순위의 뜻은 플랜 생성 규칙(BLUEPRINT 5.7)을 짧게 풀어 씀.
 * 접근성: 열리면 고른 단계에 초점, 라디오는 ↑↓←→로 이동·선택, Tab은 창 안에서만, Esc·완료로 닫으면 연 버튼으로 초점 복귀.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Part } from '../core/types';
import type { Priority } from '../core/planner';
import { Sheet } from './components';

const OPTIONS: { v: Priority; label: string; desc: string }[] = [
  { v: 'high', label: '높음', desc: '먼저 하고, 운동 개수를 가장 많이 (기본)' },
  { v: 'normal', label: '보통', desc: '높음 다음 순서' },
  { v: 'low', label: '낮음', desc: '시간이 모자라면 이 부위부터 세트·운동을 줄임' },
];
/** 그 부위에 들어가는 주요 근육 (종목 데이터의 근육 그룹 이름) */
export const PART_MUSCLES: Record<Part, string> = {
  가슴: '대흉근', 등: '광배근 · 승모근·능형근 · 척추기립근', 어깨: '삼각근 (전면·측면·후면)', 이두: '이두 · 상완근',
  삼두: '삼두 (장두·외측두·내측두)', '전완·악력': '전완 굽힘·폄 근육 · 악력', 하체: '대퇴사두 · 햄스트링 · 둔근 · 종아리 · 내전근', 코어: '복직근 · 복사근',
};

export function PartSheet({ part, pr, onPick, onRemove, onClose }: { part: Part; pr?: Priority; onPick: (p: Priority) => void; onRemove: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const backTo = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 그린 즉시 초점·키 (useEffect는 한 프레임 늦음, D-038 교훈)
  useLayoutEffect(() => {
    backTo.current = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key === 'Tab') {
        const els = [...document.querySelectorAll<HTMLElement>('.sheet[aria-modal="true"] button:not([tabindex="-1"])')];
        if (!els.length) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
        e.preventDefault(); els[n]!.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      const el = backTo.current;
      if (el && el.isConnected) el.focus();
    };
  }, []);
  const arrow = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + OPTIONS.length) % OPTIONS.length;
    onPick(OPTIONS[n]!.v);
    box.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <Sheet title={`${part} 우선순위`} onClose={onClose} modal>
      <p class="sub small">{PART_MUSCLES[part]}</p>
      <div role="radiogroup" aria-label={`${part} 우선순위`} class="prio-options" ref={box}>
        {OPTIONS.map((o, i) => (
          <button key={o.v} role="radio" aria-checked={pr === o.v} tabIndex={pr === o.v ? 0 : -1} aria-label={`${o.label}: ${o.desc}`}
            class={`prio-opt ${pr === o.v ? 'on p-' + o.v : ''}`} onClick={() => onPick(o.v)} onKeyDown={(e) => arrow(e as unknown as KeyboardEvent, i)}>
            <span class="prio-opt-label"><span aria-hidden="true">{pr === o.v ? '● ' : '○ '}</span>{o.label}</span>
            <span class="sub small" aria-hidden="true">{o.desc}</span>
          </button>
        ))}
      </div>
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="danger grow" onClick={onRemove}>이 부위 빼기</button>
        <button class="primary grow" onClick={onClose}>완료</button>
      </div>
    </Sheet>
  );
}
