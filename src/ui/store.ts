/**
 * 화면 상태 저장소: IndexedDB 내용을 메모리에 올려 두고, 바꿀 때마다 저장 후 다시 읽는다.
 */
import { useEffect, useState } from 'preact/hooks';
import { WorkoutDB, getSettings, DEFAULT_SETTINGS, requestPersist } from '../db/db';
import type { Settings, ExerciseMeta, CustomExercise } from '../db/db';
import type { Routine, Workout } from '../core/session';

export const db = new WorkoutDB();

export interface AppState {
  ready: boolean;
  settings: Settings;
  routines: Routine[];
  workouts: Workout[];
  meta: Map<string, ExerciseMeta>;
  custom: CustomExercise[];
}

let state: AppState = { ready: false, settings: DEFAULT_SETTINGS, routines: [], workouts: [], meta: new Map(), custom: [] };
const listeners = new Set<(s: AppState) => void>();

export async function load(): Promise<void> {
  const [settings, routines, workouts, meta, custom] = await Promise.all([
    getSettings(db), db.routines.toArray(), db.workouts.toArray(), db.meta.toArray(), db.custom.toArray(),
  ]);
  state = {
    ready: true, settings,
    routines: routines.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    workouts: workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    meta: new Map(meta.map((m) => [m.exerciseId, m])),
    custom,
  };
  listeners.forEach((l) => l(state));
}

export async function mutate(fn: (d: WorkoutDB) => Promise<unknown>): Promise<void> {
  await fn(db);
  await load();
}

export function useAppState(): AppState {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    if (!state.ready) void load();
    return () => { listeners.delete(set); };
  }, []);
  return s;
}

let persistAsked = false;
export async function askPersistOnce(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  await requestPersist();
}

export const activeOf = (s: AppState) => s.workouts.find((w) => !w.endedAt);
export const historyOf = (s: AppState) => s.workouts.filter((w) => w.endedAt);
