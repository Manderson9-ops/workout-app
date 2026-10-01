/**
 * 플랜 만들기의 부위 고르기 (D-043). 화면과 따로 시험할 수 있게 순수 함수로.
 * 켜면 우선순위 '높음'으로 맨 뒤에, 끄면 빠짐. 우선순위를 바꿔도 고른 순서(같은 우선순위끼리의 앞뒤)는 그대로.
 */
import type { Part } from './types';
import type { Priority } from './planner';

export interface PartsForm { parts: Partial<Record<Part, Priority>>; order: Part[] }

export function togglePart<F extends PartsForm>(f: F, p: Part): F {
  const parts = { ...f.parts };
  if (parts[p]) { delete parts[p]; return { ...f, parts, order: f.order.filter((x) => x !== p) }; }
  parts[p] = 'high';
  return { ...f, parts, order: [...f.order.filter((x) => x !== p), p] };
}

export function setPartPriority<F extends PartsForm>(f: F, p: Part, pr: Priority): F {
  if (!f.parts[p]) return f;
  return { ...f, parts: { ...f.parts, [p]: pr } };
}
