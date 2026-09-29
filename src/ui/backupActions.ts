/**
 * 백업 파일 저장·불러오기 (화면 동작). 아이폰: 공유 시트로 "파일에 저장" (구글 드라이브 등), 안 되면 다운로드
 */
import { db, mutate, load } from './store';
import { exportAll, importAll, getSettings } from '../db/db';
import { makeBackup, backupFileName, parseBackup } from '../core/backup';
import type { BackupFile } from '../core/backup';
import { APP_VERSION } from '../core/version';

export async function saveBackupFile(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const now = new Date();
  const file = makeBackup(await exportAll(db), APP_VERSION, now.toISOString());
  const name = backupFileName(now);
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const f = new File([blob], name, { type: 'application/json' });
  let how: 'shared' | 'downloaded' | 'cancelled' = 'downloaded';
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: name }); how = 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; how = 'downloaded'; }
  }
  if (how === 'downloaded') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // 마지막 백업 시각 기록 (7일 알림)
  const st = await getSettings(db);
  await mutate((d) => d.settings.put({ ...st, key: 'main', lastBackupAt: now.toISOString() }));
  return how;
}

export async function readBackupFile(file: File): Promise<{ ok: true; file: BackupFile } | { ok: false; error: string }> {
  return parseBackup(await file.text());
}

/** 백업으로 전체 교체. 실패하면 기존 데이터 그대로 */
export async function restoreBackup(file: BackupFile): Promise<void> {
  await importAll(db, file.data);
  await load();
}
