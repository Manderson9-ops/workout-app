/**
 * D-064 앱이 애플워치 단축어를 직접 실행 (아이폰 자동화 없이).
 * 단축어는 맥이 넣어 준 D-063 세트: "WO 운동 실행"(운동 끝), "WO 하루 실행"(하루 한 번).
 * 맥은 단축어 이름을 한글 분해형(NFD)으로 저장하므로(2026-10-12 확인) 실행 링크 이름도 NFD 로 만든다.
 */
export type WatchRunKind = 'workout' | 'daily';
export const SHORTCUT_NAME: Record<WatchRunKind, string> = { workout: 'WO 운동 실행', daily: 'WO 하루 실행' };

/** shortcuts://run-shortcut 링크 (이름은 NFD, 퍼센트 인코딩) */
export function shortcutRunUrl(kind: WatchRunKind): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME[kind].normalize('NFD'))}`;
}

const KST = 9 * 3600 * 1000;
/** 한국 시간 날짜 "YYYY-MM-DD" */
export function kstDay(ms: number): string { return new Date(ms + KST).toISOString().slice(0, 10); }

export interface WatchRunState { workoutAt?: number; dailyDay?: string }
export const DAILY_EARLIEST_HOUR = 5; // 새벽 5시 전에는 하루 보내기 안 함 (어젯밤 수면이 아직 진행 중일 수 있음, 앱 판단)
export const AFTER_WORKOUT_SKIP_MS = 2 * 3600 * 1000; // 운동 보내기 뒤 2시간 안에는 하루 보내기를 건너뜀 (같은 자료, 앱 판단)

/**
 * 하루 보내기를 지금 할지. 조건: 켜짐 · 진행 중 운동 없음 · 오늘(한국 시간) 아직 안 함 · 5시 이후 · 최근 2시간 안에 운동 보내기 안 함
 */
export function dailyDue(st: WatchRunState, nowMs: number, opts: { enabled: boolean; activeWorkout: boolean }): boolean {
  if (!opts.enabled || opts.activeWorkout) return false;
  if (st.dailyDay === kstDay(nowMs)) return false;
  const hour = new Date(nowMs + KST).getUTCHours();
  if (hour < DAILY_EARLIEST_HOUR) return false;
  if (st.workoutAt !== undefined && nowMs - st.workoutAt >= 0 && nowMs - st.workoutAt < AFTER_WORKOUT_SKIP_MS) return false;
  return true;
}

/** 이 기기가 아이폰·아이패드인지 (단축어 앱이 있는 기기). iPadOS 데스크톱 모드는 터치 지점 수로 구분 */
export function isAppleMobile(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
