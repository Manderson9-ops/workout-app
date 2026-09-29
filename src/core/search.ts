/**
 * 운동 검색 (BLUEPRINT 4.1): 부분 일치, 공백 무시, 초성 검색(예: "ㄹㅍㄷ" → 랫풀다운).
 */
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 한글 음절은 초성으로, 나머지는 그대로 (소문자, 공백 제거) */
export function toChosung(s: string): string {
  let out = '';
  for (const ch of s.replace(/\s/g, '').toLowerCase()) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
  }
  return out;
}

const isChosungOnly = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);
const norm = (s: string) => s.replace(/[\s·()/]/g, '').toLowerCase();

/** 검색어와 이름(별칭 포함)이 맞는지. 빈 검색어는 모두 일치 */
export function matchesQuery(query: string, names: string[]): boolean {
  const q = norm(query);
  if (!q) return true;
  if (isChosungOnly(q)) return names.some((n) => toChosung(norm(n)).includes(q));
  return names.some((n) => norm(n).includes(q));
}
