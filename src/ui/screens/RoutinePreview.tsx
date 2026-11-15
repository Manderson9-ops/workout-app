/**
 * D-080: 루틴 미리보기 창과 운동 줄 (루틴 카드·홈 "다음 운동"이 같이 씀).
 * 줄마다 ⇄ 로 그 자리에서 바로 교체 → 루틴에 바로 저장 + 5초 [되돌리기]
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, activeOf } from '../store';
import { catalog } from '../catalog';
import type { Routine } from '../../core/session';
import { routineEstimate } from '../../core/session';
import { swapRoutineItem } from '../../core/routineEdit';
import { lastRecordMap, lastShortText } from '../../core/similar';
import { ExercisePicker, Sheet } from '../components';
import { Icon } from '../icons';

const KIND_LABEL = { single: '일반', superset: '슈퍼세트', compound: '컴파운드 세트' } as const;

/** 운동 줄 목록: 블록 순서대로, 이름 · 세트×횟수 · 지난 기록, 블록 휴식 */
export function RoutineLines({ s, r, onSwap }: { s: AppState; r: Routine; onSwap: (block: number, item: number) => void }) {
  const byId = useMemo(() => new Map(catalog(s.custom).map((e) => [e.id, e])), [s.custom]);
  const last = useMemo(() => lastRecordMap(historyOf(s)), [s.workouts]);
  return (
    <div class="pv-lines" aria-label={`${r.name} 운동 목록`} role="group">
      {r.blocks.map((b, bi) => {
        const group = b.items.length > 1 && b.kind !== 'single';
        return (
          <div class="pv-block" key={bi}>
            {group && <span class="badge kind">{KIND_LABEL[b.kind]} · 번갈아</span>}
            {b.items.map((it, ii) => {
              const name = byId.get(it.exerciseId)?.name_ko ?? it.exerciseId;
              const scheme = it.seconds !== undefined ? `${it.sets}×${it.seconds}초` : `${it.sets}×${it.reps}`;
              return (
                <div class="pv-row" key={ii}>
                  <div class="grow pv-main">
                    <div class="pv-name">{group && <span class="grp-letter">{String.fromCharCode(65 + ii)}. </span>}{name}</div>
                    <div class="pill">{scheme} · {lastShortText(last.get(it.exerciseId))}</div>
                  </div>
                  <button class="icon-btn round pv-swap" aria-label={`${name} 바로 교체`} onClick={() => onSwap(bi, ii)}><Icon name="swap" size={20} /></button>
                </div>
              );
            })}
            <div class="pill pv-rest">{b.kind === 'single' || !group ? `세트 간 휴식 ${b.restSec}초` : `라운드 후 휴식 ${b.roundRestSec}초`}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 루틴 안 운동 바로 교체: ask() → 교체 창(비슷한 운동 포함) → 고르면 루틴에 저장하고 알림.
 * 되돌리기는 이전 루틴 객체를 수정 시각까지 그대로 다시 저장 (바꾸기 자체는 편집 저장처럼 updatedAt = 지금).
 * 동기화는 수정 시각이 아니라 쪽(HLC) 도장으로 앞뒤를 가리므로 (db/sync.ts strip) 시각을 옛 값으로 두어도 덮이지 않음
 */
export function useRoutineSwap(s: AppState) {
  const [pick, setPick] = useState<{ rid: string; b: number; i: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  // 고른 뒤 초점: 바뀐 줄의 ⇄ 버튼 (줄이 새 이름으로 그려지면 옮김)
  const [focusName, setFocusName] = useState<string | null>(null);
  useEffect(() => {
    if (!focusName) return;
    const label = `${focusName} 바로 교체`;
    const el = [...document.querySelectorAll<HTMLElement>('button.pv-swap')].find((x) => x.getAttribute('aria-label') === label);
    if (el) { el.focus({ preventScroll: true }); setFocusName(null); return; }
    const t = setTimeout(() => setFocusName(null), 3000);
    return () => clearTimeout(t);
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const r = pick ? s.routines.find((x) => x.id === pick.rid) : undefined;
  const oldId = pick && r ? r.blocks[pick.b]?.items[pick.i]?.exerciseId : undefined;
  const picker = pick && r && oldId ? (
    <ExercisePicker s={s} all={all} title="운동 교체" from={oldId} part={byId.get(oldId)?.part}
      exclude={r.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
      onClose={() => setPick(null)}
      onPick={(e) => {
        const p = pick;
        setPick(null);
        setFocusName(e.name_ko);
        const swapped = swapRoutineItem(r, p.b, p.i, e);
        if (swapped === r) return;
        const next: Routine = { ...swapped, updatedAt: new Date().toISOString(), estimatedSec: routineEstimate(swapped, byId, s.settings.rest.between) + (r.warmupSec ?? 0) };
        const oldName = byId.get(oldId)?.name_ko ?? oldId;
        void mutate((d) => d.routines.put(next)).then(() => setToast({
          text: `${oldName} → ${e.name_ko}: 바꿨어요`,
          undo: () => { setToast(null); void mutate((d) => d.routines.put(r)); },
        }));
      }} />
  ) : null;
  /** inline = 창 안(시트 위로 가리지 않게 흐름 안에), 아니면 화면 아래 고정 */
  const toastNode = (inline = false) => toast && (
    <div class={inline ? 'pv-toast' : `toast${activeOf(s) ? ' above-banner' : ''}`} role="status">
      <span>{toast.text}</span>
      <button class="ghost" onClick={toast.undo}>되돌리기</button>
    </div>
  );
  return { ask: (rid: string, b: number, i: number) => setPick({ rid, b, i }), picker, busy: !!picker, toast: toastNode };
}

/** 루틴 미리보기 창 (trap). 교체 창이 떠 있는 동안은 이 창을 잠시 내려 초점·Esc 가 한 창에서만 움직이게 함 */
export function RoutinePreview({ s, rid, onClose, onStart, onEdit }: { s: AppState; rid: string; onClose: () => void; onStart: (r: Routine) => void; onEdit: (r: Routine) => void }) {
  const sw = useRoutineSwap(s);
  const r = s.routines.find((x) => x.id === rid);
  if (!r) return null;
  return (
    <>
      {!sw.busy && (
        <Sheet title={`${r.name} 내용`} onClose={onClose} trap>
          <RoutineLines s={s} r={r} onSwap={(b, i) => sw.ask(r.id, b, i)} />
          {sw.toast(true)}
          <div class="row" style={{ marginTop: '12px' }}>
            <button class="primary grow" data-autofocus onClick={() => { onClose(); onStart(r); }} aria-label={`${r.name} 루틴 시작하기`}><Icon name="play" size={18} />시작</button>
            <button class="grow" onClick={() => { onClose(); onEdit(r); }} aria-label={`${r.name} 루틴 편집`}>편집</button>
          </div>
        </Sheet>
      )}
      {sw.picker}
    </>
  );
}
