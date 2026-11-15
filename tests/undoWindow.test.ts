import { describe, it, expect } from 'vitest';
import { nextSwapWindow, NO_HOLD, setHold, isHeld } from '../src/core/undoWindow';

type Snap = { id: string; at: string };
const before = (at: string): Snap => ({ id: 'r', at });

describe('D-080 5차: 되돌리기 창', () => {
  it('첫 바꾸기: 한 건 문장, 바꾸기 전 모습을 쥠', () => {
    const w = nextSwapWindow<Snap>(null, 'r', before('t0'), '플랭크', '데드버그');
    expect(w).toMatchObject({ rid: 'r', count: 1, firstName: '플랭크', text: '플랭크 → 데드버그: 바꿨어요' });
    expect(w.snap).toEqual({ id: 'r', at: 't0' });
  });
  it('같은 루틴에서 또 바꾸면 처음 모습·처음 운동 이름을 유지하고 횟수만 셈', () => {
    const w1 = nextSwapWindow<Snap>(null, 'r', before('t0'), '플랭크', '데드버그');
    const w2 = nextSwapWindow(w1, 'r', before('t1'), '벤치', '덤벨 벤치');
    expect(w2).toMatchObject({ count: 2, firstName: '플랭크', text: '2개 바꿨어요' });
    expect(w2.snap).toBe(w1.snap);
    const w3 = nextSwapWindow(w2, 'r', before('t2'), 'a', 'b');
    expect(w3).toMatchObject({ count: 3, text: '3개 바꿨어요' });
    expect(w3.snap).toBe(w1.snap);
  });
  it('다른 루틴을 바꾸면 새 창 (이전 모습은 버림)', () => {
    const w1 = nextSwapWindow<Snap>(null, 'r', before('t0'), '플랭크', '데드버그');
    const w2 = nextSwapWindow(w1, 'x', { id: 'x', at: 'u0' }, '벤치', '덤벨 벤치');
    expect(w2).toMatchObject({ rid: 'x', count: 1, firstName: '벤치', text: '벤치 → 덤벨 벤치: 바꿨어요' });
    expect(w2.snap).toEqual({ id: 'x', at: 'u0' });
  });
});

describe('D-080 5차: 알림 타이머 멈춤 (WCAG 2.2.1)', () => {
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
});
