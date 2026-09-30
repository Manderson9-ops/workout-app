import { lsGet, lsSet, lsRemove, scopedKey } from '../appName';
import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { catalog, templates } from '../catalog';
import { generatePlan } from '../../core/planner';
import { diag } from '../diag';
import type { Plan, PlanBlock, PlanItem, PlanRequest, Priority, Grouping } from '../../core/planner';
import { PARTS } from '../../core/types';
import type { Part, BuiltExercise } from '../../core/types';
import { GRADES } from '../../core/version';
import type { Grade } from '../../core/version';
import { resolveGrade } from '../../core/exercises';
import { DEFAULT_TIME, blockTime, targetReps, warmupFor } from '../../core/time';
import type { TimedBlock } from '../../core/time';
import { GradeBadge, ExercisePicker, Sheet, mmss } from '../components';
import { savePlanAsRoutine, startRoutine } from '../actions';
import { go } from '../nav';
import { stepSets, stepReps, moveBlock, addBlock, regenerateWithLocks, SETS_MIN, SETS_MAX, REPS_MIN, REPS_MAX, SECS_MIN, SECS_MAX } from '../../core/planEdit';

const PR_LABEL: Record<Priority, string> = { high: '높음', normal: '보통', low: '낮음' };
const NEXT: Record<string, Priority | undefined> = { none: 'high', high: 'normal', normal: 'low', low: undefined };
const KEY = 'planBuilder.v1';
const PLAN_KEY = 'planBuilder.plan';
const LOCK_KEY = 'planBuilder.locks';

interface Form { parts: Partial<Record<Part, Priority>>; order: Part[]; minGrade: Grade; minutes?: number; groupings: Grouping[]; prefer: boolean }
const loadForm = (): Form => {
  try { const f = JSON.parse(lsGet(KEY) ?? ''); if (f?.order) return f; } catch { /* 처음 */ }
  return { parts: {}, order: [], minGrade: 'B', minutes: 60, groupings: ['superset'], prefer: false };
};

/** 화면에서 세트·교체·삭제로 바꾼 뒤 시간 다시 계산 */
export function recompute(plan: Plan, all: BuiltExercise[]): Plan {
  const byId = new Map(all.map((e) => [e.id, e]));
  const blocks = plan.blocks.filter((b) => b.items.length).map((b): PlanBlock => {
    const kind = b.items.length === 1 ? 'single' : b.kind;
    const restSec = kind === 'single' ? (b.restSec ?? (byId.get(b.items[0]!.exerciseId)?.mechanics === 'compound' ? plan.rest.compound : plan.rest.isolation)) : undefined;
    const tb: TimedBlock = kind === 'single'
      ? { kind: 'single', items: b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps, seconds: i.seconds })), rest: restSec }
      : { kind: 'group', items: b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps, seconds: i.seconds })), roundRest: b.roundRestSec ?? plan.rest.round };
    const out: PlanBlock = { ...b, kind, timeSec: blockTime(tb) };
    if (kind === 'single') { out.restSec = restSec; delete out.roundRestSec; delete out.transitionSec; }
    return out;
  });
  const est = plan.warmup.seconds + blocks.reduce((t, b) => t + b.timeSec, 0) + Math.max(0, blocks.length - 1) * (DEFAULT_TIME.betweenRestSec + DEFAULT_TIME.moveSec);
  return { ...plan, blocks, estimatedSec: est };
}

export function PlanBuilder({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const [f, setF] = useState<Form>(loadForm);
  // 만든 플랜은 다른 화면에 다녀와도 남도록 sessionStorage에 보관
  const [plan, setPlanRaw] = useState<Plan | null>(() => { try { return JSON.parse(sessionStorage.getItem(scopedKey(PLAN_KEY)) ?? 'null'); } catch { return null; } });
  const setPlan = (p: Plan | null) => { setPlanRaw(p); if (p) sessionStorage.setItem(scopedKey(PLAN_KEY), JSON.stringify(p)); else sessionStorage.removeItem(scopedKey(PLAN_KEY)); };
  const [locks, setLocksRaw] = useState<Set<string>>(() => new Set(JSON.parse(sessionStorage.getItem(scopedKey(LOCK_KEY)) ?? '[]') as string[]));
  const setLocks = (l: Set<string>) => { setLocksRaw(l); sessionStorage.setItem(scopedKey(LOCK_KEY), JSON.stringify([...l])); };
  const [picker, setPicker] = useState<{ b: number; i: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [moved, setMoved] = useState<{ key: string; d: -1 | 1; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [showReasons, setShowReasons] = useState(true);
  const [tpl, setTpl] = useState('');
  const update = (p: Partial<Form>) => { const n = { ...f, ...p }; setF(n); lsSet(KEY, JSON.stringify(n)); };

  const cyclePart = (p: Part) => {
    const cur = f.parts[p];
    const nx = NEXT[cur ?? 'none'];
    const parts = { ...f.parts }; let order = f.order.filter((x) => x !== p);
    if (nx) { parts[p] = nx; order = [...order, p]; } else delete parts[p];
    update({ parts, order });
  };
  const request = (): PlanRequest => ({
    parts: f.order.filter((p) => f.parts[p]).map((p) => ({ part: p, priority: f.parts[p]! })),
    level: s.settings.level, minGrade: f.minGrade, targetMinutes: f.minutes, groupings: f.groupings,
    groupingPreference: f.prefer ? 'prefer' : 'when_needed', equipment: s.settings.equipment,
    excluded: [...s.meta.values()].filter((m) => m.excluded).map((m) => m.exerciseId),
    favorites: [...s.meta.values()].filter((m) => m.favorite).map((m) => m.exerciseId),
    userGrades: Object.fromEntries([...s.meta.values()].filter((m) => m.userGrade).map((m) => [m.exerciseId, m.userGrade!])),
    recent: s.workouts.filter((w) => w.endedAt && Date.now() - Date.parse(w.endedAt) < 14 * 86400000).flatMap((w) => w.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))),
  });
  const generate = (keepLocks = false) => {
    const req = request();
    const t0 = performance.now();
    let p: Plan;
    if (keepLocks && plan) {
      // 잠긴 운동은 바꾼 횟수·초까지 유지, 고르지 않은 부위에서 직접 추가한 운동도 남김 (D-015, D-036)
      p = recompute(regenerateWithLocks(plan, locks, req, (r) => generatePlan(r, all)), all);
      const ids = new Set(p.blocks.flatMap((b) => b.items.map((i) => i.exerciseId)));
      if ([...locks].some((id) => !ids.has(id))) setLocks(new Set([...locks].filter((id) => ids.has(id))));
    } else { setLocks(new Set()); p = generatePlan(req, all); }
    diag('plan', { v: performance.now() - t0 });
    setPlan(p);
    setName(defaultName(req));
  };
  const defaultName = (req: PlanRequest) => `${req.parts.map((p) => p.part).join('+')}${req.targetMinutes ? ` ${req.targetMinutes}분` : ''}`;
  const applyTemplate = (id: string, day: number) => {
    const t = templates.find((x) => x.id === id)!;
    const d = t.days[day]!;
    const prio = (k: number): Priority => (d.length <= 2 ? (k === 0 ? 'high' : 'normal') : k < Math.ceil(d.length / 3) ? 'high' : k < Math.ceil((2 * d.length) / 3) ? 'normal' : 'low');
    update({ parts: Object.fromEntries(d.map((p, k) => [p, prio(k)])), order: [...d] });
  };
  const editItem = (bi: number, ii: number, fn: (i: PlanItem) => PlanItem | null) => {
    if (!plan) return;
    const old = plan.blocks[bi]!.items[ii]!;
    const blocks = plan.blocks.map((b, x) => x !== bi ? b : { ...b, items: b.items.map((it, y) => (y === ii ? fn(it) : it)).filter((it): it is PlanItem => !!it) });
    const next = recompute({ ...plan, blocks }, all);
    setPlan(next);
    // 지우거나 바꾼 운동의 잠금은 정리
    const still = new Set(next.blocks.flatMap((b) => b.items.map((i) => i.exerciseId)));
    if (locks.has(old.exerciseId) && !still.has(old.exerciseId)) { const n = new Set(locks); n.delete(old.exerciseId); setLocks(n); }
  };
  const blockName = (b: PlanBlock) => b.items.map((i) => i.name).join(' + ');
  const blockKey = (b: PlanBlock) => b.items.map((i) => i.exerciseId).join('\u0001');
  const move = (bi: number, d: -1 | 1) => {
    if (!plan) return;
    const b = plan.blocks[bi]!;
    const next = moveBlock(plan, bi, d);
    if (next === plan) return;
    setPlan(recompute(next, all));
    setMoved({ key: blockKey(b), d, msg: `${blockName(b)}: ${bi + 1 + d}번째로 옮김` });
  };
  const addExercise = (e: BuiltExercise) => {
    if (!plan) return;
    const g = resolveGrade(e, e.part, s.settings.level, undefined, s.meta.get(e.id)?.userGrade);
    const item: PlanItem = { exerciseId: e.id, name: e.name_ko, part: e.part, sets: 3, reps: e.measure === 'time' ? 0 : targetReps(e),
      ...(e.measure === 'time' ? { seconds: e.default_seconds ?? 30 } : {}),
      grade: g.value, gradeSource: g.source, estimated: g.estimated, substituted: false, locked: false, why: `${e.part} ${g.value} (직접 추가)`, rank: 99 };
    // 빈 플랜(시간 부족·후보 없음)에 처음 넣으면 웜업도 정해서 정상 플랜으로
    const base: Plan = plan.blocks.length ? plan : { ...plan, status: 'ok', warmup: warmupFor(f.minutes, e.part === '하체', { exercise: e, sets: 1, reps: item.reps, ...(item.seconds !== undefined ? { seconds: item.seconds } : {}) }) };
    setPlan(recompute(addBlock(base, item), all));
  };
  // 순서를 바꾼 뒤: 같은 블록의 누른 방향 버튼에 초점(끝에 닿아 꺼졌으면 반대쪽), 바뀐 자리는 aria-live로 읽음
  useEffect(() => {
    if (!moved) return;
    const btns = [...document.querySelectorAll<HTMLButtonElement>('button[data-move]')].filter((x) => x.dataset.move === moved.key);
    const act = document.activeElement as HTMLElement | null;
    if (act && btns.includes(act as HTMLButtonElement) && !(act as HTMLButtonElement).disabled) return;
    if (act && act !== document.body && !btns.includes(act as HTMLButtonElement)) return; // 다른 곳에 초점이 있으면 건드리지 않음
    // 카드가 DOM에서 옮겨지면 초점이 풀림: 누른 방향 버튼 먼저, 꺼졌으면 반대쪽
    (btns.find((x) => x.dataset.dir === String(moved.d) && !x.disabled) ?? btns.find((x) => !x.disabled))?.focus();
  }, [moved]);
  const moveBtns = (bi: number) => {
    if (!plan || plan.blocks.length <= 1) return null;
    const b = plan.blocks[bi]!; const key = blockKey(b); const nm = blockName(b);
    return (
      <span class="row" style={{ gap: '4px' }}>
        <span class="sub small" aria-hidden="true">{bi + 1}번째</span>
        <button class="ghost" data-move={key} data-dir="-1" aria-label={`${nm} 위로 (지금 ${bi + 1}번째)`} disabled={bi === 0} onClick={() => move(bi, -1)}>↑</button>
        <button class="ghost" data-move={key} data-dir="1" aria-label={`${nm} 아래로 (지금 ${bi + 1}번째)`} disabled={bi === plan.blocks.length - 1} onClick={() => move(bi, 1)}>↓</button>
      </span>
    );
  };
  const nParts = f.order.filter((p) => f.parts[p]).length;

  return (
    <main>
      <h1>플랜 만들기</h1>
      {/* PC 넓은 화면: 왼쪽 조건, 오른쪽 결과 (D-030) */}
      <div class="wide-2"><div>
      <label>부위 (누를 때마다 우선순위 높음 → 보통 → 낮음 → 빼기)</label>
      <div class="row wrap">
        {PARTS.map((p) => {
          const pr = f.parts[p];
          return <button key={p} class={`chip ${pr ? 'p-' + pr : ''}`} onClick={() => cyclePart(p)} aria-pressed={!!pr} aria-label={`${p} ${pr ? PR_LABEL[pr] : '선택 안 함'}`}>{p}{pr ? ` · ${PR_LABEL[pr]}` : ''}</button>;
        })}
      </div>
      <label>분할 템플릿으로 채우기 (선택)</label>
      <div class="grid2">
        <select value={tpl} onChange={(e) => setTpl((e.target as HTMLSelectElement).value)} aria-label="분할 템플릿">
          <option value="">템플릿 고르기</option>
          {templates.filter((t) => t.generatable).map((t) => <option key={t.id} value={t.id}>{t.name}{t.grades.length ? ` (${t.grades.filter((g) => !g.sub_goal_only).map((g) => g.value + (g.levels.length ? ' ' + g.levels.join('·') : '')).join(', ')})` : ''}</option>)}
        </select>
        {tpl && <select value="" onChange={(e) => applyTemplate(tpl, Number((e.target as HTMLSelectElement).value))} aria-label="템플릿 요일">
          <option value="">몇 일차?</option>
          {templates.find((t) => t.id === tpl)!.days.map((d, i) => <option key={i} value={i}>{i + 1}일차: {d.join('+')}</option>)}
        </select>}
      </div>
      <label>운동 시간</label>
      <div class="row wrap">
        {[30, 45, 60, 75, 90].map((m) => <button key={m} class={`chip ${f.minutes === m ? 'on' : ''}`} onClick={() => update({ minutes: m })}>{m}분</button>)}
        <button class={`chip ${f.minutes === undefined ? 'on' : ''}`} onClick={() => update({ minutes: undefined })}>제한 없음</button>
      </div>
      <div class="grid2">
        <div><label>최소 등급</label>
          <select value={f.minGrade} onChange={(e) => update({ minGrade: (e.target as HTMLSelectElement).value as Grade })} aria-label="최소 등급">
            {GRADES.filter((g) => g !== 'C-').map((g) => <option key={g} value={g}>{g} 이상</option>)}
          </select></div>
        <div><label>수준</label><button class="chip on" style={{ width: '100%' }} onClick={() => go('#/settings')}>{s.settings.level} (설정에서 변경)</button></div>
      </div>
      <label>세트 방식 (시간이 부족하면 자동으로 묶음)</label>
      <div class="row wrap">
        {(['superset', 'compound'] as Grouping[]).map((g) => (
          <button key={g} class={`chip ${f.groupings.includes(g) ? 'on' : ''}`} aria-pressed={f.groupings.includes(g)}
            onClick={() => update({ groupings: f.groupings.includes(g) ? f.groupings.filter((x) => x !== g) : [...f.groupings, g] })}>{g === 'superset' ? '슈퍼세트' : '컴파운드 세트'}</button>
        ))}
        <button class={`chip ${f.prefer ? 'on' : ''}`} aria-pressed={f.prefer} onClick={() => update({ prefer: !f.prefer })}>묶음 우선</button>
      </div>
      <div style={{ marginTop: '14px' }}>
        <button class="primary big" disabled={!nParts} onClick={() => generate(false)}>{nParts ? '플랜 만들기' : '부위를 먼저 고르세요'}</button>
      </div>

      </div><div>
      {plan && (
        <section aria-label="생성된 플랜">
          <div class="row between" style={{ marginTop: '16px' }}>
            <h2>{plan.blocks.length === 0 ? '플랜을 만들 수 없어요' : plan.status === 'reduced' ? '플랜 (일부 부위만)' : '플랜'}</h2>
            {plan.blocks.length > 0 && <span class="sub">예상 {mmss(plan.estimatedSec)}{plan.targetSec ? ` / ${Math.round(plan.targetSec / 60)}분` : ''}</span>}
          </div>
          <p class="sr-only" aria-live="polite">{moved?.msg ?? ''}</p>
          {plan.blocks.length > 0 && plan.targetSec !== undefined && plan.estimatedSec > plan.targetSec && <p class="pill warn-text" role="status">목표 시간보다 약 {Math.ceil((plan.estimatedSec - plan.targetSec) / 60)}분 길어요 (직접 바꾼 내용은 그대로 둠)</p>}
          {plan.blocks.length > 0 && <p class="sub small">{plan.warmup.label ? `${plan.warmup.label} · ` : ''}휴식 다관절 {plan.rest.compound}초 · 단관절 {plan.rest.isolation}초{plan.blocks.some((b) => b.kind !== 'single') ? ` · 묶음 라운드 후 ${plan.rest.round}초` : ''}</p>}
          {plan.blocks.map((b, bi) => (
            <div class="card" key={blockKey(b)}>
              {plan.blocks.length > 1 && <div class="row between">{moveBtns(bi)}{b.kind === 'single' && <span class="pill">휴식 {b.restSec}초 · {mmss(b.timeSec)}</span>}</div>}
              {b.kind !== 'single' && <div class="row between"><span class="badge kind">{b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}{b.twoStations ? ' · 기구 두 개' : ''}</span><span class="pill">라운드 후 휴식 {b.roundRestSec}초 · {mmss(b.timeSec)}</span></div>}
              {b.items.map((it, ii) => (
                <div key={it.exerciseId} style={{ marginTop: ii ? '10px' : '4px' }}>
                  <div class="row between">
                    <div class="grow">
                      <div class="row"><GradeBadge g={{ value: it.grade, source: it.gradeSource, estimated: it.estimated }} /><strong>{it.name}</strong></div>
                      <div class="pill">{it.why}</div>
                    </div>
                    {b.kind === 'single' && plan.blocks.length <= 1 && <span class="pill">휴식 {b.restSec}초 · {mmss(b.timeSec)}</span>}
                  </div>
                  <div class="row wrap plan-steps" style={{ marginTop: '6px' }}>
                    <span class="mini-step" role="group" aria-label={`${it.name} 세트`}>
                      <button aria-label={`${it.name} 세트 줄이기`} disabled={it.sets <= SETS_MIN} onClick={() => editItem(bi, ii, (x) => stepSets(x, -1))}>−</button>
                      <span class="val">{it.sets}세트</span>
                      <button aria-label={`${it.name} 세트 늘리기`} disabled={it.sets >= SETS_MAX} onClick={() => editItem(bi, ii, (x) => stepSets(x, 1))}>+</button>
                    </span>
                    <span class="sub">×</span>
                    <span class="mini-step" role="group" aria-label={`${it.name} ${it.seconds !== undefined ? '시간' : '횟수'}`}>
                      <button aria-label={`${it.name} ${it.seconds !== undefined ? '시간' : '횟수'} 줄이기`} disabled={it.seconds !== undefined ? it.seconds <= SECS_MIN : it.reps <= REPS_MIN} onClick={() => editItem(bi, ii, (x) => stepReps(x, -1))}>−</button>
                      <span class="val">{it.seconds !== undefined ? `${it.seconds}초` : `${it.reps}회`}</span>
                      <button aria-label={`${it.name} ${it.seconds !== undefined ? '시간' : '횟수'} 늘리기`} disabled={it.seconds !== undefined ? it.seconds >= SECS_MAX : it.reps >= REPS_MAX} onClick={() => editItem(bi, ii, (x) => stepReps(x, 1))}>+</button>
                    </span>
                  </div>
                  <div class="row wrap" style={{ marginTop: '6px' }}>
                    <button class={locks.has(it.exerciseId) ? 'chip on' : 'chip'} aria-pressed={locks.has(it.exerciseId)} onClick={() => { const n = new Set(locks); if (n.has(it.exerciseId)) n.delete(it.exerciseId); else n.add(it.exerciseId); setLocks(n); }}>{locks.has(it.exerciseId) ? '🔒 잠금' : '잠금'}</button>
                    <button onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                    <button class="danger" aria-label={`${it.name} 삭제`} onClick={() => editItem(bi, ii, () => null)}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <button class="big" style={{ margin: '4px 0 10px' }} onClick={() => setAdding(true)}>+ 운동 추가</button>
          <button class="ghost" onClick={() => setShowReasons(!showReasons)}>{showReasons ? '▾' : '▸'} 이렇게 짠 이유</button>
          {showReasons && <ul class="reasons">{plan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <div class="row" style={{ marginTop: '12px' }}>
            <button class="grow" onClick={() => generate(true)}>다시 생성{locks.size ? ` (잠금 ${locks.size}개 유지)` : ''}</button>
            {plan.blocks.length > 0 && <button class="primary grow" onClick={() => setSaving(true)}>저장</button>}
          </div>
        </section>
      )}

      {picker && plan && (
        <ExercisePicker s={s} all={all} part={plan.blocks[picker.b]!.items[picker.i]!.part} title="운동 교체"
          exclude={plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            const old = plan.blocks[picker.b]!.items[picker.i]!;
            const g = resolveGrade(e, old.part, s.settings.level, undefined, s.meta.get(e.id)?.userGrade);
            editItem(picker.b, picker.i, () => ({ ...old, exerciseId: e.id, name: e.name_ko, reps: e.measure === 'time' ? 0 : targetReps(e), ...(e.measure === 'time' ? { seconds: e.default_seconds ?? 30 } : { seconds: undefined }),
              grade: g.value, gradeSource: g.source, estimated: g.estimated, substituted: false, why: `${old.part} ${g.value} (직접 교체)` }));
            const nl = new Set(locks); nl.delete(plan.blocks[picker.b]!.items[picker.i]!.exerciseId); nl.add(e.id); setLocks(nl);
            setPicker(null);
          }} />
      )}
      {adding && plan && (
        <ExercisePicker s={s} all={all} title="운동 추가"
          exclude={plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setAdding(false)}
          onPick={(e) => { addExercise(e); setAdding(false); }} />
      )}
      {saving && plan && (
        <Sheet title="루틴으로 저장" onClose={() => setSaving(false)}>
          <label>이름</label>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="루틴 이름" />
          <div class="row" style={{ marginTop: '12px' }}>
            <button class="grow" onClick={async () => { await savePlanAsRoutine(name || '내 루틴', plan.blocks, plan.estimatedSec, plan.warmup.seconds); setPlan(null); go('#/'); }}>저장만</button>
            <button class="primary grow" onClick={async () => { const r = await savePlanAsRoutine(name || '내 루틴', plan.blocks, plan.estimatedSec, plan.warmup.seconds); setPlan(null); await startRoutine(s, r); }}>저장하고 시작</button>
          </div>
        </Sheet>
      )}
      {!plan && <p class="sub small" style={{ marginTop: '14px' }}>{byId.size}개 운동 중에서 등급·수준·장비·시간에 맞게 고릅니다. 영상 등급이 없는 운동은 "추정"으로 표시돼요.</p>}
      </div></div>
    </main>
  );
}
