/**
 * 화면 상태 저장소: IndexedDB 내용을 메모리에 올려 두고, 바꿀 때마다 저장 후 다시 읽는다.
 */
import { lsGet, lsSet, DB_NAME } from './appName';
import { useEffect, useState } from 'preact/hooks';
import { WorkoutDB, getSettings, DEFAULT_SETTINGS, requestPersist } from '../db/db';
import type { Settings, ExerciseMeta, CustomExercise, BodyweightRow } from '../db/db';
import type { Routine, Workout } from '../core/session';
import { Clock } from '../core/hlc';
import type { ClockStore } from '../core/hlc';
import { deviceId } from './deviceId';

/** 동기화 시계(HLC)는 localStorage에 "본 가장 큰 값"을 보관 (S2a) */
const clockStore: ClockStore = { get: () => lsGet('sync.hlc'), set: (v) => lsSet('sync.hlc', v) };
export const db = new WorkoutDB(DB_NAME, { clock: new Clock(clockStore), deviceId });

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
let flushDepth = 0;
/** 돌려주는 값: 이번에 먼저 저장한 대기 입력 수 (진단용, 이미 저장 중이던 것은 세지 않음) */
export async function flushPending(): Promise<number> {
  // 대기 입력을 저장하는 도중 그 저장이 다시 flushPending을 부르면(세트 변경 경로), 바깥 호출이 이미 처리 중이므로 바로 돌아감.
  // 입력칸 두 개가 서로를 기다리는 멈춤을 막음 (검토 3차)
  if (flushDepth > 0) return 0;
  flushDepth++;
  try {
  // 버튼을 누르면 입력칸 포커스가 먼저 빠지며 저장이 시작되므로, 그 저장이 끝날 때까지 기다린다.
  // 부른 시점에 이미 시작된 저장만 기다린다 (나중에 시작된 저장, 특히 자기 자신을 기다리면 영원히 멈춤: 검토 N1)
  const before = [...inflight];
  const fns = [...pending.values()]; pending.clear();
  for (const fn of fns) await fn();
  await Promise.allSettled(before);
  return fns.length;
  } finally { flushDepth--; }
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
/** 처음 데이터를 다 불러왔을 때 (이미 불러왔으면 바로) */
export function whenReady(): Promise<void> {
  if (state.ready) return Promise.resolve();
  return new Promise((res) => { const l = (s: AppState) => { if (s.ready) { listeners.delete(l); res(); } }; listeners.add(l); });
}

/** 이 기기가 주인인 진행 중 운동 (다른 기기에서 진행 중인 운동은 읽기 전용, D-029) */
export const activeOf = (s: AppState) => s.workouts.find((w) => !w.endedAt && (!w.ownerDeviceId || w.ownerDeviceId === deviceId()) && !w.pendingMerge);
/** 다른 기기에서 진행 중인 운동 */
export const remoteActiveOf = (s: AppState) => s.workouts.find((w) => !w.endedAt && !!w.ownerDeviceId && w.ownerDeviceId !== deviceId());
/** 끝난 운동 (다른 기기에서 늦게 온 기록 사본은 합치기 전까지 통계에서 뺌) */
export const historyOf = (s: AppState) => s.workouts.filter((w) => w.endedAt && !w.pendingMerge);
/** 다른 기기에서 늦게 온 기록 사본 (합치기/지우기 대기) */
export const lateCopiesOf = (s: AppState) => s.workouts.filter((w) => !!w.pendingMerge);
