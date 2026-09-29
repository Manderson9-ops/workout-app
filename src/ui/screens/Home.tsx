import type { AppState } from '../store';
import { mutate, activeOf, historyOf } from '../store';
import { catalog } from '../catalog';
import { startRoutine } from '../actions';
import { minutes, mmss } from '../components';
import { go } from '../nav';

export function Home({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const name = (id: string) => all.find((e) => e.id === id)?.name_ko ?? id;
  const active = activeOf(s);
  const recent = historyOf(s).slice(0, 5);
  return (
    <main>
      <h1>운동 기록</h1>
      {active && (
        <div class="card active">
          <div class="row between"><h3>운동 중: {active.name}</h3><span class="sub">{mmss((Date.now() - Date.parse(active.startedAt)) / 1000)}</span></div>
          <button class="primary big" onClick={() => go('#/workout')}>계속하기</button>
        </div>
      )}
      <div class="row between"><h2>내 루틴</h2><button class="primary" onClick={() => go('#/plan')}>+ 플랜 만들기</button></div>
      {!s.routines.length && (
        <div class="empty">
          <p>아직 루틴이 없어요.</p>
          <p class="small">플랜 만들기에서 부위·등급·시간을 고르면 자동으로 짜 드려요.</p>
        </div>
      )}
      {s.routines.map((r) => (
        <div class="card" key={r.id}>
          <div class="row between">
            <div class="grow">
              <h3>{r.name}</h3>
              <div class="sub small">{r.blocks.length}블록 · 운동 {r.blocks.reduce((n, b) => n + b.items.length, 0)}개{r.estimatedSec ? ` · 약 ${minutes(r.estimatedSec)}` : ''}</div>
              <div class="pill">{r.blocks.flatMap((b) => b.items.map((i) => name(i.exerciseId))).slice(0, 4).join(', ')}{r.blocks.flatMap((b) => b.items).length > 4 ? ' …' : ''}</div>
            </div>
          </div>
          <div class="row" style={{ marginTop: '8px' }}>
            <button class="primary grow" onClick={() => startRoutine(s, r)} aria-label={`${r.name} 시작`}>시작</button>
            <button onClick={() => go(`#/routine/${encodeURIComponent(r.id)}`)}>편집</button>
            <button class="danger" onClick={async () => { if (confirm(`"${r.name}" 루틴을 지울까요? 운동 기록은 남아요.`)) await mutate((d) => d.routines.delete(r.id)); }} aria-label={`${r.name} 삭제`}>삭제</button>
          </div>
        </div>
      ))}
      {recent.length > 0 && <h2>최근 운동</h2>}
      {recent.map((w) => {
        const sets = w.blocks.flatMap((b) => b.items.flatMap((i) => i.sets)).filter((x) => x.done && !x.warmup).length;
        return (
          <div class="card" key={w.id}>
            <div class="row between"><span>{w.name}</span><span class="sub small">{new Date(w.startedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span></div>
            <div class="sub small">작업 세트 {sets}개 · {minutes((Date.parse(w.endedAt!) - Date.parse(w.startedAt)) / 1000)}</div>
          </div>
        );
      })}
    </main>
  );
}
