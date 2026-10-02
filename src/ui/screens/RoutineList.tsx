/**
 * 내 루틴 목록 (D-048). 홈(최근 3개 + 모두 보기), 내 루틴 화면(#/routines), 운동 탭의 "루틴 고르기"가 같은 카드를 씀.
 * 카드: 이름, 부위, 운동 수·예상 시간, 마지막으로 한 날·횟수, 운동 이름 미리 보기, [시작] [편집] [⋯ 지우기].
 * 지우기 = 목록에서만 숨기기(설정 routineHidden, 되돌림 가능) / 완전 삭제(되돌릴 수 없음). 운동 기록은 어느 쪽이든 남음.
 */
import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf } from '../store';
import { catalog } from '../catalog';
import { startRoutine, setRoutineHidden, deleteRoutineForever } from '../actions';
import type { Routine } from '../../core/session';
import { emptyRoutine } from '../../core/session';
import { routineUse, routineParts, sortRoutines, filterRoutines, sinceText } from '../../core/routineList';
import type { RoutineSort } from '../../core/routineList';
import type { Part } from '../../core/types';
import { newId } from '../../db/db';
import { minutes } from '../components';
import { go } from '../nav';
import { askChoice, askConfirm } from '../confirm';
import { lsGet, lsSet } from '../appName';

const SORT_KEY = 'routines.sort';
const SORT_LABEL: Record<RoutineSort, string> = { recent: '최근 한 순', name: '이름 순', short: '짧은 시간 순' };

export async function newRoutine(): Promise<void> {
  const r = emptyRoutine(newId('r'), '새 루틴', new Date().toISOString());
  await mutate((d) => d.routines.put(r));
  go(`#/routine/${encodeURIComponent(r.id)}`);
}

/**
 * mode: 'home' = 최근 3개 + "모두 보기", 'all' = 전체(검색·정렬·숨긴 루틴), 'pick' = 운동 탭에서 고르기(전체, 편집·지우기 없음)
 */
export function RoutineList({ s, mode }: { s: AppState; mode: 'home' | 'all' | 'pick' }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const nameOf = (id: string) => byId.get(id)?.name_ko ?? id;
  const partOf = (id: string): Part | undefined => byId.get(id)?.part;
  const [q, setQ] = useState('');
  const [sort, setSortRaw] = useState<RoutineSort>(() => (['recent', 'name', 'short'].includes(lsGet(SORT_KEY) ?? '') ? lsGet(SORT_KEY) as RoutineSort : 'recent'));
  const setSort = (x: RoutineSort) => { setSortRaw(x); lsSet(SORT_KEY, x); };
  const [showHidden, setShowHidden] = useState(false);
  const [msg, setMsg] = useState('');
  const use = routineUse(historyOf(s));
  const hiddenIds = new Set(s.settings.routineHidden ?? []);
  const partsOf = (r: Routine) => routineParts(r, partOf);
  const visible = s.routines.filter((r) => !hiddenIds.has(r.id));
  const hidden = s.routines.filter((r) => hiddenIds.has(r.id));
  const sorted = sortRoutines(filterRoutines(visible, q, nameOf, partsOf), use, mode === 'home' ? 'recent' : sort);
  const shown = mode === 'home' ? sorted.slice(0, 3) : sorted;
  const now = Date.now();
  const tools = mode !== 'home' && visible.length > 1;

  const remove = async (r: Routine) => {
    const pick = await askChoice({
      title: '이 루틴을 어떻게 할까요?',
      message: `"${r.name}"\n· 목록에서만 숨기기: 목록에서 안 보여요. 루틴은 남아 있고 "숨긴 루틴"에서 되돌릴 수 있어요\n· 완전 삭제: 루틴을 지워요. 되돌릴 수 없어요\n(어느 쪽이든 이 루틴으로 한 운동 기록은 남아요)`,
      ok: '목록에서만 숨기기', alt: '완전 삭제', altDanger: true,
    });
    if (pick === 'ok') { await setRoutineHidden(r.id, true); setMsg(`"${r.name}"을(를) 목록에서 숨겼어요`); }
    else if (pick === 'alt') { await deleteRoutineForever(r.id); setMsg(`"${r.name}"을(를) 완전히 지웠어요`); }
  };

  const card = (r: Routine, isHidden = false) => {
    const u = use.get(r.id);
    const parts = partsOf(r);
    const items = r.blocks.flatMap((b) => b.items);
    return (
      <div class={`card routine-card${isHidden ? ' is-hidden' : ''}`} key={r.id} role="group" aria-label={`루틴 ${r.name}`}>
        <div class="row between" style={{ alignItems: 'flex-start' }}>
          <div class="grow">
            <h3 class="routine-name">{r.name}</h3>
            <div class="row wrap routine-parts">{parts.map((p) => <span key={p} class="tag">{p}</span>)}{!parts.length && <span class="sub small">운동 없음</span>}</div>
          </div>
          <div class="routine-when sub small" title={u?.lastAt ? new Date(u.lastAt).toLocaleString('ko-KR') : undefined}>
            <div>{sinceText(u?.lastAt, now)}</div>{u && <div>{u.count}회</div>}
          </div>
        </div>
        <div class="sub small" style={{ marginTop: '4px' }}>운동 {items.length}개{r.estimatedSec ? ` · 약 ${minutes(r.estimatedSec)}` : ''}</div>
        {items.length > 0 && <div class="pill routine-preview">{items.slice(0, 4).map((i) => nameOf(i.exerciseId)).join(', ')}{items.length > 4 ? ` 외 ${items.length - 4}개` : ''}</div>}
        <div class="row" style={{ marginTop: '10px' }}>
          {isHidden ? <>
            <button class="grow" onClick={async () => { await setRoutineHidden(r.id, false); setMsg(`"${r.name}"을(를) 다시 보이게 했어요`); }} aria-label={`${r.name} 다시 보이기`}>다시 보이기</button>
            <button class="danger" onClick={async () => { if (await askConfirm({ title: '루틴을 완전히 지울까요?', message: `"${r.name}" · 되돌릴 수 없어요. 운동 기록은 남아요.`, ok: '완전 삭제', danger: true })) { await deleteRoutineForever(r.id); setMsg(`"${r.name}"을(를) 완전히 지웠어요`); } }} aria-label={`${r.name} 완전 삭제`}>완전 삭제</button>
          </> : <>
            <button class="primary grow" disabled={!items.length} onClick={() => startRoutine(s, r)} aria-label={`${r.name} 시작`}>▶ 시작</button>
            {mode !== 'pick' && <button onClick={() => go(`#/routine/${encodeURIComponent(r.id)}`)} aria-label={`${r.name} 편집`}>편집</button>}
            {mode !== 'pick' && <button class="ghost" onClick={() => void remove(r)} aria-label={`${r.name} 지우기`}>지우기</button>}
          </>}
        </div>
      </div>
    );
  };

  return (
    <section class="routine-list" aria-label="내 루틴">
      {tools && (
        <div class="routine-tools">
          {visible.length >= 5 && <input placeholder="루틴·운동·부위 검색 (초성 가능)" value={q} aria-label="루틴 검색" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
          <div class="row wrap" role="group" aria-label="정렬" style={{ marginTop: '6px' }}>
            {(Object.keys(SORT_LABEL) as RoutineSort[]).map((k) => <button key={k} class={`chip ${sort === k ? 'on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{SORT_LABEL[k]}</button>)}
          </div>
        </div>
      )}
      <p class="sr-only" role="status" aria-live="polite">{msg}</p>
      {msg && <p class="sub small" aria-hidden="true">{msg}</p>}
      {!visible.length && (
        <div class="empty">
          <p>{hidden.length ? '보이는 루틴이 없어요.' : '아직 루틴이 없어요.'}</p>
          <p class="small">플랜 만들기에서 부위·시간을 고르면 자동으로 짜 드려요.</p>
          {mode !== 'home' && <div class="row" style={{ justifyContent: 'center' }}><button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button><button onClick={() => void newRoutine()}>+ 직접 만들기</button></div>}
        </div>
      )}
      {visible.length > 0 && !shown.length && <div class="empty">"{q}"에 맞는 루틴이 없어요</div>}
      <div class="wide-cards">{shown.map((r) => card(r))}</div>
      {mode === 'home' && sorted.length > 3 && <button class="big" onClick={() => go('#/routines')}>내 루틴 모두 보기 ({visible.length}개)</button>}
      {mode === 'all' && hidden.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <button class="ghost" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>{showHidden ? '▾' : '▸'} 숨긴 루틴 {hidden.length}개</button>
          {showHidden && <div class="wide-cards">{sortRoutines(hidden, use, 'name').map((r) => card(r, true))}</div>}
        </div>
      )}
    </section>
  );
}

/** #/routines: 내 루틴 전체 (검색·정렬·숨긴 루틴) */
export function RoutinesScreen({ s }: { s: AppState }) {
  return (
    <main>
      <div class="row between"><h1>내 루틴</h1><div class="row"><button onClick={() => void newRoutine()}>+ 직접</button><button class="primary" onClick={() => go('#/plan')}>+ 플랜</button></div></div>
      <RoutineList s={s} mode="all" />
    </main>
  );
}
