import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSw, buildId, fnv1a } from '../tools/sw_build';

const tpl = readFileSync('src/sw.template.js', 'utf8');

describe('D-055 검토 A1: sw.js 는 배포마다 달라짐 (새 서비스 워커 설치 → "새 버전 준비됨")', () => {
  it('버전이 다르면 sw.js 내용이 다르고, 버전이 그대로 들어감', () => {
    const a = buildSw(tpl, buildId('0.9.0-preview', ['assets/index-A.js']));
    const b = buildSw(tpl, buildId('0.9.1-preview', ['assets/index-A.js']));
    expect(a).not.toBe(b);
    expect(a).toContain("const BUILD = '0.9.0-preview+");
    expect(b).toContain("const BUILD = '0.9.1-preview+");
    expect(a).not.toContain('__BUILD__');
    // 캐시 이름도 빌드 이름을 씀 (옛 캐시는 activate 에서 지움)
    expect(a).toContain("const CACHE = APP + ':' + BUILD;");
  });
  it('같은 버전이라도 빌드 파일이 바뀌면 다름, 파일 순서는 상관없음', () => {
    expect(buildId('0.9.0', ['a.js', 'b.css'])).not.toBe(buildId('0.9.0', ['a2.js', 'b.css']));
    expect(buildId('0.9.0', ['b.css', 'a.js'])).toBe(buildId('0.9.0', ['a.js', 'b.css']));
    expect(fnv1a('')).toBe('811c9dc5');
  });
  it('틀에 자리가 없거나 이상한 값이면 빌드 실패', () => {
    expect(() => buildSw('const BUILD = 1;', 'x')).toThrow();
    expect(() => buildSw(tpl, "x'; alert(1); '")).toThrow();
    expect(() => buildId('0.9.0 preview', [])).toThrow();
  });
});

describe('설치 때 미리 담을 빌드 파일 목록 (0.9.3 화면 나눠 받기)', () => {
  const tpl = readFileSync('src/sw.template.js', 'utf8');
  it('assets 목록을 정렬해 ASSETS 자리에 넣음, 이상한 이름은 거절', () => {
    const out = buildSw(tpl, 'v1', ['assets/Stats-B.js', 'assets/index-A.js']);
    expect(out).toContain("const ASSETS = ['assets/Stats-B.js', 'assets/index-A.js'];");
    expect(buildSw(tpl, 'v1')).toContain('const ASSETS = [];');
    expect(() => buildSw(tpl, 'v1', ["assets/x.js'];alert(1);//"])).toThrow();
    expect(() => buildSw(tpl, 'v1', ['../secret.js'])).toThrow();
  });
});

describe('D-056 알림 누르면 갈 곳 (sw.template.js notifyTarget)', () => {
  const src = readFileSync('src/sw.template.js', 'utf8');
  const body = src.slice(src.indexOf('/* notify-target:start */'), src.indexOf('/* notify-target:end */'));
  const notifyTarget = new Function(`${body}; return notifyTarget;`)() as (scope: string, dataUrl: unknown, clients: unknown[]) => { url: string; index: number };
  const S = 'https://x.github.io/workout-app/';
  it('열린 같은 앱 창이 있으면 그 창, 없으면 새 창', () => {
    expect(notifyTarget(S, '#/workout', ['https://x.github.io/workout-app-next/#/', `${S}#/stats`])).toEqual({ url: `${S}#/workout`, index: 1 });
    expect(notifyTarget(S, '#/workout', ['https://x.github.io/workout-app-next/'])).toEqual({ url: `${S}#/workout`, index: -1 });
    expect(notifyTarget(S, undefined, [])).toEqual({ url: `${S}#/workout`, index: -1 });
  });
  it('다른 곳 주소·이상한 값은 운동 화면으로', () => {
    expect(notifyTarget(S, 'https://evil.example/', []).url).toBe(`${S}#/workout`);
    expect(notifyTarget(S, '#/settings', []).url).toBe(`${S}#/settings`);
    expect(notifyTarget(S, 'http://[bad', []).url).toBe(`${S}#/workout`);
  });
  it('빌드한 sw.js 에도 그대로 들어감', () => {
    expect(buildSw(src, 'v1')).toContain('function notifyTarget(scope, dataUrl, clientUrls)');
  });
});

