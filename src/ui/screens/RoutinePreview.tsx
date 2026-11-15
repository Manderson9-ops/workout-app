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

/** 교체를 시작한 곳: 미리보기 창 안 / 홈 카드 (초점 찾기를 그 안으로 한정) */
export type SwapCtx = 'preview' | 'home';
const KIND_LABEL = { single: '일반', superset: '슈퍼세트', compound: '컴파운드 세트' } as const;

/** 운동 줄 목록: 블록 순서대로, 이름 · 세트×횟수 · 지난 기록, 블록 휴식 */
export function RoutineLines({ s, r, ctx, onSwap }: { s: AppState; r: Routine; ctx: SwapCtx; onSwap: (block: number, item: number) => void }) {
  const byId = useMemo(() => new Map(catalog(s.custom).map((e) => [e.id, e])), [s.custom]);
  const last = useMemo(() => lastRecordMap(historyOf(s)), [s.workouts]);
  return (
    <div class="pv-lines" aria-label={`${r.name} 운동 목록`} role="group" data-rid={r.id} data-ctx={ctx}>
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
                  <button class="icon-btn round pv-swap" aria-label={`${name} 바로 교체`} aria-haspopup="dialog" onClick={() => onSwap(bi, ii)}><Icon name="swap" size={20} /></button>
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
export function useRoutineSwap(s: AppState, ctx: SwapCtx) {
  const [pick, setPick] = useState<{ rid: string; b: number; i: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  // 초점: 줄이 새 이름으로 그려지면(저장 뒤) 그 줄의 ⇄ 로 옮기고 화면 가운데로 스크롤 (창이 다시 열리며 맨 위로 올라간 뒤에)
  // scroll = 고르기·되돌리기 뒤에는 바뀐 줄을 화면 가운데로, 그냥 닫았을 때는 스크롤 없이 초점만
  const [focus, setFocus] = useState<{ rid: string; name: string; scroll: boolean } | null>(null);
  // 화면 읽기 알림 문장 (알림칸이 다시 그려져도 같은 문장이 남도록 알림 창 상태와 따로 쥠)
  const [say, setSay] = useState('');
  useEffect(() => {
    if (!focus || pick) return;
    const host = [...document.querySelectorAll<HTMLElement>('[data-rid][data-ctx]')].find((x) => x.dataset.rid === focus.rid && x.dataset.ctx === ctx && (ctx === 'home' || x.closest('.sheet')));
    const label = `${focus.name} 바로 교체`;
    const el = host && [...host.querySelectorAll<HTMLElement>('button.pv-swap')].find((x) => x.getAttribute('aria-label') === label);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (focus.scroll) el.scrollIntoView({ block: 'center' });
    setFocus(null);
  }, [focus, pick, s.routines]);
  // 줄을 못 찾으면 3초 뒤 포기
  useEffect(() => { if (!focus) return; const t = setTimeout(() => setFocus(null), 3000); return () => clearTimeout(t); }, [focus]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!say) return; const t = setTimeout(() => setSay(''), 5000); return () => clearTimeout(t); }, [say]);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const r = pick ? s.routines.find((x) => x.id === pick.rid) : undefined;
  const oldId = pick && r ? r.blocks[pick.b]?.items[pick.i]?.exerciseId : undefined;
  const picker = pick && r && oldId ? (
    <ExercisePicker s={s} all={all} title="운동 교체" from={oldId} part={byId.get(oldId)?.part}
      exclude={r.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))}
      onClose={() => { setPick(null); setFocus({ rid: r.id, name: byId.get(oldId)?.name_ko ?? oldId, scroll: false }); }}
      onPick={(e) => {
        const p = pick;
        setPick(null);
        const swapped = swapRoutineItem(r, p.b, p.i, e);
        // 바뀐 게 없으면 새 이름 줄을 기다리지 않고 연 ⇄ 로 바로 돌아감
        if (swapped === r) { setFocus({ rid: r.id, name: byId.get(oldId)?.name_ko ?? oldId, scroll: false }); return; }
        setFocus({ rid: r.id, name: e.name_ko, scroll: true });
        const next: Routine = { ...swapped, updatedAt: new Date().toISOString(), estimatedSec: routineEstimate(swapped, byId, s.settings.rest.between) + (r.warmupSec ?? 0) };
        const oldName = byId.get(oldId)?.name_ko ?? oldId;
        void mutate((d) => d.routines.put(next)).then(() => {
          const text = `${oldName} → ${e.name_ko}: 바꿨어요`;
          setSay(text);
          setToast({ text, undo: () => { setToast(null); setSay(`되돌렸어요: ${oldName}`); setFocus({ rid: r.id, name: oldName, scroll: true }); void mutate((d) => d.routines.put(r)); } });
        });
      }} />
  ) : null;
  /** inline = 창 안(흐름 안에 붙여 창을 스크롤해도 아래에 남음), 아니면 화면 아래 고정. 글자는 눈에만 (읽기는 live) */
  const toastNode = (inline = false) => toast && (
    <div class={inline ? 'pv-toast' : `toast${activeOf(s) ? ' above-banner' : ''}`}>
      <span aria-hidden="true">{toast.text}</span>
      <button class="ghost" onClick={toast.undo}>되돌리기</button>
    </div>
  );
  /** 화면 읽기 알림칸 (MyRoutines 와 같은 방식). 미리보기 창은 고르기 동안 내려갔다 다시 떠서 알림칸이 새로 만들어지므로 조금 늦게 채움 */
  const live = <LiveRegion text={say} delay={ctx === 'preview'} />;
  return { ask: (rid: string, b: number, i: number) => setPick({ rid, b, i }), picker, busy: !!picker, hasToast: !!toast, toast: toastNode, live };
}

/**
 * 화면 읽기 알림칸. delay = 새로 그려진 칸에 글자를 바로 넣으면 읽히지 않으므로 빈 칸으로 먼저 그리고 0.4초 뒤에 채움
 * (타이머는 하나, 글자가 바뀌거나 사라지면 정리)
 */
function LiveRegion({ text, delay }: { text: string; delay: boolean }) {
  const [shown, setShown] = useState(delay ? '' : text);
  useEffect(() => {
    if (!delay) { setShown(text); return; }
    setShown('');
    if (!text) return;
    const t = setTimeout(() => setShown(text), 400);
    return () => clearTimeout(t);
  }, [text, delay]);
  return <span class="sr-only" role="status" aria-live="polite">{shown}</span>;
}

/** 루틴 미리보기 창 (trap). 교체 창이 떠 있는 동안은 이 창을 잠시 내려 초점·Esc 가 한 창에서만 움직이게 함 */
export function RoutinePreview({ s, rid, onClose, onStart, onEdit }: { s: AppState; rid: string; onClose: () => void; onStart: (r: Routine) => void; onEdit: (r: Routine) => void }) {
  const sw = useRoutineSwap(s, 'preview');
  const r = s.routines.find((x) => x.id === rid);
  if (!r) return null;
  return (
    <>
      {!sw.busy && (
        <Sheet title={`${r.name} 내용`} onClose={onClose} trap cls={sw.hasToast ? 'has-toast' : undefined}>
          <RoutineLines s={s} r={r} ctx="preview" onSwap={(b, i) => sw.ask(r.id, b, i)} />
          {sw.toast(true)}
          {sw.live}
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
