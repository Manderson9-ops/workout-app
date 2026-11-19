/**
 * D-082 훈련 부하 카드 문구 (승인 목업 record-mock.html zoneOf·drawLoad·고정 안내 그대로). 계산은 core/stats.ts
 */
import { addDays } from './stats';
import type { LoadZone } from './stats';

export const LOAD_ZONE_NAME: Record<LoadZone, string> = { low: '평소보다 적음', ok: '평소 수준', warn: '평소보다 많음', bad: '평소보다 크게 많음' };

/** 구간별 한 문장 (판정·처방 없음) */
export const LOAD_ZONE_SAY: Record<LoadZone, string> = {
  low: '최근 7일이 평소(4주 평균)보다 가벼워요. 쉬거나 일부러 줄인 주라면 자연스러워요.',
  ok: '최근 7일이 평소(4주 평균)와 비슷한 양이에요.',
  warn: '최근 7일이 평소보다 많아요. 쉬었다가 돌아온 주라면 흔히 이렇게 나와요.',
  bad: '최근 7일이 평소보다 크게 많아요. 쉬었다 돌아온 주라면 자연스러운 숫자예요. 통증이나 피로가 쌓이면 다음 운동 양을 줄여 보세요.',
};

export const LOAD_NOTE = "구간 값(0.8·1.3·1.5)은 팀 스포츠 연구에서 온 참고값이에요. 세트 수로 센 근력 운동에서는 근거가 약해서, 판단보다 '평소와 얼마나 다른가'를 보는 참고로 쓰세요. 첫 기록 21일째부터 보이고, 4주가 안 되면 첫 기록일부터 지난 날 수(쉰 날 포함)로 평균을 내요.";

const fmtInt = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** 4주 창에 작업 세트가 하나도 없을 때(비율 0)의 한 문장 */
export const LOAD_EMPTY_SAY = '최근 4주 동안 운동 기록이 없어요. 다시 운동하면 평소와 견줘 보여 드려요.';
/** 지난주와 이번 주 4주 창이 모두 비었을 때의 지난주 줄 */
export const LOAD_EMPTY_WEEK = '지난주와 이번 주 모두 최근 4주 기록이 없어요.';

/** day 에서 거꾸로 nd 일(day 포함) 작업 세트 합 (loadRatio 의 분모 c) */
export function loadWindowSets(daily: Map<string, number>, day: string, nd: number): number {
  let c = 0;
  for (let i = 0; i < nd; i++) c += daily.get(addDays(day, -i)) ?? 0;
  return c;
}

/** 비율이 0 일 때 4주 창(오늘·지난주 같은 요일)이 정말 비었나. hasPrev = 지난주 같은 요일 비율이 있음 (그 창은 첫 기록일 기준 min(28, histDays − 7)일) */
export function loadEmptyWindows(daily: Map<string, number>, today: string, nd: number, histDays: number, hasPrev: boolean): { empty: boolean; prevEmpty: boolean } {
  return { empty: loadWindowSets(daily, today, nd) === 0, prevEmpty: hasPrev && loadWindowSets(daily, addDays(today, -7), Math.min(28, histDays - 7)) === 0 };
}

/** 구간 한 문장 + 괄호. nd < 28 일 때만 "기록이 nd일이라 nd일 평균과 비교". windowEmpty = 4주 창 합이 0 이면 한 문장을 안내로 바꿈 (숫자·구간은 그대로) */
export function loadSayText(zone: LoadZone, last7: number, nd: number, windowEmpty = false): string {
  return `${windowEmpty ? LOAD_EMPTY_SAY : LOAD_ZONE_SAY[zone]} (오늘까지 7일 ${fmtInt(last7)}세트${nd < 28 ? ` · 기록이 ${nd}일이라 ${nd}일 평균과 비교` : ''})`;
}

/** 지난주 같은 요일 비교 한 줄. wd = 오늘 요일 한 글자, vd·prevVd = 화면 값. 차이는 hundredths 정수로 구함. bothEmpty = 두 4주 창이 모두 비어 두 비율이 0 인 경우 */
export function loadWeekText(wd: string, vd: number, prevVd: number | null, bothEmpty = false): string {
  if (bothEmpty) return LOAD_EMPTY_WEEK;
  if (prevVd === null) return `지난주 ${wd}요일은 기록이 3주가 안 돼 견줄 비율이 없어요.`;
  const cur = Math.round(vd * 100), prev = Math.round(prevVd * 100);
  const head = `지난주 ${wd}요일 ${prevVd.toFixed(2)} → 오늘 ${vd.toFixed(2)}`;
  if (cur === prev) return `${head} · 지난주와 같아요`;
  return `${head} · 지난주보다 ${(Math.abs(cur - prev) / 100).toFixed(2)} ${cur > prev ? '높아요' : '낮아요'}`;
}

/** 21일 전 안내. 기록이 없으면(histDays 0) 일수를 말하지 않음 */
export function loadWaitText(histDays: number): string {
  return `기록이 3주 쌓이면 부하 비율을 보여 드려요.${histDays > 0 ? ` 지금 ${histDays}일째예요.` : ''}`;
}

/** 7일 점 그래프 낭독. dates = 'YYYY-MM-DD' 7개, 값은 화면 값(없는 날 null) */
export function loadChartLabel(dates: string[], today: (number | null)[], prev: (number | null)[]): string {
  const v = (x: number | null) => (x === null ? '비율 없음' : x.toFixed(2));
  const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`;
  return `최근 7일 부하 비율과 지난주 같은 요일 비율. ${dates.map((d, i) => `${md(d)} ${v(today[i] ?? null)}(지난주 ${v(prev[i] ?? null)})`).join(', ')}`;
}
