/**
 * 순서 바꾸기 (D-037): from 자리 항목을 to 자리로 옮기고 사이 항목은 한 칸씩 민다.
 * 끌어서 놓기와 ↑↓ 버튼이 같은 함수를 쓴다. 범위 밖이거나 같은 자리면 원본 배열을 그대로 돌려준다 (바뀐 게 없음을 === 로 확인).
 */
export function moveItem<T>(arr: readonly T[], from: number, to: number): readonly T[] {
  const n = arr.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= n || to < 0 || to >= n || from === to) return arr;
  const out = [...arr];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** 목록에서 from → to 로 옮겼을 때 idx 자리에 있던 항목의 새 자리 */
export function remapIndex(idx: number, from: number, to: number): number {
  if (idx === from) return to;
  if (from < to && idx > from && idx <= to) return idx - 1;
  if (from > to && idx >= to && idx < from) return idx + 1;
  return idx;
}
