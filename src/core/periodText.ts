/** D-081·D-082 기간 요약 문구 (순수 함수). 조사(이/가·은/는·와/과)는 받침으로 고른다 */
import { WD, weekRangeText } from './dateText';
import { durText, durParts } from './stats';
import { comparePlan, firstRecordDate, hasWorkoutOn, periodData, periodOf } from './period';
import type { ComparePlan, PeriodKind, PeriodMetric, PeriodRange, PeriodTotals } from './period';
import type { BodyweightEntry } from './stats';
import type { Workout } from './session';
import type { Exercise } from './types';
import type { ChartMode } from './periodPref';

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
export const KIND_LABEL: Record<PeriodKind, string> = { week: '주', month: '월', year: '년', all: '전체' };
const PAST: Record<PeriodKind, string> = { week: '그 전 주', month: '그 전 달', year: '전년', all: '' };

/** 날짜 'YYYY-MM-DD' 문구: "3월 3일" · "3/3" · "2025년 3월" */
const md = (s: string): string => { const [, m, d] = s.split('-').map(Number); return `${m}월 ${d}일`; };
const mdS = (s: string): string => { const [, m, d] = s.split('-').map(Number); return `${m}/${d}`; };
const ym = (s: string): string => `${Number(s.slice(0, 4))}년 ${Number(s.slice(5, 7))}월`;
/** 오늘과 해가 다르면 "2025년 " */
const yPre = (s: string, today: string): string => (s.slice(0, 4) !== today.slice(0, 4) ? `${Number(s.slice(0, 4))}년 ` : '');

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
/** 한 화면이 보여 주는 모든 볼륨 값(기간 합·같은 구간 합·이전 구간·이전 기간 전체)으로 톤 여부를 한 번에 정함 — 어느 한 값이라도 100만 kg 이상이면 모두 톤 */
export const tonOfAll = (...volumes: number[]): boolean => Math.max(0, ...volumes) >= 1_000_000;
/**
 * 견줄 때 쓰는 값: 사용자에게 보이는 정밀도로 맞춘 같은 단위(시간 초, 볼륨 kg) 값 둘.
 * 시간 = 보이는 값(1분 미만은 초, 그 이상은 분 단위로 반올림) 끼리의 차이, 볼륨 kg = 정수, 톤 = 보이는 단계(10톤 미만 0.1톤, 이상 1톤, 0 초과 50kg 미만은 따로 한 단계).
 * 같으면 ▲▼ 대신 "=" 와 "같아요"
 */
export function cmpValues(m: PeriodMetric, cur: number, prev: number, ton = false): [number, number] {
  if (m === 'time') {
    const shown = (v: number) => (v < 60 ? Math.round(v) : Math.round(v / 60) * 60); // 화면에 보이는 값: 1분 미만은 초, 그 이상은 분
    return [shown(cur), shown(prev)];
  }
  if (m !== 'volume') return [cur, prev];
  if (!ton) return [Math.round(cur), Math.round(prev)];
  const step = (v: number) => (v <= 0 ? 0 : v < 50 ? 25 : v / 1000 < 9.95 ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000);
  return [step(cur), step(prev)];
}
/** 시간 차이 문구 (보이는 값끼리의 차, 초 단위): 1분 미만 "30초", 분 단위 "15분"·"1시간 5분", 초가 남으면 "1분 30초" */
export function timeDiffText(sec: number): string {
  const d = Math.abs(Math.round(sec));
  if (d < 60) return `${d}초`;
  return d % 60 ? `${durText(d - (d % 60))} ${d % 60}초` : durText(d);
}
/** 보이는 값 c, p 의 차이 문구 (한 문장·읽기 문구가 같이 씀) */
function diffValue(m: PeriodMetric, c: number, p: number, ton: boolean): string {
  return m === 'time' ? timeDiffText(c - p) : valueText(m, Math.abs(c - p), ton);
}
/** 평균 문구: 운동한 날(년은 달) 평균. 횟수·세트는 소수 한 자리까지, 볼륨은 정수(톤은 보이는 단계), 시간은 시간·분 */
export function avgParts(kind: PeriodKind, m: PeriodMetric, v: number, ton = false, exclNow = false): { label: string; value: string } {
  return { label: `${kind === 'year' || kind === 'all' ? '운동한 달' : '운동한 날'} 평균${exclNow ? '(이번 달 제외)' : ''}`, value: m === 'time' ? durText(v) : m === 'volume' ? valueText(m, Math.round(v), ton) : valueText(m, v) };
}
export const metricValue = (m: PeriodMetric, totals: { count: number; sets: number; volume: number; durationSec: number }) =>
  m === 'count' ? totals.count : m === 'sets' ? totals.sets : m === 'volume' ? totals.volume : totals.durationSec;

/** 이전 기간 이름. 현재 기간이면 지난주/지난달/작년 (+ "이맘때"는 headline 에서만), 지난 기간이면 그 전 주/달/해 */
export function prevName(kind: PeriodKind, current: boolean, short = false): string {
  if (!current || kind === 'all') return PAST[kind];
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
  const [y, m, d] = r.start.split('-').map(Number);
  const ty = Number(today.slice(0, 4));
  if (r.kind === 'all') return '처음부터 지금까지';
  if (r.kind === 'week') return offset === 0 ? '이번 주' : offset === 1 ? '지난주' : `${yPre(r.start, today)}${m}월 ${d}일부터 한 주`;
  if (r.kind === 'month') return offset === 0 ? '이번 달' : offset === 1 ? '지난달' : `${y === ty ? '' : `${y}년 `}${m}월`;
  return offset === 0 ? '올해' : offset === 1 ? '작년' : `${y}년`;
}
/** 날짜 범위 줄 */
export function rangeText(r: PeriodRange, today: string): string {
  const [y, m] = r.start.split('-').map(Number);
  if (r.kind === 'all') return `${ym(r.start)}부터`;
  if (r.kind === 'week') return weekRangeText(r.start, today);
  if (r.kind === 'month') {
    const last = new Date(y!, m!, 0).getDate();
    return `${y === Number(today.slice(0, 4)) ? '' : `${y}년 `}${m}월 1일~${last}일`;
  }
  return `${y}년 1월~12월`;
}
/** 이동줄 밑 비교 대상 (짧게: 정확한 기준은 한 문장·아래 글에) */
export const compareLine = (kind: PeriodKind, current: boolean, whole = false): string => (kind === 'all' ? '' : whole ? 'vs. 지난달 전체' : `vs. ${prevName(kind, current, true)}`);
/** 카드 큰 숫자 위 이름 줄: "이번 주 작업 세트", 전체 탭은 "처음부터 지금까지 작업 세트 합계" */
export const heroLabel = (label: string, metric: PeriodMetric, kind: PeriodKind): string => `${label} ${METRIC_NAME[metric]}${kind === 'all' ? ' 합계' : ''}`;

/** 한 줄 요약 조각: nw 는 줄바꿈 없이 붙여 보일 부분(라벨·값). 화면 읽기·복사에는 일반 띄어쓰기 그대로 */
export interface HeadlinePart { text: string; nw?: boolean }
const T = (text: string): HeadlinePart => ({ text });
const N = (text: string): HeadlinePart => ({ text, nw: true });
/** 단어 + 조사 (단어는 nw) */
const J = (word: string, withBatchim: string, without: string): HeadlinePart[] => [N(word), T(hasBatchim(word) ? withBatchim : without)];

/** 한 줄 요약 (고른 지표 기준). 운동이 있었는지는 운동 수(curCount·prevCount)로 가림: 지표 값이 0이어도 운동은 있을 수 있음(맨몸 운동의 볼륨) */
export function headline(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; curCount: number; prevCount: number; label: string; whole?: boolean; mode?: ComparePlan['mode']; first?: string | null; curSets?: number; curFull?: number; ton?: boolean }): HeadlinePart[] {
  const { kind, current, metric, cur, prev, curCount, prevCount, label, whole, mode } = o;
  const full = o.curFull ?? cur; // 일부 기록 기간: cur·prev = 같은 구간 합, curFull = 이번 기간 전체 합 ("· 이번 달 N" 처럼 전체를 보여 줄 때)
  const name = METRIC_NAME[metric];
  const tonOf = (a: number, b: number): boolean => metric === 'volume' && (o.ton ?? tonMode(a, b)); // o.ton = 카드가 화면 전체 값으로 한 번 정한 톤 (한 화면에 kg·톤이 섞이지 않게)
  const none = (): HeadlinePart[] => (current ? [...J(label, '은', '는'), T(' 아직 운동 기록이 없어요')] : [T('이 기간에는 운동 기록이 없어요')]);
  if (kind === 'all') return o.first === null ? [T('아직 운동 기록이 없어요')] : [T(`${ym(o.first ?? '')}부터 운동 ${curCount.toLocaleString('ko-KR')}회 · 작업 세트 ${(o.curSets ?? 0).toLocaleString('ko-KR')}세트`)];
  if (o.first === null) return none(); // 기록이 하나도 없는 새 설치: 0.9.17 문구 (기록 전 문구보다 먼저)
  if (mode === 'nohist') return [...J(prevName(kind, current), '은', '는'), T(' 기록을 시작하기 전이에요'), ...(curCount > 0 ? [T(' · '), N(label), T(' '), N(valueText(metric, full, tonOf(full, prev)))] : [])];
  if (curCount === 0 && prevCount === 0) return none();
  const ton = tonOf(cur, prev);
  const pn = whole ? '지난달 전체' : prevName(kind, current);
  if (prevCount === 0) return [...J(pn, '은', '는'), T(' 운동이 없었어요 · '), N(label), T(' '), N(valueText(metric, full, tonOf(full, prev)))];
  if (metric === 'volume' && cur === 0 && prev === 0) return curCount === 0 ? none() : [T('무게를 적은 세트가 없어 볼륨은 0kg이에요')];
  const [c, p] = cmpValues(metric, cur, prev, ton);
  if (c === p) return [...J(pn, '과', '와'), T(` ${josa(name, '이', '가')} 같아요`)];
  const adj = metric === 'time' ? (c > p ? '길어요' : '짧아요') : (c > p ? '많아요' : '적어요');
  return [N(pn), T(`보다 ${josa(name, '이', '가')} `), N(diffValue(metric, c, p, ton)), T(` ${adj}`)];
}

/** 오늘 운동 전에 실제로 견주는 끝을 날짜로: "지난주 월요일까지" · "지난달 16일까지" · "작년 2월 28일까지" */
function partialPhrase(kind: PeriodKind, through: string): string {
  const [, m, d] = through.split('-').map(Number);
  return kind === 'week' ? `지난주 ${WD[wdOf(through)]}요일까지` : kind === 'month' ? `지난달 ${d}일까지` : `작년 ${m}월 ${d}일까지`;
}

/**
 * 카드 aria-label: "운동 1회, 지난주 같은 요일까지 0회보다 1회 많음".
 * plan 이 있으면 전체 탭 "처음부터"·기록 전 "이전 기록 없음"을 덧붙이고, 일부 기록(plan.from)이면 cc(이번 쪽 같은 구간 값)를 견줌
 */
export function cardAria(o: { kind: PeriodKind; current: boolean; metric: PeriodMetric; cur: number; prev: number; ton?: boolean; waiting?: boolean; partialThrough?: string; wholeDays?: number; plan?: ComparePlan; cc?: number }): string {
  const { kind, current, metric, cur, prev, ton, waiting, partialThrough, wholeDays, plan } = o;
  if (plan?.mode === 'none') return `${METRIC_NAME[metric]} ${valueText(metric, cur, ton)}, 처음부터`;
  if (plan?.mode === 'nohist') return `${METRIC_NAME[metric]} ${valueText(metric, cur, ton)}, 이전 기록 없음`;
  if (waiting) return `${METRIC_NAME[metric]} ${valueText(metric, cur, ton)}, 오늘 운동하면 ${prevPhrase(kind, current)}와 비교해요`;
  const partial = plan?.mode === 'ok' && plan.from && plan.curFrom && o.cc !== undefined ? o.cc : undefined;
  const fromDay = plan?.mode === 'ok' && plan.from ? Number(plan.from.slice(8)) : 1; // 각주와 같은 범위 시작 (일부 기록이면 첫 기록일)
  const pp = wholeDays ? `지난달 전체(${fromDay === wholeDays ? `${wholeDays}일` : `${fromDay}~${wholeDays}일`})` : partialThrough ? partialPhrase(kind, partialThrough) : prevPhrase(kind, current), cv = valueText(metric, cur, ton), pv = valueText(metric, prev, ton);
  const head = `${METRIC_NAME[metric]} ${cv}, ${partial === undefined ? '' : `${md(plan!.curFrom!)}부터 ${valueText(metric, partial, ton)}, `}${pp} `;
  const [c, p] = cmpValues(metric, partial ?? cur, prev, ton);
  if (c === p) return `${head}${josa(pv, '과', '와')} 같음`;
  return `${head}${pv}보다 ${diffValue(metric, c, p, !!ton)} ${metric === 'time' ? (c > p ? '김' : '짧음') : (c > p ? '많음' : '적음')}`;
}

/** 칸 날짜 문구: week·month "11월 16일 (월)", year·all "2026년 3월" */
export function bucketText(kind: PeriodKind, start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  if (kind === 'year' || kind === 'all') return `${y}년 ${m}월`;
  return `${m}월 ${d}일 (${WD[new Date(y!, m! - 1, d!).getDay()]})`;
}

/** 기간 내역 제목에 쓰는 칸 이름 (요일 없이): week·month "11월 16일", year·all "2026년 3월" */
export const bucketTitle = (kind: PeriodKind, start: string): string => (kind === 'year' || kind === 'all' ? ym(start) : md(start));

/** 연속 주 문구 (0주면 없음) */
const streakText = (n: number): string => (n > 0 ? ` · 연속 ${n}주` : '');
/** 날수 차이 문구: 1일이면 "하루" */
const dayGap = (n: number): string => (n === 1 ? '하루' : `${n}일`);
const wdOf = (date: string): number => { const [y, m, d] = date.split('-').map(Number); return new Date(y!, m! - 1, d!).getDay(); };
/**
 * 아래 작은 글씨 조각 (날짜는 nw 라 줄 중간에서 안 갈림). 현재 기간이면 through = 실제로 견주는 이전 기간 끝 날짜(오늘 운동 전이면 어제 기준), base = 오늘 운동하면 견줄 끝 날짜.
 * 운동 전이면 "오늘 운동하면 ○까지"로 바뀌는 구간을 알려 줌. lens = 지난 달을 볼 때 [이 달 날수, 그 전 달 날수].
 * plan·first(D-082): 전체 탭 안내, 이전 기간이 기록 전이면 비교 안 함 안내(first = 첫 기록일), 일부 기록이면 범위 시작을 첫 기록일로 하고 같은 구간끼리 안내
 */
export function footnoteParts(kind: PeriodKind, current: boolean, o: { through: string; base: string; done: boolean; streak: number; today: string; waiting?: boolean; lens?: [number, number]; plan?: ComparePlan; first?: string }): HeadlinePart[] {
  const { through, base, done, streak, today, waiting = false, lens, plan, first } = o;
  if (kind === 'all') return [T('전체 = 처음 기록한 달부터. 비교할 이전 기간이 없어 ▲▼ 는 없어요.')];
  const pw = prevName(kind, current, true);
  if (plan?.mode === 'nohist' && first) return [T(`${josa(current && plan.fullPrev ? prevName(kind, true) : pw, '은', '는')} 기록을 시작하기 전이라 ▲▼ 비교를 하지 않아요`), ...(first ? [N(` (첫 기록 ${yPre(first, today)}${md(first)})`)] : [])];
  const from = plan?.mode === 'ok' ? plan.from : undefined;
  const same = from ? [T(`(${josa(pw, '은', '는')} ${md(from)}부터 기록이라 같은 구간끼리)`)] : []; // 현재 기간: "까지와 비교" 바로 뒤
  const sameTail = from ? [T(` · ${josa(pw, '은', '는')} ${md(from)}부터 기록이라 같은 구간끼리`)] : []; // 지난 기간: 끝에
  const later = !done && through !== base; // 오늘 운동하면 견줄 끝이 달라질 때만 알림
  if (!current) {
    if (kind === 'month' && lens && lens[0] !== lens[1]) return [T('▲▼ = 그 전 달 전체'), N(`(${lens[1]}일)`), T('와 비교 · 이 달이 '), N(dayGap(Math.abs(lens[0] - lens[1]))), T(lens[0] > lens[1] ? ' 더 길어요' : ' 더 짧아요'), ...sameTail];
    if (kind === 'year' && lens && lens[0] !== lens[1]) return [T(`▲▼ = 전년 전체와 비교 · 이 해가 하루 ${lens[0] > lens[1] ? '더 길어요' : '더 짧아요'}`), ...sameTail];
    return [T(`▲▼ = ${prevName(kind, false)} 전체와 비교`), ...sameTail];
  }
  if (waiting) return kind === 'week' ? [T('▲▼ = 오늘 운동하면 지난주 같은 요일'), N('(일)'), T(`까지와 비교${streakText(streak)} · 일요일~토요일 기준`)] : kind === 'month' ? [T('▲▼ = 오늘 운동하면 지난달 같은 날'), N('(1일)'), T('까지와 비교')] : [T('▲▼ = 오늘 운동하면 작년 같은 날'), N('(1월 1일)'), T('까지와 비교')];
  const [, m, d] = through.split('-').map(Number);
  const [, bm, bd] = base.split('-').map(Number);
  const span = (a: string, b: string, text: string): string => (a === b ? `(${md(a)})` : `(${text})`); // 일부 기록: 첫 기록일~끝
  if (kind === 'week') { const w = wdOf(through); const rng = from ? (wdOf(from) === w ? `(${WD[w]})` : `(${WD[wdOf(from)]}~${WD[w]})`) : `(일${w > 0 ? `~${WD[w]}` : ''})`; return [T('▲▼ = 지난주 같은 요일'), N(rng), T('까지와 비교'), ...same, ...(later ? [T(' · 오늘 운동하면 '), N(`${WD[wdOf(base)]}요일까지`)] : []), T(`${streakText(streak)} · 일요일~토요일 기준`)]; }
  if (kind === 'month') {
    // 이번 달이 더 길어 기준일이 지난달 말일을 넘으면 지난달 전체와 견줌
    const fd = from ? Number(from.slice(8)) : 1;
    const days = (a: number, b: number): string => (a === b ? `(${a}일)` : `(${a}~${b}일)`); // 하루뿐이면 "(30일)"
    if (wholePrevMonth(kind, current, { through, today, done })) return [T('▲▼ = 지난달 전체'), N(days(fd, d!)), T('와 비교 · 이번 달 구간'), N(days(fd, Number(today.slice(8)) - (done ? 0 : 1))), T('이 '), N(dayGap(Number(today.slice(8)) - (done ? 0 : 1) - d!)), T(' 더 길어요'), ...same];
    return [T('▲▼ = 지난달 같은 날'), N(from ? span(from, through, `${md(from)}~${md(through)}`) : d === 1 ? '(1일)' : `(1~${d}일)`), T('까지와 비교'), ...same, ...(later ? [T(' · 오늘 운동하면 '), N(`${bd}일까지`)] : [])];
  }
  // 윤년이 끼면 두 구간 날수가 하루 다름 (오늘 운동 전이면 이번 해 구간도 어제까지)
  const dayNo = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000;
  const curLen = dayNo(today) - (done ? 0 : 1) - dayNo(plan?.curFrom && from ? plan.curFrom : `${today.slice(0, 4)}-01-01`) + 1, prevLen = dayNo(through) - dayNo(from ?? `${through.slice(0, 4)}-01-01`) + 1;
  return [T('▲▼ = 작년 같은 날'), N(from ? span(from, through, `${md(from)}~${m}월 ${d}일`) : m === 1 && d === 1 ? '(1월 1일)' : `(1월 1일~${m}월 ${d}일)`), T('까지와 비교'), ...same, ...(later ? [T(' · 오늘 운동하면 '), N(`${bm}월 ${bd}일까지`)] : []), ...(curLen !== prevLen ? [T(` · 올해 구간이 하루 ${curLen > prevLen ? '더 길어요' : '더 짧아요'}`)] : [])];
}

/** 카드 작은 줄 (줄 단위): 전체 "처음부터", 기록 전 "이전 기록 없음", 첫날 운동 전 안내, 일부 기록 ["3/3~ 값", "이전 값"], 보통 ["이전 값"]. 읽기 문구는 " · "로 이음 */
export function cardSmall(plan: ComparePlan, m: PeriodMetric, cc: number, p: number, ton = false): string[] {
  if (plan.mode === 'none') return ['처음부터'];
  if (plan.mode === 'nohist') return ['이전 기록 없음'];
  if (plan.mode === 'waiting') return [WAITING_LINE];
  return plan.from && plan.curFrom ? [`${mdS(plan.curFrom)}~ ${valueText(m, cc, ton)}`, `이전 ${valueText(m, p, ton)}`] : [`이전 ${valueText(m, p, ton)}`];
}

/**
 * 한 문장 아래 둘째 줄들: 일부 기록 안내, 남은 양(이번 기간이고 막대 보기가 아니며 이전 기간 전체 합 > 0).
 * c = 이번 기간 오늘까지 합, pf = 이전 기간 전체 합. 남은 양은 화면에 보이는 값(cmpValues)끼리 뺌: 0 이하면 "넘었어요"
 */
export function headSubs(o: { plan: ComparePlan; kind: PeriodKind; current: boolean; mode: ChartMode; metric: PeriodMetric; c: number; pf: number; ton?: boolean }): string[] {
  const { plan, kind, current, mode, metric, c, pf, ton = false } = o;
  const out: string[] = [];
  if (plan.mode === 'none') return out;
  const pw = prevName(kind, current, true);
  if (plan.mode === 'ok' && plan.from && plan.curFrom) out.push(`${pw} 기록이 ${md(plan.from)}부터라 ${md(plan.curFrom)} 이후끼리 견줬어요`);
  if (current && mode !== 'bar' && plan.fullPrev && pf > 0) {
    const [sc, sp] = cmpValues(metric, c, pf, ton);
    out.push((sp - sc > 0 ? `${pw} 전체까지 ${diffValue(metric, sp, sc, ton)} 남았어요` : `${pw} 전체(${valueText(metric, pf, ton)})를 넘었어요`) + (plan.from ? ` (${josa(pw, '은', '는')} ${mdS(plan.from)}부터 기록)` : ''));
  }
  return out;
}

/** 막대를 고르기 전 그래프 안내 (보기별). 막대 보기 문구는 앱 그대로, 막대+누적은 목업 앞부분 + 앱 안내, 누적은 목업 문구. pw 가 있으면 지난 기간 선이 있음 */
export function chartCaption(o: { mode: ChartMode; kind: PeriodKind; label: string; pw?: string }): string {
  const unit = o.kind === 'year' || o.kind === 'all' ? '달별' : '날짜별';
  const first = o.kind === 'all' ? '처음부터' : '기간 첫날부터';
  if (o.mode === 'cum') return `선 = ${first} 쌓인 합계 · ${unit} 값은 [막대]나 [막대+누적]에서 볼 수 있어요`;
  const tap = `막대를 누르거나 옆으로 밀면 ${unit} 값이 보여요`;
  return o.mode === 'both' ? `막대 = ${unit} 값, 선 = ${first} 쌓인 합계${o.pw ? ` (파랑 ${o.label} · 회색 ${o.pw})` : ''} · ${tap}` : tap;
}

/**
 * 막대+누적 보기에서 칸을 골랐을 때 문구: "11월 16일 (월) · 작업 세트 22세트 · 누적 22세트 · 지난주 같은 요일 15세트".
 * active = 그 칸에 운동이 있었나, prev = 이전 기간 같은 칸(요일·날·달) 값 (이전 기간 선이 없거나 칸이 없으면 생략, 0 이면 "운동 안 함").
 * prevEnd = 그 이전 칸의 끝 날짜(미포함), from = 이전 기간 첫 기록일: 칸이 통째로 첫 기록일 전(prevEnd ≤ from)이면 0 은 "기록 전"
 */
export function comboLine(o: { kind: PeriodKind; start: string; metric: PeriodMetric; value: number; active: boolean; cum: number; prev?: number | null; pw?: string; ton?: boolean; prevEnd?: string; from?: string }): string {
  const { kind, start, metric, value, active, cum, prev, pw, ton = false, prevEnd, from } = o;
  const prevZero = prevEnd && from && prevEnd <= from ? '기록 전' : '운동 안 함';
  const same = kind === 'week' ? '요일' : kind === 'month' ? '날' : '달';
  return [
    bucketText(kind, start),
    active ? `${METRIC_NAME[metric]} ${valueText(metric, value, ton)}` : '운동 안 함',
    `누적 ${valueText(metric, cum, ton)}`,
    ...(prev !== undefined && prev !== null && pw ? [`${pw} 같은 ${same} ${prev > 0 ? valueText(metric, prev, ton) : prevZero}`] : []),
  ].join(' · ');
}

/** 범례 이름: 이번 쪽 "이번 주 (오늘까지)"(전체 탭은 "처음부터"·누적은 "처음부터 누적"), 이전 쪽 "지난주 (3/3부터 기록)"(누적 보기는 "… 전체"), 막대 보기·이전 선 없음이면 null */
export function legendNames(o: { mode: ChartMode; kind: PeriodKind; current: boolean; label: string; plan: ComparePlan }): { cur: string; prev: string | null } {
  const { mode, kind, current, label, plan } = o;
  const cur = kind === 'all' ? (mode === 'cum' ? '처음부터 누적' : '처음부터') : `${label}${current ? ' (오늘까지)' : ''}`;
  if (mode === 'bar' || kind === 'all' || !plan.prev || !plan.fullPrev) return { cur, prev: null };
  const pName = `${prevName(kind, current, true)}${plan.from ? ` (${mdS(plan.from)}부터 기록)` : ''}`;
  return { cur, prev: mode === 'cum' ? `${pName} 전체` : pName };
}

/**
 * 홈 "이번 주" 카드의 ▲▼ 재료: 기록 탭 주 카드와 같은 비교 구간(comparePlan)의 이번 주·지난주 합.
 * 첫 기록 전(nohist)·기록 없음·첫날 운동 전(waiting)이면 null (▲▼ 를 보여 주지 않음). 일부 기록이면 이번 쪽은 curFrom 부터, 지난주는 from~through 만
 */
export function homeWeekDelta(done: Workout[], byId: Map<string, Exercise>, bw: BodyweightEntry[], today: string): { cur: PeriodTotals; prev: PeriodTotals } | null {
  const week = periodOf('week', today);
  const plan = comparePlan(week, true, today, hasWorkoutOn(done, today), firstRecordDate(done, today));
  if (plan.mode !== 'ok' || !plan.prev) return null;
  return { cur: periodData(done, byId, week, bw, today, plan.curFrom).totals, prev: periodData(done, byId, plan.prev, bw, plan.through, plan.from).totals };
}
