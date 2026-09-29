/**
 * 기기 안 저장소 (IndexedDB, Dexie). 스키마를 바꿀 때는 버전을 올리고 upgrade 함수와 마이그레이션 테스트를 추가한다 (AGENTS 규칙 8).
 */
import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { Routine, Workout } from '../core/session';
import type { Exercise, Level, Part, Equipment } from '../core/types';
import type { Grade } from '../core/version';

export interface ExerciseMeta { exerciseId: string; favorite?: boolean; userGrade?: Grade; excluded?: boolean }
export interface CustomExercise extends Exercise { custom: true; createdAt: string }
export interface Settings {
  key: 'main';
  level: Level;
  equipment: Equipment[];
  defaultMinutes: number;
  defaultParts?: Part[];
  soundOn: boolean;
  keepAwake: boolean;
  /** 앱 기본 휴식 (BLUEPRINT 4.4: 블록 설정 > 루틴 기본값 > 앱 기본값). 새로 추가하는 운동·블록 사이 휴식에 사용 */
  rest: { compound: number; isolation: number; round: number; between: number; transition: number };
  /** 저장공간 안내를 봤는지 */
  storageNoticeSeen?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'main', level: '중급', equipment: ['cable', 'machine', 'smith', 'dumbbell', 'bodyweight', 'band', 'barbell', 'other'],
  defaultMinutes: 60, soundOn: true, keepAwake: true,
  rest: { compound: 150, isolation: 90, round: 120, between: 60, transition: 10 },
};

export class WorkoutDB extends Dexie {
  routines!: Table<Routine, string>;
  workouts!: Table<Workout, string>;
  meta!: Table<ExerciseMeta, string>;
  custom!: Table<CustomExercise, string>;
  settings!: Table<Settings, string>;
  constructor(name = 'workout-app') {
    super(name);
    // 스키마(색인) 변경 시에만 버전을 올린다. 설정에 필드를 더하는 것은 색인이 아니라 버전 변경이 필요 없고,
    // getSettings가 기본값과 합쳐 옛 데이터를 채운다(테스트: '저장된 예전 설정에 휴식 기본값이 없어도 채워짐').
    this.version(1).stores({
      routines: 'id, updatedAt',
      workouts: 'id, startedAt, endedAt',
      meta: 'exerciseId',
      custom: 'id',
      settings: 'key',
    });
  }
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function getSettings(db: WorkoutDB): Promise<Settings> {
  const saved = await db.settings.get('main');
  // 예전 설정에 없는 항목은 기본값으로 채움 (버전이 올라가도 설정 유지)
  return { ...DEFAULT_SETTINGS, ...saved, rest: { ...DEFAULT_SETTINGS.rest, ...saved?.rest } };
}

/** 진행 중(끝나지 않은) 운동 하나 */
export async function activeWorkout(db: WorkoutDB): Promise<Workout | undefined> {
  const all = await db.workouts.toArray();
  return all.filter((w) => !w.endedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

export async function finishedWorkouts(db: WorkoutDB): Promise<Workout[]> {
  return (await db.workouts.toArray()).filter((w) => w.endedAt).sort((a, b) => (a.endedAt! < b.endedAt! ? 1 : -1));
}

/** 브라우저에 저장공간 유지 요청 (사파리가 지우지 않도록, BLUEPRINT 2장) */
export async function requestPersist(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
