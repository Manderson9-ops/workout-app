/**
 * 날짜·시각 표시 규칙 한 곳 (D-060). 규칙과 근거: G:\내 드라이브\WORK_OUT_APP\docs\design\날짜_표시_규칙.md
 *
 * - 기기 현지 시각(한국: Asia/Seoul)으로 계산. 날짜 차이는 달력 날짜(연·월·일)로 세서 서머타임·시간대와 상관없음
 * - 주는 일요일 시작 (D-054)
 * - 요일 괄호는 날짜에 붙여 씀: "10월 8일(수)" (한글 맞춤법 부록 소괄호 용례 "2014. 12. 19.(금)")
 * - 시각은 12시간 + 오전/오후: "오전 11:24" (iOS·Intl ko-KR 기본과 같음)
 * - 화면 읽기(aria)는 줄이지 않은 형태: "2026년 10월 8일 수요일 오전 11시 24분"
 * 모든 함수는 순수 함수(now 를 받음) → 고정 시각으로 시험
 */
export type When = string | number | Date;

export const WD = ['일', '월', '화', '수', '목', '금', '토'] as const;
const WD_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

/** ISO·밀리초·Date → Date. 'YYYY-MM-DD'(날짜만)는 그 날 현지 0시로 (UTC 로 읽으면 하루 밀림) */
export function toDate(t: When): Date {
  if (t instanceof Date) return t;
  if (typeof t === 'number') return new Date(t);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(t);
}
const dayNo = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
/** now 기준 며칠 전인지 (달력 날짜 차이, 미래면 음수) */
export function daysAgo(t: When, now: When): number { return dayNo(toDate(now)) - dayNo(toDate(t)); }

/** "오전 11:24" (seconds: "오전 11:24:05"). 0시 → "오전 12:00", 12시 → "오후 12:00" */
export function timeText(t: When, opts: { seconds?: boolean } = {}): string {
  const d = toDate(t); const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = opts.seconds ? ':' + String(d.getSeconds()).padStart(2, '0') : '';
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${mm}${ss}`;
}

/** "10월 8일(수)", 다른 해면 "2025년 10월 8일(수)". weekday:false 면 요일 없이 */
export function dateText(t: When, now: When, opts: { weekday?: boolean } = {}): string {
  const d = toDate(t);
  const y = d.getFullYear() === toDate(now).getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일${opts.weekday === false ? '' : `(${WD[d.getDay()]})`}`;
}

/** 이번 주(일요일 시작) 안인지 */
function sameWeek(t: Date, now: Date): boolean {
  const ws = (d: Date) => dayNo(d) - d.getDay();
  return ws(t) === ws(now);
}

/**
 * 날짜 이름: "오늘", "어제", 이번 주(일~토) 안이면 "월요일", 그 밖은 dateText ("10월 8일(수)" / "2025년 10월 8일(수)").
 * 미래: "내일", 그 밖은 dateText
 */
export function dayText(t: When, now: When, opts: { weekday?: boolean } = {}): string {
  const d = toDate(t), n = toDate(now);
  const k = daysAgo(d, n);
  if (k === 0) return '오늘';
  if (k === 1) return '어제';
  if (k === -1) return '내일';
  if (k > 1 && sameWeek(d, n)) return WD_LONG[d.getDay()]!;
  return dateText(d, n, opts);
}

/** "오늘 오전 11:24", "어제 오후 7:05", "월요일 오전 9:00", "10월 8일(수) 오전 11:24". relative:false 면 날짜는 늘 dateText */
export function dateTimeText(t: When, now: When, opts: { relative?: boolean; seconds?: boolean } = {}): string {
  const day = opts.relative === false ? dateText(t, now) : dayText(t, now);
  return `${day} ${timeText(t, { seconds: opts.seconds })}`;
}

/**
 * "마지막으로 한 날" 같은 지난 정도: "오늘", "어제", "N일 전"(2~13일), "N주 전"(14~29일), "N개월 전"(30~364일),
 * 1년 이상이면 날짜 "2025년 6월 3일" (Intl.RelativeTimeFormat ko 의 "N일 전·N주 전·N개월 전" 꼴)
 */
export function sinceText(t: When, now: When): string {
  const n = daysAgo(t, now);
  if (n <= 0) return '오늘';
  if (n === 1) return '어제';
  if (n < 14) return `${n}일 전`;
  if (n < 30) return `${Math.floor(n / 7)}주 전`;
  if (n < 365) return `${Math.floor(n / 30)}개월 전`;
  return dateText(t, now, { weekday: false });
}

/** 방금 일어난 일(동기화·신호): 1분 안 "방금", 1시간 안 "N분 전", 그 뒤는 dateTimeText ("오늘 오전 9:10") */
export function agoText(t: When, now: When): string {
  const s = Math.round((toDate(now).getTime() - toDate(t).getTime()) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return dateTimeText(t, now);
}

/** 주 범위 (시작=일요일 'YYYY-MM-DD'): "10월 4일~10일", "9월 28일~10월 4일", 다른 해는 "2025년 12월 28일~2026년 1월 3일" */
export function weekRangeText(ws: When, now: When): string {
  const a = toDate(ws);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  const ny = toDate(now).getFullYear();
  if (a.getFullYear() !== b.getFullYear()) return `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일~${b.getFullYear()}년 ${b.getMonth() + 1}월 ${b.getDate()}일`;
  const y = a.getFullYear() === ny ? '' : `${a.getFullYear()}년 `;
  const end = a.getMonth() === b.getMonth() ? `${b.getDate()}일` : `${b.getMonth() + 1}월 ${b.getDate()}일`;
  return `${y}${a.getMonth() + 1}월 ${a.getDate()}일~${end}`;
}

/** 화면 맨 위 오늘 날짜: "10월 8일 수요일" */
export function headerDateText(t: When): string {
  const d = toDate(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD_LONG[d.getDay()]}`;
}

/** 화면 읽기용 날짜: "2026년 10월 8일 수요일" */
export function fullDateText(t: When): string {
  const d = toDate(t);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD_LONG[d.getDay()]}`;
}
/** 화면 읽기용 날짜·시각: "2026년 10월 8일 수요일 오전 11시 24분" (0분이면 "오전 11시") */
export function fullText(t: When): string {
  const d = toDate(t); const h = d.getHours(); const m = d.getMinutes();
  return `${fullDateText(d)} ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}

/** 그래프 축 전용 짧은 날짜: "10/4" (축 밖에서는 쓰지 않음) */
export function axisText(t: When): string {
  const d = toDate(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
