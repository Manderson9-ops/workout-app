/**
 * D-043: 인체 그림으로 부위 고르기 (앞·뒤). 그림은 눈으로 고르는 보조 수단이고,
 * 키보드·화면 읽기 프로그램은 아래 부위 버튼(같은 동작)을 쓴다. 그래서 그림은 aria-hidden.
 */
import type { Part } from '../core/types';
import type { Priority } from '../core/planner';

type Shape = { part: Part; d: string; hit: string };
// viewBox 0 0 100 200. 좌우 대칭 도형은 왼쪽·오른쪽을 함께 적음
const sym = (x: number, y: number, w: number, h: number, r = 4) => [rect(x, y, w, h, r), rect(100 - x - w, y, w, h, r)].join(' ');
function rect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r},${y} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - 2 * r} a${r},${r} 0 0 1 -${r},-${r} v-${h - 2 * r} a${r},${r} 0 0 1 ${r},-${r} z`;
}
const box = (x: number, y: number, w: number, h: number) => `M${x},${y} h${w} v${h} h-${w} z`;
const symBox = (x: number, y: number, w: number, h: number) => [box(x, y, w, h), box(100 - x - w, y, w, h)].join(' ');
// 보이는 모양(d)과 누르는 영역(hit, 투명). 누르는 영역은 서로 겹치지 않고 더 크게 (폰 폭 약 175px에서 팔 44px 안팎)
const SHOULDER: Shape = { part: '어깨', d: sym(19, 32, 18, 17, 8), hit: symBox(13, 26, 24, 22) };
const ARM = (part: Part): Shape => ({ part, d: sym(15, 50, 13, 28, 6), hit: symBox(4, 48, 25, 30) });
const FOREARM: Shape = { part: '전완·악력', d: sym(10, 80, 13, 32, 6), hit: symBox(0, 78, 25, 38) };
const FRONT: Shape[] = [
  SHOULDER,
  { part: '가슴', d: rect(37, 36, 26, 22, 5), hit: box(37, 34, 26, 25) },
  ARM('이두'),
  FOREARM,
  { part: '코어', d: rect(39, 60, 22, 34, 5), hit: box(37, 59, 26, 37) },
  { part: '하체', d: [sym(34, 98, 15, 54, 7), sym(36, 156, 12, 36, 6)].join(' '), hit: box(30, 96, 40, 100) },
];
const BACK: Shape[] = [
  SHOULDER,
  { part: '등', d: rect(37, 36, 26, 54, 6), hit: box(37, 34, 26, 58) },
  ARM('삼두'),
  FOREARM,
  { part: '하체', d: [rect(35, 92, 30, 18, 8), sym(34, 112, 15, 40, 7), sym(36, 156, 12, 36, 6)].join(' '), hit: box(30, 92, 40, 104) },
];

function Figure({ label, shapes, sel, onToggle }: { label: string; shapes: Shape[]; sel: Partial<Record<Part, Priority>>; onToggle: (p: Part) => void }) {
  return (
    <figure class="bodymap-fig">
      <svg viewBox="0 0 100 200" aria-hidden="true" focusable="false">
        <circle cx="50" cy="16" r="11" class="bm-head" />
        <rect x="45" y="26" width="10" height="9" class="bm-head" />
        {shapes.map((s) => <path key={'v' + s.part} d={s.d} data-vis={s.part} class={`bm-part ${sel[s.part] ? 'p-' + sel[s.part] : ''}`} />)}
        {shapes.map((s) => (
          <path key={'h' + s.part} d={s.hit} data-part={s.part} class="bm-hit" onClick={() => onToggle(s.part)}>
            <title>{s.part}{sel[s.part] ? ' (선택됨)' : ''}</title>
          </path>
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
