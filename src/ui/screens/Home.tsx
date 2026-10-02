import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, activeOf, historyOf } from '../store';
import { setHomeHidden } from '../actions';
import { homeRecent } from '../../core/session';
import type { Workout } from '../../core/session';
import { backupDue } from '../../core/backup';
import { BackupBanner } from './BackupSection';
import { SendStatus } from './AutoSendSection';
import { RoutineList, newRoutine } from './MyRoutines';
import { RemoteCards } from './RemoteCards';
import { softDelete } from '../../db/db';
import { minutes, mmss } from '../components';
import { go } from '../nav';
import { askChoice } from '../confirm';
import { syncEnabled } from '../sync';

/**
 * 홈 "최근 운동" 삭제 (D-040): 목록에서만 빼기(기록·통계 그대로, 기록 상세에서 되돌림) / 완전 삭제(되돌릴 수 없음).
 * 안전한 쪽(목록에서만 빼기)이 첫 버튼·초점. 완전 삭제는 빨간 버튼. 닫기·Esc·취소는 아무것도 안 함
 */
async function removeRecent(w: Workout): Promise<'ok' | 'alt' | false | null> {
  const pick = await askChoice({
    title: '이 운동을 어떻게 할까요?',
    message: `"${w.name}"\n· 목록에서만 빼기: 홈에서만 안 보여요. 기록 탭·통계에는 남고, 기록 상세에서 되돌릴 수 있어요\n· 완전 삭제: 기록·통계에서도 지워져요. 되돌릴 수 없어요`,
    ok: '목록에서만 빼기', alt: '완전 삭제', altDanger: true,
  });
  if (pick === 'ok') {
    await setHomeHidden(w.id, true); // 운동 기록은 그대로, 설정의 "뺀 목록"에만 더함
  } else if (pick === 'alt') {
    await mutate((d) => softDelete(d, 'workouts', w.id));
    await setHomeHidden(w.id, false); // 뺀 목록에 남아 있었다면 정리 (보통은 없음)
  }
  return pick;
}

export function Home({ s }: { s: AppState }) {
  const active = activeOf(s);
  // 빼기·완전 삭제 뒤 카드가 사라지므로 결과를 글로 알림 (화면 읽기 프로그램도 읽음)
  const [done, setDone] = useState<string | null>(null);
  const recent = homeRecent(historyOf(s), s.settings.homeHidden, 5); // "목록에서만 빼기" 한 것은 건너뜀 (D-040)
  return (
    <main>
      <h1>운동 기록</h1>
      <SendStatus />
      <RemoteCards s={s} />
      {active && (
        <div class="card active">
          <div class="row between"><h3>운동 중: {active.name}</h3><span class="sub">{mmss((Date.now() - Date.parse(active.startedAt)) / 1000)}</span></div>
          <button class="primary big" onClick={() => go('#/workout')}>계속하기</button>
        </div>
      )}
      {!s.settings.storageNoticeSeen && (
        <div class="card" role="note" aria-label="저장 안내">
          {syncEnabled() ? (
            <>
              <h3>기록은 이 기기와 내 구글 드라이브에 저장돼요</h3>
              <p class="small">PC ↔ 폰 동기화가 켜져 있어 다른 기기에서도 같은 기록이 보여요. 그래도 설정 → 백업 파일 저장으로 가끔 백업해 두세요.</p>
            </>
          ) : (
            <>
              <h3>기록은 이 기기에만 저장돼요</h3>
              <p class="small">아이폰은 사파리에서 공유 → "홈 화면에 추가"로 설치해서 쓰세요. 앱(홈 화면 아이콘)을 지우면 기록도 지워져요. 설정 → 백업 파일 저장으로 가끔 백업하거나, 설정 → PC ↔ 폰 동기화를 켜 주세요.</p>
            </>
          )}
          <button onClick={() => mutate((d) => d.settings.put({ ...s.settings, key: 'main', storageNoticeSeen: true }))}>알겠어요</button>
        </div>
      )}
      {backupDue(s.settings.lastBackupAt, historyOf(s).length, Date.now()) && (
        <BackupBanner s={s} />
      )}
      <div class="row between"><h2>내 루틴</h2><div class="row"><button onClick={() => void newRoutine()}>+ 직접</button><button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button></div></div>
      <RoutineList s={s} mode="home" />
      {recent.length > 0 && <h2>최근 운동</h2>}
      <div class="wide-cards">
      {recent.map((w) => {
        const sets = w.blocks.flatMap((b) => b.items.flatMap((i) => i.sets)).filter((x) => x.done && !x.warmup).length;
        return (
          <div class="card" key={w.id} role="group" aria-label={`최근 운동 ${w.name}`}>
            <a class="card-link" href={`#/stats/w/${encodeURIComponent(w.id)}`} aria-label={`${w.name} 자세히 보기`}>
              <div class="row between"><span>{w.name}</span><span class="sub small">{new Date(w.startedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span></div>
              <div class="sub small">작업 세트 {sets}개 · {minutes((Date.parse(w.endedAt!) - Date.parse(w.startedAt)) / 1000)}{w.editedAt ? ' · 고침' : ''}</div>
            </a>
            <div class="row" style={{ marginTop: '6px', justifyContent: 'flex-end' }}>
              <button aria-label={`최근 운동 ${w.name} 수정`} onClick={() => go(`#/stats/w/${encodeURIComponent(w.id)}/edit`)}>수정</button>
              <button class="danger" aria-label={`최근 운동 ${w.name} 삭제`} onClick={() => void removeRecent(w).then((p) => { if (p === 'ok') setDone(`"${w.name}"을(를) 홈에서 뺐어요. 기록 탭의 상세에서 되돌릴 수 있어요`); else if (p === 'alt') setDone(`"${w.name}"을(를) 완전히 지웠어요`); })}>삭제</button>
            </div>
          </div>
        );
      })}
      </div>
      <p role="status" class="small sub" style={{ minHeight: done ? undefined : 0, margin: done ? undefined : 0 }}>{done ?? ''}</p>
    </main>
  );
}
