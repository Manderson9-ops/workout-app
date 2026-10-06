import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { db, mutate, historyOf, flushPending } from '../store';
import { catalog } from '../catalog';
import { NumInput, ExercisePicker } from '../components';
import { softDelete } from '../../db/db';
import { withoutStamp } from '../../core/syncStamp';
import { appendExercise } from '../../core/session';
import type { Workout } from '../../core/session';
import { targetReps } from '../../core/time';
import { toLocalInput, fromLocalInput, durationMin, setTimes, moveStart, patchSet, patchSetByKey, keyOf, withKeys, appendDoneSet, deleteSet, deleteItem, editProblem, finalizeEdit, sameWorkout, EDIT_LIMITS } from '../../core/workoutEdit';
import { go } from '../nav';
import { HeadButtons, BackButton } from '../header';
import { askConfirm } from '../confirm';

/**
 * 끝낸 운동 고치기 (D-035): 이름·날짜·시작 시각·운동 시간, 세트별 무게·횟수(초)·RIR·완료·웜업, 세트·운동 추가/삭제, 메모.
 * 초안에서 고치고 "저장"할 때만 기록을 바꿈.
 * - 세트는 임시 열쇠(_k)로 찾음: 입력 중 세트를 지워도 늦게 온 입력이 다른 세트에 들어가지 않음. 구조를 바꾸기 전엔 입력을 먼저 반영(flushPending)
 * - 편집 중에는 메뉴를 숨겨(html.editing) 고친 내용을 모르고 떠나지 않게. 창 닫기는 브라우저가 물음
 * - 저장 때 DB의 지금 값을 다시 읽어, 편집하는 동안 다른 기기가 바꿨거나 지웠으면 물음
 */
export function WorkoutEdit({ s, id }: { s: AppState; id: string }) {
  const [orig] = useState<Workout | undefined>(() => s.workouts.find((x) => x.id === id));
  const [draft, setDraftState] = useState<Workout | undefined>(() => (orig ? withKeys(JSON.parse(JSON.stringify(orig)) as Workout) : undefined));
  const cur = useRef(draft);
  const setDraft = (fn: (d: Workout) => Workout) => { if (!cur.current) return; const n = fn(cur.current); cur.current = n; setDraftState(n); };
  /** 세트·운동을 지우거나 더하는 동작: 입력 중인 숫자를 먼저 반영한 뒤 */
  const act = async (fn: (d: Workout) => Workout) => { await flushPending(); setDraft(fn); };
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [startText, setStartText] = useState(() => (orig ? toLocalInput(orig.startedAt) : ''));
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (eid: string) => byId.get(eid)?.name_ko ?? eid;
  const detail = `#/stats/w/${encodeURIComponent(id)}`;
  const dirty = () => !!cur.current && !!orig && !sameWorkout(cur.current, orig);

  useEffect(() => {
    document.documentElement.classList.add('editing');
    const warn = (e: BeforeUnloadEvent) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { document.documentElement.classList.remove('editing'); window.removeEventListener('beforeunload', warn); };
  }, []);

  if (!orig || !draft) return <main><p>기록을 찾을 수 없어요 (다른 기기에서 지웠을 수 있어요).</p><button onClick={() => go('#/stats')}>기록으로</button></main>;
  if (!orig.endedAt) return <main><p>진행 중인 운동은 운동 화면에서 고쳐요.</p><button onClick={() => go('#/workout')}>운동 화면으로</button></main>;
  if (orig.pendingMerge) return <main><p>다른 기기에서 늦게 온 기록은 홈에서 합치기/지우기를 골라 주세요.</p><button onClick={() => go('#/')}>홈으로</button></main>;

  const cancel = async () => { await flushPending(); if (!dirty() || await askConfirm({ title: '고친 내용을 버릴까요?', ok: '버리기', cancel: '계속 고치기', danger: true })) go(detail); };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await flushPending(); // 입력 중인 숫자(0.3초 늦춘 저장)를 먼저 초안에 반영
      if (!fromLocalInput(startText)) { setErr('시작 날짜와 시각을 골라 주세요'); return; }
      if (!dirty()) { go(detail); return; }
      const out = finalizeEdit(cur.current!, new Date().toISOString());
      // 운동 시간(길이)을 안 바꿨으면 원래 1분 미만 기록도 저장 가능 (시작만 옮긴 경우 포함)
      const timesSame = Date.parse(out.endedAt!) - Date.parse(out.startedAt) === Date.parse(orig.endedAt!) - Date.parse(orig.startedAt);
      const problem = editProblem(out, Date.now(), name, { allowShort: timesSame });
      if (problem) { setErr(problem); return; }
      // 저장소의 지금 값과 비교. 앱 안 확인 창은 기다리는 동안 동기화가 계속 돌므로,
      // 답한 뒤 다시 읽어 사용자가 동의한 그 상태 그대로일 때만 저장 (그새 또 바뀌면 다시 물음)
      let agreed: { w?: Workout } | null = null; // 사용자가 덮어쓰기에 동의한 그 상태 (w 없음 = 지워진 상태)
      for (;;) {
        const now = await db.workouts.get(id);
        if (now && sameWorkout(now, orig)) break;
        if (agreed && (agreed.w ? !!now && sameWorkout(now, agreed.w) : !now)) break;
        const yes = now
          ? await askConfirm({ title: '다른 기기에서 이 기록이 바뀌었어요', message: '고치는 동안 바뀌었어요. 내 수정으로 덮어쓸까요?', ok: '덮어쓰기', cancel: '계속 고치기', danger: true })
          : await askConfirm({ title: '다른 기기에서 이 기록이 지워졌어요', message: '고치는 동안 지워졌어요. 내 수정으로 되살려 저장할까요?', ok: '되살려 저장', cancel: '계속 고치기' });
        if (!yes) return;
        agreed = { w: now };
      }
      await mutate((d) => d.workouts.put(withoutStamp(out as never) as unknown as Workout));
      go(detail);
    } finally { setBusy(false); }
  };

  const mins = durationMin(draft);
  const nowLocal = toLocalInput(new Date(Date.now() + 5 * 60000).toISOString());
  const onStart = (v: string) => { setStartText(v); const iso = fromLocalInput(v); if (iso) setDraft((d) => moveStart(d, iso)); };
  return (
    <main>
      <div class="scr-backrow">
        <BackButton label="취소" aria="수정 취소하고 돌아가기" onClick={() => void cancel()} />
        {/* 설정 버튼은 두지 않음: 이 화면은 취소/저장으로만 떠남 (고친 내용을 모르고 떠나지 않게) */}
        <HeadButtons settings={false} />
      </div>
      <h1>운동 기록 수정</h1>
      <label>운동 이름</label>
      <input aria-label="운동 이름" maxLength={EDIT_LIMITS.nameMax} value={draft.name} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setDraft((d) => ({ ...d, name: v })); }} />
      <div class="row wrap" style={{ gap: '8px', marginTop: '8px' }}>
        <div class="grow">
          <label>시작</label>
          <input type="datetime-local" aria-label="시작 날짜와 시각" max={nowLocal} value={startText}
            onInput={(e) => onStart((e.target as HTMLInputElement).value)} onChange={(e) => onStart((e.target as HTMLInputElement).value)} />
        </div>
        <div style={{ width: '120px' }}>
          <label>운동 시간(분)</label>
          <NumInput integer label="운동 시간(분)" suffix="분" pendingKey="ed-min" value={mins} onChange={(v) => setDraft((d) => setTimes(d, d.startedAt, v ?? 0))} />
        </div>
      </div>
      <p class="sub small">세트 번호(1, 2…)를 누르면 웜업(W)으로 바뀌고, 다시 누르면 돌아와요.</p>

      {draft.blocks.map((b, bi) => b.items.map((it, ii) => {
        const ex = name(it.exerciseId);
        const timeBased = it.target.seconds !== undefined;
        let n = 0;
        return (
          <div class="card" key={`${bi}-${ii}-${it.exerciseId}`} role="group" aria-label={`${ex} 세트 고치기`}>
            <div class="row between"><strong>{ex}</strong><button class="danger" aria-label={`${ex} 운동 지우기`} onClick={async () => { if (await askConfirm({ title: '운동을 지울까요?', message: `${ex}와(과) 그 세트를 이 기록에서 지워요.`, ok: '지우기', danger: true })) void act((d) => deleteItem(d, bi, ii)); }}>운동 지우기</button></div>
            <div class="edit-set sub small" aria-hidden="true"><span>세트</span><span>무게(kg)</span><span>{timeBased ? '시간(초)' : '횟수'}</span><span>RIR</span><span>완료</span><span /></div>
            {it.sets.map((x, k) => {
              const key = keyOf(x);
              const label = x.warmup ? 'W' : String(++n);
              const nm = `${ex} ${x.warmup ? `웜업(${k + 1}번째)` : `${n}세트`}`;
              return (
                <div class="edit-set" key={key}>
                  <button class="ghost" title="웜업 전환" aria-label={`${nm} 웜업 ${x.warmup ? '해제' : '표시'}`} onClick={() => void act((d) => patchSetByKey(d, key, { warmup: !x.warmup }))}>{label}</button>
                  <NumInput label={`${nm} 무게`} suffix="" pendingKey={`ed-${key}-w`} value={x.weight} onChange={(v) => setDraft((d) => patchSetByKey(d, key, { weight: v }))} />
                  {timeBased
                    ? <NumInput integer label={`${nm} 시간`} suffix="" pendingKey={`ed-${key}-s`} value={x.seconds} onChange={(v) => setDraft((d) => patchSetByKey(d, key, { seconds: v }))} />
                    : <NumInput integer label={`${nm} 횟수`} suffix="" pendingKey={`ed-${key}-r`} value={x.reps} onChange={(v) => setDraft((d) => patchSetByKey(d, key, { reps: v }))} />}
                  <NumInput integer label={`${nm} RIR`} suffix="" pendingKey={`ed-${key}-i`} value={x.rir} onChange={(v) => setDraft((d) => patchSetByKey(d, key, { rir: v }))} />
                  <label class="ck"><input type="checkbox" aria-label={`${nm} 완료`} checked={x.done} onChange={(e) => { const c = (e.target as HTMLInputElement).checked; setDraft((d) => patchSetByKey(d, key, { done: c })); }} /></label>
                  <button class="ghost" aria-label={`${nm} 지우기`} onClick={() => void act((d) => { const z = d.blocks[bi]?.items[ii]?.sets.findIndex((q) => keyOf(q) === key) ?? -1; return z >= 0 ? deleteSet(d, bi, ii, z) : d; })}>✕</button>
                </div>
              );
            })}
            <button style={{ marginTop: '6px' }} aria-label={`${ex} 세트 추가`} onClick={() => void act((d) => appendDoneSet(d, bi, ii))}>+ 세트</button>
          </div>
        );
      }))}
      <button class="big" onClick={() => void flushPending().then(() => setPicker(true))}>+ 운동 추가</button>

      <label style={{ marginTop: '10px', display: 'block' }}>메모</label>
      <textarea aria-label="운동 메모" rows={3} maxLength={EDIT_LIMITS.memoMax} value={draft.memo ?? ''} style={{ width: '100%', boxSizing: 'border-box', fontSize: '16px' }} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setDraft((d) => ({ ...d, memo: v })); }} />

      {err && <p role="alert" style={{ color: 'var(--warn)' }}>{err}</p>}
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="grow" onClick={() => void cancel()}>취소</button>
        <button class="primary grow" disabled={busy} onClick={() => void save()}>저장</button>
      </div>
      <button class="danger" style={{ marginTop: '12px' }} onClick={async () => { if (await askConfirm({ title: '이 운동 기록을 지울까요?', message: '되돌릴 수 없어요.', ok: '지우기', danger: true })) { await mutate((d) => softDelete(d, 'workouts', id)); go('#/stats'); } }}>이 기록 삭제</button>

      {picker && (
        <ExercisePicker s={s} all={all} title="운동 추가" exclude={draft.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setDraft((d) => {
              const added = withKeys(appendExercise(d, e.id, 1, e.measure === 'time' ? 0 : targetReps(e), e.mechanics === 'compound' ? s.settings.rest.compound : s.settings.rest.isolation, historyOf(s), e.measure === 'time' ? e.default_seconds ?? 30 : undefined));
              return patchSet(added, added.blocks.length - 1, 0, 0, { done: true });
            });
            setPicker(false);
          }} />
      )}
    </main>
  );
}
