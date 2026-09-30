import { describe, it, expect, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { makeBackup, parseBackup } from '../src/core/backup';
import { summaryMd } from '../tools/sync_check';

const empty = { routines: [], workouts: [], meta: [], custom: [], settings: [], bodyweight: [], diag: [], feedback: [] };

/** 배포 경로가 base인 것처럼 appName을 다시 계산 (나머지 함수는 실제 것) */
const asApp = (base: string) => vi.doMock('../src/ui/appName', async (orig) => {
  const real = await orig<typeof import('../src/ui/appName')>();
  const APP = real.appFromBase(base);
  return { ...real, APP, DB_NAME: APP, IS_PREVIEW: APP !== 'workout-app' };
});

describe('미리 보기 판 제한 (S4, D-031)', () => {
  afterEach(() => { vi.doUnmock('../src/ui/appName'); vi.resetModules(); });

  it('미리 보기 판: 동기화 켜기·실행이 막히고, 드라이브로 보내기(자동·수동)도 안 함', async () => {
    vi.resetModules(); asApp('/workout-app-next/');
    const app = await import('../src/ui/appName');
    expect(app.APP).toBe('workout-app-next');
    expect(app.IS_PREVIEW).toBe(true);
    app.lsSet('sync.on', '1');
    const sync = await import('../src/ui/sync');
    expect(sync.syncEnabled()).toBe(false);
    await sync.enableSync();
    expect(sync.syncEnabled()).toBe(false);
    const send = await import('../src/ui/autoSend');
    app.lsSet('send.cfg', 'https://script.google.com/macros/s/x/exec#k');
    expect(await send.sendNow('manual')).toBe(false);
    expect(await send.sendNow('workout')).toBe(false);
  });
  it('본판: 저장된 켜짐 값대로 동기화 켜짐 (미리 보기 제한이 본판에 새지 않음)', async () => {
    vi.resetModules(); asApp('/workout-app/');
    const app = await import('../src/ui/appName');
    expect(app.IS_PREVIEW).toBe(false);
    app.lsSet('sync.on', '1');
    const sync = await import('../src/ui/sync');
    expect(sync.syncEnabled()).toBe(true);
  });
  it('미리 보기 판에서 만든 백업에는 표시가 붙고, 불러올 때 그대로 남으며, PC 검사 요약에 경고', () => {
    const f = makeBackup(empty, '0.6.0', '2026-09-30T10:00:00.000Z', { id: 'ab12', label: 'x' }, true);
    expect(f.preview).toBe(true);
    const r = parseBackup(JSON.stringify(f));
    expect(r.ok && r.file.preview).toBe(true);
    expect(summaryMd('a.json', r.ok ? r.file : (null as never))).toContain('미리 보기 판');
    const main = makeBackup(empty, '0.6.0', '2026-09-30T10:00:00.000Z');
    expect('preview' in main).toBe(false);
    expect(parseBackup(JSON.stringify({ ...main, preview: 'yes' })).ok).toBe(false);
  });
});
