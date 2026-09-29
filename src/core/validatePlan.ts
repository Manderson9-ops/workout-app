/**
 * 생성 결과 검증 (BLUEPRINT 5.9 + M-12). 오류가 없으면 빈 배열.
 */
import type { BuiltExercise } from './types';
import { gradeAtLeast } from './version';
import { isHeavyHinge, equipmentAvailable } from './exercises';
import { EQUIPMENT } from './types';
import type { Plan, PlanRequest } from './planner';
import { PART_SET_CAP } from './planner';

export function validatePlan(plan: Plan, req: PlanRequest, all: BuiltExercise[]): string[] {
  const errs: string[] = [];
  const byId = new Map(all.map((e) => [e.id, e]));
  const items = plan.blocks.flatMap((b) => b.items);
  const minGrade = req.minGrade ?? 'B';
  const exs = items.map((i) => byId.get(i.exerciseId));
  if (exs.some((e) => !e)) errs.push('없는 운동 id');
  if ((plan.status === 'ok' || plan.status === 'reduced') && !items.length) errs.push('운동이 없음');

  for (const it of items) {
    const e = byId.get(it.exerciseId);
    if (!e) continue;
    if (!it.locked && !it.substituted && !gradeAtLeast(it.grade, minGrade)) errs.push(`최소 등급 미만: ${it.name} ${it.grade}`);
    if (!it.locked && it.sets < 2) errs.push(`운동당 2세트 미만: ${it.name}`);
    if (!it.locked && it.sets > 4) errs.push(`운동당 4세트 초과: ${it.name}`);
    if (!it.locked && (req.excluded ?? []).includes(it.exerciseId)) errs.push(`제외한 운동 포함: ${it.name}`);
    if (!it.locked && !equipmentAvailable(e, req.equipment ?? [...EQUIPMENT])) errs.push(`없는 장비: ${it.name}`);
    if (it.estimated !== (it.gradeSource === 'APP_DEFAULT')) errs.push(`추정 표시 불일치: ${it.name}`);
  }
  const ids = items.map((i) => i.exerciseId);
  if (new Set(ids).size !== ids.length) errs.push('같은 운동 중복');
  const fams = items.filter((i) => !i.locked && byId.has(i.exerciseId)).map((i) => byId.get(i.exerciseId)!.family);
  if (new Set(fams).size !== fams.length) errs.push('같은 묶음(family) 중복');
  if (exs.filter((e) => e && isHeavyHinge(e)).length > 1) errs.push('무거운 힌지 2개 이상 (M-12)');

  for (const b of plan.blocks) {
    if (b.kind === 'single' && b.items.length !== 1) errs.push('단일 블록 운동 수 오류');
    if (b.kind !== 'single') {
      if (b.items.length < 2) errs.push('묶음 블록 운동 수 오류');
      const [a, c] = b.items.map((i) => byId.get(i.exerciseId));
      if (a && c) {
        if (!req.allowHeavyInGroups && (a.heavy || c.heavy)) errs.push(`무거운 운동 묶음: ${a.name_ko}+${c.name_ko}`);
        if (b.kind === 'superset') {
          if (b.items[0]!.part === b.items[1]!.part) errs.push(`슈퍼세트가 같은 부위: ${a.name_ko}+${c.name_ko}`);
          if (a.muscles.some((m) => c.muscles.includes(m))) errs.push(`슈퍼세트 주 근육 겹침: ${a.name_ko}+${c.name_ko}`);
        }
        if (b.kind === 'compound' && b.items[0]!.part !== b.items[1]!.part) errs.push(`컴파운드 세트가 다른 부위: ${a.name_ko}+${c.name_ko}`);
      }
    }
  }
  for (const { part } of req.parts) {
    const n = items.filter((i) => i.part === part && !i.locked).reduce((s, i) => s + i.sets, 0);
    if (n > PART_SET_CAP) errs.push(`부위당 세트 상한 초과: ${part} ${n}`);
    const present = items.some((i) => i.part === part);
    if (!present && !plan.missingParts.includes(part)) errs.push(`부위 누락(이유 없음): ${part}`);
  }
  if (plan.targetSec !== undefined && (plan.status === 'ok' || plan.status === 'reduced') && plan.estimatedSec > plan.targetSec) errs.push(`목표 시간 초과: ${plan.estimatedSec} > ${plan.targetSec}`);
  if (plan.targetSec !== undefined && plan.status === 'ok' && plan.estimatedSec < plan.targetSec - 300 && !plan.reasons.some((r) => r.includes('여유'))) errs.push('시간 창 밖인데 이유 없음');
  if (plan.status !== 'ok' && !plan.reasons.length) errs.push('상태 이유 없음');
  return errs;
}
