/**
 * [내 시간에 맞추기] 미리 보기 창 (D-067). 목표 시간을 바꿀 수 있고, 운동마다 세트 전 → 후와 자리 이동을 보여 줌.
 * [적용]을 눌러야 바뀜 (부르는 쪽이 루틴 저장). 계산은 core/routineFit.fitRoutine
 */
import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import type { Routine } from '../../core/session';
import { routineEstimate } from '../../core/session';
import type { Exercise } from '../../core/types';
import { fitRoutine, paceEstimate, isMainLift, moveSummary, FIT_MIN_SETS, RECENT_DAYS } from '../../core/routineFit';
import type { PaceLabel } from '../../core/routineFit';
import { paceOf, recentOf, targetOf } from '../pace';
import { Sheet, MiniStepper } from '../components';

const T_MIN = 10, T_MAX = 300, T_STEP = 5;

/** 루틴 카드·편집 화면 한 줄 (D-067): "내 속도로 약 52분 (최근 8회) · 목표 75분이면 못 할 운동 3개" + (카드) [시간 맞추기] */
export function PaceLine({ pl, onFit, name }: { pl: PaceLabel; onFit?: () => void; name?: string }) {
  return (
    <p class="sub small pace-line" data-testid="pace-line">
      <span class="pace-part">{pl.head}</span><span class={pl.cut ? 'pace-part pace-cut' : 'pace-part'}><span aria-hidden="true" class="pace-sep">·</span>{pl.tail}</span>
      {onFit && pl.cut > 0 && <button class="tonal fit-btn" onClick={onFit} aria-label={`${name ?? '이 루틴'} 내 시간에 맞추기`}>시간 맞추기</button>}
    </p>
  );
}

export function FitSheet({ s, r, byId, onApply, onClose }: { s: AppState; r: Routine; byId: Map<string, Exercise>; onApply: (next: Routine) => void; onClose: () => void }) {
  const [target, setTarget] = useState(() => targetOf(s, r));
  const pace = paceOf(s);
  const partOf = (id: string) => byId.get(id)?.part;
  const estimate = pace ? (x: Routine) => paceEstimate(x, pace) : (x: Routine) => routineEstimate(x, byId, s.settings.rest.between) + (x.warmupSec ?? 0);
  // 첫 블록·주 운동(바벨 복합 운동) 블록은 제자리 (B3)
  const f = fitRoutine({ routine: r, targetSec: target * 60, estimate, partOf, recent: recentOf(s, partOf), isMain: (id) => isMainLift(byId.get(id)) });
  const moved = moveSummary(f.rows, partOf);
  const changed = f.moved || f.reduced > 0;
  const nameOf = (id: string) => byId.get(id)?.name_ko ?? id;
  const m = (sec: number) => Math.round(sec / 60);
  return (
    <Sheet title="내 시간에 맞추기" onClose={onClose} modal trap cls="fit-sheet">
      <div class="row between fit-target">
        <span class="sub small">목표 시간</span>
        <MiniStepper label="목표 시간" mid={`${target}분`}
          dec={{ aria: '목표 시간 5분 줄이기', off: target <= T_MIN, on: () => setTarget(Math.max(T_MIN, target - T_STEP)) }}
          inc={{ aria: '목표 시간 5분 늘리기', off: target >= T_MAX, on: () => setTarget(Math.min(T_MAX, target + T_STEP)) }} />
      </div>
      <p class="fit-sum" aria-live="polite"><b>약 {m(f.beforeSec)}분 → {m(f.afterSec)}분</b> <span class="sub small">(목표 {target}분)</span></p>
      <p class="sub small">{pace ? `내 속도: 세트당 약 ${(pace.secPerSet / 60).toFixed(1)}분 (최근 ${pace.n}회 기록)` : '기록이 3회보다 적어 앱 기본 예상으로 계산해요'}</p>
      {/* D-067 남은 일: 카드에서 뺀 앱 기본 예상은 여기서만 (비교용) */}
      {pace && <p class="sub small" data-testid="fit-app-default">앱 기본 예상: 약 {m(r.estimatedSec ?? routineEstimate(r, byId, s.settings.rest.between) + (r.warmupSec ?? 0))}분</p>}
      <p class="sub small">운동당 세트를 줄여요 ({FIT_MIN_SETS}세트 아래로는 안 줄임) · 최근 {RECENT_DAYS}일 많이 한 부위부터 줄이고, 덜 한 부위를 앞으로 (첫 운동·바벨 주 운동은 제자리)</p>
      {!f.fits && <p class="warn-text fit-warn" role="note">{FIT_MIN_SETS}세트까지 줄여도 약 {m(f.afterSec)}분이에요. 운동을 빼거나 목표 시간을 늘려 주세요</p>}
      {!changed && <p class="sub" role="note">이미 목표 시간 안이에요. 바꿀 게 없어요</p>}
      {changed && moved && <p class="fit-move" data-testid="fit-move">{moved}</p>}
      {changed && (
        <ol class="fit-rows" aria-label="바뀌는 점">
          {f.rows.map((x, k) => (
            <li key={k} class={`fit-row${x.before !== x.after ? ' cut' : ''}`}>
              <span class="grow">{x.letter ? `${x.letter}. ` : ''}{nameOf(x.exerciseId)}</span>
              <span class="fit-sets" aria-label={x.before === x.after ? `${x.after}세트 그대로` : `${x.before}세트에서 ${x.after}세트로`}>{x.before === x.after ? `${x.after}세트` : `${x.before} → ${x.after}세트`}</span>
            </li>
          ))}
        </ol>
      )}
      {/* 아래 버튼은 창 아래에 붙어 있음 (PC에서 목록이 길어도 바로 보임) */}
      <div class="row sheet-foot fit-foot">
        <button class="big grow" onClick={onClose}>취소</button>
        <button class="big grow primary" disabled={!changed} onClick={() => onApply(f.routine)}>적용</button>
      </div>
    </Sheet>
  );
}
