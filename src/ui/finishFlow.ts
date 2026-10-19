/**
 * 운동 끝내기 묻기와 끝낸 뒤 할 일 (D-038, D-065, D-072). 운동 화면과 "운동 끝났나요?" 띠가 같이 씀.
 *  - 완료 세트 0개: "기록하지 않고 버리기"가 기본 (기록 남기고 끝내기도 고를 수 있음)
 *  - 마지막 세트가 15분 넘게 지남: 끝난 시각 = "마지막 세트 + 3분" / "지금"
 *  - 그 밖: 지금처럼 "운동을 끝낼까요?"
 */
import { activeOf, historyOf, getState, flushPending } from './store';
import { askConfirm, askChoice } from './confirm';
import { finishActiveWorkout, discardActiveWorkout, setFinishError } from './actions';
import { doneCount, shouldAskEndTime, endAtLastSet, lastDoneMs, whenText } from '../core/finishTime';
import { timeText } from '../core/dateText';
import { prExerciseCount } from '../core/workoutHistory';
import { showToast } from './toast';
import { go } from './nav';
import { afterWorkoutFinished } from './watchRun';
import { sendNow } from './autoSend';
import { syncNow } from './sync';

let busy = false;

/** 끝내기 저장 → 홈, 자동 보내기·동기화·단축어, 기록 갱신 알림. 두 번 눌러도 한 번만 */
export async function finishAndAfter(id: string, at: 'now' | 'last' = 'now'): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    setFinishError(null);
    // 끝내기 전에 기록 갱신(앱 기준) 운동 수를 셈 → 홈에서 짧은 알림 (D-055 2단계)
    const cw = activeOf(getState());
    const nPr = cw && cw.id === id ? prExerciseCount(cw, historyOf(getState())) : 0;
    const r = await finishActiveWorkout(id, at); // 실패 문구는 finishActiveWorkout이 남김
    if (!r.ok) return false;
    go('#/');
    void afterWorkoutFinished(Promise.allSettled([sendNow('workout'), syncNow('finish')]));
    if (nPr) showToast(`기록 갱신 ${nPr}개 운동 (앱 기준)`, 'star');
    return true;
  } finally { busy = false; }
}

/** 기록하지 않고 버리기 → 홈 (D-072) */
export async function discardAndHome(id: string): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const r = await discardActiveWorkout(id);
    if (!r.ok) return false;
    go('#/');
    showToast('기록하지 않고 버렸어요');
    return true;
  } finally { busy = false; }
}

/** 완료 세트 0개일 때 묻기 (기본: 버리기). true = 무엇이든 했음 */
async function askEmpty(id: string): Promise<boolean> {
  const a = await askChoice({ title: '운동을 끝낼까요?', message: '완료한 세트가 없어요. 기록하지 않고 버릴까요?', ok: '기록하지 않고 버리기', alt: '기록 남기고 끝내기' });
  if (a === 'ok') return discardAndHome(id);
  if (a === 'alt') return finishAndAfter(id, 'now');
  return false;
}

/**
 * 끝내기 버튼. left = 남은 세트 수 (안내용). plain = 일반 확인 없이 바로 (모든 세트 완료 버튼).
 * 묻는 동안 기록이 바뀔 수 있어 끝낼 때 저장된 최신 기록으로 다시 계산 (finishActiveWorkout)
 */
export async function askAndFinish(id: string, opts: { left?: number; plain?: boolean } = {}): Promise<boolean> {
  try { await flushPending(); } catch { /* 저장 실패는 끝내기에서 다시 알림 */ }
  const w = activeOf(getState());
  if (!w || w.id !== id) return finishAndAfter(id); // 이유는 finishActiveWorkout이 보여 줌
  if (doneCount(w) === 0) return askEmpty(id);
  const now = Date.now();
  const left = opts.left ? `아직 ${opts.left}세트 남았어요.\n` : '';
  if (shouldAskEndTime(w, now)) {
    const last = lastDoneMs(w)!;
    const a = await askChoice({
      title: '운동을 끝낼까요?',
      message: `${left}마지막 세트: ${whenText(last, now)}\n끝난 시각을 언제로 할까요?`,
      ok: `마지막 세트 + 3분 (${whenText(endAtLastSet(w, now), now)})`, alt: `지금 (${timeText(now)})`, focusCancel: true,
    });
    if (a === 'ok') return finishAndAfter(id, 'last');
    if (a === 'alt') return finishAndAfter(id, 'now');
    return false;
  }
  if (opts.plain) return finishAndAfter(id, 'now');
  if (!(await askConfirm({ title: '운동을 끝낼까요?', message: left.trim() || undefined, ok: '끝내기', danger: true }))) return false;
  return finishAndAfter(id, 'now');
}

/** "운동 끝났나요?" 띠의 [끝내기]: 마지막 세트 + 3분으로 바로 (세트가 없으면 버리기를 물음) */
export async function finishFromBanner(id: string): Promise<boolean> {
  const w = activeOf(getState());
  if (w && w.id === id && doneCount(w) === 0) return askEmpty(id);
  return finishAndAfter(id, 'last');
}
