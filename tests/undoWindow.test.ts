import { describe, it, expect } from 'vitest';
import { nextSwapWindow, changedRows, NO_HOLD, setHold, isHeld, timerRuns } from '../src/core/undoWindow';
import type { RoutineLike } from '../src/core/undoWindow';

/** 루틴 흉내: 운동 id 만 있는 칸들 (한 블록에 한 칸씩) */
type R = RoutineLike & { at: string };
const rt = (at: string, ...ids: string[]): R => ({ at, blocks: ids.map((id) => ({ items: [{ exerciseId: id }] })) });
const nm = (id: string) => id.toUpperCase();

describe('D-080 6차: 되돌리기 창 (처음 모습과 견줘 바뀐 칸 수)', () => {
  it('첫 바꾸기: 한 건 문장, 바꾸기 전 모습을 쥠', () => {
    const w = nextSwapWindow<R>(null, 'r', rt('t0', 'a', 'b'), rt('t1', 'c', 'b'), nm);
    expect(w).toMatchObject({ rid: 'r', count: 1, firstName: 'A', text: 'A → C: 바꿨어요', say: 'A → C: 바꿨어요' });
    expect(w.snap.at).toBe('t0');
  });
  it('한 칸을 두 번 바꿔도 1칸: 문장은 원래 → 지금', () => {
    const w1 = nextSwapWindow<R>(null, 'r', rt('t0', 'a', 'b'), rt('t1', 'c', 'b'), nm);
    const w2 = nextSwapWindow(w1, 'r', rt('t1', 'c', 'b'), rt('t2', 'd', 'b'), nm);
    expect(w2).toMatchObject({ count: 1, firstName: 'A', text: 'A → D: 바꿨어요' });
    expect(w2.snap).toBe(w1.snap);
  });
  it('A → B → A 로 돌아오면 0칸: "원래대로예요", 되돌릴 것 없음', () => {
    const w1 = nextSwapWindow<R>(null, 'r', rt('t0', 'a', 'b'), rt('t1', 'c', 'b'), nm);
    const w2 = nextSwapWindow(w1, 'r', rt('t1', 'c', 'b'), rt('t2', 'a', 'b'), nm);
    expect(w2).toMatchObject({ count: 0, text: '원래대로예요', say: '원래대로예요', firstName: 'A' });
    expect(w2.snap).toBe(w1.snap);
    // 0칸 뒤 다른 칸을 바꾸면 다시 1칸
    const w3 = nextSwapWindow(w2, 'r', rt('t2', 'a', 'b'), rt('t3', 'a', 'x'), nm);
    expect(w3).toMatchObject({ count: 1, text: 'B → X: 바꿨어요' });
  });
  it('서로 다른 두 칸: 2개, 읽기 문장에 이름 (3개까지, 넘으면 외 n개)', () => {
    const w1 = nextSwapWindow<R>(null, 'r', rt('t0', 'a', 'b', 'c', 'd', 'e'), rt('t1', 'p', 'b', 'c', 'd', 'e'), nm);
    const w2 = nextSwapWindow(w1, 'r', rt('t1', 'p', 'b', 'c', 'd', 'e'), rt('t2', 'p', 'q', 'c', 'd', 'e'), nm);
    expect(w2).toMatchObject({ count: 2, text: '2개 바꿨어요', say: '2개 바꿨어요: A → P, B → Q', firstName: 'A' });
    const w3 = nextSwapWindow(w2, 'r', rt('t2', 'p', 'q', 'c', 'd', 'e'), rt('t3', 'p', 'q', 'r', 's', 'e'), nm);
    expect(w3).toMatchObject({ count: 4, text: '4개 바꿨어요', say: '4개 바꿨어요: A → P, B → Q, C → R 외 1개' });
  });
  it('다른 루틴을 바꾸면 새 창 (이전 모습은 버림)', () => {
    const w1 = nextSwapWindow<R>(null, 'r', rt('t0', 'a'), rt('t1', 'c'), nm);
    const w2 = nextSwapWindow(w1, 'x', rt('u0', 'b'), rt('u1', 'd'), nm);
    expect(w2).toMatchObject({ rid: 'x', count: 1, firstName: 'B', text: 'B → D: 바꿨어요' });
    expect(w2.snap.at).toBe('u0');
  });
  it('changedRows: 자리가 없어진 칸은 건너뜀', () => {
    expect(changedRows(rt('a', 'a', 'b'), rt('b', 'a'))).toEqual([]);
  });
});

describe('D-080 5·6차: 알림 타이머 멈춤 (WCAG 2.2.1)', () => {
  it('초점 또는 포인터 하나라도 있으면 멈춤, 둘 다 벗어나야 다시 감', () => {
    let h = NO_HOLD;
    expect(isHeld(h)).toBe(false);
    h = setHold(h, 'focus', true);
    expect(isHeld(h)).toBe(true);
    h = setHold(h, 'pointer', true);
    h = setHold(h, 'focus', false);
    expect(isHeld(h)).toBe(true);
    h = setHold(h, 'pointer', false);
    expect(isHeld(h)).toBe(false);
  });
  it('바뀌는 게 없으면 같은 객체를 돌려줌 (불필요한 다시 그리기 없음)', () => {
    expect(setHold(NO_HOLD, 'focus', false)).toBe(NO_HOLD);
  });
  it('timerRuns: 교체 창이 열려 있는 동안(paused)에도 멈추고, 알림이 없으면 안 돎', () => {
    expect(timerRuns(true, NO_HOLD, false)).toBe(true);
    expect(timerRuns(true, NO_HOLD, true)).toBe(false);
    expect(timerRuns(true, setHold(NO_HOLD, 'focus', true), false)).toBe(false);
    expect(timerRuns(false, NO_HOLD, false)).toBe(false);
  });
  it('timerRuns: 거짓 → 참 으로 바뀌는 순간이 "새 5초" 시작 (paused 해제 = 재개)', () => {
    const seq = [timerRuns(true, NO_HOLD, false), timerRuns(true, NO_HOLD, true), timerRuns(true, NO_HOLD, false)];
    const starts = seq.filter((v, i) => v && !seq[i - 1]).length;
    expect(starts).toBe(2); // 처음 한 번 + 재개 한 번
  });
});
