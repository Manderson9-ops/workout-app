/**
 * 미리 보기 판(D-031) 빌드 뒤처리: 홈 화면 이름을 "운동 기록 β"로 바꿔 본판 아이콘과 구분한다.
 * 실행: npm run build:next (vite build 뒤 자동). 대상: dist-next/manifest.webmanifest, dist-next/index.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NEXT_NAME = '운동 기록 β';

export function brandNext(dir: string): void {
  const mf = join(dir, 'manifest.webmanifest');
  const m = JSON.parse(readFileSync(mf, 'utf8')) as Record<string, unknown>;
  m.name = `${NEXT_NAME} (미리 보기)`;
  m.short_name = NEXT_NAME;
  m.description = '미리 보기 판: 본판과 데이터가 분리돼 있고 동기화하지 않아요';
  writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
  const ix = join(dir, 'index.html');
  const h0 = readFileSync(ix, 'utf8');
  const h = h0
    .replace('<meta name="apple-mobile-web-app-title" content="운동 기록" />', `<meta name="apple-mobile-web-app-title" content="${NEXT_NAME}" />`)
    .replace('<title>운동 기록</title>', `<title>${NEXT_NAME} (미리 보기)</title>`);
  if (!h.includes(`content="${NEXT_NAME}"`) || !h.includes(`<title>${NEXT_NAME} (미리 보기)</title>`)) throw new Error('index.html에서 이름(제목·홈 화면 이름)을 바꾸지 못했어요');
  writeFileSync(ix, h, 'utf8');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/next_brand.ts')) {
  brandNext(process.argv[2] ?? 'dist-next');
  console.log(`미리 보기 판 이름: ${NEXT_NAME}`);
}
