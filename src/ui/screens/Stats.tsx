import { useMemo, useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, flushPending } from '../store';
import { catalog } from '../catalog';
import { summarize, weeklyPartSets, weeklyTotals, plannedVsActual, monthDays, weekStreak, localDate, weekStart, addDays, weekSummary, durText, durParts, partWeekDetail, plannedVsActualRows } from '../../core/stats';
import type { PartWeekRow } from '../../core/stats';
import type { WorkoutSummary } from '../../core/stats';
import { BW_MIN, BW_MAX } from '../../core/backup';
import { PARTS } from '../../core/types';
import type { Exercise, Part } from '../../core/types';
import type { Workout } from '../../core/session';
import { BodyHeat } from '../bodyMapView';
import { recoveryByPart } from '../../core/recovery';
import { RecoveryCard } from './RecoveryCard';
import { lastNight, watchFor, watchLine } from '../../core/health';
import { LineChart, BarChart, PairBarChart } from '../charts';
import { NumInput, Empty, Metric, Delta, Sheet } from '../components';
import { ScreenHeader } from '../header';
import { WorkoutCard, shortPart } from './WorkoutCard';
import { startRoutine, setHomeHidden } from '../actions';
import { newId, softDelete } from '../../db/db';
import type { Routine } from '../../core/session';
import { HOME_HIDDEN_LABEL } from '../../core/session';
import { go } from '../nav';
import { askConfirm } from '../confirm';
import { Icon } from '../icons';
import { axisText, weekRangeText, dateText, dateTimeText, timeText, fullText, fullDateText } from '../../core/dateText';

const WD = ['일', '월', '화', '수', '목', '금', '토']; // 주는 일요일 시작 (D-054)
const ymd = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y!, m! - 1, dd!); };
const md = axisText; // 그래프 축 전용 "10/4" (D-060)
const wdClass = (i: number) => (i === 0 ? 'sun' : i === 6 ? 'sat' : '');
const weekRange = (ws: string) => weekRangeText(ws, Date.now()); // "10월 4일~10일", "9월 27일~10월 3일"
const MAX_WEEKS_BACK = 11; // 이번 주 포함 12주
const MARK = 10; // 연구 참고 범위 아래 끝 (부위당 주 10세트, Schoenfeld 외 2017)
const BAND_HI = 20; // 연구 참고 범위 위 끝 (Baz-Valle 외 2022: 훈련된 남성 12~20세트 제안, 20 넘는 양은 근거가 적음)

function ThisWeek({ done, byId, today, bw }: { done: Workout[]; byId: Map<string, Exercise>; today: string; bw: AppState['bodyweight'] }) {
  const ws = weekStart(today);
  const [cur, prev] = useMemo(() => [weekSummary(done, byId, ws, bw),
    weekSummary(done, byId, addDays(ws, -7), bw, addDays(today, -7))], [done, byId, ws, bw, today]); // 지난주 일요일 ~ 오늘과 같은 요일까지
  const streak = useMemo(() => weekStreak(done, today), [done, today]);
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
      <section class="card" data-testid="this-week">
        <div class="card-head"><span class="card-title">이번 주</span><span class="sub small">{weekRange(ws)}</span></div>
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
        <p class="sub small" style={{ margin: '8px 0 0' }}>▲▼ = 지난주 같은 요일({WD[0]}{ymd(today).getDay() > 0 ? `~${WD[ymd(today).getDay()]}` : ''})까지와 비교 · 연속 {streak}주 · 일요일~토요일 기준</p>
      </section>
    </>
  );
}

function PartSets({ done, byId, today }: { done: Workout[]; byId: Map<string, Exercise>; today: string }) {
  const [off, setOff] = useState(0);
  const thisWs = weekStart(today);
  const ws = addDays(thisWs, -7 * off);
  const [parts, prevParts] = useMemo(() => [weeklyPartSets(done, byId, ws, 1)[0]!.parts, weeklyPartSets(done, byId, addDays(ws, -7), 1)[0]!.parts], [done, byId, ws]);
  const total = PARTS.reduce((s, p) => s + parts[p], 0);
  const prevTotal = PARTS.reduce((s, p) => s + prevParts[p], 0);
  const rows = [...PARTS].sort((a, b) => parts[b] - parts[a]);
  const scale = Math.max(BAND_HI + 2, ...PARTS.map((p) => parts[p]));
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const [sheetPart, setSheetPart] = useState<Part | null>(null);
  const prevTop = [...PARTS].filter((p) => prevParts[p] > 0).sort((a, b) => prevParts[b] - prevParts[a]).slice(0, 3);
  const label = off === 0 ? '이번 주' : off === 1 ? '지난주' : weekRange(ws);
  const weeks = useMemo(() => weeklyPartSets(done, byId, today, 4), [done, byId, today]);
  const activeParts = PARTS.filter((p) => weeks.some((w) => w.parts[p] > 0));
  return (
    <>
      <section class="card" data-testid="part-sets">
        <div class="card-head"><span class="card-title">부위별 세트</span><span class="sub small">누르면 그 부위 운동</span></div>
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
              <div class="part-row axis" aria-hidden="true"><span /><span class="track"><i class="band-label" style={{ left: pct(MARK), width: pct(BAND_HI - MARK) }}>{MARK}~{BAND_HI} 참고</i></span><span /></div>
              {rows.map((p) => (
                <div role="listitem" key={p} class="part-li">
                  {/* 막대 줄을 누르면 그 부위 이번 주 운동 (Fitbod 식). 띠 = 연구 참고 범위 10~20 (Gentler Streak 식, 목표 아님) */}
                  <button class={`part-row${parts[p] === 0 ? ' zero' : ''}`} data-testid="part-row" disabled={parts[p] === 0}
                    aria-label={`${p} ${parts[p]}세트${parts[p] ? ', 이 주 운동 보기' : ''}`} aria-haspopup={parts[p] ? 'dialog' : undefined} onClick={() => setSheetPart(p)}>
                    <span class="pn">{shortPart(p)}</span>
                    <span class="track" aria-hidden="true"><i class="band" style={{ left: pct(MARK), width: pct(BAND_HI - MARK) }} /><i class="fill" style={{ width: pct(parts[p]) }} /></span>
                    <span class="pv">{parts[p]}세트</span>
                  </button>
                </div>
              ))}
            </div>
            <BodyHeat sets={parts} onPart={(p) => { if (parts[p] > 0) setSheetPart(p); }} />
          </div>
        )}
        <p class="sub small part-note">옅은 띠 = 연구 참고 범위 10~20세트예요(목표·상한 아님). 부위당 주 10세트 이상에서 근육 증가가 더 컸고(Schoenfeld 외 2017 메타분석), 훈련된 남성에게 12~20세트를 제안한 리뷰도 있어요(Baz-Valle 외 2022). 20세트보다 많은 양은 근거가 적어요. 색 구간(1~4·5~9·10+)과 '주 부위만 세기(웜업 제외)'는 앱 기준이에요.</p>
        {activeParts.length > 0 && (
          <>
            <div class="sub small trend-head">최근 4주</div>
            <table class="trend" aria-label="최근 4주 부위별 작업 세트">
              <thead><tr><th>주</th>{activeParts.map((p) => <th key={p}>{shortPart(p)}</th>)}<th>합계</th></tr></thead>
              <tbody>{weeks.map((w) => <tr key={w.week}><td>{dateText(w.week, Date.now(), { weekday: false })}~</td>{activeParts.map((p) => <td key={p}>{w.parts[p] || '·'}</td>)}<td><strong>{w.total}</strong></td></tr>)}</tbody>
            </table>
          </>
        )}
      </section>
      {sheetPart && <PartWeekSheet part={sheetPart} rows={partWeekDetail(done, byId, ws, sheetPart)} week={label} onClose={() => setSheetPart(null)} />}
    </>
  );
}

/** 부위 창 (D-055 3단계): 그 주 그 부위로 한 운동·작업 세트·최고 세트, 누르면 기록 상세 */
function PartWeekSheet({ part, rows, week, onClose }: { part: Part; rows: PartWeekRow[]; week: string; onClose: () => void }) {
  const total = rows.reduce((n, r) => n + r.sets, 0);
  // 운동(종목)별 세트 합: 같은 운동을 여러 번 했어도 운동 1개로 센다
  const byEx = new Map<string, { name: string; sets: number }>();
  for (const r of rows) { const x = byEx.get(r.exerciseId) ?? { name: r.name, sets: 0 }; x.sets += r.sets; byEx.set(r.exerciseId, x); }
  return (
    <Sheet title={`${part} · ${week}`} onClose={onClose} trap>
      <p class="sub">작업 세트 {total}개 · 운동 {byEx.size}개 · {rows.length}회 (웜업 제외, 주 부위 기준)</p>
      <ul class="pw-ex" aria-label="운동별 세트">{[...byEx.values()].map((x, i) => <li key={i}><span>{x.name}</span><b>{x.sets}세트</b></li>)}</ul>
      <div class="pw-list">
        {rows.map((r, i) => (
          <button key={i} class="pw-row" onClick={() => { onClose(); go(`#/stats/w/${encodeURIComponent(r.workoutId)}`); }}
            aria-label={`${fullDateText(r.date)} ${r.name} ${r.sets}세트${r.best ? ` 최고 ${r.best}` : ''}, 기록 보기`}>
            <span class="pw-date">{dateText(r.date, Date.now())}</span>
            <span class="grow"><span class="pw-name">{r.name}</span><span class="sub small">{r.workoutName}</span></span>
            <span class="pw-sets"><span class="pw-n"><b>{r.sets}</b><small>세트</small></span>{r.best && <span class="sub small">최고 {r.best}</span>}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function Stats({ s }: { s: AppState }) {
  const today = localDate(Date.now());
  // 0.9.3 성능 관문 (기록 1,000회): 앱은 1초마다 다시 그리므로 무거운 계산은 기록·운동 목록·체중·날짜가 바뀔 때만
  const all = catalog(s.custom);
  const { byId, done, wById, sorted, sumOf, take, totals, pva, pvaRows } = useMemo(() => {
    const byId = new Map(all.map((e) => [e.id, e]));
    const done = historyOf(s);
    const wById = new Map(done.map((w) => [w.id, w]));
    const sorted = [...done].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)); // 최신순 (저장소 순서에 기대지 않음)
    // 요약은 필요한 것만 최신순으로 (기록 1,000회여도 화면에 쓰는 건 최근 30개·예상 대비 10개·고른 날 뿐)
    const cache = new Map<string, WorkoutSummary>();
    const sumOf = (w: Workout) => { let x = cache.get(w.id); if (!x) { x = summarize(w, byId, s.bodyweight); cache.set(w.id, x); } return x; };
    /** 최신순으로 조건에 맞는 요약 n개 (전체를 요약한 뒤 거른 것과 같은 결과) */
    const take = (n: number, ok: (x: WorkoutSummary) => boolean = () => true) => { const out: WorkoutSummary[] = []; for (const w of sorted) { if (out.length >= n) break; const x = sumOf(w); if (ok(x)) out.push(x); } return out; };
    const timed = (x: WorkoutSummary) => !!x.plannedSec && x.durationSec > 0 && x.workSets > 0; // plannedVsActual·plannedVsActualRows 와 같은 조건
    const totals = weeklyTotals(done, byId, today, 8, s.bodyweight);
    return { byId, done, wById, sorted, sumOf, take, totals, pva: plannedVsActual(take(10, timed)), pvaRows: plannedVsActualRows(take(8, timed)) };
  }, [all, s.workouts, s.bodyweight, today]);
  // D-057 회복 상태: 분 단위로 다시 계산 (앱은 1초마다 다시 그림)
  const nowMin = Math.floor(Date.now() / 60_000);
  const rec = useMemo(() => recoveryByPart(done, byId, Date.now()), [done, byId, nowMin]);
  // D-058 어젯밤 수면·안정 심박·HRV (애플워치, 참고. 회복 계산에는 안 씀)
  const night = useMemo(() => lastNight(s.health, Date.now()), [s.health, nowMin]);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [day, setDay] = useState<number | null>(null);
  const hiddenSet = new Set(s.settings.homeHidden ?? []); // 홈에서 뺀 기록 표시 (D-040)
  const days = useMemo(() => monthDays(done, ym.y, ym.m), [done, ym.y, ym.m]);
  const monthCount = [...days.values()].reduce((a, b) => a + b, 0);
  const first = new Date(ym.y, ym.m - 1, 1);
  const lead = first.getDay(); // 일=0
  const nDays = new Date(ym.y, ym.m, 0).getDate();
  const dateOf = (n: number) => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  const dayList = day ? sorted.filter((w) => localDate(w.startedAt) === dateOf(day)).map(sumOf).filter((x) => x.workSets > 0) : [];
  const move = (d: number) => { setDay(null); setYm(({ y, m }) => { const n = new Date(y, m - 1 + d, 1); return { y: n.getFullYear(), m: n.getMonth() + 1 }; }); };
  const card = (x: WorkoutSummary) => <WorkoutCard key={x.id} x={x} w={wById.get(x.id)} byId={byId} hidden={hiddenSet.has(x.id)} health={s.health} />;
  // 최근 30개를 주별로 묶음
  const groups: { ws: string; items: WorkoutSummary[] }[] = [];
  for (const x of take(30)) {
    const ws = weekStart(x.date);
    const g = groups[groups.length - 1];
    if (g && g.ws === ws) g.items.push(x); else groups.push({ ws, items: [x] });
  }
  const thisWs = weekStart(today);
  const groupTitle = (ws: string) => (ws === thisWs ? '이번 주' : ws === addDays(thisWs, -7) ? '지난주' : weekRange(ws));

  return (
    <main>
      <ScreenHeader title="기록" />
      <ThisWeek done={done} byId={byId} today={today} bw={s.bodyweight} />
      <RecoveryCard m={rec} night={night} />
      <PartSets done={done} byId={byId} today={today} />

      <h2>운동 기록</h2>
      {!sorted.length && <Empty text="아직 끝낸 운동이 없어요" hint="운동을 끝내면 여기에 주별 카드로 쌓여요"><button class="primary" onClick={() => go('#/workout')}>운동 시작</button></Empty>}
      {groups.map((g) => (
        <section key={g.ws} aria-label={groupTitle(g.ws)}>
          <h3 class="wk-head">{groupTitle(g.ws)}</h3>
          {g.items.map(card)}
        </section>
      ))}

      <section class="card">
        <div class="card-head"><span class="card-title">달력</span></div>
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
      </section>

      <section class="card">
        <div class="card-head"><span class="card-title">주간 볼륨</span><span class="sub small">최근 8주</span></div>
        <BarChart label="최근 8주 주간 볼륨" unit="kg" points={totals.map((t) => ({ label: md(t.week), value: Math.round(t.volume) }))} />
        <p class="sub small">볼륨 = 무게 × 횟수 합계 (웜업 제외). 이번 주 {totals[totals.length - 1]!.sets}세트 · {totals[totals.length - 1]!.count}회 운동</p>
      </section>

      {pva && pva.n >= 2 && (
        <>
          <section class="card" aria-label="예상 시간 대비 실제">
            <div class="card-head"><span class="card-title">예상 시간 대비 실제</span></div>
            <p>최근 {pva.n}회 평균: {Math.abs(pva.avgDiffSec) < 60 ? '예상과 거의 같아요' : `예상보다 ${Math.round(Math.abs(pva.avgDiffSec) / 60)}분 ${pva.avgDiffSec > 0 ? '더 걸려요' : '덜 걸려요'}`} <span class="sub small">(실제 ÷ 예상 = {pva.avgRatio})</span></p>
            <PairBarChart label="최근 운동 예상 대비 실제 시간" unit="분" points={pvaRows.map((r) => ({ label: r.label, planned: r.plannedMin, actual: r.actualMin }))} />
            <p class="sub small">플랜의 예상 시간과 비교해요. 차이가 계속 크면 알려 주세요 (시간 계산을 고칠 수 있어요).</p>
          </section>
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
      <section class="card">
        <div class="card-head"><span class="card-title">체중</span></div>
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
                <span>{dateText(b.date, Date.now())} · {b.kg}kg</span>
                <button class="ghost" aria-label={`${fullDateText(b.date)} 체중 지우기`} onClick={async () => { if (await askConfirm({ title: '체중 기록을 지울까요?', message: `${dateText(b.date, Date.now())} · ${b.kg}kg`, ok: '지우기', danger: true })) void mutate((d) => softDelete(d, 'bodyweight', b.date)); }}>지우기</button>
              </div>
            ))}
          </details>
        )}
        <p class="sub small">맨몸 운동(풀업 등)에 무게를 비워 두면 그날 체중으로 볼륨을 계산해요.</p>
      </section>
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
      <p class="sub" aria-label={`${fullText(w.startedAt)}부터 ${durText(sum.durationSec)}`}>{dateTimeText(w.startedAt, Date.now(), { relative: false })}{w.endedAt ? `~${timeText(w.endedAt)}` : ''} · {durText(sum.durationSec)}{sum.plannedSec ? ` (예상 ${durText(sum.plannedSec)})` : ''}</p>
      <p class="sub small">작업 세트 {sum.workSets} · 볼륨 {sum.volume.toLocaleString()}kg · {PARTS.filter((p) => sum.parts[p]).map((p) => `${p} ${sum.parts[p]}`).join(', ')}</p>
      {w.editedAt && <p class="sub small">{dateTimeText(w.editedAt, Date.now())}에 고침</p>}
      {w.memo && <p class="memo-line"><Icon name="note" size={16} />{w.memo}</p>}
      {(() => { const x = watchFor(w, s.health); return x ? <p class="wc-watch detail" data-testid="detail-watch"><Icon name="heart" size={16} />{watchLine(x)}</p> : null; })()}
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
              {x.warmup ? 'W' : `${it.sets.slice(0, k + 1).filter((z) => !z.warmup).length}`}. {x.weight ?? '-'}kg × {x.seconds ? `${x.seconds}초` : `${x.reps ?? '-'}회`}{x.rir !== undefined ? ` · RIR ${x.rir}` : ''}{x.done ? '' : ' (안 함)'}{x.memo ? ` · 메모: ${x.memo}` : ''}
            </div>
          ))}
          {it.memo && <p class="small memo-line"><Icon name="note" size={14} />{it.memo}</p>}
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
