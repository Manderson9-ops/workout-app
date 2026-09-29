import { useState } from 'preact/hooks';
import { plateCalc, oneRMTable } from '../../core/stats';
import { NumInput, Sheet } from '../components';

const BARS = [20, 15, 10, 0];
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export function PlateCalculator({ initial }: { initial?: number }) {
  const [target, setTarget] = useState<number | undefined>(initial ?? 60);
  const [bar, setBar] = useState(() => Number(localStorage.getItem('tools.bar') ?? 20));
  const [have, setHave] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem('tools.plates') ?? '') as number[]; } catch { return PLATES; } });
  const r = target !== undefined ? plateCalc(target, bar, have) : undefined;
  return (
    <div>
      <label>목표 무게</label>
      <NumInput label="원판 계산 목표 무게" value={target} suffix="kg" onChange={setTarget} />
      <label>바 무게</label>
      <div class="row wrap">{BARS.map((b) => <button key={b} class={`chip ${bar === b ? 'on' : ''}`} aria-pressed={bar === b} onClick={() => { setBar(b); localStorage.setItem('tools.bar', String(b)); }}>{b ? `${b}kg` : '바 없음'}</button>)}</div>
      <label>있는 원판</label>
      <div class="row wrap">{PLATES.map((p) => {
        const on = have.includes(p);
        return <button key={p} class={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { const n = on ? have.filter((x) => x !== p) : [...have, p]; setHave(n); localStorage.setItem('tools.plates', JSON.stringify(n)); }}>{p}</button>;
      })}</div>
      {r && (
        <div class="card" aria-live="polite" aria-label="원판 계산 결과">
          {r.remainder < 0 ? <p>바({bar}kg)만으로도 목표보다 무거워요</p> : (
            <>
              <p style={{ fontSize: '18px' }}><strong>한쪽에: {r.perSide.length ? r.perSide.join(' + ') : '원판 없음'}</strong></p>
              <p class="sub small">합계 {r.achieved}kg{r.remainder > 0 ? ` (목표보다 ${r.remainder}kg 가벼움: 있는 원판으로 정확히 못 만듦)` : ''}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function OneRMCalculator() {
  const [w, setW] = useState<number | undefined>(80);
  const [reps, setReps] = useState<number | undefined>(5);
  const t = w && reps ? oneRMTable(w, reps) : undefined;
  return (
    <div>
      <div class="grid2">
        <div><label>무게</label><NumInput label="1RM 계산 무게" value={w} suffix="kg" onChange={setW} /></div>
        <div><label>횟수</label><NumInput integer label="1RM 계산 횟수" value={reps} suffix="회" onChange={setReps} /></div>
      </div>
      {t && (
        <div class="card" aria-label="1RM 계산 결과">
          <p style={{ fontSize: '18px' }}><strong>추정 1RM {t.oneRM}kg</strong> <span class="sub small">(Epley 공식 추정, 10회 넘으면 오차 커짐)</span></p>
          <div class="grid2 small">{t.rows.map((r) => <div key={r.pct}>{r.pct}% · {r.kg}kg · 약 {r.reps}회</div>)}</div>
        </div>
      )}
    </div>
  );
}

export function ToolsScreen() {
  return (
    <main>
      <h1>도구</h1>
      <h2>원판 계산기</h2>
      <PlateCalculator />
      <h2>1RM 계산기</h2>
      <OneRMCalculator />
    </main>
  );
}

export function PlateSheet({ weight, onClose }: { weight?: number; onClose: () => void }) {
  return <Sheet title="원판 계산기" onClose={onClose}><PlateCalculator initial={weight} /></Sheet>;
}
