import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { activeOf } from '../store';
import { saveBackupFile, readBackupFile, restoreBackup, resetAll, prepareBackup, SAVE_MESSAGE } from '../backupActions';

/** 설정의 "데이터 백업" 영역 (BLUEPRINT 4.6, D-021) */
export function BackupSection({ s }: { s: AppState }) {
  const st = s.settings;
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 누르자마자 공유 시트를 열 수 있게 파일을 미리 만들어 둠 (아이폰 사파리 제약)
  useEffect(() => { void prepareBackup().catch(() => undefined); }, [s]);
  const active = activeOf(s);

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
    if (!f) return;
    const r = await readBackupFile(f);
    if (!r.ok) { setMsg({ text: `불러오지 못했어요: ${r.error}. 지금 데이터는 그대로예요`, ok: false }); return; }
    const c = r.file.counts;
    const warnActive = active ? `\n\n⚠ 진행 중인 운동("${active.name}")도 사라져요.` : '';
    if (!confirm(`${new Date(r.file.exportedAt).toLocaleString('ko-KR')} 백업으로 바꿀까요?\n운동 기록 ${c.workouts}개, 루틴 ${c.routines}개, 체중 ${c.bodyweight}개\n\n지금 이 폰의 데이터는 모두 이 백업으로 바뀌어요 (합치지 않음). 먼저 "백업 파일 저장"으로 지금 데이터를 저장해 두는 것을 권해요.${warnActive}`)) return;
    try { await restoreBackup(r.file); setMsg({ text: '백업을 불러왔어요', ok: true }); }
    catch { setMsg({ text: '불러오는 중 문제가 생겨 아무것도 바꾸지 않았어요', ok: false }); }
  };

  return (
    <>
      <h2>데이터 백업</h2>
      <p class="sub small">운동 기록은 이 아이폰 안에만 저장돼요. 홈 화면 아이콘을 지우거나 폰을 바꾸면 사라지니 백업 파일을 가끔 저장하세요. 공유 → "파일에 저장" → 구글 드라이브를 고르면 PC에서도 볼 수 있어요.</p>
      <p class="small">마지막 백업: {st.lastBackupAt ? new Date(st.lastBackupAt).toLocaleString('ko-KR') : '없음'}</p>
      <div class="row wrap">
        <button class="primary" onClick={async () => { const r = await saveBackupFile(); setMsg({ text: SAVE_MESSAGE[r], ok: r !== 'cancelled' }); }}>백업 파일 저장</button>
        <button onClick={() => fileRef.current?.click()}>백업 불러오기</button>
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label="백업 파일 고르기" tabIndex={-1} style={{ display: 'none' }} onChange={onFile} />
      </div>
      {msg && <p role="status" class="small" style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)' }}>{msg.text}</p>}
      <details style={{ marginTop: '10px' }}>
        <summary class="small sub" style={{ minHeight: '44px', display: 'flex', alignItems: 'center' }}>모든 데이터 지우기 (초기화)</summary>
        <p class="small">운동 기록·루틴·체중·설정이 모두 지워지고 되돌릴 수 없어요. 먼저 백업 파일을 저장하세요.</p>
        <button class="danger" onClick={async () => {
          if (!confirm('정말 모든 데이터를 지울까요? 되돌릴 수 없어요.')) return;
          if (!confirm('마지막 확인: 백업 파일을 저장해 두셨나요? 지우기를 계속할까요?')) return;
          await resetAll(); setMsg({ text: '모든 데이터를 지웠어요', ok: true });
        }}>모든 데이터 지우기</button>
      </details>
    </>
  );
}

/** 홈의 7일 백업 알림 (결과도 여기서 보여 줌) */
export function BackupBanner({ s }: { s: AppState }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void prepareBackup().catch(() => undefined); }, [s]);
  return (
    <div class="card" role="note" aria-label="백업 알림">
      <div class="row between">
        <span class="small">{s.settings.lastBackupAt ? '마지막 백업 후 7일이 지났어요' : '아직 백업한 적이 없어요'}</span>
        <button class="primary" onClick={async () => { const r = await saveBackupFile(); setMsg(SAVE_MESSAGE[r]); }}>지금 백업</button>
      </div>
      {msg && <p role="status" class="small">{msg}</p>}
    </div>
  );
}