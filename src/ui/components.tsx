import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { Icon } from './icons';
import { registerPending, flushKey, flushValue } from './store';
import type { ComponentChildren } from 'preact';
import type { BuiltExercise, Part } from '../core/types';
import { PARTS, EQUIPMENT_LABEL } from '../core/types';
import type { ResolvedGrade } from '../core/exercises';
import { resolveGrade, eligibleParts, equipmentAvailable } from '../core/exercises';
import { matchesQuery } from '../core/search';
import { GRADES } from '../core/version';
import type { AppState } from './store';
import { lsGet, lsSet, lsRemove } from './appName';

/** D-044: 운동 추가에서 마지막으로 고른 부위 (이 기기만) */
export const PICKER_PART_KEY = 'picker.part';

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
    // 실패하면 값을 되돌려 다시 대기 (다음 버튼 때 다시 저장)
    await flushValue(key, latest, onChange, flush);
  };
  useEffect(() => () => { flush().catch(() => undefined); }, []);
  // 저장된 값이 다른 경로(−/+, 앞 세트 이어받기)로 바뀌면, 저장 대기 중인 입력이 없을 때 화면 글자도 맞춤
  useEffect(() => { if (text !== null && latest.current === null) setText(value === undefined ? '' : String(value)); }, [value]);
  const shown = text ?? (value === undefined ? '' : String(value));
  return (
    <div style={{ position: 'relative' }}>
      <input inputMode={integer ? 'numeric' : 'decimal'} aria-label={label} value={shown} placeholder="-" style={{ textAlign: 'center', paddingRight: suffix ? '26px' : undefined }}
        onFocus={() => setText(shown)} onBlur={() => { setText(null); flush().catch(() => undefined); /* 실패하면 대기로 남아 다음 버튼 때 다시 */ }}
        onKeyDown={(e) => {
          // PC 키보드: Enter로 다음 입력칸 (D-030)
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          // 같은 시트(또는 본문) 안에서만, −/+ 조절 칸(같은 값의 두 번째 칸)은 건너뜀
          const scope = (e.currentTarget as HTMLElement).closest('.sheet, main') ?? document;
          const all = [...scope.querySelectorAll<HTMLInputElement>('input:not([type=checkbox]):not([type=file]):not([disabled])')]
            .filter((x) => x.offsetParent !== null && (x === e.currentTarget || !(x.getAttribute('aria-label') ?? '').endsWith('조절')));
          const i = all.indexOf(e.currentTarget as HTMLInputElement);
          (all[i + 1] ?? (e.currentTarget as HTMLInputElement)).focus();
          if (!all[i + 1]) (e.currentTarget as HTMLInputElement).blur();
        }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value.replace(',', '.');
          setText(t);
          const n = integer ? parseInt(t, 10) : parseFloat(t);
          if (t.trim() === '') latest.current = undefined;
          else if (Number.isFinite(n) && n >= 0) latest.current = n;
          else return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { flush().catch(() => undefined); }, 300);
          registerPending(key, flush);
        }} />
      {suffix && <span class="pill" style={{ position: 'absolute', right: '8px', top: '13px', pointerEvents: 'none' }}>{suffix}</span>}
    </div>
  );
}
/**
 * 아래에서 올라오는 창. trap = 화면 읽기·키보드용 대화상자(aria-modal, 초점 가두기, Esc로 닫기, 닫으면 연 버튼으로 초점)
 * (확인 창 ConfirmHost는 modal + 자기 키 처리를 씁)
 */
export function Sheet({ onClose, title, children, modal, trap, cls }: { onClose: () => void; title: string; children: ComponentChildren; modal?: boolean; trap?: boolean; cls?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogKeys(trap ? panel : null, onClose);
  return (
    <>
      <div class="sheet-bg" onClick={onClose} />
      <div class={`sheet${cls ? ` ${cls}` : ''}`} role="dialog" aria-label={title} aria-modal={modal || trap ? 'true' : undefined} ref={panel}>
        <div class="row between sheet-head"><h3>{title}</h3><button class="ghost icon-btn" onClick={onClose} aria-label="닫기"><Icon name="close" size={20} /></button></div>
        {children}
      </div>
    </>
  );
}

/** 대화상자 키: 열릴 때 [data-autofocus](없으면 첫 버튼)에 초점, Tab은 안에서만 돌고, Esc = 닫기, 닫히면 연 곳으로 초점 */
export function useDialogKeys(ref: { current: HTMLElement | null } | null, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!ref) return;
    const back = document.activeElement as HTMLElement | null;
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, input, select, textarea') ?? [])].filter((x) => x.offsetParent !== null || x === document.activeElement);
    // 처음 초점: 창 맨 위가 보이게 스크롤하지 않음 (아래 버튼에 초점을 줘도 제목부터 읽히게)
    (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus({ preventScroll: true });
    if (ref.current) ref.current.scrollTop = 0;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 || i < 0 ? 0 : i + 1);
      e.preventDefault(); els[n]!.focus();
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); if (back?.isConnected) back.focus(); };
  }, []);
}

/** ⋯ 메뉴 창 (루틴·최근 운동). 항목을 누르면 창을 먼저 닫고 실행 (확인 창과 겹치지 않게) */
export interface MenuItem { label: string; aria: string; danger?: boolean; run: () => void }
export function MenuSheet({ title, items, onClose }: { title: string; items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} trap>
      <div class="menu-list">
        {items.map((it, i) => (
          <button key={it.aria} class={`big menu-item${it.danger ? ' danger' : ''}`} aria-label={it.aria} data-autofocus={i === 0 ? true : undefined} onClick={() => { onClose(); setTimeout(it.run, 0); /* 창이 닫히고 초점이 ⋯로 돌아간 뒤 실행 (확인 창이 초점을 잡게) */ }}>{it.label}</button>
        ))}
        <button class="big ghost" onClick={onClose}>취소</button>
      </div>
    </Sheet>
  );
}

/**
 * 카드 (디자인 시스템 2장): 회색 제목(왼쪽) + 선택적 ›. href 가 있으면 카드 전체가 링크(안에 다른 버튼을 두지 않음)
 */
export function Card({ title, href, label, children, testid, class: cls }: { title?: string; href?: string; label?: string; children: ComponentChildren; testid?: string; class?: string }) {
  const head = title && <div class="card-head"><span class="card-title">{title}</span>{href && <Icon name="chevron" size={18} class="card-more" />}</div>;
  if (href) return <a class={`card card-tap${cls ? ` ${cls}` : ''}`} href={href} aria-label={label} data-testid={testid}>{head}{children}</a>;
  return <section class={`card${cls ? ` ${cls}` : ''}`} aria-label={label ?? title} data-testid={testid}>{head}{children}</section>;
}

export type Tone = 'ok' | 'pr' | 'warn' | 'bad' | 'acc' | 'sub';
/** 큰 숫자 + 작은 단위 + 아래 상태 한 마디 (색 + 기호, 색만으로 전달하지 않음). value 가 없으면 "--" */
export function Metric({ label, value, unit, parts, status, tone = 'sub', mark, children, statusClass }: {
  label: string; value?: string | number; unit?: string;
  /** 숫자와 단위가 여럿일 때 (예: 1시간 2분 → [[1,'시간'],[2,'분']]) */
  parts?: [string | number, string][];
  status?: string; tone?: Tone; mark?: string;
  /** 상태 줄을 직접 그릴 때 (증감 등) */
  children?: ComponentChildren; statusClass?: string;
}) {
  const pv = parts ?? (value === undefined ? undefined : [[value, unit ?? '']] as [string | number, string][]);
  return (
    <div class="metric">
      <div class="m-label">{label}</div>
      <div class="m-val">
        {!pv ? <span class="num none">--</span> : pv.map(([n, u], i) => <span key={i} class="m-pair"><span class="num">{n}</span>{u && <span class="unit">{u}</span>}</span>)}
      </div>
      {status && <div class={`m-status t-${tone}${statusClass ? ` ${statusClass}` : ''}`}>{mark && <span aria-hidden="true">{mark} </span>}{status}</div>}
      {children !== undefined && <div class={`m-status${statusClass ? ` ${statusClass}` : ''}`}>{children}</div>}
    </div>
  );
}

/**
 * 지난주(같은 요일까지)와의 차이 한 줄 (D-055 검토 R3: 홈·기록 탭 같은 모양).
 * 화면: "▲1 지난주보다" / "▼1 지난주보다" / "= 지난주와 같음", 화면 읽기: "지난주보다 1 많음" 같은 문장.
 * 늘면 초록, 줄거나 같으면 회색 (줄었다고 빨강으로 다그치지 않음, Gentler Streak). 기호 + 글자라 색만으로 전하지 않음
 */
export function Delta({ cur, prev, unit = '', fmt }: { cur: number; prev: number; unit?: string; fmt?: (absDiff: number) => string }) {
  const abs = Math.abs(cur - prev);
  if (cur === prev) return <span class="delta"><span aria-hidden="true">= <span class="d-cap">지난주와 같음</span></span><span class="sr-only">지난주와 같음</span></span>;
  const txt = fmt ? fmt(abs) : `${abs.toLocaleString()}${unit}`;
  const up = cur > prev;
  return (
    <span class={`delta${up ? ' up' : ''}`}>
      <span aria-hidden="true"><span class="d-num">{up ? '▲' : '▼'}{txt}</span> <span class="d-cap">지난주보다</span></span>
      <span class="sr-only">지난주보다 {txt} {up ? '많음' : '적음'}</span>
    </span>
  );
}

/** 빈 상태 (카드 모양 유지): "--" + 문구 + 다음 행동 */
export function Empty({ title, text = '아직 기록 없음', hint, children, label, dash = false }: { title?: string; text?: string; hint?: string; children?: ComponentChildren; label?: string; /** 숫자 자리 카드일 때만 「--」 (D-055 검토: 숫자가 아닌 카드에 대시는 어색) */ dash?: boolean }) {
  return (
    <section class="card empty-card" aria-label={label ?? title ?? text}>
      {title && <div class="card-head"><span class="card-title">{title}</span></div>}
      {dash && <div class="empty-dash" aria-hidden="true">--</div>}
      <p class="empty-text">{text}</p>
      {hint && <p class="sub empty-hint">{hint}</p>}
      {children && <div class="row wrap empty-actions">{children}</div>}
    </section>
  );
}

/** 운동 고르기 (교체·추가). part가 있으면 그 부위 후보를 등급 순으로 먼저 */
export function ExercisePicker({ s, all, part, startPart, exclude, ctxParts: ctxIn, onPick, onClose, title }: {
  s: AppState; all: BuiltExercise[]; part?: Part; exclude?: string[];
  /** D-052: 추가 모드에서 이 부위로 시작 (기억된 부위는 건드리지 않음. 칩을 누르면 평소처럼 기억) */
  startPart?: Part;
  /** 지금 들어 있는 부위 (플랜은 항목의 실제 부위를 넘김). 없으면 빼기 목록 운동의 기본 부위 */
  ctxParts?: Part[];
  onPick: (e: BuiltExercise) => void; onClose: () => void; title: string;
}) {
  const [q, setQ] = useState('');
  // D-044: 교체는 그 운동의 부위로 시작하고 기억에 손대지 않음. 추가는 마지막으로 고른 부위로 시작
  const swap = part !== undefined;
  const [p, setPRaw] = useState<Part | undefined>(() => {
    if (part) return part;
    if (startPart) return startPart;
    const last = lsGet(PICKER_PART_KEY) as Part | null;
    return last && (PARTS as readonly string[]).includes(last) ? last : undefined;
  });
  const setP = (x: Part | undefined) => {
    setPRaw(x);
    if (swap) return;
    if (x) lsSet(PICKER_PART_KEY, x); else lsRemove(PICKER_PART_KEY);
  };
  const byIdP = new Map(all.map((e) => [e.id, e.part]));
  const ctxSet = new Set<Part>(ctxIn ?? (exclude ?? []).map((id) => byIdP.get(id)).filter((x): x is Part => !!x));
  const ctxParts = PARTS.filter((x) => ctxSet.has(x));
  const level = s.settings.level;
  const base = all
    .filter((e) => !(exclude ?? []).includes(e.id) && !s.meta.get(e.id)?.excluded && equipmentAvailable(e, s.settings.equipment))
    .filter((e) => matchesQuery(q, [e.name_ko, ...(e.aliases ?? [])]));
  const inPart = base.filter((e) => (p ? eligibleParts(e).includes(p) : true));
  // 고른 부위에 검색 결과가 없으면 모든 부위에서 찾아 보여 줌 (기억된 부위 때문에 못 찾는 일이 없게)
  const widened = !!p && !!q.trim() && !inPart.length && base.length > 0;
  const list = (widened ? base : inPart)
    .map((e) => ({ e, g: resolveGrade(e, widened ? e.part : (p ?? e.part), level, undefined, s.meta.get(e.id)?.userGrade) }))
    .sort((a, b) => GRADES.indexOf(a.g.value) - GRADES.indexOf(b.g.value) || (a.g.estimated ? 1 : 0) - (b.g.estimated ? 1 : 0) || a.e.name_ko.localeCompare(b.e.name_ko))
    .slice(0, 60);
  return (
    <Sheet onClose={onClose} title={title}>
      <input placeholder="검색 (초성 가능: ㄹㅍㄷ)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="운동 검색" />
      {ctxParts.length > 0 && <div class="row wrap" role="group" aria-label="지금 들어 있는 부위" style={{ margin: '8px 0 0' }}>
        <span class="sub small">지금 들어 있는 부위</span>
        {ctxParts.map((x) => <button key={x} class={`chip ${p === x ? 'on' : ''}`} aria-pressed={p === x} onClick={() => setP(x)}>{x}</button>)}
      </div>}
      <div class="row wrap" role="group" aria-label="모든 부위" style={{ margin: '8px 0' }}>
        <button class={`chip ${!p ? 'on' : ''}`} aria-pressed={!p} onClick={() => setP(undefined)}>전체</button>
        {PARTS.map((x) => <button key={x} class={`chip ${p === x ? 'on' : ''}`} aria-pressed={p === x} onClick={() => setP(x)}>{x}</button>)}
      </div>
      {widened && <p class="sub small" role="status">{p}에는 "{q.trim()}" 운동이 없어 모든 부위에서 찾았어요</p>}
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
/** 라벨과 스테퍼를 한 덩어리로 (줄바꿈은 덩어리 단위로만) */
export function Labeled({ label, children }: { label: string; children: ComponentChildren }) {
  return <span class="lbl-step"><span class="sub small">{label}</span>{children}</span>;
}
export interface StepBtn { aria: string; off: boolean; on: () => void }
/** 일괄 −/+ 스테퍼 (가운데에 지금 값) */
export function MiniStepper({ label, mid, dec, inc }: { label: string; mid: string; dec: StepBtn; inc: StepBtn }) {
  return (
    <span class="mini-step" role="group" aria-label={label}>
      <button aria-label={dec.aria} disabled={dec.off} onClick={dec.on}>−</button>
      <span class="val">{mid}</span>
      <button aria-label={inc.aria} disabled={inc.off} onClick={inc.on}>+</button>
    </span>
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