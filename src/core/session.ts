/**
 * 운동 기록 세션 (BLUEPRINT 4.3, 4.4). 화면과 분리된 순수 함수. 모든 변경은 새 객체를 돌려준다.
 */
import type { PlanBlock } from './planner';

export interface RoutineItem { exerciseId: string; sets: number; reps: number; seconds?: number }
export interface RoutineBlock { kind: 'single' | 'superset' | 'compound'; items: RoutineItem[]; restSec: number; roundRestSec: number; transitionSec: number }
export interface Routine { id: string; name: string; createdAt: string; updatedAt: string; blocks: RoutineBlock[]; estimatedSec?: number; note?: string }

export interface SetLog { weight?: number; reps?: number; seconds?: number; rir?: number; warmup: boolean; done: boolean; doneAt?: string }
export interface WorkoutItem { exerciseId: string; target: { sets: number; reps: number; seconds?: number }; sets: SetLog[]; skipped?: boolean; memo?: string }
export interface WorkoutBlock { kind: RoutineBlock['kind']; items: WorkoutItem[]; restSec: number; roundRestSec: number; transitionSec: number }
export interface Timer { startedAt: number; endsAt: number; label: string; kind: 'set' | 'transition' | 'round' | 'between' | 'warmup' }
export interface Workout {
  id: string; routineId?: string; name: string;
  startedAt: string; endedAt?: string;
  blocks: WorkoutBlock[];
  timer: Timer | null;
  memo?: string;
}

export const REST_DEFAULTS = { betweenSec: 60, warmupSec: 60 };

export function planToRoutine(id: string, name: string, now: string, blocks: PlanBlock[], estimatedSec?: number): Routine {
  return {
    id, name, createdAt: now, updatedAt: now, estimatedSec,
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

export function startWorkout(id: string, routine: Routine, now: string, history: Workout[]): Workout {
  return {
    id, routineId: routine.id, name: routine.name, startedAt: now, timer: null,
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
              ...(p?.weight !== undefined ? { weight: p.weight } : {}),
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
  if (next.block !== step.block) return { sec: REST_DEFAULTS.betweenSec, kind: 'between', label: '다음 운동으로 이동' };
  if (b.kind === 'single' || b.items.filter((x) => !x.skipped).length <= 1) return { sec: b.restSec, kind: 'set', label: '세트 간 휴식' };
  if (next.item !== step.item && !w.blocks[next.block]!.items[next.item]!.sets[next.set]!.warmup) {
    // 같은 라운드의 다음 운동인지: 다음 운동의 이번 라운드 번호가 현재와 같으면 전환
    const roundOf = (s: Step) => w.blocks[s.block]!.items[s.item]!.sets.slice(0, s.set + 1).filter((x) => !x.warmup).length;
    if (roundOf(next) === roundOf(step)) return { sec: b.transitionSec, kind: 'transition', label: '다음 운동으로 바로 (묶음)' };
  }
  return { sec: b.roundRestSec, kind: 'round', label: '라운드 후 휴식' };
}

function patchSet(w: Workout, s: Step, patch: Partial<SetLog>): Workout {
  return {
    ...w,
    blocks: w.blocks.map((b, bi) => bi !== s.block ? b : {
      ...b, items: b.items.map((it, ii) => ii !== s.item ? it : { ...it, sets: it.sets.map((x, si) => si !== s.set ? x : { ...x, ...patch }) }),
    }),
  };
}

export function updateSet(w: Workout, s: Step, patch: Partial<SetLog>): Workout { return patchSet(w, s, patch); }

/** 세트 완료 → 휴식 타이머 자동 시작. 같은 운동의 뒤 세트 중 무게가 비어 있으면 이번 무게로 채움 (웜업은 제외) */
export function completeSet(w: Workout, s: Step, nowMs: number): Workout {
  const cur = w.blocks[s.block]!.items[s.item]!.sets[s.set]!;
  let done = patchSet(w, s, { done: true, doneAt: new Date(nowMs).toISOString() });
  if (!cur.warmup && cur.weight !== undefined) {
    done = { ...done, blocks: done.blocks.map((b, bi) => bi !== s.block ? b : { ...b, items: b.items.map((it, ii) => ii !== s.item ? it : { ...it, sets: it.sets.map((x, si) => (si > s.set && !x.done && !x.warmup && x.weight === undefined ? { ...x, weight: cur.weight } : x)) }) }) };
  }
  const r = restAfter(w, s);
  return { ...done, timer: r ? { startedAt: nowMs, endsAt: nowMs + r.sec * 1000, label: r.label, kind: r.kind } : null };
}

export function undoSet(w: Workout, s: Step): Workout {
  const { doneAt: _d, ...rest } = w.blocks[s.block]!.items[s.item]!.sets[s.set]!;
  void _d;
  const next = { ...w, blocks: w.blocks.map((b, bi) => bi !== s.block ? b : { ...b, items: b.items.map((it, ii) => ii !== s.item ? it : { ...it, sets: it.sets.map((x, si) => si !== s.set ? x : { ...rest, done: false }) }) }) };
  return { ...next, timer: null };
}

export function addSet(w: Workout, block: number, item: number, warmup = false): Workout {
  return {
    ...w,
    blocks: w.blocks.map((b, bi) => bi !== block ? b : {
      ...b, items: b.items.map((it, ii) => {
        if (ii !== item) return it;
        const last = it.sets.filter((x) => x.warmup === warmup).slice(-1)[0] ?? it.sets[0];
        const ns: SetLog = { warmup, done: false, ...(last?.weight !== undefined ? { weight: warmup ? Math.round((last.weight * 0.5) / 2.5) * 2.5 : last.weight } : {}), ...(it.target.seconds !== undefined ? { seconds: it.target.seconds } : { reps: warmup ? 10 : it.target.reps }) };
        return { ...it, sets: warmup ? [ns, ...it.sets] : [...it.sets, ns] };
      }),
    }),
  };
}

export function removeSet(w: Workout, s: Step): Workout {
  return { ...w, blocks: w.blocks.map((b, bi) => bi !== s.block ? b : { ...b, items: b.items.map((it, ii) => ii !== s.item || it.sets.length <= 1 ? it : { ...it, sets: it.sets.filter((_, si) => si !== s.set) }) }) };
}

export function skipItem(w: Workout, block: number, item: number, skipped = true): Workout {
  return { ...w, blocks: w.blocks.map((b, bi) => bi !== block ? b : { ...b, items: b.items.map((it, ii) => (ii === item ? { ...it, skipped } : it)) }) };
}

export function replaceItem(w: Workout, block: number, item: number, exerciseId: string, history: Workout[]): Workout {
  const prev = lastSets(history, exerciseId);
  return {
    ...w, blocks: w.blocks.map((b, bi) => bi !== block ? b : {
      ...b, items: b.items.map((it, ii) => ii !== item ? it : {
        ...it, exerciseId, skipped: false,
        sets: it.sets.map((s, k) => (s.done ? s : { warmup: s.warmup, done: false, ...(prev[k]?.weight !== undefined ? { weight: prev[k]!.weight } : {}), ...(it.target.seconds !== undefined ? { seconds: it.target.seconds } : { reps: prev[k]?.reps ?? it.target.reps }) })),
      }),
    }),
  };
}

export function appendExercise(w: Workout, exerciseId: string, sets: number, reps: number, restSec: number, history: Workout[], seconds?: number): Workout {
  const prev = lastSets(history, exerciseId);
  const item: WorkoutItem = {
    exerciseId, target: { sets, reps, ...(seconds !== undefined ? { seconds } : {}) },
    sets: Array.from({ length: sets }, (_, k) => ({ warmup: false, done: false, ...(prev[k]?.weight !== undefined ? { weight: prev[k]!.weight } : {}), ...(seconds !== undefined ? { seconds } : { reps: prev[k]?.reps ?? reps }) })),
  };
  return { ...w, blocks: [...w.blocks, { kind: 'single', items: [item], restSec, roundRestSec: 120, transitionSec: 10 }] };
}

export function adjustTimer(w: Workout, deltaSec: number, nowMs: number): Workout {
  if (!w.timer) return w;
  const endsAt = Math.max(nowMs, w.timer.endsAt + deltaSec * 1000);
  return { ...w, timer: { ...w.timer, endsAt } };
}

export function clearTimer(w: Workout): Workout { return { ...w, timer: null }; }

/** 남은 초 (시작 시각 기준 계산이라 앱을 다시 열어도 정확) */
export function timerRemaining(t: Timer | null, nowMs: number): number {
  return t ? Math.max(0, Math.ceil((t.endsAt - nowMs) / 1000)) : 0;
}

export function finishWorkout(w: Workout, now: string): Workout { return { ...w, endedAt: now, timer: null }; }

export interface Progress { doneSets: number; totalSets: number; elapsedSec: number; remainingSec: number }
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
  return { doneSets, totalSets: all.length, elapsedSec: Math.max(0, Math.round((nowMs - Date.parse(w.startedAt)) / 1000)), remainingSec: remaining };
}

/** 1RM 추정 (Epley). 화면에 "추정" 표시 */
export function epley1RM(weight: number, reps: number): number {
  return reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}
