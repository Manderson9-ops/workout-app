/**
 * 규칙 기반 플랜 생성기 (BLUEPRINT 5장). 같은 입력이면 항상 같은 결과. 모든 결정에 이유를 남긴다.
 */
import type { BuiltExercise, Part, Level, Equipment } from './types';
import { EQUIPMENT_RANK, EQUIPMENT } from './types';
import type { Grade } from './version';
import { GRADES, gradeAtLeast } from './version';
import { eligibleParts, resolveGrade, equipmentAvailable, isHeavyHinge } from './exercises';
import type { ResolvedGrade } from './exercises';
import { DEFAULT_TIME, targetReps, setTime, blockTime, warmupFor } from './time';
import type { TimeParams, TimedBlock, TimedItem, Warmup } from './time';

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
  /** 잠금: 반드시 포함, 세트 고정 */
  locked?: { exerciseId: string; part: Part; sets: number }[];
  time?: Partial<TimeParams>;
}

export interface PlanItem { exerciseId: string; name: string; part: Part; sets: number; reps: number; grade: Grade; gradeSource: ResolvedGrade['source']; estimated: boolean; substituted: boolean; locked: boolean; why: string }
export interface PlanBlock { kind: 'single' | 'superset' | 'compound'; items: PlanItem[]; restSec?: number; roundRestSec?: number; transitionSec?: number; timeSec: number }
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
const MAX_SETS = 4, MIN_SETS = 2, BASE_SETS = 3;
const PRIORITY_ORDER: Priority[] = ['high', 'normal', 'low'];
const ANTAGONISTS: [Part, Part][] = [['가슴', '등'], ['이두', '삼두']];

interface PoolEntry { ex: BuiltExercise; grade: ResolvedGrade; substituted: boolean; locked?: number }
interface PartState { part: Part; priority: Priority; order: number; pool: PoolEntry[]; baseCount: number; lockedCount: number }

const gradeIdx = (g: Grade) => GRADES.indexOf(g);

function sortedParts(req: PlanRequest) {
  return req.parts.map((p, i) => ({ ...p, order: i }))
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || a.order - b.order);
}

/** 5.2 단계 1~2 + 5.4: 부위별 후보 풀 */
function buildPools(req: PlanRequest, all: BuiltExercise[], reasons: string[]): PartState[] {
  const minGrade = req.minGrade ?? 'B';
  const equip = req.equipment ?? [...EQUIPMENT];
  const excluded = new Set(req.excluded ?? []);
  const fav = new Set(req.favorites ?? []);
  const recent = new Set(req.recent ?? []);
  const parts = sortedParts(req);
  const poolSize = parts.length <= 3 ? 5 : parts.length === 4 ? 4 : 2;
  const usedFamilies = new Set<string>();
  const usedIds = new Set<string>();
  let heavyHingeUsed = false;
  const byId = new Map(all.map((e) => [e.id, e]));
  const states: PartState[] = [];

  for (const p of parts) {
    const pool: PoolEntry[] = [];
    // 잠금이 있는 부위는 잠근 운동만 쓴다 (세트 고정, 등급·제외 조건 무시). 순서는 일반 풀과 같은 규칙
    const locks = (req.locked ?? []).filter((x) => x.part === p.part && byId.has(x.exerciseId));
    const lockSets = new Map(locks.map((l) => [l.exerciseId, l.sets]));
    const cands = (locks.length ? locks.map((l) => byId.get(l.exerciseId)!) : all
      .filter((e) => eligibleParts(e).includes(p.part) && !excluded.has(e.id) && equipmentAvailable(e, equip) && !usedIds.has(e.id)))
      .map((e) => ({ ex: e, grade: resolveGrade(e, p.part, req.level, req.subGoals?.[p.part], req.userGrades?.[e.id]) }));
    const rank = (c: { ex: BuiltExercise; grade: ResolvedGrade }) => [
      gradeIdx(c.grade.value),
      c.grade.estimated ? 1 : 0, // M-09
      c.grade.estimated ? (c.ex.staple?.[p.part] ?? 99) : 0, // M-14 앱 기본 추천 순서
      fav.has(c.ex.id) ? 0 : 1,
      recent.has(c.ex.id) ? 0 : 1,
      Math.min(...c.ex.equipment.map((q) => EQUIPMENT_RANK[q])),
    ];
    const cmp = (a: typeof cands[0], b: typeof cands[0]) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
      return a.ex.name_ko < b.ex.name_ko ? -1 : a.ex.name_ko > b.ex.name_ko ? 1 : 0;
    };
    let ok = (locks.length ? [...cands] : cands.filter((c) => gradeAtLeast(c.grade.value, minGrade))).sort(cmp);
    let substituted = false;
    if (!ok.length && cands.length) {
      ok = [...cands].sort(cmp).slice(0, 1);
      substituted = true;
      reasons.push(`${p.part}: 최소 등급 ${minGrade} 이상 운동이 없어 가장 높은 등급(${ok[0]!.grade.value}) 운동으로 대체 (등급 미달 대체)`);
    }
    // 목표 근육 분산: 같은 등급 안에서 아직 안 쓴 주 근육을 먼저
    const covered = new Set(pool.map((x) => x.ex.muscles[0]));
    const remaining = [...ok];
    while (pool.length < (locks.length || poolSize) && remaining.length) {
      const top = remaining[0]!;
      // 목표 근육 분산은 영상 등급끼리만 (추정 등급은 앱 추천 순서(M-14)가 이미 다양하게 정해 둠)
      let idx = top.grade.estimated ? -1 : remaining.findIndex((c) => !c.grade.estimated && gradeIdx(c.grade.value) === gradeIdx(top.grade.value) && !covered.has(c.ex.muscles[0]) && fits(c.ex));
      if (idx < 0) idx = remaining.findIndex((c) => fits(c.ex));
      if (idx < 0) break;
      const c = remaining.splice(idx, 1)[0]!;
      pool.push({ ex: c.ex, grade: c.grade, substituted, ...(lockSets.has(c.ex.id) ? { locked: lockSets.get(c.ex.id)! } : {}) });
      covered.add(c.ex.muscles[0]); usedFamilies.add(c.ex.family); usedIds.add(c.ex.id);
      if (isHeavyHinge(c.ex)) heavyHingeUsed = true;
    }
    function fits(e: BuiltExercise) {
      if (locks.length) return !usedIds.has(e.id);
      return !usedFamilies.has(e.family) && !usedIds.has(e.id) && !(isHeavyHinge(e) && heavyHingeUsed);
    }
    const base = parts.length >= 5 ? 2 : p.priority === 'high' ? 3 : 2;
    const lockedCount = locks.length ? pool.length : 0;
    states.push({ part: p.part, priority: p.priority, order: p.order, pool, baseCount: locks.length ? pool.length : Math.min(base, pool.length), lockedCount });
  }
  return states;
}

interface Chosen { entry: PoolEntry; part: PartState; poolIdx: number; sets: number; reps: number }
interface Pair { a: Chosen; b: Chosen; quality: number }

function pairCandidates(chosen: Chosen[], kind: Grouping, allowHeavy: boolean): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
    const a = chosen[i]!, b = chosen[j]!;
    if (!allowHeavy && (a.entry.ex.heavy || b.entry.ex.heavy)) continue;
    const samePart = a.part.part === b.part.part;
    if (kind === 'superset') {
      if (samePart) continue;
      if (a.entry.ex.muscles.some((m) => b.entry.ex.muscles.includes(m))) continue;
    } else if (!samePart) continue;
    const antagonist = ANTAGONISTS.some(([x, y]) => (a.part.part === x && b.part.part === y) || (a.part.part === y && b.part.part === x));
    const sameStation = a.entry.ex.equipment.some((q) => (q === 'cable' || q === 'machine') && b.entry.ex.equipment.includes(q));
    const diffTarget = a.entry.ex.muscles[0] !== b.entry.ex.muscles[0];
    const quality = kind === 'superset' ? (antagonist ? 0 : sameStation ? 1 : 2) : (diffTarget ? (sameStation ? 0 : 1) : 2);
    out.push({ a, b, quality });
  }
  const partRank = (c: Chosen) => [PRIORITY_ORDER.indexOf(c.part.priority), c.part.order];
  const key = (p: Pair) => {
    const [hi, lo] = partRank(p.a) <= partRank(p.b) ? [p.a, p.b] : [p.b, p.a];
    return [p.quality, ...partRank(hi), hi.poolIdx, ...partRank(lo), lo.poolIdx];
  };
  out.sort((x, y) => { const kx = key(x), ky = key(y); for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i]! - ky[i]!; return 0; });
  const used = new Set<Chosen>();
  return out.filter((p) => (used.has(p.a) || used.has(p.b) ? false : (used.add(p.a), used.add(p.b), true)));
}

interface Candidate {
  id: number;
  chosen: Chosen[];
  pairs: Pair[];
  timeDefault: number;
  counts: { c: number; i: number; r: number };
  removedEx: number[]; removedSets: number[];
  steps?: { c: number; i: number; r: number };
  time?: number;
}

function orderChosen(chosen: Chosen[]): Chosen[] {
  return [...chosen].sort((a, b) =>
    PRIORITY_ORDER.indexOf(a.part.priority) - PRIORITY_ORDER.indexOf(b.part.priority) || a.part.order - b.part.order ||
    (a.entry.ex.mechanics === b.entry.ex.mechanics ? 0 : a.entry.ex.mechanics === 'compound' ? -1 : 1) ||
    gradeIdx(a.entry.grade.value) - gradeIdx(b.entry.grade.value) || a.poolIdx - b.poolIdx);
}

function toTimedBlocks(chosen: Chosen[], pairs: Pair[], rest: { compound: number; isolation: number; round: number }): { blocks: TimedBlock[]; members: Chosen[][] } {
  const ordered = orderChosen(chosen);
  const pairOf = new Map<Chosen, Pair>();
  for (const p of pairs) { pairOf.set(p.a, p); pairOf.set(p.b, p); }
  const done = new Set<Chosen>();
  const blocks: TimedBlock[] = []; const members: Chosen[][] = [];
  for (const c of ordered) {
    if (done.has(c)) continue;
    const p = pairOf.get(c);
    if (p) {
      const other = p.a === c ? p.b : p.a;
      const grp = [c, other];
      grp.forEach((x) => done.add(x));
      blocks.push({ kind: 'group', items: grp.map(item), roundRest: rest.round });
      members.push(grp);
    } else {
      done.add(c);
      blocks.push({ kind: 'single', items: [item(c)], rest: c.entry.ex.mechanics === 'compound' ? rest.compound : rest.isolation });
      members.push([c]);
    }
  }
  return { blocks, members };
  function item(c: Chosen): TimedItem { return { exercise: c.entry.ex, sets: c.sets, reps: c.reps }; }
}


function lexCmp(a: number[], b: number[]) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; }

export function generatePlan(req: PlanRequest, all: BuiltExercise[]): Plan {
  const p: TimeParams = { ...DEFAULT_TIME, ...req.time };
  const reasons: string[] = [];
  const states = buildPools(req, all, reasons);
  const missingParts = states.filter((s) => !s.pool.length).map((s) => s.part);
  for (const m of missingParts) reasons.push(`${m}: 조건(장비·제외·등급)에 맞는 운동이 없어 빠짐`);
  const active = states.filter((s) => s.pool.length);
  if (!active.length) return emptyPlan('empty', reasons.length ? reasons : ['조건에 맞는 운동이 없음'], missingParts, req.targetMinutes !== undefined ? Math.round(req.targetMinutes * 60) : undefined, 0, { compound: DEFAULT_TIME.restCompound, isolation: DEFAULT_TIME.restIsolation, round: DEFAULT_TIME.roundRest });
  const targetSec = req.targetMinutes !== undefined ? Math.round(req.targetMinutes * 60) : undefined;
  const groupKind: Grouping | undefined = (() => {
    const g = req.groupings ?? [];
    if (active.length >= 2 && g.includes('superset')) return 'superset';
    if (g.includes('compound')) return 'compound';
    return undefined;
  })();
  const prefer = req.groupingPreference === 'prefer';
  const hasLegs = active.some((s) => s.part === '하체');
  const defaultRest = { compound: p.restCompound, isolation: p.restIsolation, round: p.roundRest };

  // K3 조합: 우선순위 그룹마다 세트 값
  const groups = PRIORITY_ORDER.filter((pr) => active.some((s) => s.priority === pr));
  const setOptions = targetSec === undefined ? [[...groups.map(() => BASE_SETS)]] : cartesian(groups.map(() => [2, 3, 4]));
  // K4 조합: 부위별 운동 수
  const countOptions = targetSec === undefined
    ? [active.map((s) => s.baseCount)]
    : cartesian(active.map((s) => range(Math.max(1, s.lockedCount), s.pool.length)));

  const warmupOf = (chosen: Chosen[]) => {
    const first = orderChosen(chosen)[0];
    return warmupFor(req.targetMinutes, hasLegs, first ? { exercise: first.entry.ex, sets: 1, reps: first.reps } : undefined, p);
  };

  // K2 준비: 휴식 줄이기 (15초 단계, 최소값까지). 단계 수 최소, 같으면 단관절 → 묶음 → 다관절 먼저
  const maxSteps = {
    c: Math.floor((p.restCompound - p.restCompoundMin) / p.restStep),
    i: Math.floor((p.restIsolation - p.restIsolationMin) / p.restStep),
    r: Math.floor((p.roundRest - p.roundRestMin) / p.restStep),
  };
  const stepCombos: { c: number; i: number; r: number }[] = [];
  for (let c = 0; c <= maxSteps.c; c++) for (let i = 0; i <= maxSteps.i; i++) for (let r = 0; r <= maxSteps.r; r++) stepCombos.push({ c, i, r });
  stepCombos.sort((x, y) => (x.c + x.i + x.r) - (y.c + y.i + y.r) || x.c - y.c || x.r - y.r || x.i - y.i);
  const between = p.betweenRestSec + p.moveSec;
  const stCache = new Map<PoolEntry, number>();
  const st = (c: Chosen) => { let v = stCache.get(c.entry); if (v === undefined) { v = setTime(c.entry.ex, c.reps, p); stCache.set(c.entry, v); } return v; };
  const isComp = (c: Chosen) => c.entry.ex.mechanics === 'compound';
  const single = (c: Chosen) => c.sets * st(c) + (c.sets - 1) * (isComp(c) ? p.restCompound : p.restIsolation);
  const group = (a: Chosen, b: Chosen) => a.sets * st(a) + b.sets * st(b) + Math.min(a.sets, b.sets) * p.transitionSec + (Math.max(a.sets, b.sets) - 1) * p.roundRest;
  const pairCache = new Map<string, [number, number][]>();

  let best: Candidate | undefined;
  let candidateCount = 0, minNeeded = Infinity, id = 0;
  const win = (c: Candidate) => (targetSec !== undefined && c.time! >= targetSec - 300 ? 0 : 1);
  const restCut = (c: Candidate) => c.steps!.c + c.steps!.i + c.steps!.r;
  const better = (a: Candidate, b: Candidate) =>
    (lexCmp(a.removedEx, b.removedEx) || lexCmp(a.removedSets, b.removedSets) || win(a) - win(b) || restCut(a) - restCut(b) ||
      (prefer ? b.pairs.length - a.pairs.length : a.pairs.length - b.pairs.length) || b.time! - a.time! || a.id - b.id) < 0;

  for (const setVals of setOptions) {
    const setsFor = (s: PartState) => setVals[groups.indexOf(s.priority)]!;
    for (const counts of countOptions) {
      let okCap = true;
      const chosen: Chosen[] = [];
      active.forEach((s, k) => {
        let total = 0;
        for (let i = 0; i < counts[k]!; i++) {
          const e = s.pool[i]!;
          const sets = e.locked ?? setsFor(s);
          total += sets;
          chosen.push({ entry: e, part: s, poolIdx: i, sets, reps: targetReps(e.ex) });
        }
        if (s.lockedCount === 0 && total > PART_SET_CAP) okCap = false;
      });
      if (!okCap) continue;
      const removedEx = active.map((s, k) => Math.max(0, s.baseCount - counts[k]!));
      const removedSets = active.map((s, k) => {
        let r = 0;
        for (let i = 0; i < Math.min(s.baseCount, counts[k]!); i++) { const e = s.pool[i]!; r += Math.max(0, (e.locked ?? BASE_SETS) - (e.locked ?? setsFor(s))); }
        return r;
      });
      // 짝 목록은 운동 구성(counts)에만 달려 있어 캐시
      const ck = counts.join(',');
      let pairIdx = pairCache.get(ck);
      if (!pairIdx) {
        pairIdx = groupKind ? pairCandidates(chosen, groupKind, !!req.allowHeavyInGroups).map((pr) => [chosen.indexOf(pr.a), chosen.indexOf(pr.b)] as [number, number]) : [];
        pairCache.set(ck, pairIdx);
      }
      // 기본 시간 (묶음 없음, 기본 휴식)
      const warm = warmupOf(chosen);
      let t0 = warm.seconds + chosen.reduce((s, c) => s + single(c), 0) + (chosen.length - 1) * between;
      const cnt = { c: 0, i: 0, r: 0 };
      for (const c of chosen) { if (isComp(c)) cnt.c += c.sets - 1; else cnt.i += c.sets - 1; }
      const kMax = targetSec === undefined ? (prefer ? pairIdx.length : 0) : pairIdx.length;
      const kMin = targetSec === undefined ? kMax : 0;
      // 짝을 하나씩 더하며 시간·휴식 횟수를 갱신
      let t = t0; const cc = { ...cnt };
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
        const cd: Candidate = { id: id++, chosen, pairs: [], timeDefault: t, counts: { ...cc }, removedEx, removedSets };
        if (targetSec === undefined) { cd.steps = { c: 0, i: 0, r: 0 }; cd.time = t; }
        else {
          minNeeded = Math.min(minNeeded, t - p.restStep * (maxSteps.c * cc.c + maxSteps.i * cc.i + maxSteps.r * cc.r));
          for (const s2 of stepCombos) {
            const tt = t - p.restStep * (s2.c * cc.c + s2.i * cc.i + s2.r * cc.r);
            if (tt <= targetSec) { cd.steps = s2; cd.time = tt; break; }
          }
          if (!cd.steps) continue;
        }
        cd.pairs = pairIdx.slice(0, k).map(([ia, ib]) => ({ a: chosen[ia]!, b: chosen[ib]!, quality: 0 }));
        if (!best || better(cd, best)) best = cd;
      }
    }
  }

  if (!best) {
    const highOnly = req.parts.filter((x) => x.priority === 'high');
    const fallbackParts = highOnly.length && highOnly.length < req.parts.length ? highOnly : req.parts.length > 1 ? [sortedParts(req)[0]!] : [];
    const short = `선택 부위를 모두 넣기엔 ${Math.ceil((minNeeded - targetSec!) / 60)}분 부족`;
    if (fallbackParts.length) {
      const sub = generatePlan({ ...req, parts: fallbackParts.map(({ part, priority }) => ({ part, priority })) }, all);
      if (sub.status === 'too_short') return { ...sub, missingParts: req.parts.map((x) => x.part), reasons: [short, ...sub.reasons] };
      const dropped = req.parts.filter((x) => !fallbackParts.some((f) => f.part === x.part)).map((x) => x.part);
      return { ...sub, status: 'reduced', missingParts: [...sub.missingParts, ...dropped],
        reasons: [`${short} → ${fallbackParts.map((f) => f.part).join(', ')}만으로 구성`, ...sub.reasons] };
    }
    return emptyPlan('too_short', [`${Math.ceil((isFinite(minNeeded) ? minNeeded : 0) / 60)}분 이상 필요 (목표 ${req.targetMinutes}분)`, ...reasons], req.parts.map((x) => x.part), targetSec, candidateCount, defaultRest);
  }  const rest = { compound: p.restCompound - best.steps!.c * p.restStep, isolation: p.restIsolation - best.steps!.i * p.restStep, round: p.roundRest - best.steps!.r * p.restStep };
  const { blocks, members } = toTimedBlocks(best.chosen, best.pairs, rest);
  const warm = warmupOf(best.chosen);

  // 이유
  const totalRemoved = best.removedEx.reduce((s, x) => s + x, 0);
  if (targetSec !== undefined) {
    const base = active.map((s) => `${s.part} ${s.baseCount}개`).join(', ');
    reasons.push(`목표 ${req.targetMinutes}분: 기본안(${base} × ${BASE_SETS}세트, 기본 휴식)을 시간에 맞춤`);
    if (best.pairs.length) reasons.push(`시간을 맞추려고 ${best.pairs.map((x) => `${x.a.entry.ex.name_ko}+${x.b.entry.ex.name_ko}`).join(', ')}을(를) ${groupKind === 'superset' ? '슈퍼세트' : '컴파운드 세트'}로 묶음`);
    if (best.steps!.c) reasons.push(`다관절 세트 간 휴식 ${p.restCompound}→${rest.compound}초`);
    if (best.steps!.i) reasons.push(`단관절 세트 간 휴식 ${p.restIsolation}→${rest.isolation}초`);
    if (best.steps!.r) reasons.push(`묶음 라운드 후 휴식 ${p.roundRest}→${rest.round}초`);
    if (totalRemoved) reasons.push(`시간 부족으로 운동 ${totalRemoved}개 줄임 (우선순위 낮은 부위부터)`);
    if (win(best)) reasons.push(best.time! < targetSec - 300 ? `부위당 세트 상한(${PART_SET_CAP})·후보 수에 걸려 약 ${Math.floor((targetSec - best.time!) / 60)}분 여유` : '');
  }
  for (const s of active) {
    const mine = best.chosen.filter((c) => c.part === s);
    const n = mine.reduce((t, c) => t + c.sets, 0);
    const per = mine[0]?.sets ?? 0;
    const atCap = s.lockedCount === 0 && mine.length > 0 && (per >= MAX_SETS || n + mine.length > PART_SET_CAP) && n + per > PART_SET_CAP;
    reasons.push(`${s.part}: 운동 ${mine.length}개, 총 ${n}세트 (부위당 상한 ${PART_SET_CAP}${atCap ? ', 상한에 걸려 더 늘리지 않음' : ''})${s.lockedCount ? ' · 잠금' : ''}`);
  }
  if (best.chosen.some((c) => c.entry.grade.estimated)) reasons.push(`영상 등급이 없는 운동은 앱 기본값 B "추정" (M-09)`);

  const planBlocks: PlanBlock[] = blocks.map((b, i) => {
    const mem = members[i]!;
    const items: PlanItem[] = mem.map((c) => ({
      exerciseId: c.entry.ex.id, name: c.entry.ex.name_ko, part: c.part.part, sets: c.sets, reps: c.reps,
      grade: c.entry.grade.value, gradeSource: c.entry.grade.source, estimated: c.entry.grade.estimated, substituted: c.entry.substituted, locked: c.entry.locked !== undefined,
      why: whyText(c),
    }));
    return b.kind === 'group'
      ? { kind: groupKind === 'superset' ? 'superset' : 'compound', items, roundRestSec: b.roundRest, transitionSec: p.transitionSec, timeSec: blockTime(b, p) }
      : { kind: 'single', items, restSec: b.rest, timeSec: blockTime(b, p) };
  });
  return { status: 'ok', blocks: planBlocks, warmup: warm, estimatedSec: best.time!, targetSec, rest, reasons: reasons.filter(Boolean), missingParts, candidateCount };
}

function whyText(c: Chosen): string {
  const g = c.entry.grade;
  const src = g.source === 'USER' ? '내가 정한 등급' : g.estimated ? '추정(영상 없음)' : `영상 ${g.entry?.target ? '· ' + g.entry.target : ''}`;
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

/** 테스트·화면용: 세트 1개 시간 */
export { setTime };
