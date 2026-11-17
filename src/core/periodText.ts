/** D-081 기간 요약 문구 (순수 함수). 조사(이/가·은/는·와/과)는 받침으로 고른다 */
import { WD, weekRangeText } from './dateText';
import { durText, durParts } from './stats';
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
const PAST: Record<PeriodKind, string> = { week: '그 전 주', month: '그 전 달', year: '전년' };

/** 톤 문구용 숫자: 10톤 미만은 소수 한 자리(0.3), 그 이상은 정수 */
const tonNum = (kg: number): string => (kg / 1000 < 9.95 ? Math.round(kg / 100) / 10 : Math.round(kg / 1000)).toLocaleString('ko-KR');
const round1 = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 10) / 10);
/** 값 문구: 운동 "3회", 세트 "9세트", 볼륨 "1,200kg", 시간 durText */
export function valueText(m: PeriodMetric, v: number, ton = false): string {
  if (m === 'count') return `${round1(v).toLocaleString('ko-KR')}회`;
  if (m === 'sets') return `${round1(v).toLocaleString('ko-KR')}세트`;
  if (m === 'volume') return ton ? (v > 0 && v < 50 ? '0.1톤 미만' : `${tonNum(v)}톤`) : `${Math.round(v).toLocaleString('ko-KR')}kg`;
  return durText(v);
}
/** 카드 큰 숫자·작은 단위 쌍: 천 단위 쉼표, 시간은 10시간 이상이면 시간만 (반올림) */
export function bigParts(m: PeriodMetric, v: number, ton = false): [string | number, string][] {
  if (m === 'count') return [[v.toLocaleString('ko-KR'), '회']];
  if (m === 'sets') return [[v.toLocaleString('ko-KR'), '세트']];
  if (m === 'volume') return ton ? (v > 0 && v < 50 ? [['0.1', '톤 미만']] : [[tonNum(v), '톤']]) : [[Math.round(v).toLocaleString('ko-KR'), 'kg']];
  return v >= 36000 ? [[Math.round(v / 3600).toLocaleString('ko-KR'), '시간']] : durParts(v);
}
/** 볼륨이 100만 kg 이상이면 카드의 큰 숫자·이전 값 줄을 톤으로 (390px 에서 일곱 자리 숫자가 안 들어감) */
export const tonMode = (cur: number, prev: number): boolean => Math.max(cur, prev) >= 1_000_000;
/**
 * 견줄 때 쓰는 값: 사용자에게 보이는 정밀도로 맞춘 같은 단위(시간 초, 볼륨 kg) 값 둘.
 * 시간 = 분 단위(어느 한쪽이 1분 미만이면 초; badge 이고 큰 숫자가 10시간 이상이면 시간 단위), 볼륨 kg = 정수, 톤 = 보이는 단계(10톤 미만 0.1톤, 이상 1톤, 0 초과 50kg 미만은 따로 한 단계).
 * 같으면 ▲▼ 대신 "=" 와 "같아요"
 */
export function cmpValues(m: PeriodMetric, cur: number, prev: number, ton = false, badge = false): [number, number] {
  if (m === 'time') {
    if (cur < 60 || prev < 60) return [Math.round(cur), Math.round(prev)];
    if (badge && cur >= 36000) return [Math.round(cur / 3600) * 3600, Math.round(prev / 3600) * 3600]; // 큰 숫자가 시간만 보일 때 배지도 시간 단위
    return [Math.round(cur / 60) * 60, Math.round(prev / 60) * 60];
  }
  if (m !== 'volume') return [cur, prev];
  if (!ton) return [Math.round(cur), Math.round(prev)];
  const step = (v: number) => (v <= 0 ? 0 : v < 50 ? 25 : v / 1000 < 9.95 ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000);
  return [step(cur), step(prev)];
}
/** 평균 문구: 운동한 날(년은 달) 평균, 횟수·세트·볼륨은 정수로 */
export function avgText(kind: PeriodKind, m: PeriodMetric, v: number, ton = false): string {
  return `${kind === 'year' ? '운동한 달' : '운동한 날'} 평균 ${m === 'time' ? durText(v) : valueText(m, Math.round(v), ton)}`;
}
export const metricValue = (m: PeriodMetric, totals: { count: number; sets: number; volume: number; durationSec: number }) =>
  m === 'count' ? totals.count : m === 'sets' ? totals.sets : m === 'volume' ? totals.volume : totals.durationSec;

/** 이전 기간 이름. 현재 기간이면 지난주/지난달/작년 (+ "이맘때"는 headline 에서만), 지난 기간이면 그 전 주/달/해 */
export function prevName(kind: PeriodKind, current: boolean, short = false): string {
  if (!current) return PAST[kind];
  const base = kind === 'week' ? '지난주' : kind === 'month' ? '지난달' : '작년';
  return short ? base : `${base} 이맘때`;
}
/** 접근성 문구용 비교 대상: "지난주 같은 요일까지" / "그 전 주" */
export function prevPhrase(kind: PeriodKind, current: boolean): string {
  if (!current) return prevName(kind, false);
  return `${prevName(kind, true, true)} ${kind === 'week' ? '같은 요일까지' : '같은 날까지'}`;
}

/** 카드 작은 줄: 현재 기간이면 "지난주 12세트" (무엇과 견주는지는 카드 위 한 줄 안내), 첫날 운동 전이면 안내 */
export const WAITING_LINE = '운동하면 비교해요';
/** 카드 격자 위 안내: 현재 기간의 작은 글씨가 이전 기간 어느 시점 값인지 */
export const prevNote = (kind: PeriodKind): string => `작은 글씨 = ${prevName(kind, true)} 값`;

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
/** 이동줄 밑 비교 대상 (짧게: 정확한 기준은 한 문장·아래 글에) */
export const compareLine = (kind: PeriodKind, current: boolean): string => `vs. ${prevName(kind, current, true)}`;

/** 한 줄 요약 조각: nw 는 줄바꿈 없이 붙여 보일 부분(라벨·값). 화면 읽기·복사에는 일반 띄어쓰기 그대로 */
export interface HeadlinePart { text: string; nw?: boolean }
export const headlineText = (parts: HeadlinePart[]): string => parts.map((p) => p.text).join('');
const T = (text: string): HeadlinePart => ({ text });
const N = (text: string): HeadlinePart => ({ text, nw: true });
/** 단어 + 조사 (단어는 nw) */
const J = (word: string, withBatchim: string, without: string): HeadlinePart[] => [N(word), T(hasBatchim(word) ? withBatchim : without)];

/** 한 줄 요약 (고른 지표 기준). 운동이 있었는지는 운동 수(curCount·prevCount)로 가림: 지표 값이 0이어도 운동은 있을 수 있음(맨몸 운동의 볼륨) */
export function headline(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; curCount: number; prevCount: number; label: string }): HeadlinePart[] {
  const { kind, current, metric, cur, prev, curCount, prevCount, label } = o;
  const name = METRIC_NAME[metric];
  const none = (): HeadlinePart[] => (current ? [...J(label, '은', '는'), T(' 아직 운동 기록이 없어요')] : [T('이 기간에는 운동 기록이 없어요')]);
  if (curCount === 0 && prevCount === 0) return none();
  const ton = metric === 'volume' && tonMode(cur, prev);
  const val = (v: number) => N(valueText(metric, v, ton));
  const pn = prevName(kind, current);
  if (prevCount === 0) return [...J(pn, '은', '는'), T(' 운동이 없었어요 · '), N(label), T(' '), val(cur)];
  if (metric === 'volume' && cur === 0 && prev === 0) return curCount === 0 ? none() : [T('무게를 적은 세트가 없어 볼륨은 0kg이에요')];
  const [c, p] = cmpValues(metric, cur, prev, ton);
  if (c === p) return [...J(pn, '과', '와'), T(` ${josa(name, '이', '가')} 같아요`)];
  const adj = metric === 'time' ? (c > p ? '길어요' : '짧아요') : (c > p ? '많아요' : '적어요');
  return [N(pn), T(`보다 ${josa(name, '이', '가')} `), val(Math.abs(c - p)), T(` ${adj}`)];
}

/** 카드 aria-label: "운동 1회, 지난주 같은 요일까지 0회보다 1회 많음" */
export function cardAria(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; ton?: boolean; waiting?: boolean }): string {
  const { kind, current, metric, cur, prev, ton, waiting } = o;
  if (waiting) return `${METRIC_NAME[metric]} ${valueText(metric, cur, ton)}, 오늘 운동하면 ${prevPhrase(kind, current)}와 비교해요`;
  const pp = prevPhrase(kind, current), cv = valueText(metric, cur, ton), pv = valueText(metric, prev, ton);
  const head = `${METRIC_NAME[metric]} ${cv}, ${pp} `;
  const [c, p] = cmpValues(metric, cur, prev, ton);
  if (c === p) return `${head}${josa(pv, '과', '와')} 같음`;
  return `${head}${pv}보다 ${valueText(metric, Math.abs(c - p), ton)} ${metric === 'time' ? (c > p ? '김' : '짧음') : (c > p ? '많음' : '적음')}`;
}

/** 칸 날짜 문구: week·month "11월 16일 (월)", year "2026년 3월" */
export function bucketText(kind: PeriodKind, start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  if (kind === 'year') return `${y}년 ${m}월`;
  return `${m}월 ${d}일 (${WD[new Date(y!, m! - 1, d!).getDay()]})`;
}

/** 아래 작은 글씨 (현재 기간이면 through = 이전 기간의 비교 끝 날짜) */
export function footnote(kind: PeriodKind, current: boolean, through: string, streak: number, todayWd: number, waiting = false): string {
  if (!current) return `▲▼ = ${prevName(kind, false)} 전체와 비교`;
  const [, m, d] = through.split('-').map(Number);
  if (waiting) return kind === 'week' ? '▲▼ = 오늘 운동하면 지난주 같은 요일(일)까지와 비교' : kind === 'month' ? '▲▼ = 오늘 운동하면 지난달 같은 날(1일)까지와 비교' : '▲▼ = 오늘 운동하면 작년 같은 날(1월 1일)까지와 비교';
  if (kind === 'week') return `▲▼ = 지난주 같은 요일(일${todayWd > 0 ? `~${WD[todayWd]}` : ''})까지와 비교 · 오늘 운동 전이면 어제까지 · 연속 ${streak}주 · 일요일~토요일 기준`;
  if (kind === 'month') return `▲▼ = 지난달 같은 날(${d === 1 ? '1일' : `1~${d}일`})까지와 비교 · 오늘 운동 전이면 어제까지`;
  return `▲▼ = 작년 같은 날(${m === 1 && d === 1 ? '1월 1일' : `1월 1일~${m}월 ${d}일`})까지와 비교 · 오늘 운동 전이면 어제까지`;
}
