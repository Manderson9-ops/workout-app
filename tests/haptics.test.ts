import { describe, it, expect } from 'vitest';
import { makeHaptics, pulseTimes, vibratePattern, pickMethod, buzzOnTime, LATE_GRACE_MS, PULSE_GAP_MS, METHOD_LABEL } from '../src/ui/haptics';
import type { HapticEnv } from '../src/ui/haptics';
import { summarizeDiag, verdicts } from '../src/core/diag';
import type { DiagEntry } from '../src/core/diag';

/** 가짜 DOM: 만든 요소·붙인 곳·누른 횟수·초점만 흉내 */
function fakeEnv(o: { hasSwitch: boolean; vibrate?: boolean; hidden?: boolean }) {
  const clicks: number[] = []; const timers: { fn: () => void; ms: number }[] = []; const vib: number[][] = [];
  const appended: unknown[] = [];
  const focused = { focus: () => undefined };
  const mk = (tag: string) => {
    const el: Record<string, unknown> = {
      tag, attrs: {} as Record<string, string>, children: [] as unknown[], listeners: {} as Record<string, unknown>, isConnected: true,
      setAttribute(k: string, v: string) { (el.attrs as Record<string, string>)[k] = v; },
      appendChild(c: unknown) { (el.children as unknown[]).push(c); },
      addEventListener(k: string, f: unknown) { (el.listeners as Record<string, unknown>)[k] = f; },
      click() { clicks.push(Date.now()); },
    };
    return el;
  };
  const doc = { createElement: mk, body: { appendChild: (c: unknown) => appended.push(c) }, activeElement: focused, visibilityState: o.hidden ? 'hidden' : 'visible' };
  const env = {
    doc: doc as unknown as HapticEnv['doc'],
    hasSwitch: () => o.hasSwitch,
    ...(o.vibrate ? { vibrate: (p: number[]) => { vib.push(p); return true; } } : {}),
    later: (fn: () => void, ms: number) => { timers.push({ fn, ms }); },
  } satisfies HapticEnv;
  return { env, clicks, timers, vib, appended, doc };
}

describe('D-056 진동: 방법 고르기·간격', () => {
  it('스위치 > vibrate > 없음', () => {
    expect(pickMethod({ hasSwitch: true, hasVibrate: true })).toBe('switch');
    expect(pickMethod({ hasSwitch: false, hasVibrate: true })).toBe('vibrate');
    expect(pickMethod({ hasSwitch: false, hasVibrate: false })).toBe('none');
    expect(METHOD_LABEL.none).toContain('화면 깜빡임만');
  });
  it('누르는 시각·진동 패턴', () => {
    expect(pulseTimes(3)).toEqual([0, PULSE_GAP_MS, PULSE_GAP_MS * 2]);
    expect(pulseTimes(1)).toEqual([0]);
    expect(pulseTimes(0)).toEqual([]);
    expect(vibratePattern(3)).toEqual([60, 60, 60, 60, 60]);
    expect(vibratePattern(1)).toEqual([60]);
  });
  it('늦게 돌아오면 건너뜀 (끝난 지 5초 넘음)', () => {
    expect(buzzOnTime(1000, 1000)).toBe(true);
    expect(buzzOnTime(1000, 1000 + LATE_GRACE_MS)).toBe(true);
    expect(buzzOnTime(1000, 1001 + LATE_GRACE_MS)).toBe(false);
  });
});

describe('D-056 진동: 숨긴 스위치로 누르기 (가짜 DOM)', () => {
  it('스위치: 첫 번째는 바로, 나머지는 120ms 간격으로 예약. 스위치는 한 번만 만들고 화면 밖·aria-hidden·tabindex -1', () => {
    const f = fakeEnv({ hasSwitch: true, vibrate: true });
    const h = makeHaptics(f.env);
    expect(h.fire(3)).toBe('switch');
    expect(f.clicks).toHaveLength(1);
    expect(f.timers.map((t) => t.ms)).toEqual([PULSE_GAP_MS, PULSE_GAP_MS * 2]);
    for (const t of f.timers) t.fn();
    expect(f.clicks).toHaveLength(3);
    expect(f.vib).toEqual([]); // 스위치가 있으면 vibrate 는 안 씀
    expect(f.appended).toHaveLength(1);
    const box = f.appended[0] as { attrs: Record<string, string>; children: { tag: string; attrs: Record<string, string>; tabIndex?: number; type?: string; listeners: Record<string, unknown> }[] };
    expect(box.attrs['aria-hidden']).toBe('true');
    expect(box.attrs.style).toContain('position:fixed');
    expect(box.attrs.style).not.toContain('display:none'); // DOM 에 보이는 상태로 둬야 햅틱이 남
    expect(box.attrs.style).toContain('pointer-events:none');
    const [input, label] = box.children;
    expect(input!.type).toBe('checkbox');
    expect(input!.attrs.switch).toBe('');
    expect(input!.tabIndex).toBe(-1);
    expect(label!.tabIndex).toBe(-1);
    expect(typeof label!.listeners.click).toBe('function'); // 클릭이 앱 다른 처리로 번지지 않게
    h.fire(1);
    expect(f.appended).toHaveLength(1); // 다시 만들지 않음
  });
  it('스위치가 없으면 vibrate(패턴), 둘 다 없으면 none', () => {
    const f = fakeEnv({ hasSwitch: false, vibrate: true });
    expect(makeHaptics(f.env).fire(3)).toBe('vibrate');
    expect(f.vib).toEqual([[60, 60, 60, 60, 60]]);
    expect(f.clicks).toHaveLength(0);
    const g = fakeEnv({ hasSwitch: false });
    expect(makeHaptics(g.env).fire(3)).toBe('none');
    expect(g.appended).toHaveLength(0);
  });
  it('앱이 숨겨져 있으면 아무것도 안 함', () => {
    const f = fakeEnv({ hasSwitch: true, vibrate: true, hidden: true });
    expect(makeHaptics(f.env).fire(3)).toBe('none');
    expect(f.clicks).toHaveLength(0);
    expect(f.vib).toHaveLength(0);
  });
});

describe('D-056 진단: 진동 방법 기록 요약', () => {
  const e = (m: string): DiagEntry => ({ t: '2026-10-07T00:00:00.000Z', k: 'haptic', d: 'ab12', m, ok: m === 'switch' || m === 'vibrate' });
  it('방법별 횟수와 판정 문장', () => {
    const s = summarizeDiag([e('switch'), e('switch'), e('late'), e('none')]);
    expect(s.haptic).toEqual({ switch: 2, vibrate: 0, none: 1, late: 1 });
    const v = verdicts(s).find((x) => x.item === '2~4 진동')!;
    expect(v.text).toContain('iOS 햅틱 2번');
    expect(v.text).toContain('늦게 돌아와 건너뜀 1번');
    expect(verdicts(summarizeDiag([e('none')])).find((x) => x.item === '2~4 진동')!.level).toBe('warn');
    expect(verdicts(summarizeDiag([])).find((x) => x.item === '2~4 진동')).toBeUndefined();
  });
});
