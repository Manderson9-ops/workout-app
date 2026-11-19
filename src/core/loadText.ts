/**
 * D-082 훈련 부하 카드 문구 (승인 목업 record-mock.html zoneOf·drawLoad·고정 안내 그대로). 계산은 core/stats.ts
 */
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

/** 구간 한 문장 + 괄호. nd < 28 일 때만 "기록이 nd일이라 nd일 평균과 비교" */
export function loadSayText(zone: LoadZone, last7: number, nd: number): string {
  return `${LOAD_ZONE_SAY[zone]} (오늘까지 7일 ${fmtInt(last7)}세트${nd < 28 ? ` · 기록이 ${nd}일이라 ${nd}일 평균과 비교` : ''})`;
}

/** 지난주 같은 요일 비교 한 줄. wd = 오늘 요일 한 글자, vd·prevVd = 화면 값. 차이는 hundredths 정수로 구함 */
export function loadWeekText(wd: string, vd: number, prevVd: number | null): string {
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
