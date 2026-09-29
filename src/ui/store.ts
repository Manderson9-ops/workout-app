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
/** 이미 저장이 시작된 입력 (예: 입력칸에서 포커스가 빠질 때 시작된 저장). flushPending이 이것까지 기다림 */
const inflight = new Set<Promise<unknown>>();
export function trackInflight(p: Promise<unknown>): void { inflight.add(p); void p.finally(() => inflight.delete(p)); }
export async function flushPending(): Promise<void> {
  // 버튼을 누르면 입력칸 포커스가 먼저 빠지며 저장이 시작되므로, 그 저장이 끝날 때까지 기다린다.
  // 부른 시점에 이미 시작된 저장만 기다린다 (나중에 시작된 저장, 특히 자기 자신을 기다리면 영원히 멈춤: 검토 N1)
  const before = [...inflight];
  const fns = [...pending.values()]; pending.clear();
  for (const fn of fns) await fn();
  await Promise.allSettled(before);
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

/** 지금 메모리 상태 (바뀔 때마다 새 객체라서, 같은 객체면 데이터도 같음) */
export const getState = () => state;

export const activeOf = (s: AppState) => s.workouts.find((w) => !w.endedAt);
export const historyOf = (s: AppState) => s.workouts.filter((w) => w.endedAt);
