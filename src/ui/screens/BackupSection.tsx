import { syncEnabled, disableSync, replaceServerWithLocal, pullFresh, syncErrorText } from '../sync';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { activeOf } from '../store';
import { saveBackupFile, readBackupFile, restoreBackup, resetAll, prepareBackup, SAVE_MESSAGE } from '../backupActions';
import { IS_PREVIEW } from '../appName';
import { Icon } from '../icons';
import { askConfirm, askChoice } from '../confirm';
import { dateTimeText } from '../../core/dateText';

/** 데이터가 바뀌고 잠시(0.8초) 조용하면 백업 파일을 미리 만듦 (입력 중에는 만들지 않음) */
function usePreparedBackup(s: AppState) {
  useEffect(() => {
    const t = setTimeout(() => { void prepareBackup().catch(() => undefined); }, 800);
    return () => clearTimeout(t);
  }, [s]);
}

/** 설정의 "데이터 백업" 영역 (BLUEPRINT 4.6, D-021) */
export function BackupSection({ s }: { s: AppState }) {
  const st = s.settings;
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 누르자마자 공유 시트를 열 수 있게 파일을 미리 만들어 둠 (아이폰 사파리 제약)
  usePreparedBackup(s);
  const active = activeOf(s);

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
    if (!f) return;
    const r = await readBackupFile(f);
    if (!r.ok) { setMsg({ text: `불러오지 못했어요: ${r.error}. 지금 데이터는 그대로예요`, ok: false }); return; }
    const c = r.file.counts;
    // 미리 보기 판에서 만든 백업을 본판에 넣으려 할 때 (D-031: 한 방향)
    if (r.file.preview && !IS_PREVIEW && !(await askConfirm({ title: '미리 보기 판(β) 백업이에요', message: '시험용 데이터일 수 있어요.\n그래도 본판 데이터를 이것으로 바꿀까요?', ok: '계속', danger: true }))) return;
    const warnActive = active ? `\n\n주의: 진행 중인 운동("${active.name}")도 사라져요.` : '';
    if (!(await askConfirm({ title: '이 백업으로 바꿀까요?', ok: '바꾸기', danger: true, message: `${dateTimeText(r.file.exportedAt, Date.now())} 백업\n운동 기록 ${c.workouts}개, 루틴 ${c.routines}개, 체중 ${c.bodyweight}개\n\n지금 이 폰의 데이터는 모두 이 백업으로 바뀌어요 (합치지 않음). 먼저 "백업 파일 저장"으로 지금 데이터를 저장해 두는 것을 권해요.${warnActive}` }))) return;
    // 동기화가 켜져 있으면 어디까지 바꿀지 고름 (D-032): 서버까지(다른 기기도 다시 받음) / 이 기기만(동기화 끔)
    let scope: 'server' | 'local' = 'local';
    if (syncEnabled()) {
      // 닫기·Esc·취소는 아무것도 바꾸지 않음 (기본 confirm 때는 [취소]가 "다른 방법"이었음)
      const pick = await askChoice({ title: '동기화가 켜져 있어요', message: '어디까지 이 백업으로 바꿀까요?\n· 서버·다른 기기까지: 서버는 바꾸기 전 상태를 따로 보관해요\n· 이 기기만: 동기화를 꺼요', ok: '서버·다른 기기까지', alt: '이 기기만 (동기화 끄기)', danger: true });
      if (pick === 'ok') scope = 'server';
      else if (pick === 'alt') { scope = 'local'; await disableSync(); }
      else return;
    }
    try {
      if (scope === 'server') {
        // 동기화를 멈춘 상태에서 불러오고 곧바로 서버를 바꿈
        const x = await replaceServerWithLocal(() => restoreBackup(r.file));
        setMsg({ text: x.ok ? '백업을 불러오고 서버까지 바꿨어요' : `백업은 이 기기에 불러왔지만 서버는 못 바꿨어요: ${syncErrorText(x.error)}`, ok: x.ok });
      } else { await restoreBackup(r.file); setMsg({ text: '백업을 불러왔어요', ok: true }); }
    }
    catch { setMsg({ text: '불러오는 중 문제가 생겨 아무것도 바꾸지 않았어요', ok: false }); }
  };

  return (
    <>
      <h2>데이터 백업</h2>
      <p class="sub small">운동 기록은 이 아이폰 안에만 저장돼요. 홈 화면 아이콘을 지우거나 폰을 바꾸면 사라지니 백업 파일을 가끔 저장하세요. 공유 → "파일에 저장" → 구글 드라이브를 고르면 PC에서도 볼 수 있어요.</p>
      <p class="small">마지막 백업: {st.lastBackupAt ? dateTimeText(st.lastBackupAt, Date.now()) : '없음'}</p>
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
          if (!(await askConfirm({ title: '정말 모든 데이터를 지울까요?', message: '되돌릴 수 없어요.', ok: '지우기', danger: true }))) return;
          if (!(await askConfirm({ title: '마지막 확인', message: '백업 파일을 저장해 두셨나요? 지우기를 계속할까요?', ok: '계속 지우기', danger: true }))) return;
          if (syncEnabled()) {
            // 동기화 중에 지우면 다른 기기 기록까지 지워지지 않게: 이 기기만 비우고 서버에서 다시 받거나, 동기화를 끔
            // 닫기·Esc·취소는 지우지 않음 (기본 confirm 때는 [취소]가 "동기화 끄고 비우기"였음)
            const pick = await askChoice({ title: '동기화가 켜져 있어요', message: '이 기기만 비워요. 다른 기기·서버 기록은 그대로예요.', ok: '비우고 서버에서 다시 받기', alt: '비우고 동기화 끄기', danger: true });
            if (!pick) return;
            if (pick === 'ok') { await resetAll(); await pullFresh(); setMsg({ text: '이 기기를 비우고 서버에서 다시 받았어요', ok: true }); return; }
            await disableSync();
          }
          await resetAll(); setMsg({ text: '모든 데이터를 지웠어요', ok: true });
        }}>모든 데이터 지우기</button>
      </details>
    </>
  );
}

/** 홈의 7일 백업 알림 (결과도 여기서 보여 줌) */
export function BackupBanner({ s }: { s: AppState }) {
  const [msg, setMsg] = useState<string | null>(null);
  usePreparedBackup(s);
  return (
    // D-055 검토 A3: 홈 맨 위 큰 카드 대신 "다음 운동" 아래 작은 알림 (채운 파랑 버튼은 [▶ 시작] 하나만)
    <div class="notice notice-row" role="note" aria-label="백업 알림">
      <Icon name="info" size={20} class="notice-ico" />
      <div class="grow">
        <span class="small">{s.settings.lastBackupAt ? '마지막 백업 후 7일이 지났어요' : '아직 백업한 적이 없어요'}</span>
        {msg && <p role="status" class="small sub">{msg}</p>}
      </div>
      <button onClick={async () => { const r = await saveBackupFile(); setMsg(SAVE_MESSAGE[r]); }} aria-label="지금 백업">백업</button>
    </div>
  );
}