/** D-081 기간 요약 문구 (순수 함수). 조사(이/가·은/는·와/과)는 받침으로 고른다 */
import { WD, weekRangeText } from './dateText';
import { durText } from './stats';
import type { PeriodKind, PeriodMetric, PeriodRange } from './period';

/** 마지막 글자에 받침이 있나 (한글 음절, 'g'(kg = 킬로그램)는 있음, 그 밖은 없음으로 본다) */
export function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  return word.endsWith('g');
}
/** josa('볼륨', '이', '가') → '볼륨이' */
export const josa = (word: string, withBatchim: string, without: string) => word + (hasBatchim(word) ? withBatchim : without);

export const METRIC_NAME: Record<PeriodMetric, string> = { count: '운동', sets: '작업 세트', volume: '볼륨', time: '시간' };
export const METRICS: PeriodMetric[] = ['count', 'sets', 'volume', 'time'];
export const KIND_LABEL: Record<PeriodKind, string> = { week: '주', month: '월', year: '년' };
const UNIT: Record<PeriodKind, string> = { week: '주', month: '달', year: '해' };

const round1 = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 10) / 10);
/** 값 문구: 운동 "3회", 세트 "9세트", 볼륨 "1,200kg", 시간 durText */
export function valueText(m: PeriodMetric, v: number): string {
  if (m === 'count') return `${round1(v).toLocaleString()}회`;
  if (m === 'sets') return `${round1(v).toLocaleString()}세트`;
  if (m === 'volume') return `${Math.round(v).toLocaleString()}kg`;
  return durText(v);
}
/** 큰 숫자·작은 단위 쌍 (시간은 durParts 를 따로 씀) */
export const metricValue = (m: PeriodMetric, totals: { count: number; sets: number; volume: number; durationSec: number }) =>
  m === 'count' ? totals.count : m === 'sets' ? totals.sets : m === 'volume' ? totals.volume : totals.durationSec;

/** 이전 기간 이름. 현재 기간이면 지난주/지난달/작년 (+ "이맘때"는 headline 에서만), 지난 기간이면 그 전 주/달/해 */
export function prevName(kind: PeriodKind, current: boolean, short = false): string {
  if (!current) return `그 전 ${UNIT[kind]}`;
  const base = kind === 'week' ? '지난주' : kind === 'month' ? '지난달' : '작년';
  return short ? base : `${base} 이맘때`;
}
/** 접근성 문구용 비교 대상: "지난주 같은 요일까지" / "그 전 주" */
export function prevPhrase(kind: PeriodKind, current: boolean): string {
  if (!current) return prevName(kind, false);
  return `${prevName(kind, true, true)} ${kind === 'week' ? '같은 요일까지' : '같은 날까지'}`;
}

/** 이동줄 이름: offset 0 이번 주/달·올해, 1 지난주·지난달·작년, 그 밖은 날짜 이름 */
export function periodLabel(r: PeriodRange, offset: number, today: string): string {
  const [y, m] = r.start.split('-').map(Number);
  const ty = Number(today.slice(0, 4));
  if (r.kind === 'week') return offset === 0 ? '이번 주' : offset === 1 ? '지난주' : weekRangeText(r.start, today);
  if (r.kind === 'month') return offset === 0 ? '이번 달' : offset === 1 ? '지난달' : `${y === ty ? '' : `${y}년 `}${m}월`;
  return offset === 0 ? '올해' : offset === 1 ? '작년' : `${y}년`;
}
/** 날짜 범위 줄 */
export function rangeText(r: PeriodRange, today: string): string {
  const [y, m] = r.start.split('-').map(Number);
  if (r.kind === 'week') return weekRangeText(r.start, today);
  if (r.kind === 'month') {
    const last = new Date(y!, m!, 0).getDate();
    return `${y === Number(today.slice(0, 4)) ? '' : `${y}년 `}${m}월 1일~${last}일`;
  }
  return `${y}년 1월~12월`;
}
/** 이동줄 밑 비교 대상 */
export function compareLine(kind: PeriodKind, current: boolean): string {
  if (!current) return `vs. ${prevName(kind, false)}`;
  return `vs. ${prevPhrase(kind, true)}`;
}

/** 한 줄 요약 (고른 지표 기준) */
export function headline(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; label: string }): string {
  const { kind, current, metric, cur, prev, label } = o;
  const name = METRIC_NAME[metric];
  if (cur === 0 && prev === 0) return current ? `${josa(label, '은', '는')} 아직 운동 기록이 없어요` : '이 기간에는 운동 기록이 없어요';
  const pn = prevName(kind, current);
  if (prev === 0) return `${josa(pn, '은', '는')} 기록이 없었어요 · ${label} ${valueText(metric, cur)}`;
  if (cur === prev) return `${josa(pn, '과', '와')} ${josa(name, '이', '가')} 같아요`;
  const more = cur > prev;
  const adj = metric === 'time' ? (more ? '길어요' : '짧아요') : (more ? '많아요' : '적어요');
  return `${pn}보다 ${josa(name, '이', '가')} ${valueText(metric, Math.abs(cur - prev))} ${adj}`;
}

/** 카드 aria-label: "운동 1회, 지난주 같은 요일까지 0회보다 1회 많음" */
export function cardAria(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number }): string {
  const { kind, current, metric, cur, prev } = o;
  const pp = prevPhrase(kind, current), cv = valueText(metric, cur), pv = valueText(metric, prev);
  const head = `${METRIC_NAME[metric]} ${cv}, ${pp} `;
  if (cur === prev) return `${head}${josa(pv, '과', '와')} 같음`;
  return `${head}${pv}보다 ${valueText(metric, Math.abs(cur - prev))} ${cur > prev ? '많음' : '적음'}`;
}

/** 칸 날짜 문구: week·month "11월 16일 (월)", year "2026년 3월" */
export function bucketText(kind: PeriodKind, start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  if (kind === 'year') return `${y}년 ${m}월`;
  return `${m}월 ${d}일 (${WD[new Date(y!, m! - 1, d!).getDay()]})`;
}

/** 아래 작은 글씨 (현재 기간이면 through = 이전 기간의 비교 끝 날짜) */
export function footnote(kind: PeriodKind, current: boolean, through: string, streak: number, todayWd: number): string {
  if (!current) return `▲▼ = ${prevName(kind, false)} 전체와 비교`;
  const [, m, d] = through.split('-').map(Number);
  if (kind === 'week') return `▲▼ = 지난주 같은 요일(일${todayWd > 0 ? `~${WD[todayWd]}` : ''})까지와 비교 · 연속 ${streak}주 · 일요일~토요일 기준`;
  if (kind === 'month') return `▲▼ = 지난달 같은 날(${d === 1 ? '1일' : `1~${d}일`})까지와 비교`;
  return `▲▼ = 작년 같은 날(1월 1일~${m}월 ${d}일)까지와 비교`;
}
