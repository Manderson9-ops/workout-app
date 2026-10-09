/**
 * D-061 iOS 27 단축어 "설명으로 만들기"(Apple Intelligence)에 붙여 넣을 설명 글.
 * 서버(healthIngest)가 읽는 모양과 맞도록 단계·이름·형식을 구체적으로 적는다.
 * 주소·키는 복사하는 순간에만 넣는다 (화면에는 자리 표시 [주소]·[키]만, 키는 절대 그리지 않음).
 */
export type PromptId = 'A' | 'B' | 'auto';
export type PromptLang = 'ko' | 'en';
export interface PromptCfg { url: string; key: string }

/** 화면 미리 보기용 자리 표시 */
export const PLACEHOLDER: Record<PromptLang, PromptCfg> = {
  ko: { url: '[주소]', key: '[키]' },
  en: { url: '[URL]', key: '[KEY]' },
};
/** 자동화: 매일 밤 시각 (앱 판단: 23:00보다 폰이 잠겨 있지 않을 가능성이 높은 22:30) */
export const DAILY_TIME = '22:30';
export const NAME = { A: { ko: '운동 기록 보내기', en: 'Send Workout Health' }, B: { ko: '하루 건강 보내기', en: 'Send Daily Health' } } as const;

/**
 * 실기기 결과(2026-10-09, iOS 27 한국어): 변수 이름('심박')을 쓰라고 하면 AI 가 "변수 설정"을 빠뜨려 본문이 빈 글로 감.
 * 그래서 변수를 쓰지 않고, 자료 종류마다 [찾기 → 반복 → 새로운 줄로 합치기 → 바로 다음 URL 보내기]를 한 묶음으로 둔다
 * (본문 값 = 바로 앞 동작의 결과). 소스 필터도 뺌(전에 0건 원인, 서버가 같은 시각은 하나로 합침 — 앱 판단).
 */
interface Seg { ko: string; en: string; field: string; end?: boolean; stage?: boolean }
export const SEG_A: Seg[] = [
  { ko: '심박수', en: 'Heart Rate', field: 'hr' },
  { ko: '활동 에너지', en: 'Active Energy', field: 'energy', end: true },
];
export const SEG_B: Seg[] = [
  { ko: '심박수', en: 'Heart Rate', field: 'hr' },
  { ko: '활동 에너지', en: 'Active Energy', field: 'energy', end: true },
  { ko: '수면 분석', en: 'Sleep Analysis', field: 'sleep', end: true, stage: true },
  { ko: '안정 시 심박수', en: 'Resting Heart Rate', field: 'rhr' },
  { ko: '심박 변이도', en: 'Heart Rate Variability', field: 'hrv' },
];
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕';

function segKo(s: Seg, i: number, n: number, c: PromptCfg, kind: string, range: string, show: boolean): string {
  const k = (j: number) => CIRCLED.charAt(i * 5 + j);
  const line = s.end ? "'포맷된 시작일 | 반복 항목의 값 | 포맷된 종료일'" : "'포맷된 시작일 | 반복 항목의 값'";
  return [
    `[${i + 1}/${n} ${s.ko}]`,
    `${k(0)} 건강 샘플 찾기: ${s.ko}, 시작일이 ${range} 이내, 오래된 순, 제한 없음 (소스 필터 없음).`,
    `${k(1)} 각 항목 반복: 반복 항목의 시작일${s.end ? '과 종료일' : ''}을 ISO 8601(시간 포함) 형식으로 포맷하고, ${line} 텍스트를 만든다. ${s.stage ? '값은 수면 단계 그대로.' : '값은 단위 없이 숫자만.'}`,
    `${k(2)} 반복 결과를 새로운 줄로 합친다.`,
    `${k(3)} 바로 다음에 URL의 콘텐츠 가져오기: ${c.url}, 방법 POST, 요청 본문 JSON: op=health, key=${c.key}, kind=${kind}, ${s.field}=${k(2)}의 합쳐진 텍스트(바로 앞 동작의 결과).`,
    show ? `${k(4)} 응답을 결과 보기로 보여 준다.` : `${k(4)} 결과 보기 없이 다음으로.`,
  ].join('\n');
}
function segEn(s: Seg, i: number, n: number, c: PromptCfg, kind: string, range: string, show: boolean): string {
  const k = (j: number) => `${i * 5 + j + 1})`;
  const line = s.end ? "'Formatted Start Date | Repeat Item Value | Formatted End Date'" : "'Formatted Start Date | Repeat Item Value'";
  return [
    `[${i + 1}/${n} ${s.en}]`,
    `${k(0)} Find Health Samples: ${s.en}, Start Date in the ${range}, oldest first, no limit (no source filter).`,
    `${k(1)} Repeat with Each: format the Repeat Item's Start Date${s.end ? ' and End Date' : ''} as ISO 8601 including time, and make the text ${line}. ${s.stage ? 'Value is the sleep stage as is.' : 'Value as a number only, no unit.'}`,
    `${k(2)} Combine the Repeat Results with New Lines.`,
    `${k(3)} Right after that, Get Contents of URL ${c.url}, Method POST, Request Body JSON: op=health, key=${c.key}, kind=${kind}, ${s.field}=the combined text from step ${i * 5 + 3} (the output of the action right before).`,
    show ? `${k(4)} Show the response with Show Result.` : `${k(4)} No Show Result, continue.`,
  ].join('\n');
}
const HEAD_KO = '변수 설정 동작은 쓰지 말고, 각 동작은 바로 앞 동작의 결과를 쓰게 해 줘. 순서대로:';
const HEAD_EN = 'Do not use any Set Variable actions; each action must use the output of the action right before it. Steps in order:';

function ko(id: PromptId, c: PromptCfg): string {
  if (id === 'A') return [`'${NAME.A.ko}' 단축어를 만들어 줘. ${HEAD_KO}`, ...SEG_A.map((s, i) => segKo(s, i, SEG_A.length, c, 'workout', '최근 4시간', true))].join('\n');
  if (id === 'B') return [`'${NAME.B.ko}' 단축어를 만들어 줘. ${HEAD_KO}`, ...SEG_B.map((s, i) => segKo(s, i, SEG_B.length, c, 'daily', '최근 1일', i === SEG_B.length - 1))].join('\n');
  return [
    `개인용 자동화 두 개를 만들어 줘.`,
    `1) Apple Watch에서 운동이 끝나면 '${NAME.A.ko}' 단축어를 실행. 실행 전에 묻지 않고 바로 실행, 실행 시 알림 끄기.`,
    `2) 매일 ${DAILY_TIME}에 '${NAME.B.ko}' 단축어를 실행. 실행 전에 묻지 않고 바로 실행, 실행 시 알림 끄기.`,
  ].join('\n');
}

function en(id: PromptId, c: PromptCfg): string {
  if (id === 'A') return [`Create a shortcut named '${NAME.A.en}'. ${HEAD_EN}`, ...SEG_A.map((s, i) => segEn(s, i, SEG_A.length, c, 'workout', 'last 4 hours', true))].join('\n');
  if (id === 'B') return [`Create a shortcut named '${NAME.B.en}'. ${HEAD_EN}`, ...SEG_B.map((s, i) => segEn(s, i, SEG_B.length, c, 'daily', 'last 1 day', i === SEG_B.length - 1))].join('\n');
  return [
    `Create two personal automations.`,
    `1) When an Apple Watch workout ends, run the shortcut '${NAME.A.en}'. Run immediately without asking, notify when run off.`,
    `2) Every day at ${DAILY_TIME}, run the shortcut '${NAME.B.en}'. Run immediately without asking, notify when run off.`,
  ].join('\n');
}

/** 복사할 설명 글 (cfg 가 있으면 실제 주소·키를 넣음 → 클립보드에만 쓸 것) */
export function buildPrompt(id: PromptId, lang: PromptLang, cfg?: PromptCfg): string {
  const c = cfg ?? PLACEHOLDER[lang];
  return lang === 'en' ? en(id, c) : ko(id, c);
}
/** 화면 미리 보기 (항상 자리 표시, 키 없음) */
export const previewPrompt = (id: PromptId, lang: PromptLang) => buildPrompt(id, lang);

/** 설명으로 자동화를 못 만들 때 손으로. iOS 26 기준 위치이고 iOS 27은 트리거가 동작 목록 안으로 옮겨졌다는 보도가 있어 미확인 (검토 S2) */
export const AUTOMATION_MANUAL: Record<PromptLang, string[]> = {
  ko: [
    `자동화 탭(또는 iOS 27에서는 동작 목록의 '트리거') → ＋ → "Apple Watch 운동" → "끝날 때" → 다음 → '${NAME.A.ko}' → "즉시 실행", "실행 시 알림" 끔`,
    `자동화 탭(또는 iOS 27에서는 동작 목록의 '트리거') → ＋ → "특정 시간" → ${DAILY_TIME} 매일 → 다음 → '${NAME.B.ko}' → "즉시 실행"`,
  ],
  en: [
    `Automation tab (or in iOS 27 the 'Triggers' in the action list) → ＋ → "Apple Watch Workout" → "Ends" → Next → '${NAME.A.en}' → "Run Immediately", "Notify When Run" off`,
    `Automation tab (or in iOS 27 the 'Triggers' in the action list) → ＋ → "Time of Day" → ${DAILY_TIME} Daily → Next → '${NAME.B.en}' → "Run Immediately"`,
  ],
};
