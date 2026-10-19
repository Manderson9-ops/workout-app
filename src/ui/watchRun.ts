/**
 * D-064 앱이 애플워치 단축어를 직접 실행 (아이폰 자동화 대신).
 * - 운동 끝내기 성공 → "WO 운동 실행" (그때는 아이폰 잠금이 풀려 있어 건강 기록을 읽을 수 있음)
 * - 하루 한 번 앱을 열 때 → "WO 하루 실행" (조건은 core/watchRun dailyDue)
 * 설정은 이 기기에만(localStorage). 기본: 아이폰·아이패드 홈 화면 앱은 켬, 그 밖(사파리 탭·PC)은 끔.
 * 단축어 앱으로 넘어갔다가, 사용자가 왼쪽 위 "◀ 앱"으로 돌아옴 (홈 화면 앱은 자동 복귀 링크를 받을 수 없음).
 */
import { useEffect } from 'preact/hooks';
import { lsGet, lsSet } from './appName';
import { diag } from './diag';
import { dailyDue, isAppleMobile, kstDay, shortcutRunUrl } from '../core/watchRun';
import { showToast } from './toast';
import type { WatchRunKind, WatchRunState } from '../core/watchRun';

const ON_KEY = 'watch.run';
const ST_KEY = 'watch.runState';

export const canRunShortcuts = (): boolean => typeof navigator !== 'undefined' && isAppleMobile(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0);
/** 켜짐 여부. 저장값이 없으면 아이폰·아이패드의 홈 화면 앱에서만 켬 (사파리 탭·PC·화면 시험에서는 끔) */
export function watchRunEnabled(): boolean { const v = lsGet(ON_KEY); return v === null ? canRunShortcuts() && (navigator as Navigator & { standalone?: boolean }).standalone === true : v === 'on'; }
export function setWatchRunEnabled(on: boolean): void { lsSet(ON_KEY, on ? 'on' : 'off'); }

export function watchRunState(): WatchRunState {
  try { const o = JSON.parse(lsGet(ST_KEY) || '{}') as WatchRunState; return { workoutAt: typeof o.workoutAt === 'number' ? o.workoutAt : undefined, dailyDay: typeof o.dailyDay === 'string' ? o.dailyDay : undefined }; }
  catch { return {}; }
}
function saveState(p: WatchRunState): void { lsSet(ST_KEY, JSON.stringify({ ...watchRunState(), ...p })); }

/** 단축어 실행 (단축어 앱으로 넘어감). 기록을 먼저 남겨 돌아왔을 때 다시 실행하지 않게 함 */
export function runWatchShortcut(kind: WatchRunKind, nowMs = Date.now()): void {
  if (kind === 'workout') saveState({ workoutAt: nowMs }); else saveState({ dailyDay: kstDay(nowMs) });
  diag('send', { m: `애플워치 단축어 실행: ${kind === 'workout' ? '운동' : '하루'}`, ok: true });
  const u = shortcutRunUrl(kind);
  const w = window as Window & { __woOpen?: (u: string) => void }; // 화면 시험(e2e)용 가로채기
  if (w.__woOpen) w.__woOpen(u); else location.href = u;
  // 단축어 앱으로 안 넘어갔으면(아이폰이 막음 등) 손으로 하는 길 안내. 한 번이라도 앱을 벗어났으면(= 단축어가 열림) 안내하지 않음
  let left = false;
  const onVis = () => { if (document.visibilityState === 'hidden') left = true; };
  document.addEventListener('visibilitychange', onVis);
  setTimeout(() => { document.removeEventListener('visibilitychange', onVis); if (!left && !w.__woOpen && document.visibilityState === 'visible') showToast('단축어가 열리지 않았어요. 설정 → 애플워치 연동 → [지금 보내기]를 눌러 주세요'); }, 2500);
}

/**
 * 운동 끝내기 성공 뒤 (켜져 있을 때만). 앱이 단축어 앱으로 넘어가면 아이폰이 이 앱을 멈추므로,
 * 운동 기록 동기화(sent)를 먼저 끝내거나 최대 5초 기다린 뒤 실행 (서버가 운동 기록을 먼저 받아야 운동별 애플워치 요약이 맞음, D-059)
 */
let workoutPending = false; // 운동 보내기를 기다리는 동안 하루 보내기가 끼어들지 않게 (운동이 끝나 activeWorkout 이 바뀌면 하루 확인이 돎)
/** dialogs: 끝낸 뒤 묻는 창(루틴 반영 등)이 닫힐 때까지 기다림 (창이 열린 채 단축어 앱으로 넘어가지 않게) */
export async function afterWorkoutFinished(sent: Promise<unknown>, dialogs?: Promise<unknown>): Promise<void> {
  if (!watchRunEnabled()) return;
  workoutPending = true;
  try {
    if (dialogs) await dialogs.catch(() => undefined);
    await Promise.race([sent.catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    await new Promise((r) => setTimeout(r, 300));
    runWatchShortcut('workout');
  } finally { workoutPending = false; }
}

/** 앱 전체에서 한 번: 앱을 열거나 돌아올 때 하루 보내기가 필요하면 실행 */
export function useDailyWatchRun(ready: boolean, activeWorkout: boolean): void {
  useEffect(() => {
    if (!ready) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (document.visibilityState !== 'visible' || workoutPending) return;
      if (!dailyDue(watchRunState(), Date.now(), { enabled: watchRunEnabled(), activeWorkout })) return;
      clearTimeout(t);
      showToast('잠시 뒤 단축어로 오늘 애플워치 기록을 보내요 (설정 → 애플워치 연동에서 끌 수 있어요)');
      t = setTimeout(() => { if (document.visibilityState === 'visible' && !workoutPending && dailyDue(watchRunState(), Date.now(), { enabled: watchRunEnabled(), activeWorkout })) runWatchShortcut('daily'); }, 2500);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', check); };
  }, [ready, activeWorkout]);
}
