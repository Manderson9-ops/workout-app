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
/** 카드 큰 숫자·작은 단위 쌍: 천 단위 쉼표, 시간은 시간·분 */
export function bigParts(m: PeriodMetric, v: number, ton = false): [string | number, string][] {
  if (m === 'count') return [[v.toLocaleString('ko-KR'), '회']];
  if (m === 'sets') return [[v.toLocaleString('ko-KR'), '세트']];
  if (m === 'volume') return ton ? (v > 0 && v < 50 ? [['0.1', '톤 미만']] : [[tonNum(v), '톤']]) : [[Math.round(v).toLocaleString('ko-KR'), 'kg']];
  return durParts(v);
}
/** 볼륨이 100만 kg 이상이면 카드의 큰 숫자·이전 값 줄을 톤으로 (390px 에서 일곱 자리 숫자가 안 들어감) */
export const tonMode = (cur: number, prev: number): boolean => Math.max(cur, prev) >= 1_000_000;
/**
 * 견줄 때 쓰는 값: 사용자에게 보이는 정밀도로 맞춘 같은 단위(시간 초, 볼륨 kg) 값 둘.
 * 시간 = 분 단위(어느 한쪽이 1분 미만이면 초), 볼륨 kg = 정수, 톤 = 보이는 단계(10톤 미만 0.1톤, 이상 1톤, 0 초과 50kg 미만은 따로 한 단계).
 * 같으면 ▲▼ 대신 "=" 와 "같아요"
 */
export function cmpValues(m: PeriodMetric, cur: number, prev: number, ton = false): [number, number] {
  if (m === 'time') {
    if (cur < 60 || prev < 60) return [Math.round(cur), Math.round(prev)];
    return [Math.round(cur / 60) * 60, Math.round(prev / 60) * 60];
  }
  if (m !== 'volume') return [cur, prev];
  if (!ton) return [Math.round(cur), Math.round(prev)];
  const step = (v: number) => (v <= 0 ? 0 : v < 50 ? 25 : v / 1000 < 9.95 ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000);
  return [step(cur), step(prev)];
}
/** 평균 문구: 운동한 날(년은 달) 평균. 횟수·세트는 소수 한 자리까지, 볼륨은 정수(톤은 보이는 단계), 시간은 시간·분 */
export function avgText(kind: PeriodKind, m: PeriodMetric, v: number, ton = false, exclNow = false): string {
  return `${kind === 'year' ? '운동한 달' : '운동한 날'} 평균${exclNow ? '(이번 달 제외)' : ''} ${m === 'time' ? durText(v) : m === 'volume' ? valueText(m, Math.round(v), ton) : valueText(m, v)}`; // 횟수·세트는 소수 한 자리까지
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

/**
 * 이번 달이 더 길어 비교 구간이 지난달 전체인 경우 (예: 3/29~31 을 2/1~28 과 견줌): 기준일(오늘, 운동 전이면 어제)이 지난달 말일을 넘음.
 * 한 문장·작은 글씨 안내·읽기 문구·각주가 모두 이 한 곳의 판정을 따름
 */
export function wholePrevMonth(kind: PeriodKind, current: boolean, o: { through: string; today: string; done: boolean }): boolean {
  if (kind !== 'month' || !current) return false;
  return Number(o.today.slice(8)) - (o.done ? 0 : 1) > Number(o.through.slice(8));
}

/** 카드 작은 줄: 현재 기간이면 "지난주 12세트" (무엇과 견주는지는 카드 위 한 줄 안내), 첫날 운동 전이면 안내 */
export const WAITING_LINE = '운동하면 비교해요';
/** 카드 격자 위 안내: 현재 기간의 작은 글씨가 이전 기간 어느 시점 값인지 */
export const prevNote = (kind: PeriodKind, current: boolean, whole = false): string => (whole ? '작은 글씨 = 지난달 전체 값' : current ? `작은 글씨 = ${prevName(kind, true)} 값` : `작은 글씨 = ${prevName(kind, false)} 전체 값`);

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
const T = (text: string): HeadlinePart => ({ text });
const N = (text: string): HeadlinePart => ({ text, nw: true });
/** 단어 + 조사 (단어는 nw) */
const J = (word: string, withBatchim: string, without: string): HeadlinePart[] => [N(word), T(hasBatchim(word) ? withBatchim : without)];

/** 한 줄 요약 (고른 지표 기준). 운동이 있었는지는 운동 수(curCount·prevCount)로 가림: 지표 값이 0이어도 운동은 있을 수 있음(맨몸 운동의 볼륨) */
export function headline(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; curCount: number; prevCount: number; label: string; whole?: boolean }): HeadlinePart[] {
  const { kind, current, metric, cur, prev, curCount, prevCount, label, whole } = o;
  const name = METRIC_NAME[metric];
  const none = (): HeadlinePart[] => (current ? [...J(label, '은', '는'), T(' 아직 운동 기록이 없어요')] : [T('이 기간에는 운동 기록이 없어요')]);
  if (curCount === 0 && prevCount === 0) return none();
  const ton = metric === 'volume' && tonMode(cur, prev);
  const val = (v: number) => N(valueText(metric, v, ton));
  const pn = whole ? '지난달 전체' : prevName(kind, current);
  if (prevCount === 0) return [...J(pn, '은', '는'), T(' 운동이 없었어요 · '), N(label), T(' '), val(cur)];
  if (metric === 'volume' && cur === 0 && prev === 0) return curCount === 0 ? none() : [T('무게를 적은 세트가 없어 볼륨은 0kg이에요')];
  const [c, p] = cmpValues(metric, cur, prev, ton);
  if (c === p) return [...J(pn, '과', '와'), T(` ${josa(name, '이', '가')} 같아요`)];
  const adj = metric === 'time' ? (c > p ? '길어요' : '짧아요') : (c > p ? '많아요' : '적어요');
  return [N(pn), T(`보다 ${josa(name, '이', '가')} `), val(Math.abs(c - p)), T(` ${adj}`)];
}

/** 카드 aria-label: "운동 1회, 지난주 같은 요일까지 0회보다 1회 많음" */
export function cardAria(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; ton?: boolean; waiting?: boolean; partial?: boolean; wholeDays?: number }): string {
  const { kind, current, metric, cur, prev, ton, waiting, partial, wholeDays } = o;
  if (waiting) return `${METRIC_NAME[metric]} ${valueText(metric, cur, ton)}, 오늘 운동하면 ${prevPhrase(kind, current)}와 비교해요`;
  const pp = wholeDays ? `지난달 전체(1~${wholeDays}일)` : prevPhrase(kind, current).replace('까지', partial ? ' 전날까지' : '까지'), cv = valueText(metric, cur, ton), pv = valueText(metric, prev, ton);
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

const wdOf = (date: string): number => { const [y, m, d] = date.split('-').map(Number); return new Date(y!, m! - 1, d!).getDay(); };
/**
 * 아래 작은 글씨. 현재 기간이면 through = 실제로 견주는 이전 기간 끝 날짜(오늘 운동 전이면 어제 기준), base = 오늘 운동하면 견줄 끝 날짜.
 * 운동 전이면 "오늘 운동하면 ○까지"로 바뀌는 구간을 알려 줌
 */
export function footnote(kind: PeriodKind, current: boolean, o: { through: string; base: string; done: boolean; streak: number; today: string; waiting?: boolean }): string {
  const { through, base, done, streak, today, waiting = false } = o;
  const later = !done && through !== base; // 오늘 운동하면 견줄 끝이 달라질 때만 알림
  if (!current) return `▲▼ = ${prevName(kind, false)} 전체와 비교`;
  if (waiting) return kind === 'week' ? '▲▼ = 오늘 운동하면 지난주 같은 요일(일)까지와 비교' : kind === 'month' ? '▲▼ = 오늘 운동하면 지난달 같은 날(1일)까지와 비교' : '▲▼ = 오늘 운동하면 작년 같은 날(1월 1일)까지와 비교';
  const [, m, d] = through.split('-').map(Number);
  const [, bm, bd] = base.split('-').map(Number);
  if (kind === 'week') { const w = wdOf(through); return `▲▼ = 지난주 같은 요일(일${w > 0 ? `~${WD[w]}` : ''})까지와 비교${later ? ` · 오늘 운동하면 ${WD[wdOf(base)]}요일까지` : ''} · 연속 ${streak}주 · 일요일~토요일 기준`; }
  if (kind === 'month') {
    // 이번 달이 더 길어 기준일이 지난달 말일을 넘으면 지난달 전체와 견줌
    if (wholePrevMonth(kind, current, { through, today, done })) return `▲▼ = 지난달 전체(1~${d}일)와 비교 · 이번 달이 더 길어요`;
    return `▲▼ = 지난달 같은 날(${d === 1 ? '1일' : `1~${d}일`})까지와 비교${later ? ` · 오늘 운동하면 ${bd}일까지` : ''}`;
  }
  return `▲▼ = 작년 같은 날(${m === 1 && d === 1 ? '1월 1일' : `1월 1일~${m}월 ${d}일`})까지와 비교${later ? ` · 오늘 운동하면 ${bm}월 ${bd}일까지` : ''}`;
}
