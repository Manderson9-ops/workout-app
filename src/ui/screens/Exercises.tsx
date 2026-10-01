import { scopedKey } from '../appName';
import { useState } from 'preact/hooks';
import type { AppState } from '../store';
import { mutate, historyOf } from '../store';
import { catalog, families, videoUrl, sourceVideos } from '../catalog';
import { PARTS, EQUIPMENT, EQUIPMENT_LABEL, LEVELS } from '../../core/types';
import type { Part, Equipment, Mechanics } from '../../core/types';
import { resolveGrade, eligibleParts, patternFor } from '../../core/exercises';
import { matchesQuery } from '../../core/search';
import { lastSets } from '../../core/session';
import { exerciseHistory } from '../../core/stats';
import { LineChart, BarChart } from '../charts';
import { GRADES } from '../../core/version';
import type { Grade } from '../../core/version';
import { GradeBadge, Sheet } from '../components';
import { setMeta } from '../actions';
import { newId, softDelete } from '../../db/db';
import { go } from '../nav';
import { askConfirm } from '../confirm';

const KEY = 'exerciseFilter.v1';

export function Exercises({ s }: { s: AppState }) {
  const all = catalog(s.custom);
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(scopedKey(KEY)) ?? '{}'); } catch { return {}; } })();
  const [q, setQ] = useState<string>(saved.q ?? '');
  const [part, setPart] = useState<Part | undefined>(saved.part);
  const [favOnly, setFavOnly] = useState<boolean>(!!saved.favOnly);
  const [videoOnly, setVideoOnly] = useState<boolean>(!!saved.videoOnly);
  const [adding, setAdding] = useState(false);
  const [equip, setEquip] = useState<Equipment | ''>(saved.equip ?? '');
  const [minG, setMinG] = useState<Grade | ''>(saved.minG ?? '');
  const remember = (p: object) => sessionStorage.setItem(scopedKey(KEY), JSON.stringify({ q, part, favOnly, videoOnly, equip, minG, ...p }));
  const level = s.settings.level;
  const rows = all
    .filter((e) => (part ? eligibleParts(e).includes(part) : true))
    .filter((e) => matchesQuery(q, [e.name_ko, ...(e.aliases ?? [])]))
    .filter((e) => (favOnly ? s.meta.get(e.id)?.favorite : true))
    .map((e) => ({ e, g: resolveGrade(e, part ?? e.part, level, undefined, s.meta.get(e.id)?.userGrade) }))
    .filter((x) => (videoOnly ? !x.g.estimated : true))
    .filter((x) => (equip ? x.e.equipment.includes(equip) : true))
    .filter((x) => (minG ? GRADES.indexOf(x.g.value) <= GRADES.indexOf(minG) : true))
    .sort((a, b) => GRADES.indexOf(a.g.value) - GRADES.indexOf(b.g.value) || (a.g.estimated ? 1 : 0) - (b.g.estimated ? 1 : 0) || a.e.name_ko.localeCompare(b.e.name_ko));
  return (
    <main>
      <div class="row between"><h1>운동 종목</h1><button onClick={() => setAdding(true)}>+ 직접 추가</button></div>
      <input placeholder="검색 (초성 가능: ㄹㅍㄷ, 별칭: 사레레)" value={q} aria-label="운동 검색" onInput={(e) => { const v = (e.target as HTMLInputElement).value; setQ(v); remember({ q: v }); }} />
      <div class="row wrap" style={{ margin: '8px 0' }}>
        <button class={`chip ${!part ? 'on' : ''}`} onClick={() => { setPart(undefined); remember({ part: undefined }); }}>전체</button>
        {PARTS.map((p) => <button key={p} class={`chip ${part === p ? 'on' : ''}`} onClick={() => { setPart(p); remember({ part: p }); }}>{p}</button>)}
      </div>
      <div class="row wrap">
        <button class={`chip ${favOnly ? 'on' : ''}`} aria-pressed={favOnly} onClick={() => { setFavOnly(!favOnly); remember({ favOnly: !favOnly }); }}>★ 즐겨찾기</button>
        <button class={`chip ${videoOnly ? 'on' : ''}`} aria-pressed={videoOnly} onClick={() => { setVideoOnly(!videoOnly); remember({ videoOnly: !videoOnly }); }}>영상 등급만</button>
        <span class="sub small">{rows.length}개</span>
      </div>
      <div class="grid2" style={{ marginTop: '8px' }}>
        <select value={equip} aria-label="장비 필터" onChange={(e) => { const v = (e.target as HTMLSelectElement).value as Equipment | ''; setEquip(v); remember({ equip: v }); }}>
          <option value="">장비 전체</option>{EQUIPMENT.map((x) => <option key={x} value={x}>{EQUIPMENT_LABEL[x]}</option>)}
        </select>
        <select value={minG} aria-label="등급 필터" onChange={(e) => { const v = (e.target as HTMLSelectElement).value as Grade | ''; setMinG(v); remember({ minG: v }); }}>
          <option value="">등급 전체</option>{GRADES.filter((g) => g !== 'C-').map((g) => <option key={g} value={g}>{g} 이상</option>)}
        </select>
      </div>
      <div class="card" style={{ padding: '0 10px' }}>
        {rows.map(({ e, g }) => {
          const m = s.meta.get(e.id);
          return (
            <div class="list-item" key={e.id} role="button" aria-label={e.name_ko} onClick={() => go(`#/exercises/${encodeURIComponent(e.id)}`)}>
              <GradeBadge g={g} />
              <div class="grow">
                <div>{m?.favorite ? '★ ' : ''}{e.name_ko}{m?.excluded ? ' (제외됨)' : ''}</div>
                <div class="pill">{e.part} · {e.mechanics === 'compound' ? '다관절' : '단관절'} · {e.equipment.map((x) => EQUIPMENT_LABEL[x]).join(', ')}{e.guide.length ? ` · 자세 포인트 ${e.guide.length}` : ''}</div>
              </div>
            </div>
          );
        })}
        {!rows.length && <div class="empty">검색 결과가 없어요</div>}
      </div>
      {adding && <AddCustom s={s} onClose={() => setAdding(false)} />}
    </main>
  );
}

function AddCustom({ s, onClose }: { s: AppState; onClose: () => void }) {
  const [name, setName] = useState('');
  const [part, setPart] = useState<Part>('가슴');
  const [mech, setMech] = useState<Mechanics>('isolation');
  const [eq, setEq] = useState<Equipment>('machine');
  const [uni, setUni] = useState(false);
  const exists = catalog(s.custom).some((e) => e.name_ko === name.trim());
  return (
    <Sheet title="운동 직접 추가" onClose={onClose}>
      <label>이름</label><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="운동 이름" />
      {exists && <p class="small" style={{ color: 'var(--warn)' }}>같은 이름의 운동이 이미 있어요</p>}
      <label>부위</label><select value={part} onChange={(e) => setPart((e.target as HTMLSelectElement).value as Part)} aria-label="부위">{PARTS.map((p) => <option key={p}>{p}</option>)}</select>
      <div class="grid2">
        <div><label>종류</label><select value={mech} onChange={(e) => setMech((e.target as HTMLSelectElement).value as Mechanics)} aria-label="종류"><option value="compound">다관절</option><option value="isolation">단관절</option></select></div>
        <div><label>장비</label><select value={eq} onChange={(e) => setEq((e.target as HTMLSelectElement).value as Equipment)} aria-label="장비">{EQUIPMENT.map((x) => <option key={x} value={x}>{EQUIPMENT_LABEL[x]}</option>)}</select></div>
      </div>
      <label class="row"><input type="checkbox" checked={uni} onChange={() => setUni(!uni)} style={{ width: '24px', minHeight: '24px' }} /> 한쪽씩 하는 운동</label>
      <p class="sub small">직접 추가한 운동은 영상 등급이 없어 "B 추정"으로 시작해요. 상세 화면에서 내 등급을 바꿀 수 있어요.</p>
      <button class="primary big" disabled={!name.trim() || exists} onClick={async () => {
        const id = newId('custom').replace(/-/g, '_');
        await mutate((d) => d.custom.put({ id, name_ko: name.trim(), family: id, part, muscles: [part], pattern: patternFor(part, mech), mechanics: mech, equipment: [eq], unilateral: uni, custom: true, createdAt: new Date().toISOString() }));
        onClose();
      }}>추가</button>
    </Sheet>
  );
}

export function ExerciseDetail({ s, id }: { s: AppState; id: string }) {
  const all = catalog(s.custom);
  const e = all.find((x) => x.id === id);
  if (!e) return <main><p>운동을 찾을 수 없어요.</p><button onClick={() => history.back()}>뒤로</button></main>;
  const m = s.meta.get(e.id);
  const g = resolveGrade(e, e.part, s.settings.level, undefined, m?.userGrade);
  const prev = lastSets(historyOf(s), e.id);
  const hist = exerciseHistory(historyOf(s), e.id, e, s.bodyweight);
  const best = hist.reduce((mx, h) => Math.max(mx, h.best1RM ?? 0), 0);
  const title = (vid: string) => sourceVideos.find((v) => v.video_id === vid)?.title ?? vid;
  return (
    <main>
      <button class="ghost" onClick={() => history.back()} aria-label="뒤로">← 뒤로</button>
      <div class="row"><GradeBadge g={g} /><h1 class="grow" style={{ margin: '4px 0' }}>{e.name_ko}</h1></div>
      <p class="sub">{e.part} · {e.mechanics === 'compound' ? '다관절' : '단관절'} · {e.equipment.map((x) => EQUIPMENT_LABEL[x]).join(', ')}{e.unilateral ? ' · 한쪽씩' : ''}{e.heavy ? ' · 무거운 운동' : ''}</p>
      <p class="sub small">주 근육: {e.muscles.join(', ')} · 묶음: {families[e.family] ?? '직접 추가'}{e.aliases?.length ? ` · 다른 이름: ${e.aliases.join(', ')}` : ''}</p>
      {e.note && <p class="sub small">메모: {e.note}</p>}
      <div class="row wrap" style={{ marginTop: '8px' }}>
        <button class={`chip ${m?.favorite ? 'on' : ''}`} aria-pressed={!!m?.favorite} onClick={() => setMeta(e.id, { favorite: !m?.favorite })}>{m?.favorite ? '★ 즐겨찾기' : '☆ 즐겨찾기'}</button>
        <button class={`chip ${m?.excluded ? 'on' : ''}`} aria-pressed={!!m?.excluded} onClick={() => setMeta(e.id, { excluded: !m?.excluded })}>{m?.excluded ? '플랜에서 제외됨' : '플랜에서 제외'}</button>
      </div>
      <label>내 등급 (플랜에서 영상 등급보다 우선)</label>
      <select value={m?.userGrade ?? ''} aria-label="내 등급" onChange={(ev) => { const v = (ev.target as HTMLSelectElement).value; void setMeta(e.id, { userGrade: v || undefined }); }}>
        <option value="">정하지 않음</option>
        {GRADES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>

      <h2>영상 등급</h2>
      {!e.grades.length && <p class="sub">영상 등급 없음 → 앱 기본값 B "추정"</p>}
      {e.grades.map((x, i) => (
        <div class="card" key={i}>
          <div class="row"><span class="badge video">{x.value}</span><span class="grow">{x.purpose_part} 목적{x.purpose_note ? ` · ${x.purpose_note}` : ''}{x.sub_goal_only ? ' (세부 목표 전용)' : ''}</span></div>
          <div class="pill">수준: {x.levels.length ? x.levels.join('·') : LEVELS.join('·')}{x.target ? ` · 대상: ${x.target}` : ''}{x.primary_topic === false ? ' · 참고용' : ''}</div>
          {x.why && <p class="small">{x.why}</p>}
          {x.video_id && <a href={videoUrl(x.video_id, x.timestamp)} target="_blank" rel="noopener">▶ {title(x.video_id)} ({x.timestamp})</a>}
        </div>
      ))}
      {e.guide.length > 0 && <h2>자세 포인트</h2>}
      {e.guide.map((x, i) => (
        <div class="card" key={i}>
          <p class="small">{x.text}</p>
          <a class="small" href={videoUrl(x.video_id, x.timestamp)} target="_blank" rel="noopener">▶ {x.timestamp} 영상 보기</a>
        </div>
      ))}
      <h2>내 기록</h2>
      {prev.length ? <p>지난번: {prev.map((p) => `${p.weight ?? '-'}kg × ${p.reps ?? p.seconds ?? '-'}`).join(', ')}</p> : <p class="sub">아직 기록이 없어요</p>}
      {hist.some((h) => h.best1RM) && (
        <>
          <p class="small">추정 1RM 최고 {best}kg <span class="sub">(Epley 공식 추정)</span></p>
          <LineChart label="추정 1RM 추이" unit="kg" points={hist.filter((h) => h.best1RM).slice(-20).map((h) => ({ label: h.date.slice(5).replace('-', '/'), value: h.best1RM! }))} />
          <BarChart label="볼륨 추이" unit="kg" points={hist.slice(-8).map((h) => ({ label: h.date.slice(5).replace('-', '/'), value: Math.round(h.volume) }))} />
        </>
      )}
      {hist.length > 0 && (
        <div class="card">
          {[...hist].reverse().slice(0, 10).map((h) => (
            <div class="row between small" key={h.workoutId} style={{ minHeight: '32px' }}>
              <span>{h.date.slice(5).replace('-', '/')}</span>
              <span>{h.sets}세트{h.bestSet ? ` · 최고 ${h.bestSet.weight}kg×${h.bestSet.reps}` : ''}{h.seconds ? ` · ${h.seconds}초` : ''}</span>
              <span class="sub">{h.volume ? `${Math.round(h.volume).toLocaleString()}kg` : ''}</span>
            </div>
          ))}
        </div>
      )}      {'custom' in e && <button class="danger" onClick={async () => { if (await askConfirm({ title: '직접 추가한 운동을 지울까요?', message: '운동 기록은 남아요.', ok: '지우기', danger: true })) { await mutate((d) => softDelete(d, 'custom', e.id)); go('#/exercises'); } }}>이 운동 삭제</button>}
    </main>
  );
}
