/**
 * 기본 종목 + WORK_OUT_K 가져온 데이터를 합쳐 앱이 쓰는 운동 목록을 만든다.
 * 데이터 검증(validateExerciseData)은 테스트와 빌드에서 함께 쓴다.
 */
import { PARTS, EQUIPMENT, PATTERNS, LEVELS, DEFAULTS } from './types';
import type { Exercise, BuiltExercise, GradeEntry, GuideItem, Part, Level, Equipment, Pattern } from './types';
import { GRADES } from './version';
import type { Grade } from './version';

export interface WorkoutKData {
  grades: Record<string, GradeEntry[]>;
  guides: Record<string, GuideItem[]>;
  templates: unknown[];
  combos: unknown[];
}

export function buildExercises(base: Exercise[], wk: WorkoutKData, staples?: Partial<Record<Part, string[]>>): BuiltExercise[] {
  const rank = new Map<string, Partial<Record<Part, number>>>();
  for (const [part, ids] of Object.entries(staples ?? {}) as [Part, string[]][]) ids.forEach((id, i) => rank.set(id, { ...rank.get(id), [part]: i + 1 }));
  return base.map((e) => ({ ...e, ...(rank.has(e.id) ? { staple: rank.get(e.id) } : {}), grades: wk.grades[e.id] ?? [], guide: wk.guides[e.id] ?? [] }));
}

/** 운동이 후보가 될 수 있는 부위: 기본 부위 + 영상 등급의 목적 부위 (예: 딥스 → 가슴, 삼두) */
export function eligibleParts(e: BuiltExercise): Part[] {
  return [...new Set<Part>([e.part, ...e.grades.map((g) => g.purpose_part)])];
}

export interface ResolvedGrade {
  value: Grade;
  source: GradeEntry['source'];
  /** 영상 등급이 없어 앱 기본값을 쓴 경우 true ("추정" 표시) */
  estimated: boolean;
  entry?: GradeEntry;
  /** 같은 조건에서 함께 보여줄 다른 등급 (참고용, 세부 목표 전용 등) */
  others: GradeEntry[];
}

/**
 * 플랜 생성용 등급 1개 고르기 (BLUEPRINT 3.3)
 * 순서: 출처(USER > VIDEO) → 목적 부위 일치 → 세부 목표 → 수준 → 주제 영상 우선 → 여럿이면 낮은 등급
 */
export function resolveGrade(e: BuiltExercise, part: Part, level: Level, subGoal?: string, userGrade?: Grade): ResolvedGrade {
  if (userGrade) return { value: userGrade, source: 'USER', estimated: false, others: e.grades };
  const forPart = e.grades.filter((g) => g.purpose_part === part);
  const applicable = forPart.filter((g) => (g.sub_goal_only ? subGoal !== undefined && g.purpose_note === subGoal : true));
  const bySubGoal = subGoal ? applicable.filter((g) => g.purpose_note === subGoal) : [];
  const general = applicable.filter((g) => !g.sub_goal_only);
  const levelPick = (pool: GradeEntry[]) => {
    const byLevel = pool.filter((g) => g.levels.includes(level));
    return byLevel.length ? byLevel : pool.filter((g) => g.levels.length === 0);
  };
  // 세부 목표 등급이 내 수준에 없으면 일반 등급으로 내려간다
  let cands = levelPick(bySubGoal);
  if (!cands.length) cands = levelPick(general);
  const primary = cands.filter((g) => g.primary_topic !== false);
  if (primary.length) cands = primary;
  if (!cands.length) {
    return { value: DEFAULTS.app_default_grade, source: 'APP_DEFAULT', estimated: true, others: forPart };
  }
  // 같은 조건에 여럿이면 보수적으로 낮은 등급 (BLUEPRINT 3.3: 같은 목적 부위에 등급이 둘 이상이고 세부 목표를 안 고른 경우)
  const pick = [...cands].sort((a, b) => GRADES.indexOf(b.value) - GRADES.indexOf(a.value))[0]!;
  return { value: pick.value, source: 'VIDEO', estimated: false, entry: pick, others: forPart.filter((g) => g !== pick) };
}

/** 장비 조건: 운동에 적힌 장비가 모두 있어야 한다 (예: 실 로우 = 바벨 + 기타(전용 벤치)) */
export function equipmentAvailable(e: Exercise, available: readonly Equipment[]): boolean {
  return e.equipment.every((q) => available.includes(q));
}

/** 무거운 힌지 (M-12 제안: 한 플랜에 1개) */
export function isHeavyHinge(e: Exercise): boolean {
  return !!e.heavy && e.pattern === 'HINGE';
}

export function defaultReps(e: Exercise): [number, number] {
  return e.default_reps ?? (e.mechanics === 'compound' ? DEFAULTS.compound_reps : DEFAULTS.isolation_reps);
}

/** 데이터 오류 목록. 비어 있으면 통과 */
export function validateExerciseData(base: Exercise[], families: Record<string, string>, wk: WorkoutKData): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const e of base) {
    if (ids.has(e.id)) errs.push(`id 중복: ${e.id}`);
    ids.add(e.id);
    if (!/^[a-z0-9_]+$/.test(e.id)) errs.push(`id 형식: ${e.id}`);
    for (const n of [e.name_ko, ...(e.aliases ?? [])]) {
      if (names.has(n) && names.get(n) !== e.id) errs.push(`이름 중복: ${n}`);
      names.set(n, e.id);
    }
    if (!PARTS.includes(e.part)) errs.push(`부위 값: ${e.id} ${e.part}`);
    if (!PATTERNS.includes(e.pattern)) errs.push(`동작 값: ${e.id} ${e.pattern}`);
    if (e.mechanics !== 'compound' && e.mechanics !== 'isolation') errs.push(`mechanics 값: ${e.id}`);
    if (!e.equipment.length || e.equipment.some((q) => !EQUIPMENT.includes(q))) errs.push(`장비 값: ${e.id}`);
    if (!families[e.family]) errs.push(`family 없음: ${e.id} ${e.family}`);
    if (!e.muscles.length) errs.push(`근육 비어 있음: ${e.id}`);
    if (e.measure === 'time') {
      if (!e.default_seconds || e.default_seconds <= 0) errs.push(`시간 운동 기본 초 없음: ${e.id}`);
    } else {
      const [a, b] = defaultReps(e);
      if (!(a > 0 && b >= a)) errs.push(`횟수 범위: ${e.id}`);
    }
  }
  for (const f of Object.keys(families)) if (!base.some((e) => e.family === f)) errs.push(`빈 family: ${f}`);
  for (const [id, gs] of Object.entries(wk.grades)) {
    if (!ids.has(id)) errs.push(`등급 대상 운동 없음: ${id}`);
    for (const g of gs) {
      if (!GRADES.includes(g.value)) errs.push(`등급 값: ${id} ${g.value}`);
      if (!PARTS.includes(g.purpose_part)) errs.push(`목적 부위 값: ${id} ${g.purpose_part}`);
      if (g.levels.some((l) => !LEVELS.includes(l))) errs.push(`수준 값: ${id}`);
      if (g.source === 'VIDEO' && (!g.video_id || !g.timestamp)) errs.push(`영상 근거 없음: ${id} ${g.value}`);
      if (g.sub_goal_only && !g.purpose_note) errs.push(`세부 목표 전용인데 목표 이름 없음: ${id}`);
    }
  }
  for (const id of Object.keys(wk.guides)) if (!ids.has(id)) errs.push(`가이드 대상 운동 없음: ${id}`);
  return errs;
}

/** 앱 기본 추천 순서(staples.json) 검증: 없는 운동, 해당 부위 후보가 아닌 운동, 중복 */
export function validateStaples(all: BuiltExercise[], staples: Partial<Record<Part, string[]>>): string[] {
  const errs: string[] = [];
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const [part, ids] of Object.entries(staples) as [Part, string[]][]) {
    if (!PARTS.includes(part)) errs.push(`부위 값: ${part}`);
    if (new Set(ids).size !== ids.length) errs.push(`중복: ${part}`);
    for (const id of ids) {
      const e = byId.get(id);
      if (!e) errs.push(`없는 운동: ${part} ${id}`);
      else if (!eligibleParts(e).includes(part)) errs.push(`부위 후보 아님: ${part} ${id}`);
    }
  }
  return errs;
}

/** 직접 추가한 운동의 동작 유형: 부위와 다관절/단관절로 정함 */
export function patternFor(part: Part, mech: 'compound' | 'isolation'): Pattern {
  if (mech === 'isolation') return part === '코어' ? 'CORE' : 'ISOLATION';
  const m: Record<Part, Pattern> = { 가슴: 'H_PUSH', 등: 'H_PULL', 어깨: 'V_PUSH', 이두: 'ISOLATION', 삼두: 'H_PUSH', '전완·악력': 'CARRY', 하체: 'SQUAT', 코어: 'CORE' };
  return m[part];
}
