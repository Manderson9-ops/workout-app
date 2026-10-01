/**
 * 백업 파일 (BLUEPRINT 4.6, D-021). 기기 안 데이터 전체를 JSON 한 파일로.
 * 형식이 바뀌면 schema를 올리고 migrateBackup에 변환을 추가한다 (예전 백업도 계속 가져올 수 있게).
 * 불러오기는 전체 교체라서, 깨진 파일이 기존 데이터를 지우지 않도록 **항목 하나하나까지** 검사한다.
 */
import type { Routine, Workout } from './session';
import { PARTS, EQUIPMENT, PATTERNS } from './types.ts';
import { diagEntryOk, DIAG_MAX } from './diag.ts';
import type { DiagEntry } from './diag.ts';
import { feedbackOk } from './feedback.ts';
import type { Feedback } from './feedback.ts';

export const BACKUP_APP = 'workout-app';
/** 1: P4 첫 형식. 2: 진단 기록(diag) 추가 (D-026). 3: 개선 메모(feedback) 추가 (S3) */
export const BACKUP_SCHEMA = 3;

export interface BackupData {
  routines: Routine[];
  workouts: Workout[];
  meta: { exerciseId: string; favorite?: boolean; userGrade?: string; excluded?: boolean }[];
  custom: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  bodyweight: { date: string; kg: number }[];
  /** 진단 기록 (schema 2, D-024). 운동 내용·입력값 없음 */
  diag: DiagEntry[];
  /** 개선 메모 (schema 3, S3) */
  feedback: Feedback[];
}
export const BACKUP_KEYS: (keyof BackupData)[] = ['routines', 'workouts', 'meta', 'custom', 'settings', 'bodyweight', 'diag', 'feedback'];
/** device: 만든 기기 (진단의 기기 ID와 이름, 예: iPhone · Safari 26.0). 비밀 값은 절대 넣지 않음 (D-025) */
/** preview: 미리 보기 판(workout-app-next)에서 만든 파일 (D-031). 본판에서 불러올 때 경고, PC 검사에 표시 */
export interface BackupFile { app: typeof BACKUP_APP; schema: number; appVersion: string; exportedAt: string; preview?: true; device?: { id: string; label: string }; counts: Record<keyof BackupData, number>; data: BackupData }

export const countsOf = (data: BackupData) => Object.fromEntries(BACKUP_KEYS.map((k) => [k, data[k].length])) as BackupFile['counts'];

export function makeBackup(data: BackupData, appVersion: string, now: string, device?: { id: string; label: string }, preview = false): BackupFile {
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, appVersion, exportedAt: now, ...(preview ? { preview: true as const } : {}), ...(device ? { device } : {}), counts: countsOf(data), data };
}

export const backupFileName = (now: Date) =>
  `workout-backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; error: string };

// ---------- 검사 도우미 ----------
type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown) => v === undefined || (num(v) && (v as number) >= 0);
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';
/** 날짜+시각 (예: 2026-09-30T10:00:00.000Z). '2026'처럼 년도만 있는 값은 거절 */
const isoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const optIso = (v: unknown) => v === undefined || isoDate(v);
/** 실제 있는 날짜만 (2026-02-31 거절) */
const ymd = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number); const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
};
const KINDS = ['single', 'superset', 'compound'];
const TIMER_KINDS = ['set', 'transition', 'round', 'between', 'warmup'];
const GRADES = ['S', 'A', 'B', 'C', 'D'];
const LEVELS = ['초보', '중급', '상급'];
const restOk = (b: O) => num(b.restSec) && num(b.roundRestSec) && num(b.transitionSec) && (b.restSec as number) >= 0;

function setOk(s: unknown): boolean {
  return isObj(s) && typeof s.warmup === 'boolean' && typeof s.done === 'boolean' && optNum(s.weight) && optNum(s.reps) && optNum(s.seconds) && optNum(s.rir)
    && optIso(s.doneAt) && optBool(s.auto) && optStr(s.memo);
}
function workoutOk(w: unknown): boolean {
  if (!isObj(w) || !str(w.id) || !str(w.name) || !isoDate(w.startedAt) || !optIso(w.endedAt) || !Array.isArray(w.blocks) || !optStr(w.memo) || !optNum(w.plannedSec) || !optStr(w.ownerDeviceId) || !optIso(w.ownerAt) || !optStr(w.pendingMerge) || !optNum(w.ownerSeq) || !optIso(w.editedAt)) return false;
  if (w.timer !== null && w.timer !== undefined && !(isObj(w.timer) && num(w.timer.startedAt) && num(w.timer.endsAt) && TIMER_KINDS.includes(w.timer.kind as string))) return false;
  return w.blocks.every((b) => isObj(b) && KINDS.includes(b.kind as string) && restOk(b) && Array.isArray(b.items)
    && b.items.every((i) => isObj(i) && str(i.exerciseId) && isObj(i.target) && num(i.target.sets) && num(i.target.reps) && optNum(i.target.seconds)
      && Array.isArray(i.sets) && i.sets.every(setOk) && optBool(i.skipped) && optStr(i.memo)));
}
function routineOk(r: unknown): boolean {
  return isObj(r) && str(r.id) && typeof r.name === 'string' && isoDate(r.createdAt) && isoDate(r.updatedAt) && optNum(r.estimatedSec) && optNum(r.warmupSec) && optStr(r.note)
    && Array.isArray(r.blocks) && r.blocks.every((b) => isObj(b) && KINDS.includes(b.kind as string) && restOk(b) && Array.isArray(b.items)
      && b.items.every((i) => isObj(i) && str(i.exerciseId) && num(i.sets) && (i.sets as number) >= 1 && num(i.reps) && optNum(i.seconds)));
}
const metaOk = (m: unknown) => isObj(m) && str(m.exerciseId) && optBool(m.favorite) && optBool(m.excluded) && (m.userGrade === undefined || GRADES.includes(m.userGrade as string));
const customOk = (c: unknown) => isObj(c) && str(c.id) && str(c.name_ko) && typeof c.family === 'string' && PARTS.includes(c.part as never)
  && Array.isArray(c.muscles) && PATTERNS.includes(c.pattern as never) && (c.mechanics === 'compound' || c.mechanics === 'isolation')
  && Array.isArray(c.equipment) && c.equipment.length > 0 && c.equipment.every((e) => EQUIPMENT.includes(e as never)) && c.custom === true && isoDate(c.createdAt);
function settingsOk(s: unknown): boolean {
  if (!isObj(s) || s.key !== 'main') return false;
  const r = s.rest;
  return (s.level === undefined || LEVELS.includes(s.level as string))
    && (s.equipment === undefined || (Array.isArray(s.equipment) && s.equipment.every((e) => EQUIPMENT.includes(e as never))))
    && (s.defaultParts === undefined || (Array.isArray(s.defaultParts) && s.defaultParts.every((p) => PARTS.includes(p as never))))
    && (s.homeHidden === undefined || (Array.isArray(s.homeHidden) && s.homeHidden.every((x) => typeof x === 'string')))
    && optNum(s.defaultMinutes) && optBool(s.soundOn) && optBool(s.keepAwake) && optBool(s.storageNoticeSeen) && optIso(s.lastBackupAt)
    && (r === undefined || (isObj(r) && ['compound', 'isolation', 'round', 'between', 'transition'].every((k) => num(r[k]) && (r[k] as number) >= 0)));
}
const bwOk = (b: unknown) => isObj(b) && ymd(b.date) && num(b.kg) && (b.kg as number) >= BW_MIN && (b.kg as number) <= BW_MAX;
export const BW_MIN = 20;
export const BW_MAX = 300;

const unique = (xs: unknown[], key: string) => new Set(xs.map((x) => (x as O)[key])).size === xs.length;

/** 백업 파일 읽기와 검사. 이 앱의 파일이 아니거나, 더 새 버전이거나, 내용이 하나라도 깨졌으면 거절 (기존 데이터는 건드리지 않음) */
export function parseBackup(text: string): ParseResult {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: '파일을 읽을 수 없어요 (JSON 형식이 아님)' }; }
  if (!isObj(j) || j.app !== BACKUP_APP) return { ok: false, error: '이 앱의 백업 파일이 아니에요' };
  if (typeof j.schema !== 'number') return { ok: false, error: '백업 형식 버전이 없어요' };
  if (j.schema > BACKUP_SCHEMA) return { ok: false, error: `더 새 버전 앱의 백업이에요 (형식 ${j.schema}). 앱을 먼저 업데이트해 주세요` };
  if (!isoDate(j.exportedAt)) return { ok: false, error: '백업 날짜가 없거나 잘못됐어요' };
  const f = migrateBackup(j as unknown as BackupFile);
  const d = f.data as unknown;
  if (!isObj(d) || BACKUP_KEYS.some((k) => !Array.isArray(d[k]))) return { ok: false, error: '백업 내용이 빠졌거나 깨졌어요' };
  const data = d as unknown as BackupData;
  // 파일에 적힌 개수와 실제 개수가 다르면 중간이 잘린 파일
  if (isObj(f.counts) && BACKUP_KEYS.some((k) => f.counts[k] !== undefined && f.counts[k] !== data[k].length)) return { ok: false, error: '백업 파일이 중간에 잘렸거나 바뀌었어요 (개수가 맞지 않음)' };
  const checks: [keyof BackupData, (x: unknown) => boolean, string, string | null][] = [
    ['workouts', workoutOk, '운동 기록', 'id'], ['routines', routineOk, '루틴', 'id'], ['meta', metaOk, '운동 표시(즐겨찾기 등)', 'exerciseId'],
    ['custom', customOk, '직접 추가한 운동', 'id'], ['settings', settingsOk, '설정', 'key'], ['bodyweight', bwOk, '체중 기록', 'date'], ['diag', diagEntryOk, '진단 기록', null], ['feedback', feedbackOk, '개선 메모', 'id'],
  ];
  for (const [k, ok, label, key] of checks) {
    const bad = data[k].findIndex((x) => !ok(x));
    if (bad >= 0) return { ok: false, error: `${label} 중 형식이 맞지 않는 항목이 있어요 (${bad + 1}번째)` };
    if (key && !unique(data[k], key)) return { ok: false, error: `${label} 중 같은 항목이 두 번 들어 있어요` };
  }
  if (data.settings.length > 1) return { ok: false, error: '설정이 두 개 들어 있어요' };
  if (data.diag.length > DIAG_MAX * 2) return { ok: false, error: '진단 기록이 너무 많아요' };
  if (f.preview !== undefined && f.preview !== true) return { ok: false, error: '미리 보기 표시가 잘못됐어요' };
  if (f.device !== undefined && !(isObj(f.device) && str(f.device.id) && (f.device.id as string).length <= 12 && typeof f.device.label === 'string' && (f.device.label as string).length <= 80)) return { ok: false, error: '기기 정보가 잘못됐어요' };
  if (data.workouts.filter((w) => !w.endedAt).length > 1) return { ok: false, error: '진행 중인 운동이 두 개 들어 있어요' };
  return { ok: true, file: { ...f, counts: countsOf(data), data } };
}

/** 예전 형식 → 현재 형식. 1 → 2: 진단 기록 빈 목록. 2 → 3: 개선 메모 빈 목록 */
export function migrateBackup(f: BackupFile): BackupFile {
  let out = f;
  if (out.schema < 2 && isObj(out.data)) out = { ...out, schema: 2, data: { ...out.data, diag: Array.isArray((out.data as Partial<BackupData>).diag) ? out.data.diag : [] } };
  if (out.schema < 3 && isObj(out.data)) out = { ...out, schema: 3, data: { ...out.data, feedback: Array.isArray((out.data as Partial<BackupData>).feedback) ? out.data.feedback : [] } };
  return out;
}

/** 불러오기 뒤 마지막 백업 시각: 지금 기기 값, 파일 안 값, 파일을 만든 시각 중 가장 최근 (복원했다고 7일 알림이 다시 뜨지 않게) */
export function mergedLastBackupAt(current: string | undefined, file: BackupFile): string {
  const inFile = (file.data.settings[0] as { lastBackupAt?: string } | undefined)?.lastBackupAt;
  return [current, inFile, file.exportedAt].filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
}

/** 백업 알림이 필요한지: 끝난 운동이 있고 마지막 백업이 7일(기본) 넘었거나 없음 */
export function backupDue(lastBackupAt: string | undefined, finishedWorkouts: number, nowMs: number, days = 7): boolean {
  if (!finishedWorkouts) return false;
  if (!lastBackupAt) return true;
  return nowMs - Date.parse(lastBackupAt) >= days * 86400000;
}
