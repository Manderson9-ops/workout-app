import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate } from '../store';
import { catalog } from '../catalog';
import type { Routine, RoutineBlock } from '../../core/session';
import { targetReps } from '../../core/time';
import { ExercisePicker } from '../components';
import { startRoutine } from '../actions';
import { go } from '../nav';

export function RoutineEditor({ s, id }: { s: AppState; id: string }) {
  const r0 = s.routines.find((r) => r.id === id);
  const [r, setR] = useState<Routine | undefined>(r0);
  const [picker, setPicker] = useState<{ b: number; i: number } | 'add' | null>(null);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  if (!r) return <main><p>루틴을 찾을 수 없어요.</p><button onClick={() => go('#/')}>홈으로</button></main>;
  const setBlock = (bi: number, fn: (b: RoutineBlock) => RoutineBlock | null) =>
    setR({ ...r, blocks: r.blocks.map((b, x) => (x === bi ? fn(b) : b)).filter((b): b is RoutineBlock => !!b && b.items.length > 0) });
  const save = async () => { await mutate((d) => d.routines.put({ ...r, updatedAt: new Date().toISOString() })); };
  const move = (bi: number, dir: -1 | 1) => { const j = bi + dir; if (j < 0 || j >= r.blocks.length) return; const b = [...r.blocks]; [b[bi], b[j]] = [b[j]!, b[bi]!]; setR({ ...r, blocks: b }); };
  return (
    <main>
      <button class="ghost" onClick={() => go('#/')}>← 홈</button>
      <label>루틴 이름</label>
      <input value={r.name} aria-label="루틴 이름" onInput={(e) => setR({ ...r, name: (e.target as HTMLInputElement).value })} />
      {r.blocks.map((b, bi) => (
        <div class="card" key={bi}>
          <div class="row between">
            <span class="badge kind">{b.kind === 'single' ? '일반' : b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}</span>
            <div class="row"><button aria-label="위로" onClick={() => move(bi, -1)}>↑</button><button aria-label="아래로" onClick={() => move(bi, 1)}>↓</button></div>
          </div>
          {b.items.map((it, ii) => (
            <div key={ii} style={{ marginTop: '8px' }}>
              <strong>{byId.get(it.exerciseId)?.name_ko ?? it.exerciseId}</strong>
              <div class="row wrap" style={{ marginTop: '4px' }}>
                <button aria-label="세트 줄이기" onClick={() => setBlock(bi, (x) => ({ ...x, items: x.items.map((y, z) => (z === ii ? { ...y, sets: Math.max(1, y.sets - 1) } : y)) }))}>−</button>
                <span>{it.sets}세트 × {it.seconds ? `${it.seconds}초` : `${it.reps}회`}</span>
                <button aria-label="세트 늘리기" onClick={() => setBlock(bi, (x) => ({ ...x, items: x.items.map((y, z) => (z === ii ? { ...y, sets: Math.min(8, y.sets + 1) } : y)) }))}>+</button>
                <button onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                <button class="danger" onClick={() => setBlock(bi, (x) => { const items = x.items.filter((_, z) => z !== ii); return { ...x, kind: items.length === 1 ? 'single' : x.kind, items }; })}>삭제</button>
              </div>
            </div>
          ))}
          <div class="row" style={{ marginTop: '8px' }}>
            <span class="sub small grow">{b.kind === 'single' ? '세트 간 휴식' : '라운드 후 휴식'}</span>
            <button aria-label="휴식 15초 줄이기" onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: Math.max(15, x.restSec - 15) } : { ...x, roundRestSec: Math.max(15, x.roundRestSec - 15) }))}>−15</button>
            <span>{b.kind === 'single' ? b.restSec : b.roundRestSec}초</span>
            <button aria-label="휴식 15초 늘리기" onClick={() => setBlock(bi, (x) => (x.kind === 'single' ? { ...x, restSec: x.restSec + 15 } : { ...x, roundRestSec: x.roundRestSec + 15 }))}>+15</button>
          </div>
        </div>
      ))}
      <button class="big" onClick={() => setPicker('add')}>+ 운동 추가</button>
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="grow" onClick={async () => { await save(); go('#/'); }}>저장</button>
        <button class="primary grow" onClick={async () => { await save(); await startRoutine(s, { ...r, updatedAt: new Date().toISOString() }); }}>저장하고 시작</button>
      </div>
      {picker && (
        <ExercisePicker s={s} all={all} title={picker === 'add' ? '운동 추가' : '운동 교체'}
          part={picker === 'add' ? undefined : byId.get(r.blocks[picker.b]!.items[picker.i]!.exerciseId)?.part}
          exclude={r.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            const reps = e.measure === 'time' ? 0 : targetReps(e);
            const seconds = e.measure === 'time' ? e.default_seconds ?? 30 : undefined;
            if (picker === 'add') setR({ ...r, blocks: [...r.blocks, { kind: 'single', items: [{ exerciseId: e.id, sets: 3, reps, ...(seconds ? { seconds } : {}) }], restSec: e.mechanics === 'compound' ? 150 : 90, roundRestSec: 120, transitionSec: 10 }] });
            else setBlock(picker.b, (x) => ({ ...x, items: x.items.map((y, z) => (z === picker.i ? { exerciseId: e.id, sets: y.sets, reps, ...(seconds ? { seconds } : {}) } : y)) }));
            setPicker(null);
          }} />
      )}
    </main>
  );
}
