/**
 * D-047: 인체 근육 그림으로 부위 고르기. 그림 데이터는 react-native-body-highlighter(MIT, bodyMapData.ts).
 * 근육 모양(보이는 것)과 누르는 영역(투명 사각형, 근육보다 크게)을 나눔: 폰에서 손가락으로 누르기 쉽게.
 * 그림은 aria-hidden. 키보드·화면 읽기는 아래 부위 버튼(같은 동작)을 쓴다.
 */
import { useState } from 'preact/hooks';
import type { Part } from '../core/types';
import type { Priority } from '../core/planner';
import { BODY_FRONT, BODY_BACK, OUTLINE_FRONT, OUTLINE_BACK } from './bodyMapData';
import type { BodyShape } from './bodyMapData';

export type Side = 'front' | 'back';
/** 그림 조각(slug) → 앱 부위. 없는 조각(머리·손·발·무릎 등)은 장식 */
export const SLUG_PART: Record<Side, Record<string, Part>> = {
  // 앞에서 보이는 삼두·승모근은 가늘어서 손가락으로 정확히 누르기 어렵고(아이폰은 가까운 큰 요소로 탭을 보정) 이두·어깨로 눌림 → 장식으로 두고 뒤 그림에서 고름
  front: { chest: '가슴', abs: '코어', obliques: '코어', biceps: '이두', deltoids: '어깨', forearm: '전완·악력',
    quadriceps: '하체', adductors: '하체', tibialis: '하체', calves: '하체' },
  back: { trapezius: '등', 'upper-back': '등', 'lower-back': '등', deltoids: '어깨', triceps: '삼두', forearm: '전완·악력',
    gluteal: '하체', adductors: '하체', hamstring: '하체', calves: '하체' },
};

type Box = [number, number, number, number]; // x1, y1, x2, y2 (그림 좌표)
const mirror = (b: Box, c: number): Box => [2 * c - b[2], b[1], 2 * c - b[0], b[3]];
const pair = (b: Box, c: number): Box[] => [b, mirror(b, c)];
/** 누르는 영역: 서로 겹치지 않게, 근육보다 넉넉히 */
export const HITS: Record<Side, [Part, Box[]][]> = {
  front: [
    ['어깨', pair([140, 280, 292, 414], 362)],
    ['가슴', [[292, 300, 432, 435]]],
    ['이두', pair([105, 414, 270, 548], 362)],
    ['전완·악력', pair([40, 548, 270, 705], 362)],
    ['코어', [[270, 435, 454, 660]]],
    ['하체', [[225, 660, 499, 1300]]],
  ],
  back: [
    ['어깨', pair([862, 280, 1003, 414], 1086)],
    ['등', [[1003, 270, 1169, 630]]],
    ['삼두', pair([830, 414, 1003, 548], 1086)],
    ['전완·악력', pair([760, 548, 1003, 705], 1086)],
    ['하체', [[945, 630, 1227, 1330]]],
  ],
};
/** 화면 좌표의 부위: 위에서부터 근육(data-vis) → 누르는 영역(data-part) */
export function partAt(x: number, y: number): Part | null {
  const at = (px: number, py: number): Part | null => {
    for (const el of document.elementsFromPoint(px, py)) {
      const p = el.getAttribute('data-vis') ?? el.getAttribute('data-part');
      if (p) return p as Part;
    }
    return null;
  };
  const hit = at(x, y);
  if (hit) return hit;
  // 근육 사이 틈(1~2px)을 눌렀으면 손가락 크기만큼 주변에서 가장 가까운 부위
  // 같은 거리에서는 8방향 중 가장 많이 걸린 부위 (한 방향으로 치우치지 않게), 동률이면 먼저 나온 것
  for (const r of [3, 6, 10, 14]) {
    const votes = new Map<Part, number>();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const p = at(x + r * Math.cos(a), y + r * Math.sin(a));
      if (p) votes.set(p, (votes.get(p) ?? 0) + 1);
    }
    if (votes.size) return [...votes.entries()].sort((m, n) => n[1] - m[1])[0]![0];
  }
  return null;
}
const VIEW: Record<Side, string> = { front: '0 80 724 1290', back: '724 80 724 1290' };

/** 세트 수 → 색 단계 (D-054): 0 없음, 1~4 연함, 5~9 보통, 10+ 진함 */
export function heatBucket(n: number): 0 | 1 | 2 | 3 { return n >= 10 ? 3 : n >= 5 ? 2 : n >= 1 ? 1 : 0; }

function Figure({ side, sel, onPart, heat }: { side: Side; sel: Partial<Record<Part, Priority>>; onPart?: (p: Part) => void; heat?: Record<Part, number> }) {
  const shapes: BodyShape[] = side === 'front' ? BODY_FRONT : BODY_BACK;
  const map = SLUG_PART[side];
  return (
    // 누른 점 아래 요소를 직접 찾음: 아이폰(WebKit)은 작은 모양을 눌러도 클릭 대상을 svg 자체로 주는 경우가 있어 요소별 onClick에 기대지 않음
    <svg viewBox={VIEW[side]} class="bodymap-svg" aria-hidden="true" focusable="false" data-side={side}
      onClick={onPart ? (e) => { const p = partAt(e.clientX, e.clientY); if (p) onPart(p); } : undefined}>
      <path d={side === 'front' ? OUTLINE_FRONT : OUTLINE_BACK} class="bm-outline" />
      {/* 누르는 영역(투명)은 근육 아래: 근육을 누르면 그 근육의 부위, 근육 사이 빈 곳을 누르면 영역의 부위 */}
      {!heat && HITS[side].map(([part, boxes]) => boxes.map((b, k) => (
        <rect key={part + k} x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} class="bm-hit" data-part={part} />
      )))}
      {shapes.map((s) => {
        const part = map[s.slug];
        const pr = part ? sel[part] : undefined;
        return s.d.map((d, k) => (
          <path key={s.slug + k} d={d} data-vis={part} class={part ? `bm-muscle${heat ? ' h-' + heatBucket(heat[part] ?? 0) : pr ? ' p-' + pr : ''}` : 'bm-deco'} />
        ));
      })}
    </svg>
  );
}

export function BodyMap({ sel, onPart }: { sel: Partial<Record<Part, Priority>>; onPart: (p: Part) => void }) {
  const [side, setSide] = useState<Side>('front');
  return (
    <div class="bodymap" data-testid="bodymap">
      <div class="seg" role="group" aria-label="그림 방향">
        {(['front', 'back'] as Side[]).map((x) => (
          <button key={x} class={side === x ? 'on' : ''} aria-pressed={side === x} onClick={() => setSide(x)}>{x === 'front' ? '앞' : '뒤'}</button>
        ))}
      </div>
      <Figure side={side} sel={sel} onPart={onPart} />
      <div class="bm-legend sub small" aria-hidden="true">
        <span><i class="lg-none" />안 고름</span>
        <span><i class="lg-low" />낮음</span>
        <span><i class="lg-normal" />보통</span>
        <span><i class="lg-high" />높음</span>
      </div>
      <p class="sub small bm-hint">{side === 'front' ? '어깨·가슴·이두·전완·코어·하체' : '어깨·등·삼두·전완·하체'}를 눌러 고르세요</p>
    </div>
  );
}

/** 읽기 전용 열 지도 (D-054): 부위별 세트 수를 색 단계로. 앞/뒤 전환만 누를 수 있음 */
export function BodyHeat({ sets }: { sets: Record<Part, number> }) {
  const [side, setSide] = useState<Side>('front');
  const summary = (Object.keys(sets) as Part[]).filter((p) => sets[p] > 0).map((p) => `${p} ${sets[p]}세트`).join(', ') || '세트 없음';
  return (
    <div class="bodymap bodyheat" data-testid="bodyheat" role="group" aria-label={`부위별 세트 열 지도: ${summary}`}>
      <div class="seg" role="group" aria-label="그림 방향">
        {(['front', 'back'] as Side[]).map((x) => (
          <button key={x} class={side === x ? 'on' : ''} aria-pressed={side === x} onClick={() => setSide(x)}>{x === 'front' ? '앞' : '뒤'}</button>
        ))}
      </div>
      <Figure side={side} sel={{}} heat={sets} />
      <div class="bm-legend sub small" aria-hidden="true">
        <span><i class="lg-h0" />0</span><span><i class="lg-h1" />1~4</span><span><i class="lg-h2" />5~9</span><span><i class="lg-h3" />10+</span><span>세트</span>
      </div>
    </div>
  );
}