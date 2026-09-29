/**
 * 백업 파일 (BLUEPRINT 4.6). 기기 안 데이터 전체를 JSON 한 파일로.
 * 형식이 바뀌면 schema를 올리고 migrateBackup에 변환을 추가한다 (예전 백업도 계속 가져올 수 있게).
 */
import type { Routine, Workout } from './session';

export const BACKUP_APP = 'workout-app';
export const BACKUP_SCHEMA = 1;

export interface BackupData {
  routines: Routine[];
  workouts: Workout[];
  meta: { exerciseId: string; favorite?: boolean; userGrade?: string; excluded?: boolean }[];
  custom: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  bodyweight: { date: string; kg: number }[];
}
export interface BackupFile { app: typeof BACKUP_APP; schema: number; appVersion: string; exportedAt: string; counts: Record<keyof BackupData, number>; data: BackupData }

export function makeBackup(data: BackupData, appVersion: string, now: string): BackupFile {
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length])) as BackupFile['counts'];
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, appVersion, exportedAt: now, counts, data };
}

export const backupFileName = (now: Date) =>
  `workout-backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; error: string };

/** 백업 파일 읽기와 검사. 이 앱의 파일이 아니거나, 더 새 버전이거나, 내용이 깨졌으면 거절 (기존 데이터는 건드리지 않음) */
export function parseBackup(text: string): ParseResult {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: '파일을 읽을 수 없어요 (JSON 형식이 아님)' }; }
  const f = j as Partial<BackupFile>;
  if (!f || typeof f !== 'object' || f.app !== BACKUP_APP) return { ok: false, error: '이 앱의 백업 파일이 아니에요' };
  if (typeof f.schema !== 'number') return { ok: false, error: '백업 형식 버전이 없어요' };
  if (f.schema > BACKUP_SCHEMA) return { ok: false, error: `더 새 버전 앱의 백업이에요 (형식 ${f.schema}). 앱을 먼저 업데이트해 주세요` };
  const migrated = migrateBackup(f as BackupFile);
  const d = migrated.data as Partial<BackupData> | undefined;
  const keys: (keyof BackupData)[] = ['routines', 'workouts', 'meta', 'custom', 'settings', 'bodyweight'];
  if (!d || keys.some((k) => !Array.isArray(d[k]))) return { ok: false, error: '백업 내용이 빠졌거나 깨졌어요' };
  const bad = d.workouts!.find((w) => !w || typeof w.id !== 'string' || typeof w.startedAt !== 'string' || !Array.isArray(w.blocks));
  if (bad) return { ok: false, error: '운동 기록 중 형식이 맞지 않는 항목이 있어요' };
  if (d.routines!.some((r) => !r || typeof r.id !== 'string' || !Array.isArray(r.blocks))) return { ok: false, error: '루틴 중 형식이 맞지 않는 항목이 있어요' };
  if (d.bodyweight!.some((b) => !b || typeof b.date !== 'string' || typeof b.kg !== 'number')) return { ok: false, error: '체중 기록 중 형식이 맞지 않는 항목이 있어요' };
  return { ok: true, file: migrated };
}

/** 예전 형식 → 현재 형식 (지금은 1뿐) */
export function migrateBackup(f: BackupFile): BackupFile {
  return f;
}

/** 백업 알림이 필요한지: 끝난 운동이 있고 마지막 백업이 7일(기본) 넘었거나 없음 */
export function backupDue(lastBackupAt: string | undefined, finishedWorkouts: number, nowMs: number, days = 7): boolean {
  if (!finishedWorkouts) return false;
  if (!lastBackupAt) return true;
  return nowMs - Date.parse(lastBackupAt) >= days * 86400000;
}
