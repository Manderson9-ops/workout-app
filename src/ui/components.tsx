import { useState, useRef, useEffect } from 'preact/hooks';
import { registerPending, flushKey, trackInflight } from './store';
import type { ComponentChildren } from 'preact';
import type { BuiltExercise, Part } from '../core/types';
import { PARTS, EQUIPMENT_LABEL } from '../core/types';
import type { ResolvedGrade } from '../core/exercises';
import { resolveGrade, eligibleParts, equipmentAvailable } from '../core/exercises';
import { matchesQuery } from '../core/search';
import { GRADES } from '../core/version';
import type { AppState } from './store';

export function GradeBadge({ g }: { g: Pick<ResolvedGrade, 'value' | 'source' | 'estimated'> }) {
  const cls = g.source === 'USER' ? 'user' : g.estimated ? 'est' : 'video';
  const title = g.source === 'USER' ? '내가 정한 등급' : g.estimated ? '추정 (영상 없음)' : '영상 등급';
  return <span class={`badge ${cls}`} title={title} aria-label={`등급 ${g.value} ${title}`}>{g.value}{g.estimated ? ' 추정' : ''}</span>;
}

/**
 * −/+ 숫자 조절. onStep이 있으면 버튼은 "얼마나 바꿀지"만 넘기고, 받는 쪽이 저장된 최신 값에 더한다
 * (입력 중인 값과 순서가 꼬이지 않게: 입력값 먼저 저장 → 최신 값 + 변화량). onStep이 없으면 화면 값 기준.
 */
export function Stepper({ value, step, min = 0, onChange, onStep, label, suffix, integer, pendingKey }: { value: number | undefined; step: number; min?: number; onChange: (v: number) => void; onStep?: (delta: number) => void; label: string; suffix?: string; integer?: boolean; pendingKey?: string }) {
  const key = pendingKey ?? label;
  const bump = async (d: number) => {
    if (onStep) { onStep(d); return; }
    await flushKey(key);
    onChange(Math.max(min, Math.round(((value ?? 0) + d) * 10) / 10));
  };
  return (
    <div class="stepper" aria-label={label}>
      <button aria-label={`${label} 줄이기`} onClick={() => void bump(-step)}>−</button>
      <NumInput label={label} pendingKey={key} value={value} suffix={suffix ?? ''} integer={integer} onChange={(n) => onChange(Math.max(min, n ?? min))} />
      <button aria-label={`${label} 늘리기`} onClick={() => void bump(step)}>+</button>
    </div>
  );
}
/**
 * 숫자 입력 (탭하면 숫자 키패드). 입력하는 대로 저장하되 0.3초 늦춰 모아서 저장한다(디바운스).
 * 세트 완료를 누르면 늦춘 저장을 먼저 끝낸다(flushPending). 아이폰 사파리는 버튼을 눌러도 입력칸 포커스가 안 빠지기 때문.
 */
export function NumInput({ value, onChange, label, suffix, integer, pendingKey }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; suffix: string; integer?: boolean; pendingKey?: string }) {
  const key = pendingKey ?? label;
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<number | undefined | null>(null);
  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    registerPending(key, null);
    if (latest.current !== null) { const v = latest.current; latest.current = null; const p = Promise.resolve(onChange(v)); trackInflight(p); await p; }
  };
  useEffect(() => () => { void flush(); }, []);
  // 저장된 값이 다른 경로(−/+, 앞 세트 이어받기)로 바뀌면, 저장 대기 중인 입력이 없을 때 화면 글자도 맞춤
  useEffect(() => { if (text !== null && latest.current === null) setText(value === undefined ? '' : String(value)); }, [value]);
  const shown = text ?? (value === undefined ? '' : String(value));
  return (
    <div style={{ position: 'relative' }}>
      <input inputMode={integer ? 'numeric' : 'decimal'} aria-label={label} value={shown} placeholder="-" style={{ textAlign: 'center', paddingRight: '26px' }}
        onFocus={() => setText(shown)} onBlur={() => { setText(null); void flush(); }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value.replace(',', '.');
          setText(t);
          const n = integer ? parseInt(t, 10) : parseFloat(t);
          if (t.trim() === '') latest.current = undefined;
          else if (Number.isFinite(n) && n >= 0) latest.current = n;
          else return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { void flush(); }, 300);
          registerPending(key, flush);
        }} />
      <span class="pill" style={{ position: 'absolute', right: '8px', top: '13px', pointerEvents: 'none' }}>{suffix}</span>
    </div>
  );
}
export function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: ComponentChildren }) {
  return (
    <>
      <div class="sheet-bg" onClick={onClose} />
      <div class="sheet" role="dialog" aria-label={title}>
        <div class="row between"><h3>{title}</h3><button class="ghost" onClick={onClose} aria-label="닫기">✕</button></div>
        {children}
      </div>
    </>
  );
}

/** 운동 고르기 (교체·추가). part가 있으면 그 부위 후보를 등급 순으로 먼저 */
export function ExercisePicker({ s, all, part, exclude, onPick, onClose, title }: {
  s: AppState; all: BuiltExercise[]; part?: Part; exclude?: string[]; onPick: (e: BuiltExercise) => void; onClose: () => void; title: string;
}) {
  const [q, setQ] = useState('');
  const [p, setP] = useState<Part | undefined>(part);
  const level = s.settings.level;
  const list = all
    .filter((e) => !(exclude ?? []).includes(e.id) && !s.meta.get(e.id)?.excluded && equipmentAvailable(e, s.settings.equipment))
    .filter((e) => (p ? eligibleParts(e).includes(p) : true))
    .filter((e) => matchesQuery(q, [e.name_ko, ...(e.aliases ?? [])]))
    .map((e) => ({ e, g: resolveGrade(e, p ?? e.part, level, undefined, s.meta.get(e.id)?.userGrade) }))
    .sort((a, b) => GRADES.indexOf(a.g.value) - GRADES.indexOf(b.g.value) || (a.g.estimated ? 1 : 0) - (b.g.estimated ? 1 : 0) || a.e.name_ko.localeCompare(b.e.name_ko))
    .slice(0, 60);
  return (
    <Sheet onClose={onClose} title={title}>
      <input placeholder="검색 (초성 가능: ㄹㅍㄷ)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="운동 검색" />
      <div class="row wrap" style={{ margin: '8px 0' }}>
        <button class={`chip ${!p ? 'on' : ''}`} onClick={() => setP(undefined)}>전체</button>
        {PARTS.map((x) => <button key={x} class={`chip ${p === x ? 'on' : ''}`} onClick={() => setP(x)}>{x}</button>)}
      </div>
      {list.map(({ e, g }) => (
        <div class="list-item" key={e.id} onClick={() => onPick(e)} role="button" aria-label={e.name_ko}>
          <GradeBadge g={g} />
          <div class="grow"><div>{e.name_ko}</div><div class="pill">{e.part} · {e.equipment.map((q2) => EQUIPMENT_LABEL[q2]).join(', ')}</div></div>
        </div>
      ))}
      {!list.length && <div class="empty">조건에 맞는 운동이 없어요</div>}
    </Sheet>
  );
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec)) % 60).padStart(2, '0')}`;
export const minutes = (sec: number) => `${Math.round(sec / 60)}분`;

/** 메모 입력 시트 (한 손으로: 큰 입력칸, 아래쪽 버튼). prompt() 대신 */
export function MemoSheet({ title, value, onSave, onClose }: { title: string; value?: string; onSave: (m: string | undefined) => void; onClose: () => void }) {
  const [t, setT] = useState(value ?? '');
  return (
    <Sheet title={title} onClose={onClose}>
      <textarea aria-label={title} value={t} onInput={(e) => setT((e.target as HTMLTextAreaElement).value)} placeholder="예: 그립을 조금 넓게, 오른쪽 어깨 불편" />
      <div class="row" style={{ marginTop: '10px' }}>
        {value && <button class="danger" onClick={() => { onSave(undefined); onClose(); }}>지우기</button>}
        <button class="primary grow" onClick={() => { onSave(t.trim() || undefined); onClose(); }}>저장</button>
      </div>
    </Sheet>
  );
}