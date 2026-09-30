/**
 * 기기 안 저장소 (IndexedDB, Dexie). 스키마를 바꿀 때는 버전을 올리고 upgrade 함수와 마이그레이션 테스트를 추가한다 (AGENTS 규칙 8).
 */
import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { Routine, Workout } from '../core/session';
import type { Exercise, Level, Part, Equipment } from '../core/types';
import type { Grade } from '../core/version';
import type { BackupData } from '../core/backup';
import type { DiagEntry } from '../core/diag';

export interface BodyweightRow { date: string; kg: number }
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
  /** 마지막으로 백업 파일을 저장한 시각 (7일 알림용) */
  lastBackupAt?: string;
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
  bodyweight!: Table<BodyweightRow, string>;
  diag!: Table<DiagEntry & { id?: number }, number>;
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
    // v2 (P4): 체중 기록 표 추가. 기존 표와 데이터는 그대로 (마이그레이션 테스트: tests/backup.test.ts)
    this.version(2).stores({ bodyweight: 'date' });
    // v3 (P5a): 진단 기록 표 (D-024). 기존 표와 데이터는 그대로
    this.version(3).stores({ diag: '++id, t' });
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

// ---------- 백업 (BLUEPRINT 4.6) ----------

/** 읽기 트랜잭션 하나로 읽어서, 읽는 도중 기록이 바뀌어도 서로 어긋나지 않게 */
export async function exportAll(db: WorkoutDB): Promise<BackupData> {
  return db.transaction('r', [db.routines, db.workouts, db.meta, db.custom, db.settings, db.bodyweight, db.diag], async () => {
    const [routines, workouts, meta, custom, settings, bodyweight, diagRows] = await Promise.all([
      db.routines.toArray(), db.workouts.toArray(), db.meta.toArray(), db.custom.toArray(), db.settings.toArray(), db.bodyweight.toArray(), db.diag.orderBy('id').toArray(),
    ]);
    const diag = diagRows.map(({ id: _id, ...e }) => e);
    return { routines, workouts, meta, custom: custom as unknown as Record<string, unknown>[], settings: settings as unknown as Record<string, unknown>[], bodyweight, diag };
  });
}
/** 백업으로 전부 바꾸기. 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않음 */
export async function importAll(db: WorkoutDB, d: BackupData, opts: { lastBackupAt?: string } = {}): Promise<void> {
  await db.transaction('rw', [db.routines, db.workouts, db.meta, db.custom, db.settings, db.bodyweight, db.diag], async () => {
    await Promise.all([db.routines.clear(), db.workouts.clear(), db.meta.clear(), db.custom.clear(), db.settings.clear(), db.bodyweight.clear(), db.diag.clear()]);
    await db.routines.bulkPut(d.routines);
    await db.workouts.bulkPut(d.workouts);
    await db.meta.bulkPut(d.meta as ExerciseMeta[]);
    await db.custom.bulkPut(d.custom as unknown as CustomExercise[]);
    const st = (d.settings as unknown as Settings[]).map((x) => (opts.lastBackupAt ? { ...x, lastBackupAt: opts.lastBackupAt } : x));
    if (!st.length && opts.lastBackupAt) st.push({ ...DEFAULT_SETTINGS, lastBackupAt: opts.lastBackupAt });
    await db.settings.bulkPut(st);
    await db.bodyweight.bulkPut(d.bodyweight);
    await db.diag.bulkAdd((d.diag ?? []).map(({ id: _id, ...e }: DiagEntry & { id?: number }) => e));
  });
}