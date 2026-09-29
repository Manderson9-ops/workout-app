import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { activeOf, historyOf, mutate } from '../store';
import { catalog } from '../catalog';
import type { Workout, Step, SetLog } from '../../core/session';
import {
  currentStep, completeSet, undoSet, updateSet, addSet, removeSet, skipItem, replaceItem, appendExercise,
  adjustTimer, clearTimer, timerRemaining, progress, finishWorkout, restAfter, lastSets,
} from '../../core/session';
import { setTime, targetReps } from '../../core/time';
import { GradeBadge, Stepper, NumInput, ExercisePicker, mmss } from '../components';
import { resolveGrade } from '../../core/exercises';
import { updateWorkout } from '../actions';
import { go } from '../nav';

// ---------- 소리 (첫 탭에서 활성화, 무음 모드 대응 시도) ----------
let ctx: AudioContext | undefined;
function unlockAudio() {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* 소리 없음 */ }
}
function beep(freq: number, ms: number, when = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.start(t); o.stop(t + ms / 1000 + 0.05);
}

// ---------- 화면 꺼짐 방지 ----------
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    const req = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch { /* 거부됨 */ } };
    void req();
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [on]);
}

export function WorkoutScreen({ s }: { s: AppState }) {
  const w = activeOf(s);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ mode: 'swap'; b: number; i: number } | { mode: 'add' } | null>(null);
  const [ended, setEnded] = useState(false);
  const warned = useRef<number>(0); const rang = useRef<number>(0);
  useWakeLock(!!w && s.settings.keepAwake);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { document.addEventListener('pointerdown', unlockAudio); return () => document.removeEventListener('pointerdown', unlockAudio); }, []);

  const rem = w ? timerRemaining(w.timer, now) : 0;
  const curKey = w ? JSON.stringify(currentStep(w) ?? null) : '';
  useEffect(() => {
    // 현재 세트가 타이머에 가리지 않게 화면 가운데로
    const el = document.querySelector('.set-row.current');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curKey]);
  useEffect(() => {
    if (!w?.timer) { setEnded(false); return; }
    const key = w.timer.endsAt;
    if (rem <= 10 && rem > 0 && warned.current !== key) { warned.current = key; if (s.settings.soundOn) beep(660, 120); }
    if (rem === 0 && rang.current !== key) {
      rang.current = key; setEnded(true);
      if (s.settings.soundOn) { beep(880, 180); beep(880, 180, 0.3); beep(1175, 350, 0.6); }
    }
  }, [rem, w?.timer?.endsAt]);

  if (!w) {
    return (
      <main>
        <h1>운동</h1>
        <div class="empty"><p>진행 중인 운동이 없어요.</p><p class="small">홈에서 루틴을 시작하거나 플랜을 만들어 보세요.</p></div>
        <button class="primary big" onClick={() => go('#/')}>루틴 고르기</button>
      </main>
    );
  }

  const upd = (fn: (x: Workout) => Workout) => updateWorkout(w.id, fn);
  const cur = currentStep(w);
  const openIdx = open ?? cur?.block ?? 0;
  const history = historyOf(s);
  const prog = progress(w, now, (id, reps) => { const e = byId.get(id); return e ? setTime(e, reps) : 40; });
  const nameOf = (id: string) => byId.get(id)?.name_ko ?? id;
  const complete = (st: Step) => { unlockAudio(); setEnded(false); upd((cw) => completeSet(cw, st, Date.now())); setOpen(null); };
  const curItem = cur ? w.blocks[cur.block]!.items[cur.item]! : undefined;
  const nextRest = cur ? restAfter(w, cur) : null;

  const setRow = (b: number, i: number, k: number, x: SetLog) => {
    const st = { block: b, item: i, set: k };
    const isCur = cur && cur.block === b && cur.item === i && cur.set === k;
    const it = w.blocks[b]!.items[i]!;
    const timeEx = it.target.seconds !== undefined;
    const workNo = it.sets.slice(0, k + 1).filter((z) => !z.warmup).length;
    const label = `${nameOf(it.exerciseId)} ${x.warmup ? '웜업' : workNo + '세트'}`;
    return (
      <div key={k}>
        <div class={`set-row ${x.done ? 'done' : ''} ${isCur ? 'current' : ''}`}>
          <div class="set-no" aria-label={x.warmup ? '웜업 세트' : `${workNo}세트`}>{x.warmup ? 'W' : workNo}</div>
          <NumInput label={`${label} 무게`} value={x.weight} suffix="kg" onChange={(v) => upd((cw) => updateSet(cw, st, { weight: v }))} />
          {timeEx
            ? <NumInput label={`${label} 초`} value={x.seconds} suffix="초" onChange={(v) => upd((cw) => updateSet(cw, st, { seconds: v }))} />
            : <NumInput label={`${label} 횟수`} value={x.reps} suffix="회" onChange={(v) => upd((cw) => updateSet(cw, st, { reps: v }))} />}
          {x.done
            ? <button class="check" aria-label="완료 취소" onClick={() => upd((cw) => undoSet(cw, st))}>↺</button>
            : <button class={`check ${isCur ? 'ok' : ''}`} aria-label={`${nameOf(it.exerciseId)} ${x.warmup ? '웜업' : workNo + '세트'} 완료`} onClick={() => complete(st)}>✓</button>}
        </div>
        {isCur && (
          <div class="grid2" style={{ margin: '4px 0 2px' }}>
            <Stepper label={`${label} 무게 조절`} value={x.weight} step={2.5} suffix="kg" onChange={(v) => upd((cw) => updateSet(cw, st, { weight: v }))} />
            {timeEx
              ? <Stepper label={`${label} 초 조절`} value={x.seconds} step={5} suffix="초" onChange={(v) => upd((cw) => updateSet(cw, st, { seconds: v }))} />
              : <Stepper label={`${label} 횟수 조절`} value={x.reps} step={1} suffix="회" onChange={(v) => upd((cw) => updateSet(cw, st, { reps: v }))} />}
          </div>
        )}
        {isCur && !x.warmup && (
          <div class="row small" style={{ margin: '4px 0 6px 42px' }}>
            <span class="sub">남은 횟수 여유(RIR)</span>
            {[0, 1, 2, 3].map((r) => <button key={r} class={`chip ${x.rir === r ? 'on' : ''}`} onClick={() => upd((cw) => updateSet(cw, st, { rir: x.rir === r ? undefined : r }))}>{r}{r === 3 ? '+' : ''}</button>)}
          </div>
        )}
      </div>
    );
  };

  return (
    <main style={{ paddingBottom: 'calc(var(--nav-h) + 260px)' }}>
      <div class="row between">
        <h1 class="grow" style={{ margin: '4px 0' }}>{w.name}</h1>
        <button class="danger" onClick={async () => {
          const left = prog.totalSets - prog.doneSets;
          if (!confirm(left ? `아직 ${left}세트 남았어요. 운동을 끝낼까요?` : '운동을 끝낼까요?')) return;
          await upd((cw) => finishWorkout(cw, new Date().toISOString())); go('#/');
        }}>종료</button>
      </div>
      <div class="row between sub small"><span>경과 {mmss(prog.elapsedSec)}</span><span>{prog.doneSets}/{prog.totalSets}세트</span><span>남은 예상 {mmss(prog.remainingSec)}</span></div>
      <div class="progress" style={{ margin: '6px 0 10px' }}><div style={{ width: `${prog.totalSets ? (100 * prog.doneSets) / prog.totalSets : 0}%` }} /></div>

      {w.blocks.map((b, bi) => {
        const isOpen = bi === openIdx;
        const doneAll = b.items.every((it) => it.skipped || it.sets.every((x) => x.done));
        return (
          <div class={`card ${cur?.block === bi ? 'active' : ''}`} key={bi}>
            <div class="row between" onClick={() => setOpen(isOpen ? -1 : bi)} role="button" aria-expanded={isOpen} style={{ minHeight: '44px', cursor: 'pointer' }}>
              <div class="grow">
                {b.kind !== 'single' && <span class="badge kind">{b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'} · 번갈아</span>}
                <div><strong>{b.items.map((it) => nameOf(it.exerciseId)).join(' + ')}</strong>{doneAll ? ' ✅' : ''}</div>
                <div class="pill">{b.kind === 'single' ? `세트 간 휴식 ${b.restSec}초` : `라운드 후 휴식 ${b.roundRestSec}초`}</div>
              </div>
              <span class="sub">{isOpen ? '▾' : '▸'}</span>
            </div>
            {isOpen && b.items.map((it, ii) => {
              const ex = byId.get(it.exerciseId);
              const g = ex ? resolveGrade(ex, ex.part, s.settings.level, undefined, s.meta.get(ex.id)?.userGrade) : undefined;
              const prev = lastSets(history, it.exerciseId);
              return (
                <div key={ii} style={{ marginTop: '10px', opacity: it.skipped ? 0.5 : 1 }}>
                  <div class="row">{g && <GradeBadge g={g} />}<strong class="grow">{b.kind !== 'single' ? `${String.fromCharCode(65 + ii)}. ` : ''}{nameOf(it.exerciseId)}</strong>
                    <a class="btn ghost small" href={`#/exercises/${encodeURIComponent(it.exerciseId)}`}>정보</a></div>
                  {prev.length > 0 && <div class="pill">지난번: {prev.map((p) => `${p.weight ?? '-'}kg×${p.reps ?? p.seconds ?? '-'}`).join(', ')}</div>}
                  {!it.skipped && it.sets.map((x, k) => setRow(bi, ii, k, x))}
                  <div class="row wrap" style={{ marginTop: '6px' }}>
                    <button onClick={() => upd((cw) => addSet(cw, bi, ii))}>+ 세트</button>
                    <button onClick={() => upd((cw) => addSet(cw, bi, ii, true))}>+ 웜업</button>
                    {it.sets.length > 1 && !it.sets[it.sets.length - 1]!.done && <button onClick={() => upd((cw) => removeSet(cw, { block: bi, item: ii, set: it.sets.length - 1 }))}>− 세트</button>}
                    <button onClick={() => setPicker({ mode: 'swap', b: bi, i: ii })}>교체</button>
                    <button onClick={() => upd((cw) => skipItem(cw, bi, ii, !it.skipped))}>{it.skipped ? '되살리기' : '건너뛰기'}</button>
                    <button onClick={() => { const m = prompt('메모', it.memo ?? ''); if (m !== null) upd((cw) => ({ ...cw, blocks: cw.blocks.map((bb, x) => x !== bi ? bb : { ...bb, items: bb.items.map((y, z) => (z === ii ? { ...y, memo: m } : y)) }) })); }}>메모</button>
                  </div>
                  {it.memo && <p class="sub small">📝 {it.memo}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
      <button class="big" onClick={() => setPicker({ mode: 'add' })}>+ 운동 추가</button>

      {/* 휴식 타이머 / 다음 세트 */}
      <div class={`timer ${w.timer && rem === 0 ? 'end flash' : ''}`} role="timer" aria-live="polite">
        {w.timer && (rem > 0 || ended) ? (
          <div class="row between">
            <div>
              <div class="small">{rem > 0 ? w.timer.label : '휴식 끝! 다음 세트'}</div>
              <div class="num" aria-label={`휴식 남은 시간 ${rem}초`}>{mmss(rem)}</div>
            </div>
            <div class="row">
              <button aria-label="15초 줄이기" onClick={() => upd((cw) => adjustTimer(cw, -15, Date.now()))}>−15</button>
              <button aria-label="15초 늘리기" onClick={() => upd((cw) => adjustTimer(cw, 15, Date.now()))}>+15</button>
              <button aria-label="휴식 건너뛰기" onClick={() => { setEnded(false); void upd((cw) => clearTimer(cw)); }}>건너뛰기</button>
            </div>
          </div>
        ) : null}
        {cur && curItem ? (
          <button class="ok big" style={{ marginTop: w.timer && (rem > 0 || ended) ? '8px' : 0 }} onClick={() => complete(cur)} aria-label="현재 세트 완료">
            ✓ {nameOf(curItem.exerciseId)} {curItem.sets[cur.set]!.warmup ? '웜업' : `${curItem.sets.slice(0, cur.set + 1).filter((z) => !z.warmup).length}세트`} 완료
            {nextRest ? <span class="small" style={{ fontWeight: 500 }}> → 휴식 {nextRest.sec}초</span> : null}
          </button>
        ) : (
          <button class="primary big" onClick={async () => { await upd((cw) => finishWorkout(cw, new Date().toISOString())); go('#/'); }}>모든 세트 완료 · 운동 끝내기</button>
        )}
      </div>

      {picker && (
        <ExercisePicker s={s} all={all} title={picker.mode === 'swap' ? '운동 교체' : '운동 추가'}
          part={picker.mode === 'swap' ? byId.get(w.blocks[picker.b]!.items[picker.i]!.exerciseId)?.part : undefined}
          exclude={picker.mode === 'swap' ? [w.blocks[picker.b]!.items[picker.i]!.exerciseId] : []}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            if (picker.mode === 'swap') upd((cw) => replaceItem(cw, picker.b, picker.i, e.id, history));
            else upd((cw) => appendExercise(cw, e.id, 3, e.measure === 'time' ? 0 : targetReps(e), e.mechanics === 'compound' ? 150 : 90, history, e.measure === 'time' ? e.default_seconds ?? 30 : undefined));
            setPicker(null);
          }} />
      )}
    </main>
  );
}

export async function discardWorkout(w: Workout) { await mutate((d) => d.workouts.delete(w.id)); }
