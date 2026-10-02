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
  front: { chest: '가슴', abs: '코어', obliques: '코어', biceps: '이두', triceps: '삼두', deltoids: '어깨', forearm: '전완·악력',
    trapezius: '등', quadriceps: '하체', adductors: '하체', tibialis: '하체', calves: '하체' },
  back: { trapezius: '등', 'upper-back': '등', 'lower-back': '등', deltoids: '어깨', triceps: '삼두', forearm: '전완·악력',
    gluteal: '하체', adductors: '하체', hamstring: '하체', calves: '하체' },
};

type Box = [number, number, number, number]; // x1, y1, x2, y2 (그림 좌표)
const mirror = (b: Box, c: number): Box => [2 * c - b[2], b[1], 2 * c - b[0], b[3]];
const pair = (b: Box, c: number): Box[] => [b, mirror(b, c)];
/** 누르는 영역: 서로 겹치지 않게, 근육보다 넉넉히 */
export const HITS: Record<Side, [Part, Box[]][]> = {
  front: [
    ['어깨', pair([140, 288, 292, 398], 362)],
    ['가슴', [[292, 300, 432, 435]]],
    ['이두', pair([105, 398, 270, 520], 362)],
    ['전완·악력', pair([40, 520, 270, 700], 362)],
    ['코어', [[270, 435, 454, 660]]],
    ['하체', [[225, 660, 499, 1300]]],
  ],
  back: [
    ['어깨', pair([862, 288, 1003, 398], 1086)],
    ['등', [[1003, 270, 1169, 630]]],
    ['삼두', pair([830, 398, 1003, 530], 1086)],
    ['전완·악력', pair([760, 530, 1003, 705], 1086)],
    ['하체', [[945, 630, 1227, 1330]]],
  ],
};
const VIEW: Record<Side, string> = { front: '0 80 724 1290', back: '724 80 724 1290' };

function Figure({ side, sel, onPart }: { side: Side; sel: Partial<Record<Part, Priority>>; onPart: (p: Part) => void }) {
  const shapes: BodyShape[] = side === 'front' ? BODY_FRONT : BODY_BACK;
  const map = SLUG_PART[side];
  return (
    <svg viewBox={VIEW[side]} class="bodymap-svg" aria-hidden="true" focusable="false" data-side={side}>
      <path d={side === 'front' ? OUTLINE_FRONT : OUTLINE_BACK} class="bm-outline" />
      {shapes.map((s) => {
        const part = map[s.slug];
        const pr = part ? sel[part] : undefined;
        return s.d.map((d, k) => (
          <path key={s.slug + k} d={d} data-vis={part} class={part ? `bm-muscle${pr ? ' p-' + pr : ''}` : 'bm-deco'} />
        ));
      })}
      {HITS[side].map(([part, boxes]) => boxes.map((b, k) => (
        <rect key={part + k} x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} class="bm-hit" data-part={part} onClick={() => onPart(part)} />
      )))}
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
      <p class="sub small bm-hint">{side === 'front' ? '어깨·가슴·이두·전완·코어·하체' : '어깨·등·삼두·전완·하체'}를 눌러 고르세요</p>
    </div>
  );
}
