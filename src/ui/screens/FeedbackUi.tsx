import { useState, useEffect, useRef } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, activeOf } from '../store';
import { Sheet } from '../components';
import { newFeedbackId, FB_TEXT_MAX, usedFeedbackIds } from '../../core/feedback';
import { db } from '../store';
import { lsGet, lsRemove } from '../appName';
import { FB_NOTICE_KEY } from '../feedbackStatus';
import type { Feedback } from '../../core/feedback';
import { deviceId } from '../deviceId';
import { APP_VERSION } from '../../core/version';
import { softDelete } from '../../db/db';

const openers = new Set<() => void>();
/** 메뉴의 "개선" 버튼 (메뉴는 backdrop-filter라 안에 고정 시트를 두면 위치가 틀어져서, 시트는 FeedbackButton이 메뉴 밖에서 띄움) */
export function FeedbackNavItem() {
  return <button type="button" class="nav-fb" aria-label="개선 메모 쓰기" onClick={() => openers.forEach((f) => f())}><span class="ico">💬</span>개선</button>;
}

/** 어느 화면에서든 개선 메모 (S3). 화면·진행 중 운동·앱 버전이 자동으로 붙고, 동기화로 PC에 감 */
export function FeedbackButton({ s }: { s: AppState }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => box.current?.focus(), 50); }, [open]);
  const [text, setText] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { const f = () => { setDone(''); setOpen(true); }; openers.add(f); return () => { openers.delete(f); }; }, []);
  // 반영됨·보류 알림 (CHANGELOG 반영 뒤 한 번)
  useEffect(() => {
    const show = () => { const n = lsGet(FB_NOTICE_KEY); if (n) { lsRemove(FB_NOTICE_KEY); setDone(n); } };
    show(); window.addEventListener('fb-notice', show); return () => window.removeEventListener('fb-notice', show);
  }, []);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(''), 6000); return () => clearTimeout(t); }, [done]);
  const screen = location.hash || '#/';
  const active = activeOf(s);
  return (
    <>
      {open && (
        <Sheet title="개선 메모" onClose={() => setOpen(false)}>
          <p class="sub small">지금 화면({screen}){active ? ` · 운동 「${active.name}」` : ''}에서 불편한 점·바라는 점을 적어 주세요. PC로 전달돼 다음 개선에 반영돼요.</p>
          <textarea ref={box} aria-label="개선 메모 내용" rows={5} maxLength={FB_TEXT_MAX} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: '16px' }} />
          <button class="primary" style={{ marginTop: '8px' }} disabled={!text.trim()} onClick={async () => {
            const fb: Feedback = {
              id: newFeedbackId(new Date(), deviceId(), usedFeedbackIds(s.feedback.map((f) => f.id), (await db.tombs.where('table').equals('feedback').toArray()).map((t) => t.id))),
              createdAt: new Date().toISOString(), screen: screen.slice(0, 200),
              context: `${APP_VERSION}${active ? ` · 운동 ${active.name}` : ''}`.slice(0, 300),
              text: text.trim().slice(0, FB_TEXT_MAX), status: '접수',
            };
            await mutate((d) => d.feedback.put(fb));
            setText(''); setDone(`저장했어요 (${fb.id})`); setOpen(false);
          }}>저장</button>
        </Sheet>
      )}
      {done && <div role="status" class="fb-toast" onClick={() => setDone('')}>{done}</div>}
    </>
  );
}

/** 설정: 내가 쓴 개선 메모와 상태 (접수 → 검토 → 계획 → 반영됨 / 보류 + 이유) */
export function FeedbackList({ s }: { s: AppState }) {
  const items = [...s.feedback].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <>
      <h2>개선 메모</h2>
      <p class="sub small">아래(PC는 왼쪽) 메뉴의 💬 개선 으로 언제든 적을 수 있어요. PC에서 "개선 메모 처리해 줘"라고 하면 모아서 고쳐요.</p>
      {!items.length && <p class="sub small">아직 없어요.</p>}
      {items.map((f) => (
        <div class="card" key={f.id} aria-label={`개선 메모 ${f.id}`}>
          <div class="row between small"><span class="sub">{new Date(f.createdAt).toLocaleDateString('ko-KR')} · {f.screen}</span><strong>{f.status}</strong></div>
          <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{f.text}</p>
          {f.note && <p class="small sub">{f.status === '보류' ? '보류 이유: ' : ''}{f.note}</p>}
          {f.status === '접수' && <button class="ghost" aria-label={`${f.id} 지우기`} onClick={async () => { if (confirm('이 메모를 지울까요?')) await mutate((d) => softDelete(d, 'feedback', f.id)); }}>지우기</button>}
        </div>
      ))}
    </>
  );
}
