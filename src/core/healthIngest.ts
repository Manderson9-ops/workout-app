/**
 * 애플워치(건강 앱) 데이터 받기 (D-058). 순수 함수 한 벌을
 *  - 구글 Apps Script 서버(tools/gas/build.ts 가 HealthIngest 로 붙여 넣음)와
 *  - 앱 테스트
 * 가 함께 쓴다. 외부 모듈을 가져오지 않는다 (Apps Script에서 그대로 돌아야 함). 숫자 구분자를 쓰지 않음.
 *
 * 아이폰 단축어가 보내는 것: { op:"health", key, kind:"workout"|"daily", hr, energy, sleep, rhr, hrv } (또는 samples:{...} 안에)
 * 값마다 여러 줄 글. 한 줄 = "시작 날짜 | 값 [| 끝 날짜] [| 수면 단계]" (구분은 탭 또는 |)
 * 날짜: ISO 8601(권장), 단축어 한국어 기본 형식("2026. 10. 8. 오전 11:24", "2026년 10월 8일 오전 11:24:05"), 2026-10-08 11:24:05.
 * 시간대가 없으면 한국 시간(+09:00)으로 본다.
 * D-061 (iOS 27 "설명으로 만들기"로 AI 가 만든 단축어): 칸 이름이 한국어·대문자(심박, HeartRate …)거나, 값이 목록(글 또는
 * {date, value, endDate, unit} 사전)이거나, 한 줄 안에서 날짜가 뒤에 있거나("128 BPM, 2026-10-09T22:53:05+09:00"),
 * 두 자리 연도("26. 10. 9. 오후 10:20")·연도 없는("10월 9일 오후 10:20") 날짜도 읽는다. 시각만 있는 줄과 읽지 못한 날짜 조각이
 * 남은 줄은 저장하지 않는다(틀린 날·틀린 값 방지, 검토 P1~P3). 건너뛴 줄이 있으면 응답에 hint(이유)를 붙인다.
 *
 * 저장(동기화 기록 표 'health', 서버만 씀, 기기는 읽기만):
 *  hr-YYYY-MM-DD   {type:'hr', day, t0(그날 0시 ms), p:[초,심박, 초,심박 ...]}  초 = 그날 0시부터, 5초 단위로 같은 칸이면 나중 값
 *  en-YYYY-MM-DD   {type:'energy', day, t0, p:[시작초,길이초,kcal×10, ...]}  (같은 시작초면 나중 값)
 *  sl-YYYY-MM-DD   {type:'sleep', day, seg:[시작(유닉스초),끝(유닉스초),단계, ...]}  day = 그 밤이 끝난 날 (전날 12시~그날 12시)
 *  dy-YYYY-MM-DD   {type:'daily', day, rhr?, hrvP:[초,ms×10...], hrv?, hrvN?, sleepMin?}  요약은 계속 보관
 *  canary          {type:'canary', at, received, skipped}  연결 시험(tools/watch_canary.mjs): 저장 경로만 확인, 앱은 무시
 *  ws-<운동ID>     {type:'ws', workoutId, startedAt, endedAt, hrAvg?, hrMax?, hrN, kcal?, src:'watch', computedAt}  운동별 요약 (D-059, 지우지 않음)
 *  wsmeta          {type:'wsmeta', v, done, after}  배포 뒤 처음 받을 때 옛 운동 요약을 나눠 채우는 위치, v = 계산 판 (앱은 무시)
 *  활동 에너지 합은 소스 겹침을 정리해 계산 (kcalNoOverlap: 시간 조각마다 가장 큰 kcal/초 하나). 심박은 5초 칸에 나중 값 하나(소스가 섞일 수 있음, 영향 작음)
 * 원본(hr·energy·sleep)은 최근 RAW_KEEP_DAYS일만 (오래된 것은 지움 표시), 요약(daily·ws)은 계속.
 */

export const HEALTH_TABLE = 'health';
export const RAW_KEEP_DAYS = 120;
export const HR_BUCKET_SEC = 5;
export const MAX_LINES = 30000;
export const MAX_DAY_POINTS = 17280; // 하루 86400초 / 5초
export const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export type SleepStage = 0 | 1 | 2 | 3 | 4 | 5; // 0 잠(구분 없음) 1 코어 2 깊은 3 렘 4 깨어 있음 5 침대에 있음
export const ASLEEP_STAGES: readonly number[] = [0, 1, 2, 3];
export interface Sample { t: number; v: number; end?: number; stage?: SleepStage }
export type HealthField = 'hr' | 'energy' | 'sleep' | 'rhr' | 'hrv';
export const HEALTH_FIELDS: readonly HealthField[] = ['hr', 'energy', 'sleep', 'rhr', 'hrv'];

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
/** 한국 시간 날짜 'YYYY-MM-DD' */
export function kstDay(ms: number): string {
  const d = new Date(ms + KST_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
/** 그 한국 날짜 0시의 ms */
export function kstDayStart(day: string): number {
  const p = day.split('-').map(Number);
  return Date.UTC(p[0]!, p[1]! - 1, p[2]!) - KST_MS;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function to24(h: number, ap: string | undefined): number {
  if (!ap) return h;
  const pm = /오후|pm/i.test(ap);
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}
function kstMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  return Date.UTC(y, mo - 1, d, h, mi, s) - KST_MS;
}

/** 날짜 글 → ms (못 읽으면 undefined) */
export function parseDate(text: string, nowMs: number = Date.now()): number | undefined {
  const s = String(text || '').replace(/\u202f|\u00a0/g, ' ').trim();
  if (!s) return undefined;
  // ISO 8601: 2026-10-08T11:24:05+09:00 / Z / 시간대 없음(한국 시간)
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const y = +iso[1]!, mo = +iso[2]!, d = +iso[3]!, h = +iso[4]!, mi = +iso[5]!, sec = +(iso[6] || 0);
    if (!iso[7]) return kstMs(y, mo, d, h, mi, sec);
    const base = Date.UTC(y, mo - 1, d, h, mi, sec);
    if (iso[7] === 'Z') return base;
    const m = /([+-])(\d{2}):?(\d{2})/.exec(iso[7])!;
    const off = (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!) * 60000;
    return base - off;
  }
  const TAIL = '\\s*(?:,?\\s*\\(?[월화수목금토일](?:요일)?\\)?,?\\s*)?(오전|오후|AM|PM)?\\s*(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(오전|오후|AM|PM)?$';
  // 한국어·숫자 형식: 2026. 10. 8. 오전 11:24 / 2026년 10월 8일 오후 11:24:05 / 2026/10/08 23:10 / 2026-10-08 23:10
  const ko = new RegExp('^(\\d{4})\\s*(?:\\.|년|\\/|-)\\s*(\\d{1,2})\\s*(?:\\.|월|\\/|-)\\s*(\\d{1,2})\\s*(?:\\.|일)?' + TAIL, 'i').exec(s);
  if (ko) return kstMs(+ko[1]!, +ko[2]!, +ko[3]!, to24(+ko[5]!, ko[4] || ko[8]), +ko[6]!, +(ko[7] || 0));
  // 두 자리 연도 (아이폰 한국어 "짧은" 날짜): 26. 10. 9. 오후 10:20 → 2026 (마침표·년 구분만, 빗금은 순서가 모호해 안 읽음)
  const ko2 = new RegExp('^(\\d{2})\\s*(?:\\.|년)\\s*(\\d{1,2})\\s*(?:\\.|월)\\s*(\\d{1,2})\\s*(?:\\.|일)' + TAIL, 'i').exec(s);
  if (ko2) return kstMs(2000 + +ko2[1]!, +ko2[2]!, +ko2[3]!, to24(+ko2[5]!, ko2[4] || ko2[8]), +ko2[6]!, +(ko2[7] || 0));
  // 연도 없음: 10월 9일 오후 10:20 → 올해 (하루 넘게 미래가 되면 작년)
  const md = new RegExp('^(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일' + TAIL, 'i').exec(s);
  if (md) {
    const y = +kstDay(nowMs).slice(0, 4);
    const at = (yy: number) => kstMs(yy, +md[1]!, +md[2]!, to24(+md[4]!, md[3] || md[7]), +md[5]!, +(md[6] || 0));
    const v = at(y);
    return v !== undefined && v > nowMs + DAY_MS ? at(y - 1) : v;
  }
  // 영어: Oct 8, 2026 at 11:24 AM / October 8, 2026, 11:24:05 PM
  const en = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (en && MONTHS[en[1]!.toLowerCase()]) return kstMs(+en[3]!, MONTHS[en[1]!.toLowerCase()]!, +en[2]!, to24(+en[4]!, en[7]), +en[5]!, +(en[6] || 0));
  // 영어 일·월·연: 9 Oct 2026 22:20 / Fri, 9 October 2026 at 10:20 PM
  const en2 = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4}),?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (en2 && MONTHS[en2[2]!.toLowerCase()]) return kstMs(+en2[3]!, MONTHS[en2[2]!.toLowerCase()]!, +en2[1]!, to24(+en2[4]!, en2[7]), +en2[5]!, +(en2[6] || 0));
  return undefined;
}

/** 값 글 → 숫자 ("128 count/min", "128 회/분", "45.2 ms", "1,234.5 kcal"). 못 읽으면 undefined */
export function parseNumber(text: string): number | undefined {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(text || ''));
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** 단축어가 수면 '값'을 숫자로 줄 때 (HKCategoryValueSleepAnalysis): 0 침대, 1 잠(구분 없음), 2 깨어 있음, 3 코어, 4 깊은, 5 렘 → 이 앱 번호 */
export const HK_SLEEP: Record<number, SleepStage> = { 0: 5, 1: 0, 2: 4, 3: 1, 4: 2, 5: 3 };
/** 킬로줄 표시 (kJ, 킬로줄) → kcal 로 바꿈 */
export const KJ_PER_KCAL = 4.184;
const isKJ = (s: string) => /kj\b|킬로줄/i.test(s);

/** 수면 단계 글 → 번호 (못 읽으면 undefined) */
export function parseStage(text: string): SleepStage | undefined {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return undefined;
  if (/깨어|awake/.test(s)) return 4;
  if (/침대|in ?bed/.test(s)) return 5;
  if (/깊은|deep/.test(s)) return 2;
  if (/렘|rem\b|^rem/.test(s)) return 3;
  if (/코어|core|가벼운|light/.test(s)) return 1;
  if (/수면|잠|asleep|sleep/.test(s)) return 0;
  return undefined;
}

const RANGE: Record<HealthField, [number, number]> = { hr: [25, 250], energy: [0, 2000], sleep: [0, 0], rhr: [25, 150], hrv: [1, 300] };

/** 줄 안에서 찾은 날짜 (위치) */
interface Found { ms: number; a: number; b: number }
const TIME_TAIL = '\\s*(?:오전|오후|AM|PM)?\\s*\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*(?:오전|오후|AM|PM))?';
const WD_KO = '(?:,?\\s*\\(?[월화수목금토일](?:요일)?\\)?,?)?';
const DATE_RES: RegExp[] = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?/g,
  new RegExp('\\d{4}\\s*(?:\\.|년|\\/)\\s*\\d{1,2}\\s*(?:\\.|월|\\/)\\s*\\d{1,2}\\s*(?:\\.|일)?' + WD_KO + TIME_TAIL, 'gi'),
  new RegExp('\\b\\d{2}\\s*(?:\\.|년)\\s*\\d{1,2}\\s*(?:\\.|월)\\s*\\d{1,2}\\s*(?:\\.|일)' + WD_KO + TIME_TAIL, 'gi'),
  new RegExp('\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일' + WD_KO + TIME_TAIL, 'gi'),
  /(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4},?\s*(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/gi,
  /(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4},?\s*(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/gi,
];
/** 줄 안 모든 날짜 (앞에서부터). 시각만 있는 것("오후 10:53")은 날짜로 보지 않음 (D-061 검토 P2·P3: 틀린 날에 저장되지 않게) */
export function findDates(line: string, nowMs: number): Found[] {
  const s = String(line || '').replace(/\u202f|\u00a0/g, ' ');
  const out: Found[] = [];
  for (const re of DATE_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const a = m.index, b = a + m[0].length;
      if (out.some((x) => a < x.b && b > x.a)) continue;
      const ms = parseDate(m[0].trim(), nowMs);
      if (ms !== undefined) out.push({ ms, a, b });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}
/** 날짜 표시(년·월·일, "26. 10. 9." 같은 마침표 연속, 달 이름, ISO 날짜, 빗금 날짜)가 있는 글 → 값으로 쓰지 않음 */
export const hasDateMark = (s: string) => /\d\s*년|\d\s*월|\d\s*일|\d+\s*\.\s*\d+\s*\.|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}/i.test(s);
const TIME_ONLY = /(?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}/i;
/** 건너뛴 이유: date 날짜 없음/못 읽음(날짜 조각이 남음 포함), time 날짜 없이 시각만, range 미래·너무 옛날, value 값 없음·범위 밖(수면은 끝·단계 없음) */
export interface SkipWhy { date: number; time: number; range: number; value: number }

/** 여러 줄 글 → 샘플. 못 읽은 줄은 개수만 (skipped, 이유는 why). 미래(+1일)·너무 옛날(-400일) 날짜도 건너뜀 */
export function parseLines(field: HealthField, text: unknown, nowMs: number): { samples: Sample[]; skipped: number; why: SkipWhy } {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const samples: Sample[] = [];
  const why: SkipWhy = { date: 0, time: 0, range: 0, value: 0 };
  const r = RANGE[field];
  for (const line of lines) {
    const parts = line.split(/\t|\s*\|\s*/).map((x) => x.trim()).filter((x) => x !== '');
    let t = parseDate(parts[0] || '', nowMs);
    let rest: string[]; let endText: string | undefined;
    if (t !== undefined && parts.length > 1) {
      rest = parts.slice(1);
    } else {
      // 첫 칸이 날짜가 아님: 줄 안에서 날짜를 찾고, 날짜를 뺀 나머지에서 값 (D-061)
      const ds = findDates(line, nowMs);
      // 시각만 있는 줄(날짜 표시·네 자리 연도 없음)은 따로 셈 → hint 가 "날짜 형식을 ISO 8601로" 안내
      if (!ds.length) { if (TIME_ONLY.test(line) && !hasDateMark(line) && !/\d{4}/.test(line)) why.time++; else why.date++; continue; }
      let left = ''; let pos = 0;
      for (const d of ds) { left += line.slice(pos, d.a) + ' | '; pos = d.b; }
      left += line.slice(pos);
      // 읽지 못한 날짜 조각이 남아 있으면(예: 모르는 형식) 값을 고르지 않고 건너뜀 (검토 P1)
      if (hasDateMark(left)) { why.date++; continue; }
      t = ds[0]!.ms;
      rest = left.split(/\t|\s*[|,;]\s*/).map((x) => x.trim()).filter((x) => x !== '');
      if (ds[1]) endText = line.slice(ds[1].a, ds[1].b);
    }
    if (t > nowMs + DAY_MS || t < nowMs - 400 * DAY_MS) { why.range++; continue; }
    if (field === 'sleep') {
      // 수면: 시작 | (단계 또는 값) | 끝 | (단계)  — 순서가 섞여도 날짜인 칸 = 끝, 단계 글인 칸 = 단계
      let end: number | undefined = endText !== undefined ? parseDate(endText.trim(), nowMs) : undefined; let stage: SleepStage | undefined;
      for (const p of rest) {
        const d = parseDate(p, nowMs);
        if (d !== undefined) { if (end === undefined) end = d; continue; }
        if (hasDateMark(p)) continue;
        const st = parseStage(p);
        if (st !== undefined && stage === undefined) stage = st;
      }
      // 단계 글이 없으면 숫자 값(0~5, HealthKit 수면 분석 값)으로
      if (stage === undefined) { const num = rest.find((p) => /^\d$/.test(p) && HK_SLEEP[Number(p)] !== undefined); if (num !== undefined) stage = HK_SLEEP[Number(num)]; }
      if (end === undefined || end <= t || end - t > DAY_MS || stage === undefined) { why.value++; continue; }
      samples.push({ t, v: 0, end, stage });
      continue;
    }
    // 값: 날짜 표시가 없는 첫 칸의 숫자 (검토 P1: 날짜 조각을 값으로 읽지 않음)
    const vText = rest.find((p) => parseDate(p, nowMs) === undefined && !hasDateMark(p) && !TIME_ONLY.test(p) && parseNumber(p) !== undefined) || '';
    const raw = parseNumber(vText);
    // 활동 에너지를 킬로줄로 쓰는 아이폰 설정이면 kcal 로 바꿈 (D-058 검토 G3)
    const v = raw !== undefined && field === 'energy' && isKJ(vText) ? Math.round((raw / KJ_PER_KCAL) * 10) / 10 : raw;
    if (v === undefined || v < r[0] || v > r[1]) { why.value++; continue; }
    let end: number | undefined;
    const eText = endText !== undefined ? endText.trim() : rest.find((p) => parseDate(p, nowMs) !== undefined);
    if (eText !== undefined) { const d = parseDate(eText, nowMs); if (d !== undefined && d >= t && d - t <= DAY_MS) end = d; }
    samples.push(end === undefined ? { t, v } : { t, v, end });
  }
  return { samples, skipped: why.date + why.time + why.range + why.value, why };
}

/** 건너뛴 줄 이유 → 한국어 안내 (응답 hint) */
export function skipHint(why: SkipWhy, received: number, lines: number): string | undefined {
  if (!lines) return '보낸 값이 비어 있어요. 단축어의 hr·energy(심박·에너지) 칸에 건강 샘플이 들어갔는지, 건강 접근을 허용했는지, 그 시간에 애플워치 기록이 있는지 확인하세요';
  const n = why.date + why.time + why.range + why.value;
  if (!n) return undefined;
  const out: string[] = [];
  if (why.date) out.push(`날짜를 못 읽음 ${why.date}줄 (각 줄 맨 앞에 시작 날짜를 ISO 8601 형식으로)`);
  if (why.time) out.push(`날짜 없이 시각만 있어요 ${why.time}줄 — 단축어에서 날짜 형식을 ISO 8601로`);
  if (why.value) out.push(`값을 못 읽음 ${why.value}줄 (값은 단위 없이 숫자만, 범위 밖이거나 수면은 종료 날짜·수면 단계 필요)`);
  if (why.range) out.push(`날짜가 미래이거나 400일보다 오래됨 ${why.range}줄`);
  return `${received}개 받음, ${n}줄 건너뜀: ${out.join(' · ')}`;
}

// ---------- D-061 AI 가 만든 단축어의 여러 모양 ----------
const nk = (k: string) => String(k).toLowerCase().replace(/[\s\-·.]/g, '').split('_').join('');
const FIELD_ALIAS: Record<string, HealthField> = {
  hr: 'hr', heartrate: 'hr', heartrates: 'hr', heart: 'hr', bpm: 'hr', 심박: 'hr', 심박수: 'hr',
  energy: 'energy', activeenergy: 'energy', activeenergyburned: 'energy', activecalories: 'energy', calories: 'energy', 에너지: 'energy', 활동에너지: 'energy', 활동칼로리: 'energy', 칼로리: 'energy',
  sleep: 'sleep', sleepanalysis: 'sleep', 수면: 'sleep', 수면분석: 'sleep',
  rhr: 'rhr', restingheartrate: 'rhr', 안정심박: 'rhr', 안정심박수: 'rhr', 안정시심박수: 'rhr',
  hrv: 'hrv', heartratevariability: 'hrv', 심박변이: 'hrv', 심박변이도: 'hrv',
};
const TOP_ALIAS: Record<string, string> = { op: 'op', key: 'key', 키: 'key', kind: 'kind', 종류: 'kind', type: 'kind' };
function pick(o: Record<string, unknown>, names: string[]): unknown {
  for (const k of Object.keys(o)) if (names.indexOf(nk(k)) >= 0) return o[k];
  return undefined;
}
const asText = (x: unknown) => (x === undefined || x === null ? '' : typeof x === 'object' ? '' : String(x));
/** 사전 하나 → "시작 | 값 단위 | 끝 | 단계" 한 줄 */
function objLine(o: Record<string, unknown>): string {
  const start = asText(pick(o, ['date', 'startdate', 'start', 'starttime', 'time', 'timestamp', '시작', '시작날짜', '날짜']));
  const val = asText(pick(o, ['value', 'quantity', 'qty', 'bpm', 'kcal', 'ms', '값']));
  const unit = asText(pick(o, ['unit', '단위']));
  const end = asText(pick(o, ['enddate', 'end', 'endtime', '종료', '종료날짜', '끝']));
  const stage = asText(pick(o, ['stage', 'category', '단계', '수면단계']));
  return [start, (val + (unit && !/[a-z가-힣]/i.test(val) ? ' ' + unit : '')).trim(), end, stage !== val ? stage : ''].filter((x) => x !== '').join(' | ');
}
/** 칸 값(글·목록·사전·JSON 글) → 여러 줄 글 */
export function valueText(v: unknown, depth = 0): string {
  if (v === undefined || v === null || depth > 3) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if ((s.charAt(0) === '[' || s.charAt(0) === '{') && s.length < 4000000) { try { return valueText(JSON.parse(s), depth + 1); } catch (e) { return v; } }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? objLine(x as Record<string, unknown>) : valueText(x, depth + 1))).filter((x) => x.trim() !== '').join('\n');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (pick(o, ['date', 'startdate', 'start', 'value', '시작', '값']) !== undefined) return objLine(o);
    const arr = Object.keys(o).map((k) => o[k]).find((x) => Array.isArray(x));
    return arr ? valueText(arr, depth + 1) : '';
  }
  return '';
}
/**
 * 진단 파일(health_debug.json)용 모양: 칸마다 종류·길이·앞 400자. 이름이 key·키(대소문자·빈칸 무시)인 칸과
 * 서버 키와 같은 글은 "[숨김]" (검토 E3). 마지막 1건만 덮어씀 (handler)
 */
export function debugShapeOf(j: Record<string, unknown>, r: Record<string, unknown> | undefined, serverKey: string | null | undefined, atIso: string): Record<string, unknown> {
  const hide = (s: string) => (serverKey && serverKey.length >= 4 ? s.split(serverKey).join('[숨김]') : s);
  const shape: Record<string, unknown> = {};
  for (const k of Object.keys(j || {})) {
    const n = nk(k);
    if (n === 'key' || n === '키') { shape[k] = '[숨김]'; continue; }
    const v = j[k];
    const ty = Array.isArray(v) ? 'array' : typeof v;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    shape[hide(k)] = { type: ty, length: s ? s.length : 0, head: s ? hide(s.slice(0, 400 + (serverKey ? serverKey.length : 0))).slice(0, 400) : '' };
  }
  return { at: atIso, result: { ok: r && r.ok, received: r && r.received, skipped: r && r.skipped, hint: r && r.hint }, fields: shape };
}

/** 맨 위 칸 이름만 고침 (Key·OP·Kind·키·종류 → key·op·kind, 키 앞뒤 빈칸). 동기화 요청도 지나가므로 다른 칸은 그대로 */
export function normalizeTop(j: Record<string, unknown>): Record<string, unknown> {
  if (!j || typeof j !== 'object') return j;
  let out = j;
  for (const k of Object.keys(j)) {
    const a = TOP_ALIAS[nk(k)];
    if (a && a !== k && out[a] === undefined) { if (out === j) out = Object.assign({}, j); out[a] = j[k]; }
  }
  if (typeof out.key === 'string' && out.key !== out.key.trim()) { if (out === j) out = Object.assign({}, j); out.key = (out.key as string).trim(); }
  if (typeof out.op === 'string' && out.op !== out.op.toLowerCase().trim()) { if (out === j) out = Object.assign({}, j); out.op = (out.op as string).toLowerCase().trim(); }
  return out;
}
/** 건강 요청 → { kind, hr, energy, sleep, rhr, hrv } 여러 줄 글 (칸 이름·값 모양을 가리지 않음) */
export function normalizeHealthReq(req: HealthReq): { kind: string; fields: Record<HealthField, string> } {
  const top = normalizeTop(req as Record<string, unknown>);
  const fields = { hr: '', energy: '', sleep: '', rhr: '', hrv: '' } as Record<HealthField, string>;
  const add = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) {
      const f = FIELD_ALIAS[nk(k)];
      if (!f) continue;
      const txt = valueText(o[k]);
      if (txt.trim()) fields[f] = fields[f] ? fields[f] + '\n' + txt : txt;
    }
  };
  add(top);
  for (const k of ['samples', 'data', 'health']) { const x = top[k]; if (x && typeof x === 'object' && !Array.isArray(x)) add(x as Record<string, unknown>); else if (typeof x === 'string' && x.trim().charAt(0) === '{') { try { add(JSON.parse(x) as Record<string, unknown>); } catch (e) { /* 무시 */ } } }
  const kr = String(top.kind ?? 'workout').toLowerCase().trim();
  const kind = /canary/.test(kr) ? 'canary' : /daily|하루|day/.test(kr) ? 'daily' : 'workout';
  return { kind, fields };
}

// ---------- 서버 저장 (기록 표 'health') ----------
export interface HRec { table: string; id: string; data?: Record<string, unknown>; deleted?: boolean; hlc: string; dev: string; rev: number }
export interface HState { rev: number; recs: Record<string, HRec> }
export interface HealthReq { kind?: string; samples?: Record<string, unknown>; [k: string]: unknown }
export type IngestResult = { ok: true; received: number; skipped: number; stored: string[]; hint?: string } | { ok: false; error: string };

const hlcOf = (ms: number) => String(Math.floor(ms)).padStart(13, '0') + '.0000.srv';
const keyOf = (id: string) => HEALTH_TABLE + '/' + id;
function put(state: HState, id: string, data: Record<string, unknown>, nowMs: number): void {
  state.rev += 1;
  state.recs[keyOf(id)] = { table: HEALTH_TABLE, id, data, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev };
}
function cur(state: HState, id: string): Record<string, unknown> | undefined {
  const r = state.recs[keyOf(id)];
  return r && !r.deleted ? r.data : undefined;
}
/** 평평한 배열을 width개씩 → 첫 값(키)으로 묶은 Map */
function toMap(flat: unknown, width: number): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const a = Array.isArray(flat) ? (flat as number[]) : [];
  for (let i = 0; i + width <= a.length; i += width) m.set(a[i]!, a.slice(i, i + width));
  return m;
}
function flatSorted(m: Map<number, number[]>): number[] {
  const keys = Array.from(m.keys()).sort((a, b) => a - b);
  const out: number[] = [];
  for (const k of keys) for (const x of m.get(k)!) out.push(x);
  return out;
}
/** 수면 밤의 날짜: 끝 시각 기준 전날 12시 ~ 그날 12시 → 그날 */
export const sleepDay = (endMs: number) => kstDay(endMs - 12 * 3600 * 1000 + DAY_MS);
/** 겹치는 잠 구간을 합친 총 분 (여러 기기·단계가 겹쳐도 두 번 세지 않음) */
export function asleepMinutes(seg: readonly number[]): number {
  const iv: [number, number][] = [];
  for (let i = 0; i + 3 <= seg.length; i += 3) if (ASLEEP_STAGES.includes(seg[i + 2]!)) iv.push([seg[i]!, seg[i + 1]!]);
  iv.sort((a, b) => a[0] - b[0]);
  let total = 0, s = -1, e = -1;
  for (const [a, b] of iv) {
    if (a > e) { if (e > s) total += e - s; s = a; e = b; } else if (b > e) e = b;
  }
  if (e > s) total += e - s;
  return Math.round(total / 60);
}

/** 단축어 요청 하나 반영 (state 를 제자리에서 바꿈). kind:'canary' 는 읽기만 하고 canary 기록 하나만 씀 */
export function ingestHealth(state: HState, req: HealthReq, nowMs: number): IngestResult {
  const norm = normalizeHealthReq(req);
  const src = norm.fields;
  let lines = 0;
  for (const f of HEALTH_FIELDS) lines += src[f].split(/\r?\n/).filter((l) => l.trim()).length;
  if (lines > MAX_LINES) return { ok: false, error: 'too_many' };
  const parsed = {} as Record<HealthField, Sample[]>;
  let received = 0, skipped = 0;
  const why: SkipWhy = { date: 0, time: 0, range: 0, value: 0 };
  for (const f of HEALTH_FIELDS) {
    const r = parseLines(f, src[f], nowMs);
    parsed[f] = r.samples; received += r.samples.length; skipped += r.skipped;
    why.date += r.why.date; why.time += r.why.time; why.range += r.why.range; why.value += r.why.value;
  }
  const hint = skipHint(why, received, lines);
  const extra = (o: { ok: true; received: number; skipped: number; stored: string[] }): IngestResult => { const x: IngestResult = o; if (hint) x.hint = hint; return x; };
  const rx = new Date(nowMs).toISOString();
  const kind = norm.kind;
  if (kind === 'canary') { put(state, 'canary', { id: 'canary', type: 'canary', at: rx, received, skipped }, nowMs); return extra({ ok: true, received, skipped, stored: ['canary'] }); }
  const cutoff = kstDay(nowMs - RAW_KEEP_DAYS * DAY_MS);
  const touched = new Map<string, Record<string, unknown>>();
  const get = (id: string, init: () => Record<string, unknown>) => {
    let d = touched.get(id);
    if (!d) { const c = cur(state, id); d = c ? JSON.parse(JSON.stringify(c)) as Record<string, unknown> : init(); touched.set(id, d); }
    return d;
  };
  // 심박: 그날 0시부터 초, 5초 칸마다 하나
  const hrMaps = new Map<string, Map<number, number[]>>();
  for (const x of parsed.hr) {
    const day = kstDay(x.t); if (day < cutoff) continue;
    const id = 'hr-' + day;
    const d = get(id, () => ({ id, type: 'hr', day, t0: kstDayStart(day), p: [] }));
    let m = hrMaps.get(id); if (!m) { m = toMap(d.p, 2); hrMaps.set(id, m); }
    const sec = Math.floor((x.t - (d.t0 as number)) / 1000 / HR_BUCKET_SEC) * HR_BUCKET_SEC;
    m.set(sec, [sec, Math.round(x.v)]);
  }
  for (const [id, m] of hrMaps) { const d = touched.get(id)!; let flat = flatSorted(m); if (flat.length > 2 * MAX_DAY_POINTS) flat = flat.slice(flat.length - 2 * MAX_DAY_POINTS); d.p = flat; }
  // 활동 에너지: [시작초, 길이초, kcal×10]. 같은 (시작, 길이)면 하나 (다시 보내도 늘지 않음). 시작이 같아도 길이가 다르면
  // 다른 소스(워치 1분·아이폰 10분)라 둘 다 둠 → 합할 때 kcalNoOverlap 이 겹침 정리 (검토 E1)
  const enMaps = new Map<string, Map<string, number[]>>();
  for (const x of parsed.energy) {
    const day = kstDay(x.t); if (day < cutoff) continue;
    const id = 'en-' + day;
    const d = get(id, () => ({ id, type: 'energy', day, t0: kstDayStart(day), p: [] }));
    let m = enMaps.get(id);
    if (!m) { m = new Map(); const a = Array.isArray(d.p) ? (d.p as number[]) : []; for (let i = 0; i + 3 <= a.length; i += 3) m.set(a[i] + ':' + a[i + 1], a.slice(i, i + 3)); enMaps.set(id, m); }
    const sec = Math.floor((x.t - (d.t0 as number)) / 1000);
    const dur = Math.max(0, Math.round(((x.end ?? x.t) - x.t) / 1000));
    m.set(sec + ':' + dur, [sec, dur, Math.round(x.v * 10)]);
  }
  for (const [id, m] of enMaps) {
    const rows = Array.from(m.values()).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    const flat: number[] = []; for (const x of rows) flat.push(x[0]!, x[1]!, x[2]!);
    touched.get(id)!.p = flat;
  }
  // 수면: [시작, 끝(유닉스초), 단계], 같은 (시작, 단계)는 하나
  const slMaps = new Map<string, Map<string, number[]>>();
  for (const x of parsed.sleep) {
    const day = sleepDay(x.end!); if (day < cutoff) continue;
    const id = 'sl-' + day;
    const d = get(id, () => ({ id, type: 'sleep', day, seg: [] }));
    let m = slMaps.get(id);
    if (!m) { m = new Map(); const a = Array.isArray(d.seg) ? (d.seg as number[]) : []; for (let i = 0; i + 3 <= a.length; i += 3) m.set(a[i] + ':' + a[i + 2], a.slice(i, i + 3)); slMaps.set(id, m); }
    const s0 = Math.floor(x.t / 1000);
    m.set(s0 + ':' + x.stage, [s0, Math.floor(x.end! / 1000), x.stage!]);
  }
  for (const [id, m] of slMaps) {
    const segs = Array.from(m.values()).sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!);
    const flat: number[] = []; for (const s of segs) flat.push(s[0]!, s[1]!, s[2]!);
    const d = touched.get(id)!; d.seg = flat;
    const day = d.day as string;
    const dy = get('dy-' + day, () => ({ id: 'dy-' + day, type: 'daily', day }));
    dy.sleepMin = asleepMinutes(flat);
  }
  // 안정 심박: 그날 마지막 값 / HRV: 그날 평균 (샘플을 모아 둠)
  for (const x of parsed.rhr) {
    const day = kstDay(x.t); const id = 'dy-' + day;
    const dy = get(id, () => ({ id, type: 'daily', day }));
    if (!(typeof dy.rhrAt === 'number') || x.t >= (dy.rhrAt as number)) { dy.rhr = Math.round(x.v); dy.rhrAt = x.t; }
  }
  const hvMaps = new Map<string, Map<number, number[]>>();
  for (const x of parsed.hrv) {
    const day = kstDay(x.t); const id = 'dy-' + day;
    const dy = get(id, () => ({ id, type: 'daily', day }));
    let m = hvMaps.get(id); if (!m) { m = toMap(dy.hrvP, 2); hvMaps.set(id, m); }
    const sec = Math.floor((x.t - kstDayStart(day)) / 1000);
    m.set(sec, [sec, Math.round(x.v * 10)]);
  }
  for (const [id, m] of hvMaps) {
    const dy = touched.get(id)!; const flat = flatSorted(m); dy.hrvP = flat;
    let sum = 0, n = 0; for (let i = 1; i < flat.length; i += 2) { sum += flat[i]!; n++; }
    dy.hrv = n ? Math.round(sum / n) / 10 : undefined; dy.hrvN = n;
  }
  const stored: string[] = [];
  for (const [id, d] of touched) { d.rx = rx; put(state, id, d, nowMs); stored.push(id); }
  // D-059 운동별 요약: 받은 샘플 시간(±1일)과 겹치는 끝난 운동 + (배포 뒤 처음이면) 옛 운동을 나눠서
  let tMin = Infinity, tMax = -Infinity;
  for (const f of ['hr', 'energy'] as const) for (const x of parsed[f]) { if (x.t < tMin) tMin = x.t; const e = x.end ?? x.t; if (e > tMax) tMax = e; }
  if (tMin <= tMax) refreshSummaries(state, (w) => Date.parse(w.startedAt) <= tMax + DAY_MS && Date.parse(w.endedAt) >= tMin - DAY_MS, nowMs);
  backfillSummaries(state, nowMs);
  // 오래된 원본 정리 (요약 dy- 는 남김)
  for (const k of Object.keys(state.recs)) {
    const r = state.recs[k]!;
    if (r.table !== HEALTH_TABLE || r.deleted || !/^(hr|en|sl)-\d{4}-\d{2}-\d{2}$/.test(r.id)) continue;
    if (r.id.slice(3) < cutoff) { state.rev += 1; state.recs[k] = { table: HEALTH_TABLE, id: r.id, deleted: true, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev }; }
  }
  return extra({ ok: true, received, skipped, stored: stored.sort() });
}

// ---------- D-059 운동별 애플워치 요약 (지우지 않음) ----------
export const BACKFILL_CAP = 150;
/** 운동별 요약의 계산 판 (2 = 활동 에너지 겹침 정리, 0.9.10). wsmeta.v 가 이보다 작으면 최근 운동 요약을 다시 계산 */
export const WS_CALC_VERSION = 2;

/**
 * 활동 에너지 합 (겹침 정리, 검토 E1): 아이폰·애플워치처럼 소스가 여럿이면 같은 시간을 여러 샘플이 덮음.
 * 건강 앱의 "한 소스 우선"을 근사해, 모든 샘플 경계로 시간을 잘게 나눈 뒤 각 조각에서 **가장 큰 kcal/초 하나만** 더함.
 * 점 샘플(길이 0)은 어떤 구간 샘플에도 덮이지 않을 때만 더함. iv = [시작ms, 끝ms, kcal] (점은 시작=끝)
 */
export function kcalNoOverlap(iv: readonly (readonly [number, number, number])[], a: number, b: number): number | undefined {
  const spans: [number, number, number][] = [];
  const points: [number, number][] = [];
  let any = false;
  for (const [s, e, k] of iv) {
    if (e <= s) { if (s >= a && s <= b) { points.push([s, k]); any = true; } continue; }
    const x = Math.max(a, s), y = Math.min(b, e);
    if (y <= x) continue;
    spans.push([x, y, k / (e - s)]); any = true;
  }
  if (!any) return undefined;
  const cuts = Array.from(new Set(spans.flatMap((p) => [p[0], p[1]]))).sort((p, q) => p - q);
  spans.sort((p, q) => p[0] - q[0]);
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const x = cuts[i]!, y = cuts[i + 1]!;
    let best = 0;
    for (const sp of spans) { if (sp[0] > x) break; if (sp[1] >= y && sp[2] > best) best = sp[2]; }
    total += best * (y - x);
  }
  for (const [s, k] of points) if (!spans.some((sp) => sp[0] <= s && sp[1] >= s)) total += k;
  return total;
}
/** en- 기록(p:[시작초, 길이초, kcal×10 ...]) → kcalNoOverlap 입력 */
export function enIntervals(row: { t0?: unknown; p?: unknown } | undefined): [number, number, number][] {
  if (!row || !Array.isArray(row.p) || typeof row.t0 !== 'number') return [];
  const p = row.p as number[]; const t0 = row.t0 as number; const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < p.length; i += 3) { const s = t0 + p[i]! * 1000; out.push([s, s + p[i + 1]! * 1000, p[i + 2]! / 10]); }
  return out;
}
export interface RowLike { t0?: unknown; p?: unknown; [k: string]: unknown }
export interface WindowSummary { hrAvg?: number; hrMax?: number; hrN: number; kcal?: number }
/** 운동 시간 [a,b] 안 심박(평균·최고·개수)과 겹친 활동 에너지(겹친 비율만큼). 행은 ID 로 찾음 (hr-날짜, en-날짜) */
export function windowSummary(get: (id: string) => RowLike | undefined, a: number, b: number): WindowSummary {
  if (!(b > a)) return { hrN: 0 };
  let sum = 0, n = 0, max = 0;
  const iv: [number, number, number][] = [];
  for (let d = kstDayStart(kstDay(a - DAY_MS)); d <= b; d += DAY_MS) {
    const day = kstDay(d);
    const hr = get('hr-' + day);
    if (hr && Array.isArray(hr.p) && typeof hr.t0 === 'number' && d >= kstDayStart(kstDay(a))) {
      const p = hr.p as number[];
      for (let i = 0; i + 1 < p.length; i += 2) { const t = hr.t0 + p[i]! * 1000; if (t < a || t > b) continue; const v = p[i + 1]!; sum += v; n++; if (v > max) max = v; }
    }
    for (const x of enIntervals(get('en-' + day))) iv.push(x);
  }
  const kcal = kcalNoOverlap(iv, a, b);
  const out: WindowSummary = { hrN: n };
  if (n) { out.hrAvg = Math.round(sum / n); out.hrMax = max; }
  if (kcal !== undefined) out.kcal = Math.round(kcal);
  return out;
}
interface WLike { id: string; startedAt: string; endedAt: string }
/** 기록 파일의 끝난 운동 (지운 것·늦게 온 사본 제외) */
function finishedWorkouts(state: HState): WLike[] {
  const out: WLike[] = [];
  for (const k of Object.keys(state.recs)) {
    const r = state.recs[k]!;
    if (r.table !== 'workouts' || r.deleted || !r.data) continue;
    const d = r.data;
    if (typeof d.endedAt !== 'string' || typeof d.startedAt !== 'string' || d.pendingMerge) continue;
    out.push({ id: r.id, startedAt: d.startedAt, endedAt: d.endedAt });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** 운동 시간 [a,b] 에 걸친 날 중 원본(prefix-날짜) 기록이 없거나 지워진 날이 있는지 (120일 정리 등) */
function rawMissing(state: HState, prefix: string, a: number, b: number, lookback: number): boolean {
  for (let d = kstDayStart(kstDay(a - lookback)); d <= b; d += DAY_MS) if (!cur(state, prefix + kstDay(d))) return true;
  return false;
}
/**
 * 운동 하나의 요약을 다시 계산해 저장. 바뀐 게 없으면 쓰지 않음. 나빠지지 않게 (D-059, 검토 E1):
 * - 새 계산이 심박 0개·칼로리 없음인데 저장된 요약이 있으면: 시간이 같으면 그대로, 시간을 고쳤으면 값은 두고
 *   시간만 새로 + stale:true (원본이 정리돼 다시 셀 수 없음)
 * - 시간이 같고 새 심박 개수가 더 적으면 저장된 심박 값 유지
 * - 저장된 kcal 보다 새 kcal 이 없거나 작은데 그 시간의 에너지 원본이 빠져 있으면 저장된 kcal 유지
 * - 심박·칼로리가 둘 다 없고 저장된 것도 없으면 만들지 않음
 */
export function refreshSummary(state: HState, w: WLike, nowMs: number): boolean {
  const id = 'ws-' + w.id;
  const old = cur(state, id);
  const a = Date.parse(w.startedAt), b = Date.parse(w.endedAt);
  const s = windowSummary((rid) => cur(state, rid) as RowLike | undefined, a, b);
  const sameTime = !!old && old.startedAt === w.startedAt && old.endedAt === w.endedAt;
  const empty = !s.hrN && !s.kcal;
  if (!old && empty) return false;
  const base: Record<string, unknown> = { id, type: 'ws', workoutId: w.id, startedAt: w.startedAt, endedAt: w.endedAt, src: 'watch', computedAt: new Date(nowMs).toISOString() };
  if (old && empty) {
    if (sameTime) return false;
    const keep: Record<string, unknown> = { ...base };
    for (const k of ['hrN', 'hrAvg', 'hrMax', 'kcal']) if (old[k] !== undefined) keep[k] = old[k];
    keep.stale = true;
    put(state, id, keep, nowMs);
    return true;
  }
  const oldN = old && typeof old.hrN === 'number' ? (old.hrN as number) : 0;
  const oldK = old && typeof old.kcal === 'number' ? (old.kcal as number) : undefined;
  let hrN = s.hrN, hrAvg = s.hrAvg, hrMax = s.hrMax, kcal = s.kcal;
  if (sameTime && hrN < oldN) { hrN = oldN; hrAvg = old!.hrAvg as number | undefined; hrMax = old!.hrMax as number | undefined; }
  let stale = false;
  if (oldK !== undefined && (kcal === undefined || kcal < oldK) && (sameTime || kcal === undefined) && rawMissing(state, 'en-', a, b, 0)) { kcal = oldK; stale = !sameTime; } // 운동 날의 원본이 없을 때만 (전날 기록이 없는 건 정상, 검토 E1 다시 계산이 막히지 않게)
  if (sameTime && hrN === oldN && hrAvg === old!.hrAvg && hrMax === old!.hrMax && kcal === oldK && !old!.stale && old!.kv === WS_CALC_VERSION) return false;
  const data: Record<string, unknown> = { ...base, hrN, kv: WS_CALC_VERSION };
  if (hrAvg !== undefined) { data.hrAvg = hrAvg; data.hrMax = hrMax; }
  if (kcal !== undefined) data.kcal = kcal;
  if (stale) data.stale = true;
  put(state, id, data, nowMs);
  return true;
}
/** 조건에 맞는 끝난 운동들의 요약 다시 계산. 쓴 개수 */
export function refreshSummaries(state: HState, pick: (w: WLike) => boolean, nowMs: number): number {
  let n = 0;
  for (const w of finishedWorkouts(state)) if (pick(w) && refreshSummary(state, w, nowMs)) n++;
  return n;
}
/** 배포 뒤 처음: 옛 운동 요약을 BACKFILL_CAP 개씩 (Apps Script 실행 시간 안에서), 다음 요청에 이어서 */
export function backfillSummaries(state: HState, nowMs: number, cap = BACKFILL_CAP): number {
  const meta = cur(state, 'wsmeta');
  const same = !!meta && meta.v === WS_CALC_VERSION;
  if (meta && meta.done && same) return 0;
  // 계산 판이 바뀌면(예: 0.9.10 에너지 겹침 정리) 처음부터 다시. 원본이 남아 있는 최근 운동만 (그보다 오래된 것은 다시 셀 수 없음)
  const after = same && typeof meta!.after === 'string' ? (meta!.after as string) : '';
  const since = nowMs - (RAW_KEEP_DAYS + 1) * DAY_MS;
  const list = finishedWorkouts(state).filter((w) => w.id > after && Date.parse(w.endedAt) >= since);
  if (!list.length && !meta) return 0; // 할 일이 없으면 표시도 쓰지 않음 (운동은 올라올 때 afterWorkoutMuts 가 채움)
  const batch = list.slice(0, cap);
  let n = 0;
  for (const w of batch) if (refreshSummary(state, w, nowMs)) n++;
  const done = list.length <= cap;
  put(state, 'wsmeta', { id: 'wsmeta', type: 'wsmeta', v: WS_CALC_VERSION, done, after: batch.length ? batch[batch.length - 1]!.id : after, at: new Date(nowMs).toISOString() }, nowMs);
  return n;
}
/**
 * 기기가 운동을 올린 뒤 (서버 handler 의 sync_ 가 부름): 끝난 운동이면 요약 다시 계산, 지운 운동이면 요약도 지움.
 * 바꾼 게 있으면 true (서버는 응답의 rev·health 를 다시 채움)
 */
export function afterWorkoutMuts(state: HState, ids: readonly string[], nowMs: number): boolean {
  let changed = false;
  for (const wid of ids) {
    const r = state.recs['workouts/' + wid];
    const key = keyOf('ws-' + wid);
    const ws = state.recs[key];
    if (!r || r.deleted || !r.data || typeof r.data.endedAt !== 'string' || r.data.pendingMerge) {
      if (r && r.deleted && ws && !ws.deleted) { state.rev += 1; state.recs[key] = { table: HEALTH_TABLE, id: 'ws-' + wid, deleted: true, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev }; changed = true; }
      continue;
    }
    if (refreshSummary(state, { id: wid, startedAt: r.data.startedAt as string, endedAt: r.data.endedAt as string }, nowMs)) changed = true;
  }
  return changed;
}

/** 단축어가 보내는 모양 고르기: JSON 글 또는 폼(a=b&c=d) 글. 키·종류·값들 */
export function readHealthBody(body: string, params?: Record<string, string>): Record<string, unknown> | undefined {
  const t = String(body || '').trim();
  if (t.charAt(0) === '{') { try { return JSON.parse(t) as Record<string, unknown>; } catch (e) { return undefined; } }
  if (params && (params.key || params.kind)) return Object.assign({}, params);
  if (t.indexOf('=') > 0) {
    const out: Record<string, string> = {};
    for (const kv of t.split('&')) { const i = kv.indexOf('='); if (i <= 0) continue; out[decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }
    return out;
  }
  return undefined;
}
