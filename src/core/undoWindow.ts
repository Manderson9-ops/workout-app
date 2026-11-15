/**
 * D-080: 바로 교체 알림의 되돌리기 창(5초) 순수 논리.
 * 같은 루틴에서 알림이 떠 있는 동안 또 바꾸면 처음 바꾸기 전 모습을 그대로 쥐고, 지금 모습과 견줘 바뀐 칸 수를 센다
 * (한 칸을 A→B→C 로 두 번 바꿔도 1칸, A→B→A 로 돌아오면 0칸)
 */
export interface RoutineLike { blocks: { items: { exerciseId: string }[] }[] }
export interface SwapWindow<T> {
  rid: string;
  /** 처음 바꾸기 전 루틴 (되돌리면 이 객체를 그대로 다시 저장 = 수정 시각까지 원래대로) */
  snap: T;
  /** 처음 모습과 운동이 다른 칸 수 */
  count: number;
  /** 바뀐 첫 칸의 원래 운동 이름 (되돌린 뒤 초점이 갈 줄) */
  firstName: string;
  /** 눈에 보이는 알림 글자 */
  text: string;
  /** 화면 읽기 알림 문장 (운동 이름 포함) */
  say: string;
}

/** 처음 모습(snap)과 지금(cur)을 같은 자리끼리 견줘 운동이 다른 칸들 */
export function changedRows(snap: RoutineLike, cur: RoutineLike): { from: string; to: string }[] {
  const rows: { from: string; to: string }[] = [];
  snap.blocks.forEach((b, bi) => b.items.forEach((it, ii) => {
    const now = cur.blocks[bi]?.items[ii]?.exerciseId;
    if (now !== undefined && now !== it.exerciseId) rows.push({ from: it.exerciseId, to: now });
  }));
  return rows;
}

/** prev = 지금 떠 있는 창. 같은 루틴이면 이어 세고, 다른 루틴이면 새 창 (이전 알림은 되돌리기 없이 닫힘). after = 방금 바꾼 뒤 루틴 */
export function nextSwapWindow<T extends RoutineLike>(prev: SwapWindow<T> | null, rid: string, before: T, after: T, nameOf: (id: string) => string): SwapWindow<T> {
  const same = prev !== null && prev.rid === rid;
  const snap = same ? prev.snap : before;
  const rows = changedRows(snap, after);
  const count = rows.length;
  const pair = (r: { from: string; to: string }) => `${nameOf(r.from)} → ${nameOf(r.to)}`;
  const first = rows[0];
  const firstName = first ? nameOf(first.from) : same ? prev.firstName : '';
  if (count === 0) return { rid, snap, count, firstName, text: '원래대로예요', say: '원래대로예요' };
  if (count === 1) { const t = `${pair(first!)}: 바꿨어요`; return { rid, snap, count, firstName, text: t, say: t }; }
  const shown = rows.slice(0, 3).map(pair).join(', ');
  return { rid, snap, count, firstName, text: `${count}개 바꿨어요`, say: `${count}개 바꿨어요: ${shown}${count > 3 ? ` 외 ${count - 3}개` : ''}` };
}

/** 알림 타이머를 멈추는 이유: 키보드 초점이 알림 안에 있음 / 포인터가 알림 위에 있거나 누르는 중 (WCAG 2.2.1) */
export interface Hold { focus: boolean; pointer: boolean }
export const NO_HOLD: Hold = { focus: false, pointer: false };
export const setHold = (h: Hold, kind: keyof Hold, on: boolean): Hold => (h[kind] === on ? h : { ...h, [kind]: on });
export const isHeld = (h: Hold): boolean => h.focus || h.pointer;
/**
 * 알림 타이머가 돌아야 하나: 알림이 떠 있고, 초점·포인터에 잡히지 않았고, 바깥 이유(paused: 알림 위로 교체 창이 열려 있음 등)로 멈추지 않았을 때.
 * 이 값이 거짓 → 참으로 바뀔 때마다 새 5초를 잼
 */
export const timerRuns = (active: boolean, h: Hold, paused: boolean): boolean => active && !paused && !isHeld(h);
