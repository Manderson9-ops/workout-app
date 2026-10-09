/**
 * 끝낸 운동 카드 (D-054 기록 탭 카드, D-055: 홈 "최근 운동"도 같은 카드). 누르면 기록 상세.
 * 홈에서는 오른쪽 위에 ⋯(수정·삭제) 버튼이 붙음 (WorkoutCardWithMenu).
 */
import { useMemo, useState } from 'preact/hooks';
import type { Exercise } from '../../core/types';
import { PARTS } from '../../core/types';
import type { Workout } from '../../core/session';
import type { HealthRow } from '../../core/health';
import { watchFor, watchLine } from '../../core/health';
import { HOME_HIDDEN_LABEL } from '../../core/session';
import type { WorkoutSummary } from '../../core/stats';
import { exerciseLines, durText, durParts } from '../../core/stats';
import { go } from '../nav';
import { dateTimeText, dayText, fullText, fullDateText } from '../../core/dateText';
import { Icon } from '../icons';
import { MenuSheet } from '../components';
import type { MenuItem } from '../components';

export const shortPart = (p: string) => (p === '전완·악력' ? '전완' : p);
/** 카드 시각: "오늘 오전 11:24", "어제 오후 7:05", "월요일 …", "10월 8일(수) …" (D-060) */
export const timeLabel = (iso: string, now = Date.now()) => dateTimeText(iso, now);

export function WorkoutCard({ x, w, byId, hidden, withMenu, health }: { x: WorkoutSummary; w: Workout | undefined; byId: Map<string, Exercise>; hidden: boolean; withMenu?: boolean; health?: readonly HealthRow[] }) {
  // D-058: 애플워치 기록이 이 운동 시간과 겹칠 때만 한 줄
  const watch = useMemo(() => (w && health?.length ? watchFor(w, health) : undefined), [w, health]);
  const diff = x.plannedSec ? x.durationSec - x.plannedSec : undefined;
  const lines = w ? exerciseLines(w, byId) : [];
  const parts = PARTS.filter((p) => (x.parts[p] ?? 0) > 0);
  const empty = x.workSets === 0;
  const edited = !!w?.editedAt;
  // 화면 읽기용 전체 요약 (본문이 가려지지 않게). 홈에서 뺌 표시는 맨 끝
  const label = `${x.name}, ${w ? fullText(w.startedAt) : fullDateText(x.date)}, ${durText(x.durationSec)}, 세트 ${x.workSets}, 볼륨 ${x.volume.toLocaleString()}kg${empty ? ', 완료 세트 0' : ''}${edited ? ', 고침' : ''}${lines.slice(0, 3).map((l) => `, ${l.name} ${l.sets}세트${l.best ? ` 최고 ${l.best}` : ''}`).join('')}${lines.length > 3 ? `, 외 ${lines.length - 3}개 운동` : ''}${watch ? `, ${watchLine(watch)}` : ''}${hidden ? ` (${HOME_HIDDEN_LABEL})` : ''}`;
  return (
    <button class={`wcard${empty ? ' dim' : ''}${withMenu ? ' has-menu' : ''}`} aria-label={label} onClick={() => go(`#/stats/w/${encodeURIComponent(x.id)}`)}>
      <div class="wc-main">
        <div class="wc-title">{x.name}{hidden && <span class="pill hid">{HOME_HIDDEN_LABEL}</span>}{empty && <span class="pill tag">완료 세트 0</span>}{edited && <span class="pill">고침</span>}</div>
        <div class="wc-meta">{w ? timeLabel(w.startedAt) : dayText(x.date, Date.now())}</div>
        {/* D-055 3단계: 숫자는 작은 Metric (라벨 + 굵은 숫자 + 작은 단위, 고정폭) */}
        <div class="wc-metrics" aria-hidden="true">
          <span class="mm"><span class="mm-l">시간</span> <span class="mm-v">{durParts(x.durationSec).map(([n, u], i) => <span key={i}><b>{n}</b><small>{u}</small></span>)}</span></span>
          <span class="mm"><span class="mm-l">세트</span> <span class="mm-v"><b>{x.workSets}</b></span></span>
          <span class="mm"><span class="mm-l">볼륨</span> <span class="mm-v"><b>{x.volume.toLocaleString()}</b><small>kg</small></span></span>
        </div>
        {watch && <div class="wc-watch" data-testid="wc-watch" aria-hidden="true"><Icon name="heart" size={14} />{watchLine(watch)}</div>}
        {diff !== undefined && Math.abs(diff) >= 60 && <div class="wc-chips"><span class="chip2 hint">예상보다 {Math.round(Math.abs(diff) / 60)}분 {diff > 0 ? '김' : '짧음'}</span></div>}
        {parts.length > 0 && <div class="wc-tags">{parts.map((p) => <span class="ptag" key={p}>{shortPart(p)}</span>)}</div>}
        {lines.slice(0, 3).map((l, i) => <div class="wc-ex" key={i}>{l.name} · {l.sets}세트{l.best ? ` · 최고 ${l.best}` : ''}</div>)}
        {lines.length > 3 && <div class="wc-ex more">외 {lines.length - 3}개 운동</div>}
      </div>
      {!withMenu && <Icon name="chevron" size={18} class="wc-arrow" />}
    </button>
  );
}

/** 홈 "최근 운동": 같은 카드 + 오른쪽 위 ⋯ (수정·삭제). 묶음 이름 "최근 운동 {이름}" */
export function WorkoutCardWithMenu(p: { x: WorkoutSummary; w: Workout; byId: Map<string, Exercise>; items: MenuItem[]; health?: readonly HealthRow[] }) {
  const [open, setOpen] = useState(false);
  const name = p.w.name;
  return (
    <div class="wcard-wrap" role="group" aria-label={`최근 운동 ${name}`}>
      <WorkoutCard x={p.x} w={p.w} byId={p.byId} hidden={false} withMenu health={p.health} />
      <button class="icon-btn round wc-menu" aria-label={`최근 운동 ${name} 메뉴`} aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="more" /></button>
      {open && <MenuSheet title={name} items={p.items} onClose={() => setOpen(false)} />}
    </div>
  );
}
