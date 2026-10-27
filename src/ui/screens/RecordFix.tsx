/**
 * 기록 정리 카드 (한 번만, D-065·D-070·D-072). 기록 탭 맨 위.
 * 앱이 고칠 후보를 목록으로 보여 주고, 사용자가 고른 것만 확인 창을 거쳐 고침 (보통 저장·동기화 경로).
 *  1) 끝난 시각: 마지막 세트 뒤 15분 넘게 지나 끝낸 기록 → 마지막 세트 + 3분
 *  2) 12시간 넘는 기록: 본 묶음(앞 세트와 3시간 안) 마지막 세트 + 3분 (떨어진 세트는 그대로)
 *  3) 완료 세트 0개 기록 → 지우기
 *  4) 웜업으로 보이는 첫 세트(그날 최고 무게의 50% 이하·15회 이상) → W
 * [그대로 두기]나 고르지 않은 항목은 이 기기에 기억해 다시 묻지 않음
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf } from '../store';
import type { Exercise } from '../../core/types';
import type { Workout } from '../../core/session';
import { endFixes, longFixes, emptyFinished, endChangeText } from '../../core/finishTime';
import type { EndFix } from '../../core/finishTime';
import { warmupFixes } from '../../core/warmupGuess';
import type { WarmupFix } from '../../core/warmupGuess';
import { fixEndsIn, deleteEmptyIn, fixWarmupsIn } from '../../db/recordFix';
import { askConfirm } from '../confirm';
import { showToast } from '../toast';
import { focusField } from '../formError';
import { lsGet, lsSet } from '../appName';
import { dateText, timeText, dateTimeText, daysAgo } from '../../core/dateText';

export const FIX_SEEN_KEY = 'recordFix.seen';
function seenList(): string[] {
  try { const v = JSON.parse(lsGet(FIX_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function remember(keys: string[]): void { lsSet(FIX_SEEN_KEY, JSON.stringify([...new Set([...seenList(), ...keys])].slice(-500))); }

const endKey = (k: 'end' | 'long', f: EndFix) => `${k}:${f.id}:${f.endedAt}`;
const emptyKey = (w: Workout) => `empty:${w.id}`;
const warmKey = (f: WarmupFix) => `warm:${f.id}:${f.block}-${f.item}-${f.set}`;
/** 같은 날이면 시각만, 아니면 날짜·시각 (기록 시작 날 기준) */
const at = (iso: string, base: string) => (daysAgo(iso, base) === 0 ? timeText(iso) : dateTimeText(iso, base, { relative: false }));

// ---------- 고치기 (db/recordFix: 저장된 최신 기록을 다시 읽어 다시 계산, 그사이 바뀌었으면 건너뜀) ----------

async function fixEnds(list: EndFix[]): Promise<number> {
  let n = 0;
  await mutate(async (d) => { n = await fixEndsIn(d, list, new Date().toISOString()); });
  return n;
}
async function deleteEmpty(list: Workout[]): Promise<number> {
  let n = 0;
  await mutate(async (d) => { n = await deleteEmptyIn(d, list); });
  return n;
}
async function fixWarmups(list: WarmupFix[]): Promise<number> {
  let n = 0;
  await mutate(async (d) => { n = await fixWarmupsIn(d, list, new Date().toISOString()); });
  return n;
}

// ---------- 화면 ----------

interface Row { key: string; text: string; sub?: string }

function Section({ title, note, rows, okLabel, confirmTitle, confirmMsg, run, onSeen, testId, danger }: {
  title: string; note: string; rows: Row[]; okLabel: string; danger?: boolean; confirmTitle: string; confirmMsg: (n: number) => string;
  run: (keys: Set<string>) => Promise<number>; onSeen: (keys: string[]) => void; testId: string;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const secRef = useRef<HTMLDivElement>(null);
  if (!rows.length) return null;
  const picked = rows.filter((r) => !off.has(r.key));
  const toggle = (k: string) => { const s = new Set(off); if (s.has(k)) s.delete(k); else s.add(k); setOff(s); setErr(false); };
  const go = async () => {
    if (busy) return;
    if (!picked.length) { setErr(true); focusField(secRef.current?.querySelector<HTMLElement>('input[type=checkbox]') ?? null); return; }
    if (!(await askConfirm({ title: confirmTitle, message: `${confirmMsg(picked.length)}\n\n${picked.slice(0, 8).map((r) => `· ${r.text}`).join('\n')}${picked.length > 8 ? `\n외 ${picked.length - 8}건` : ''}`, ok: okLabel }))) return;
    setBusy(true);
    try {
      const n = await run(new Set(picked.map((r) => r.key)));
      onSeen(rows.filter((r) => off.has(r.key)).map((r) => r.key)); // 고르지 않은 것은 다시 묻지 않음
      showToast(`${n}건 고쳤어요`);
    } finally { setBusy(false); }
  };
  return (
    <div class="fix-sec" data-testid={testId} ref={secRef}>
      <h3 class="fix-title">{title} <span class="sub small">{rows.length}건</span></h3>
      <p class="sub small">{note}</p>
      <ul class="fix-list">
        {rows.map((r) => (
          <li key={r.key}>
            <label class="fix-row">
              <input type="checkbox" checked={!off.has(r.key)} onChange={() => toggle(r.key)} />
              <span class="grow"><span>{r.text}</span>{r.sub && <span class="sub small fix-sub">{r.sub}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      {err && <p class="field-err" role="alert" id={`${testId}-err`}>고칠 항목을 1개 이상 골라 주세요</p>}
      <div class="row">
        <button class="grow" disabled={busy} onClick={() => onSeen(rows.map((r) => r.key))}>그대로 두기</button>
        <button class={`${danger ? 'danger' : 'tonal'} grow`} disabled={busy} onClick={() => void go()}>{okLabel} ({picked.length}건)</button>
      </div>
    </div>
  );
}

export function RecordFixCard({ s, byId }: { s: AppState; byId: Map<string, Exercise> }) {
  const [seen, setSeen] = useState(() => new Set(seenList()));
  const onSeen = (keys: string[]) => { if (!keys.length) return; remember(keys); setSeen(new Set(seenList())); };
  const now = Date.now();
  const c = useMemo(() => {
    const h = historyOf(s);
    return { ends: endFixes(h), longs: longFixes(h), empty: emptyFinished(h), warms: warmupFixes(h) };
  }, [s.workouts]);
  const ends = c.ends.filter((f) => !seen.has(endKey('end', f)));
  const longs = c.longs.filter((f) => !seen.has(endKey('long', f)));
  const empty = c.empty.filter((w) => !seen.has(emptyKey(w)));
  const warms = c.warms.filter((f) => !seen.has(warmKey(f)));
  if (!ends.length && !longs.length && !empty.length && !warms.length) return null;
  const day = (iso: string) => dateText(iso, now);
  const name = (id: string) => byId.get(id)?.name_ko ?? id;
  return (
    <section class="card fix-card" aria-label="기록 정리" data-testid="record-fix">
      <div class="card-head"><span class="card-title">기록 정리 (한 번만)</span></div>
      <p class="sub small">예전 기록에서 고치면 좋을 것을 찾았어요. 고를 것만 남기고 확인하면 고쳐요. 그대로 두면 다시 묻지 않아요.</p>
      <Section testId="fix-end" title="끝난 시각이 늦은 기록" note="마지막 세트 뒤 15분 넘게 지나 끝낸 기록이에요. 끝난 시각을 마지막 세트 + 3분으로 바꿔요."
        rows={ends.map((f) => ({ key: endKey('end', f), text: `${day(f.startedAt)} ${f.name}`, sub: `${endChangeText(f)} (마지막 세트 ${at(f.lastAt, f.startedAt)})` }))}
        okLabel="끝난 시각 고치기" confirmTitle="끝난 시각을 고칠까요?" confirmMsg={(n) => `${n}건의 끝난 시각을 마지막 세트 + 3분으로 바꿔요. 세트 기록은 그대로예요.`}
        run={(keys) => fixEnds(ends.filter((f) => keys.has(endKey('end', f))))} onSeen={onSeen} />
      <Section testId="fix-long" title="12시간 넘게 이어진 기록" note="다음 날 체크한 세트처럼 떨어진 세트를 빼고, 이어서 한 세트(앞 세트와 3시간 안) 중 마지막 세트 + 3분으로 끝난 시각을 바꿔요. 떨어진 세트는 지우지 않아요."
        rows={longs.map((f) => ({ key: endKey('long', f), text: `${day(f.startedAt)} ${f.name}`, sub: `${endChangeText(f)}${f.stragglers ? ` · 떨어진 세트 ${f.stragglers}개는 그대로` : ''}` }))}
        okLabel="긴 기록 고치기" confirmTitle="긴 기록의 끝난 시각을 고칠까요?" confirmMsg={(n) => `${n}건의 끝난 시각을 이어서 한 마지막 세트 + 3분으로 바꿔요. 세트 기록은 그대로예요.`}
        run={(keys) => fixEnds(longs.filter((f) => keys.has(endKey('long', f))))} onSeen={onSeen} />
      <Section testId="fix-empty" danger title="완료한 세트가 없는 기록" note="세트를 하나도 완료하지 않은 기록이에요. 지우면 되돌릴 수 없어요."
        rows={empty.map((w) => ({ key: emptyKey(w), text: `${day(w.startedAt)} ${w.name}`, sub: `${at(w.startedAt, w.startedAt)} 시작 · 완료 세트 0개` }))}
        okLabel="지우기" confirmTitle="빈 기록을 지울까요?" confirmMsg={(n) => `완료 세트가 없는 기록 ${n}건을 지워요. 되돌릴 수 없어요.`}
        run={(keys) => deleteEmpty(empty.filter((w) => keys.has(emptyKey(w))))} onSeen={onSeen} />
      <Section testId="fix-warm" title="웜업으로 보이는 첫 세트" note="그날 그 운동 최고 무게의 50% 이하이고 15회 이상인 첫 세트예요. 웜업(W)으로 바꾸면 작업 세트·볼륨에서 빠져요."
        rows={warms.map((f) => ({ key: warmKey(f), text: `${day(f.startedAt)} ${name(f.exerciseId)} ${f.weight}kg × ${f.reps}회`, sub: `그날 최고 ${f.top}kg · ${f.name}` }))}
        okLabel="웜업으로 바꾸기" confirmTitle="웜업으로 바꿀까요?" confirmMsg={(n) => `첫 세트 ${n}개를 웜업(W)으로 바꿔요. 무게·횟수는 그대로예요.`}
        run={(keys) => fixWarmups(warms.filter((f) => keys.has(warmKey(f))))} onSeen={onSeen} />
    </section>
  );
}
