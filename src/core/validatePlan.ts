/**
 * 생성 결과 검증 (BLUEPRINT 5.9 + M-12 + D-014). 오류가 없으면 빈 배열.
 * 잠금 운동은 사용자 선택이라 등급·세트·제외·장비·묶음(family) 검사에서 빠지고, 무거운 힌지는 "잠금이 있으면 추가로 넣지 않음"만 검사한다.
 */
import type { BuiltExercise } from './types';
import { EQUIPMENT } from './types';
import { gradeAtLeast, GRADES } from './version';
import { isHeavyHinge, equipmentAvailable, eligibleParts, resolveGrade } from './exercises';
import type { Plan, PlanRequest } from './planner';
import { MUSCLE_CAP } from './planner';
import { sessionLoad, overCap, SESSION_CAP, MAX_SETS_BY_LEVEL } from './volume';

export function validatePlan(plan: Plan, req: PlanRequest, all: BuiltExercise[]): string[] {
  const errs: string[] = [];
  const byId = new Map(all.map((e) => [e.id, e]));
  const items = plan.blocks.flatMap((b) => b.items);
  const minGrade = req.minGrade ?? 'B';
  const equip = req.equipment ?? [...EQUIPMENT];
  if (items.some((i) => !byId.has(i.exerciseId))) errs.push('없는 운동 id');
  if ((plan.status === 'ok' || plan.status === 'reduced') && !items.length) errs.push('운동이 없음');

  for (const it of items) {
    const e = byId.get(it.exerciseId);
    if (!e) continue;
    if (!it.locked) {
      if (!it.substituted && !gradeAtLeast(it.grade, minGrade)) errs.push(`최소 등급 미만: ${it.name} ${it.grade}`);
      if (it.sets < 2) errs.push(`운동당 2세트 미만: ${it.name}`);
      if (it.sets > MAX_SETS_BY_LEVEL[req.level]) errs.push(`운동당 ${MAX_SETS_BY_LEVEL[req.level]}세트 초과: ${it.name}`);
      if ((req.excluded ?? []).includes(it.exerciseId)) errs.push(`제외한 운동 포함: ${it.name}`);
      if (!equipmentAvailable(e, equip)) errs.push(`없는 장비: ${it.name}`);
      const g = resolveGrade(e, it.part, req.level, req.subGoals?.[it.part], req.userGrades?.[e.id]);
      if (g.value !== it.grade || g.estimated !== it.estimated) errs.push(`등급 표시 불일치: ${it.name}`);
      if (it.substituted) {
        const existsOk = all.some((x) => eligibleParts(x).includes(it.part) && !(req.excluded ?? []).includes(x.id) && equipmentAvailable(x, equip) &&
          gradeAtLeast(resolveGrade(x, it.part, req.level, req.subGoals?.[it.part], req.userGrades?.[x.id]).value, minGrade));
        if (existsOk) errs.push(`대체가 필요 없는데 대체 표시: ${it.name}`);
      }
    }
    if (it.estimated !== (it.gradeSource === 'APP_DEFAULT')) errs.push(`추정 표시 불일치: ${it.name}`);
    if ((e.measure === 'time') !== (it.seconds !== undefined) || (e.measure === 'time' && it.reps !== 0)) errs.push(`시간 운동 표시 오류: ${it.name}`);
  }
  const ids = items.map((i) => i.exerciseId);
  if (new Set(ids).size !== ids.length) errs.push('같은 운동 중복');
  const free = items.filter((i) => !i.locked && byId.has(i.exerciseId));
  const lockedFams = new Set(items.filter((i) => i.locked && byId.has(i.exerciseId)).map((i) => byId.get(i.exerciseId)!.family));
  const fams = free.map((i) => byId.get(i.exerciseId)!.family);
  if (new Set(fams).size !== fams.length || fams.some((f) => lockedFams.has(f))) errs.push('같은 묶음(family) 중복');
  const heavyFree = free.filter((i) => isHeavyHinge(byId.get(i.exerciseId)!)).length;
  const heavyLocked = items.filter((i) => i.locked && byId.has(i.exerciseId) && isHeavyHinge(byId.get(i.exerciseId)!)).length;
  if (heavyFree > (heavyLocked ? 0 : 1)) errs.push('무거운 힌지 2개 이상 (M-12)');
  // M-27: 부위별 같은 주 근육 상한 (잠금은 사용자 선택: 잠금이 상한보다 많으면 잠금 수까지 인정, 잠금 아닌 것은 더하지 않음)
  for (const [part, caps] of Object.entries(MUSCLE_CAP)) for (const [m, n] of Object.entries(caps ?? {})) {
    const inPart = items.filter((i) => i.part === part && byId.get(i.exerciseId)?.muscles[0] === m);
    const lockedN = inPart.filter((i) => i.locked).length;
    if (inPart.length > Math.max(n, lockedN)) errs.push(`${part} ${m} 운동 ${n}개 초과 (M-27)`);
  }

  for (const b of plan.blocks) {
    if (b.kind === 'single' && b.items.length !== 1) errs.push('단일 블록 운동 수 오류');
    if (b.kind === 'single') continue;
    if (b.items.length < 2) errs.push('묶음 블록 운동 수 오류');
    const ex = b.items.map((i) => byId.get(i.exerciseId));
    for (let x = 0; x < ex.length; x++) for (let y = x + 1; y < ex.length; y++) {
      const a = ex[x], c = ex[y];
      if (!a || !c) continue;
      if (!req.allowHeavyInGroups && (a.heavy || c.heavy)) errs.push(`무거운 운동 묶음: ${a.name_ko}+${c.name_ko}`);
      if (b.kind === 'superset') {
        if (b.items[x]!.part === b.items[y]!.part) errs.push(`슈퍼세트가 같은 부위: ${a.name_ko}+${c.name_ko}`);
        if (a.muscles.some((m) => c.muscles.includes(m))) errs.push(`슈퍼세트 주 근육 겹침: ${a.name_ko}+${c.name_ko}`);
      }
      if (b.kind === 'compound' && b.items[x]!.part !== b.items[y]!.part) errs.push(`컴파운드 세트가 다른 부위: ${a.name_ko}+${c.name_ko}`);
    }
  }
  // D-041: 근육 그룹별 한 번 상한 (fractional, 부위를 넘어 합산). 잠금만으로 넘으면 그 양까지 인정
  const known = items.filter((i) => byId.has(i.exerciseId)).map((i) => ({ muscles: byId.get(i.exerciseId)!.muscles, sets: i.sets, locked: i.locked }));
  for (const g of overCap(sessionLoad(known), SESSION_CAP[req.level], sessionLoad(known.filter((k) => k.locked)))) errs.push(`근육별 상한 초과: ${g}`);
  for (const { part } of req.parts) {
    const mine = items.filter((i) => i.part === part);
    if (!mine.length && !plan.missingParts.includes(part)) errs.push(`부위 누락(이유 없음): ${part}`);
  }
  for (const m of plan.missingParts) {
    if (plan.status !== 'too_short' && !plan.reasons.some((r) => r.includes(m))) errs.push(`빠진 부위 이유 없음: ${m}`);
  }
  if (plan.status === 'reduced' && !plan.reasons.some((r) => /\d+분 부족/.test(r))) errs.push('reduced인데 부족 이유 없음');
  if (plan.targetSec !== undefined && (plan.status === 'ok' || plan.status === 'reduced') && plan.estimatedSec > plan.targetSec) errs.push(`목표 시간 초과: ${plan.estimatedSec} > ${plan.targetSec}`);
  if (plan.targetSec !== undefined && plan.status === 'ok' && plan.estimatedSec < plan.targetSec - 300 && !plan.reasons.some((r) => r.includes('여유'))) errs.push('시간 창 밖인데 이유 없음');
  if (plan.status !== 'ok' && !plan.reasons.length) errs.push('상태 이유 없음');
  // D-014: 묶음 때문에 같은 부위의 더 좋은 순위 운동이 뒤로 밀리지 않았는지 (묶음 없는 순서와 비교)
  const PR = ['high', 'normal', 'low'];
  const partInfo = new Map(req.parts.map((x, i) => [x.part, { pr: PR.indexOf(x.priority), order: i }]));
  const key = (i: (typeof items)[number]) => {
    const pi = partInfo.get(i.part) ?? { pr: 9, order: 99 };
    const e = byId.get(i.exerciseId);
    return [pi.pr, pi.order, e?.mechanics === 'compound' ? 0 : 1, GRADES.indexOf(i.grade), i.rank];
  };
  const cmpKey = (a: number[], b: number[]) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! - b[k]!; return 0; };
  const basePos = new Map([...items].sort((a, b) => cmpKey(key(a), key(b))).map((it, i) => [it, i]));
  const blockPos = new Map<(typeof items)[number], number>();
  plan.blocks.forEach((b, bi) => b.items.forEach((it) => blockPos.set(it, bi)));
  for (const x of items) for (const y of items) {
    if (x === y || x.part !== y.part || y.rank >= x.rank) continue;
    if (basePos.get(y)! < basePos.get(x)! && blockPos.get(y)! > blockPos.get(x)!) errs.push(`묶음 때문에 순서 뒤집힘 (D-014): ${y.name} 뒤에 ${x.name}`);
  }
  // 순위(rank)가 생성 규칙과 맞는지 직접 확인: 잠금이 먼저, 그다음 등급(좋은 순) → 영상 등급 우선(M-09) → 추정끼리는 앱 추천 순서(M-14) → 즐겨찾기 → 최근 → 장비 → 이름
  // 같은 등급의 영상 등급 운동끼리는 근육 분산 때문에 순서가 바뀔 수 있어 비교하지 않는다
  const fav = new Set(req.favorites ?? []), recent = new Set(req.recent ?? []);
  const EQR: Record<string, number> = { cable: 0, machine: 0, smith: 1, dumbbell: 2, bodyweight: 3, band: 4, barbell: 5, other: 6 };
  const rankKey = (i: (typeof items)[number]) => {
    const e = byId.get(i.exerciseId)!;
    return [i.locked ? 0 : 1, GRADES.indexOf(i.grade), i.estimated ? 1 : 0, i.estimated ? (e.staple?.[i.part] ?? 99) : 0, fav.has(e.id) ? 0 : 1, recent.has(e.id) ? 0 : 1, Math.min(...e.equipment.map((q) => EQR[q]!))];
  };
  for (const { part } of req.parts) {
    const mine = items.filter((i) => i.part === part && byId.has(i.exerciseId));
    if (new Set(mine.map((i) => i.rank)).size !== mine.length) errs.push(`순위 중복: ${part}`);
    for (const x of mine) for (const y of mine) {
      if (x === y || x.locked || y.locked) continue;
      const sameVideoGrade = x.grade === y.grade && !x.estimated && !y.estimated;
      if (sameVideoGrade) continue;
      // D-041: 추천 순서에 없는 추정 등급끼리는 근육 그룹 분산 때문에 순서가 바뀔 수 있음
      const noStaple = (i: (typeof items)[number]) => byId.get(i.exerciseId)!.staple?.[part] === undefined;
      if (x.grade === y.grade && x.estimated && y.estimated && noStaple(x) && noStaple(y)) continue;
      const kx = rankKey(x), ky = rankKey(y);
      const c0 = cmpKey(kx, ky) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
      if (c0 < 0 && x.rank > y.rank) errs.push(`순위가 생성 규칙과 다름: ${part} ${x.name} / ${y.name}`);
    }
    for (const l of mine.filter((i) => i.locked)) if (mine.some((o) => !o.locked && o.rank < l.rank)) errs.push(`잠금이 순위 맨 앞이 아님: ${l.name}`);
  }
  return errs;
}