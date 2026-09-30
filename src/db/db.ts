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
import { Clock, memoryClockStore } from '../core/hlc';
import { SYNC_TABLES, PK, stampValue, baseStamp, tombKey, withoutStamp } from '../core/syncStamp';
import type { SyncTable, Tomb } from '../core/syncStamp';

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
  tombs!: Table<Tomb, string>;
  /** 동기화 상태 등 기기 안 값 (since, epoch, 보관한 수정) */
  kv!: Table<{ k: string; v: unknown }, string>;
  /** 동기화 시계와 기기 ID (S2a). 테스트는 메모리 시계 */
  readonly clock: Clock;
  readonly dev: () => string;
  constructor(name = 'workout-app', opts: { clock?: Clock; deviceId?: () => string } = {}) {
    super(name);
    this.clock = opts.clock ?? new Clock(memoryClockStore());
    this.dev = opts.deviceId ?? (() => 'test');
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
    // v4 (S2a, D-029): 지움 표시 표 + 기존 기록에 동기화 표시(HLC 0, 아직 안 보냄). 기록 내용은 그대로
    this.version(4).stores({ tombs: 'k, table', kv: 'k' }).upgrade(async (tx) => {
      const dev = this.dev();
      for (const t of SYNC_TABLES) {
        await tx.table(t).toCollection().modify((v: Record<string, unknown>) => {
          // 옛 진행 중 운동은 이 기기 것 (주인 표시가 없으면 다른 기기가 자기 것으로 오해함)
          if (t === 'workouts' && !v.endedAt && !v.ownerDeviceId) { v.ownerDeviceId = dev; v.ownerAt = v.startedAt; }
          if (!v._s) v._s = { ...baseStamp(t, v, dev), remote: true };
        });
      }
    });
    // 모든 저장에 동기화 표시를 자동으로 붙임 (같은 트랜잭션, 빠뜨릴 곳 없음). 지우기는 softDelete로만
    const self = this;
    this.use({
      stack: 'dbcore', name: 'sync-stamp',
      create(down) {
        return {
          ...down,
          table(tableName: string) {
            const t = down.table(tableName);
            if (!(SYNC_TABLES as readonly string[]).includes(tableName)) return t;
            const pk = PK[tableName as SyncTable];
            return {
              ...t,
              async mutate(req) {
                if ((req.type === 'put' || req.type === 'add') && req.values) {
                  // put·add·bulkPut·update·modify 모두 값이 있으면 표시 (update/modify도 전체 값으로 옴)
                  const dev = self.dev();
                  const vals = req.values as Record<string, unknown>[];
                  const keys = vals.map((v) => v[pk]);
                  const olds = keys.some((k) => k !== undefined) ? await t.getMany({ trans: req.trans, keys: keys.map((k) => k ?? '\u0000') }) : [];
                  const values = vals.map((v, i) => stampValue(tableName, keys[i] === undefined ? undefined : olds[i], v, () => self.clock.tick(dev), dev));
                  return t.mutate({ ...req, values });
                }
                if (req.type === 'delete' || req.type === 'deleteRange') {
                  // 지우기는 지움 표시와 같은 트랜잭션에서만 (softDelete·불러오기·초기화·동기화 반영). 그 밖의 경로는 막음
                  const names = (req.trans as unknown as { objectStoreNames?: DOMStringList }).objectStoreNames;
                  if (names && !names.contains('tombs')) throw new Error(`${tableName}: 지우기는 softDelete로 (지움 표시)`);
                }
                return t.mutate(req);
              },
            };
          },
        };
      },
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

// ---------- 백업 (BLUEPRINT 4.6) ----------

/** 읽기 트랜잭션 하나로 읽어서, 읽는 도중 기록이 바뀌어도 서로 어긋나지 않게 */
export async function exportAll(db: WorkoutDB): Promise<BackupData> {
  return db.transaction('r', [db.routines, db.workouts, db.meta, db.custom, db.settings, db.bodyweight, db.diag], async () => {
    const [routines, workouts, meta, custom, settings, bodyweight, diagRows] = await Promise.all([
      db.routines.toArray(), db.workouts.toArray(), db.meta.toArray(), db.custom.toArray(), db.settings.toArray(), db.bodyweight.toArray(), db.diag.orderBy('id').toArray(),
    ]);
    const diag = diagRows.map(({ id: _id, ...e }) => e);
    // 동기화 표시(_s)는 기기 안 정보라 백업 파일에 넣지 않음
    const strip = <T,>(xs: T[]) => xs.map((x) => withoutStamp(x as never) as unknown as T);
    return { routines: strip(routines), workouts: strip(workouts), meta: strip(meta), custom: strip(custom) as unknown as Record<string, unknown>[], settings: strip(settings) as unknown as Record<string, unknown>[], bodyweight: strip(bodyweight), diag };
  });
}
/** 백업으로 전부 바꾸기. 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않음 */
export async function importAll(db: WorkoutDB, d: BackupData, opts: { lastBackupAt?: string } = {}): Promise<void> {
  await db.transaction('rw', [db.routines, db.workouts, db.meta, db.custom, db.settings, db.bodyweight, db.diag, db.tombs], async () => {
    await Promise.all([db.routines.clear(), db.workouts.clear(), db.meta.clear(), db.custom.clear(), db.settings.clear(), db.bodyweight.clear(), db.diag.clear(), db.tombs.clear()]);
    // 파일 안의 _s(동기화 표시)는 믿지 않고 떼어 냄 → 새로 표시(아직 안 보냄). 진행 중 운동은 이 기기가 주인
    const clean = <T,>(xs: T[]) => xs.map((x) => withoutStamp(x as never) as unknown as T);
    const me = db.dev(), at = new Date().toISOString();
    await db.routines.bulkPut(clean(d.routines));
    await db.workouts.bulkPut(clean(d.workouts).map((w) => (w.endedAt ? w : { ...w, ownerDeviceId: me, ownerAt: at })));
    await db.meta.bulkPut(clean(d.meta as ExerciseMeta[]));
    await db.custom.bulkPut(clean(d.custom as unknown as CustomExercise[]));
    const st = clean(d.settings as unknown as Settings[]).map((x) => (opts.lastBackupAt ? { ...x, lastBackupAt: opts.lastBackupAt } : x));
    if (!st.length && opts.lastBackupAt) st.push({ ...DEFAULT_SETTINGS, lastBackupAt: opts.lastBackupAt });
    await db.settings.bulkPut(st);
    await db.bodyweight.bulkPut(clean(d.bodyweight));
    await db.diag.bulkAdd((d.diag ?? []).map(({ id: _id, ...e }: DiagEntry & { id?: number }) => e));
  });
}

/**
 * 지우기 (S2a, D-029): 기록을 지우고 같은 트랜잭션에서 지움 표시를 남긴다 (다른 기기에 "지웠다"를 알리기 위해).
 * 동기화하는 표의 기록은 반드시 이 함수로만 지운다 (tests/syncStamp.test.ts 가 다른 곳의 직접 지우기를 찾아냄)
 */
export async function softDelete(db: WorkoutDB, table: SyncTable, id: string): Promise<void> {
  await db.transaction('rw', [db.table(table), db.tombs], async () => {
    const old = (await db.table(table).get(id)) as { _s?: Tomb['_s'] } | undefined;
    await db.table(table).delete(id);
    const dev = db.dev();
    const s: Tomb['_s'] = { h: db.clock.tick(dev), d: dev, q: (old?._s?.q ?? 0) + 1, y: 1 };
    const base = old?._s?.y === 1 ? old._s.b : old?._s?.r;
    if (base !== undefined) s.b = base;
    if (old?._s?.r !== undefined) s.r = old._s.r;
    await db.tombs.put({ k: tombKey(table, id), table, id, _s: s });
  });
}

/** 모든 데이터 지우기 (설정의 초기화): 동기화 전에는 이 기기만 비움 */
export async function clearAllLocal(db: WorkoutDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => { await Promise.all(db.tables.map((t) => t.clear())); });
}
