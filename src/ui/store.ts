/**
 * 화면 상태 저장소: IndexedDB 내용을 메모리에 올려 두고, 바꿀 때마다 저장 후 다시 읽는다.
 */
import { useEffect, useState } from 'preact/hooks';
import { WorkoutDB, getSettings, DEFAULT_SETTINGS, requestPersist } from '../db/db';
import type { Settings, ExerciseMeta, CustomExercise, BodyweightRow } from '../db/db';
import type { Routine, Workout } from '../core/session';

export const db = new WorkoutDB();

export interface AppState {
  ready: boolean;
  settings: Settings;
  routines: Routine[];
  workouts: Workout[];
  meta: Map<string, ExerciseMeta>;
  custom: CustomExercise[];
  bodyweight: BodyweightRow[];
}

let state: AppState = { ready: false, settings: DEFAULT_SETTINGS, routines: [], workouts: [], meta: new Map(), custom: [], bodyweight: [] };
const listeners = new Set<(s: AppState) => void>();

export async function load(): Promise<void> {
  const [settings, routines, workouts, meta, custom, bodyweight] = await Promise.all([
    getSettings(db), db.routines.toArray(), db.workouts.toArray(), db.meta.toArray(), db.custom.toArray(), db.bodyweight.toArray(),
  ]);
  state = {
    ready: true, settings,
    routines: routines.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    workouts: workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    meta: new Map(meta.map((m) => [m.exerciseId, m])),
    custom, bodyweight,
  };
  listeners.forEach((l) => l(state));
}

export async function mutate(fn: (d: WorkoutDB) => Promise<unknown>): Promise<void> {
  await fn(db);
  await load();
}

/** 진행 중 운동 하나만 메모리에서 바꿔 알림 (전체 다시 읽기 없이) */
export function setWorkoutLocal(w: Workout): void {
  const workouts = state.workouts.some((x) => x.id === w.id) ? state.workouts.map((x) => (x.id === w.id ? w : x)) : [w, ...state.workouts];
  state = { ...state, workouts };
  listeners.forEach((l) => l(state));
}

/** 입력칸의 늦춘 저장(디바운스)을 모아 두었다가 세트 완료 전에 먼저 저장 */
const pending = new Map<string, () => Promise<void>>();
export function registerPending(key: string, fn: (() => Promise<void>) | null) { if (fn) pending.set(key, fn); else pending.delete(key); }
export async function flushKey(key: string): Promise<void> {
  const fn = pending.get(key); pending.delete(key);
  if (fn) await fn();
}
export async function flushPending(): Promise<void> {
  const fns = [...pending.values()]; pending.clear();
  for (const fn of fns) await fn();
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
