import { useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, flushPending } from '../store';
import { catalog } from '../catalog';
import { NumInput, ExercisePicker } from '../components';
import { softDelete } from '../../db/db';
import { withoutStamp } from '../../core/syncStamp';
import { appendExercise } from '../../core/session';
import type { Workout } from '../../core/session';
import { targetReps } from '../../core/time';
import { toLocalInput, fromLocalInput, durationMin, setTimes, patchSet, appendDoneSet, deleteSet, deleteItem, editProblem, finalizeEdit, sameWorkout, EDIT_LIMITS } from '../../core/workoutEdit';
import { go } from '../nav';

/**
 * 끝낸 운동 고치기 (D-035): 이름·날짜·시작 시각·운동 시간, 세트별 무게·횟수(초)·RIR·완료·웜업, 세트·운동 추가/삭제, 메모.
 * 초안에서 고치고 "저장"할 때만 기록을 바꿈. 편집하는 동안 다른 기기가 같은 기록을 바꿨으면 덮어쓸지 물음
 */
export function WorkoutEdit({ s, id }: { s: AppState; id: string }) {
  const w = s.workouts.find((x) => x.id === id);
  const orig = useRef<Workout | undefined>(w);
  const [draft, setDraftState] = useState<Workout | undefined>(() => (w ? (JSON.parse(JSON.stringify(w)) as Workout) : undefined));
  const cur = useRef(draft);
  const setDraft = (fn: (d: Workout) => Workout) => { if (!cur.current) return; const n = fn(cur.current); cur.current = n; setDraftState(n); };
  const [err, setErr] = useState('');
  const [picker, setPicker] = useState(false);
  const [startText, setStartText] = useState(() => (w ? toLocalInput(w.startedAt) : ''));
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const name = (eid: string) => byId.get(eid)?.name_ko ?? eid;
  const detail = `#/stats/w/${encodeURIComponent(id)}`;

  if (!w || !draft || !orig.current) return <main><p>기록을 찾을 수 없어요 (다른 기기에서 지웠을 수 있어요).</p><button onClick={() => go('#/stats')}>기록으로</button></main>;
  if (!orig.current.endedAt) return <main><p>진행 중인 운동은 운동 화면에서 고쳐요.</p><button onClick={() => go('#/workout')}>운동 화면으로</button></main>;
  if (orig.current.pendingMerge) return <main><p>다른 기기에서 늦게 온 기록은 홈에서 합치기/지우기를 골라 주세요.</p><button onClick={() => go('#/')}>홈으로</button></main>;

  const dirty = () => !sameWorkout(cur.current!, orig.current!);
  const cancel = async () => { await flushPending(); if (!dirty() || confirm('고친 내용을 버릴까요?')) go(detail); };
  const save = async () => {
    await flushPending(); // 입력 중인 숫자(0.3초 늦춘 저장)를 먼저 초안에 반영
    if (!dirty()) { go(detail); return; }
    const out = finalizeEdit(cur.current!, new Date().toISOString());
    const problem = editProblem(out, Date.now(), name);
    if (problem) { setErr(problem); return; }
    const now = s.workouts.find((x) => x.id === id);
    if (!now) { setErr('이 기록이 다른 기기에서 지워졌어요. 저장하지 않았어요'); return; }
    if (!sameWorkout(now, orig.current!) && !confirm('고치는 동안 다른 기기에서 이 기록이 바뀌었어요.\n내 수정으로 덮어쓸까요? (취소하면 계속 고칠 수 있어요)')) return;
    await mutate((d) => d.workouts.put(withoutStamp(out as never) as unknown as Workout));
    go(detail);
  };

  const mins = durationMin(draft);
  return (
    <main>
      <button class="ghost" onClick={() => void cancel()}>← 취소</button>
      <h1>운동 기록 수정</h1>
      <label>운동 이름</label>
      <input aria-label="운동 이름" maxLength={EDIT_LIMITS.nameMax} value={draft.name} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setDraft((d) => ({ ...d, name: v })); }} />
      <div class="row wrap" style={{ gap: '8px', marginTop: '8px' }}>
        <div class="grow">
          <label>시작</label>
          <input type="datetime-local" aria-label="시작 날짜와 시각" value={startText} onInput={(e) => {
            const v = (e.target as HTMLInputElement).value; setStartText(v);
            const iso = fromLocalInput(v); if (iso) setDraft((d) => setTimes(d, iso, durationMin(d)));
          }} />
        </div>
        <div style={{ width: '120px' }}>
          <label>운동 시간(분)</label>
          <NumInput integer label="운동 시간(분)" suffix="분" pendingKey="ed-min" value={mins} onChange={(v) => setDraft((d) => setTimes(d, d.startedAt, v ?? 0))} />
        </div>
      </div>

      {draft.blocks.map((b, bi) => b.items.map((it, ii) => {
        const ex = name(it.exerciseId);
        const timeBased = it.target.seconds !== undefined;
        let n = 0;
        return (
          <div class="card" key={`${bi}-${ii}-${it.exerciseId}`} aria-label={`${ex} 세트 고치기`}>
            <div class="row between"><strong>{ex}</strong><button class="danger" aria-label={`${ex} 운동 지우기`} onClick={() => { if (confirm(`${ex}와(과) 그 세트를 이 기록에서 지울까요?`)) setDraft((d) => deleteItem(d, bi, ii)); }}>운동 지우기</button></div>
            <div class="edit-set sub small" aria-hidden="true"><span>세트</span><span>무게(kg)</span><span>{timeBased ? '시간(초)' : '횟수'}</span><span>RIR</span><span>완료</span><span /></div>
            {it.sets.map((x, k) => {
              const label = x.warmup ? 'W' : String(++n);
              const nm = `${ex} ${x.warmup ? `웜업(${k + 1}번째)` : `${n}세트`}`;
              return (
                <div class="edit-set" key={k}>
                  <button class="ghost" aria-label={`${nm} 웜업 ${x.warmup ? '해제' : '표시'}`} onClick={() => setDraft((d) => patchSet(d, bi, ii, k, { warmup: !x.warmup }))}>{label}</button>
                  <NumInput label={`${nm} 무게`} suffix="" pendingKey={`ed-${bi}-${ii}-${k}-w`} value={x.weight} onChange={(v) => setDraft((d) => patchSet(d, bi, ii, k, { weight: v }))} />
                  {timeBased
                    ? <NumInput integer label={`${nm} 시간`} suffix="" pendingKey={`ed-${bi}-${ii}-${k}-s`} value={x.seconds} onChange={(v) => setDraft((d) => patchSet(d, bi, ii, k, { seconds: v }))} />
                    : <NumInput integer label={`${nm} 횟수`} suffix="" pendingKey={`ed-${bi}-${ii}-${k}-r`} value={x.reps} onChange={(v) => setDraft((d) => patchSet(d, bi, ii, k, { reps: v }))} />}
                  <NumInput integer label={`${nm} RIR`} suffix="" pendingKey={`ed-${bi}-${ii}-${k}-i`} value={x.rir} onChange={(v) => setDraft((d) => patchSet(d, bi, ii, k, { rir: v }))} />
                  <label class="ck"><input type="checkbox" aria-label={`${nm} 완료`} checked={x.done} onChange={(e) => { const c = (e.target as HTMLInputElement).checked; setDraft((d) => patchSet(d, bi, ii, k, { done: c })); }} /></label>
                  <button class="ghost" aria-label={`${nm} 지우기`} onClick={() => setDraft((d) => deleteSet(d, bi, ii, k))}>✕</button>
                </div>
              );
            })}
            <button style={{ marginTop: '6px' }} aria-label={`${ex} 세트 추가`} onClick={() => setDraft((d) => appendDoneSet(d, bi, ii))}>+ 세트</button>
          </div>
        );
      }))}
      <button class="big" onClick={() => setPicker(true)}>+ 운동 추가</button>

      <label style={{ marginTop: '10px', display: 'block' }}>메모</label>
      <textarea aria-label="운동 메모" rows={3} maxLength={EDIT_LIMITS.memoMax} value={draft.memo ?? ''} style={{ width: '100%', boxSizing: 'border-box', fontSize: '16px' }} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setDraft((d) => ({ ...d, memo: v })); }} />

      {err && <p role="alert" style={{ color: 'var(--warn)' }}>{err}</p>}
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="grow" onClick={() => void cancel()}>취소</button>
        <button class="primary grow" onClick={() => void save()}>저장</button>
      </div>
      <button class="danger" style={{ marginTop: '12px' }} onClick={async () => { if (confirm('이 운동 기록을 지울까요? 되돌릴 수 없어요.')) { await mutate((d) => softDelete(d, 'workouts', id)); go('#/stats'); } }}>이 기록 삭제</button>

      {picker && (
        <ExercisePicker s={s} all={all} title="운동 추가" exclude={draft.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setDraft((d) => {
              const added = appendExercise(d, e.id, 1, e.measure === 'time' ? 0 : targetReps(e), e.mechanics === 'compound' ? s.settings.rest.compound : s.settings.rest.isolation, historyOf(s), e.measure === 'time' ? e.default_seconds ?? 30 : undefined);
              const bi = added.blocks.length - 1;
              return patchSet(added, bi, 0, 0, { done: true });
            });
            setPicker(false);
          }} />
      )}
    </main>
  );
}
