/**
 * 규칙 기반 플랜 생성기 (BLUEPRINT 5장). 같은 입력이면 항상 같은 결과. 모든 결정에 이유를 남긴다.
 * 관련 결정: M-09(영상 등급 우선), M-12(무거운 힌지 1개), M-14(앱 추천 순서), D-014(묶음이 같은 부위 순서를 뒤집지 않음)
 */
import type { BuiltExercise, Part, Level, Equipment } from './types';
import { EQUIPMENT_RANK, EQUIPMENT } from './types';
import type { Grade } from './version';
import { GRADES, gradeAtLeast } from './version';
import { eligibleParts, resolveGrade, equipmentAvailable, isHeavyHinge } from './exercises';
import type { ResolvedGrade } from './exercises';
import { DEFAULT_TIME, targetReps, setTime, blockTime, warmupFor } from './time';
import type { TimeParams, TimedBlock, TimedItem, Warmup } from './time';

/** M-27: 부위별 같은 주 근육(muscles[0]) 운동 상한 */
export const MUSCLE_CAP: Partial<Record<Part, Record<string, number>>> = { 하체: { 대퇴사두: 2 } };

export type Priority = 'high' | 'normal' | 'low';
export type Grouping = 'superset' | 'compound';

export interface PlanRequest {
  parts: { part: Part; priority: Priority }[];
  level: Level;
  minGrade?: Grade;
  targetMinutes?: number;
  /** 자동으로 쓸 수 있는 묶음 방식 (트라이·자이언트·드롭·서킷은 루틴에서 직접 설정) */
  groupings?: Grouping[];
  groupingPreference?: 'when_needed' | 'prefer';
  /** 무거운 다관절도 묶음 허용 (기본 false) */
  allowHeavyInGroups?: boolean;
  equipment?: Equipment[];
  excluded?: string[];
  favorites?: string[];
  recent?: string[];
  subGoals?: Partial<Record<Part, string>>;
  userGrades?: Record<string, Grade>;
  /** 잠금: 반드시 포함, 세트 고정. 같은 부위의 나머지는 평소처럼 채운다 */
  locked?: { exerciseId: string; part: Part; sets: number }[];
  /** true면 잠근 운동만으로 구성 (모든 블록을 잠그고 다시 생성할 때). 기본은 잠금 + 나머지 채우기 */
  lockedOnly?: boolean;
  time?: Partial<TimeParams>;
}

export interface PlanItem {
  exerciseId: string; name: string; part: Part; sets: number;
  /** 횟수 운동의 목표 횟수 (한쪽 기준). 시간 운동이면 0 */
  reps: number;
  /** 시간 운동(플랭크 등)의 세트당 초 */
  seconds?: number;
  grade: Grade; gradeSource: ResolvedGrade['source']; estimated: boolean; substituted: boolean; locked: boolean; why: string;
  /** 부위 안 순위 (후보 풀 순서, 0이 가장 좋음). D-014 검증과 화면 정렬에 사용 */
  rank: number;
}
export interface PlanBlock {
  kind: 'single' | 'superset' | 'compound'; items: PlanItem[];
  restSec?: number; roundRestSec?: number; transitionSec?: number; timeSec: number;
  /** 묶음이 서로 다른 기구 두 개를 동시에 쓰는지 (헬스장 혼잡 주의) */
  twoStations?: boolean;
}
export interface Plan {
  /** ok: 정상, reduced: 시간 부족으로 일부 부위만, too_short: 시간이 너무 짧음, empty: 조건에 맞는 운동이 없음 */
  status: 'ok' | 'too_short' | 'reduced' | 'empty';
  blocks: PlanBlock[];
  warmup: Warmup;
  estimatedSec: number;
  targetSec?: number;
  rest: { compound: number; isolation: number; round: number };
  reasons: string[];
  missingParts: Part[];
  candidateCount: number;
}

export const PART_SET_CAP = 11;
const MAX_SETS = 4, BASE_SETS = 3;
const PRIORITY_ORDER: Priority[] = ['high', 'normal', 'low'];
const ANTAGONISTS: [Part, Part][] = [['가슴', '등'], ['이두', '삼두']];
/** 한 자리에서 같이 쓸 수 있는 장비 (케이블 타워, 덤벨 랙, 밴드). 머신·스미스·바벨은 서로 다른 자리로 본다 */
const STATION_EQUIP: Equipment[] = ['cable', 'dumbbell', 'band'];

interface PoolEntry { ex: BuiltExercise; grade: ResolvedGrade; substituted: boolean; locked?: number }
interface PartState { part: Part; priority: Priority; order: number; pool: PoolEntry[]; baseCount: number; lockedCount: number; lockedSets: number }
interface Chosen { entry: PoolEntry; part: PartState; poolIdx: number; sets: number; reps: number }
interface Pair { a: Chosen; b: Chosen; kind: Grouping }

const gradeIdx = (g: Grade) => GRADES.indexOf(g);
const lexCmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; };
const fmt = (s: number) => `${Math.floor(s / 60)}분 ${String(Math.round(s) % 60).padStart(2, '0')}초`;

function sortedParts(req: PlanRequest) {
  return req.parts.map((p, i) => ({ ...p, order: i }))
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.order - b.order);
}

/** 5.2 단계 1~2 + 5.4: 부위별 후보 풀 (부위끼리 겹침은 후보 조합 단계에서 검사) */
function buildPools(req: PlanRequest, all: BuiltExercise[], reasons: string[]): PartState[] {
  const minGrade = req.minGrade ?? 'B';
  const equip = req.equipment ?? [...EQUIPMENT];
  const excluded = new Set(req.excluded ?? []);
  const fav = new Set(req.favorites ?? []);
  const recent = new Set(req.recent ?? []);
  const parts = sortedParts(req);
  const poolSize = parts.length <= 3 ? 5 : parts.length === 4 ? 4 : 2;
  const byId = new Map(all.map((e) => [e.id, e]));
  const states: PartState[] = [];

  for (const l of req.locked ?? []) {
    if (!req.parts.some((p) => p.part === l.part)) reasons.push(`잠금 무시: ${byId.get(l.exerciseId)?.name_ko ?? l.exerciseId} (선택하지 않은 부위 ${l.part})`);
    else if (!byId.has(l.exerciseId)) reasons.push(`잠금 무시: 없는 운동 ${l.exerciseId}`);
  }

  for (const p of parts) {
    const gradeOf = (e: BuiltExercise) => resolveGrade(e, p.part, req.level, req.subGoals?.[p.part], req.userGrades?.[e.id]);
    type C = { ex: BuiltExercise; grade: ResolvedGrade };
    const rank = (c: C) => [
      gradeIdx(c.grade.value),
      c.grade.estimated ? 1 : 0, // M-09
      c.grade.estimated ? (c.ex.staple?.[p.part] ?? 99) : 0, // M-14
      fav.has(c.ex.id) ? 0 : 1,
      recent.has(c.ex.id) ? 0 : 1,
      Math.min(...c.ex.equipment.map((q) => EQUIPMENT_RANK[q])),
    ];
    const cmp = (a: C, b: C) => lexCmp(rank(a), rank(b)) || (a.ex.name_ko < b.ex.name_ko ? -1 : a.ex.name_ko > b.ex.name_ko ? 1 : 0);

    const locks = (req.locked ?? []).filter((x) => x.part === p.part && byId.has(x.exerciseId));
    const lockSets = new Map(locks.map((l) => [l.exerciseId, l.sets]));
    const pool: PoolEntry[] = [];
    const families = new Set<string>();
    const covered = new Set<string>();
    let heavyInPool = false;
    const take = (c: C, substituted: boolean) => {
      pool.push({ ex: c.ex, grade: c.grade, substituted, ...(lockSets.has(c.ex.id) ? { locked: lockSets.get(c.ex.id)! } : {}) });
      families.add(c.ex.family); covered.add(c.ex.muscles[0]!); if (isHeavyHinge(c.ex)) heavyInPool = true;
    };
    // 잠금 먼저 (조건 무시), 순서는 일반 규칙과 같게
    const lockedC = locks.map((l) => ({ ex: byId.get(l.exerciseId)!, grade: gradeOf(byId.get(l.exerciseId)!) })).sort(cmp);
    for (const c of lockedC) take(c, false);
    const lockedCount = pool.length;
    const lockedSets = locks.reduce((s, l) => s + l.sets, 0);

    // 나머지 후보. 같은 부위 안에서는 앞선 운동과 같은 묶음·두 번째 무거운 힌지를 넣지 않는다(앞 운동이 항상 먼저 뽑히므로 안전)
    const cands = all
      .filter((e) => eligibleParts(e).includes(p.part) && !excluded.has(e.id) && equipmentAvailable(e, equip) && !lockSets.has(e.id))
      .map((e) => ({ ex: e, grade: gradeOf(e) }));
    let ok = cands.filter((c) => gradeAtLeast(c.grade.value, minGrade)).sort(cmp);
    let substituted = false;
    if (!ok.length && !lockedCount && cands.length) {
      ok = [...cands].sort(cmp).slice(0, 1);
      substituted = true;
      reasons.push(`${p.part}: 최소 등급 ${minGrade} 이상 운동이 없어 가장 높은 등급(${ok[0]!.grade.value}) 운동으로 대체 (등급 미달 대체)`);
    }
    // M-27: 부위 안에서 같은 주 근육 운동 개수 상한 (하체: 대퇴사두 2개. 영상이 대퇴사두만 다뤄 S가 몰려도 햄스트링·둔근이 빠지지 않게)
    const cap = MUSCLE_CAP[p.part] ?? {};
    let capped = false;
    const overCap = (e: BuiltExercise) => { const m = e.muscles[0]!; const n = cap[m]; return n !== undefined && pool.filter((x) => x.ex.muscles[0] === m).length >= n; };
    const fits = (e: BuiltExercise) => !families.has(e.family) && !(isHeavyHinge(e) && heavyInPool) && !(overCap(e) && (capped = true));
    const remaining = [...ok];
    const limit = req.lockedOnly && lockedCount ? lockedCount : lockedCount + poolSize;
    while (pool.length < limit && remaining.length) {
      const top = remaining[0]!;
      // 목표 근육 분산은 영상 등급끼리만 (추정 등급은 앱 추천 순서가 이미 다양하게 정함, M-14)
      let idx = top.grade.estimated ? -1 : remaining.findIndex((c) => !c.grade.estimated && gradeIdx(c.grade.value) === gradeIdx(top.grade.value) && !covered.has(c.ex.muscles[0]!) && fits(c.ex));
      if (idx < 0) idx = remaining.findIndex((c) => fits(c.ex));
      if (idx < 0) break;
      take(remaining.splice(idx, 1)[0]!, substituted);
    }
    if (capped) reasons.push(`${p.part}: ${Object.entries(cap).map(([m, n]) => `${m} 운동은 ${n}개까지`).join(', ')} (M-27)`);
    const base = parts.length >= 5 ? 2 : p.priority === 'high' ? 3 : 2;
    states.push({ part: p.part, priority: p.priority, order: p.order, pool, baseCount: Math.max(lockedCount, Math.min(base, pool.length)), lockedCount, lockedSets });
  }
  return states;
}

/** 블록 순서 키 (5.2 단계 4): 부위 우선순위 → 다관절 먼저 → 등급 → 풀 순서 */
function chosenKey(c: Chosen): number[] {
  return [PRIORITY_ORDER.indexOf(c.part.priority), c.part.order, c.entry.ex.mechanics === 'compound' ? 0 : 1, gradeIdx(c.entry.grade.value), c.poolIdx];
}

/**
 * D-014: 묶음 때문에 같은 부위의 더 좋은 순위(풀 순서가 앞) 운동이 뒤로 밀리면 안 된다.
 * 묶음 없이 정렬했을 때 y가 x보다 앞이고 y의 순위가 더 좋으면, 묶은 뒤에도 y가 x보다 앞(또는 같은 블록)이어야 한다.
 */
function orderPreserved(chosen: Chosen[], pairs: Pair[]): boolean {
  const basePos = new Map(toBlocks(chosen, []).map((b, i) => [b[0]!, i]));
  const pos = new Map<Chosen, number>();
  toBlocks(chosen, pairs).forEach((b, i) => b.forEach((c) => pos.set(c, i)));
  for (const x of chosen) for (const y of chosen) {
    if (x === y || x.part !== y.part || y.poolIdx >= x.poolIdx) continue;
    if (basePos.get(y)! < basePos.get(x)! && pos.get(y)! > pos.get(x)!) return false;
  }
  return true;
}
function toBlocks(chosen: Chosen[], pairs: Pair[]): Chosen[][] {
  const pairOf = new Map<Chosen, Pair>();
  for (const p of pairs) { pairOf.set(p.a, p); pairOf.set(p.b, p); }
  const seen = new Set<Chosen>();
  const blocks: Chosen[][] = [];
  for (const c of chosen) {
    if (seen.has(c)) continue;
    const p = pairOf.get(c);
    const grp = p ? [p.a, p.b].sort((x, y) => lexCmp(chosenKey(x), chosenKey(y))) : [c];
    grp.forEach((x) => seen.add(x));
    blocks.push(grp);
  }
  return blocks.sort((x, y) => lexCmp(chosenKey(x[0]!), chosenKey(y[0]!)));
}

const sameStation = (a: BuiltExercise, b: BuiltExercise) => a.equipment.some((q) => STATION_EQUIP.includes(q) && b.equipment.includes(q));
/** 기구 두 개를 동시에 차지하는지: 둘 다 자리를 차지하는 장비인데 같은 자리가 아닐 때 (맨몸은 자리 차지 안 함) */
const twoStations = (a: BuiltExercise, b: BuiltExercise) => !sameStation(a, b) && ![a, b].some((x) => x.equipment.every((q) => q === 'bodyweight' || q === 'other'));

/** 5.5 짝 만들기: 품질 순서대로, 겹치지 않게, 같은 부위 순서를 뒤집지 않게(D-014). 슈퍼세트 짝이 없으면 컴파운드 세트로 */
function makePairs(chosen: Chosen[], kinds: Grouping[], allowHeavy: boolean): Pair[] {
  for (const kind of kinds) {
    const cand: { a: Chosen; b: Chosen; key: number[] }[] = [];
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i]!, b = chosen[j]!;
      if (!allowHeavy && (a.entry.ex.heavy || b.entry.ex.heavy)) continue;
      const samePart = a.part === b.part;
      if (kind === 'superset' && (samePart || a.entry.ex.muscles.some((m) => b.entry.ex.muscles.includes(m)))) continue;
      if (kind === 'compound' && !samePart) continue;
      const anta = ANTAGONISTS.some(([x, y]) => (a.part.part === x && b.part.part === y) || (a.part.part === y && b.part.part === x));
      const st = sameStation(a.entry.ex, b.entry.ex);
      const diff = a.entry.ex.muscles[0] !== b.entry.ex.muscles[0];
      const quality = kind === 'superset' ? (anta ? 0 : st ? 1 : 2) : diff ? (st ? 0 : 1) : 2;
      const [hi, lo] = lexCmp(chosenKey(a).slice(0, 2), chosenKey(b).slice(0, 2)) <= 0 ? [a, b] : [b, a];
      cand.push({ a: hi, b: lo, key: [quality, ...chosenKey(hi).slice(0, 2), hi.poolIdx, ...chosenKey(lo).slice(0, 2), lo.poolIdx] });
    }
    cand.sort((x, y) => lexCmp(x.key, y.key));
    const out: Pair[] = [];
    const used = new Set<Chosen>();
    let added = true;
    while (added) {
      added = false;
      for (const c of cand) {
        if (used.has(c.a) || used.has(c.b)) continue;
        const next = [...out, { a: c.a, b: c.b, kind }];
        if (!orderPreserved(chosen, next)) continue;
        out.push(next[next.length - 1]!); used.add(c.a); used.add(c.b); added = true;
      }
    }
    if (out.length) return out;
  }
  return [];
}

interface Candidate {
  id: number; chosen: Chosen[]; pairs: Pair[];
  removedEx: number[]; removedSets: number[];
  steps: { c: number; i: number; r: number }; time: number;
}

/** 휴식 단계 조합: 단계 수 최소, 같으면 단관절 → 묶음 → 다관절 순으로 먼저 줄임 (5.7 K2) */
const comboCache = new Map<string, Steps[]>();
function stepCombos(p: TimeParams): Steps[] {
  const max = { c: Math.floor((p.restCompound - p.restCompoundMin) / p.restStep), i: Math.floor((p.restIsolation - p.restIsolationMin) / p.restStep), r: Math.floor((p.roundRest - p.roundRestMin) / p.restStep) };
  const key = `${max.c},${max.i},${max.r}`;
  let list = comboCache.get(key);
  if (!list) {
    list = [];
    for (let c = 0; c <= max.c; c++) for (let i = 0; i <= max.i; i++) for (let r = 0; r <= max.r; r++) list.push({ c, i, r });
    list.sort((x, y) => lexCmp([x.c + x.i + x.r, x.c, x.r, x.i], [y.c + y.i + y.r, y.c, y.r, y.i]));
    comboCache.set(key, list);
  }
  return list;
}
type Steps = { c: number; i: number; r: number };
/** K2: 목표를 넘는 만큼 휴식을 15초 단계로 줄인다. 불가능하면 undefined */
export function pickRestSteps(t: number, counts: Steps, targetSec: number, p: TimeParams = DEFAULT_TIME): { steps: Steps; time: number } | undefined {
  for (const s of stepCombos(p)) {
    const tt = t - p.restStep * (s.c * counts.c + s.i * counts.i + s.r * counts.r);
    if (tt <= targetSec) return { steps: s, time: tt };
  }
  return undefined;
}
/** 휴식을 모두 최소로 줄였을 때 시간 */
function minTime(t: number, counts: Steps, p: TimeParams): number {
  const l = stepCombos(p); const m = l[l.length - 1]!;
  return t - p.restStep * (m.c * counts.c + m.i * counts.i + m.r * counts.r);
}
export function generatePlan(req: PlanRequest, all: BuiltExercise[]): Plan {
  const p: TimeParams = { ...DEFAULT_TIME, ...req.time };
  const reasons: string[] = [];
  const states = buildPools(req, all, reasons);
  const missingParts = states.filter((s) => !s.pool.length).map((s) => s.part);
  for (const m of missingParts) reasons.push(`${m}: 조건(장비·제외·등급)에 맞는 운동이 없어 빠짐`);
  const active = states.filter((s) => s.pool.length);
  const targetSec = req.targetMinutes !== undefined ? Math.round(req.targetMinutes * 60) : undefined;
  const defaultRest = { compound: p.restCompound, isolation: p.restIsolation, round: p.roundRest };
  if (!active.length) return emptyPlan('empty', reasons.length ? reasons : ['조건에 맞는 운동이 없음'], missingParts, targetSec, 0, defaultRest);

  const kinds: Grouping[] = [];
  const g = req.groupings ?? [];
  if (active.length >= 2 && g.includes('superset')) kinds.push('superset');
  if (g.includes('compound')) kinds.push('compound');
  const prefer = req.groupingPreference === 'prefer';
  const hasLegs = active.some((s) => s.part === '하체');

  // K3: 우선순위 그룹마다 세트 값, K4: 부위별 운동 수
  const groups = PRIORITY_ORDER.filter((pr) => active.some((s) => s.priority === pr));
  const setOptions = targetSec === undefined ? [groups.map(() => BASE_SETS)] : cartesian(groups.map(() => [2, 3, 4]));
  // 목표 시간이 없으면 기본안(부위 간 겹침으로 못 채우면 그보다 적게)
  const countOptions = targetSec === undefined
    ? cartesian(active.map((s) => range(Math.max(1, s.lockedCount), s.baseCount)))
    : cartesian(active.map((s) => range(Math.max(1, s.lockedCount), s.pool.length)));

  const between = p.betweenRestSec + p.moveSec;
  const stCache = new Map<PoolEntry, number>();
  const st = (c: Chosen) => { let v = stCache.get(c.entry); if (v === undefined) { v = setTime(c.entry.ex, c.reps, p); stCache.set(c.entry, v); } return v; };
  const isComp = (c: Chosen) => c.entry.ex.mechanics === 'compound';
  const single = (c: Chosen) => c.sets * st(c) + (c.sets - 1) * (isComp(c) ? p.restCompound : p.restIsolation);
  const group = (a: Chosen, b: Chosen) => a.sets * st(a) + b.sets * st(b) + Math.min(a.sets, b.sets) * p.transitionSec + (Math.max(a.sets, b.sets) - 1) * p.roundRest;
  const pairCache = new Map<string, [number, number, Grouping][]>();
  const warmupOf = (chosen: Chosen[]) => {
    const first = [...chosen].sort((x, y) => lexCmp(chosenKey(x), chosenKey(y)))[0];
    return warmupFor(req.targetMinutes, hasLegs, first ? { exercise: first.entry.ex, sets: 1, reps: first.reps } : undefined, p);
  };

  let best: Candidate | undefined;
  let candidateCount = 0, minNeeded = Infinity, id = 0;
  const win = (c: Candidate) => (targetSec !== undefined && c.time >= targetSec - 300 ? 0 : 1);
  const cut = (c: Candidate) => c.steps.c + c.steps.i + c.steps.r;
  const better = (a: Candidate, b: Candidate) =>
    (lexCmp(a.removedEx, b.removedEx) || lexCmp(a.removedSets, b.removedSets) || win(a) - win(b) || cut(a) - cut(b) ||
      (prefer ? b.pairs.length - a.pairs.length : a.pairs.length - b.pairs.length) || b.time - a.time || a.id - b.id) < 0;

  for (const setVals of setOptions) {
    const setsFor = (s: PartState) => setVals[groups.indexOf(s.priority)]!;
    for (const counts of countOptions) {
      // 부위 우선순위 순서로 풀을 훑으며, 앞선 부위가 이미 쓴 운동·같은 묶음·무거운 힌지(M-12)는 건너뛰고 counts개를 채운다
      const chosen: Chosen[] = [];
      let valid = true;
      const ids = new Set<string>();
      const lockedAll = active.flatMap((s) => s.pool.filter((e) => e.locked !== undefined));
      const fams = new Set<string>(lockedAll.map((e) => e.ex.family));
      let heavyTaken = lockedAll.some((e) => isHeavyHinge(e.ex));
      for (const e of lockedAll) ids.add(e.ex.id);
      active.forEach((s, k) => {
        let total = 0, taken = 0;
        for (let i = 0; i < s.pool.length && taken < counts[k]!; i++) {
          const e = s.pool[i]!;
          if (e.locked === undefined) {
            if (ids.has(e.ex.id) || fams.has(e.ex.family) || (isHeavyHinge(e.ex) && heavyTaken)) continue;
            ids.add(e.ex.id); fams.add(e.ex.family); if (isHeavyHinge(e.ex)) heavyTaken = true;
          }
          const sets = e.locked ?? setsFor(s);
          total += sets; taken++;
          chosen.push({ entry: e, part: s, poolIdx: i, sets, reps: targetReps(e.ex) });
        }
        if (taken < counts[k]! || total > Math.max(PART_SET_CAP, s.lockedSets)) valid = false;
      });
      if (!valid) continue;
      const removedEx = active.map((s, k) => Math.max(0, s.baseCount - counts[k]!));
      const removedSets = active.map((s, k) => chosen.filter((c) => c.part === s && c.entry.locked === undefined).slice(0, Math.min(s.baseCount, counts[k]!))
        .reduce((r) => r + Math.max(0, BASE_SETS - setsFor(s)), 0));
      const ck = counts.join(',');
      let pairIdx = pairCache.get(ck);
      if (!pairIdx) {
        pairIdx = kinds.length ? makePairs(chosen, kinds, !!req.allowHeavyInGroups).map((pr) => [chosen.indexOf(pr.a), chosen.indexOf(pr.b), pr.kind] as [number, number, Grouping]) : [];
        pairCache.set(ck, pairIdx);
      }
      const warm = warmupOf(chosen);
      let t = warm.seconds + chosen.reduce((s, c) => s + single(c), 0) + (chosen.length - 1) * between;
      const cc = { c: 0, i: 0, r: 0 };
      for (const c of chosen) { if (isComp(c)) cc.c += c.sets - 1; else cc.i += c.sets - 1; }
      const kMax = targetSec === undefined ? (prefer ? pairIdx.length : 0) : pairIdx.length;
      const kMin = targetSec === undefined ? kMax : 0;
      for (let k = 0; k <= kMax; k++) {
        if (k > 0) {
          const [ia, ib] = pairIdx[k - 1]!; const a = chosen[ia]!, b = chosen[ib]!;
          t -= single(a) + single(b) + between - group(a, b);
          if (isComp(a)) cc.c -= a.sets - 1; else cc.i -= a.sets - 1;
          if (isComp(b)) cc.c -= b.sets - 1; else cc.i -= b.sets - 1;
          cc.r += Math.max(a.sets, b.sets) - 1;
        }
        if (k < kMin) continue;
        candidateCount++;
        let steps: Steps = { c: 0, i: 0, r: 0 }, time = t;
        if (targetSec !== undefined) {
          minNeeded = Math.min(minNeeded, minTime(t, cc, p));
          const r = pickRestSteps(t, cc, targetSec, p);
          if (!r) continue;
          steps = r.steps; time = r.time;
        }
        const cd: Candidate = { id: id++, chosen, pairs: pairIdx.slice(0, k).map(([ia, ib, kind]) => ({ a: chosen[ia]!, b: chosen[ib]!, kind })), removedEx, removedSets, steps, time };
        if (!best || better(cd, best)) best = cd;
      }
    }
  }

  if (!best && targetSec === undefined) return emptyPlan('empty', [...reasons, '선택 부위끼리 운동이 겹쳐 구성할 수 없음'], req.parts.map((x) => x.part), targetSec, candidateCount, defaultRest);
  if (!best) {
    const highOnly = req.parts.filter((x) => x.priority === 'high');
    const fallbackParts = highOnly.length && highOnly.length < req.parts.length ? highOnly : req.parts.length > 1 ? [sortedParts(req)[0]!] : [];
    const short = `선택 부위를 모두 넣기엔 ${Math.max(1, Math.ceil((minNeeded - targetSec!) / 60))}분 부족`;
    if (fallbackParts.length) {
      const sub = generatePlan({ ...req, parts: fallbackParts.map(({ part, priority }) => ({ part, priority })) }, all);
      if (sub.status === 'too_short') return { ...sub, missingParts: req.parts.map((x) => x.part), reasons: [short, ...sub.reasons] };
      const dropped = req.parts.filter((x) => !fallbackParts.some((f) => f.part === x.part)).map((x) => x.part);
      return { ...sub, status: 'reduced', missingParts: [...sub.missingParts, ...dropped],
        reasons: [`${short} → ${fallbackParts.map((f) => f.part).join(', ')}만으로 구성 (빠진 부위: ${dropped.join(', ')})`, ...sub.reasons] };
    }
    return emptyPlan('too_short', [`${isFinite(minNeeded) ? Math.ceil(minNeeded / 60) : '?'}분 이상 필요 (목표 ${req.targetMinutes}분)`, ...reasons], req.parts.map((x) => x.part), targetSec, candidateCount, defaultRest);
  }

  // ---------- 결과 만들기 ----------
  const rest = { compound: p.restCompound - best.steps.c * p.restStep, isolation: p.restIsolation - best.steps.i * p.restStep, round: p.roundRest - best.steps.r * p.restStep };
  const memberBlocks = toBlocks(best.chosen, best.pairs);
  const pairOf = new Map<Chosen, Pair>();
  for (const pr of best.pairs) { pairOf.set(pr.a, pr); pairOf.set(pr.b, pr); }
  const warm = warmupOf(best.chosen);
  const item = (c: Chosen): TimedItem => ({ exercise: c.entry.ex, sets: c.sets, reps: c.reps });
  const timed: TimedBlock[] = memberBlocks.map((m) => (m.length > 1
    ? { kind: 'group', items: m.map(item), roundRest: rest.round }
    : { kind: 'single', items: m.map(item), rest: isComp(m[0]!) ? rest.compound : rest.isolation }));

  // 이유
  if (targetSec !== undefined) {
    const baseDesc = active.map((s) => `${s.part} ${s.baseCount}개`).join(', ');
    reasons.push(`목표 ${req.targetMinutes}분: 기본안(${baseDesc} × ${BASE_SETS}세트, 기본 휴식)에서 시작해 예상 ${fmt(best.time)}로 맞춤`);
  } else {
    reasons.push(`목표 시간 없음: 기본안(${active.map((s) => `${s.part} ${s.baseCount}개`).join(', ')} × ${BASE_SETS}세트, 기본 휴식)으로 구성 (5.1), 예상 ${fmt(best.time)}`);
  }
  for (const s of active) {
    const mine = best.chosen.filter((c) => c.part === s);
    const free = mine.filter((c) => c.entry.locked === undefined);
    const chosenSet = new Set(mine.map((m) => m.entry));
    const others = best.chosen.filter((o) => o.part !== s);
    const conflicts = (e: PoolEntry) => others.some((o) => o.entry.ex.id === e.ex.id || o.entry.ex.family === e.ex.family || (isHeavyHinge(e.ex) && isHeavyHinge(o.entry.ex)));
    const lastIdx = Math.max(-1, ...mine.map((m) => m.poolIdx));
    const overlapped = s.pool.filter((e, i) => !chosenSet.has(e) && conflicts(e) && (i <= lastIdx || i < s.baseCount));
    const added = mine.slice(s.baseCount);
    const dropped = s.pool.filter((e) => chosenSet.has(e) || !conflicts(e)).slice(0, s.baseCount).filter((e) => !chosenSet.has(e));
    const n = mine.reduce((t, c) => t + c.sets, 0);
    const sets = free[0]?.sets;
    const parts: string[] = [`운동 ${mine.length}개, 총 ${n}세트`];
    if (sets !== undefined && sets !== BASE_SETS) parts.push(`세트 ${BASE_SETS}→${sets} (시간에 맞춤)`);
    if (added.length) parts.push(`남는 시간에 ${added.map((c) => `'${c.entry.ex.name_ko}'(${c.entry.grade.value})`).join(', ')} 추가`);
    if (dropped.length) parts.push(`시간 부족으로 ${dropped.map((e) => `'${e.ex.name_ko}'`).join(', ')} 뺌`);
    if (overlapped.length) parts.push(`다른 부위와 겹쳐 제외: ${overlapped.map((e) => `'${e.ex.name_ko}'`).join(', ')}`);
    const slack = targetSec !== undefined && targetSec - best.time >= 60;
    const perEx = sets ?? 0;
    const capBound = slack && free.length > 0 && n + perEx > Math.max(PART_SET_CAP, s.lockedSets) && (perEx >= MAX_SETS || n + free.length > PART_SET_CAP);
    if (capBound) parts.push(`부위당 상한 ${PART_SET_CAP}세트(영상 주장, 검증 필요)에 걸려 더 늘리지 않음`);
    if (s.lockedCount) parts.push(`잠금 ${s.lockedCount}개`);
    reasons.push(`${s.part}: ${parts.join(' · ')}`);
  }
  for (const pr of best.pairs) {
    const saved = single(pr.a) + single(pr.b) + between - group(pr.a, pr.b);
    reasons.push(`${pr.a.entry.ex.name_ko} + ${pr.b.entry.ex.name_ko}: ${pr.kind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}로 묶음 (약 ${saved < 90 ? `${Math.round(saved)}초` : `${Math.round(saved / 60)}분`} 절약${twoStations(pr.a.entry.ex, pr.b.entry.ex) ? ', 기구 두 개 동시 사용' : ''})`);
  }
  if (best.steps.c) reasons.push(`다관절 세트 간 휴식 ${p.restCompound}→${rest.compound}초`);
  if (best.steps.i) reasons.push(`단관절 세트 간 휴식 ${p.restIsolation}→${rest.isolation}초`);
  if (best.steps.r) reasons.push(`묶음 라운드 후 휴식 ${p.roundRest}→${rest.round}초`);
  if (targetSec !== undefined && win(best)) reasons.push(`목표보다 약 ${Math.floor((targetSec - best.time) / 60)}분 여유: 더 넣을 후보가 없거나(후보 수·부위당 세트 상한·다른 부위와 겹침) 하나 더 넣으면 목표를 넘음`);
  const est = best.chosen.filter((c) => c.entry.grade.estimated).length;
  if (est) reasons.push(`추정 등급 운동 ${est}개 포함: 영상 근거가 없어 B로 보고 앱 추천 순서로 고름 (M-09, M-14)`);
  const heavy = best.chosen.filter((c) => isHeavyHinge(c.entry.ex));
  if (heavy.length > 1) reasons.push(`잠금으로 무거운 힌지 ${heavy.length}개 (M-12 예외: 사용자 선택)`);
  else if (heavy.length === 1) reasons.push(`무거운 힌지는 한 플랜에 1개: ${heavy[0]!.entry.ex.name_ko} (M-12)`);

  const planBlocks: PlanBlock[] = memberBlocks.map((m, i) => {
    const items: PlanItem[] = m.map((c) => ({
      exerciseId: c.entry.ex.id, name: c.entry.ex.name_ko, part: c.part.part, sets: c.sets,
      reps: c.entry.ex.measure === 'time' ? 0 : c.reps,
      ...(c.entry.ex.measure === 'time' ? { seconds: c.entry.ex.default_seconds ?? 30 } : {}),
      grade: c.entry.grade.value, gradeSource: c.entry.grade.source, estimated: c.entry.grade.estimated, substituted: c.entry.substituted, locked: c.entry.locked !== undefined,
      why: whyText(c), rank: c.poolIdx,
    }));
    const b = timed[i]!;
    if (m.length > 1) {
      const kind = pairOf.get(m[0]!)!.kind;
      return { kind, items, roundRestSec: b.roundRest, transitionSec: p.transitionSec, timeSec: blockTime(b, p), twoStations: twoStations(m[0]!.entry.ex, m[1]!.entry.ex) };
    }
    return { kind: 'single', items, restSec: b.rest, timeSec: blockTime(b, p) };
  });
  return { status: 'ok', blocks: planBlocks, warmup: warm, estimatedSec: best.time, targetSec, rest, reasons, missingParts, candidateCount };
}

function whyText(c: Chosen): string {
  const g = c.entry.grade;
  const src = g.source === 'USER' ? '내가 정한 등급' : g.estimated ? '추정 · 영상 없음' : `영상${g.entry?.target ? ' · ' + g.entry.target : ''}`;
  const note = g.entry?.purpose_note ? `, ${g.entry.purpose_note}` : '';
  return `${c.part.part} ${g.value} (${src}${note})${c.entry.substituted ? ' · 등급 미달 대체' : ''}${c.entry.locked !== undefined ? ' · 잠금' : ''}`;
}

function emptyPlan(status: Plan['status'], reasons: string[], missingParts: Part[], targetSec: number | undefined, candidateCount: number, rest: Plan['rest']): Plan {
  return { status, blocks: [], warmup: { kind: 'none', seconds: 0, label: '' }, estimatedSec: 0, targetSec, rest, reasons, missingParts, candidateCount };
}

function range(a: number, b: number): number[] { const r: number[] = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function cartesian(lists: number[][]): number[][] {
  return lists.reduce<number[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]);
}
