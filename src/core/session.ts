/**
 * 운동 기록 세션 (BLUEPRINT 4.3, 4.4). 화면과 분리된 순수 함수. 모든 변경은 새 객체를 돌려준다.
 */
import type { PlanBlock } from './planner';
import type { Exercise } from './types';
import { blockTime, DEFAULT_TIME } from './time';
import type { TimedBlock } from './time';
import { moveItem } from './reorder';
import { findItem } from './syncMerge';

export interface RoutineItem { exerciseId: string; sets: number; reps: number; seconds?: number }
export interface RoutineBlock { kind: 'single' | 'superset' | 'compound'; items: RoutineItem[]; restSec: number; roundRestSec: number; transitionSec: number }
export interface Routine { id: string; name: string; createdAt: string; updatedAt: string; blocks: RoutineBlock[]; estimatedSec?: number; warmupSec?: number; note?: string }

export interface SetLog {
  weight?: number; reps?: number; seconds?: number; rir?: number; warmup: boolean; done: boolean; doneAt?: string;
  /** 무게가 자동으로 채워짐 (지난 기록·앞 세트). 사용자가 고치면 false. 앞 세트 완료 시 자동 값만 이어받는다 */
  auto?: boolean;
  memo?: string;
}
export interface WorkoutItem { exerciseId: string; target: { sets: number; reps: number; seconds?: number }; sets: SetLog[]; skipped?: boolean; memo?: string }
export interface WorkoutBlock { kind: RoutineBlock['kind']; items: WorkoutItem[]; restSec: number; roundRestSec: number; transitionSec: number }
export interface Timer { startedAt: number; endsAt: number; label: string; kind: 'set' | 'transition' | 'round' | 'between' | 'warmup' }
export interface Workout {
  id: string; routineId?: string; name: string;
  /** 진행 중 운동의 주인 기기 (동기화, D-029). 없으면 이 기기 것 (옛 기록) */
  ownerDeviceId?: string;
  /** 주인이 된 시각 (가져오기 때 새로. 더 오래된 주인의 늦은 기록을 가려냄) */
  ownerAt?: string;
  /** 주인이 바뀐 횟수 (가져올 때마다 +1). 서버가 이 번호로 새 주인·옛 주인을 가림 (기기 시계와 무관, D-029) */
  ownerSeq?: number;
  /** 다른 기기에서 늦게 온 기록 사본: 원래 운동 ID (통계에서 빼고 합치기/지우기) */
  pendingMerge?: string;
  startedAt: string; endedAt?: string;
  blocks: WorkoutBlock[];
  timer: Timer | null;
  memo?: string;
  /** 블록(운동) 사이 휴식 (시작 때 설정값) */
  betweenSec?: number;
  /** 루틴의 예상 시간 (예정 대비 앞서는지/늦는지 표시용) */
  plannedSec?: number;
  /** 끝낸 뒤 고친 시각 (D-035). 상세 화면에 "고침" 표시 */
  editedAt?: string;
}

export const REST_DEFAULTS = { betweenSec: 60, warmupSec: 60 };

export function planToRoutine(id: string, name: string, now: string, blocks: PlanBlock[], estimatedSec?: number, warmupSec?: number): Routine {
  return {
    id, name, createdAt: now, updatedAt: now, estimatedSec, ...(warmupSec !== undefined ? { warmupSec } : {}),
    blocks: blocks.map((b) => ({
      kind: b.kind,
      items: b.items.map((i) => ({ exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, ...(i.seconds !== undefined ? { seconds: i.seconds } : {}) })),
      restSec: b.restSec ?? 90, roundRestSec: b.roundRestSec ?? 120, transitionSec: b.transitionSec ?? 10,
    })),
  };
}

/** 지난 기록에서 운동별 마지막 작업 세트들 (웜업 제외) */
export function lastSets(history: Workout[], exerciseId: string): SetLog[] {
  const done = history.filter((w) => w.endedAt).sort((a, b) => (a.endedAt! < b.endedAt! ? 1 : -1));
  for (const w of done) for (const b of w.blocks) for (const it of b.items) {
    if (it.exerciseId !== exerciseId) continue;
    const work = it.sets.filter((s) => s.done && !s.warmup);
    if (work.length) return work;
  }
  return [];
}

export function startWorkout(id: string, routine: Routine, now: string, history: Workout[], opts: { betweenSec?: number } = {}): Workout {
  return {
    id, routineId: routine.id, name: routine.name, startedAt: now, timer: null,
    ...(opts.betweenSec !== undefined ? { betweenSec: opts.betweenSec } : {}),
    ...(routine.estimatedSec !== undefined ? { plannedSec: routine.estimatedSec } : {}),
    blocks: routine.blocks.map((b) => ({
      kind: b.kind, restSec: b.restSec, roundRestSec: b.roundRestSec, transitionSec: b.transitionSec,
      items: b.items.map((i) => {
        const prev = lastSets(history, i.exerciseId);
        return {
          exerciseId: i.exerciseId, target: { sets: i.sets, reps: i.reps, ...(i.seconds !== undefined ? { seconds: i.seconds } : {}) },
          sets: Array.from({ length: i.sets }, (_, k) => {
            const p = prev[Math.min(k, prev.length - 1)];
            return {
              warmup: false, done: false,
              ...(p?.weight !== undefined ? { weight: p.weight, auto: true } : {}),
              ...(i.seconds !== undefined ? { seconds: p?.seconds ?? i.seconds } : { reps: p?.reps ?? i.reps }),
            };
          }),
        };
      }),
    })),
  };
}

export interface Step { block: number; item: number; set: number }

/** 운동 순서: 단일 블록은 세트 순서, 묶음은 라운드마다 운동을 번갈아. 웜업 세트는 해당 운동 첫 작업 세트 앞 */
export function steps(w: Workout): Step[] {
  const out: Step[] = [];
  w.blocks.forEach((b, bi) => {
    const active = b.items.map((it, ii) => ({ it, ii })).filter((x) => !x.it.skipped);
    if (b.kind === 'single' || active.length <= 1) {
      for (const { it, ii } of active) it.sets.forEach((_, si) => out.push({ block: bi, item: ii, set: si }));
      return;
    }
    // 웜업 세트는 묶음 시작 전에 먼저
    for (const { it, ii } of active) it.sets.forEach((s, si) => { if (s.warmup) out.push({ block: bi, item: ii, set: si }); });
    const work = active.map(({ it, ii }) => ({ ii, idx: it.sets.map((s, si) => (s.warmup ? -1 : si)).filter((x) => x >= 0) }));
    const rounds = Math.max(0, ...work.map((x) => x.idx.length));
    for (let r = 0; r < rounds; r++) for (const x of work) if (x.idx[r] !== undefined) out.push({ block: bi, item: x.ii, set: x.idx[r]! });
  });
  return out;
}

export function currentStep(w: Workout): Step | undefined {
  return steps(w).find((s) => !w.blocks[s.block]!.items[s.item]!.sets[s.set]!.done);
}

/** 이 세트를 마친 뒤 쉴 시간과 종류 (BLUEPRINT 4.4) */
export function restAfter(w: Workout, step: Step): { sec: number; kind: Timer['kind']; label: string } | null {
  const all = steps(w);
  const i = all.findIndex((s) => s.block === step.block && s.item === step.item && s.set === step.set);
  const next = all.slice(i + 1).find((s) => !w.blocks[s.block]!.items[s.item]!.sets[s.set]!.done);
  if (!next) return null;
  const b = w.blocks[step.block]!;
  const cur = b.items[step.item]!.sets[step.set]!;
  if (cur.warmup) return { sec: REST_DEFAULTS.warmupSec, kind: 'warmup', label: '웜업 후 휴식' };
  if (next.block !== step.block) return { sec: w.betweenSec ?? REST_DEFAULTS.betweenSec, kind: 'between', label: '다음 운동으로 이동' };
  if (b.kind === 'single' || b.items.filter((x) => !x.skipped).length <= 1) return { sec: b.restSec, kind: 'set', label: '세트 간 휴식' };
  if (next.item !== step.item && !w.blocks[next.block]!.items[next.item]!.sets[next.set]!.warmup) {
    // 같은 라운드의 다음 운동인지: 다음 운동의 이번 라운드 번호가 현재와 같으면 전환
    const roundOf = (s: Step) => w.blocks[s.block]!.items[s.item]!.sets.slice(0, s.set + 1).filter((x) => !x.warmup).length;
    if (roundOf(next) === roundOf(step)) return { sec: b.transitionSec, kind: 'transition', label: '다음 운동으로 바로 (묶음)' };
  }
  return { sec: b.roundRestSec, kind: 'round', label: '라운드 후 휴식' };
}

/** 운동 하나(블록 b의 i번째)만 바꾼 새 Workout. 모든 운동 단위 변경이 이 함수를 거친다 */
export function patchItem(w: Workout, block: number, item: number, fn: (it: WorkoutItem) => WorkoutItem): Workout {
  return { ...w, blocks: w.blocks.map((b, bi) => bi !== block ? b : { ...b, items: b.items.map((it, ii) => (ii === item ? fn(it) : it)) }) };
}
/** 세트 하나만 바꿈 */
function patchSet(w: Workout, s: Step, fn: (x: SetLog) => SetLog): Workout {
  return patchItem(w, s.block, s.item, (it) => ({ ...it, sets: it.sets.map((x, si) => (si === s.set ? fn(x) : x)) }));
}

/** 저장된 최신 값에 변화량을 더함 (−/+ 버튼). 0 아래로는 내려가지 않음. 횟수·초는 정수 */
export function stepSet(w: Workout, s: Step, field: 'weight' | 'reps' | 'seconds', delta: number): Workout {
  const cur = w.blocks[s.block]!.items[s.item]!.sets[s.set]![field] ?? 0;
  const v = field === 'weight' ? Math.round((cur + delta) * 10) / 10 : Math.round(cur + delta);
  return updateSet(w, s, { [field]: Math.max(0, v) });
}
/** 사용자 입력. 무게를 직접 고치면 더 이상 자동 값이 아님 */
export function updateSet(w: Workout, s: Step, patch: Partial<SetLog>): Workout {
  return patchSet(w, s, (x) => ({ ...x, ...patch, ...('weight' in patch ? { auto: false } : {}) }));
}

/** 세트 완료 → 휴식 타이머 자동 시작. 같은 운동의 뒤 세트 중 무게가 비었거나 자동 값이면 이번 무게로 채움 (웜업·직접 입력한 값은 제외) */
export function completeSet(w: Workout, s: Step, nowMs: number): Workout {
  const cur = w.blocks[s.block]!.items[s.item]!.sets[s.set]!;
  const carry = !cur.warmup && cur.weight !== undefined;
  const done = patchItem(w, s.block, s.item, (it) => ({
    ...it,
    sets: it.sets.map((x, si) => {
      if (si === s.set) return { ...x, done: true, doneAt: new Date(nowMs).toISOString() };
      if (carry && si > s.set && !x.done && !x.warmup && (x.weight === undefined || x.auto)) return { ...x, weight: cur.weight, auto: true };
      return x;
    }),
  }));
  const r = restAfter(w, s);
  return { ...done, timer: r ? { startedAt: nowMs, endsAt: nowMs + r.sec * 1000, label: r.label, kind: r.kind } : null };
}

export function undoSet(w: Workout, s: Step): Workout {
  const next = patchSet(w, s, ({ doneAt: _d, ...rest }) => ({ ...rest, done: false }));
  return { ...next, timer: null };
}

export function addSet(w: Workout, block: number, item: number, warmup = false): Workout {
  return patchItem(w, block, item, (it) => {
    const last = it.sets.filter((x) => x.warmup === warmup).slice(-1)[0] ?? it.sets[0];
    const ns: SetLog = { warmup, done: false, ...(last?.weight !== undefined ? { weight: warmup ? Math.round((last.weight * 0.5) / 2.5) * 2.5 : last.weight } : {}), ...(it.target.seconds !== undefined ? { seconds: it.target.seconds } : { reps: warmup ? 10 : it.target.reps }) };
    return { ...it, sets: warmup ? [ns, ...it.sets] : [...it.sets, ns] };
  });
}

export function removeSet(w: Workout, s: Step): Workout {
  return patchItem(w, s.block, s.item, (it) => (it.sets.length <= 1 ? it : { ...it, sets: it.sets.filter((_, si) => si !== s.set) }));
}

export function skipItem(w: Workout, block: number, item: number, skipped = true): Workout {
  return patchItem(w, block, item, (it) => ({ ...it, skipped }));
}

export function setWorkoutMemo(w: Workout, memo: string | undefined): Workout { return { ...w, memo }; }

export function setItemMemo(w: Workout, block: number, item: number, memo: string | undefined): Workout {
  return patchItem(w, block, item, (it) => ({ ...it, memo }));
}

export function replaceItem(w: Workout, block: number, item: number, exerciseId: string, history: Workout[]): Workout {
  const prev = lastSets(history, exerciseId);
  return patchItem(w, block, item, (it) => {
    let work = -1;
    return {
      ...it, exerciseId, skipped: false,
      sets: it.sets.map((s) => {
        if (!s.warmup) work++;
        if (s.done) return s;
        // 웜업 세트는 지난 작업 무게를 받지 않는다. 작업 세트는 작업 세트 순번으로 맞춤
        const p = s.warmup ? undefined : prev[Math.min(work, prev.length - 1)];
        return { warmup: s.warmup, done: false, ...(p?.weight !== undefined ? { weight: p.weight, auto: true } : {}), ...(it.target.seconds !== undefined ? { seconds: it.target.seconds } : { reps: s.warmup ? s.reps ?? 10 : p?.reps ?? it.target.reps }) };
      }),
    };
  });
}
export function appendExercise(w: Workout, exerciseId: string, sets: number, reps: number, restSec: number, history: Workout[], seconds?: number): Workout {
  const prev = lastSets(history, exerciseId);
  const item: WorkoutItem = {
    exerciseId, target: { sets, reps, ...(seconds !== undefined ? { seconds } : {}) },
    sets: Array.from({ length: sets }, (_, k) => ({ warmup: false, done: false, ...(prev[k]?.weight !== undefined ? { weight: prev[k]!.weight, auto: true } : {}), ...(seconds !== undefined ? { seconds } : { reps: prev[k]?.reps ?? reps }) })),
  };
  return { ...w, blocks: [...w.blocks, { kind: 'single', items: [item], restSec, roundRestSec: 120, transitionSec: 10 }] };
}

export function adjustTimer(w: Workout, deltaSec: number, nowMs: number): Workout {
  if (!w.timer) return w;
  // 휴식이 이미 끝난 뒤 +15는 지금부터 15초
  const endsAt = Math.max(nowMs, Math.max(nowMs, w.timer.endsAt) + deltaSec * 1000);
  return { ...w, timer: { ...w.timer, endsAt } };
}

export function clearTimer(w: Workout): Workout { return { ...w, timer: null }; }

/** 남은 초 (시작 시각 기준 계산이라 앱을 다시 열어도 정확) */
export function timerRemaining(t: Timer | null, nowMs: number): number {
  return t ? Math.max(0, Math.ceil((t.endsAt - nowMs) / 1000)) : 0;
}

export function finishWorkout(w: Workout, now: string): Workout { return { ...w, endedAt: now, timer: null }; }

/**
 * 운동 끝내기 판단 (D-038). 끝낼 수 없을 때 조용히 넘어가지 않도록 이유를 돌려준다.
 *  - missing: 저장소에 기록이 없음 (다른 기기에서 지워짐 등)
 *  - other-device: 다른 기기로 넘어간 운동 (이 기기에서 고치면 새 주인 기록과 부딪힘)
 *  - already: 이미 끝난 운동 (두 번 눌림, 다른 기기에서 끝냄 등) → 성공으로 봄, 기존 끝난 시각 유지
 */
export type FinishDecision = { kind: 'ok'; w: Workout } | { kind: 'already'; w: Workout } | { kind: 'missing' } | { kind: 'other-device' };
export function decideFinish(cur: Workout | undefined, myDeviceId: string, now: string): FinishDecision {
  if (!cur) return { kind: 'missing' };
  // 이미 끝남(다른 기기에서 끝낸 것 포함)은 성공으로: 끝내려던 목적은 이뤄짐 (검토 N1)
  if (cur.endedAt) return { kind: 'already', w: cur };
  if (cur.ownerDeviceId && cur.ownerDeviceId !== myDeviceId) return { kind: 'other-device' };
  return { kind: 'ok', w: finishWorkout(cur, now) };
}

export interface Progress {
  doneSets: number; totalSets: number; elapsedSec: number; remainingSec: number;
  /** 예상 종료 - 예정 종료 (초). 양수면 늦음. 루틴 예상 시간이 없으면 undefined */
  deltaSec?: number;
}
/** 진행 상황과 남은 예상 시간 (남은 세트 × 평균 세트 시간 + 휴식) */
export function progress(w: Workout, nowMs: number, secPerSet: (exerciseId: string, reps: number) => number): Progress {
  const all = steps(w);
  let remaining = 0, doneSets = 0;
  const pending = all.filter((s) => { const d = w.blocks[s.block]!.items[s.item]!.sets[s.set]!.done; if (d) doneSets++; return !d; });
  pending.forEach((s, i) => {
    const it = w.blocks[s.block]!.items[s.item]!;
    remaining += secPerSet(it.exerciseId, it.sets[s.set]!.reps ?? it.target.reps);
    if (i < pending.length - 1) remaining += restAfter(w, s)?.sec ?? 0;
  });
  remaining += timerRemaining(w.timer, nowMs);
  const elapsedSec = Math.max(0, Math.round((nowMs - Date.parse(w.startedAt)) / 1000));
  return { doneSets, totalSets: all.length, elapsedSec, remainingSec: remaining, ...(w.plannedSec ? { deltaSec: elapsedSec + remaining - w.plannedSec } : {}) };
}

/** 1RM 추정 (Epley). 화면에 "추정" 표시 */
export function epley1RM(weight: number, reps: number): number {
  return reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// ---------- 루틴 편집 (BLUEPRINT 4.2) ----------

export function emptyRoutine(id: string, name: string, now: string): Routine {
  return { id, name, createdAt: now, updatedAt: now, blocks: [] };
}

/** 루틴 예상 시간 (웜업 제외, 블록 + 블록 사이 휴식·이동). 편집 뒤 다시 계산 */
export function routineEstimate(r: Routine, byId: Map<string, Exercise>, betweenSec = DEFAULT_TIME.betweenRestSec): number {
  const blocks = r.blocks.filter((b) => b.items.every((i) => byId.has(i.exerciseId)));
  const t = blocks.reduce((s, b) => {
    const items = b.items.map((i) => ({ exercise: byId.get(i.exerciseId)!, sets: i.sets, reps: i.reps, seconds: i.seconds }));
    const tb: TimedBlock = b.kind === 'single' || items.length === 1 ? { kind: 'single', items, rest: b.restSec } : { kind: 'group', items, roundRest: b.roundRestSec };
    return s + blockTime(tb, { ...DEFAULT_TIME, transitionSec: b.transitionSec });
  }, 0);
  return t + Math.max(0, blocks.length - 1) * (betweenSec + DEFAULT_TIME.moveSec);
}

/** 이 블록과 다음 블록을 묶음(슈퍼세트·컴파운드 세트)으로 합침 */
export function mergeWithNext(r: Routine, bi: number, kind: 'superset' | 'compound'): Routine {
  const a = r.blocks[bi], b = r.blocks[bi + 1];
  if (!a || !b) return r;
  const merged: RoutineBlock = { kind, items: [...a.items, ...b.items], restSec: a.restSec, roundRestSec: a.kind === 'single' ? 120 : a.roundRestSec, transitionSec: a.transitionSec || 10 };
  return { ...r, blocks: [...r.blocks.slice(0, bi), merged, ...r.blocks.slice(bi + 2)] };
}

/** 루틴 블록 순서 바꾸기 (끌어서 놓기·↑↓, D-037). 범위 밖·같은 자리면 그대로 */
export function moveRoutineBlock(r: Routine, from: number, to: number): Routine {
  const blocks = moveItem(r.blocks, from, to);
  return blocks === r.blocks ? r : { ...r, blocks: blocks as RoutineBlock[] };
}

/**
 * 운동 중 블록 순서 바꾸기 (D-037). 세트 기록·완료 여부는 블록과 함께 옮겨지고,
 * 현재 세트는 새 순서에서 "아직 안 끝낸 첫 세트"로 다시 정해진다 (currentStep). 휴식 타이머는 그대로.
 */
export function moveWorkoutBlock(w: Workout, from: number, to: number): Workout {
  const blocks = moveItem(w.blocks, from, to);
  return blocks === w.blocks ? w : { ...w, blocks: blocks as WorkoutBlock[] };
}

/** 묶음을 풀어 운동마다 일반 블록으로 */
export function splitBlock(r: Routine, bi: number, restFor: (exerciseId: string) => number): Routine {
  const b = r.blocks[bi];
  if (!b || b.items.length < 2) return r;
  const singles: RoutineBlock[] = b.items.map((i) => ({ kind: 'single', items: [i], restSec: restFor(i.exerciseId), roundRestSec: b.roundRestSec, transitionSec: b.transitionSec }));
  return { ...r, blocks: [...r.blocks.slice(0, bi), ...singles, ...r.blocks.slice(bi + 1)] };
}

/** 루틴 전체 휴식 한 번에 바꾸기 (루틴 기본값) */
export function applyRestToAll(r: Routine, singleRestSec: number, roundRestSec: number): Routine {
  return { ...r, blocks: r.blocks.map((b) => ({ ...b, restSec: singleRestSec, roundRestSec })) };
}

/**
 * 늦게 온 기록을 원래 운동에 합치기: 같은 운동(같은 자리 먼저, 순서를 바꿨으면 다른 블록, D-037)의 아직 안 한 세트를 채우고,
 * 남는 세트가 없으면 뒤에 붙임. 원래 운동에 없는 운동(그사이 교체·삭제)은 맨 뒤에 새 블록으로 (버리지 않음)
 */
export function mergeLate(orig: Workout, copy: Workout): Workout {
  const blocks = orig.blocks.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i, sets: [...i.sets] })) }));
  copy.blocks.forEach((cb, bi) => cb.items.forEach((ci) => {
    const item = findItem(blocks, bi, ci.exerciseId);
    if (!item) {
      if (ci.sets.some((s) => s.done)) blocks.push({ kind: 'single', restSec: cb.restSec, roundRestSec: cb.roundRestSec, transitionSec: cb.transitionSec, items: [{ ...ci, sets: [...ci.sets] }] });
      return;
    }
    for (const s of ci.sets) {
      if (s.doneAt && item.sets.some((x) => x.done && x.doneAt === s.doneAt)) continue; // 이미 있는 세트 (끝낸 시각이 같음)
      const k = item.sets.findIndex((x) => !x.done && x.warmup === s.warmup);
      if (k >= 0) item.sets[k] = s; else item.sets.push(s);
    }
  }));
  return { ...orig, blocks };
}

/**
 * 홈 "최근 운동"에서만 빼기 (D-040). 뺀 운동 ID 목록은 설정(settings.homeHidden)에 둠:
 * 운동 기록 자체를 고치지 않으므로, 다른 기기에서 같은 기록을 고친 것과 부딪혀 고친 내용을 잃는 일이 없음.
 * (설정은 항목 단위로 합쳐짐. 두 기기가 동시에 빼면 한쪽 빼기만 남을 수 있음 = 표시만의 문제)
 */
export function withHidden(list: readonly string[] | undefined, id: string): string[] { const l = list ?? []; return l.includes(id) ? [...l] : [...l, id]; }
export function withoutHidden(list: readonly string[] | undefined, id: string): string[] { return (list ?? []).filter((x) => x !== id); }
/** 홈에서 뺀 기록 표시 글자 (기록 탭 목록·상세, 시험에서도 같이 씀) */
export const HOME_HIDDEN_LABEL = '홈에서 뺌';
/** 홈 "최근 운동" 목록: 뺀 것을 건너뛰고 n개 (history는 최신순) */
export function homeRecent(history: Workout[], hidden: readonly string[] | undefined, n: number): Workout[] {
  const h = new Set(hidden ?? []);
  return history.filter((w) => !h.has(w.id)).slice(0, n);
}