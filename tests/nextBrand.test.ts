import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandNext, NEXT_NAME } from '../tools/next_brand';
import { appFromBase } from '../src/ui/appName';

describe('미리 보기 판 (S4, D-031)', () => {
  it('빌드 뒤처리: 홈 화면 이름·제목을 β로 (본판 아이콘과 구분), 본판 파일 형식 그대로 받음', () => {
    const dir = mkdtempSync(join(tmpdir(), 'next-'));
    copyFileSync('public/manifest.webmanifest', join(dir, 'manifest.webmanifest'));
    copyFileSync('index.html', join(dir, 'index.html'));
    brandNext(dir);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
    expect(m.short_name).toBe(NEXT_NAME);
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    const h = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(h).toContain(`<title>${NEXT_NAME} (미리 보기)</title>`);
    expect(h).toContain(`content="${NEXT_NAME}"`);
  });
  it('index.html 모양이 바뀌어 이름을 못 바꾸면 빌드 실패 (조용히 본판 이름으로 배포되지 않게)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'next2-'));
    copyFileSync('public/manifest.webmanifest', join(dir, 'manifest.webmanifest'));
    writeFileSync(join(dir, 'index.html'), '<title>다른 이름</title>');
    expect(() => brandNext(dir)).toThrow();
  });
  it('배포 경로로 앱 이름이 갈림: 본판 workout-app, 미리 보기 workout-app-next', () => {
    expect(appFromBase('/workout-app/')).toBe('workout-app');
    expect(appFromBase('/workout-app-next/')).toBe('workout-app-next');
  });
});
