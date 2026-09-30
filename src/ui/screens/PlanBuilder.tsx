import { useState } from 'preact/hooks';
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
import { DEFAULT_TIME, blockTime, targetReps } from '../../core/time';
import type { TimedBlock } from '../../core/time';
import { GradeBadge, ExercisePicker, Sheet, mmss } from '../components';
import { savePlanAsRoutine, startRoutine } from '../actions';
import { go } from '../nav';

const PR_LABEL: Record<Priority, string> = { high: '높음', normal: '보통', low: '낮음' };
const NEXT: Record<string, Priority | undefined> = { none: 'high', high: 'normal', normal: 'low', low: undefined };
const KEY = 'planBuilder.v1';
const PLAN_KEY = 'planBuilder.plan';
const LOCK_KEY = 'planBuilder.locks';

interface Form { parts: Partial<Record<Part, Priority>>; order: Part[]; minGrade: Grade; minutes?: number; groupings: Grouping[]; prefer: boolean }
const loadForm = (): Form => {
  try { const f = JSON.parse(localStorage.getItem(KEY) ?? ''); if (f?.order) return f; } catch { /* 처음 */ }
  return { parts: {}, order: [], minGrade: 'B', minutes: 60, groupings: ['superset'], prefer: false };
};

/** 화면에서 세트·교체·삭제로 바꾼 뒤 시간 다시 계산 */
export function recompute(plan: Plan, all: BuiltExercise[]): Plan {
  const byId = new Map(all.map((e) => [e.id, e]));
  const blocks = plan.blocks.filter((b) => b.items.length).map((b): PlanBlock => {
    const kind = b.items.length === 1 ? 'single' : b.kind;
    const restSec = kind === 'single' ? (b.restSec ?? (byId.get(b.items[0]!.exerciseId)?.mechanics === 'compound' ? plan.rest.compound : plan.rest.isolation)) : undefined;
    const tb: TimedBlock = kind === 'single'
      ? { kind: 'single', items: b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps })), rest: restSec }
      : { kind: 'group', items: b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps })), roundRest: b.roundRestSec ?? plan.rest.round };
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
  const [plan, setPlanRaw] = useState<Plan | null>(() => { try { return JSON.parse(sessionStorage.getItem(PLAN_KEY) ?? 'null'); } catch { return null; } });
  const setPlan = (p: Plan | null) => { setPlanRaw(p); if (p) sessionStorage.setItem(PLAN_KEY, JSON.stringify(p)); else sessionStorage.removeItem(PLAN_KEY); };
  const [locks, setLocksRaw] = useState<Set<string>>(() => new Set(JSON.parse(sessionStorage.getItem(LOCK_KEY) ?? '[]') as string[]));
  const setLocks = (l: Set<string>) => { setLocksRaw(l); sessionStorage.setItem(LOCK_KEY, JSON.stringify([...l])); };
  const [picker, setPicker] = useState<{ b: number; i: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [showReasons, setShowReasons] = useState(true);
  const [tpl, setTpl] = useState('');
  const update = (p: Partial<Form>) => { const n = { ...f, ...p }; setF(n); localStorage.setItem(KEY, JSON.stringify(n)); };

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
    if (keepLocks && plan) {
      const items = plan.blocks.flatMap((b) => b.items);
      req.locked = items.filter((i) => locks.has(i.exerciseId)).map((i) => ({ exerciseId: i.exerciseId, part: i.part, sets: i.sets }));
      // 모두 잠갔으면 잠근 운동만으로 다시 계산 (D-015)
      req.lockedOnly = items.length > 0 && items.every((i) => locks.has(i.exerciseId));
    } else setLocks(new Set());
    const t0 = performance.now(); const p = generatePlan(req, all); diag('plan', { v: performance.now() - t0 });
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
  const nParts = f.order.filter((p) => f.parts[p]).length;

  return (
    <main>
      <h1>플랜 만들기</h1>
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

      {plan && (
        <section aria-label="생성된 플랜">
          <div class="row between" style={{ marginTop: '16px' }}>
            <h2>{plan.status === 'ok' ? '플랜' : plan.status === 'reduced' ? '플랜 (일부 부위만)' : '플랜을 만들 수 없어요'}</h2>
            {plan.blocks.length > 0 && <span class="sub">예상 {mmss(plan.estimatedSec)}{plan.targetSec ? ` / ${Math.round(plan.targetSec / 60)}분` : ''}</span>}
          </div>
          {plan.blocks.length > 0 && <p class="sub small">{plan.warmup.label} · 휴식 다관절 {plan.rest.compound}초 · 단관절 {plan.rest.isolation}초{plan.blocks.some((b) => b.kind !== 'single') ? ` · 묶음 라운드 후 ${plan.rest.round}초` : ''}</p>}
          {plan.blocks.map((b, bi) => (
            <div class="card" key={bi}>
              {b.kind !== 'single' && <div class="row between"><span class="badge kind">{b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}{b.twoStations ? ' · 기구 두 개' : ''}</span><span class="pill">라운드 후 휴식 {b.roundRestSec}초 · {mmss(b.timeSec)}</span></div>}
              {b.items.map((it, ii) => (
                <div key={it.exerciseId} style={{ marginTop: ii ? '10px' : '4px' }}>
                  <div class="row between">
                    <div class="grow">
                      <div class="row"><GradeBadge g={{ value: it.grade, source: it.gradeSource, estimated: it.estimated }} /><strong>{it.name}</strong></div>
                      <div class="pill">{it.why}</div>
                    </div>
                    {b.kind === 'single' && <span class="pill">휴식 {b.restSec}초 · {mmss(b.timeSec)}</span>}
                  </div>
                  <div class="row wrap" style={{ marginTop: '6px' }}>
                    <button aria-label={`${it.name} 세트 줄이기`} onClick={() => editItem(bi, ii, (x) => ({ ...x, sets: Math.max(1, x.sets - 1) }))}>−</button>
                    <span>{it.sets}세트 × {it.seconds ? `${it.seconds}초` : `${it.reps}회`}</span>
                    <button aria-label={`${it.name} 세트 늘리기`} onClick={() => editItem(bi, ii, (x) => ({ ...x, sets: Math.min(8, x.sets + 1) }))}>+</button>
                    <button class={locks.has(it.exerciseId) ? 'chip on' : 'chip'} aria-pressed={locks.has(it.exerciseId)} onClick={() => { const n = new Set(locks); if (n.has(it.exerciseId)) n.delete(it.exerciseId); else n.add(it.exerciseId); setLocks(n); }}>{locks.has(it.exerciseId) ? '🔒 잠금' : '잠금'}</button>
                    <button onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                    <button class="danger" aria-label={`${it.name} 삭제`} onClick={() => editItem(bi, ii, () => null)}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
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
    </main>
  );
}
