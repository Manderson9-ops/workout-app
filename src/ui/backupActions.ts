/**
 * 백업 파일 저장·불러오기 (화면 동작, D-021).
 * 아이폰: 공유 시트로 "파일에 저장" (구글 드라이브 등). 공유 시트를 못 쓰면 다운로드.
 *
 * 아이폰 사파리는 "사용자가 방금 누른 뒤"에만 공유 시트를 열어 준다. 누른 뒤 저장소를 읽느라 기다리면
 * NotAllowedError가 날 수 있어서, 화면이 열릴 때 파일을 미리 만들어 두고(prepareBackup) 누르면 바로 공유한다.
 * 그래도 거절되면 만든 파일을 들고 있다가 "한 번 더 눌러 주세요"로 안내하고, 다음 탭에서 기다림 없이 공유한다.
 */
import { db, mutate, load, flushPending, getState } from './store';
import type { AppState } from './store';
import { exportAll, importAll, getSettings, clearAllLocal } from '../db/db';
import { makeBackup, backupFileName, parseBackup, mergedLastBackupAt } from '../core/backup';
import type { BackupFile } from '../core/backup';
import { APP_VERSION } from '../core/version';
import { diag, flushDiag, deviceInfo } from './diag';

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'retry';

let prepared: { file: File; state: AppState } | null = null;

/** 파일과, 그 파일이 담은 데이터 시점의 상태. 상태는 **읽기 전에** 잡는다 (읽는 도중 바뀌면 다음에 다시 만들도록: 검토 N2) */
async function build(): Promise<{ file: File; state: AppState }> {
  await flushPending();
  const state = getState();
  const now = new Date();
  await flushDiag();
  const data = makeBackup(await exportAll(db), APP_VERSION, now.toISOString(), deviceInfo());
  return { file: new File([JSON.stringify(data)], backupFileName(now), { type: 'application/json' }), state };
}

let preparing: Promise<void> | null = null;
/** 백업 버튼이 보이는 화면에서 미리 파일을 만들어 둠 (데이터가 바뀌면 다시 만듦, 동시에 하나만) */
export async function prepareBackup(): Promise<void> {
  if (prepared && prepared.state === getState()) return;
  if (preparing) return preparing;
  preparing = (async () => {
    try { prepared = await build(); } finally { preparing = null; }
  })();
  return preparing;
}
async function markBackedUp() {
  const st = await getSettings(db);
  await mutate((d) => d.settings.put({ ...st, key: 'main', lastBackupAt: new Date().toISOString() }));
}

function download(f: File) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function saveBackupFile(): Promise<SaveResult> {
  // 미리 만든 파일이 지금 데이터와 같으면 기다림 없이 바로 공유 (탭 직후 = 사파리가 허락하는 때)
  const f = prepared && prepared.state === getState() ? prepared.file : (await build()).file;
  prepared = null;
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f] }); // title을 넣으면 아이폰이 텍스트 파일을 하나 더 만드는 경우가 있어 파일만
      await markBackedUp(); diag('backup', { m: 'shared', ok: true });
      return 'shared';
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') { prepared = { file: f, state: getState() }; diag('backup', { m: 'NotAllowedError → 한 번 더', ok: false }); return 'retry'; }
      // 그 밖의 오류는 다운로드로
    }
  }
  download(f);
  await markBackedUp(); diag('backup', { m: 'downloaded', ok: true });
  return 'downloaded';
}

export const SAVE_MESSAGE: Record<SaveResult, string> = {
  shared: '백업 파일을 저장했어요',
  downloaded: '백업 파일을 내려받았어요. 파일 앱 → 다운로드 폴더를 확인하세요',
  cancelled: '저장을 취소했어요',
  retry: '준비됐어요. 버튼을 한 번 더 눌러 주세요',
};

export async function readBackupFile(file: File): Promise<{ ok: true; file: BackupFile } | { ok: false; error: string }> {
  return parseBackup(await file.text());
}

/** 백업으로 전체 교체 (한 트랜잭션, 실패하면 기존 데이터 그대로). 마지막 백업 시각은 더 최근 값을 유지 */
export async function restoreBackup(file: BackupFile): Promise<void> {
  await flushPending();
  const current = (await getSettings(db)).lastBackupAt;
  await flushDiag();
  await importAll(db, file.data, { lastBackupAt: mergedLastBackupAt(current, file) });
  prepared = null;
  await load();
}

/** 모든 데이터 지우기 (설정의 "초기화"). 백업 권고 후 두 번 확인한 다음에만 호출 */
export async function resetAll(): Promise<void> {
  await flushPending();
  await clearAllLocal(db);
  prepared = null;
  await load();
}
