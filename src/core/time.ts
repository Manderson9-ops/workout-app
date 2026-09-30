/**
 * 시간 계산 모델 (BLUEPRINT 5.6). 모든 값은 초.
 */
import type { Exercise } from './types';
import { DEFAULTS } from './types';

export interface TimeParams {
  secPerRep: number;
  setupSec: number;
  sideSwitchSec: number;
  /** 세트 간 휴식 기본값과 최소값 */
  restCompound: number; restCompoundMin: number;
  restIsolation: number; restIsolationMin: number;
  /** 묶음 라운드 후 휴식 */
  roundRest: number; roundRestMin: number;
  /** 묶음 안 운동 전환 */
  transitionSec: number;
  /** 운동(블록) 간 휴식 + 이동 */
  betweenRestSec: number; moveSec: number;
  /** 드롭 사이 무게 변경 */
  dropChangeSec: number;
  restStep: number;
}

export const DEFAULT_TIME: TimeParams = {
  secPerRep: DEFAULTS.sec_per_rep, setupSec: DEFAULTS.setup_sec, sideSwitchSec: DEFAULTS.side_switch_sec,
  restCompound: 150, restCompoundMin: 120, restIsolation: 90, restIsolationMin: 60, roundRest: 120, roundRestMin: 90,
  transitionSec: 10, betweenRestSec: 60, moveSec: 30, dropChangeSec: 10, restStep: 15,
};

/** 시간 계산용 목표 횟수: 기본 범위의 가운데(내림) */
export function targetReps(e: Exercise): number {
  const [a, b] = e.default_reps ?? (e.mechanics === 'compound' ? DEFAULTS.compound_reps : DEFAULTS.isolation_reps);
  return Math.floor((a + b) / 2);
}

/** 한 세트 시간. reps는 한쪽 기준. seconds는 시간 운동의 세트당 초 (없으면 운동 기본값, D-036) */
export function setTime(e: Exercise, reps: number, p: TimeParams = DEFAULT_TIME, seconds?: number): number {
  const spr = e.sec_per_rep ?? p.secPerRep;
  const setup = e.setup_sec ?? p.setupSec;
  const work = e.measure === 'time' ? (seconds ?? e.default_seconds ?? 30) : reps * spr;
  return e.unilateral ? setup + 2 * work + p.sideSwitchSec : setup + work;
}

export interface TimedItem { exercise: Exercise; sets: number; reps: number; seconds?: number; drops?: number; dropReps?: number }
export interface TimedBlock {
  kind: 'single' | 'group';
  items: TimedItem[];
  /** single: 세트 간 휴식 */
  rest?: number;
  /** group: 라운드 후 휴식 */
  roundRest?: number;
}

function itemSetTime(it: TimedItem, setIndex: number, p: TimeParams): number {
  let t = setTime(it.exercise, it.reps, p, it.seconds);
  if (it.drops && setIndex === it.sets - 1) {
    const spr = it.exercise.sec_per_rep ?? p.secPerRep;
    t += it.drops * ((it.dropReps ?? Math.max(1, Math.floor(it.reps / 2))) * spr + p.dropChangeSec);
  }
  return t;
}

export function blockTime(b: TimedBlock, p: TimeParams = DEFAULT_TIME): number {
  if (b.kind === 'single') {
    const it = b.items[0]!;
    let t = 0;
    for (let s = 0; s < it.sets; s++) t += itemSetTime(it, s, p);
    return t + (it.sets - 1) * (b.rest ?? 0);
  }
  const rounds = Math.max(...b.items.map((i) => i.sets));
  let t = 0;
  for (let r = 0; r < rounds; r++) {
    const active = b.items.filter((i) => i.sets > r);
    t += active.reduce((s, i) => s + itemSetTime(i, r, p), 0) + (active.length - 1) * p.transitionSec;
  }
  return t + (rounds - 1) * (b.roundRest ?? 0);
}

export interface Warmup { kind: 'minutes' | 'sets' | 'none'; seconds: number; label: string }

/**
 * 웜업 (BLUEPRINT 5.1): 목표 없음 또는 30분 이상 8분, 20~30분 4분, 20분 미만은 첫 운동 웜업 세트 1개.
 * 하체가 포함되면 분 단위 웜업에 +2분.
 */
export function warmupFor(targetMin: number | undefined, hasLegs: boolean, firstItem: TimedItem | undefined, p: TimeParams = DEFAULT_TIME): Warmup {
  const legs = hasLegs ? 120 : 0;
  if (targetMin === undefined || targetMin >= 30) return { kind: 'minutes', seconds: 480 + legs, label: `웜업 ${8 + legs / 60}분` };
  if (targetMin >= 20) return { kind: 'minutes', seconds: 240 + legs, label: `웜업 ${4 + legs / 60}분` };
  if (!firstItem) return { kind: 'none', seconds: 0, label: '웜업 없음' };
  return { kind: 'sets', seconds: setTime(firstItem.exercise, firstItem.reps, p) + 60, label: `첫 운동 가벼운 웜업 세트 1개` };
}

export function planTime(warmupSec: number, blocks: TimedBlock[], p: TimeParams = DEFAULT_TIME): number {
  if (!blocks.length) return warmupSec;
  return warmupSec + blocks.reduce((s, b) => s + blockTime(b, p), 0) + (blocks.length - 1) * (p.betweenRestSec + p.moveSec);
}
