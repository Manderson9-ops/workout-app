/**
 * D-056: 휴식 끝 진동 (음악을 멈추지 않는 알림).
 * - iOS 18+ Safari: <input type="checkbox" switch> 를 누르면 시스템 햅틱이 남. 화면 밖에 숨긴 스위치의 label 을 눌러(click) 낸다.
 *   한 번 누를 때마다 한 번 "톡". 여러 번은 PULSE_GAP_MS 간격으로.
 * - 그 밖(안드로이드 크롬 등): navigator.vibrate(pattern)
 * - 둘 다 없으면 'none' (화면 깜빡임만, 운동 화면의 .flash 는 그대로)
 * 실기기 확인 항목: 버튼을 누르지 않은 순간(타이머)에도 iOS 햅틱이 나는지 (D-056)
 */
import { lsGet, lsSet, lsRemove } from './appName';

export type HapticMethod = 'switch' | 'vibrate' | 'none';

/** 설정 "휴식 끝 진동" (이 기기만, 기본 켬) */
export const HAPTIC_OFF_KEY = 'haptic.off';
export const hapticOn = (): boolean => lsGet(HAPTIC_OFF_KEY) !== '1';
export function setHapticOn(on: boolean): void { if (on) lsRemove(HAPTIC_OFF_KEY); else lsSet(HAPTIC_OFF_KEY, '1'); }

export const PULSE_GAP_MS = 120;
/** 늦게 돌아온 경우: 휴식 끝에서 이만큼 넘게 지났으면 진동하지 않음 (돌아와서 뒤늦게 울리지 않게) */
export const LATE_GRACE_MS = 5000;

/** n번 누르는 시각(ms, 첫 번째는 0 = 바로) */
export const pulseTimes = (n: number, gap = PULSE_GAP_MS): number[] => Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i * gap);
/** navigator.vibrate 패턴: 진동 on ms · 쉼 · 진동 … (n번) */
export function vibratePattern(n: number, on = 60, gap = PULSE_GAP_MS): number[] {
  const out: number[] = [];
  const k = Math.max(0, Math.floor(n));
  for (let i = 0; i < k; i++) { out.push(on); if (i < k - 1) out.push(Math.max(20, gap - on)); }
  return out;
}
export const pickMethod = (env: { hasSwitch: boolean; hasVibrate: boolean }): HapticMethod => (env.hasSwitch ? 'switch' : env.hasVibrate ? 'vibrate' : 'none');
/** 휴식 끝 진동을 지금 해도 되는지 (늦게 돌아왔으면 건너뜀) */
export const buzzOnTime = (endsAt: number, now: number, grace = LATE_GRACE_MS): boolean => now - endsAt <= grace;
export const METHOD_LABEL: Record<HapticMethod, string> = { switch: 'iOS 햅틱', vibrate: '진동', none: '진동 지원 안 함(화면 깜빡임만)' };
/** [소리·진동 시험] 결과 중 진동 부분 (D-056 검토 R1: 아이폰은 떨렸는지 사용자가 확인) */
export const testResultText = (m: HapticMethod): string => (m === 'switch' ? 'iOS 햅틱을 시도했어요 · 떨렸는지 직접 확인해 주세요' : m === 'vibrate' ? '진동 방식: 진동' : '진동 방식: 진동 지원 안 함(화면 깜빡임만)');
/**
 * 첫 휴식 안내 한 줄 (D-056 검토 R2): 진동 이야기는 진동 켬 + 이 기기에 방법이 있을 때만.
 * 아이폰(스위치)은 타이머 진동이 안 올 수 있어 약속하지 않음
 */
export function restHintText(on: boolean, m: HapticMethod): string {
  if (on && m === 'vibrate') return '무음 모드면 알림음 대신 진동·화면 깜빡임으로 알려요';
  if (on && m === 'switch') return '무음 모드면 알림음이 안 나요 · 아이폰은 진동도 안 올 수 있어요';
  return '무음 모드면 알림음이 안 나요 · 벨소리 모드로 두면 음악 위로 들려요';
}

/** 진동에 필요한 브라우저 기능 (시험에서 가짜로 바꿔 끼움) */
export interface HapticEnv {
  doc: Pick<Document, 'createElement' | 'body' | 'activeElement' | 'visibilityState'>;
  hasSwitch: () => boolean;
  vibrate?: (p: number[]) => boolean;
  later: (fn: () => void, ms: number) => unknown;
}

export function makeHaptics(env: HapticEnv) {
  let label: HTMLLabelElement | null = null;
  const method = (): HapticMethod => pickMethod({ hasSwitch: env.hasSwitch(), hasVibrate: typeof env.vibrate === 'function' });
  /** 화면 밖 스위치 (display:none 이면 햅틱이 안 날 수 있어 DOM 에는 두고 보이지만 않게). 초점·스크롤·다른 처리에 영향 없게 */
  function ensure(): HTMLLabelElement {
    if (label && label.isConnected !== false) return label;
    const d = env.doc;
    const box = d.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.className = 'haptic-box';
    box.setAttribute('style', 'position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;');
    const id = 'haptic-switch';
    const input = d.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = id;
    input.tabIndex = -1;
    const lab = d.createElement('label');
    lab.htmlFor = id;
    lab.tabIndex = -1;
    lab.textContent = '진동';
    // 앱의 다른 처리(문서 클릭 감지 등)로 번지지 않게
    const stop = (e: Event) => e.stopPropagation();
    input.addEventListener('click', stop);
    lab.addEventListener('click', stop);
    box.appendChild(input);
    box.appendChild(lab);
    d.body.appendChild(box);
    label = lab;
    return lab;
  }
  function tapOnce(): void {
    const lab = ensure();
    const before = env.doc.activeElement as HTMLElement | null;
    lab.click();
    // 혹시 초점이 옮겨 갔으면 되돌림 (스크롤 없이)
    if (env.doc.activeElement !== before && before && typeof before.focus === 'function') before.focus({ preventScroll: true });
  }
  /** pulses 번 진동. 쓴 방법을 돌려줌. 앱이 숨겨져 있으면 아무것도 안 함('none') */
  function fire(pulses: number): HapticMethod {
    if (env.doc.visibilityState === 'hidden' || pulses <= 0) return 'none';
    const m = method();
    if (m === 'switch') {
      const ts = pulseTimes(pulses);
      tapOnce(); // 첫 번째는 바로 (버튼을 누른 그 순간 안에서)
      for (const t of ts.slice(1)) env.later(() => { if (env.doc.visibilityState !== 'hidden') tapOnce(); }, t);
    } else if (m === 'vibrate') {
      try { env.vibrate!(vibratePattern(pulses)); } catch { return 'none'; }
    }
    return m;
  }
  return { method, fire };
}

type TestWin = Window & { __wkTest?: boolean; __hapticCalls?: { pulses: number; method: HapticMethod; t: number }[] };
let inst: ReturnType<typeof makeHaptics> | null = null;
function real() {
  inst ??= makeHaptics({
    doc: document,
    hasSwitch: () => typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype,
    ...(typeof navigator.vibrate === 'function' ? { vibrate: (p: number[]) => navigator.vibrate(p) } : {}),
    later: (fn, ms) => setTimeout(fn, ms),
  });
  return inst;
}
/** 이 기기에서 쓸 진동 방법 */
export const hapticMethod = (): HapticMethod => real().method();
/** 진동 (설정과 무관하게 바로). 시험(__wkTest)에서는 부른 기록을 window.__hapticCalls 에 남김 */
export function haptic(pulses: number): HapticMethod {
  const m = real().fire(pulses);
  const w = window as TestWin;
  if (w.__wkTest) (w.__hapticCalls ??= []).push({ pulses, method: m, t: Date.now() });
  return m;
}
