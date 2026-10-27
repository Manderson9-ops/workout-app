/**
 * "운동 끝났나요?" 띠 (D-065). 앱을 열거나 다시 볼 때(화면이 보이게 될 때) 이 기기 진행 중 운동의
 * 마지막 세트(없으면 시작) 뒤 30분이 지났으면 띄움. 휴식 타이머가 도는 동안은 안 띄움.
 * [아직 하는 중]·[나중에 기록할게요]를 고르면 그 운동에서는 다시 안 띄움 (이 기기만, localStorage)
 */
import { useEffect, useState } from 'preact/hooks';
import type { Workout } from '../core/session';
import { shouldAskEnded, lastDoneMs, endAtLastSet, whenText, restRunning, doneCount } from '../core/finishTime';
import { lsGet, lsSet } from './appName';
import { finishFromBanner } from './finishFlow';
import { Icon } from './icons';

export const END_ASK_KEY = 'endAsk.skip';
const MAX_KEEP = 30;

function skipped(): string[] {
  try { const v = JSON.parse(lsGet(END_ASK_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function skip(id: string): void {
  const l = skipped().filter((x) => x !== id);
  lsSet(END_ASK_KEY, JSON.stringify([...l, id].slice(-MAX_KEEP)));
}

export function EndAskBanner({ active }: { active: Workout | undefined }) {
  /** 마지막으로 확인한 때 물어보기로 한 운동 ID (열 때·다시 보일 때만 정함) */
  const [askFor, setAskFor] = useState<string | null>(null);
  const id = active?.id;
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      setAskFor(active && !skipped().includes(active.id) && shouldAskEnded(active, Date.now()) ? active.id : null);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
    // 운동이 바뀔 때(시작·끝)만 다시 확인. 세트를 하면 아래 조건(30분)에서 바로 사라짐
  }, [id]);
  const now = Date.now();
  if (!active || askFor !== active.id || restRunning(active, now) || !shouldAskEnded(active, now)) return null;
  const last = lastDoneMs(active);
  const none = doneCount(active) === 0;
  const close = () => { skip(active.id); setAskFor(null); };
  return (
    <div class="end-ask" role="region" aria-label="운동 끝났나요?">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <Icon name="alert" size={20} class="upd-ico" />
        <div class="grow">
          <strong>운동 끝났나요?</strong>
          <p class="upd-line">{last !== undefined ? `마지막 세트: ${whenText(last, now)}` : `시작: ${whenText(active.startedAt, now)} · 완료한 세트 없음`}</p>
        </div>
      </div>
      <div class="end-ask-btns">
        <button class="tonal" onClick={() => void finishFromBanner(active.id)}>
          {none ? '끝내기' : `끝내기 (마지막 세트 + 3분 · ${whenText(endAtLastSet(active, now), now)})`}
        </button>
        <div class="row">
          <button class="grow" onClick={close}>아직 하는 중</button>
          <button class="grow" onClick={close}>나중에 기록할게요</button>
        </div>
      </div>
    </div>
  );
}
