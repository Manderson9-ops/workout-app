import { useRef, useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf, flushPending } from '../store';
import { catalog } from '../catalog';
import { summarize, weeklyPartSets, weeklyTotals, plannedVsActual, monthDays, weekStreak, localDate, weekStart } from '../../core/stats';
import type { WorkoutSummary } from '../../core/stats';
import { BW_MIN, BW_MAX } from '../../core/backup';
import { PARTS } from '../../core/types';
import { LineChart, BarChart } from '../charts';
import { NumInput, mmss } from '../components';
import { startRoutine, setHomeHidden } from '../actions';
import { newId, softDelete } from '../../db/db';
import type { Routine } from '../../core/session';
import { go } from '../nav';
import { askConfirm } from '../confirm';

const WD = ['월', '화', '수', '목', '금', '토', '일'];
const md = (d: string) => d.slice(5).replace('-', '/');
const shortPart = (p: string) => (p === '전완·악력' ? '전완' : p);

export function Stats({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const byId = new Map(all.map((e) => [e.id, e]));
  const done = historyOf(s);
  const today = localDate(Date.now());
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [day, setDay] = useState<number | null>(null);
  const sums = done.map((w) => summarize(w, byId, s.bodyweight));
  const hiddenSet = new Set(s.settings.homeHidden ?? []); // 홈에서 뺀 기록 표시 (D-040)
  const weeks = weeklyPartSets(done, byId, today, 4);
  const thisWeek = weeks[weeks.length - 1]!;
  const totals = weeklyTotals(done, byId, today, 8, s.bodyweight);
  const pva = plannedVsActual(sums);
  const days = monthDays(done, ym.y, ym.m);
  const first = new Date(ym.y, ym.m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const nDays = new Date(ym.y, ym.m, 0).getDate();
  const dayList = day ? sums.filter((x) => x.date === `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`) : [];
  const move = (d: number) => { setDay(null); setYm(({ y, m }) => { const n = new Date(y, m - 1 + d, 1); return { y: n.getFullYear(), m: n.getMonth() + 1 }; }); };
  const thisWeekCount = sums.filter((x) => weekStart(x.date) === weekStart(today)).length;
  const activeParts = PARTS.filter((p) => weeks.some((w) => w.parts[p] > 0));

  return (
    <main>
      <h1>기록</h1>
      <div class="grid2">
        <div class="card" style={{ margin: 0 }}><div class="sub small">이번 주 운동</div><div style={{ fontSize: '24px', fontWeight: 800 }}>{thisWeekCount}회</div></div>
        <div class="card" style={{ margin: 0 }}><div class="sub small">연속</div><div style={{ fontSize: '24px', fontWeight: 800 }}>{weekStreak(done, today)}주</div></div>
      </div>

      <h2>달력</h2>
      <div class="card">
        <div class="row between">
          <button aria-label="이전 달" onClick={() => move(-1)}>‹</button>
          <strong>{ym.y}년 {ym.m}월</strong>
          <button aria-label="다음 달" onClick={() => move(1)}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginTop: '8px', textAlign: 'center' }}>
          {WD.map((d) => <div key={d} class="pill">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: nDays }, (_, i) => {
            const n = i + 1; const c = days.get(n) ?? 0;
            const isToday = `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(n).padStart(2, '0')}` === today;
            return (
              <button key={n} aria-label={`${ym.m}월 ${n}일${c ? ` 운동 ${c}회` : ''}`} aria-pressed={day === n} disabled={!c}
                style={{ minWidth: 0, padding: 0, borderRadius: '10px', background: c ? '#1d4ed8' : 'transparent', borderColor: isToday ? '#eef0f4' : c ? '#1d4ed8' : 'transparent', color: c ? '#fff' : '#9aa3b5', opacity: 1, outline: day === n ? '2px solid #eef0f4' : 'none' }}
                onClick={() => setDay(day === n ? null : n)}>{n}</button>
            );
          })}
        </div>
        {dayList.map((x) => <SummaryRow key={x.id} x={x} hidden={hiddenSet.has(x.id)} />)}
      </div>

      <h2>이번 주 부위별 세트</h2>
      <div class="card">
        <BarChart label="이번 주 부위별 작업 세트" unit="세트" highlightLast={false} points={PARTS.map((p) => ({ label: shortPart(p), value: thisWeek.parts[p] }))} />
        {activeParts.length > 0 && (
          <table class="trend" aria-label="최근 4주 부위별 작업 세트">
            <thead><tr><th>주</th>{activeParts.map((p) => <th key={p}>{shortPart(p)}</th>)}<th>합계</th></tr></thead>
            <tbody>{weeks.map((w) => <tr key={w.week}><td>{md(w.week)}~</td>{activeParts.map((p) => <td key={p}>{w.parts[p] || '·'}</td>)}<td><strong>{w.total}</strong></td></tr>)}</tbody>
          </table>
        )}
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
            <BarChart label="최근 운동 실제 시간(분)" unit="분" points={sums.filter((x) => x.plannedSec).slice(0, 8).reverse().map((x) => ({ label: md(x.date), value: Math.round(x.durationSec / 60) }))} />
            <p class="sub small">플랜의 예상 시간과 비교해요. 차이가 계속 크면 알려 주세요 (시간 계산을 고칠 수 있어요).</p>
          </div>
        </>
      )}

      <Bodyweight s={s} today={today} />

      <h2>운동 기록</h2>
      {!sums.length && <div class="empty">아직 끝낸 운동이 없어요</div>}
      {sums.slice(0, 30).map((x) => <SummaryRow key={x.id} x={x} hidden={hiddenSet.has(x.id)} />)}
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

function SummaryRow({ x, hidden }: { x: WorkoutSummary; hidden: boolean }) {
  const diff = x.plannedSec ? x.durationSec - x.plannedSec : undefined;
  return (
    <button class="list-item" aria-label={`${x.date} ${x.name}${hidden ? ' (홈에서 뺌)' : ''}`} onClick={() => go(`#/stats/w/${encodeURIComponent(x.id)}`)}>
      <div class="grow">
        <div>{x.name} <span class="pill">{md(x.date)}</span>{hidden && <span class="pill">홈에서 뺌</span>}</div>
        <div class="pill">{mmss(x.durationSec)}{diff !== undefined && Math.abs(diff) >= 60 ? ` (예상보다 ${Math.round(Math.abs(diff) / 60)}분 ${diff > 0 ? '김' : '짧음'})` : ''} · 작업 세트 {x.workSets} · 볼륨 {x.volume.toLocaleString()}kg</div>
      </div>
      <span class="sub">›</span>
    </button>
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
      <button class="ghost" onClick={() => go('#/stats')}>← 기록</button>
      <h1>{w.name}</h1>
      <p class="sub">{new Date(w.startedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {mmss(sum.durationSec)}{sum.plannedSec ? ` (예상 ${mmss(sum.plannedSec)})` : ''}</p>
      <p class="sub small">작업 세트 {sum.workSets} · 볼륨 {sum.volume.toLocaleString()}kg · {PARTS.filter((p) => sum.parts[p]).map((p) => `${p} ${sum.parts[p]}`).join(', ')}</p>
      {w.editedAt && <p class="sub small">{new Date(w.editedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 고침</p>}
      {w.memo && <p>📝 {w.memo}</p>}
      {(s.settings.homeHidden ?? []).includes(w.id) && (
        <div class="card row between" role="note" aria-label="홈에서 뺌 기록">
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
