/**
 * 운동 데이터 스키마. 기준: BLUEPRINT 3장 (G:\내 드라이브\WORK_OUT_APP\docs\BLUEPRINT.md)
 */
import type { Grade } from './version';

/** 앱 전체의 유일한 부위 목록 (BLUEPRINT 3.3) */
export const PARTS = ['가슴', '등', '어깨', '이두', '삼두', '전완·악력', '하체', '코어'] as const;
export type Part = (typeof PARTS)[number];

export const LEVELS = ['초보', '중급', '상급'] as const;
export type Level = (typeof LEVELS)[number];

/** 장비. 순서 = 동률일 때 우선 순서 (BLUEPRINT 5.4). 같은 순위는 EQUIPMENT_RANK로 표현 */
export const EQUIPMENT = ['cable', 'machine', 'smith', 'dumbbell', 'bodyweight', 'band', 'barbell', 'other'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const EQUIPMENT_RANK: Record<Equipment, number> = {
  cable: 0, machine: 0, smith: 1, dumbbell: 2, bodyweight: 3, band: 4, barbell: 5, other: 6,
};
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  cable: '케이블', machine: '머신', smith: '스미스', dumbbell: '덤벨', bodyweight: '맨몸', band: '밴드', barbell: '바벨', other: '기타',
};

export const PATTERNS = ['H_PUSH', 'V_PUSH', 'H_PULL', 'V_PULL', 'SQUAT', 'HINGE', 'LUNGE', 'ISOLATION', 'CORE', 'CARRY'] as const;
export type Pattern = (typeof PATTERNS)[number];

export type Mechanics = 'compound' | 'isolation';
export type Measure = 'reps' | 'time';

export type GradeSource = 'VIDEO' | 'APP_DEFAULT' | 'USER';

export interface GradeEntry {
  value: Grade;
  /** 비어 있으면 모든 수준 */
  levels: Level[];
  /** 이 등급이 적용되는 목적 부위 */
  purpose_part: Part;
  /** 같은 목적 부위 안의 세부 목표 (예: '악력', '광배 집중') */
  purpose_note?: string;
  /** true면 세부 목표를 고른 경우에만 적용 (사용자 결정 대기 항목, IMPORT_REPORT 참고) */
  sub_goal_only?: boolean;
  source: GradeSource;
  why?: string;
  target?: string;
  video_id?: string;
  timestamp?: string;
  /** 같은 운동이 여러 영상에 있을 때: 그 운동을 주제로 다룬 영상이면 true (우선) */
  primary_topic?: boolean;
}

export interface GuideItem {
  type: string;
  text: string;
  video_id: string;
  timestamp: string;
}

export interface Exercise {
  id: string;
  name_ko: string;
  aliases?: string[];
  family: string;
  part: Part;
  muscles: string[];
  pattern: Pattern;
  mechanics: Mechanics;
  equipment: Equipment[];
  unilateral?: boolean;
  /** 무거운 다관절: 기본적으로 묶음(슈퍼세트 등)에서 제외 (BLUEPRINT 5.5) */
  heavy?: boolean;
  measure?: Measure;
  /** measure=reps: 기본 횟수 범위. 없으면 mechanics 기본값 */
  default_reps?: [number, number];
  /** measure=time: 기본 초 */
  default_seconds?: number;
  sec_per_rep?: number;
  setup_sec?: number;
  note?: string;
  /** 앱 기본 추천 순서 (M-14, data/staples.json). 영상 등급 없는 운동끼리만 적용. 작을수록 먼저 */
  staple?: Partial<Record<Part, number>>;
}

/** 빌드 결과(앱이 쓰는 형태) */
export interface BuiltExercise extends Exercise {
  grades: GradeEntry[];
  guide: GuideItem[];
}

export const DEFAULTS = {
  compound_reps: [6, 10] as [number, number],
  isolation_reps: [10, 15] as [number, number],
  sec_per_rep: 3,
  setup_sec: 20,
  side_switch_sec: 8,
  app_default_grade: 'B' as Grade,
};
