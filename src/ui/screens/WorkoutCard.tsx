/**
 * 끝낸 운동 카드 (D-054 기록 탭 카드, D-055: 홈 "최근 운동"도 같은 카드). 누르면 기록 상세.
 * 홈에서는 오른쪽 위에 ⋯(수정·삭제) 버튼이 붙음 (WorkoutCardWithMenu).
 */
import { useState } from 'preact/hooks';
import type { Exercise } from '../../core/types';
import { PARTS } from '../../core/types';
import type { Workout } from '../../core/session';
import { HOME_HIDDEN_LABEL } from '../../core/session';
import type { WorkoutSummary } from '../../core/stats';
import { exerciseLines, durText } from '../../core/stats';
import { go } from '../nav';
import { Icon } from '../icons';
import { MenuSheet } from '../components';
import type { MenuItem } from '../components';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const shortPart = (p: string) => (p === '전완·악력' ? '전완' : p);
export const timeLabel = (iso: string) => {
  const d = new Date(iso); const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function WorkoutCard({ x, w, byId, hidden, withMenu }: { x: WorkoutSummary; w: Workout | undefined; byId: Map<string, Exercise>; hidden: boolean; withMenu?: boolean }) {
  const diff = x.plannedSec ? x.durationSec - x.plannedSec : undefined;
  const lines = w ? exerciseLines(w, byId) : [];
  const parts = PARTS.filter((p) => (x.parts[p] ?? 0) > 0);
  const empty = x.workSets === 0;
  const edited = !!w?.editedAt;
  // 화면 읽기용 전체 요약 (본문이 가려지지 않게). 홈에서 뺌 표시는 맨 끝
  const label = `${x.name}, ${w ? timeLabel(w.startedAt) : x.date}, ${durText(x.durationSec)}, 세트 ${x.workSets}, 볼륨 ${x.volume.toLocaleString()}kg${empty ? ', 완료 세트 0' : ''}${edited ? ', 고침' : ''}${lines.slice(0, 3).map((l) => `, ${l.name} ${l.sets}세트${l.best ? ` 최고 ${l.best}` : ''}`).join('')}${lines.length > 3 ? `, 외 ${lines.length - 3}개 운동` : ''}${hidden ? ` (${HOME_HIDDEN_LABEL})` : ''}`;
  return (
    <button class={`wcard${empty ? ' dim' : ''}${withMenu ? ' has-menu' : ''}`} aria-label={label} onClick={() => go(`#/stats/w/${encodeURIComponent(x.id)}`)}>
      <div class="wc-main">
        <div class="wc-title">{x.name}{hidden && <span class="pill hid">{HOME_HIDDEN_LABEL}</span>}{empty && <span class="pill tag">완료 세트 0</span>}{edited && <span class="pill">고침</span>}</div>
        <div class="wc-meta">{w ? timeLabel(w.startedAt) : x.date}</div>
        <div class="wc-chips">
          <span class="chip2">⏱ {durText(x.durationSec)}</span>
          <span class="chip2">세트 {x.workSets}</span>
          <span class="chip2">볼륨 {x.volume.toLocaleString()}kg</span>
          {diff !== undefined && Math.abs(diff) >= 60 && <span class="chip2 hint">예상보다 {Math.round(Math.abs(diff) / 60)}분 {diff > 0 ? '김' : '짧음'}</span>}
        </div>
        {parts.length > 0 && <div class="wc-tags">{parts.map((p) => <span class="ptag" key={p}>{shortPart(p)}</span>)}</div>}
        {lines.slice(0, 3).map((l, i) => <div class="wc-ex" key={i}>{l.name} · {l.sets}세트{l.best ? ` · 최고 ${l.best}` : ''}</div>)}
        {lines.length > 3 && <div class="wc-ex more">외 {lines.length - 3}개 운동</div>}
      </div>
      {!withMenu && <Icon name="chevron" size={18} class="wc-arrow" />}
    </button>
  );
}

/** 홈 "최근 운동": 같은 카드 + 오른쪽 위 ⋯ (수정·삭제). 묶음 이름 "최근 운동 {이름}" */
export function WorkoutCardWithMenu(p: { x: WorkoutSummary; w: Workout; byId: Map<string, Exercise>; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const name = p.w.name;
  return (
    <div class="wcard-wrap" role="group" aria-label={`최근 운동 ${name}`}>
      <WorkoutCard x={p.x} w={p.w} byId={p.byId} hidden={false} withMenu />
      <button class="icon-btn round wc-menu" aria-label={`최근 운동 ${name} 메뉴`} aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="more" /></button>
      {open && <MenuSheet title={name} items={p.items} onClose={() => setOpen(false)} />}
    </div>
  );
}
