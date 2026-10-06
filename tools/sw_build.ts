/**
 * D-055 검토 A1: 서비스 워커(sw.js)를 빌드마다 다르게 만든다.
 * 브라우저는 sw.js 바이트가 바뀌어야 새 서비스 워커를 설치한다 → 바뀌지 않으면 "새 버전 준비됨" 배너가 영영 안 뜸.
 * 틀(src/sw.template.js)의 '__BUILD__' 를 "<버전>+<빌드 파일 이름 해시>" 로 바꿔 넣는다 (vite.config.ts 플러그인이 dist/·dist-next/ 에 씀).
 */

/** 문자열 해시 (FNV-1a 32비트, 16진수 8자리). 빌드 파일 이름에 이미 내용 해시가 들어 있어 이름 목록만 섞어도 충분 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** 빌드 이름: 버전 + 빌드 파일 이름 목록의 해시 (같은 버전을 다시 고쳐 빌드해도 달라짐) */
export function buildId(version: string, fileNames: readonly string[]): string {
  if (!/^[\w.+-]+$/.test(version)) throw new Error(`버전 형식이 이상해요: ${version}`);
  return `${version}+${fnv1a([...fileNames].sort().join('\n'))}`;
}

/**
 * 틀에 빌드 이름을 넣은 sw.js 내용. 틀에 자리('__BUILD__')가 정확히 하나가 아니면 오류.
 * assets: 설치 때 미리 담을 빌드 파일(assets/…) 목록 (0.9.3, 화면 나눠 받기). 틀의 ASSETS 자리(__ASSETS__ 주석)에 넣는다
 */
export function buildSw(template: string, id: string, assets: readonly string[] = []): string {
  const n = template.split("'__BUILD__'").length - 1;
  if (n !== 1) throw new Error(`sw.js 틀에 '__BUILD__' 자리가 ${n}개예요 (1개여야 함)`);
  if (!/^[\w.+-]+$/.test(id)) throw new Error(`빌드 이름 형식이 이상해요: ${id}`);
  for (const a of assets) if (!/^assets\/[\w.-]+$/.test(a)) throw new Error(`빌드 파일 이름이 이상해요: ${a}`);
  const list = [...assets].sort().map((a) => `'${a}'`).join(', ');
  return template.replace("'__BUILD__'", () => `'${id}'`).replace('/*__ASSETS__*/', () => list);
}
