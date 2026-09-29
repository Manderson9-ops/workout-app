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
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'main', level: '중급', equipment: ['cable', 'machine', 'smith', 'dumbbell', 'bodyweight', 'band', 'barbell', 'other'],
  defaultMinutes: 60, soundOn: true, keepAwake: true,
};

export class WorkoutDB extends Dexie {
  routines!: Table<Routine, string>;
  workouts!: Table<Workout, string>;
  meta!: Table<ExerciseMeta, string>;
  custom!: Table<CustomExercise, string>;
  settings!: Table<Settings, string>;
  constructor(name = 'workout-app') {
    super(name);
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
  return { ...DEFAULT_SETTINGS, ...(await db.settings.get('main')) };
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
