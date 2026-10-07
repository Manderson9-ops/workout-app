import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { activeOf, historyOf, mutate, flushPending, getState } from '../store';
import { catalog } from '../catalog';
import type { Workout, Step, SetLog } from '../../core/session';
import {
  currentStep, completeSet, undoSet, updateSet, stepSet, setItemMemo, setWorkoutMemo, addSet, removeSet, skipItem, replaceItem, appendExercise, moveWorkoutBlock,
  adjustTimer, clearTimer, timerRemaining, progress, restAfter,
} from '../../core/session';
import { setTime, targetReps } from '../../core/time';
import { GradeBadge, Stepper, NumInput, ExercisePicker, MemoSheet, MenuSheet, Metric, mmss } from '../components';
import type { MenuItem } from '../components';
import { Icon } from '../icons';
import { summarize } from '../../core/stats';
import { previousSetsFor, prevFor, prevText, workoutPRs, prExerciseCount, ringDash } from '../../core/workoutHistory';
import type { PrKind, PrevSets } from '../../core/workoutHistory';
import { showToast } from '../toast';
import { ScreenHeader } from '../header';
import { resolveGrade } from '../../core/exercises';
import { hasDbInfo } from '../../core/planEdit';
import { updateWorkoutAfterInputs, finishActiveWorkout, useFinishError, setFinishError } from '../actions';
import { askConfirm } from '../confirm';
import { PlateSheet } from './Tools';
import { go } from '../nav';
import { RoutineList } from './MyRoutines';
import { softDelete } from '../../db/db';

import { unlockAudio, wasAlerted, markAlerted, audioState, playEndSound, playWarnSound } from '../device';
import { diagTimerEnd, diagHaptic } from '../diag';
import { haptic, hapticOn, buzzOnTime } from '../haptics';
import { lsGet, lsSet } from '../appName';

/** D-056 휴식 안내를 본 기기 (이 기기만) */
export const REST_HINT_KEY = 'hint.restSilent';
import { sendNow } from '../autoSend';
import { syncNow } from '../sync';
import { remoteActiveOf } from '../store';
import { useDragSort } from '../dragSort';
import { remapIndex } from '../../core/reorder';

export function WorkoutScreen({ s }: { s: AppState }) {
  const w = activeOf(s);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ mode: 'swap'; b: number; i: number } | { mode: 'add' } | null>(null);
  const [ended, setEnded] = useState(false);
  const [plate, setPlate] = useState<number | null>(null);
  /** 펼친 세트 줄 (번호를 누르면 RIR·메모). 키 = "블록-운동-세트" */
  const [detail, setDetailKey] = useState<string | null>(null);
  /** ⋯ 메뉴를 연 운동 */
  const [menu, setMenu] = useState<{ b: number; i: number } | null>(null);
  /** 운동 화면이 뜬 시각 (휴식이 끝날 때 이 화면에 있었는지 판정용, 진단) */
  const shownAt = useRef(Date.now());
  // D-056: 이 기기에서 처음 휴식이 시작될 때 한 번 "무음 모드면 소리 대신 진동" 안내 (그 휴식 동안만, 닫을 수 있음)
  const [hintFor, setHintFor] = useState<number | null>(null);
  const restId = w?.timer?.startedAt;
  useEffect(() => {
    if (restId === undefined || lsGet(REST_HINT_KEY)) return;
    lsSet(REST_HINT_KEY, '1'); setHintFor(restId);
  }, [restId]);
  // PC 키보드: Ctrl+Enter(맥 ⌘+Enter) = 현재 세트 완료 (D-030)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // 누르고 있기(반복)·한글 조합 중·시트(메모·교체 등)가 열려 있을 때는 무시
      if (e.repeat || e.isComposing || document.querySelector('.sheet')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.querySelector<HTMLButtonElement>('[aria-label="현재 세트 완료"]')?.click(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const [memo, setMemo] = useState<{ title: string; value?: string; save: (m: string | undefined) => void } | null>(null);
  const warned = useRef<number>(0);
  /** 운동 끝내기가 안 됐을 때 이유 (D-038). 타이머 자리(화면 아래 고정)에 보여 어느 위치에서 눌러도 보임 */
  const finishErr = useFinishError();
  const finishing = useRef(false);
  /** 확인 뒤 끝내기. 두 번 눌러도 한 번만 */
  const doFinish = async (id: string) => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      setFinishError(null);
      // 끝내기 전에 기록 갱신(앱 기준) 운동 수를 셈 → 홈에서 짧은 알림 (D-055 2단계)
      const cw = activeOf(getState());
      const nPr = cw && cw.id === id ? prExerciseCount(cw, historyOf(getState())) : 0;
      const r = await finishActiveWorkout(id); // 실패 문구는 finishActiveWorkout이 setFinishError로 남김
      if (r.ok) { go('#/'); void sendNow('workout'); void syncNow('finish'); if (nPr) showToast(`기록 갱신 ${nPr}개 운동 (앱 기준)`, 'star'); }
    } finally { finishing.current = false; }
  };
  // 블록 끌어서 순서 바꾸기 (D-037). 펼친 카드는 옮긴 자리를 따라감
  // 이동은 하나씩 차례로 (빠르게 ↓↓ 눌러도 순서가 뒤바뀌지 않게), 펼친 카드는 저장된 뒤에 따라감 (깜빡임 방지)
  const moveQ = useRef<Promise<void>>(Promise.resolve());
  const dnd = useDragSort(w?.blocks.length ?? 0, (from, to) => {
    if (!w) return;
    const id = w.id;
    moveQ.current = moveQ.current.then(async () => {
      await updateWorkoutAfterInputs(id, (cw) => moveWorkoutBlock(cw, from, to));
      setOpen((o) => (o === null || o < 0 ? o : remapIndex(o, from, to)));
    }).catch(() => undefined);
  }, (i) => (w?.blocks[i]?.items.map((it) => byId.get(it.exerciseId)?.name_ko ?? it.exerciseId).join(' + ') ?? ''));
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  // 지난번·기록 갱신 계산은 기록(s.workouts)·지금 운동(w)이 바뀔 때만 (1초마다 다시 그려도 전체 기록을 다시 훑지 않음, 검토 v0.9.1)
  const histMemo = useMemo(() => historyOf(s), [s.workouts]);
  const prsMemo = useMemo(() => (w ? workoutPRs(w, histMemo) : new Map<string, PrKind>()), [w, histMemo]);
  const prevCache = useMemo(() => new Map<string, PrevSets>(), [histMemo, w?.id]);

  // 표시 시각은 렌더 순간의 현재 시각 (250ms 틱은 다시 그리기용). 오래된 시각이면 설정보다 1초 길게 보일 수 있음
  const nowMs = Math.max(now, Date.now());
  const rem = w ? timerRemaining(w.timer, nowMs) : 0;
  const curKey = w ? JSON.stringify(currentStep(w) ?? null) : '';
  useEffect(() => {
    // 현재 세트가 타이머에 가리지 않게 화면 가운데로
    const el = document.querySelector('.set-row.current');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curKey]);
  useEffect(() => {
    if (!w?.timer) { setEnded(false); return; }
    const key = w.timer.endsAt;
    // 10초 전: 알림음 한 번 + (진동 켬이면) 짧게 한 번. 10초 전 알림은 예전처럼 "소리 켬"일 때 기능 (D-056)
    if (rem <= 10 && rem > 0 && warned.current !== key) { warned.current = key; if (s.settings.soundOn) { playWarnSound(); if (hapticOn()) haptic(1); } }
    if (rem === 0 && !wasAlerted(key)) {
      markAlerted(key); setEnded(true);
      diagTimerEnd(key, s.settings.soundOn, audioState(), shownAt.current);
      if (s.settings.soundOn) playEndSound();
      // 휴식 끝 진동 3번 (D-056). 다른 앱에 있다가 늦게 돌아왔으면(끝난 지 5초 넘음) 진동하지 않음
      if (hapticOn()) {
        if (buzzOnTime(key, Date.now())) diagHaptic(haptic(3));
        else diagHaptic('late');
      }
    }
  }, [rem, w?.timer?.endsAt]);

  if (!w) {
    return (
      <main>
        <ScreenHeader title="운동" />
        {remoteActiveOf(s) && <p role="status" class="card small">운동 「{remoteActiveOf(s)!.name}」은 다른 기기에서 진행 중이에요 (다른 기기로 넘어갔어요). 홈에서 볼 수 있어요.</p>}
        {finishErr && <div class="finish-err row between" style={{ alignItems: 'flex-start' }}><p role="alert" class="err-line"><Icon name="alert" size={18} />{finishErr}</p><button class="ghost icon-btn" aria-label="알림 닫기" onClick={() => setFinishError(null)}><Icon name="close" size={18} /></button></div>}
        <p class="sub">진행 중인 운동이 없어요. 루틴을 골라 시작하세요.</p>
        <div class="row between"><h2>루틴 고르기</h2><div class="row"><button onClick={() => go('#/routines')}>내 루틴 관리</button><button class="primary" onClick={() => go('#/plan')}>+ 플랜</button></div></div>
        <RoutineList s={s} mode="pick" />
      </main>
    );
  }

  // 모든 변경은 입력 중인 값(늦춘 저장)을 먼저 저장한 뒤 적용 (아이폰은 버튼을 눌러도 입력칸 포커스가 안 빠짐)
  const upd = (fn: (x: Workout) => Workout) => updateWorkoutAfterInputs(w.id, fn);
  const cur = currentStep(w);
  const openIdx = open ?? cur?.block ?? 0;
  const history = histMemo;
  const prog = progress(w, nowMs, (id, reps) => { const e = byId.get(id); return e ? setTime(e, reps) : 40; });
  const nameOf = (id: string) => byId.get(id)?.name_ko ?? id;
  const complete = (st: Step) => { unlockAudio(); setEnded(false); void upd((cw) => completeSet(cw, st, Date.now())); setOpen(null); };
  const curItem = cur ? w.blocks[cur.block]!.items[cur.item]! : undefined;
  const nextRest = cur ? restAfter(w, cur) : null;
  // D-055 2단계: 볼륨(완료 작업 세트), 기록 갱신(앱 기준)
  const volume = summarize(w, byId, s.bodyweight).volume;
  const prs = prsMemo;
  const isBar = (exId: string) => !!byId.get(exId)?.equipment.some((e) => e === 'barbell' || e === 'smith');
  const openPlate = async (b: number, i: number, k: number) => { await flushPending(); setPlate(activeOf(getState())?.blocks[b]?.items[i]?.sets[k]?.weight ?? 20); };

  /** 세트 줄 아래 펼침: 현재 세트는 늘 2줄 (① 무게·횟수 −/+ · 원판, ② RIR · 메모), 다른 세트는 번호를 누르면 (RIR, 원판, 메모) */
  const detailRow = (b: number, i: number, k: number, x: SetLog, isCur: boolean, label: string, timeEx: boolean) => {
    const st = { block: b, item: i, set: k };
    const it = w.blocks[b]!.items[i]!;
    return (
      <div class="set-detail">
        {isCur && (
          /* 값은 위 줄 칸에만 (되풀이하지 않음). 버튼만: kg −2.5 +2.5 · 회 −1 +1 (시간 운동은 초 −5 +5) */
          <div class="row nudge" role="group" aria-label={`${label} 빠른 조절`}>
            <span class="nudge-k" aria-hidden="true">kg</span>
            <button class="tonal nudge-b" aria-label={`${label} 무게 조절 줄이기`} title="2.5kg 줄이기" onClick={() => void upd((cw) => stepSet(cw, st, 'weight', -2.5))}>−2.5</button>
            <button class="tonal nudge-b" aria-label={`${label} 무게 조절 늘리기`} title="2.5kg 늘리기" onClick={() => void upd((cw) => stepSet(cw, st, 'weight', 2.5))}>+2.5</button>
            <span class="nudge-k" aria-hidden="true">{timeEx ? '초' : '회'}</span>
            {timeEx ? <>
              <button class="tonal nudge-b" aria-label={`${label} 초 조절 줄이기`} title="5초 줄이기" onClick={() => void upd((cw) => stepSet(cw, st, 'seconds', -5))}>−5</button>
              <button class="tonal nudge-b" aria-label={`${label} 초 조절 늘리기`} title="5초 늘리기" onClick={() => void upd((cw) => stepSet(cw, st, 'seconds', 5))}>+5</button>
            </> : <>
              <button class="tonal nudge-b" aria-label={`${label} 횟수 조절 줄이기`} title="1회 줄이기" onClick={() => void upd((cw) => stepSet(cw, st, 'reps', -1))}>−1</button>
              <button class="tonal nudge-b" aria-label={`${label} 횟수 조절 늘리기`} title="1회 늘리기" onClick={() => void upd((cw) => stepSet(cw, st, 'reps', 1))}>+1</button>
            </>}
            {isBar(it.exerciseId) && <button class="chip nudge-plate" aria-label={`${label} 원판 계산`} onClick={() => void openPlate(b, i, k)}>원판</button>}
          </div>
        )}
        <div class="row wrap small set-tools">
          {!x.warmup && <>
            <span class="sub" title="남은 횟수 여유 (RIR)">RIR</span>
            {[0, 1, 2, 3].map((r) => <button key={r} class={`chip ${x.rir === r ? 'on' : ''}`} aria-pressed={x.rir === r} onClick={() => upd((cw) => updateSet(cw, st, { rir: x.rir === r ? undefined : r }))}>{r}{r === 3 ? '+' : ''}</button>)}
          </>}
          {!isCur && isBar(it.exerciseId) && <button class="chip" aria-label={`${label} 원판 계산`} onClick={() => void openPlate(b, i, k)}>원판</button>}
          <button class="chip" aria-label={`${label} 메모`} onClick={() => setMemo({ title: `${label} 메모`, value: x.memo, save: (m) => void upd((cw) => updateSet(cw, st, { memo: m })) })}>메모</button>
        </div>
      </div>
    );
  };

  const setRow = (b: number, i: number, k: number, x: SetLog, prevSet: SetLog | undefined) => {
    const st = { block: b, item: i, set: k };
    const isCur = !!cur && cur.block === b && cur.item === i && cur.set === k;
    const it = w.blocks[b]!.items[i]!;
    const timeEx = it.target.seconds !== undefined;
    const workNo = it.sets.slice(0, k + 1).filter((z) => !z.warmup).length;
    const label = `${nameOf(it.exerciseId)} ${x.warmup ? '웜업' : workNo + '세트'}`;
    const key = `${b}-${i}-${k}`;
    const pr = x.done ? prs.get(key) : undefined;
    const expanded = isCur || detail === key;
    const prevTxt = prevText(prevSet, timeEx);
    return (
      <div key={k} class="set-wrap">
        <div class={`set-row ${x.done ? 'done' : ''} ${isCur ? 'current' : ''} ${x.warmup ? 'warm' : ''}`}>
          <button class="set-idx" aria-label={`${label} 자세히 (RIR·메모)`} aria-expanded={expanded} title="누르면 RIR·메모" onClick={() => { if (!isCur) setDetailKey(detail === key ? null : key); }}><span class="idx-n">{x.warmup ? 'W' : workNo}</span><Icon name="chevron" size={12} class={`idx-chev${expanded ? ' open' : ''}`} /></button>
          <span class="set-prev" aria-label={`${label} 지난번 ${prevTxt === '-' ? '없음' : prevTxt}`}>{prevTxt}</span>
          <NumInput pendingKey={`${b}-${i}-${k}-w`} label={`${label} 무게`} value={x.weight} suffix="" onChange={(v) => upd((cw) => updateSet(cw, st, { weight: v }))} />
          {timeEx
            ? <NumInput integer pendingKey={`${b}-${i}-${k}-s`} label={`${label} 초`} value={x.seconds} suffix="" onChange={(v) => upd((cw) => updateSet(cw, st, { seconds: v }))} />
            : <NumInput integer pendingKey={`${b}-${i}-${k}-r`} label={`${label} 횟수`} value={x.reps} suffix="" onChange={(v) => upd((cw) => updateSet(cw, st, { reps: v }))} />}
          {x.done
            ? <button class="check done" aria-label="완료 취소" title={`${label} 완료됨 (누르면 완료 취소)`} onClick={() => upd((cw) => undoSet(cw, st))}><Icon name="check" size={22} /></button>
            : <button class={`check ${isCur ? 'cur' : ''}`} aria-label={`${label} 완료`} onClick={() => complete(st)}><Icon name="check" size={22} /></button>}
        </div>
        {pr && (
          <div class="pr-line" title="앱 기준: 추정 1RM(Epley, 12회 이하)이 지난 최고보다 크거나, 지난 어떤 세트보다 무겁거나, 그 무게 이상에서 횟수가 더 많음">
            <span class="pr-badge"><Icon name="star" size={14} />기록 갱신</span>
            <span class="sub small">{pr === '1rm' ? '추정 1RM 최고' : pr === 'weight' ? '가장 무거운 무게' : '이 무게 이상 최다 횟수'} · 앱 기준</span>
          </div>
        )}
        {expanded && detailRow(b, i, k, x, isCur, label, timeEx)}
        {x.memo && <div class="pill set-memo memo-line"><Icon name="note" size={14} />{x.memo}</div>}
      </div>
    );
  };

  /** 운동 하나의 ⋯ 메뉴 (교체·건너뛰기/되살리기·메모·원판·정보) */
  const itemMenu = (bi: number, ii: number): MenuItem[] => {
    const it = w.blocks[bi]!.items[ii]!;
    const n = nameOf(it.exerciseId);
    const firstOpen = Math.max(0, it.sets.findIndex((x) => !x.done));
    return [
      { label: '교체', aria: `${n} 교체`, run: () => setPicker({ mode: 'swap', b: bi, i: ii }) },
      { label: it.skipped ? '되살리기' : '건너뛰기', aria: `${n} ${it.skipped ? '되살리기' : '건너뛰기'}`, run: () => void upd((cw) => skipItem(cw, bi, ii, !it.skipped)) },
      { label: '운동 메모', aria: `${n} 메모`, run: () => setMemo({ title: `${n} 메모`, value: it.memo, save: (m) => void upd((cw) => setItemMemo(cw, bi, ii, m)) }) },
      ...(isBar(it.exerciseId) ? [{ label: '원판 계산', aria: `${n} 원판 계산기`, run: () => void openPlate(bi, ii, firstOpen) }] : []),
      { label: '정보 (영상 등급·자세 포인트)', aria: `${n} 정보 보기`, run: () => go(`#/exercises/${encodeURIComponent(it.exerciseId)}`) },
    ];
  };
  const menuBtn = (bi: number, ii: number) => (
    <button class="icon-btn round wk-more" aria-label={`${nameOf(w.blocks[bi]!.items[ii]!.exerciseId)} 메뉴`} aria-haspopup="dialog" onClick={() => setMenu({ b: bi, i: ii })}><Icon name="more" /></button>
  );
  const infoLink = (exId: string) => {
    const ex = byId.get(exId);
    return hasDbInfo(ex)
      ? <a class="btn info-btn info-db" href={`#/exercises/${encodeURIComponent(exId)}`} aria-label={`${nameOf(exId)} 정보 (내 운동 DB: 영상 등급·자세 포인트)`} title="내 운동 DB 있음 (영상 등급·자세 포인트)"><span class="ib-dot"><Icon name="exercises" size={18} /></span></a>
      : <a class="btn info-btn" href={`#/exercises/${encodeURIComponent(exId)}`} aria-label={`${nameOf(exId)} 정보 (DB 없음)`} title="정보 (내 운동 DB 없음)"><span class="ib-dot"><Icon name="info" size={18} /></span></a>;
  };

  // 브라우저 기본 confirm()은 조용히 취소될 수 있어 앱 안 확인 창을 씀 (D-038)
  const finish = async () => {
    const left = prog.totalSets - prog.doneSets;
    const id = w.id;
    if (!(await askConfirm({ title: '운동을 끝낼까요?', message: left ? `아직 ${left}세트 남았어요.` : undefined, ok: '끝내기', danger: true }))) return;
    await doFinish(id);
  };
  const delta = prog.deltaSec;
  const timerOn = !!w.timer && (rem > 0 || ended);
  const total = w.timer ? Math.max(1, Math.round((w.timer.endsAt - w.timer.startedAt) / 1000)) : 1;
  const R = 18; const ring = ringDash(rem, total, 2 * Math.PI * R); // 남은 비율만큼 칠함 → 줄어듦
  // 다음 세트 요약 (도크 한 줄, 캡션)
  const curSetLabel = cur && curItem ? (curItem.sets[cur.set]!.warmup ? '웜업' : `${curItem.sets.slice(0, cur.set + 1).filter((z) => !z.warmup).length}세트`) : '';
  const curLetter = cur && w.blocks[cur.block]!.kind !== 'single' ? `${String.fromCharCode(65 + cur.item)}. ` : '';
  const nextText = cur && curItem ? `${curLetter}${nameOf(curItem.exerciseId)} ${curSetLabel}` : '';
  const menuItem = menu ? w.blocks[menu.b]?.items[menu.i] : undefined;

  return (
    <main class="wk-main">
      <ScreenHeader eyebrow="운동 중" title={w.name}>
        <div class="row head-actions wk-actions">
          <button class="ghost" aria-label="운동 메모" onClick={() => setMemo({ title: '오늘 운동 메모', value: w.memo, save: (m) => void upd((cw) => setWorkoutMemo(cw, m)) })}><Icon name="note" size={18} />메모</button>
          <button class="wk-finish" onClick={finish}>끝내기</button>
        </div>
      </ScreenHeader>
      {w.memo && <p class="sub small memo-line"><Icon name="note" size={14} />{w.memo}</p>}
      {/* 숫자 3개 (D-055 2단계): 경과 시간(파랑)·볼륨·세트 */}
      <section class="wk-metrics" aria-label="운동 진행">
        <div class="metrics3">
          <Metric label="시간" parts={[[mmss(prog.elapsedSec), '']]} statusClass="sub">{`남은 예상 ${mmss(prog.remainingSec)}`}</Metric>
          <Metric label="볼륨" parts={[[volume.toLocaleString(), 'kg']]} />
          <Metric label="세트" parts={[[`${prog.doneSets}/${prog.totalSets}`, '세트']]} />
        </div>
        <div class="progress" aria-hidden="true"><div style={{ width: `${prog.totalSets ? (100 * prog.doneSets) / prog.totalSets : 0}%` }} /></div>
        {delta !== undefined && Math.abs(delta) >= 60 && <div class="sub small wk-delta" aria-label="예정 대비">{delta > 0 ? `예정보다 약 ${Math.round(delta / 60)}분 늦음` : `예정보다 약 ${Math.round(-delta / 60)}분 빠름`}</div>}
      </section>
      <p class="sr-only" aria-live="polite">{dnd.msg}</p>

      {w.blocks.map((b, bi) => {
        const isOpen = bi === openIdx;
        const doneAll = b.items.every((it) => it.skipped || it.sets.every((x) => x.done));
        const single = b.kind === 'single';
        return (
          <div class={`card wk-card ${cur?.block === bi ? 'active' : ''} ${doneAll ? 'all-done' : ''}`} key={bi} {...dnd.itemAttrs(bi)}>
            <div class="row wk-head">
              {w.blocks.length > 1 && <button {...dnd.handleProps(bi)}>≡</button>}
              <div class="row between grow wk-title" onClick={() => setOpen(isOpen ? -1 : bi)} role="button" aria-expanded={isOpen}>
                <div class="grow">
                  {!single && <span class="badge kind">{b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'} · 번갈아</span>}
                  <div><strong>{b.items.map((it) => nameOf(it.exerciseId)).join(' + ')}</strong>{doneAll && <span class="done-chip"><Icon name="check" size={14} />완료</span>}</div>
                  <div class="pill">{single ? `세트 간 휴식 ${b.restSec}초` : `라운드 후 휴식 ${b.roundRestSec}초`}</div>
                </div>
                <Icon name="chevron" size={18} class={`wk-chev${isOpen ? ' open' : ''}`} />
              </div>
              {single && menuBtn(bi, 0)}
            </div>
            {isOpen && b.items.map((it, ii) => {
              const ex = byId.get(it.exerciseId);
              const g = ex ? resolveGrade(ex, ex.part, s.settings.level, undefined, s.meta.get(ex.id)?.userGrade) : undefined;
              const prev = prevCache.get(it.exerciseId) ?? (() => { const p = previousSetsFor(history, it.exerciseId, w.id); prevCache.set(it.exerciseId, p); return p; })();
              const timeEx = it.target.seconds !== undefined;
              return (
                <div key={ii} class={`wk-item${it.skipped ? ' skipped' : ''}`}>
                  <div class="row wk-item-head">
                    {g && <GradeBadge g={g} />}
                    {!single ? <strong class="grow">{String.fromCharCode(65 + ii)}. {nameOf(it.exerciseId)}</strong> : <span class="grow sub small">{it.skipped ? '건너뜀' : `지난번 ${prev.at ? new Date(prev.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '기록 없음'}`}</span>}
                    {infoLink(it.exerciseId)}
                    {!single && menuBtn(bi, ii)}
                  </div>
                  {!it.skipped && (
                    <div class="set-table">
                      <div class="set-row set-head" aria-hidden="true"><span>세트</span><span>지난번</span><span>kg</span><span>{timeEx ? '초' : '회'}</span><span><Icon name="check" size={16} /></span></div>
                      {it.sets.map((x, k) => setRow(bi, ii, k, x, prevFor(prev, it.sets, k)))}
                    </div>
                  )}
                  {!it.skipped && (
                    <div class="row set-foot">
                      <button class="tonal" onClick={() => upd((cw) => addSet(cw, bi, ii))}>+ 세트</button>
                      <button class="tonal" onClick={() => upd((cw) => addSet(cw, bi, ii, true))}>+ 웜업</button>
                      {it.sets.length > 1 && !it.sets[it.sets.length - 1]!.done && <button class="tonal" onClick={() => upd((cw) => removeSet(cw, { block: bi, item: ii, set: it.sets.length - 1 }))}>− 세트</button>}
                    </div>
                  )}
                  {it.skipped && <button class="tonal" onClick={() => upd((cw) => skipItem(cw, bi, ii, false))}>되살리기</button>}
                  {it.memo && <p class="sub small memo-line"><Icon name="note" size={14} />{it.memo}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
      <button class="big" onClick={() => setPicker({ mode: 'add' })}>+ 운동 추가</button>
      <button class="big wk-finish wk-finish-bottom" onClick={finish}>운동 끝내기</button>

      {/* 아래 도크 하나 (D-055 2단계): 휴식 중 = [고리·남은 시간·다음] [−15] [+15] [건너뛰기] [✓ 현재 세트 완료], 아닐 때 = 넓은 완료 버튼 한 줄 */}
      <div class={`timer dock${w.timer && rem === 0 ? ' end flash' : ''}`} role="timer" aria-live="polite">
        {finishErr && <div class="finish-err row between" style={{ alignItems: 'flex-start' }}><p role="alert" class="err-line"><Icon name="alert" size={18} />{finishErr}</p><button class="ghost icon-btn" aria-label="알림 닫기" onClick={() => setFinishError(null)}><Icon name="close" size={18} /></button></div>}
        {timerOn && w.timer && hintFor === w.timer.startedAt && (
          <div class="rest-hint" role="note" aria-label="휴식 알림 안내">
            <Icon name="info" size={18} /><span class="grow">무음 모드면 소리 대신 진동으로 알려요</span>
            <button class="ghost icon-btn" aria-label="안내 닫기" onClick={() => setHintFor(null)}><Icon name="close" size={18} /></button>
          </div>
        )}
        {timerOn && w.timer ? (
          <div class={`rest-pill${rem === 0 ? ' end' : ''}`}>
            <svg class="ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" data-fraction={ring.fraction.toFixed(3)}>
              <circle cx="22" cy="22" r={R} class="ring-bg" />
              <circle cx="22" cy="22" r={R} class="ring-fg" stroke-dasharray={`${ring.dasharray}`} stroke-dashoffset={`${ring.dashoffset}`} transform="rotate(-90 22 22)" />
            </svg>
            <div class="rp-mid grow">
              <div class="rp-num" aria-label={`휴식 남은 시간 ${rem}초`}>{mmss(rem)}</div>
              {/* 화면에는 짧게 "다음: …", 화면 읽기·시험에는 휴식 이름 전체 */}
              <div class="rp-label" aria-hidden="true">{rem > 0 ? (curSetLabel ? `다음 ${curLetter.replace('. ', ' ')}${curSetLabel}` : '휴식') : '휴식 끝!'}</div>
              <span class="sr-only">{rem > 0 ? w.timer.label : '휴식 끝! 다음 세트'}{nextText ? ` · 다음 ${nextText}` : ''}</span>
            </div>
            <button class="rp-btn" aria-label="15초 줄이기" onClick={() => upd((cw) => adjustTimer(cw, -15, Date.now()))}>−15</button>
            <button class="rp-btn" aria-label="15초 늘리기" onClick={() => upd((cw) => adjustTimer(cw, 15, Date.now()))}>+15</button>
            <button class="rp-btn" aria-label="휴식 건너뛰기" onClick={() => { setEnded(false); void upd((cw) => clearTimer(cw)); }}><Icon name="skip" size={20} /></button>
            {cur && curItem && (
              <button class="rp-done" onClick={() => complete(cur)} aria-label="현재 세트 완료" title={`${nextText} 완료`}>
                <Icon name="check" size={22} /><span class="sr-only">{nextText} 완료</span>
              </button>
            )}
          </div>
        ) : cur && curItem ? (
          <button class="ok wk-done" onClick={() => complete(cur)} aria-label="현재 세트 완료">
            <Icon name="check" size={20} /><span class="wd-text">{nextText} 완료</span>
            {nextRest ? <span class="small wd-rest">→ 휴식 {nextRest.sec}초</span> : null}
          </button>
        ) : (
          <button class="primary wk-done" onClick={() => void doFinish(w.id)}>모든 세트 완료 · 운동 끝내기</button>
        )}
      </div>

      {plate !== null && <PlateSheet weight={plate} onClose={() => setPlate(null)} />}
      {memo && <MemoSheet title={memo.title} value={memo.value} onSave={memo.save} onClose={() => setMemo(null)} />}
      {menu && menuItem && <MenuSheet title={nameOf(menuItem.exerciseId)} items={itemMenu(menu.b, menu.i)} onClose={() => setMenu(null)} />}
      {picker && (
        <ExercisePicker s={s} all={all} title={picker.mode === 'swap' ? '운동 교체' : '운동 추가'}
          part={picker.mode === 'swap' ? byId.get(w.blocks[picker.b]!.items[picker.i]!.exerciseId)?.part : undefined}
          exclude={w.blocks.flatMap((b) => b.items.map((it) => it.exerciseId))} /* 같은 운동 두 번 불가: 동기화·늦은 기록이 운동 이름으로 짝지음 (D-037) */
          onClose={() => setPicker(null)}
          onPick={(e) => {
            if (picker.mode === 'swap') upd((cw) => replaceItem(cw, picker.b, picker.i, e.id, history));
            else upd((cw) => appendExercise(cw, e.id, 3, e.measure === 'time' ? 0 : targetReps(e), e.mechanics === 'compound' ? s.settings.rest.compound : s.settings.rest.isolation, history, e.measure === 'time' ? e.default_seconds ?? 30 : undefined));
            setPicker(null);
          }} />
      )}
    </main>
  );
}

export async function discardWorkout(w: Workout) { await mutate((d) => softDelete(d, 'workouts', w.id)); }
