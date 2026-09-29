/**
 * 아이폰 기능: 소리(휴식 끝 알림), 화면 꺼짐 방지. 실기기 확인 항목 (BLUEPRINT 7.4)
 */
import { useEffect } from 'preact/hooks';

let ctx: AudioContext | undefined;

/** 사용자 탭 안에서 오디오를 깨움. 무음 스위치를 넘기려고 audioSession을 playback으로 (Safari 17+) */
export function unlockAudio(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') void ctx.resume();
  } catch { /* 소리 불가 */ }
}

export function beep(freq: number, ms: number, when = 0): void {
  if (!ctx || ctx.state !== 'running') return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.start(t); o.stop(t + ms / 1000 + 0.05);
}

/** 앱 전체에서 한 번: 여러 종류의 탭으로 오디오를 깨우고, 앱으로 돌아오면 다시 깨움 */
export function useAudioUnlock(): void {
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
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let alive = true;
    const req = async () => {
      try {
        if (lock && !lock.released) return;
        const l = await navigator.wakeLock.request('screen');
        if (!alive) { void l.release(); return; }
        lock = l;
      } catch { /* 배터리 부족 등으로 거부 */ }
    };
    void req();
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [on]);
}

/** 같은 휴식 끝을 두 번 알리지 않도록 기록 (새로고침해도 유지) */
export const alertedKey = 'timerAlerted';
export const wasAlerted = (endsAt: number) => localStorage.getItem(alertedKey) === String(endsAt);
export const markAlerted = (endsAt: number) => localStorage.setItem(alertedKey, String(endsAt));
