import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { makeBackup, parseBackup, backupFileName, backupDue, BACKUP_SCHEMA } from '../src/core/backup';
import { WorkoutDB, exportAll, importAll, DEFAULT_SETTINGS } from '../src/db/db';
import { planToRoutine, startWorkout } from '../src/core/session';

const now = '2026-09-30T10:00:00.000Z';
const routine = planToRoutine('r1', '등', now, [{ kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 2, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 150, timeSec: 0 }], 1200);
const w = { ...startWorkout('w1', routine, now, []), endedAt: '2026-09-30T11:00:00.000Z' };
w.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true, memo: '좋음' };

async function seed(db: WorkoutDB) {
  await db.routines.put(routine);
  await db.workouts.put(w);
  await db.meta.put({ exerciseId: 'a', favorite: true, userGrade: 'A' });
  await db.custom.put({ id: 'custom_1', name_ko: '내 운동', family: 'custom_1', part: '가슴', muscles: ['가슴'], pattern: 'H_PUSH', mechanics: 'compound', equipment: ['machine'], custom: true, createdAt: now });
  await db.settings.put({ ...DEFAULT_SETTINGS, level: '상급' });
  await db.bodyweight.put({ date: '2026-09-30', kg: 72.5 });
}

describe('백업 파일', () => {
  it('내보내기 → 모두 지우기 → 가져오기: 왕복 100% 일치 (7.1 데이터 안전)', async () => {
    const db = new WorkoutDB(`bk-${Math.random()}`);
    await seed(db);
    const before = await exportAll(db);
    const file = makeBackup(before, '0.1.0', now);
    expect(file.counts).toEqual({ routines: 1, workouts: 1, meta: 1, custom: 1, settings: 1, bodyweight: 1 });
    const text = JSON.stringify(file);
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await db.workouts.count()).toBe(0);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await importAll(db, parsed.file.data);
    expect(await exportAll(db)).toEqual(before);
    db.close();
  });
  it('가져오기는 기존 데이터를 바꿈 (합치지 않음), 실패하면 아무것도 안 바뀜', async () => {
    const db = new WorkoutDB(`bk-${Math.random()}`);
    await seed(db);
    await db.workouts.put({ ...w, id: 'other' });
    const onlyOne = { ...(await exportAll(db)), workouts: [w] };
    await importAll(db, onlyOne);
    expect(await db.workouts.count()).toBe(1);
    const snapshot = await exportAll(db);
    await expect(importAll(db, { ...snapshot, workouts: [w, { ...w, id: undefined as unknown as string }] })).rejects.toThrow();
    expect(await exportAll(db)).toEqual(snapshot);
    db.close();
  });
  it('잘못된 파일은 거절하고 이유를 알려줌', () => {
    expect(parseBackup('not json')).toEqual({ ok: false, error: expect.stringContaining('JSON') });
    expect(parseBackup('{"app":"other"}')).toEqual({ ok: false, error: '이 앱의 백업 파일이 아니에요' });
    expect(parseBackup('{"app":"workout-app"}')).toEqual({ ok: false, error: '백업 형식 버전이 없어요' });
    expect(parseBackup(JSON.stringify({ app: 'workout-app', schema: BACKUP_SCHEMA + 1 }))).toMatchObject({ ok: false, error: expect.stringContaining('더 새 버전') });
    const base = makeBackup({ routines: [], workouts: [], meta: [], custom: [], settings: [], bodyweight: [] }, '0.1.0', now);
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, workouts: undefined } }))).toMatchObject({ ok: false, error: expect.stringContaining('깨졌') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, workouts: [{ id: 1 }] } }))).toMatchObject({ ok: false, error: expect.stringContaining('운동 기록') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, routines: [{ id: 'r' }] } }))).toMatchObject({ ok: false, error: expect.stringContaining('루틴') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, bodyweight: [{ date: 'x' }] } }))).toMatchObject({ ok: false, error: expect.stringContaining('체중') });
    expect(parseBackup(JSON.stringify(base)).ok).toBe(true);
  });
  it('파일 이름, 백업 알림 시점 (7일)', () => {
    expect(backupFileName(new Date(2026, 8, 30, 9, 5))).toBe('workout-backup-20260930-0905.json');
    const t = Date.parse(now);
    expect(backupDue(undefined, 0, t)).toBe(false);
    expect(backupDue(undefined, 1, t)).toBe(true);
    expect(backupDue('2026-09-24T10:00:00.000Z', 3, t)).toBe(false);
    expect(backupDue('2026-09-23T10:00:00.000Z', 3, t)).toBe(true);
  });
});

describe('저장소 버전 올리기 (v1 → v2): 기존 기록 유지 (AGENTS 규칙 8)', () => {
  it('v1으로 저장한 데이터가 v2에서 그대로, 체중 표 추가', async () => {
    const name = `mig-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ routines: 'id, updatedAt', workouts: 'id, startedAt, endedAt', meta: 'exerciseId', custom: 'id', settings: 'key' });
    await v1.table('routines').put(routine);
    await v1.table('workouts').put(w);
    await v1.table('meta').put({ exerciseId: 'a', favorite: true });
    await v1.table('settings').put({ key: 'main', level: '초보' });
    v1.close();
    const v2 = new WorkoutDB(name);
    expect(await v2.workouts.get('w1')).toEqual(w);
    expect(await v2.routines.get('r1')).toEqual(routine);
    expect((await v2.meta.get('a'))?.favorite).toBe(true);
    expect((await v2.settings.get('main'))?.level).toBe('초보');
    await v2.bodyweight.put({ date: '2026-09-30', kg: 70 });
    expect(await v2.bodyweight.count()).toBe(1);
    expect(v2.verno).toBe(2);
    v2.close();
  });
});
