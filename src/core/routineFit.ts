/**
 * 루틴을 내 속도에 맞추기 (D-067, 사용 분석 P3). 화면과 분리된 순수 함수.
 *  1. 내 속도: 최근 끝낸 운동 8회(작업 세트 1개 이상, 12시간 넘는 기록 제외)의
 *     (마지막 작업 세트 − 첫 작업 세트) ÷ (작업 세트 − 1)의 가운데 값. 3회 미만이면 없음(앱 기본 예상을 씀)
 *     시작 → 첫 세트도 기록에서 잼 (루틴 웜업 8~10분은 실제로 관찰되지 않음, 중앙 약 0.5분)
 *  2. 루틴 예상 = 시작→첫 세트 + 첫 세트 + (세트 수 − 1) × 세트당 시간. 목표 시간이 지나서야 시작하는 운동 = "못 할 운동"
 *  3. 내 시간에 맞추기 = 첫 블록·주 운동(바벨 복합 운동) 블록은 제자리, 나머지 중 최근 2주 덜 한 부위의 블록을 앞으로(묶음은 통째로)
 *     + 많이 한 부위·운동부터 세트를 하나씩
 *     줄임(작업 세트 2개 아래로는 안 줄임, 묶음 안 세트 수는 맞춤) → 목표 시간 안이 될 때까지
 */
import type { Routine, RoutineBlock, Workout } from './session';
import type { Exercise, Part } from './types';
import { hasEditStamps } from './finishTime';

export const PACE_RULE = {
  /** 최근 몇 회를 보나 */
  sessions: 8,
  /** 이보다 적으면 내 속도 없음 */
  minSessions: 3,
  /** 이보다 긴 기록은 끝내기를 잊은 것으로 보고 뺌 */
  maxSessionMs: 12 * 3_600_000,
  /** 세트당 시간 범위 (초). 몰아서 체크·아주 긴 쉼이 섞여도 터무니없는 값이 안 나오게 */
  minSec: 60, maxSec: 360,
  /** 시작 → 첫 세트 범위 (초) */
  leadMaxSec: 900,
  /** 첫 세트 하는 시간 (초) */
  firstSetSec: 45,
} as const;

/** 맞추기: 작업 세트를 이 아래로는 줄이지 않음 */
export const FIT_MIN_SETS = 2;
/** 최근 며칠을 보고 부위를 고르나 */
export const RECENT_DAYS = 14;

export interface Pace { secPerSet: number; leadSec: number; n: number }

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 작업 세트(완료, 웜업 아님)의 끝낸 시각들, 오름차순 */
function workTimes(w: Workout): number[] {
  const out: number[] = [];
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) {
    if (!s.done || s.warmup || !s.doneAt) continue;
    const t = Date.parse(s.doneAt);
    if (!Number.isNaN(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
/** 처음 완료한 세트(웜업 포함) 시각 */
function firstDone(w: Workout): number | undefined {
  let m: number | undefined;
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) {
    if (!s.done || !s.doneAt) continue;
    const t = Date.parse(s.doneAt);
    if (!Number.isNaN(t) && (m === undefined || t < m)) m = t;
  }
  return m;
}

/** 내 속도. 기록이 모자라면 undefined (부르는 쪽이 앱 기본 예상을 씀) */
export function personalPace(history: readonly Workout[]): Pace | undefined {
  const recent = history
    // 기록 수정 화면에서 완료로 바꾼 세트가 있는 기록은 뺌 (끝낸 시각이 "시작 + k초", A1)
    .filter((w) => w.endedAt && !w.pendingMerge && !hasEditStamps(w) && Date.parse(w.endedAt) - Date.parse(w.startedAt) <= PACE_RULE.maxSessionMs && workTimes(w).length > 0)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, PACE_RULE.sessions);
  const paces: number[] = [];
  const leads: number[] = [];
  for (const w of recent) {
    const t = workTimes(w);
    if (t.length >= 2) paces.push((t[t.length - 1]! - t[0]!) / 1000 / (t.length - 1));
    const f = firstDone(w);
    if (f !== undefined) leads.push(Math.max(0, (f - Date.parse(w.startedAt)) / 1000));
  }
  if (paces.length < PACE_RULE.minSessions) return undefined;
  return {
    secPerSet: Math.round(clamp(median(paces), PACE_RULE.minSec, PACE_RULE.maxSec)),
    leadSec: Math.round(clamp(leads.length ? median(leads) : 0, 0, PACE_RULE.leadMaxSec)),
    n: paces.length,
  };
}

/** 루틴의 세트 수 */
export const routineSets = (r: Routine): number => r.blocks.reduce((s, b) => s + b.items.reduce((x, i) => x + Math.max(0, i.sets), 0), 0);

/** k번째 세트(0부터)를 끝내는 시각 (시작부터 초) */
const setEndSec = (k: number, p: Pace) => p.leadSec + PACE_RULE.firstSetSec + k * p.secPerSet;

/** 내 속도로 예상 시간 (초) */
export function paceEstimate(r: Routine, p: Pace): number {
  const n = routineSets(r);
  return n ? setEndSec(n - 1, p) : 0;
}

/** 운동마다 첫 세트가 몇 번째 세트인지 (블록 순서, 묶음은 라운드마다 번갈아) */
function firstSetIndex(r: Routine): number[] {
  const out: number[] = [];
  let k = 0;
  for (const b of r.blocks) {
    if (b.kind === 'single' || b.items.length <= 1) {
      for (const it of b.items) { out.push(it.sets > 0 ? k : Infinity); k += Math.max(0, it.sets); }
      continue;
    }
    // 첫 라운드: 운동 순서대로 한 세트씩
    let j = 0;
    for (const it of b.items) { out.push(it.sets > 0 ? k + j++ : Infinity); }
    k += b.items.reduce((s, i) => s + Math.max(0, i.sets), 0);
  }
  return out;
}

/** 목표 시간 안에 시작도 못 하는 운동 수 */
export function cutCount(r: Routine, p: Pace, targetSec: number): number {
  return firstSetIndex(r).filter((k) => k !== Infinity && setEndSec(k, p) > targetSec).length;
}

/** 루틴 이름의 "75분"을 목표로 (없으면 fallback). 10~300분만 */
export function targetMinutesOf(name: string, fallback: number): number {
  const m = [...name.matchAll(/(\d{1,3})\s*분/g)].pop();
  const v = m ? Number(m[1]) : NaN;
  return v >= 10 && v <= 300 ? v : fallback;
}

export interface PaceLabel { estMin: number; targetMin: number; cut: number; n: number; head: string; tail: string; text: string }
/** 카드·편집 화면 한 줄: "내 속도로 약 52분 (최근 8회) · 목표 75분이면 못 할 운동 3개" (괄호 = 근거 기록 수) */
export function paceLabel(r: Routine, p: Pace | undefined, targetMin: number): PaceLabel | undefined {
  if (!p || !routineSets(r)) return undefined;
  const estMin = Math.round(paceEstimate(r, p) / 60);
  const cut = cutCount(r, p, targetMin * 60);
  const head = `내 속도로 약 ${estMin}분 (최근 ${p.n}회)`, tail = cut ? `목표 ${targetMin}분이면 못 할 운동 ${cut}개` : `목표 ${targetMin}분 안`;
  return { estMin, targetMin, cut, n: p.n, head, tail, text: `${head} · ${tail}` };
}

export interface Recent { part: Map<Part, number>; ex: Map<string, number> }
/** 최근 days일 끝낸 운동의 부위별·운동별 작업 세트 수 */
export function recentSets(history: readonly Workout[], partOf: (id: string) => Part | undefined, nowMs: number, days = RECENT_DAYS): Recent {
  const part = new Map<Part, number>(), ex = new Map<string, number>();
  const since = nowMs - days * 86_400_000;
  for (const w of history) {
    if (!w.endedAt || w.pendingMerge || Date.parse(w.startedAt) < since || Date.parse(w.startedAt) > nowMs) continue;
    for (const b of w.blocks) for (const it of b.items) {
      const n = it.sets.filter((s) => s.done && !s.warmup).length;
      if (!n) continue;
      ex.set(it.exerciseId, (ex.get(it.exerciseId) ?? 0) + n);
      const p = partOf(it.exerciseId);
      if (p) part.set(p, (part.get(p) ?? 0) + n);
    }
  }
  return { part, ex };
}

/**
 * 주 운동 (B3): 바벨로 하는 복합 운동 (벤치프레스·스쿼트·데드리프트·랙풀·바벨 로우 등). 무겁고 힘이 많이 드는 운동이라
 * 맞추기에서 자리를 옮기지 않고(지친 뒤로 밀리지 않게), 세트는 다른 운동을 다 줄인 뒤에야 줄임
 */
export const isMainLift = (ex: Pick<Exercise, 'mechanics' | 'equipment'> | undefined): boolean => !!ex && ex.mechanics === 'compound' && ex.equipment.includes('barbell');

export interface FitRow { exerciseId: string; letter: string; fromBlock: number; toBlock: number; before: number; after: number }
export interface FitResult { routine: Routine; beforeSec: number; afterSec: number; fits: boolean; moved: boolean; reduced: number; rows: FitRow[] }
export interface FitInput {
  routine: Routine; targetSec: number;
  /** 예상 시간 (내 속도가 있으면 paceEstimate, 없으면 앱 기본 예상) */
  estimate: (r: Routine) => number;
  partOf: (id: string) => Part | undefined;
  recent: Recent;
  /** 주 운동인지 (isMainLift). 없으면 첫 블록만 제자리 */
  isMain?: (id: string) => boolean;
}

/** 제자리 블록 (B3): 첫 블록 + 주 운동이 든 블록 */
export function anchoredBlocks(r: Routine, isMain: (id: string) => boolean = () => false): boolean[] {
  return r.blocks.map((b, i) => i === 0 || b.items.some((it) => isMain(it.exerciseId)));
}

/**
 * 내 시간에 맞추기 (D-067, 사용자 선택: 운동당 세트 줄이기). 결과만 돌려주고 저장은 부르는 쪽이 확인 뒤에.
 *  1) 블록 순서: 첫 블록과 주 운동 블록은 제자리. 나머지(옮길 수 있는 블록)만 그 빈자리 안에서 최근 2주 그 블록 부위 세트가
 *     적은 것부터(블록 안 부위 중 가장 적은 값, 같으면 원래 순서). 묶음은 통째로
 *  2) 목표보다 길면 한 세트씩 줄임: 옮길 수 있는 블록 먼저(제자리 블록은 맨 나중, 그것들끼리는 세트가 많은 것부터 고르게) → 최근 2주 많이 한 부위 → 많이 한 운동 → 세트가 많은 운동 → 뒤쪽 블록 순
 *     작업 세트 2개 아래로는 안 줄임(원래 2개 이하는 그대로). 묶음은 세트가 가장 많은 운동들을 같이 줄여 라운드 수를 맞춤
 */
export function fitRoutine(inp: FitInput): FitResult {
  const { routine, targetSec, estimate, partOf, recent } = inp;
  const pr = (id: string) => { const p = partOf(id); return p ? recent.part.get(p) ?? 0 : 0; };
  const beforeSec = estimate(routine);
  const fixed = anchoredBlocks(routine, inp.isMain);
  const order = routine.blocks.map((b, i) => ({ b, i, score: Math.min(...b.items.map((it) => pr(it.exerciseId))) }));
  const movable = order.filter((x) => !fixed[x.i]).sort((a, b) => a.score - b.score || a.i - b.i);
  let mi = 0;
  const sorted = order.map((x) => (fixed[x.i] ? x : movable[mi++]!));
  const anchorAt = sorted.map((x) => fixed[x.i]!);
  const moved = sorted.some((x, k) => x.i !== k);
  let blocks: RoutineBlock[] = sorted.map((x) => ({ ...x.b, items: x.b.items.map((it) => ({ ...it })) }));
  const from = sorted.map((x) => x.i);
  const cur = (): Routine => ({ ...routine, blocks });
  let reduced = 0;
  let est = estimate(cur());
  while (est > targetSec) {
    let bi = -1;
    let bestKey: number[] = [];
    for (let x = 0; x < blocks.length; x++) {
      const b = blocks[x]!;
      const max = Math.max(...b.items.map((i) => i.sets));
      if (max <= FIT_MIN_SETS) continue;
      const top = b.items.filter((i) => i.sets === max);
      const p = Math.max(...top.map((i) => pr(i.exerciseId))), e = Math.max(...top.map((i) => recent.ex.get(i.exerciseId) ?? 0));
      // 제자리(주 운동) 블록은 맨 나중에, 그것들끼리는 세트가 많은 것부터 고르게 (주 운동 하나만 크게 줄지 않게)
      const key = anchorAt[x] ? [0, max, p, e, x] : [1, p, e, max, x];
      if (bi < 0 || cmp(key, bestKey) > 0) { bi = x; bestKey = key; }
    }
    if (bi < 0) break;
    blocks = blocks.map((b, x) => {
      if (x !== bi) return b;
      const max = Math.max(...b.items.map((i) => i.sets));
      return { ...b, items: b.items.map((i) => (i.sets === max ? { ...i, sets: i.sets - 1 } : i)) };
    });
    reduced++;
    est = estimate(cur());
  }
  const before = new Map<string, number>();
  routine.blocks.forEach((b, bi) => b.items.forEach((it, ii) => before.set(`${bi}-${ii}`, it.sets)));
  const rows: FitRow[] = blocks.flatMap((b, bi) => b.items.map((it, ii) => ({
    exerciseId: it.exerciseId, letter: b.items.length > 1 ? String.fromCharCode(65 + ii) : '',
    fromBlock: from[bi]!, toBlock: bi, before: before.get(`${from[bi]}-${ii}`) ?? it.sets, after: it.sets,
  })));
  return { routine: cur(), beforeSec, afterSec: est, fits: est <= targetSec, moved, reduced, rows };
}

/**
 * 미리 보기 한 줄 (B3): 앞으로 옮긴 운동을 부위별로 세어 "등 운동 4개를 앞으로" (여러 부위면 "등 운동 3개·어깨 운동 1개를 앞으로").
 * 옮긴 것이 없으면 ''
 */
export function moveSummary(rows: readonly FitRow[], partOf: (id: string) => Part | undefined): string {
  const m = new Map<string, number>();
  for (const x of rows) if (x.toBlock < x.fromBlock) { const p = partOf(x.exerciseId) ?? '기타'; m.set(p, (m.get(p) ?? 0) + 1); }
  if (!m.size) return '';
  return `${[...m].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} 운동 ${n}개`).join('·')}를 앞으로`;
}

/** 앞에서부터 큰 쪽이 이김 */
function cmp(a: number[], b: number[]): number {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! - b[k]!;
  return 0;
}

export interface DupGroup { name: string; keep: Routine; older: Routine[] }
/** 같은 이름 루틴 (앞뒤 공백 무시). 가장 최근에 만든 것을 남기고 나머지를 "오래된 것"으로 */
export function duplicateNames(list: readonly Routine[]): DupGroup[] {
  const m = new Map<string, Routine[]>();
  for (const r of list) { const k = r.name.trim(); if (!k) continue; m.set(k, [...(m.get(k) ?? []), r]); }
  const out: DupGroup[] = [];
  for (const [name, rs] of m) {
    if (rs.length < 2) continue;
    const s = [...rs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    out.push({ name, keep: s[0]!, older: s.slice(1) });
  }
  return out;
}
