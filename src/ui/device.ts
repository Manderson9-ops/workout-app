/**
 * 아이폰 기능: 소리(휴식 끝 알림), 화면 꺼짐 방지. 실기기 확인 항목 (BLUEPRINT 7.4)
 */
import { lsGet, lsSet, lsRemove } from './appName';
import { useEffect } from 'preact/hooks';
import { flushPending } from './store';
import { diag } from './diag';

let ctx: AudioContext | undefined;

/**
 * D-045: 오디오 세션 종류 (이 기기만, localStorage).
 * 'mix'(기본) = W3C Audio Session 'transient': 알림음 용도, 다른 앱 음악 위에 울림(음악을 멈추지 않음).
 * 'solo' = 'playback': 독점 유형이라 다른 앱 음악을 멈춤. 이전(0.8.4까지)의 동작, 무음 스위치를 넘기려던 설정.
 * 아이폰 무음 스위치에서 'transient'가 울리는지는 실기기 확인 항목.
 */
export type AudioMode = 'mix' | 'solo';
export const AUDIO_MODE_KEY = 'audio.mode';
export const audioMode = (): AudioMode => (lsGet(AUDIO_MODE_KEY) === 'solo' ? 'solo' : 'mix');
export const sessionTypeFor = (m: AudioMode): string => (m === 'solo' ? 'playback' : 'transient');
function applySessionType(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = sessionTypeFor(audioMode());
}
export function setAudioMode(m: AudioMode): void {
  if (m === 'solo') lsSet(AUDIO_MODE_KEY, 'solo'); else lsRemove(AUDIO_MODE_KEY);
  try { applySessionType(); } catch { /* 지원 안 함 */ }
}

/** 설정의 "소리 끔"이면 오디오를 아예 깨우지 않음 (세션을 잡지 않아 다른 앱 음악에 영향 없음) */
let soundEnabled = true;
export function setSoundEnabled(on: boolean): void {
  if (soundEnabled && !on && ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined); // 끄면 잡고 있던 소리 장치도 멈춤
  soundEnabled = on;
}

/** 사용자 탭 안에서 오디오를 깨움. 세션 종류는 설정(D-045) */
export function unlockAudio(): void {
  if (!soundEnabled) return;
  try {
    applySessionType();
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') void ctx.resume();
  } catch { /* 소리 불가 */ }
}

/** 소리 장치 상태 (running이 아니면 소리가 안 남). 진단용 대리 지표 */
export const audioState = () => `${ctx ? ctx.state : 'none'} · ${sessionTypeFor(audioMode())}`;

export function beep(freq: number, ms: number, when = 0): void {
  if (!ctx || ctx.state !== 'running') return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.start(t); o.stop(t + ms / 1000 + 0.05);
}

/** 휴식 끝 알림음 (세 번) · 10초 전 알림음 (한 번). 운동 화면과 설정의 [소리·진동 시험]이 같은 소리를 씀 */
export function playEndSound(): void { beep(880, 180); beep(880, 180, 0.3); beep(1175, 350, 0.6); }
export function playWarnSound(): void { beep(660, 120); }

/** 앱 전체에서 한 번: 여러 종류의 탭으로 오디오를 깨우고, 앱으로 돌아오면 다시 깨움 */
export function useAudioUnlock(soundOn = true): void {
  setSoundEnabled(soundOn);
  useEffect(() => {
    const evs = ['pointerdown', 'touchend', 'click'] as const;
    evs.forEach((e) => document.addEventListener(e, unlockAudio, { passive: true }));
    const vis = () => { if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') void ctx.resume(); };
    document.addEventListener('visibilitychange', vis);
    return () => { evs.forEach((e) => document.removeEventListener(e, unlockAudio)); document.removeEventListener('visibilitychange', vis); };
  }, []);
}

/** 운동 중이면 어느 화면에 있든 화면을 켜 둠. 앱으로 돌아오면 다시 요청 (iOS 18.4+ 홈 화면 앱) */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (on && !('wakeLock' in navigator)) diag('wake', { m: '이 브라우저는 화면 꺼짐 방지를 지원하지 않음', ok: false });
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let alive = true;
    const req = async () => {
      try {
        if (lock && !lock.released) return;
        const l = await navigator.wakeLock.request('screen');
        if (!alive) { void l.release(); return; }
        lock = l;
        diag('wake', { m: 'request', ok: true });
        l.addEventListener('release', () => { if (alive) diag('wake', { m: 'released' }); });
      } catch (e) { diag('wake', { m: `request 실패: ${(e as Error).name}`, ok: false }); /* 배터리 부족 등으로 거부 */ }
    };
    void req();
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [on]);
}

/** 같은 휴식 끝을 두 번 알리지 않도록 기록 (새로고침해도 유지) */
export const alertedKey = 'timerAlerted';
export const wasAlerted = (endsAt: number) => lsGet(alertedKey) === String(endsAt);
export const markAlerted = (endsAt: number) => lsSet(alertedKey, String(endsAt));

/** 앱이 뒤로 가거나 닫히기 직전에 입력 중인 값을 저장 (아이폰은 백그라운드 앱을 자주 종료) */
export function useFlushOnHide(): void {
  useEffect(() => {
    const hide = () => { void flushPending(); };
    const vis = () => { if (document.visibilityState === 'hidden') hide(); };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', vis); };
  }, []);
}
