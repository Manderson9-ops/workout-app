import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import type { Routine, RoutineBlock, RoutineItem } from '../../core/session';
import { routineEstimate, mergeWithNext, splitBlock, applyRestToAll, moveRoutineBlock } from '../../core/session';
import { useDragSort } from '../dragSort';
import { targetReps } from '../../core/time';
import { ExercisePicker, Labeled, MiniStepper, mmss } from '../components';
import type { StepBtn } from '../components';
import { PARTS } from '../../core/types';
import type { Part } from '../../core/types';
import { bulkRoutineSets, bulkRoutineReps, routineChangedCount, routineParts, stepItemSets, stepItemReps } from '../../core/routineEdit';
import { startRoutine } from '../actions';
import { go } from '../nav';
import { SETS_MIN, SETS_MAX, REPS_MIN, REPS_MAX, SECS_MIN, SECS_MAX, rangeText, ROUND_REST_MIN, ROUND_REST_MAX, ROUND_REST_STEP, TRANSITION_MIN, TRANSITION_MAX, TRANSITION_STEP } from '../../core/planEdit';

const KIND_LABEL: Record<RoutineBlock['kind'], string> = { single: '일반', superset: '슈퍼세트', compound: '컴파운드 세트' };

export function RoutineEditor({ s, id }: { s: AppState; id: string }) {
  const r0 = s.routines.find((r) => r.id === id);
  const [r, setR] = useState<Routine | undefined>(r0);
  const [picker, setPicker] = useState<{ b: number; i: number } | { add: Part | undefined } | null>(null);
  const [msg, setMsg] = useState('');
  const flip = useRef(false); // 같은 안내가 반복돼도 다시 읽히게 보이지 않는 글자를 번갈아 붙임
  const pendingFocus = useRef<string | null>(null); // 운동을 추가한 뒤 초점을 줄 버튼의 aria-label
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const rest = s.settings.rest;
  // 블록 끌어서 순서 바꾸기 (D-037)
  const dnd = useDragSort(r?.blocks.length ?? 0, (from, to) => { setMsg(''); setR((cur) => (cur ? moveRoutineBlock(cur, from, to) : cur)); },
    (i) => r?.blocks[i]?.items.map((it) => byId.get(it.exerciseId)?.name_ko ?? it.exerciseId).join(' + ') ?? '');
  // 운동을 추가하면 새 카드가 생김: 그 운동의 '세트 늘리기'로 초점 (D-052)
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    const btn = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find((x) => x.getAttribute('aria-label') === want);
    if (btn) { btn.focus(); pendingFocus.current = null; }
  }, [r]);
  if (!r) return <main><p>루틴을 찾을 수 없어요.</p><button onClick={() => go('#/')}>홈으로</button></main>;
  const restFor = (exId: string) => (byId.get(exId)?.mechanics === 'compound' ? rest.compound : rest.isolation);
  const setBlock = (bi: number, fn: (b: RoutineBlock) => RoutineBlock | null) =>
    setR({ ...r, blocks: r.blocks.map((b, x) => (x === bi ? fn(b) : b)).filter((b): b is RoutineBlock => !!b && b.items.length > 0) });
  const setItem = (bi: number, ii: number, fn: (i: RoutineItem) => RoutineItem) => setBlock(bi, (x) => ({ ...x, items: x.items.map((y, z) => (z === ii ? fn(y) : y)) }));
  const est = routineEstimate(r, byId, rest.between) + (r.warmupSec ?? 0);
  const saved = (): Routine => ({ ...r, estimatedSec: est, updatedAt: new Date().toISOString() });
  const save = async () => { await mutate((d) => d.routines.put(saved())); };
  const move = (bi: number, dir: -1 | 1) => { setMsg(''); setR(moveRoutineBlock(r, bi, bi + dir)); };
  const nameOf = (it: RoutineItem) => byId.get(it.exerciseId)?.name_ko ?? it.exerciseId;
  const blockName = (b: RoutineBlock) => b.items.map(nameOf).join(' + ');
  const sgn = (d: number) => (d > 0 ? '+1' : '-1');
  const say = (m: string) => { flip.current = !flip.current; setMsg(m + (flip.current ? '\u200b' : '')); };
  // D-052: 일괄·묶음 고치기. 바뀐 게 없으면(끝값) 아무것도 안 함
  const bulkDo = (kind: 'sets' | 'reps', d: number, bi?: number) => {
    const next = (kind === 'sets' ? bulkRoutineSets : bulkRoutineReps)(r, d, bi);
    if (next === r) return;
    setR(next);
    say(`${bi === undefined ? '운동' : '묶음 운동'} ${routineChangedCount(r, next)}개 ${kind === 'sets' ? '세트' : '횟수'} ${sgn(d)}`);
  };
  const bulkOff = (kind: 'sets' | 'reps', d: number, bi?: number) => (kind === 'sets' ? bulkRoutineSets : bulkRoutineReps)(r, d, bi) === r;
  const stepBtns = (aria: string, kind: 'sets' | 'reps', bi?: number): [StepBtn, StepBtn] => [
    { aria: `${aria} 줄이기`, off: bulkOff(kind, -1, bi), on: () => bulkDo(kind, -1, bi) },
    { aria: `${aria} 늘리기`, off: bulkOff(kind, 1, bi), on: () => bulkDo(kind, 1, bi) },
  ];
  /** 세트 스테퍼와 횟수 스테퍼 한 쌍. bi가 없으면 모든 운동, 있으면 그 묶음 */
  const bulkSteps = (labels: [string, string], arias: [string, string], items: RoutineItem[], bi?: number) => {
    const [sd, si] = stepBtns(arias[0], 'sets', bi), [rd, ri] = stepBtns(arias[1], 'reps', bi);
    return (
      <>
        <Labeled label={labels[0]}><MiniStepper label={arias[0]} mid={rangeText(items, 'sets')} dec={sd} inc={si} /></Labeled>
        <Labeled label={labels[1]}><MiniStepper label={arias[1]} mid={rangeText(items, 'reps')} dec={rd} inc={ri} /></Labeled>
      </>
    );
  };
  const partCount = routineParts(r, (id) => byId.get(id)?.part);
  const partOf = (b: RoutineBlock) => new Set(b.items.map((i) => byId.get(i.exerciseId)?.part));
  return (
    <main>
      <button class="ghost" onClick={() => go('#/')}>← 홈</button>
      <label>루틴 이름</label>
      <input value={r.name} aria-label="루틴 이름" onInput={(e) => setR({ ...r, name: (e.target as HTMLInputElement).value })} />
      <p class="sub small">예상 {mmss(est)} {r.warmupSec ? `(웜업 ${Math.round(r.warmupSec / 60)}분 포함)` : ''}</p>
      <label>부위를 눌러 운동 추가</label>
      <div class="row wrap part-add" role="group" aria-label="부위별 운동 추가">
        {PARTS.map((p) => {
          const n = partCount.get(p) ?? 0;
          return <button key={p} class={n ? 'chip on' : 'chip'} aria-label={n ? `${p} 운동 추가 (지금 ${n}개)` : `${p} 운동 추가`} onClick={() => setPicker({ add: p })}>{n ? `${p} · ${n}` : p}</button>;
        })}
      </div>
      <div class="row wrap">
        <span class="sub small grow">모든 블록 휴식 한 번에 (루틴 기본값)</span>
        <button onClick={() => setR(applyRestToAll(r, rest.isolation, rest.round))}>짧게 {rest.isolation}초</button>
        <button onClick={() => setR(applyRestToAll(r, rest.compound, rest.round))}>길게 {rest.compound}초</button>
      </div>
      {r.blocks.length > 0 && (
        <div class="row wrap bulk-row">
          {bulkSteps(['모든 운동 세트', '모든 운동 횟수'], ['모든 운동 세트', '모든 운동 횟수'], r.blocks.flatMap((b) => b.items))}
        </div>
      )}
      <p class="sr-only" aria-live="polite">{msg || dnd.msg}</p>
      {!r.blocks.length && <div class="empty">운동을 추가해 주세요</div>}
      <div class="wide-cards-lg">
      {r.blocks.map((b, bi) => {
        const next = r.blocks[bi + 1];
        const canMerge = !!next && b.items.length + next.items.length <= 4;
        const samePart = next ? [...partOf(b)].every((p) => partOf(next).has(p)) && partOf(b).size === 1 : false;
        return (
          <div class="card" key={bi} {...dnd.itemAttrs(bi)}>
            <div class="row between">
              <span class="row" style={{ gap: '4px' }}>{r.blocks.length > 1 && <button {...dnd.handleProps(bi)}>≡</button>}<span class="sub small" aria-label={`${bi + 1}번 블록`}>{bi + 1} </span><span class="badge kind">{KIND_LABEL[b.kind]}</span></span>
              <div class="row"><button aria-label={`${bi + 1}번 블록 위로`} onClick={() => move(bi, -1)}>↑</button><button aria-label={`${bi + 1}번 블록 아래로`} onClick={() => move(bi, 1)}>↓</button></div>
            </div>
            {b.kind !== 'single' && (
              <div class="row wrap group-bulk">
                {bulkSteps(['이 묶음 세트', '이 묶음 횟수'], [`${blockName(b)} 세트 모두`, `${blockName(b)} 횟수 모두`], b.items, bi)}
              </div>
            )}
            {b.items.map((it, ii) => (
              <div key={ii} style={{ marginTop: '8px' }}>
                <strong>{b.kind !== 'single' ? `${String.fromCharCode(65 + ii)}. ` : ''}{byId.get(it.exerciseId)?.name_ko ?? it.exerciseId}</strong>
                <div class="row wrap" style={{ marginTop: '4px' }}>
                  <button aria-label={`${nameOf(it)} 세트 줄이기`} disabled={it.sets <= SETS_MIN} onClick={() => setItem(bi, ii, (y) => stepItemSets(y, -1))}>−</button>
                  <span>{it.sets}세트</span>
                  <button aria-label={`${nameOf(it)} 세트 늘리기`} disabled={it.sets >= SETS_MAX} onClick={() => setItem(bi, ii, (y) => stepItemSets(y, 1))}>+</button>
                  {it.seconds !== undefined ? (
                    <>
                      <button aria-label={`${nameOf(it)} 초 줄이기`} disabled={it.seconds <= SECS_MIN} onClick={() => setItem(bi, ii, (y) => stepItemReps(y, -1))}>−</button>
                      <span>{it.seconds}초</span>
                      <button aria-label={`${nameOf(it)} 초 늘리기`} disabled={it.seconds >= SECS_MAX} onClick={() => setItem(bi, ii, (y) => stepItemReps(y, 1))}>+</button>
                    </>
                  ) : (
                    <>
                      <button aria-label={`${nameOf(it)} 목표 횟수 줄이기`} disabled={it.reps <= REPS_MIN} onClick={() => setItem(bi, ii, (y) => stepItemReps(y, -1))}>−</button>
                      <span>{it.reps}회</span>
                      <button aria-label={`${nameOf(it)} 목표 횟수 늘리기`} disabled={it.reps >= REPS_MAX} onClick={() => setItem(bi, ii, (y) => stepItemReps(y, 1))}>+</button>
                    </>
                  )}
                </div>
                <div class="row wrap" style={{ marginTop: '4px' }}>
                  <button aria-label={`교체: ${nameOf(it)}`} onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                  <button class="danger" aria-label={`삭제: ${nameOf(it)}`} onClick={() => setBlock(bi, (x) => { const items = x.items.filter((_, z) => z !== ii); return { ...x, kind: items.length === 1 ? 'single' : x.kind, restSec: items.length === 1 ? restFor(items[0]!.exerciseId) : x.restSec, items }; })}>삭제</button>
                </div>
              </div>
            ))}
            <div class="row" style={{ marginTop: '8px' }}>
              <span class="sub small grow">{b.kind === 'single' ? '세트 간 휴식' : '라운드 후 휴식'}</span>
              {/* 묶음의 라운드 후 휴식은 플랜 화면과 같은 범위·단위 (0~600초, 15초씩) */}
              <button aria-label="휴식 15초 줄이기" disabled={b.kind !== 'single' && b.roundRestSec <= ROUND_REST_MIN} onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: Math.max(15, x.restSec - 15) } : { ...x, roundRestSec: Math.max(ROUND_REST_MIN, x.roundRestSec - ROUND_REST_STEP) }))}>−15</button>
              <span>{b.kind === 'single' ? b.restSec : b.roundRestSec}초</span>
              <button aria-label="휴식 15초 늘리기" disabled={b.kind !== 'single' && b.roundRestSec >= ROUND_REST_MAX} onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: x.restSec + 15 } : { ...x, roundRestSec: Math.min(ROUND_REST_MAX, x.roundRestSec + ROUND_REST_STEP) }))}>+15</button>
            </div>
            {b.kind !== 'single' && (
              <div class="row" style={{ marginTop: '4px' }}>
                <span class="sub small grow">묶음 안 전환</span>
                <button aria-label="전환 5초 줄이기" disabled={b.transitionSec <= TRANSITION_MIN} onClick={() => setBlock(bi, (x) => ({ ...x, transitionSec: Math.max(TRANSITION_MIN, x.transitionSec - TRANSITION_STEP) }))}>−5</button>
                <span>{b.transitionSec}초</span>
                <button aria-label="전환 5초 늘리기" disabled={b.transitionSec >= TRANSITION_MAX} onClick={() => setBlock(bi, (x) => ({ ...x, transitionSec: Math.min(TRANSITION_MAX, x.transitionSec + TRANSITION_STEP) }))}>+5</button>
              </div>
            )}
            <div class="row wrap" style={{ marginTop: '6px' }}>
              {canMerge && <button onClick={() => setR(mergeWithNext(r, bi, samePart ? 'compound' : 'superset'))}>다음 운동과 {samePart ? '컴파운드 세트' : '슈퍼세트'}로 묶기</button>}
              {b.items.length > 1 && <button onClick={() => setR(splitBlock(r, bi, restFor))}>묶음 풀기</button>}
            </div>
          </div>
        );
      })}
      </div>
      <button class="big" onClick={() => setPicker({ add: undefined })}>+ 운동 추가</button>
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="grow" onClick={async () => { await save(); go('#/'); }}>저장</button>
        <button class="primary grow" disabled={!r.blocks.length} onClick={async () => { await save(); await startRoutine(s, saved()); }}>저장하고 시작</button>
      </div>
      {picker && (
        <ExercisePicker s={s} all={all} title={'add' in picker ? (picker.add ? `운동 추가 · ${picker.add}` : '운동 추가') : '운동 교체'}
          part={'add' in picker ? undefined : byId.get(r.blocks[picker.b]!.items[picker.i]!.exerciseId)?.part}
          startPart={'add' in picker ? picker.add : undefined}
          exclude={r.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            const reps = e.measure === 'time' ? 0 : targetReps(e);
            const seconds = e.measure === 'time' ? e.default_seconds ?? 30 : undefined;
            if ('add' in picker) {
              setR({ ...r, blocks: [...r.blocks, { kind: 'single', items: [{ exerciseId: e.id, sets: 3, reps, ...(seconds ? { seconds } : {}) }], restSec: restFor(e.id), roundRestSec: rest.round, transitionSec: rest.transition }] });
              pendingFocus.current = `${e.name_ko} 세트 늘리기`;
              say(`${e.name_ko}: 추가했어요`);
            } else setItem(picker.b, picker.i, (y) => ({ exerciseId: e.id, sets: y.sets, reps, ...(seconds ? { seconds } : {}) }));
            setPicker(null);
          }} />
      )}
    </main>
  );
}
