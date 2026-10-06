/**
 * 내 루틴 목록 (D-048). 홈(최근 3개 + 모두 보기), 내 루틴 화면(#/routines), 운동 탭의 "루틴 고르기"가 같은 카드를 씀.
 * 카드: 이름, 부위, 마지막으로 한 날·총 횟수, 운동 수·예상 시간, 운동 이름 미리 보기, [시작] [편집] [지우기].
 * 지우기 = 목록에서만 숨기기(설정 routineHidden, 되돌림 가능, 아래 알림의 [되돌리기]) / 완전 삭제(되돌릴 수 없음). 운동 기록은 어느 쪽이든 남음.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, activeOf } from '../store';
import { catalog } from '../catalog';
import { startRoutine, setRoutineHidden, deleteRoutineForever } from '../actions';
import type { Routine } from '../../core/session';
import { emptyRoutine } from '../../core/session';
import { routineUse, routineParts, sortRoutines, filterRoutines, sinceText } from '../../core/routineList';
import type { RoutineSort } from '../../core/routineList';
import type { Part } from '../../core/types';
import { newId } from '../../db/db';
import { minutes, MenuSheet, Empty } from '../components';
import { Icon } from '../icons';
import { ScreenHeader } from '../header';
import { go, setEditReturn } from '../nav';
import { askChoice, askConfirm } from '../confirm';
import { lsGet, lsSet } from '../appName';

const SORT_KEY = 'routines.sort';
const SORT_LABEL: Record<RoutineSort, string> = { recent: '최근 한 순', name: '이름 순', short: '짧은 시간 순' };

export async function newRoutine(): Promise<void> {
  const r = emptyRoutine(newId('r'), '새 루틴', new Date().toISOString());
  await mutate((d) => d.routines.put(r));
  setEditReturn('#/');
  go(`#/routine/${encodeURIComponent(r.id)}`);
}

type Toast = { text: string; undo?: () => Promise<void> } | null;

/**
 * mode: 'home' = 최근 3개 + "모두 보기", 'all' = 전체(검색·정렬·숨긴 루틴), 'pick' = 운동 탭에서 고르기(시작·편집, 지우기 없음)
 */
export function RoutineList({ s, mode }: { s: AppState; mode: 'home' | 'all' | 'pick' }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const nameOf = (id: string) => byId.get(id)?.name_ko ?? id;
  const partOf = (id: string): Part | undefined => byId.get(id)?.part;
  const [q, setQ] = useState('');
  const [sort, setSortRaw] = useState<RoutineSort>(() => (['recent', 'name', 'short'].includes(lsGet(SORT_KEY) ?? '') ? lsGet(SORT_KEY) as RoutineSort : 'recent'));
  const setSort = (x: RoutineSort) => { setSortRaw(x); lsSet(SORT_KEY, x); };
  // '숨긴 루틴 보기'로 오면(#/routines?hidden) 숨긴 구역을 펼친 채로
  const [showHidden, setShowHidden] = useState(() => mode === 'all' && location.hash.includes('hidden'));
  const [toast, setToast] = useState<Toast>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);
  // 숨긴 카드가 사라져 초점이 갈 곳이 없으므로 [되돌리기]로 옮김 (키보드·화면 읽기)
  const undoRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (toast?.undo) undoRef.current?.focus(); }, [toast]);
  const use = routineUse(historyOf(s));
  const hiddenIds = new Set(s.settings.routineHidden ?? []);
  const partsOf = (r: Routine) => routineParts(r, partOf);
  const visible = s.routines.filter((r) => !hiddenIds.has(r.id));
  const hidden = s.routines.filter((r) => hiddenIds.has(r.id));
  const sorted = sortRoutines(filterRoutines(visible, q, nameOf, partsOf), use, mode === 'home' ? 'recent' : sort);
  const shown = mode === 'home' ? sorted.slice(0, 3) : sorted;
  const now = Date.now();
  // 검색어가 남아 있으면 개수가 줄어도 검색창을 계속 보여 줌 (지울 수 있게)
  const showSearch = mode !== 'home' && (visible.length >= 5 || q.length > 0);
  const showSort = mode !== 'home' && (visible.length > 1 || q.length > 0);

  const hide = async (r: Routine) => {
    await setRoutineHidden(r.id, true);
    setToast({ text: `「${r.name}」 루틴을 목록에서 숨겼어요`, undo: async () => { await setRoutineHidden(r.id, false); setToast({ text: `「${r.name}」 루틴을 다시 보이게 했어요` }); } });
  };
  const removeForever = async (r: Routine) => { await deleteRoutineForever(r.id); setToast({ text: `「${r.name}」 루틴을 완전히 지웠어요` }); };
  const remove = async (r: Routine) => {
    const pick = await askChoice({
      title: '이 루틴을 어떻게 할까요?',
      message: `「${r.name}」\n· 목록에서만 숨기기: 목록에서 안 보여요. 루틴은 남아 있고 "숨긴 루틴"에서 되돌릴 수 있어요\n· 완전 삭제: 루틴을 지워요. 되돌릴 수 없어요\n(어느 쪽이든 이 루틴으로 한 운동 기록은 남아요)`,
      ok: '목록에서만 숨기기', alt: '완전 삭제', altDanger: true,
    });
    if (pick === 'ok') await hide(r);
    else if (pick === 'alt') await removeForever(r);
  };

  const [menu, setMenu] = useState<Routine | null>(null);
  const edit = (r: Routine) => { setEditReturn(mode === 'pick' ? '#/workout' : '#/'); go(`#/routine/${encodeURIComponent(r.id)}`); };

  const card = (r: Routine, isHidden = false) => {
    const u = use.get(r.id);
    const parts = partsOf(r);
    const items = r.blocks.flatMap((b) => b.items);
    const when = sinceText(u?.lastAt, now);
    return (
      <div class={`card routine-card${isHidden ? ' is-hidden' : ''}`} key={r.id} role="group" aria-label={`루틴 ${r.name}`}>
        <div class="row between" style={{ alignItems: 'flex-start' }}>
          <div class="grow">
            <h3 class="routine-name">{r.name}</h3>
            <div class="row wrap routine-parts">{parts.map((p) => <span key={p} class="tag">{p}</span>)}</div>
          </div>
          <div class="routine-when sub small" role="note" aria-label={u ? `마지막으로 한 날 ${when}, 총 ${u.count}회` : '아직 안 한 루틴'}
            title={u?.lastAt ? new Date(u.lastAt).toLocaleString('ko-KR') : undefined}>
            <div aria-hidden="true">{u ? <>마지막 <b>{when}</b></> : '아직 안 함'}</div>{u && <div aria-hidden="true">총 {u.count}회</div>}
          </div>
        </div>
        <div class="sub small" style={{ marginTop: '4px' }}>{items.length ? `운동 ${items.length}개${r.estimatedSec ? ` · 약 ${minutes(r.estimatedSec)}` : ''}` : '아직 운동이 없어요'}</div>
        {items.length > 0 && <div class="pill routine-preview">{items.slice(0, 4).map((i) => nameOf(i.exerciseId)).join(', ')}{items.length > 4 ? ` 외 ${items.length - 4}개` : ''}</div>}
        <div class="row" style={{ marginTop: '10px' }}>
          {isHidden ? <>
            <button class="grow" onClick={async () => { await setRoutineHidden(r.id, false); setToast({ text: `「${r.name}」 루틴을 다시 보이게 했어요` }); }} aria-label={`${r.name} 다시 보이기`}>다시 보이기</button>
            <button class="danger" onClick={async () => { if (await askConfirm({ title: '루틴을 완전히 지울까요?', message: `「${r.name}」 · 되돌릴 수 없어요. 운동 기록은 남아요.`, ok: '완전 삭제', danger: true })) await removeForever(r); }} aria-label={`${r.name} 완전 삭제`}>완전 삭제</button>
          </> : <>
            {items.length
              ? <button class="primary grow" onClick={() => startRoutine(s, r)} aria-label={`${r.name} 시작`}><Icon name="play" size={18} />시작</button>
              /* 운동이 없는 루틴: 시작 대신 운동 넣기 */
              : <button class="grow" onClick={() => edit(r)} aria-label={`${r.name} 운동 넣기`}>+ 운동 넣기</button>}
            {/* 운동 탭(고르기)은 편집만 바로 (D-053), 홈·내 루틴은 ⋯ 안에 편집·지우기 (D-055) */}
            {mode === 'pick'
              ? items.length > 0 && <button onClick={() => edit(r)} aria-label={`${r.name} 편집`}>편집</button>
              : <button class="icon-btn round" onClick={() => setMenu(r)} aria-label={`${r.name} 메뉴`} aria-haspopup="dialog"><Icon name="more" /></button>}
          </>}
        </div>
      </div>
    );
  };

  return (
    <section class="routine-list" aria-label="내 루틴">
      {(showSearch || showSort) && (
        <div class="routine-tools">
          {showSearch && <div class="row search-row">
            <input placeholder="루틴·운동·부위 검색 (초성 가능)" value={q} aria-label="루틴 검색" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            {q && <button class="ghost" aria-label="검색어 지우기" onClick={() => setQ('')}>✕</button>}
          </div>}
          {showSort && <div class="row wrap" role="group" aria-label="정렬" style={{ marginTop: '6px' }}>
            {(Object.keys(SORT_LABEL) as RoutineSort[]).map((k) => <button key={k} class={`chip ${sort === k ? 'on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{SORT_LABEL[k]}</button>)}
          </div>}
        </div>
      )}
      {!visible.length && (
        <Empty label="루틴 없음" text={hidden.length ? `보이는 루틴이 없어요 (숨긴 루틴 ${hidden.length}개)` : '아직 루틴이 없어요'}
          hint={hidden.length ? undefined : '플랜 만들기에서 부위·시간을 고르면 자동으로 짜 드려요'}>
          {hidden.length > 0 && mode !== 'all' && <button onClick={() => go('#/routines?hidden')}>숨긴 루틴 보기</button>}
          {!hidden.length && <><button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button><button onClick={() => void newRoutine()}>+ 직접 만들기</button></>}
        </Empty>
      )}
      {visible.length > 0 && !shown.length && <Empty label="검색 결과 없음" text={`"${q}"에 맞는 루틴이 없어요`} hint="다른 이름·부위로 찾아보세요" />}
      <div class="wide-cards">{shown.map((r) => card(r))}</div>
      {mode === 'home' && visible.length > 0 && (sorted.length > 3 || hidden.length > 0) && (
        <button class="big" onClick={() => go('#/routines')}>내 루틴 모두 보기 ({visible.length}개{hidden.length ? ` · 숨김 ${hidden.length}개` : ''})</button>
      )}
      {mode === 'all' && hidden.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <button class="ghost" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>{showHidden ? '▾' : '▸'} 숨긴 루틴 {hidden.length}개</button>
          {showHidden && <div class="wide-cards">{sortRoutines(hidden, use, 'name').map((r) => card(r, true))}</div>}
        </div>
      )}
      {menu && <MenuSheet title={menu.name} onClose={() => setMenu(null)} items={[
        { label: '편집', aria: `${menu.name} 편집`, run: () => edit(menu) },
        { label: '지우기…', aria: `${menu.name} 지우기`, danger: true, run: () => void remove(menu) },
      ]} />}
      {/* 결과 알림: 화면 아래 고정, 숨기기는 [되돌리기] (7초 뒤 사라짐) */}
      <div class="sr-only" role="status" aria-live="polite">{toast?.text ?? ''}</div>
      {toast && (
        <div class={`toast${activeOf(s) ? ' above-banner' : ''}`}>
          <span>{toast.text}</span>
          {toast.undo && <button ref={undoRef} class="ghost" onClick={() => void toast.undo!()}>되돌리기</button>}
        </div>
      )}
    </section>
  );
}

/** #/routines: 내 루틴 전체 (검색·정렬·숨긴 루틴) */
export function RoutinesScreen({ s }: { s: AppState }) {
  return (
    <main>
      <ScreenHeader back={{ label: '홈', onClick: () => go('#/') }} title="내 루틴">
        <div class="row head-actions"><button onClick={() => void newRoutine()}>+ 직접</button><button class="primary" onClick={() => go('#/plan')}>+ 플랜</button></div>
      </ScreenHeader>
      <RoutineList s={s} mode="all" />
    </main>
  );
}
