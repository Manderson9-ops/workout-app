import { describe, it, expect } from 'vitest';
import { buildPrompt, previewPrompt, AUTOMATION_MANUAL, DAILY_TIME, PLACEHOLDER } from '../src/core/shortcutPrompt';
import type { PromptId, PromptLang } from '../src/core/shortcutPrompt';

const CFG = { url: 'https://script.google.com/macros/s/AKfycbTEST/exec', key: 'SECRETKEY1234567890ABCDEFGH' };
const IDS: PromptId[] = ['A', 'B', 'auto'];
const LANGS: PromptLang[] = ['ko', 'en'];

describe('D-061 단축어 설명 글 (iOS 27 설명으로 만들기)', () => {
  it('A·B 복사 글에는 주소·키가 들어가고, 미리 보기에는 자리 표시만 (키 없음)', () => {
    for (const lang of LANGS) for (const id of ['A', 'B'] as PromptId[]) {
      const full = buildPrompt(id, lang, CFG);
      expect(full).toContain(CFG.url);
      expect(full).toContain(CFG.key);
      const pv = previewPrompt(id, lang);
      expect(pv).not.toContain(CFG.key);
      expect(pv).not.toContain(CFG.url);
      expect(pv).toContain(PLACEHOLDER[lang].key);
    }
  });
  it('자동화 글에는 주소·키가 없음', () => {
    for (const lang of LANGS) {
      const a = buildPrompt('auto', lang, CFG);
      expect(a).not.toContain(CFG.key);
      expect(a).not.toContain(CFG.url);
      expect(a).toContain(DAILY_TIME);
    }
    expect(DAILY_TIME).toBe('22:30');
  });
  it('서버가 읽는 칸·형식을 그대로 적음 (op=health, kind, ISO 8601, "시작 날짜 | 값")', () => {
    const a = buildPrompt('A', 'ko', CFG);
    for (const w of ['op = health', 'kind = workout', 'hr =', 'energy =', 'ISO 8601', "'시작 날짜 | 값'", "'시작 날짜 | 값 | 종료 날짜'", 'POST', '최근 4시간', 'Apple Watch']) expect(a).toContain(w);
    const b = buildPrompt('B', 'ko', CFG);
    for (const w of ['kind = daily', 'sleep =', 'rhr =', 'hrv =', '수면 분석', '안정 시 심박수', '심박 변이도', '최근 1일']) expect(b).toContain(w);
    const be = buildPrompt('B', 'en', CFG);
    for (const w of ['kind = daily', 'Sleep Analysis', 'Resting Heart Rate', 'Heart Rate Variability', 'ISO 8601']) expect(be).toContain(w);
    expect(buildPrompt('auto', 'ko')).toContain("'운동 기록 보내기'");
  });
  it('모든 글이 비어 있지 않고, 손으로 만드는 자동화 안내는 두 줄', () => {
    for (const lang of LANGS) {
      for (const id of IDS) expect(buildPrompt(id, lang).length).toBeGreaterThan(80);
      expect(AUTOMATION_MANUAL[lang]).toHaveLength(2);
    }
  });
});
