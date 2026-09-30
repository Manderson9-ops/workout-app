/**
 * 자동 보내기(T2) 설정 글 읽기 (D-023, D-025). 설정 글 = "<Apps Script 웹 앱 주소>#<키>" (sync/설정.txt 두 번째 줄).
 * 주소는 구글 Apps Script 웹 앱(/exec)만 허용: 다른 곳으로 기록이 새지 않게.
 */
export const EXEC_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/;

export function parseSendConfig(text: string): { ok: true; url: string; key: string } | { ok: false; error: string } {
  // 한 줄 입력칸은 줄바꿈을 지우므로(설정.txt 전체를 붙여넣은 경우) 줄과 상관없이 https:// 부터 빈칸 전까지를 찾음
  const line = text.match(/https:\/\/\S+/)?.[0] ?? '';
  const i = line.indexOf('#');
  if (i < 0) return { ok: false, error: '설정 글에 주소와 키가 없어요. 설정.txt의 두 번째 줄 전체를 붙여넣어 주세요' };
  const url = line.slice(0, i), key = line.slice(i + 1);
  if (!EXEC_RE.test(url)) return { ok: false, error: '구글 Apps Script 주소(/exec)가 아니에요' };
  if (!/^[A-Za-z0-9]{24,64}$/.test(key)) return { ok: false, error: '키 모양이 맞지 않아요' };
  return { ok: true, url, key };
}

/** 화면 표시용: 키는 끝 4자리만 */
export const maskKey = (key: string) => `••••${key.slice(-4)}`;
