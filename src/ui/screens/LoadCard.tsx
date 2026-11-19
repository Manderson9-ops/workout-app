/**
 * D-082 훈련 부하 카드 (기록 → 요약). 최근 7일 작업 세트 ÷ 4주 평균. 계산은 core/stats.ts loadView, 문구는 core/loadText.ts
 */
import { useMemo } from 'preact/hooks';
import type { Workout } from '../../core/session';
import type { Exercise } from '../../core/types';
import { loadView, loadVd, dailyWorkSets } from '../../core/stats';
import { firstRecordDate } from '../../core/period';
import { WD } from '../../core/dateText';
import { LOAD_NOTE, LOAD_ZONE_NAME, loadChartLabel, loadSayText, loadWaitText, loadWeekText, loadEmptyWindows } from '../../core/loadText';
import { LoadDots } from '../charts';

const parseDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y!, m! - 1, dd!); };

export function LoadCard({ workouts, byId, today }: { workouts: Workout[]; byId: Map<string, Exercise>; today: string }) {
  // 비율 0 이면 4주 창이 정말 비었는지(오늘·지난주 같은 요일) 따로 셈: 창에 세트가 있는데 최근 7일만 쉰 경우와 문구가 다름
  const { v, empty, prevEmpty } = useMemo(() => {
    const v = loadView(workouts, byId, today, firstRecordDate(workouts, today));
    if (!v.show || v.vd !== 0) return { v, empty: false, prevEmpty: false };
    return { v, ...loadEmptyWindows(dailyWorkSets(workouts, byId, today), today, v.nd, v.histDays, v.prevVd !== null) };
  }, [workouts, byId, today]);
  return (
    <section class="card load-card" data-testid="load-card">
      <div class="load-head"><h2 class="card-title">훈련 부하 비율 · 작업 세트 기준</h2><span class="sub small">최근 7일 ÷ 4주 평균</span></div>
      {!v.show ? <p class="load-wait" data-testid="load-wait">{loadWaitText(v.histDays)}</p> : (
        <div data-testid="load-body">
          <div class="load-top">
            <span class="load-ratio" data-testid="load-ratio">{v.vd.toFixed(2)}</span>
            <span class={`load-zone ${v.zone}`} data-testid="load-zone">{LOAD_ZONE_NAME[v.zone]}</span>
          </div>
          <div class="load-band" aria-hidden="true"><span class="load-mk" style={{ left: `calc(${v.mk}% - 2px)` }} /></div>
          <div class="load-band-l" aria-hidden="true">
            <span style={{ left: '0' }}>0</span><span style={{ left: '40%' }}>0.8</span><span style={{ left: '65%' }}>1.3</span><span style={{ left: '75%' }}>1.5</span><span style={{ left: '100%' }}>2.0+</span>
          </div>
          <p class="load-week" data-testid="load-week">{loadWeekText(WD[parseDay(today).getDay()]!, v.vd, v.prevVd, empty && prevEmpty)}</p>
          <p class="load-say" data-testid="load-say">{loadSayText(v.zone, v.last7, v.nd, empty)}</p>
          <LoadDots days={v.days} rs={v.rs} rp={v.rp} lo={v.lo} hi={v.hi}
            label={loadChartLabel(v.days, v.rs.map((r) => (r === null ? null : loadVd(r))), v.rp.map((r) => (r === null ? null : loadVd(r))))} />
          <div class="load-legend sub small"><span><i class="load-lg-solid" aria-hidden="true" />최근 7일</span><span><i class="load-lg-dash" aria-hidden="true" />지난주 같은 요일</span></div>
        </div>
      )}
      <p class="sub small load-note" data-testid="load-note">{LOAD_NOTE}</p>
    </section>
  );
}
