import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { makeBackup, parseBackup, backupFileName, backupDue, mergedLastBackupAt, BACKUP_SCHEMA } from '../src/core/backup';
import { WorkoutDB, exportAll, importAll, DEFAULT_SETTINGS, clearAllLocal } from '../src/db/db';
import { planToRoutine, startWorkout } from '../src/core/session';
import { withoutStamp } from '../src/core/syncStamp';

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
  await db.diag.add({ t: now, k: 'timer', d: 'ab12', v: 120 });
}

describe('백업 파일', () => {
  it('내보내기 → 모두 지우기 → 가져오기: 왕복 100% 일치 (7.1 데이터 안전)', async () => {
    const db = new WorkoutDB(`bk-${Math.random()}`);
    await seed(db);
    const before = await exportAll(db);
    const file = makeBackup(before, '0.1.0', now);
    expect(file.counts).toEqual({ routines: 1, workouts: 1, meta: 1, custom: 1, settings: 1, bodyweight: 1, diag: 1 });
    const text = JSON.stringify(file);
    await clearAllLocal(db);
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
    const base = makeBackup({ routines: [], workouts: [], meta: [], custom: [], settings: [], bodyweight: [], diag: [] }, '0.1.0', now);
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, workouts: undefined } }))).toMatchObject({ ok: false, error: expect.stringContaining('깨졌') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, workouts: [{ id: 1 }] }, counts: undefined }))).toMatchObject({ ok: false, error: expect.stringContaining('운동 기록') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, routines: [{ id: 'r' }] }, counts: undefined }))).toMatchObject({ ok: false, error: expect.stringContaining('루틴') });
    expect(parseBackup(JSON.stringify({ ...base, data: { ...base.data, bodyweight: [{ date: 'x' }] }, counts: undefined }))).toMatchObject({ ok: false, error: expect.stringContaining('체중') });
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
    // 기록 내용은 그대로 (v4부터 동기화 표시 _s가 붙음: tests/syncStamp.test.ts)
    expect(withoutStamp((await v2.workouts.get('w1')) as never)).toEqual(w);
    expect(withoutStamp((await v2.routines.get('r1')) as never)).toEqual(routine);
    expect((await v2.meta.get('a'))?.favorite).toBe(true);
    expect((await v2.settings.get('main'))?.level).toBe('초보');
    await v2.bodyweight.put({ date: '2026-09-30', kg: 70 });
    expect(await v2.bodyweight.count()).toBe(1);
    expect(v2.verno).toBe(4);
    v2.close();
  });
});

describe('깊은 검사: 깨진 백업이 기존 데이터를 지우지 않게 (검토 M1)', () => {
  const good = () => makeBackup({ routines: [routine], workouts: [w], meta: [{ exerciseId: 'a', favorite: true }], custom: [], settings: [{ ...DEFAULT_SETTINGS }], bodyweight: [{ date: '2026-09-30', kg: 72 }], diag: [] }, '0.2.0', now);
  const bad = (mut: (f: ReturnType<typeof good>) => void) => { const f = JSON.parse(JSON.stringify(good())); mut(f); f.counts = undefined; return parseBackup(JSON.stringify(f)); };
  it('정상 파일은 통과, 개수는 실제 길이로 다시 셈', () => {
    const r = parseBackup(JSON.stringify(good()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.counts).toEqual({ routines: 1, workouts: 1, meta: 1, custom: 0, settings: 1, bodyweight: 1, diag: 0 });
  });
  it.each([
    ['블록이 빈 객체', (f: any) => { f.data.workouts[0].blocks = [{}]; }, '운동 기록'],
    ['시작 시각이 날짜 아님', (f: any) => { f.data.workouts[0].startedAt = 'nope'; }, '운동 기록'],
    ['세트 무게가 문자열', (f: any) => { f.data.workouts[0].blocks[0].items[0].sets[0].weight = '60'; }, '운동 기록'],
    ['세트 배열 없음', (f: any) => { delete f.data.workouts[0].blocks[0].items[0].sets; }, '운동 기록'],
    ['타이머 종류 이상', (f: any) => { f.data.workouts[0].timer = { startedAt: 1, endsAt: 2, kind: 'x', label: '' }; }, '운동 기록'],
    ['루틴 세트 0', (f: any) => { f.data.routines[0].blocks[0].items[0].sets = 0; }, '루틴'],
    ['직접 추가 운동 필수값 없음', (f: any) => { f.data.custom = [{ foo: 1 }]; }, '직접 추가한 운동'],
    ['설정 휴식이 숫자 아님', (f: any) => { f.data.settings[0].rest = 5; }, '설정'],
    ['설정 key 다름', (f: any) => { f.data.settings[0].key = 'other'; }, '설정'],
    ['등급이 목록 밖', (f: any) => { f.data.meta[0].userGrade = 'Z'; }, '운동 표시'],
    ['체중 범위 밖', (f: any) => { f.data.bodyweight[0].kg = 700; }, '체중'],
    ['체중 날짜 형식', (f: any) => { f.data.bodyweight[0].date = '2026/9/30'; }, '체중'],
    ['같은 운동 기록 두 번', (f: any) => { f.data.workouts.push(f.data.workouts[0]); }, '두 번'],
    ['진행 중 운동 두 개', (f: any) => { f.data.workouts = [{ ...f.data.workouts[0], id: 'x', endedAt: undefined }, { ...f.data.workouts[0], id: 'y', endedAt: undefined }]; }, '진행 중'],
    ['백업 날짜 없음', (f: any) => { delete f.exportedAt; }, '백업 날짜'],
    ['시작 시각이 년도만', (f: any) => { f.data.workouts[0].startedAt = '2026'; }, '운동 기록'],
    ['없는 날짜 체중', (f: any) => { f.data.bodyweight[0].date = '2026-02-31'; }, '체중'],
  ])('%s → 거절', (_n, mut, msg) => {
    expect(bad(mut)).toMatchObject({ ok: false, error: expect.stringContaining(msg) });
  });
  it('개수가 파일에 적힌 것과 다르면 잘린 파일로 보고 거절', () => {
    const f = good(); f.counts.workouts = 5;
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false, error: expect.stringContaining('잘렸') });
  });
});

describe('불러오기 뒤 마지막 백업 시각 (검토 M2)', () => {
  it('지금 값·파일 값·파일 만든 시각 중 가장 최근', () => {
    const f = makeBackup({ routines: [], workouts: [], meta: [], custom: [], settings: [{ ...DEFAULT_SETTINGS, lastBackupAt: '2026-09-01T00:00:00.000Z' }], bodyweight: [], diag: [] }, '0.2.0', '2026-09-20T00:00:00.000Z');
    expect(mergedLastBackupAt('2026-09-25T00:00:00.000Z', f)).toBe('2026-09-25T00:00:00.000Z');
    expect(mergedLastBackupAt(undefined, f)).toBe('2026-09-20T00:00:00.000Z');
  });
  it('importAll이 설정을 바꿔도 마지막 백업 시각은 넘겨준 값', async () => {
    const db = new WorkoutDB(`bk-${Math.random()}`);
    await seed(db);
    const d = await exportAll(db);
    await importAll(db, { ...d, settings: [{ ...DEFAULT_SETTINGS }] }, { lastBackupAt: '2026-09-29T00:00:00.000Z' });
    expect((await db.settings.get('main'))?.lastBackupAt).toBe('2026-09-29T00:00:00.000Z');
    await importAll(db, { ...d, settings: [] }, { lastBackupAt: '2026-09-29T00:00:00.000Z' });
    expect((await db.settings.get('main'))?.lastBackupAt).toBe('2026-09-29T00:00:00.000Z');
    db.close();
  });
});