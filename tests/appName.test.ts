import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appFromBase, APP, DB_NAME } from '../src/ui/appName';

describe('본판·미리 보기 판 분리 (D-031)', () => {
  it('배포 경로로 앱 이름을 정함 → DB 이름·저장 키가 갈림', () => {
    expect(appFromBase('/workout-app/')).toBe('workout-app');
    expect(appFromBase('/workout-app-next/')).toBe('workout-app-next');
    expect(appFromBase('/')).toBe('workout-app');
    expect(APP).toBe(DB_NAME);
  });
  it('manifest는 위치 기준 상대 경로 (두 판이 각자 자기 주소로 열림)', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
  });
  it('build:next 스크립트가 미리 보기 경로로 빌드', () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(p.scripts['build:next']).toContain('--base /workout-app-next/');
  });
});
