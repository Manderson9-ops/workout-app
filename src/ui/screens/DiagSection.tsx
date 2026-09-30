import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { allDiag, diagEnabled, setDiagEnabled, deviceId, diag } from '../diag';
import { summarizeDiag, verdicts, DIAG_LABEL, DIAG_TRUST } from '../../core/diag';
import type { DiagEntry } from '../../core/diag';
import { saveBackupFile, prepareBackup, SAVE_MESSAGE } from '../backupActions';

const time = (t: string) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

/** 설정의 "PC로 보내기"와 "진단 기록" (D-022~D-024). PC에서 백업을 불러오면 폰의 진단도 여기서 볼 수 있음 */
export function DiagSection({ s }: { s: AppState }) {
  const [list, setList] = useState<DiagEntry[]>([]);
  const [on, setOn] = useState(diagEnabled());
  const [dev, setDev] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);
  const me = deviceId();
  useEffect(() => { void allDiag().then(setList); }, [s]);
  useEffect(() => { const t = setTimeout(() => { void prepareBackup().catch(() => undefined); }, 800); return () => clearTimeout(t); }, [s]);
  const devices = [...new Set(list.map((e) => e.d))];
  const cur = dev || (devices.includes(me) ? me : devices[0] ?? me);
  const mine = list.filter((e) => e.d === cur);
  const sum = summarizeDiag(mine);
  const vs = verdicts(sum);
  const startLabel = (d: string) => list.filter((e) => e.d === d && e.k === 'start').pop()?.m?.split(' · ').slice(1, 3).join(' · ') ?? '';

  return (
    <>
      <h2>PC로 보내기</h2>
      <p class="sub small">운동 기록과 진단 기록을 파일 하나로 보내요. 공유 → "파일에 저장" → Google Drive → <strong>WORK_OUT_APP → sync → inbox</strong> (처음 한 번만 고르면 다음부터 기억해요). PC에서 "동기화 파일 확인해 줘"라고 하면 검사 후 요약해 드려요.</p>
      <button class="primary" onClick={async () => { const r = await saveBackupFile(); if (r === 'shared' || r === 'downloaded') diag('send', { m: `파일 (${r})`, ok: true }); setMsg(SAVE_MESSAGE[r].replace('백업 파일', 'PC로 보낼 파일')); }}>PC로 보내기 (파일)</button>
      {msg && <p role="status" class="small">{msg}</p>}

      <h2>진단 기록</h2>
      <p class="sub small">앱이 안에서 어떻게 움직였는지(타이머 오차, 화면 꺼짐 방지, 소리 준비, 오류)를 이 기기에만 최근 1,000건 남겨요. 운동 내용·입력값은 넣지 않아요. "PC로 보내기"를 할 때만 밖으로 나가요.</p>
      <label class="row small" style={{ minHeight: '44px' }}>
        <input type="checkbox" checked={on} aria-label="진단 기록 남기기" style={{ width: '24px', height: '24px' }} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setDiagEnabled(v); setOn(v); }} />
        진단 기록 남기기
      </label>
      {devices.length > 1 && (
        <div>
          <label>기기</label>
          <select aria-label="진단 기기" value={cur} onChange={(e) => setDev((e.target as HTMLSelectElement).value)}>
            {devices.map((d) => <option key={d} value={d}>{d === me ? '이 기기' : `다른 기기 (${d})`} {startLabel(d)}</option>)}
          </select>
        </div>
      )}
      <div class="card" aria-label="진단 요약">
        {!mine.length ? <p class="sub small">아직 기록이 없어요. 운동을 한 번 해 보면 쌓여요.</p> : (
          <>
            <p class="small sub">{time(sum.from!)} ~ {time(sum.to!)} · {sum.total}건{sum.lastStart ? ` · ${sum.lastStart}` : ''}</p>
            {vs.map((v) => (
              <p key={v.item} class="small" style={{ color: v.level === 'warn' ? 'var(--warn)' : v.level === 'ok' ? 'var(--ok)' : 'var(--text)' }}>
                <strong>{v.level === 'warn' ? '⚠ ' : v.level === 'ok' ? '✓ ' : 'ℹ '}{v.item}</strong>: {v.text}
              </p>
            ))}
            <p class="sub small">번호는 실기기 체크리스트 항목. "대리"는 앱이 대신 본 값이라 실제 결과는 직접 확인이 필요해요.</p>
          </>
        )}
      </div>
      {mine.length > 0 && (
        <details open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
          <summary class="small sub" style={{ minHeight: '44px', display: 'flex', alignItems: 'center' }}>최근 기록 50건 보기</summary>
          {showAll && [...mine].reverse().slice(0, 50).map((e, i) => (
            <div key={i} class="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span class="sub">{time(e.t)}</span> · {DIAG_LABEL[e.k]}{DIAG_TRUST[e.k] === 'proxy' ? '(대리)' : ''}
              {e.ok === false ? ' ✗' : e.ok ? ' ✓' : ''}{e.m ? ` · ${e.m}` : ''}{e.v !== undefined ? ` · ${e.k === 'start' ? `${e.v}KB` : `${e.v}${e.k === 'input' ? '개' : 'ms'}`}` : ''}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
