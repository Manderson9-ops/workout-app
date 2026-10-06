/**
 * 홈 "오늘" (D-055 디자인 시스템 3장 1단계 5번).
 * 작은 날짜 + 큰 "오늘" / 이번 주(운동·세트 + 요일 점, 기록 탭으로 ›) / 다음 운동(최근 루틴 1개 큰 [▶ 시작]) /
 * 내 루틴([▶ 시작] + ⋯ 편집·지우기) / 최근 운동(기록 탭과 같은 카드 + ⋯ 수정·삭제) / 저장 안내는 처음 1회 작은 알림
 */
import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, activeOf, historyOf } from '../store';
import { setHomeHidden, startRoutine } from '../actions';
import { homeRecent } from '../../core/session';
import type { Workout } from '../../core/session';
import { backupDue } from '../../core/backup';
import { weekSummary, weekStart, addDays, localDate, summarize } from '../../core/stats';
import { routineUse, routineParts, pickNextRoutine, sinceText } from '../../core/routineList';
import type { NextPick } from '../../core/routineList';
import type { Part } from '../../core/types';
import { BackupBanner } from './BackupSection';
import { SendStatus } from './AutoSendSection';
import { RoutineList, newRoutine } from './MyRoutines';
import { RemoteCards } from './RemoteCards';
import { WorkoutCardWithMenu } from './WorkoutCard';
import { softDelete } from '../../db/db';
import { catalog } from '../catalog';
import { minutes, mmss, Card, Metric, Empty } from '../components';
import { Icon } from '../icons';
import { ScreenHeader } from '../header';
import { go } from '../nav';
import { askChoice } from '../confirm';
import { syncEnabled } from '../sync';

const WD = ['일', '월', '화', '수', '목', '금', '토']; // 주는 일요일 시작 (D-054)

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

/** 지난주 같은 요일까지와 비교 한 마디 (격려 톤: 줄어도 빨강으로 다그치지 않음) */
function vsLastWeek(cur: number, prev: number): { status: string; tone: 'ok' | 'sub'; mark: string } {
  if (cur > prev) return { status: `지난주보다 ${cur - prev} 많아요`, tone: 'ok', mark: '▲' };
  if (cur === prev) return { status: '지난주와 같아요', tone: 'sub', mark: '=' };
  return { status: `지난주보다 ${prev - cur} 적어요`, tone: 'sub', mark: '▼' };
}

function ThisWeekCard({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const done = historyOf(s);
  const today = localDate(Date.now());
  const ws = weekStart(today);
  const cur = weekSummary(done, byId, ws, s.bodyweight);
  const prev = weekSummary(done, byId, addDays(ws, -7), s.bodyweight, addDays(today, -7));
  const never = done.length === 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const c = vsLastWeek(cur.count, prev.count);
  const st = vsLastWeek(cur.sets, prev.sets);
  // 링크 이름에 탭 이름(홈·플랜·운동·기록·종목)을 넣지 않음: 탭 링크와 헷갈리지 않게
  const label = never ? '이번 주 요약: 아직 없음. 자세히 보기' : `이번 주 요약: ${cur.count}회, 작업 세트 ${cur.sets}개, 한 요일 ${days.filter((d) => cur.days.has(d)).map((d) => WD[days.indexOf(d)]).join('·') || '없음'}. 자세히 보기`;
  return (
    <Card title="이번 주" href="#/stats" label={label} testid="home-week">
      <div class="metrics2">
        <Metric label="운동" value={never ? undefined : cur.count} unit="회" status={never ? '아직 기록 없음' : c.status} tone={c.tone} mark={never ? undefined : c.mark} />
        <Metric label="작업 세트" value={never ? undefined : cur.sets} unit="세트" status={never ? '첫 운동을 해 보세요' : st.status} tone={st.tone} mark={never ? undefined : st.mark} />
      </div>
      <div class="weekdots" aria-hidden="true">
        {days.map((d, i) => (
          <span key={d} class={`wdot${cur.days.has(d) ? ' did' : ''}${d === today ? ' today' : ''}${d > today ? ' future' : ''}`}>
            <i />{WD[i]}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** 다음 운동 이유 한 줄 (D-055 앱 판단: 오늘 안 한 루틴 중 가장 오래전에 한 것) */
function nextReason(p: NextPick): string {
  if (p.reason === 'oldest') return `가장 오래전에 한 루틴 · ${sinceText(p.lastAt, Date.now())}`;
  if (p.reason === 'never') return '아직 안 한 루틴';
  return '오늘 이미 했어요';
}

function NextWorkoutCard({ s, pick }: { s: AppState; pick: NextPick }) {
  const r = pick.routine;
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const items = r.blocks.flatMap((b) => b.items);
  const parts = routineParts(r, (id): Part | undefined => byId.get(id)?.part);
  return (
    <Card title="다음 운동" testid="home-next">
      <div class="next-name">{r.name}</div>
      {parts.length > 0 && <div class="row wrap routine-parts">{parts.map((p) => <span key={p} class="tag">{p}</span>)}</div>}
      <p class={`next-why ${pick.reason === 'doneToday' ? 't-sub' : 't-acc'}`}>{nextReason(pick)}</p>
      <p class="sub next-meta">운동 {items.length}개{r.estimatedSec ? ` · 약 ${minutes(r.estimatedSec)}` : ''}</p>
      <button class="primary big" onClick={() => startRoutine(s, r)} aria-label={`다음 운동으로 시작: ${r.name}`}><Icon name="play" size={20} />시작</button>
    </Card>
  );
}

export function Home({ s }: { s: AppState }) {
  const active = activeOf(s);
  // 빼기·완전 삭제 뒤 카드가 사라지므로 결과를 글로 알림 (화면 읽기 프로그램도 읽음)
  const [done, setDone] = useState<string | null>(null);
  const history = historyOf(s);
  const recent = homeRecent(history, s.settings.homeHidden, 5); // "목록에서만 빼기" 한 것은 건너뜀 (D-040)
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const hiddenIds = new Set(s.settings.routineHidden ?? []);
  const visible = s.routines.filter((r) => !hiddenIds.has(r.id));
  const next = pickNextRoutine(visible, routineUse(history), localDate(Date.now()));
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  return (
    <main class="home">
      <ScreenHeader eyebrow={today} title="오늘" />
      <SendStatus />
      <RemoteCards s={s} />
      {active && (
        <div class="card active">
          <div class="row between"><h3>운동 중: {active.name}</h3><span class="sub num-s">{mmss((Date.now() - Date.parse(active.startedAt)) / 1000)}</span></div>
          <button class="primary big" onClick={() => go('#/workout')}>계속하기</button>
        </div>
      )}
      {!s.settings.storageNoticeSeen && (
        <div class="notice" role="note" aria-label="저장 안내">
          <Icon name="info" size={20} class="notice-ico" />
          <div class="grow">
            {syncEnabled() ? (
              <>
                <strong>기록은 이 기기와 내 구글 드라이브에 저장돼요</strong>
                <p class="small sub">PC ↔ 폰 동기화가 켜져 있어 다른 기기에서도 같은 기록이 보여요. 그래도 설정에서 가끔 백업해 두세요.</p>
              </>
            ) : (
              <>
                <strong>기록은 이 기기에만 저장돼요</strong>
                <p class="small sub">앱(홈 화면 아이콘)을 지우면 기록도 지워져요. 설정에서 가끔 백업하거나 PC ↔ 폰 동기화를 켜 두세요. 아이폰은 사파리 공유 → "홈 화면에 추가"로 설치해요.</p>
              </>
            )}
            <button class="notice-ok" onClick={() => mutate((d) => d.settings.put({ ...s.settings, key: 'main', storageNoticeSeen: true }))}>알겠어요</button>
          </div>
        </div>
      )}
      {backupDue(s.settings.lastBackupAt, history.length, Date.now()) && (
        <BackupBanner s={s} />
      )}
      <div class="wide-cards">
        <ThisWeekCard s={s} />
        {!active && (next
          ? <NextWorkoutCard s={s} pick={next} />
          : !s.routines.length && (
            <Empty title="다음 운동" text="아직 루틴이 없어요" hint="플랜 만들기에서 부위·시간을 고르면 자동으로 짜 드려요">
              <button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button>
              <button onClick={() => void newRoutine()}>+ 직접 만들기</button>
            </Empty>
          ))}
      </div>
      {s.routines.length > 0 ? (
        <>
          <div class="row between sec-head"><h2>내 루틴</h2><div class="row"><button onClick={() => void newRoutine()}>+ 직접</button><button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button></div></div>
          <RoutineList s={s} mode="home" />
        </>
      ) : null}
      {recent.length > 0 && <h2>최근 운동</h2>}
      <div class="wide-cards">
        {recent.map((w) => (
          <WorkoutCardWithMenu key={w.id} x={summarize(w, byId, s.bodyweight)} w={w} byId={byId} items={[
            { label: '수정', aria: `최근 운동 ${w.name} 수정`, run: () => go(`#/stats/w/${encodeURIComponent(w.id)}/edit`) },
            { label: '삭제…', aria: `최근 운동 ${w.name} 삭제`, danger: true, run: () => void removeRecent(w).then((p) => { if (p === 'ok') setDone(`"${w.name}"을(를) 홈에서 뺐어요. 기록 탭의 상세에서 되돌릴 수 있어요`); else if (p === 'alt') setDone(`"${w.name}"을(를) 완전히 지웠어요`); }) },
          ]} />
        ))}
      </div>
      <p role="status" class="small sub" style={{ minHeight: done ? undefined : 0, margin: done ? undefined : 0 }}>{done ?? ''}</p>
    </main>
  );
}
