/**
 * 운동 끝내기 묻기와 끝낸 뒤 할 일 (D-038, D-065, D-072). 운동 화면과 "운동 끝났나요?" 띠가 같이 씀.
 *  - 완료 세트 0개: "기록하지 않고 버리기"가 기본 (기록 남기고 끝내기도 고를 수 있음)
 *  - 마지막 세트가 15분 넘게 지남: 끝난 시각 = "마지막 세트 + 3분" / "지금"
 *  - 그 밖: 지금처럼 "운동을 끝낼까요?"
 */
import { activeOf, historyOf, getState, flushPending } from './store';
import { askConfirm, askChoice } from './confirm';
import { finishActiveWorkout, discardActiveWorkout, setFinishError, applyWorkoutToRoutine, saveWorkoutAsRoutine } from './actions';
import { routineDiff, diffText, routineChangedDuring } from '../core/routineDiff';
import { catalog } from './catalog';
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
    const moved = waitHash('#/');
    go('#/');
    // 끝낸 뒤 루틴 반영 묻기 (D-068). 홈으로 옮긴 뒤에 (화면이 바뀌면 열린 확인 창이 닫히므로)
    const dialogs = moved.then(() => offerRoutineUpdate(id));
    // D-064 단축어 자동 실행은 묻는 창이 닫힌 뒤에 (창이 열린 채 앱을 떠나지 않게). 끝난 시각 창은 이미 닫힘(끝내기 전에 물음)
    void afterWorkoutFinished(Promise.allSettled([sendNow('workout'), syncNow('finish')]), dialogs);
    if (nPr) showToast(`기록 갱신 ${nPr}개 운동 (앱 기준)`, 'star');
    return true;
  } finally { busy = false; }
}

/** 해시가 h로 바뀐 뒤 (이미 h면 바로). 늦어도 0.5초 */
function waitHash(h: string): Promise<void> {
  if (location.hash === h || (h === '#/' && (location.hash === '' || location.hash === '#'))) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { window.removeEventListener('hashchange', done); clearTimeout(t); setTimeout(res, 0); };
    const t = setTimeout(done, 500);
    window.addEventListener('hashchange', done);
  });
}

/**
 * 루틴으로 시작한 운동을 끝낸 뒤, 운동 구성이 루틴과 달라졌으면 묻기 (D-068):
 * [루틴 업데이트] = 이번 운동 목록·순서·세트 수로 루틴을 바꿈 / [새 루틴으로 저장] / [원래대로] = 아무것도 안 함.
 * 무게·횟수·세트 완료만 바뀐 것은 묻지 않음. 루틴이 지워졌으면 묻지 않음
 */
export async function offerRoutineUpdate(id: string): Promise<void> {
  const st = getState();
  const w = st.workouts.find((x) => x.id === id);
  if (!w?.endedAt || !w.routineId) return;
  const r = st.routines.find((x) => x.id === w.routineId);
  if (!r) return;
  const d = routineDiff(r, w);
  if (!d.changed) return;
  const byId = new Map(catalog(st.custom).map((e) => [e.id, e]));
  const what = diffText(d, (x) => byId.get(x)?.name_ko ?? x);
  // 운동하는 동안 루틴이 바뀌었으면(다른 화면·기기에서 고침) 덮어쓰지 않게: [루틴 업데이트]는 빼고 경고, 기본은 원래대로
  // 주의: routine.updatedAt(다른 기기 시계일 수 있음)과 운동 시작 시각(이 기기 시계)을 비교함. 기기 시계가 달라 틀릴 수 있지만,
  // 틀려도 "바뀜"으로 보는 쪽(덮어쓰지 않음)으로 안전하게 기울게 한 것이라 최악이 루틴 미갱신 확인 창임
  if (routineChangedDuring(r, w)) {
    const b = await askConfirm({
      title: '운동 중 루틴이 바뀌었어요',
      message: `「${r.name}」 루틴이 이 운동을 시작한 뒤에 고쳐졌어요. 덮어쓰지 않도록 루틴 업데이트는 하지 않아요.\n이번 운동 구성:\n${what}\n새 루틴으로 저장할까요?`,
      ok: '새 루틴으로 저장', cancel: '원래대로', focusCancel: true,
    });
    if (b) { const n = await saveWorkoutAsRoutine(r, w); showToast(`새 루틴 「${n.name}」으로 저장했어요`); }
    return;
  }
  const a = await askChoice({
    title: '루틴에 반영할까요?',
    message: `이번 운동이 「${r.name}」 루틴과 달라요.\n${what}\n[루틴 업데이트]는 운동 목록·순서와 세트 수를 이번 운동대로 바꿔요 (무게·횟수는 넣지 않아요)`,
    ok: '루틴 업데이트', alt: '새 루틴으로 저장', cancel: '원래대로',
  });
  if (a === 'ok') {
    const n = await applyWorkoutToRoutine(r.id, w);
    showToast(n ? `「${r.name}」 루틴을 업데이트했어요` : '루틴을 찾지 못해 바꾸지 않았어요');
  } else if (a === 'alt') {
    const n = await saveWorkoutAsRoutine(r, w);
    showToast(`새 루틴 「${n.name}」으로 저장했어요`);
  }
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
