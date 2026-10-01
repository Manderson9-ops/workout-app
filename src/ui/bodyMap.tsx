/**
 * D-043: 인체 그림으로 부위 고르기 (앞·뒤). 그림은 눈으로 고르는 보조 수단이고,
 * 키보드·화면 읽기 프로그램은 아래 부위 버튼(같은 동작)을 쓴다. 그래서 그림은 aria-hidden.
 */
import type { Part } from '../core/types';
import type { Priority } from '../core/planner';

type Shape = { part: Part; d: string };
// viewBox 0 0 100 200. 좌우 대칭 도형은 왼쪽·오른쪽을 함께 적음
const sym = (x: number, y: number, w: number, h: number, r = 4) => [rect(x, y, w, h, r), rect(100 - x - w, y, w, h, r)].join(' ');
function rect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r},${y} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - 2 * r} a${r},${r} 0 0 1 -${r},-${r} v-${h - 2 * r} a${r},${r} 0 0 1 ${r},-${r} z`;
}
const FRONT: Shape[] = [
  { part: '어깨', d: sym(22, 34, 15, 14, 7) },
  { part: '가슴', d: rect(37, 36, 26, 22, 5) },
  { part: '이두', d: sym(15, 50, 13, 28, 6) },
  { part: '전완·악력', d: sym(10, 80, 13, 32, 6) },
  { part: '코어', d: rect(39, 60, 22, 34, 5) },
  { part: '하체', d: [sym(34, 98, 15, 54, 7), sym(36, 156, 12, 36, 6)].join(' ') },
];
const BACK: Shape[] = [
  { part: '어깨', d: sym(22, 34, 15, 14, 7) },
  { part: '등', d: rect(37, 36, 26, 54, 6) },
  { part: '삼두', d: sym(15, 50, 13, 28, 6) },
  { part: '전완·악력', d: sym(10, 80, 13, 32, 6) },
  { part: '하체', d: [rect(35, 92, 30, 18, 8), sym(34, 112, 15, 40, 7), sym(36, 156, 12, 36, 6)].join(' ') },
];

function Figure({ label, shapes, sel, onToggle }: { label: string; shapes: Shape[]; sel: Partial<Record<Part, Priority>>; onToggle: (p: Part) => void }) {
  return (
    <figure class="bodymap-fig">
      <svg viewBox="0 0 100 200" aria-hidden="true" focusable="false">
        <circle cx="50" cy="16" r="11" class="bm-head" />
        <rect x="45" y="26" width="10" height="9" class="bm-head" />
        {shapes.map((s) => (
          <path key={s.part} d={s.d} data-part={s.part} class={`bm-part ${sel[s.part] ? 'p-' + sel[s.part] : ''}`}
            onClick={() => onToggle(s.part)} />
        ))}
      </svg>
      <figcaption class="sub small">{label}</figcaption>
    </figure>
  );
}

export function BodyMap({ sel, onToggle }: { sel: Partial<Record<Part, Priority>>; onToggle: (p: Part) => void }) {
  return (
    <div class="bodymap" data-testid="bodymap">
      <Figure label="앞" shapes={FRONT} sel={sel} onToggle={onToggle} />
      <Figure label="뒤" shapes={BACK} sel={sel} onToggle={onToggle} />
    </div>
  );
}
