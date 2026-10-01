import { useState } from 'preact/hooks';
import { getSendConfig, saveSendConfig, clearSendConfig, pingSend, sendNow, lastSentAt, hasPending, useSendState, getSendState, retryBlocked, blockedReason } from '../autoSend';
import { maskKey } from '../../core/autoSendConfig';
import { IS_PREVIEW } from '../appName';
import { askConfirm } from '../confirm';

const when = (t?: string) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '없음');

/** 홈: 운동 종료 뒤 자동 보내기 결과 (보내는 동안 앱을 닫지 않도록 안내) */
export function SendStatus() {
  const st = useSendState();
  if (st.phase === 'idle') return null;
  const text = st.phase === 'sending' ? 'PC로 보내는 중… 잠시 앱을 닫지 마세요'
    : st.phase === 'sent' ? `PC로 보냄 ✓ (${when(st.at)})`
    : `PC로 못 보냈어요: ${st.error}. 다음에 앱을 열 때 다시 보내요`;
  return <p role="status" aria-label="PC로 보내기 상태" class="card small" style={{ color: st.phase === 'failed' ? 'var(--warn)' : st.phase === 'sent' ? 'var(--ok)' : 'var(--text)' }}>{text}</p>;
}

/** 설정: 자동 보내기 (D-023). 설정 글은 이 기기에만 저장, 화면엔 키 끝 4자리만 (D-025) */
export function AutoSendSection() {
  if (IS_PREVIEW) return <><h2>자동 보내기</h2><p class="sub small">미리 보기 판은 PC(구글 드라이브)로 보내지 않아요. 데이터는 본판 → 미리 보기 한 방향이에요 (본판에서 백업 저장 → 여기서 불러오기).</p></>;
  const [cfg, setCfg] = useState(getSendConfig());
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const st = useSendState();
  return (
    <div class="card" aria-label="자동 보내기">
      <strong>자동 보내기 (운동 끝나면 PC로) · 실험</strong>
      <p class="sub small">PC 브라우저에서는 확인했고, 아이폰 홈 화면 앱에서 실제로 되는지는 아직 확인 전이에요. 연결 후 운동을 한 번 끝내 보고 알려 주세요.</p>
      {cfg ? (
        <>
          <p class="small">연결됨 · 키 {maskKey(cfg.key)} · 마지막 보냄 {when(lastSentAt())}{hasPending() ? ' · 보낼 것 있음' : ''}{retryBlocked() ? ` · 자동 재시도 멈춤: ${blockedReason()} ("지금 보내기"로 다시)` : ''}</p>
          <div class="row wrap">
            <button onClick={async () => { const r = await pingSend(); setMsg({ t: r.message, ok: r.ok }); }}>연결 확인</button>
            <button class="primary" disabled={st.phase === 'sending'} onClick={async () => { const ok = await sendNow('manual'); setMsg({ t: ok ? 'PC로 보냈어요' : `보내지 못했어요: ${getSendState().error ?? ''}`, ok }); }}>지금 보내기</button>
            <button class="danger" onClick={async () => { if (await askConfirm({ title: '자동 보내기를 끌까요?', message: '이 기기에서 설정이 지워져요.', ok: '끄기', danger: true })) { clearSendConfig(); setCfg(undefined); setMsg({ t: '자동 보내기를 껐어요', ok: true }); } }}>끄기</button>
          </div>
        </>
      ) : (
        <>
          <p class="sub small">PC의 <strong>WORK_OUT_APP\sync\설정.txt</strong> 두 번째 줄(https://…#…)을 아이폰 파일 앱(구글 드라이브)에서 복사해 붙여넣으세요. 연결되면 그 파일은 지워 주세요.</p>
          <input aria-label="자동 보내기 설정 붙여넣기" type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellcheck={false} style={{ WebkitTextSecurity: 'disc' } as Record<string, string>} placeholder="https://script.google.com/…#…" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          <button class="primary" style={{ marginTop: '6px' }} disabled={!text.trim()} onClick={async () => {
            const r = saveSendConfig(text);
            if (!r.ok) { setMsg({ t: r.error, ok: false }); return; }
            setText(''); setCfg(getSendConfig());
            const p = await pingSend();
            setMsg({ t: p.ok ? '연결됐어요. 이제 설정.txt를 지워 주세요' : `저장했지만 연결 확인 실패: ${p.message}`, ok: p.ok });
          }}>저장하고 연결 확인</button>
        </>
      )}
      {msg && <p role="status" class="small" style={{ color: msg.ok ? 'var(--ok)' : 'var(--bad)' }}>{msg.t}</p>}
    </div>
  );
}
