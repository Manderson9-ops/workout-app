import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import type { Routine, RoutineBlock, RoutineItem } from '../../core/session';
import { routineEstimate, mergeWithNext, splitBlock, applyRestToAll } from '../../core/session';
import { targetReps } from '../../core/time';
import { ExercisePicker, mmss } from '../components';
import { startRoutine } from '../actions';
import { go } from '../nav';

const KIND_LABEL: Record<RoutineBlock['kind'], string> = { single: '일반', superset: '슈퍼세트', compound: '컴파운드 세트' };

export function RoutineEditor({ s, id }: { s: AppState; id: string }) {
  const r0 = s.routines.find((r) => r.id === id);
  const [r, setR] = useState<Routine | undefined>(r0);
  const [picker, setPicker] = useState<{ b: number; i: number } | 'add' | null>(null);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const rest = s.settings.rest;
  if (!r) return <main><p>루틴을 찾을 수 없어요.</p><button onClick={() => go('#/')}>홈으로</button></main>;
  const restFor = (exId: string) => (byId.get(exId)?.mechanics === 'compound' ? rest.compound : rest.isolation);
  const setBlock = (bi: number, fn: (b: RoutineBlock) => RoutineBlock | null) =>
    setR({ ...r, blocks: r.blocks.map((b, x) => (x === bi ? fn(b) : b)).filter((b): b is RoutineBlock => !!b && b.items.length > 0) });
  const setItem = (bi: number, ii: number, fn: (i: RoutineItem) => RoutineItem) => setBlock(bi, (x) => ({ ...x, items: x.items.map((y, z) => (z === ii ? fn(y) : y)) }));
  const est = routineEstimate(r, byId, rest.between) + (r.warmupSec ?? 0);
  const saved = (): Routine => ({ ...r, estimatedSec: est, updatedAt: new Date().toISOString() });
  const save = async () => { await mutate((d) => d.routines.put(saved())); };
  const move = (bi: number, dir: -1 | 1) => { const j = bi + dir; if (j < 0 || j >= r.blocks.length) return; const b = [...r.blocks]; [b[bi], b[j]] = [b[j]!, b[bi]!]; setR({ ...r, blocks: b }); };
  const partOf = (b: RoutineBlock) => new Set(b.items.map((i) => byId.get(i.exerciseId)?.part));
  return (
    <main>
      <button class="ghost" onClick={() => go('#/')}>← 홈</button>
      <label>루틴 이름</label>
      <input value={r.name} aria-label="루틴 이름" onInput={(e) => setR({ ...r, name: (e.target as HTMLInputElement).value })} />
      <p class="sub small">예상 {mmss(est)} {r.warmupSec ? `(웜업 ${Math.round(r.warmupSec / 60)}분 포함)` : ''}</p>
      <div class="row wrap">
        <span class="sub small grow">모든 블록 휴식 한 번에 (루틴 기본값)</span>
        <button onClick={() => setR(applyRestToAll(r, rest.isolation, rest.round))}>짧게 {rest.isolation}초</button>
        <button onClick={() => setR(applyRestToAll(r, rest.compound, rest.round))}>길게 {rest.compound}초</button>
      </div>
      {!r.blocks.length && <div class="empty">운동을 추가해 주세요</div>}
      <div class="wide-cards-lg">
      {r.blocks.map((b, bi) => {
        const next = r.blocks[bi + 1];
        const canMerge = !!next && b.items.length + next.items.length <= 4;
        const samePart = next ? [...partOf(b)].every((p) => partOf(next).has(p)) && partOf(b).size === 1 : false;
        return (
          <div class="card" key={bi}>
            <div class="row between">
              <span><span class="sub small" aria-label={`${bi + 1}번 블록`}>{bi + 1} </span><span class="badge kind">{KIND_LABEL[b.kind]}</span></span>
              <div class="row"><button aria-label={`${bi + 1}번 블록 위로`} onClick={() => move(bi, -1)}>↑</button><button aria-label={`${bi + 1}번 블록 아래로`} onClick={() => move(bi, 1)}>↓</button></div>
            </div>
            {b.items.map((it, ii) => (
              <div key={ii} style={{ marginTop: '8px' }}>
                <strong>{b.kind !== 'single' ? `${String.fromCharCode(65 + ii)}. ` : ''}{byId.get(it.exerciseId)?.name_ko ?? it.exerciseId}</strong>
                <div class="row wrap" style={{ marginTop: '4px' }}>
                  <button aria-label="세트 줄이기" onClick={() => setItem(bi, ii, (y) => ({ ...y, sets: Math.max(1, y.sets - 1) }))}>−</button>
                  <span>{it.sets}세트</span>
                  <button aria-label="세트 늘리기" onClick={() => setItem(bi, ii, (y) => ({ ...y, sets: Math.min(8, y.sets + 1) }))}>+</button>
                  {it.seconds !== undefined ? (
                    <>
                      <button aria-label="초 줄이기" onClick={() => setItem(bi, ii, (y) => ({ ...y, seconds: Math.max(5, (y.seconds ?? 30) - 5) }))}>−</button>
                      <span>{it.seconds}초</span>
                      <button aria-label="초 늘리기" onClick={() => setItem(bi, ii, (y) => ({ ...y, seconds: (y.seconds ?? 30) + 5 }))}>+</button>
                    </>
                  ) : (
                    <>
                      <button aria-label="목표 횟수 줄이기" onClick={() => setItem(bi, ii, (y) => ({ ...y, reps: Math.max(1, y.reps - 1) }))}>−</button>
                      <span>{it.reps}회</span>
                      <button aria-label="목표 횟수 늘리기" onClick={() => setItem(bi, ii, (y) => ({ ...y, reps: y.reps + 1 }))}>+</button>
                    </>
                  )}
                </div>
                <div class="row wrap" style={{ marginTop: '4px' }}>
                  <button onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                  <button class="danger" onClick={() => setBlock(bi, (x) => { const items = x.items.filter((_, z) => z !== ii); return { ...x, kind: items.length === 1 ? 'single' : x.kind, restSec: items.length === 1 ? restFor(items[0]!.exerciseId) : x.restSec, items }; })}>삭제</button>
                </div>
              </div>
            ))}
            <div class="row" style={{ marginTop: '8px' }}>
              <span class="sub small grow">{b.kind === 'single' ? '세트 간 휴식' : '라운드 후 휴식'}</span>
              <button aria-label="휴식 15초 줄이기" onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: Math.max(15, x.restSec - 15) } : { ...x, roundRestSec: Math.max(15, x.roundRestSec - 15) }))}>−15</button>
              <span>{b.kind === 'single' ? b.restSec : b.roundRestSec}초</span>
              <button aria-label="휴식 15초 늘리기" onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: x.restSec + 15 } : { ...x, roundRestSec: x.roundRestSec + 15 }))}>+15</button>
            </div>
            {b.kind !== 'single' && (
              <div class="row" style={{ marginTop: '4px' }}>
                <span class="sub small grow">묶음 안 전환</span>
                <button aria-label="전환 5초 줄이기" onClick={() => setBlock(bi, (x) => ({ ...x, transitionSec: Math.max(0, x.transitionSec - 5) }))}>−5</button>
                <span>{b.transitionSec}초</span>
                <button aria-label="전환 5초 늘리기" onClick={() => setBlock(bi, (x) => ({ ...x, transitionSec: x.transitionSec + 5 }))}>+5</button>
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
      <button class="big" onClick={() => setPicker('add')}>+ 운동 추가</button>
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="grow" onClick={async () => { await save(); go('#/'); }}>저장</button>
        <button class="primary grow" disabled={!r.blocks.length} onClick={async () => { await save(); await startRoutine(s, saved()); }}>저장하고 시작</button>
      </div>
      {picker && (
        <ExercisePicker s={s} all={all} title={picker === 'add' ? '운동 추가' : '운동 교체'}
          part={picker === 'add' ? undefined : byId.get(r.blocks[picker.b]!.items[picker.i]!.exerciseId)?.part}
          exclude={r.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            const reps = e.measure === 'time' ? 0 : targetReps(e);
            const seconds = e.measure === 'time' ? e.default_seconds ?? 30 : undefined;
            if (picker === 'add') setR({ ...r, blocks: [...r.blocks, { kind: 'single', items: [{ exerciseId: e.id, sets: 3, reps, ...(seconds ? { seconds } : {}) }], restSec: restFor(e.id), roundRestSec: rest.round, transitionSec: rest.transition }] });
            else setItem(picker.b, picker.i, (y) => ({ exerciseId: e.id, sets: y.sets, reps, ...(seconds ? { seconds } : {}) }));
            setPicker(null);
          }} />
      )}
    </main>
  );
}
