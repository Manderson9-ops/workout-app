import { useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, flushPending } from '../store';
import { catalog } from '../catalog';
import { summarize, weeklyPartSets, weeklyTotals, plannedVsActual, monthDays, weekStreak, localDate, weekStart, addDays, weekSummary, durText, durParts } from '../../core/stats';
import type { WorkoutSummary } from '../../core/stats';
import { BW_MIN, BW_MAX } from '../../core/backup';
import { PARTS } from '../../core/types';
import type { Exercise } from '../../core/types';
import type { Workout } from '../../core/session';
import { BodyHeat } from '../bodyMapView';
import { LineChart, BarChart } from '../charts';
import { NumInput, Empty, Metric } from '../components';
import { ScreenHeader } from '../header';
import { WorkoutCard, shortPart } from './WorkoutCard';
import { startRoutine, setHomeHidden } from '../actions';
import { newId, softDelete } from '../../db/db';
import type { Routine } from '../../core/session';
import { HOME_HIDDEN_LABEL } from '../../core/session';
import { go } from '../nav';
import { askConfirm } from '../confirm';

const WD = ['일', '월', '화', '수', '목', '금', '토']; // 주는 일요일 시작 (D-054)
const md = (d: string) => d.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
const wdClass = (i: number) => (i === 0 ? 'sun' : i === 6 ? 'sat' : '');
const ymd = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y!, m! - 1, dd!); };
const weekRange = (ws: string) => `${md(ws)}~${md(addDays(ws, 6))}`;
const MAX_WEEKS_BACK = 11; // 이번 주 포함 12주
const MARK = 10; // 연구 참고선 (부위당 주 10세트)

/** 지난주 같은 요일까지와의 차이. 화면에는 기호, 화면 읽기에는 문장 (기호는 aria-hidden) */
function Delta({ cur, prev, unit = '', fmt }: { cur: number; prev: number; unit?: string; fmt?: (absDiff: number) => string }) {
  const abs = Math.abs(cur - prev);
  if (cur === prev) return <span class="delta"><span aria-hidden="true">–</span><span class="sr-only">지난주와 같음</span></span>;
  const txt = fmt ? fmt(abs) : `${abs.toLocaleString()}${unit}`;
  return cur > prev
    ? <span class="delta up"><span aria-hidden="true">▲{txt}</span><span class="sr-only">지난주보다 {txt} 많음</span></span>
    : <span class="delta"><span aria-hidden="true">▼{txt}</span><span class="sr-only">지난주보다 {txt} 적음</span></span>;
}

function ThisWeek({ done, byId, today, bw }: { done: Workout[]; byId: Map<string, Exercise>; today: string; bw: AppState['bodyweight'] }) {
  const ws = weekStart(today);
  const cur = weekSummary(done, byId, ws, bw);
  const prev = weekSummary(done, byId, addDays(ws, -7), bw, addDays(today, -7)); // 지난주 일요일 ~ 오늘과 같은 요일까지
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  // D-055: 홈과 같은 Metric (큰 숫자 + 작은 단위, 아래 증감)
  const tiles: { k: string; parts: [string | number, string][]; d: preact.JSX.Element }[] = [
    { k: '운동', parts: [[cur.count, '회']], d: <Delta cur={cur.count} prev={prev.count} /> },
    { k: '작업 세트', parts: [[cur.sets, '세트']], d: <Delta cur={cur.sets} prev={prev.sets} /> },
    { k: '볼륨', parts: [[cur.volume.toLocaleString(), 'kg']], d: <Delta cur={cur.volume} prev={prev.volume} unit="kg" /> },
    { k: '시간', parts: durParts(cur.durationSec), d: <Delta cur={cur.durationSec} prev={prev.durationSec} fmt={durText} /> },
  ];
  return (
    <>
      <h2>이번 주</h2>
      <div class="card" data-testid="this-week">
        <div class="daystrip" role="list" aria-label="이번 주 운동한 날">
          {days.map((d, i) => {
            const did = cur.days.has(d);
            const cls = `daydot ${did ? 'did' : ''} ${d === today ? 'is-today' : ''} ${d > today ? 'future' : ''}`;
            return (
              <div key={d} role="listitem" class={cls} aria-label={`${WD[i]}요일 ${Number(d.slice(8))}일${did ? ' 운동함' : ''}${d === today ? ' 오늘' : ''}`}>
                <span class={`wd ${wdClass(i)}`} aria-hidden="true">{WD[i]}</span>
                <span class="dn" aria-hidden="true">{Number(d.slice(8))}</span>
              </div>
            );
          })}
        </div>
        <div class="tiles">
          {tiles.map((t) => (
            <div class="tile" key={t.k}>
              <Metric label={t.k} parts={t.parts} statusClass="tile-delta">{t.d}</Metric>
            </div>
          ))}
        </div>
        <p class="sub small" style={{ margin: '8px 0 0' }}>▲▼ = 지난주 같은 요일({WD[0]}{ymd(today).getDay() > 0 ? `~${WD[ymd(today).getDay()]}` : ''})까지와 비교 · 연속 {weekStreak(done, today)}주 · 일요일~토요일 기준</p>
      </div>
    </>
  );
}

function PartSets({ done, byId, today }: { done: Workout[]; byId: Map<string, Exercise>; today: string }) {
  const [off, setOff] = useState(0);
  const thisWs = weekStart(today);
  const ws = addDays(thisWs, -7 * off);
  const parts = weeklyPartSets(done, byId, ws, 1)[0]!.parts;
  const prevParts = weeklyPartSets(done, byId, addDays(ws, -7), 1)[0]!.parts;
  const total = PARTS.reduce((s, p) => s + parts[p], 0);
  const prevTotal = PARTS.reduce((s, p) => s + prevParts[p], 0);
  const rows = [...PARTS].sort((a, b) => parts[b] - parts[a]);
  const scale = Math.max(12, ...PARTS.map((p) => parts[p]));
  const prevTop = [...PARTS].filter((p) => prevParts[p] > 0).sort((a, b) => prevParts[b] - prevParts[a]).slice(0, 3);
  const label = off === 0 ? '이번 주' : off === 1 ? '지난주' : weekRange(ws);
  const weeks = weeklyPartSets(done, byId, today, 4);
  const activeParts = PARTS.filter((p) => weeks.some((w) => w.parts[p] > 0));
  return (
    <>
      <h2>부위별 세트</h2>
      <div class="card" data-testid="part-sets">
        <div class="row between">
          <button aria-label="이전 주" disabled={off >= MAX_WEEKS_BACK} onClick={() => setOff(off + 1)}>‹</button>
          <strong aria-live="polite" data-testid="part-week">{label}{off > 1 ? '' : <span class="sub small"> · {weekRange(ws)}</span>}</strong>
          <button aria-label="다음 주" disabled={off === 0} onClick={() => setOff(off - 1)}>›</button>
        </div>
        {total === 0 ? (
          <div class="empty-week">
            <p>{off === 0 ? '이번 주는 아직 운동이 없어요' : '이 주에는 운동 기록이 없어요'}</p>
            {off === 0 && prevTotal > 0 && <p class="sub small">지난주: {prevTop.map((p) => `${shortPart(p)} ${prevParts[p]}세트`).join(' · ')}</p>}
            {off === 0 && <button class="primary" onClick={() => go('#/workout')}>운동 시작</button>}
          </div>
        ) : (
          <div class="part-grid">
            <div class="part-bars" role="list" aria-label={`${label} 부위별 작업 세트`}>
              <div class="part-row axis" aria-hidden="true"><span /><span class="track"><i class="mark-label" style={{ left: `${(MARK / scale) * 100}%` }}>{MARK}</i></span><span /></div>
              {rows.map((p) => (
                <div class={`part-row${parts[p] === 0 ? ' zero' : ''}`} role="listitem" key={p} data-testid="part-row">
                  <span class="pn">{shortPart(p)}</span>
                  <span class="track" aria-hidden="true"><i class="fill" style={{ width: `${(parts[p] / scale) * 100}%` }} /><i class="mark" style={{ left: `${(MARK / scale) * 100}%` }} /></span>
                  <span class="pv">{parts[p]}세트</span>
                </div>
              ))}
            </div>
            <BodyHeat sets={parts} />
          </div>
        )}
        <p class="sub small part-note">막대의 10 = 연구 참고선이에요(목표·상한 아님): 부위당 주 10세트 이상에서 근육 증가가 더 컸어요 (Schoenfeld 외 2017 메타분석). 그보다 많은 양의 효과는 근거가 적어요. 색 구간(1~4·5~9·10+)과 '주 부위만 세기(웜업 제외)'는 앱 기준이에요.</p>
        {activeParts.length > 0 && (
          <>
            <div class="sub small" style={{ marginTop: '8px' }}>최근 4주</div>
            <table class="trend" aria-label="최근 4주 부위별 작업 세트">
              <thead><tr><th>주</th>{activeParts.map((p) => <th key={p}>{shortPart(p)}</th>)}<th>합계</th></tr></thead>
              <tbody>{weeks.map((w) => <tr key={w.week}><td>{md(w.week)}~</td>{activeParts.map((p) => <td key={p}>{w.parts[p] || '·'}</td>)}<td><strong>{w.total}</strong></td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}

export function Stats({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const done = historyOf(s);
  const wById = new Map(done.map((w) => [w.id, w]));
  const today = localDate(Date.now());
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [day, setDay] = useState<number | null>(null);
  const sums = [...done].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)).map((w) => summarize(w, byId, s.bodyweight)); // 최신순 (저장소 순서에 기대지 않음)
  const hiddenSet = new Set(s.settings.homeHidden ?? []); // 홈에서 뺀 기록 표시 (D-040)
  const totals = weeklyTotals(done, byId, today, 8, s.bodyweight);
  const pva = plannedVsActual(sums);
  const days = monthDays(done, ym.y, ym.m);
  const monthCount = [...days.values()].reduce((a, b) => a + b, 0);
  const first = new Date(ym.y, ym.m - 1, 1);
  const lead = first.getDay(); // 일=0
  const nDays = new Date(ym.y, ym.m, 0).getDate();
  const dateOf = (n: number) => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  const dayList = day ? sums.filter((x) => x.date === dateOf(day) && x.workSets > 0) : [];
  const move = (d: number) => { setDay(null); setYm(({ y, m }) => { const n = new Date(y, m - 1 + d, 1); return { y: n.getFullYear(), m: n.getMonth() + 1 }; }); };
  const card = (x: WorkoutSummary) => <WorkoutCard key={x.id} x={x} w={wById.get(x.id)} byId={byId} hidden={hiddenSet.has(x.id)} />;
  // 최근 30개를 주별로 묶음
  const groups: { ws: string; items: WorkoutSummary[] }[] = [];
  for (const x of sums.slice(0, 30)) {
    const ws = weekStart(x.date);
    const g = groups[groups.length - 1];
    if (g && g.ws === ws) g.items.push(x); else groups.push({ ws, items: [x] });
  }
  const thisWs = weekStart(today);
  const groupTitle = (ws: string) => (ws === thisWs ? '이번 주' : ws === addDays(thisWs, -7) ? '지난주' : `${Number(ws.slice(5, 7))}월 ${Number(ws.slice(8))}일 주`);

  return (
    <main>
      <ScreenHeader title="기록" />
      <ThisWeek done={done} byId={byId} today={today} bw={s.bodyweight} />
      <PartSets done={done} byId={byId} today={today} />

      <h2>운동 기록</h2>
      {!sums.length && <Empty text="아직 끝낸 운동이 없어요" hint="운동을 끝내면 여기에 주별 카드로 쌓여요"><button class="primary" onClick={() => go('#/workout')}>운동 시작</button></Empty>}
      {groups.map((g) => (
        <section key={g.ws} aria-label={groupTitle(g.ws)}>
          <h3 class="wk-head">{groupTitle(g.ws)}</h3>
          {g.items.map(card)}
        </section>
      ))}

      <h2>달력</h2>
      <div class="card">
        <div class="row between">
          <button aria-label="이전 달" onClick={() => move(-1)}>‹</button>
          <strong>{ym.y}년 {ym.m}월 · {ym.y === Number(today.slice(0, 4)) && ym.m === Number(today.slice(5, 7)) ? '이번 달' : '이 달'} {monthCount}회</strong>
          <button aria-label="다음 달" onClick={() => move(1)}>›</button>
        </div>
        <div class="cal-grid">
          {WD.map((d, i) => <div key={d} class={`pill cal-wd ${wdClass(i)}`}>{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: nDays }, (_, i) => {
            const n = i + 1; const c = days.get(n) ?? 0;
            const dt = dateOf(n);
            return (
              <button key={n} class={`cal-day ${wdClass((lead + i) % 7)} ${dt === today ? 'is-today' : ''} ${dt > today ? 'future' : ''} ${day === n ? 'sel' : ''}`}
                aria-label={`${ym.m}월 ${n}일${c ? ` 운동 ${c}회` : ''}`} aria-pressed={day === n} disabled={!c}
                onClick={() => setDay(day === n ? null : n)}>
                <span>{n}</span>{c ? <i class="dot" /> : null}
              </button>
            );
          })}
        </div>
        {dayList.map(card)}
      </div>

      <h2>주간 볼륨</h2>
      <div class="card">
        <BarChart label="최근 8주 주간 볼륨" unit="kg" points={totals.map((t) => ({ label: md(t.week), value: Math.round(t.volume) }))} />
        <p class="sub small">볼륨 = 무게 × 횟수 합계 (웜업 제외). 이번 주 {totals[totals.length - 1]!.sets}세트 · {totals[totals.length - 1]!.count}회 운동</p>
      </div>

      {pva && pva.n >= 2 && (
        <>
          <h2>예상 시간 대비 실제</h2>
          <div class="card" aria-label="예상 시간 대비 실제">
            <p>최근 {pva.n}회 평균: {Math.abs(pva.avgDiffSec) < 60 ? '예상과 거의 같아요' : `예상보다 ${Math.round(Math.abs(pva.avgDiffSec) / 60)}분 ${pva.avgDiffSec > 0 ? '더 걸려요' : '덜 걸려요'}`} <span class="sub small">(실제 ÷ 예상 = {pva.avgRatio})</span></p>
            <BarChart label="최근 운동 실제 시간(분)" unit="분" points={sums.filter((x) => x.plannedSec && x.workSets > 0).slice(0, 8).reverse().map((x) => ({ label: md(x.date), value: Math.round(x.durationSec / 60) }))} />
            <p class="sub small">플랜의 예상 시간과 비교해요. 차이가 계속 크면 알려 주세요 (시간 계산을 고칠 수 있어요).</p>
          </div>
        </>
      )}

      <Bodyweight s={s} today={today} />
    </main>
  );
}

function Bodyweight({ s, today }: { s: AppState; today: string }) {
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState<number | undefined>(undefined);
  // 아이폰은 버튼을 눌러도 입력칸 포커스가 안 빠져서, 저장 직전에 입력 대기분을 먼저 반영하고 ref로 최신 값을 읽음
  const kgRef = useRef<number | undefined | null>(null);
  const [err, setErr] = useState('');
  const sorted = [...s.bodyweight].sort((a, b) => (a.date < b.date ? -1 : 1));
  const existing = s.bodyweight.find((b) => b.date === date)?.kg;
  const save = async () => {
    await flushPending();
    const v = kgRef.current === null ? existing : kgRef.current;
    if (v === undefined || v < BW_MIN || v > BW_MAX) { setErr(`${BW_MIN}~${BW_MAX}kg 사이로 적어 주세요`); return; }
    if (date > today) { setErr('앞으로의 날짜는 적을 수 없어요'); return; }
    setErr('');
    await mutate((d) => d.bodyweight.put({ date, kg: v }));
    setKg(undefined); kgRef.current = null;
  };
  return (
    <>
      <h2>체중</h2>
      <div class="card">
        <input class="date" type="date" aria-label="체중 날짜" style={{ width: '100%', marginBottom: '6px' }} value={date} max={today} onInput={(e) => { setDate((e.target as HTMLInputElement).value || today); setKg(undefined); kgRef.current = null; }} />
        <div class="row">
          <div class="grow" style={{ minWidth: 0 }}><NumInput label="체중" value={kg ?? existing} suffix="kg" onChange={(v) => { kgRef.current = v; setKg(v); }} /></div>
          <button class="primary" onClick={save}>{existing !== undefined ? '고치기' : '기록'}</button>
        </div>
        {err && <p role="alert" class="small" style={{ color: 'var(--bad)' }}>{err}</p>}
        <LineChart label="체중" unit="kg" points={sorted.slice(-30).map((b) => ({ label: md(b.date), value: b.kg }))} />
        {sorted.length > 0 && (
          <details>
            <summary class="small sub" style={{ minHeight: '44px', display: 'flex', alignItems: 'center' }}>체중 기록 {sorted.length}개 보기·지우기</summary>
            {[...sorted].reverse().slice(0, 30).map((b) => (
              <div class="row between small" key={b.date}>
                <span>{b.date} · {b.kg}kg</span>
                <button class="ghost" aria-label={`${b.date} 체중 지우기`} onClick={async () => { if (await askConfirm({ title: '체중 기록을 지울까요?', message: `${b.date} · ${b.kg}kg`, ok: '지우기', danger: true })) void mutate((d) => softDelete(d, 'bodyweight', b.date)); }}>지우기</button>
              </div>
            ))}
          </details>
        )}
        <p class="sub small">맨몸 운동(풀업 등)에 무게를 비워 두면 그날 체중으로 볼륨을 계산해요.</p>
      </div>
    </>
  );
}

export function WorkoutDetail({ s, id }: { s: AppState; id: string }) {
  const w = s.workouts.find((x) => x.id === id);
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  if (!w) return <main><p>기록을 찾을 수 없어요.</p><button onClick={() => go('#/stats')}>기록으로</button></main>;
  const sum = summarize(w, byId, s.bodyweight);
  const asRoutine = (): Routine => ({
    id: newId('r'), name: `${w.name} (다시)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    blocks: w.blocks.map((b) => ({ kind: b.kind, restSec: b.restSec, roundRestSec: b.roundRestSec, transitionSec: b.transitionSec,
      items: b.items.filter((i) => !i.skipped).map((i) => ({ exerciseId: i.exerciseId, sets: Math.max(1, i.sets.filter((x) => !x.warmup).length), reps: i.target.reps, ...(i.target.seconds !== undefined ? { seconds: i.target.seconds } : {}) })) }))
      .filter((b) => b.items.length),
    ...(w.plannedSec ? { estimatedSec: w.plannedSec } : {}),
  });
  return (
    <main>
      <ScreenHeader back={{ label: '기록', onClick: () => go('#/stats') }} title={w.name} />
      <p class="sub">{new Date(w.startedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {durText(sum.durationSec)}{sum.plannedSec ? ` (예상 ${durText(sum.plannedSec)})` : ''}</p>
      <p class="sub small">작업 세트 {sum.workSets} · 볼륨 {sum.volume.toLocaleString()}kg · {PARTS.filter((p) => sum.parts[p]).map((p) => `${p} ${sum.parts[p]}`).join(', ')}</p>
      {w.editedAt && <p class="sub small">{new Date(w.editedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 고침</p>}
      {w.memo && <p>📝 {w.memo}</p>}
      {(s.settings.homeHidden ?? []).includes(w.id) && (
        <div class="card row between" role="note" aria-label={`${HOME_HIDDEN_LABEL} 기록`}>
          <span class="small">홈 "최근 운동"에서 뺀 기록이에요. 기록·통계에는 그대로예요.</span>
          <button onClick={() => void setHomeHidden(w.id, false)}>홈에 다시 보이기</button>
        </div>
      )}
      {w.blocks.map((b, bi) => b.items.map((it, ii) => (
        <div class="card" key={`${bi}-${ii}`}>
          <div class="row between"><strong>{byId.get(it.exerciseId)?.name_ko ?? it.exerciseId}</strong>{it.skipped && <span class="pill">건너뜀</span>}</div>
          {it.sets.map((x, k) => (
            <div class="pill" key={k} style={{ opacity: x.done ? 1 : 0.5 }}>
              {x.warmup ? 'W' : `${it.sets.slice(0, k + 1).filter((z) => !z.warmup).length}`}. {x.weight ?? '-'}kg × {x.seconds ? `${x.seconds}초` : `${x.reps ?? '-'}회`}{x.rir !== undefined ? ` · RIR ${x.rir}` : ''}{x.done ? '' : ' (안 함)'}{x.memo ? ` · 📝 ${x.memo}` : ''}
            </div>
          ))}
          {it.memo && <p class="small">📝 {it.memo}</p>}
        </div>
      )))}
      <div class="row" style={{ marginTop: '10px' }}>
        <button class="primary grow" onClick={async () => { const r = asRoutine(); await mutate((d) => d.routines.put(r)); await startRoutine(s, r); }}>이 운동 다시 하기</button>
        {w.endedAt && !w.pendingMerge && <button onClick={() => go(`#/stats/w/${encodeURIComponent(w.id)}/edit`)}>수정</button>}
        <button class="danger" onClick={async () => { if (await askConfirm({ title: '이 운동 기록을 지울까요?', message: '되돌릴 수 없어요.', ok: '지우기', danger: true })) { await mutate((d) => softDelete(d, 'workouts', w.id)); go('#/stats'); } }}>삭제</button>
      </div>
    </main>
  );
}
