/**
 * D-082 기간 내역 (기록 → 요약): 기간 카드가 보는 기간의 운동 목록(그래프에서 칸을 고르면 그 칸만), 최신순, 5개씩 더 보기.
 * 행을 누르면 그 기록 상세. 같은 보기 상태(usePeriodView)를 기간 카드와 나눠 씀
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { AppState } from '../store';
import type { Workout } from '../../core/session';
import type { Exercise } from '../../core/types';
import { summarize, localDate, durText, isCountedWorkout } from '../../core/stats';
import { periodLabel, bucketTitle, valueText } from '../../core/periodText';
import { WD } from '../../core/dateText';
import { go } from '../nav';
import type { PeriodView } from './PeriodCard';

const dateLabel = (date: string): string => { const [y, m, d] = date.split('-').map(Number); return `${m}/${d} (${WD[new Date(y!, m! - 1, d!).getDay()]})`; };

export function PeriodHistory({ v, sorted, byId, bw, today, onAll }: {
  v: PeriodView;
  /** 끝낸 운동 최신순 */
  sorted: Workout[]; byId: Map<string, Exercise>; bw: AppState['bodyweight']; today: string;
  /** [전체 기록 보기] */
  onAll: () => void;
}) {
  const { kind, range, buckets, selv, shown, off } = v;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const focusRow = useRef<number | null>(null); // 더 보기 뒤 초점을 줄 새 첫 행 번호
  const b = selv === null ? null : buckets[selv]!;
  const a0 = b ? b.start : range.start, a1 = b ? b.end : range.end;
  const list = useMemo(() => sorted.filter((w) => { if (!isCountedWorkout(w)) return false; const d = localDate(w.startedAt); return d >= a0 && d < a1 && d <= today; }), [sorted, a0, a1, today]);
  const name = b ? bucketTitle(kind, b.start) : periodLabel(range, off, today);
  const show = list.slice(0, shown);
  const left = list.length - show.length;
  // 다 펼치면 눌렀던 버튼이 사라지므로 초점을 제목으로, 아직 남았으면 새로 보인 첫 행으로 (다시 그린 뒤 effect 에서)
  const more = () => { if (left <= 5) titleRef.current?.focus(); else focusRow.current = show.length; v.more(); };
  useEffect(() => {
    if (focusRow.current === null) return;
    listRef.current?.querySelectorAll<HTMLButtonElement>('button.ph-row')[focusRow.current]?.focus();
    focusRow.current = null;
  }, [shown]);
  return (
    <section class="card hist" data-testid="period-history">
      <div class="ph-head">
        <h2 class="ph-title" ref={titleRef} tabIndex={-1} data-testid="history-title">{name} 운동 {list.length}개</h2>
        <button class="ghost" onClick={onAll}>전체 기록 보기</button>
      </div>
      {list.length === 0 ? <p class="sub ph-empty" data-testid="history-empty">이 기간에는 운동 기록이 없어요.</p> : (
        <ul class="ph-list" ref={listRef} aria-label={`${name} 운동 목록`}>
          {show.map((w) => {
            const x = summarize(w, byId, bw);
            return (
              <li key={w.id}>
                <button class="ph-row" data-testid="history-row" onClick={() => go(`#/stats/w/${encodeURIComponent(w.id)}`)}>
                  <span class="ph-d">{dateLabel(x.date)}</span>
                  <span class="ph-n">{x.name}</span>
                  <span class="ph-m">{x.workSets}세트 · {valueText('volume', x.volume)} · {durText(x.durationSec)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {left > 0 && <button class="ph-more" data-testid="history-more" onClick={more}>{Math.min(5, left)}개 더 보기 (남은 {left}개)</button>}
    </section>
  );
}
