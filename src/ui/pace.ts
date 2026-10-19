/**
 * 화면용 내 속도·최근 2주 세트 (D-067). 계산은 core/routineFit, 여기서는 기록이 바뀔 때만 다시 셈
 */
import type { AppState } from './store';
import { historyOf } from './store';
import { personalPace, paceLabel, recentSets, targetMinutesOf } from '../core/routineFit';
import type { Pace, PaceLabel, Recent } from '../core/routineFit';
import type { Routine, Workout } from '../core/session';
import type { Part } from '../core/types';

let paceKey: Workout[] | null = null;
let paceVal: Pace | undefined;
/** 내 속도 (기록 3회 미만이면 undefined) */
export function paceOf(s: AppState): Pace | undefined {
  if (paceKey !== s.workouts) { paceKey = s.workouts; paceVal = personalPace(historyOf(s)); }
  return paceVal;
}

/** 이 루틴의 목표 분: 이름의 "N분", 없으면 설정의 기본 시간 */
export const targetOf = (s: AppState, r: Routine): number => targetMinutesOf(r.name, s.settings.defaultMinutes);

/** 카드·편집 화면 한 줄 (기록이 모자라면 undefined → 안 보여 줌) */
export const paceLabelOf = (s: AppState, r: Routine): PaceLabel | undefined => paceLabel(r, paceOf(s), targetOf(s, r));

/** 최근 2주 부위·운동별 작업 세트 */
export function recentOf(s: AppState, partOf: (id: string) => Part | undefined): Recent {
  return recentSets(historyOf(s), partOf, Date.now());
}

// 카드의 [맞추기] → 편집 화면을 열며 맞추기 창을 바로 띄움 (해시 경로엔 쿼리를 못 실어서 모듈 변수, nav.editReturn과 같은 방식)
let fitOnOpen: string | null = null;
export const setFitOnOpen = (id: string | null) => { fitOnOpen = id; };
/** 이 루틴 편집 화면이 맞추기 창을 띄워야 하면 true (한 번만) */
export function takeFitOnOpen(id: string): boolean { const v = fitOnOpen === id; if (v) fitOnOpen = null; return v; }
