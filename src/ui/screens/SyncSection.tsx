import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { useSyncStatus, syncEnabled, enableSync, disableSync, syncNow, answerConflicts, reuploadStash, discardStash, syncErrorText } from '../sync';
import { getSendConfig } from '../autoSend';
import { saveBackupFile, SAVE_MESSAGE } from '../backupActions';
import { tombKey } from '../../core/syncStamp';

const ago = (t?: string) => {
  if (!t) return '아직 없음';
  const s = Math.round((Date.now() - Date.parse(t)) / 1000);
  return s < 60 ? '방금' : s < 3600 ? `${Math.round(s / 60)}분 전` : new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** 화면 위 작은 동기화 상태 (켜져 있을 때만) */
export function SyncBadge() {
  const st = useSyncStatus();
  if (st.phase === 'off') return null;
  const text = st.phase === 'syncing' ? '동기화 중…' : st.phase === 'error' ? `동기화 안 됨 · ${syncErrorText(st.error)}` : st.pending ? `보낼 것 ${st.pending}건` : `동기화됨 · ${ago(st.lastOkAt)}`;
  return (
    <div role="status" aria-label="동기화 상태" class="small" style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 2px)', right: '8px', zIndex: 25, padding: '2px 8px', borderRadius: '10px', background: 'var(--card2)', color: st.phase === 'error' ? 'var(--warn)' : 'var(--sub)', pointerEvents: 'none' }}>
      {st.phase === 'error' ? '⚠ ' : '⇅ '}{text}
    </div>
  );
}

/** 설정: PC ↔ 폰 동기화 (D-027). 연결 마법사: ① 백업 ② 받기 ③ 비교 ④ 고르기 ⑤ 올리기 */
export function SyncSection({ s }: { s: AppState }) {
  const st = useSyncStatus();
  const [on, setOn] = useState(syncEnabled());
  const [step, setStep] = useState<'idle' | 'backup' | 'go'>('idle');
  const [msg, setMsg] = useState('');
  const cfg = getSendConfig();
  const [picks, setPicks] = useState<Record<string, 'local' | 'server'>>({});
  void s;
  return (
    <div class="card" aria-label="PC와 폰 동기화">
      <strong>PC ↔ 폰 동기화</strong>
      <p class="sub small">루틴·기록·체중·설정을 PC와 폰이 자동으로 맞춰요. 인터넷이 없어도 각자 쓰다가 연결되면 맞춰져요. 기록은 내 구글 드라이브(WORK_OUT_APP\sync\db)에만 저장돼요.</p>
      {!cfg && <p class="small" style={{ color: 'var(--warn)' }}>먼저 위 "자동 보내기"에 연결 설정(주소#키)을 붙여넣어 주세요. 같은 설정을 써요.</p>}
      {cfg && !on && step === 'idle' && (
        <>
          <p class="small">처음 연결할 때는 <strong>기록이 많은 기기(보통 폰)부터</strong> 연결하세요.</p>
          <button class="primary" onClick={() => setStep('backup')}>동기화 연결하기</button>
        </>
      )}
      {cfg && !on && step === 'backup' && (
        <>
          <p class="small">① 안전을 위해 지금 기록을 백업 파일로 먼저 저장해요.</p>
          <div class="row wrap">
            <button class="primary" onClick={async () => { const r = await saveBackupFile(); setMsg(SAVE_MESSAGE[r]); if (r === 'shared' || r === 'downloaded') setStep('go'); }}>백업 파일 저장</button>
            <button onClick={() => setStep('go')}>이미 저장했어요</button>
          </div>
        </>
      )}
      {cfg && !on && step === 'go' && (
        <>
          <p class="small">② 서버 기록을 먼저 받아 이 기기 것과 비교하고, 다른 게 있으면 고르게 한 뒤 ③ 이 기기 기록을 올려요.</p>
          <button class="primary" onClick={async () => { setOn(true); setStep('idle'); await enableSync(); setMsg('연결했어요'); }}>연결 시작</button>
        </>
      )}
      {st.conflicts && (
        <div role="dialog" aria-label="다른 내용 고르기" class="card" style={{ margin: '8px 0' }}>
          <p class="small"><strong>같은 기록인데 내용이 달라요.</strong> 어느 쪽을 남길까요?</p>
          {st.conflicts.map((c) => {
            const k = tombKey(c.table, c.id);
            const p = picks[k] ?? 'local';
            return (
              <div key={k} class="row between small" style={{ minHeight: '44px' }}>
                <span>{c.table === 'settings' ? '설정' : c.table === 'routines' ? `루틴 「${c.label}」` : c.table === 'workouts' ? `운동 「${c.label}」` : `${c.label}`}</span>
                <span class="row">
                  <button class={`chip ${p === 'local' ? 'on' : ''}`} aria-pressed={p === 'local'} onClick={() => setPicks({ ...picks, [k]: 'local' })}>이 기기</button>
                  <button class={`chip ${p === 'server' ? 'on' : ''}`} aria-pressed={p === 'server'} onClick={() => setPicks({ ...picks, [k]: 'server' })}>서버</button>
                </span>
              </div>
            );
          })}
          <button class="primary" onClick={() => answerConflicts(Object.fromEntries(st.conflicts!.map((c) => [tombKey(c.table, c.id), picks[tombKey(c.table, c.id)] ?? 'local'])))}>이대로 합치기</button>
        </div>
      )}
      {on && (
        <>
          <p class="small">{st.phase === 'syncing' ? '동기화 중…' : st.phase === 'error' ? `⚠ ${syncErrorText(st.error)}` : `동기화됨 · ${ago(st.lastOkAt)}`}{st.pending ? ` · 보낼 것 ${st.pending}건` : ''}</p>
          <div class="row wrap">
            <button class="primary" disabled={st.phase === 'syncing'} onClick={() => void syncNow('manual')}>지금 동기화</button>
            <button class="danger" onClick={async () => { if (confirm('동기화를 끌까요? 이 기기 기록은 그대로 남아요.')) { await disableSync(); setOn(false); } }}>끄기</button>
          </div>
        </>
      )}
      {st.stash > 0 && (
        <div class="card" role="alert" style={{ margin: '8px 0' }}>
          <p class="small">서버 기록이 예전 상태로 되돌려졌어요. 이 기기에만 있던 수정 {st.stash}건이 따로 보관돼 있어요.</p>
          <div class="row wrap">
            <button class="primary" onClick={() => void reuploadStash()}>다시 올리기</button>
            <button onClick={async () => { if (confirm('보관한 수정을 버릴까요?')) await discardStash(); }}>버리기</button>
          </div>
        </div>
      )}
      {msg && <p role="status" class="small">{msg}</p>}
    </div>
  );
}
