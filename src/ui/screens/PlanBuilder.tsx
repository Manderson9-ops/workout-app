import { lsGet, lsSet, lsRemove, scopedKey } from '../appName';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
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
import { GradeBadge, ExercisePicker, Sheet, mmss, Labeled, MiniStepper, Metric } from '../components';
import type { StepBtn } from '../components';
import { ScreenHeader } from '../header';
import { savePlanAsRoutine, startRoutine } from '../actions';
import { go } from '../nav';
import { useDragSort } from '../dragSort';
import { BodyMap } from '../bodyMapView';
import { PartSheet } from '../prioritySheet';
import { togglePart as togglePartForm, setPartPriority } from '../../core/planForm';
import { SESSION_CAP, MAX_SETS_BY_LEVEL } from '../../core/volume';
import { stepSets, stepReps, moveBlock, moveBlockTo, addBlock, regenerateWithLocks, groupKindWithNext, mergeWithNextBlock, splitPlanBlock, bulkSets, bulkReps, addToGroup, stepRoundRest, stepTransition, GROUP_MAX, ROUND_REST_MIN, ROUND_REST_MAX, ROUND_REST_STEP, TRANSITION_MIN, TRANSITION_MAX, TRANSITION_STEP, rangeText, changedCount, KEEP_ALL, SETS_MIN, SETS_MAX, REPS_MIN, REPS_MAX, SECS_MIN, SECS_MAX } from '../../core/planEdit';
import { Icon } from '../icons';

const PR_LABEL: Record<Priority, string> = { high: '높음', normal: '보통', low: '낮음' };
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
      : { kind: 'group', items: b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps, seconds: i.seconds })), roundRest: b.roundRestSec ?? plan.rest.round, transition: b.transitionSec };
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
  const [groupAdd, setGroupAdd] = useState<number | null>(null); // 묶음에 운동 추가 중인 블록 번호 (D-051)
  const [moved, setMoved] = useState<{ key: string; d: -1 | 1; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [groupMsg, setGroupMsg] = useState('');
  const flip = useRef(false); // 같은 안내가 반복돼도 다시 읽히게 보이지 않는 글자를 번갈아 붙임 (dragSort와 같은 방식)
  const pendingFocus = useRef<string | null>(null); // 묶음에 운동을 추가한 뒤 초점을 줄 버튼의 aria-label
  // 블록 끌어서 순서 바꾸기 (D-037). ↑↓ 버튼과 같은 결과
  const dnd = useDragSort(plan?.blocks.length ?? 0, (from, to) => {
    if (!plan) return;
    const next = moveBlockTo(plan, from, to);
    if (next !== plan) { setMoved(null); setGroupMsg(''); setPlan(recompute(next, all)); }
  }, (i) => plan?.blocks[i]?.items.map((it) => it.name).join(' + ') ?? '');
  const [name, setName] = useState('');
  const [showReasons, setShowReasons] = useState(true);
  const [tpl, setTpl] = useState('');
  const update = (p: Partial<Form>) => { const n = { ...f, ...p }; setF(n); lsSet(KEY, JSON.stringify(n)); };

  // D-043: 부위는 켜기/끄기만 (켜면 우선순위 '높음'), 우선순위는 고른 부위의 선택 상자로. 고른 순서(같은 우선순위의 앞뒤)는 유지
  const togglePart = (p: Part) => { const n = togglePartForm(f, p); update({ parts: n.parts, order: n.order }); };
  const setPriority = (p: Part, pr: Priority) => update({ parts: setPartPriority(f, p, pr).parts });
  // D-047: 부위를 누르면 (처음이면 '높음'으로 고르고) 우선순위 창을 연다. 빼기는 창에서
  const [partSheet, setPartSheet] = useState<Part | null>(null);
  const openPart = (p: Part) => { if (!f.parts[p]) togglePart(p); setPartSheet(p); };
  const request = (form: Form = f): PlanRequest => ({
    parts: form.order.filter((p) => form.parts[p]).map((p) => ({ part: p, priority: form.parts[p]! })),
    level: s.settings.level, minGrade: form.minGrade, targetMinutes: form.minutes, groupings: form.groupings,
    groupingPreference: form.prefer ? 'prefer' : 'when_needed', equipment: s.settings.equipment,
    excluded: [...s.meta.values()].filter((m) => m.excluded).map((m) => m.exerciseId),
    favorites: [...s.meta.values()].filter((m) => m.favorite).map((m) => m.exerciseId),
    userGrades: Object.fromEntries([...s.meta.values()].filter((m) => m.userGrade).map((m) => [m.exerciseId, m.userGrade!])),
    recent: s.workouts.filter((w) => w.endedAt && Date.now() - Date.parse(w.endedAt) < 14 * 86400000).flatMap((w) => w.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))),
  });
  const generate = (keepLocks = false, form: Form = f) => {
    const req = request(form);
    setGroupMsg('');
    const t0 = performance.now();
    let p: Plan;
    if (keepLocks && plan) {
      // 잠긴 운동은 바꾼 횟수·초까지 유지, 고르지 않은 부위에서 직접 추가한 운동도 남김 (D-015, D-036)
      p = recompute(regenerateWithLocks(plan, locks, req, (r) => generatePlan(r, all)), all);
      const ids = new Set(p.blocks.flatMap((b) => b.items.map((i) => i.exerciseId)));
      if ([...locks].some((id) => !ids.has(id))) setLocks(new Set([...locks].filter((id) => ids.has(id))));
    } else { setLocks(new Set()); p = generatePlan(req, all); }
    diag('plan', { v: performance.now() - t0 });
    const noop = !!plan && p.reasons[0] === KEEP_ALL;
    setPlan(p);
    if (noop) setShowReasons(true); // 그대로 둔 이유가 보이게
    else setName(defaultName(req));
  };
  // D-041: 목표보다 짧을 때 제안 부위를 '보통'으로 더해 바로 다시 만듦 (잠금은 유지)
  const addPartAndGenerate = (p: Part) => {
    const n: Form = { ...f, parts: { ...f.parts, [p]: 'normal' }, order: [...f.order.filter((x) => x !== p), p] };
    update(n);
    generate(locks.size > 0, n);
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
    setGroupMsg('');
    const old = plan.blocks[bi]!.items[ii]!;
    const blocks = plan.blocks.map((b, x) => x !== bi ? b : { ...b, items: b.items.map((it, y) => (y === ii ? fn(it) : it)).filter((it): it is PlanItem => !!it) });
    const next = recompute({ ...plan, blocks }, all);
    setPlan(next);
    // 지우거나 바꾼 운동의 잠금은 정리
    const still = new Set(next.blocks.flatMap((b) => b.items.map((i) => i.exerciseId)));
    if (locks.has(old.exerciseId) && !still.has(old.exerciseId)) { const n = new Set(locks); n.delete(old.exerciseId); setLocks(n); }
  };
  // D-051: 일괄·묶음 고치기. 바뀐 게 없으면(끝값) 아무것도 안 함
  const applyEdit = (next: Plan, msg: string) => {
    if (!plan || next === plan) return;
    setMoved(null);
    setPlan(recompute(next, all));
    flip.current = !flip.current;
    setGroupMsg(msg + (flip.current ? '\u200b' : ''));
  };
  // 일괄 세트·횟수: 몇 개가 바뀌었는지 안내. bi가 없으면 모든 운동
  const bulkDo = (kind: 'sets' | 'reps', d: number, bi?: number) => {
    if (!plan) return;
    const next = (kind === 'sets' ? bulkSets : bulkReps)(plan, d, bi);
    // 시간 운동이 섞여 있으면 "횟수·시간"으로 (N-3)
    const timed = plan.blocks.some((b, x) => (bi === undefined || x === bi) && b.items.some((i) => i.seconds !== undefined));
    applyEdit(next, `${bi === undefined ? '운동' : '묶음 운동'} ${changedCount(plan, next)}개 ${kind === 'sets' ? '세트' : timed ? '횟수·시간' : '횟수'} ${sgn(d)}`);
  };
  const bulkOff = (kind: 'sets' | 'reps', d: number, bi?: number) => !plan || (kind === 'sets' ? bulkSets : bulkReps)(plan, d, bi) === plan;
  // 라벨과 스테퍼를 한 덩어리로 (줄바꿈은 덩어리 단위로만)
  const labeled = (label: string, node: ComponentChildren) => <Labeled label={label}>{node}</Labeled>;
  const sgn = (d: number) => (d > 0 ? '+1' : '-1');
  const stepper = (label: string, mid: string, dec: StepBtn, inc: StepBtn) => <MiniStepper label={label} mid={mid} dec={dec} inc={inc} />;
  const addToGroupExercise = (bi: number, e: BuiltExercise) => {
    if (!plan) return;
    const g = resolveGrade(e, e.part, s.settings.level, undefined, s.meta.get(e.id)?.userGrade);
    const item: PlanItem = { exerciseId: e.id, name: e.name_ko, part: e.part, sets: 3, reps: e.measure === 'time' ? 0 : targetReps(e),
      ...(e.measure === 'time' ? { seconds: e.default_seconds ?? 30 } : {}),
      grade: g.value, gradeSource: g.source, estimated: g.estimated, substituted: false, locked: false, why: `${e.part} ${g.value} (직접 추가)`, rank: 99 };
    if (addToGroup(plan, bi, item) !== plan) pendingFocus.current = `${e.name_ko} 세트 늘리기`;
    applyEdit(addToGroup(plan, bi, item), `${e.name_ko}: 묶음에 추가했어요`);
  };
  const blockName = (b: PlanBlock) => b.items.map((i) => i.name).join(' + ');
  const blockKey = (b: PlanBlock) => b.items.map((i) => i.exerciseId).join('\u0001');
  const move = (bi: number, d: -1 | 1) => {
    if (!plan) return;
    const b = plan.blocks[bi]!;
    const next = moveBlock(plan, bi, d);
    if (next === plan) return;
    setPlan(recompute(next, all));
    setGroupMsg('');
    setMoved({ key: blockKey(b), d, msg: `${blockName(b)}: ${bi + 1 + d}번째로 옮김` });
  };
  const addExercise = (e: BuiltExercise) => {
    if (!plan) return;
    const g = resolveGrade(e, e.part, s.settings.level, undefined, s.meta.get(e.id)?.userGrade);
    const item: PlanItem = { exerciseId: e.id, name: e.name_ko, part: e.part, sets: 3, reps: e.measure === 'time' ? 0 : targetReps(e),
      ...(e.measure === 'time' ? { seconds: e.default_seconds ?? 30 } : {}),
      grade: g.value, gradeSource: g.source, estimated: g.estimated, substituted: false, locked: false, why: `${e.part} ${g.value} (직접 추가)`, rank: 99 };
    // 빈 플랜(시간 부족·후보 없음)에 처음 넣으면 웜업도 정해서 정상 플랜으로
    const base: Plan = plan.blocks.length ? plan : { ...plan, status: 'ok', warmup: warmupFor(plan.targetSec !== undefined ? plan.targetSec / 60 : undefined, e.part === '하체', { exercise: e, sets: 1, reps: item.reps, ...(item.seconds !== undefined ? { seconds: item.seconds } : {}) }) };
    setPlan(recompute(addBlock(base, item), all));
  };
  // 묶음에 운동을 추가하면 카드가 다시 만들어져 초점이 풀림: 새 운동의 '세트 늘리기'로 옮김
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want || groupAdd !== null) return;
    const btn = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find((x) => x.getAttribute('aria-label') === want);
    if (btn) { btn.focus(); pendingFocus.current = null; }
  }, [plan, groupAdd]);
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
      <span class="row gap4">
        <button {...dnd.handleProps(bi)}>≡</button>
        <span class="sub small" aria-hidden="true">{bi + 1}번째</span>
        <button class="ghost" data-move={key} data-dir="-1" aria-label={`${nm} 위로 (지금 ${bi + 1}번째)`} disabled={bi === 0} onClick={() => move(bi, -1)}>↑</button>
        <button class="ghost" data-move={key} data-dir="1" aria-label={`${nm} 아래로 (지금 ${bi + 1}번째)`} disabled={bi === plan.blocks.length - 1} onClick={() => move(bi, 1)}>↓</button>
      </span>
    );
  };
  const nParts = f.order.filter((p) => f.parts[p]).length;

  return (
    <main>
      <ScreenHeader title="플랜 만들기" />
      {/* PC 넓은 화면: 왼쪽 조건, 오른쪽 결과 (D-030) */}
      <div class="wide-2"><div>
      {/* D-055 3단계: 단계 카드 1 부위·우선순위 → 2 시간·등급·묶음 → 3 결과 */}
      <section class="card step-card" aria-label="1단계 부위·우선순위">
      <div class="card-head"><span class="step-no" aria-hidden="true">1</span><span class="card-title grow">부위·우선순위</span><span class="sub small">{nParts ? `${nParts}개 고름` : '아직 없음'}</span></div>
      <p class="sub small step-hint">그림이나 버튼을 누르면 우선순위를 고르는 창이 열려요 · 기본 높음</p>
      {/* 그림 먼저, 버튼은 아래: 버튼 글자가 길어져도 그림 위치가 바뀌지 않게 (연속으로 누를 때 빗나가지 않게) */}
      <BodyMap sel={f.parts} onPart={openPart} />
      <div class="row wrap" role="group" aria-label="부위">
        {PARTS.map((p) => {
          const pr = f.parts[p];
          return <button key={p} class={`chip ${pr ? 'p-' + pr : ''}`} onClick={() => openPart(p)} aria-pressed={!!pr} aria-haspopup="dialog" aria-label={`${p} ${pr ? PR_LABEL[pr] : '선택 안 함'}`}>{p}{pr ? ` · ${PR_LABEL[pr]}` : ''}</button>;
        })}
      </div>
      {partSheet && <PartSheet part={partSheet} pr={f.parts[partSheet]} onPick={(x) => setPriority(partSheet, x)}
        onRemove={() => { if (f.parts[partSheet]) togglePart(partSheet); setPartSheet(null); }} onClose={() => setPartSheet(null)} />}
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
      </section>
      <section class="card step-card" aria-label="2단계 시간·등급·묶음">
      <div class="card-head"><span class="step-no" aria-hidden="true">2</span><span class="card-title grow">시간·등급·묶음</span><span class="sub small">{f.minutes ? `${f.minutes}분` : '제한 없음'} · {f.minGrade} 이상</span></div>
      <label class="first">운동 시간</label>
      <div class="row wrap">
        {[30, 45, 60, 75, 90].map((m) => <button key={m} class={`chip ${f.minutes === m ? 'on' : ''}`} onClick={() => update({ minutes: m })}>{m}분</button>)}
        <button class={`chip ${f.minutes === undefined ? 'on' : ''}`} onClick={() => update({ minutes: undefined })}>제한 없음</button>
      </div>
      <div class="grid2">
        <div><label>최소 등급</label>
          <select value={f.minGrade} onChange={(e) => update({ minGrade: (e.target as HTMLSelectElement).value as Grade })} aria-label="최소 등급">
            {GRADES.filter((g) => g !== 'C-').map((g) => <option key={g} value={g}>{g} 이상</option>)}
          </select></div>
        <div><label>수준</label><button class="chip on full level-chip" aria-label={`수준 ${s.settings.level}, 설정에서 변경`} title="설정에서 변경" onClick={() => go('#/settings')}>{s.settings.level}<Icon name="chevron" size={14} /></button></div>
      </div>
      <p class="sub small" data-testid="level-rule">{s.settings.level}: 운동당 최대 {MAX_SETS_BY_LEVEL[s.settings.level]}세트(앱 기준) · 한 근육은 한 번에 {SESSION_CAP[s.settings.level]}세트까지({s.settings.level === '초보' ? '앱 기준' : '연구 근거'}, 보조로 쓰이면 0.5세트로 셈)</p>
      <label>세트 방식 (시간이 부족하면 자동으로 묶음)</label>
      <div class="row wrap">
        {(['superset', 'compound'] as Grouping[]).map((g) => (
          <button key={g} class={`chip ${f.groupings.includes(g) ? 'on' : ''}`} aria-pressed={f.groupings.includes(g)}
            onClick={() => update({ groupings: f.groupings.includes(g) ? f.groupings.filter((x) => x !== g) : [...f.groupings, g] })}>{g === 'superset' ? '슈퍼세트' : '컴파운드 세트'}</button>
        ))}
        <button class={`chip ${f.prefer ? 'on' : ''}`} aria-pressed={f.prefer} onClick={() => update({ prefer: !f.prefer })}>묶음 우선</button>
      </div>
      <div class="step-go">
        <button class="primary big" disabled={!nParts} onClick={() => generate(false)}>{nParts ? '플랜 만들기' : '부위를 먼저 고르세요'}</button>
      </div>
      </section>

      </div><div>
      {plan && (
        <section aria-label="생성된 플랜">
          <div class="panel step-card result-card">{/* .card 아님: 아래 운동 카드 목록(.card)과 구분 */}
          <div class="card-head"><span class="step-no" aria-hidden="true">3</span><h2 class="card-title grow">{plan.blocks.length === 0 ? '플랜을 만들 수 없어요' : plan.status === 'reduced' ? '결과 · 플랜 (일부 부위만)' : '결과 · 플랜'}</h2>
            </div>
          {plan.blocks.length > 0 && (() => {
            const items = plan.blocks.flatMap((b) => b.items);
            const sets = items.reduce((n, i) => n + i.sets, 0);
            return (
              <div class="metrics3 plan-metrics" aria-label="플랜 요약">
                <Metric label="예상 시간" value={mmss(plan.estimatedSec)} status={plan.targetSec ? `목표 ${Math.round(plan.targetSec / 60)}분` : '제한 없음'} />{/* 예상 시간은 여기 한 곳만 (분:초) */}
                <Metric label="세트" parts={[[sets, '세트']]} status={`웜업 제외`} />
                <Metric label="운동" parts={[[items.length, '개']]} status={`블록 ${plan.blocks.length}개`} />
              </div>
            );
          })()}
          <p class="sr-only" aria-live="polite">{moved?.msg ?? (groupMsg || dnd.msg)}</p>
          {plan.blocks.length > 0 && plan.targetSec !== undefined && plan.estimatedSec > plan.targetSec && <p class="pill warn-text" role="status">목표 시간보다 약 {Math.ceil((plan.estimatedSec - plan.targetSec) / 60)}분 길어요 (직접 바꾼 내용은 그대로 둠)</p>}
          {plan.blocks.length > 0 && plan.slack && plan.targetSec !== undefined && plan.estimatedSec < plan.targetSec - 300 && (
            <div class="slack-note" role="status" aria-label="목표 시간보다 짧은 이유">
              <strong>목표보다 약 {Math.floor((plan.targetSec - plan.estimatedSec) / 60)}분 짧아요</strong>
              <ul class="reasons">
                {plan.slack.cause.includes('cap') && <li>{plan.slack.level === '초보' ? `초보 기준(앱 판단)으로 한 근육은 한 번에 ${plan.slack.cap}세트까지라 더 넣지 않았어요` : `연구(회차당 볼륨 메타 회귀)에서 한 근육을 한 번에 약 ${plan.slack.cap}세트보다 많이 해도 근성장 차이를 확인하기 어려웠다고 해서 더 넣지 않았어요`}</li>}
                {plan.slack.level === '초보' && plan.slack.atMax && <li>초보는 운동당 최대 {plan.slack.maxSets}세트(앱 기준)라 세트도 더 늘리지 않았어요</li>}
                {plan.slack.cause.includes('pool') && <li>고를 수 있는 후보 운동을 모두 썼어요. 최소 등급을 낮추거나 부위를 더하면 늘어나요</li>}
                {plan.slack.cause.includes('time') && <li>운동이나 세트를 하나 더 넣으면 목표 시간을 넘어요</li>}
              </ul>
              {plan.slack.suggest.length > 0 && <div class="row wrap">{plan.slack.suggest.map((p) => <button key={p} class="chip" onClick={() => addPartAndGenerate(p)}>+ {p} 더해서 다시 만들기</button>)}</div>}
            </div>
          )}
          {plan.blocks.length > 0 && <p class="sub small">{plan.warmup.label ? `${plan.warmup.label} · ` : ''}휴식 다관절 {plan.rest.compound}초 · 단관절 {plan.rest.isolation}초{plan.blocks.some((b) => b.kind !== 'single') ? ` · 묶음 라운드 후 ${plan.rest.round}초` : ''}</p>}
          {plan.blocks.length > 0 && (
            <div class="row wrap bulk-row">
              {labeled('모든 운동 세트', stepper('모든 운동 세트', rangeText(plan.blocks.flatMap((b) => b.items), 'sets'),
                { aria: '모든 운동 세트 줄이기', off: bulkOff('sets', -1), on: () => bulkDo('sets', -1) },
                { aria: '모든 운동 세트 늘리기', off: bulkOff('sets', 1), on: () => bulkDo('sets', 1) }))}
              {labeled('모든 운동 횟수', stepper('모든 운동 횟수', rangeText(plan.blocks.flatMap((b) => b.items), 'reps'),
                { aria: '모든 운동 횟수 줄이기', off: bulkOff('reps', -1), on: () => bulkDo('reps', -1) },
                { aria: '모든 운동 횟수 늘리기', off: bulkOff('reps', 1), on: () => bulkDo('reps', 1) }))}
            </div>
          )}
          </div>
          {plan.blocks.map((b, bi) => (
            <div class="card" key={blockKey(b)} {...dnd.itemAttrs(bi)}>
              {plan.blocks.length > 1 && <div class="row between">{moveBtns(bi)}{b.kind === 'single' && <span class="pill">휴식 {b.restSec}초 · {mmss(b.timeSec)}</span>}</div>}
              {b.kind !== 'single' && <div class="row between"><span class="badge kind">{b.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}{b.twoStations ? ' · 기구 두 개' : ''}</span><span class="pill">라운드 후 휴식 {b.roundRestSec}초 · {mmss(b.timeSec)}</span></div>}
              {b.kind !== 'single' && (() => {
                // D-052: 이 묶음 세트·횟수는 접지 않고 항상 보임
                const nm = blockName(b);
                return (
                  <div class="row wrap group-bulk">
                    {labeled('이 묶음 세트', stepper(`${nm} 세트 모두`, rangeText(b.items, 'sets'),
                      { aria: `${nm} 세트 모두 줄이기`, off: bulkOff('sets', -1, bi), on: () => bulkDo('sets', -1, bi) },
                      { aria: `${nm} 세트 모두 늘리기`, off: bulkOff('sets', 1, bi), on: () => bulkDo('sets', 1, bi) }))}
                    {labeled('이 묶음 횟수', stepper(`${nm} 횟수 모두`, rangeText(b.items, 'reps'),
                      { aria: `${nm} 횟수 모두 줄이기`, off: bulkOff('reps', -1, bi), on: () => bulkDo('reps', -1, bi) },
                      { aria: `${nm} 횟수 모두 늘리기`, off: bulkOff('reps', 1, bi), on: () => bulkDo('reps', 1, bi) }))}
                  </div>
                );
              })()}
              {b.items.map((it, ii) => (
                <div key={it.exerciseId} class={ii ? 'plan-item next' : 'plan-item'}>
                  <div class="row between">
                    <div class="grow">
                      <div class="row"><GradeBadge g={{ value: it.grade, source: it.gradeSource, estimated: it.estimated }} /><strong>{it.name}</strong></div>
                      <div class="pill">{it.why}</div>
                    </div>
                    {b.kind === 'single' && plan.blocks.length <= 1 && <span class="pill">휴식 {b.restSec}초 · {mmss(b.timeSec)}</span>}
                  </div>
                  <div class="row wrap plan-steps">
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
                  <div class="row wrap plan-actions">
                    <button class={locks.has(it.exerciseId) ? 'chip on' : 'chip'} aria-pressed={locks.has(it.exerciseId)} onClick={() => { const n = new Set(locks); if (n.has(it.exerciseId)) n.delete(it.exerciseId); else n.add(it.exerciseId); setLocks(n); }}>{locks.has(it.exerciseId) ? <><Icon name="lock" size={16} />잠금됨</> : '잠금'}</button>
                    <button onClick={() => setPicker({ b: bi, i: ii })}>교체</button>
                    <button class="danger" aria-label={`${it.name} 삭제`} onClick={() => editItem(bi, ii, () => null)}>삭제</button>
                  </div>
                </div>
              ))}
              {b.kind !== 'single' && (() => {
                const nm = blockName(b);
                const rr = b.roundRestSec ?? plan.rest.round, tr = b.transitionSec ?? DEFAULT_TIME.transitionSec;
                const full = b.items.length >= GROUP_MAX;
                return (
                  <div>
                    {/* 묶음 설정은 기본으로 접어 둠. 요약에 지금 값을 보여 줌 */}
                    <details class="group-settings">
                      <summary>묶음 설정 · 라운드 후 {rr}초 · 전환 {tr}초</summary>
                      <div role="group" aria-label={`${nm} 묶음 설정`}>
                        <div class="row wrap">
                          {labeled('라운드 후 휴식', stepper(`${nm} 라운드 후 휴식`, `${rr}초`,
                            { aria: `${nm} 라운드 후 휴식 줄이기`, off: rr <= ROUND_REST_MIN, on: () => applyEdit(stepRoundRest(plan, bi, -1), `${nm} 라운드 후 휴식 ${Math.max(ROUND_REST_MIN, rr - ROUND_REST_STEP)}초`) },
                            { aria: `${nm} 라운드 후 휴식 늘리기`, off: rr >= ROUND_REST_MAX, on: () => applyEdit(stepRoundRest(plan, bi, 1), `${nm} 라운드 후 휴식 ${Math.min(ROUND_REST_MAX, rr + ROUND_REST_STEP)}초`) }))}
                        </div>
                        <div class="row wrap">
                          {labeled('운동 사이 전환', stepper(`${nm} 운동 사이 전환`, `${tr}초`,
                            { aria: `${nm} 운동 사이 전환 줄이기`, off: tr <= TRANSITION_MIN, on: () => applyEdit(stepTransition(plan, bi, -1), `${nm} 운동 사이 전환 ${Math.max(TRANSITION_MIN, tr - TRANSITION_STEP)}초`) },
                            { aria: `${nm} 운동 사이 전환 늘리기`, off: tr >= TRANSITION_MAX, on: () => applyEdit(stepTransition(plan, bi, 1), `${nm} 운동 사이 전환 ${Math.min(TRANSITION_MAX, tr + TRANSITION_STEP)}초`) }))}
                        </div>
                      </div>
                    </details>
                    <div class="row wrap plan-actions">
                      <button aria-label={`+ 묶음에 운동 추가: ${nm}`} disabled={full} onClick={() => setGroupAdd(bi)}>+ 묶음에 운동 추가</button>
                      {full && <span class="sub small">묶음은 {GROUP_MAX}개까지</span>}
                    </div>
                  </div>
                );
              })()}
              {(() => {
                // D-046: 다음 운동과 슈퍼세트(같은 부위면 컴파운드 세트)로 묶기 / 묶음 풀기
                const kind = groupKindWithNext(plan, bi);
                const label = kind === 'compound' ? '컴파운드 세트' : '슈퍼세트';
                // 같은 한 부위끼리 묶으면 앱 용어로 컴파운드 세트 (글자에 바로 보이게)
                const text = kind === 'compound' ? '다음과 묶기 · 컴파운드 세트' : '다음과 슈퍼세트로 묶기';
                const next = plan.blocks[bi + 1];
                if (!kind && b.items.length < 2) return null;
                return (
                  <div class="row wrap group-actions">
                    {kind && next && <button aria-label={`${text}: ${blockName(b)} + ${blockName(next)}`}
                      onClick={() => { setMoved(null); setPlan(recompute(mergeWithNextBlock(plan, bi), all)); setGroupMsg(`${blockName(b)} + ${blockName(next)}: ${label}로 묶었어요`); }}>{text}</button>}
                    {b.items.length > 1 && <button aria-label={`묶음 풀기: ${blockName(b)}`}
                      onClick={() => { setMoved(null); setPlan(recompute(splitPlanBlock(plan, bi), all)); setGroupMsg(`${blockName(b)}: 묶음을 풀었어요`); }}>묶음 풀기</button>}
                  </div>
                );
              })()}
            </div>
          ))}
          <button class="big plan-add" onClick={() => setAdding(true)}>+ 운동 추가</button>
          <button class="ghost" onClick={() => setShowReasons(!showReasons)}><Icon name="chevron" size={16} class={`rot${showReasons ? ' open' : ''}`} />이렇게 짠 이유</button>
          {showReasons && <ul class="reasons">{plan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <div class="row plan-save">
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
        <ExercisePicker s={s} all={all} title="운동 추가" ctxParts={plan.blocks.flatMap((b) => b.items.map((i) => i.part))}
          exclude={plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setAdding(false)}
          onPick={(e) => { addExercise(e); setAdding(false); }} />
      )}
      {groupAdd !== null && plan && plan.blocks[groupAdd] && (
        <ExercisePicker s={s} all={all} title="묶음에 운동 추가" ctxParts={plan.blocks.flatMap((b) => b.items.map((i) => i.part))}
          exclude={plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
          onClose={() => setGroupAdd(null)}
          onPick={(e) => { addToGroupExercise(groupAdd, e); setGroupAdd(null); }} />
      )}
      {saving && plan && (
        <Sheet title="루틴으로 저장" onClose={() => setSaving(false)}>
          <label>이름</label>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="루틴 이름" />
          <div class="row plan-save">
            <button class="grow" onClick={async () => { await savePlanAsRoutine(name || '내 루틴', plan.blocks, plan.estimatedSec, plan.warmup.seconds); setPlan(null); go('#/'); }}>저장만</button>
            <button class="primary grow" onClick={async () => { const r = await savePlanAsRoutine(name || '내 루틴', plan.blocks, plan.estimatedSec, plan.warmup.seconds); setPlan(null); await startRoutine(s, r); }}>저장하고 시작</button>
          </div>
        </Sheet>
      )}
      {!plan && <p class="sub small step-go">{byId.size}개 운동 중에서 등급·수준·장비·시간에 맞게 고릅니다. 영상 등급이 없는 운동은 "추정"으로 표시돼요.</p>}
      </div></div>
    </main>
  );
}
