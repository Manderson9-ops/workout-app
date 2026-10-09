import { describe, it, expect } from 'vitest';
import { buildPrompt, previewPrompt, AUTOMATION_MANUAL, DAILY_TIME, PLACEHOLDER, SEG_A, SEG_B } from '../src/core/shortcutPrompt';
import type { PromptId, PromptLang } from '../src/core/shortcutPrompt';

const CFG = { url: 'https://script.google.com/macros/s/AKfycbTEST/exec', key: 'SECRETKEY1234567890ABCDEFGH' };
const IDS: PromptId[] = ['A', 'B', 'auto'];
const LANGS: PromptLang[] = ['ko', 'en'];
const count = (s: string, w: string) => s.split(w).length - 1;
const lines = (s: string) => s.split('\n');

describe('D-061 단축어 설명 글 (iOS 27 설명으로 만들기, 실기기 결과 뒤 2판)', () => {
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
  it('자동화 글에는 주소·키가 없음, 22:30', () => {
    for (const lang of LANGS) {
      const a = buildPrompt('auto', lang, CFG);
      expect(a).not.toContain(CFG.key);
      expect(a).not.toContain(CFG.url);
      expect(a).toContain(DAILY_TIME);
    }
    expect(DAILY_TIME).toBe('22:30');
  });
  it('이름 붙인 변수를 만들게 하지 않음 ("변수에 저장"·"save to variable" 없음), 변수 설정 금지를 명시', () => {
    for (const id of ['A', 'B'] as PromptId[]) {
      const k = buildPrompt(id, 'ko');
      expect(k).toContain('변수 설정 동작은 쓰지 말고');
      expect(k).not.toMatch(/변수 '[^']+'에 저장|변수에 저장|= 변수/);
      const e = buildPrompt(id, 'en');
      expect(e).toContain('Do not use any Set Variable actions');
      expect(e).not.toMatch(/save to variable|= variable/i);
    }
  });
  it('자료 종류마다 [찾기 → 반복 → 새로운 줄로 합치기 → 바로 다음 URL 보내기], 본문에는 그 칸 하나만', () => {
    for (const [id, segs, kind] of [['A', SEG_A, 'workout'], ['B', SEG_B, 'daily']] as const) {
      for (const lang of LANGS) {
        const p = buildPrompt(id, lang, CFG);
        const L = lines(p);
        const url = lang === 'ko' ? 'URL의 콘텐츠 가져오기' : 'Get Contents of URL';
        const join = lang === 'ko' ? '새로운 줄로 합친다' : 'Combine the Repeat Results with New Lines';
        const find = lang === 'ko' ? '건강 샘플 찾기' : 'Find Health Samples';
        expect(count(p, url)).toBe(segs.length);
        expect(count(p, find)).toBe(segs.length);
        expect(count(p, `kind=${kind}`)).toBe(segs.length);
        // URL 줄은 늘 합치기 줄 바로 다음, 그 앞은 반복, 그 앞은 찾기
        L.forEach((l, i) => {
          if (!l.includes(url)) return;
          expect(L[i - 1]).toContain(join);
          expect(L[i - 3]).toContain(find);
          // 본문에는 그 종류의 칸 하나만, 바로 앞 동작의 결과
          expect(l).toContain(lang === 'ko' ? '바로 앞 동작의 결과' : 'the output of the action right before');
          const fields = ['hr', 'energy', 'sleep', 'rhr', 'hrv'].filter((f) => new RegExp(`[ ,]${f}=`).test(l));
          expect(fields).toHaveLength(1);
        });
        expect(p).toContain(lang === 'ko' ? '소스 필터 없음' : 'no source filter');
        expect(p).toContain('ISO 8601');
      }
    }
    // 종류·칸 짝
    const b = buildPrompt('B', 'ko');
    for (const w of ['심박수', '활동 에너지', '수면 분석', '안정 시 심박수', '심박 변이도', 'hr=', 'energy=', 'sleep=', 'rhr=', 'hrv=', '최근 1일']) expect(b).toContain(w);
    expect(buildPrompt('A', 'ko')).toContain('최근 4시간');
  });
  it('결과 보기: A 는 보낼 때마다(2번), B 는 마지막 한 번', () => {
    expect(count(buildPrompt('A', 'ko'), '응답을 결과 보기로 보여 준다')).toBe(2);
    expect(count(buildPrompt('B', 'ko'), '응답을 결과 보기로 보여 준다')).toBe(1);
    expect(count(buildPrompt('A', 'en'), 'Show the response with Show Result')).toBe(2);
    expect(count(buildPrompt('B', 'en'), 'Show the response with Show Result')).toBe(1);
  });
  it('글 길이 (자리 표시 기준, 보고용 상한)', () => {
    for (const lang of LANGS) for (const id of IDS) expect(buildPrompt(id, lang).length).toBeGreaterThan(80);
    expect(buildPrompt('A', 'ko').length).toBeLessThan(900);
    expect(buildPrompt('B', 'ko').length).toBeLessThan(2000);
    for (const lang of LANGS) expect(AUTOMATION_MANUAL[lang]).toHaveLength(2);
  });
});
