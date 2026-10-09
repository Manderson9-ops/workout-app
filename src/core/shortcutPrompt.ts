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

function ko(id: PromptId, c: PromptCfg): string {
  if (id === 'A') return [
    `'${NAME.A.ko}'라는 단축어를 만들어 줘. 순서대로:`,
    `1) 건강 샘플 찾기: 종류 심박수, 시작 날짜가 최근 4시간 이내, 소스는 Apple Watch, 시작 날짜 오래된 순으로 정렬, 제한 없음.`,
    `2) 찾은 각 샘플마다 반복: '시작 날짜 | 값' 형식의 텍스트 한 줄을 만들어. 시작 날짜는 ISO 8601 형식(시간 포함), 값은 단위 없이 숫자만. 반복 결과를 줄바꿈으로 결합해서 변수 '심박'에 저장.`,
    `3) 건강 샘플 찾기: 종류 활동 에너지, 시작 날짜가 최근 4시간 이내, 시작 날짜 오래된 순. 각 샘플마다 '시작 날짜 | 값 | 종료 날짜' 한 줄(날짜는 ISO 8601, 시간 포함)을 만들어 줄바꿈으로 결합해 변수 '에너지'에 저장.`,
    `4) URL의 콘텐츠 가져오기: URL ${c.url}, 방법 POST, 요청 본문 JSON, 필드는 op = health, key = ${c.key}, kind = workout, hr = 변수 '심박', energy = 변수 '에너지' (모두 텍스트).`,
    `5) 받은 응답을 결과 보기로 보여 줘.`,
  ].join('\n');
  if (id === 'B') return [
    `'${NAME.B.ko}'라는 단축어를 만들어 줘. 순서대로:`,
    `1) 건강 샘플 찾기: 심박수, 시작 날짜가 최근 1일 이내, 시작 날짜 오래된 순. 각 샘플마다 '시작 날짜 | 값' 한 줄(날짜는 ISO 8601, 시간 포함, 값은 단위 없이 숫자만)을 만들어 줄바꿈으로 결합해 변수 '심박'에 저장.`,
    `2) 활동 에너지도 최근 1일, 각 샘플마다 '시작 날짜 | 값 | 종료 날짜' 한 줄로 결합해 변수 '에너지'에 저장.`,
    `3) 수면 분석 최근 1일, 각 샘플마다 '시작 날짜 | 값 | 종료 날짜' 한 줄(값은 수면 단계)로 결합해 변수 '수면'에 저장.`,
    `4) 안정 시 심박수 최근 1일, '시작 날짜 | 값' 줄로 결합해 변수 '안정심박'에 저장.`,
    `5) 심박 변이도 최근 1일, '시작 날짜 | 값' 줄로 결합해 변수 'HRV'에 저장.`,
    `6) URL의 콘텐츠 가져오기: URL ${c.url}, 방법 POST, 요청 본문 JSON, 필드는 op = health, key = ${c.key}, kind = daily, hr = '심박', energy = '에너지', sleep = '수면', rhr = '안정심박', hrv = 'HRV' (모두 텍스트).`,
    `7) 받은 응답을 결과 보기로 보여 줘.`,
  ].join('\n');
  return [
    `개인용 자동화 두 개를 만들어 줘.`,
    `1) Apple Watch에서 운동이 끝나면 '${NAME.A.ko}' 단축어를 실행. 실행 전에 묻지 않고 바로 실행, 실행 시 알림 끄기.`,
    `2) 매일 ${DAILY_TIME}에 '${NAME.B.ko}' 단축어를 실행. 실행 전에 묻지 않고 바로 실행, 실행 시 알림 끄기.`,
  ].join('\n');
}

function en(id: PromptId, c: PromptCfg): string {
  if (id === 'A') return [
    `Create a shortcut named '${NAME.A.en}'. Steps in order:`,
    `1) Find Health Samples where Type is Heart Rate, Start Date is in the last 4 hours, Source is Apple Watch, sorted by Start Date oldest first, no limit.`,
    `2) Repeat with each sample: make a text line 'Start Date | Value', with Start Date formatted as ISO 8601 including time and Value as a number only, without unit. Combine the repeat results with new lines and save to variable 'hr'.`,
    `3) Find Health Samples where Type is Active Energy, Start Date in the last 4 hours, oldest first. For each sample make a line 'Start Date | Value | End Date' (ISO 8601 dates with time), combine with new lines and save to variable 'energy'.`,
    `4) Get Contents of URL ${c.url} with Method POST and Request Body JSON with fields op = health, key = ${c.key}, kind = workout, hr = variable 'hr', energy = variable 'energy' (all as text).`,
    `5) Show the response with Show Result.`,
  ].join('\n');
  if (id === 'B') return [
    `Create a shortcut named '${NAME.B.en}'. Steps in order:`,
    `1) Find Health Samples of Heart Rate with Start Date in the last 1 day, oldest first. For each sample make a line 'Start Date | Value' (ISO 8601 with time, Value as a number only without unit), combine with new lines and save to variable 'hr'.`,
    `2) Same for Active Energy in the last 1 day, lines 'Start Date | Value | End Date', save to variable 'energy'.`,
    `3) Same for Sleep Analysis in the last 1 day, lines 'Start Date | Value | End Date' where Value is the sleep stage, save to variable 'sleep'.`,
    `4) Same for Resting Heart Rate in the last 1 day, lines 'Start Date | Value', save to variable 'rhr'.`,
    `5) Same for Heart Rate Variability in the last 1 day, lines 'Start Date | Value', save to variable 'hrv'.`,
    `6) Get Contents of URL ${c.url} with Method POST and Request Body JSON with fields op = health, key = ${c.key}, kind = daily, hr, energy, sleep, rhr, hrv from the variables above (all as text).`,
    `7) Show the response with Show Result.`,
  ].join('\n');
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
