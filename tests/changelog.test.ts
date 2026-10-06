import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { skipReloadFor, waitingDecision, wheresOf, visits, clearVisited, dotTargets, displayVersion, cmpVersion, entriesSince, whatsNewDecision, whatsNewLines, buildVersionInfo, parseVersionInfo, tabOfPath, previousVersion, koDate } from '../src/core/changelog';
import type { ChangelogEntry } from '../src/core/changelog';
import { APP_VERSION } from '../src/core/version';

const E = (version: string, n = 1, where?: string): ChangelogEntry => ({ version, date: '2026-10-06', changes: Array.from({ length: n }, (_, i) => `${version} 줄${i + 1}`), ...(where ? { where } : {}) });
const list = [E('0.8.12-preview', 3), E('0.9.0-preview', 5, '#/settings/about'), E('0.8.13-preview', 5, '#/stats'), E('0.0.1')];

describe('D-055 업데이트 안내 (CHANGELOG)', () => {
  it('버전 비교: 꼬리표 무시, 숫자 자리별', () => {
    expect(cmpVersion('0.9.0-preview', '0.8.13-preview')).toBeGreaterThan(0);
    expect(cmpVersion('0.8.9-preview', '0.8.13-preview')).toBeLessThan(0);
    expect(cmpVersion('0.9.0', '0.9.0-preview')).toBe(0);
    expect(cmpVersion('1.0', '0.99.99')).toBeGreaterThan(0);
  });
  it('마지막 본 버전(제외) ~ 지금(포함), 최신 먼저', () => {
    expect(entriesSince(list, '0.8.12-preview', '0.9.0-preview').map((e) => e.version)).toEqual(['0.9.0-preview', '0.8.13-preview']);
    expect(entriesSince(list, '0.9.0-preview', '0.9.0-preview')).toEqual([]);
    expect(previousVersion(list, '0.9.0-preview')).toBe('0.8.13-preview');
  });
  it('시작 판단: 처음 설치는 안 띄우고 저장만, 기록 있는 예전 사용자는 바로 앞 버전 이후, 같은 버전은 안 띄움', () => {
    expect(whatsNewDecision(null, '0.9.0-preview', false, list)).toEqual({ show: false, store: '0.9.0-preview' });
    expect(whatsNewDecision(null, '0.9.0-preview', true, list)).toEqual({ show: true, since: '0.8.13-preview', store: '0.9.0-preview' });
    expect(whatsNewDecision('0.8.12-preview', '0.9.0-preview', true, list)).toEqual({ show: true, since: '0.8.12-preview', store: '0.9.0-preview' });
    expect(whatsNewDecision('0.9.0-preview', '0.9.0-preview', true, list)).toEqual({ show: false, store: '0.9.0-preview' });
    // 미리 보기 판에서 더 새 버전을 본 뒤 본판(옛 버전)을 열어도 되돌려 저장하지 않음
    expect(whatsNewDecision('0.9.1-preview', '0.9.0-preview', true, list)).toEqual({ show: false, store: '0.9.1-preview' });
  });
  it('최대 8줄 + 남은 줄 수', () => {
    const r = whatsNewLines(entriesSince(list, '0.8.12-preview', '0.9.0-preview'), 8);
    expect(r.entries.map((x) => x.lines.length)).toEqual([5, 3]);
    expect(r.more).toBe(2);
    expect(whatsNewLines(entriesSince(list, '0.8.12-preview', '0.9.0-preview'), Infinity).more).toBe(0);
  });
  it('version.json: 맨 위 항목, 바뀐 점 최대 5줄, 버전이 다르면 오류', () => {
    const big = [{ ...E('1.0.0', 7, '#/plan') }];
    expect(buildVersionInfo('1.0.0', big)).toEqual({ version: '1.0.0', date: '2026-10-06', changes: big[0]!.changes.slice(0, 5), where: '#/plan' });
    expect(() => buildVersionInfo('1.0.1', big)).toThrow();
  });
  it('받은 version.json 은 모양 검사 (D-025): 이상한 값은 버림', () => {
    expect(parseVersionInfo(null)).toBeUndefined();
    expect(parseVersionInfo({ version: 'abc' })).toBeUndefined();
    expect(parseVersionInfo({ version: '0.9.1-preview', date: '2026-10-07', changes: ['a', 3, 'b'], where: 'javascript:alert(1)' })).toEqual({ version: '0.9.1-preview', date: '2026-10-07', changes: ['a', 'b'] });
    expect(parseVersionInfo({ version: '0.9.1', changes: ['x'], where: '#/stats' })?.where).toBe('#/stats');
  });
  it('where → 탭', () => {
    expect(tabOfPath('#/stats')).toBe('stats');
    expect(tabOfPath('#/settings/about')).toBe('settings');
    expect(tabOfPath('#/')).toBe('home');
    expect(tabOfPath('#/routines')).toBe('home');
    expect(tabOfPath('#/exercises/x')).toBe('exercises');
    expect(koDate('2026-10-06')).toBe('10월 6일');
  });
  it('실제 CHANGELOG.json: 맨 위 = 앱 버전 = package.json, where 는 해시 경로, 최신 먼저 정렬돼 있음', () => {
    const cl = JSON.parse(readFileSync('CHANGELOG.json', 'utf8')) as { versions: ChangelogEntry[] };
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(cl.versions[0]!.version).toBe(APP_VERSION);
    expect(pkg.version).toBe(APP_VERSION);
    expect(buildVersionInfo(pkg.version, cl.versions).version).toBe(APP_VERSION);
    for (const e of cl.versions) if (e.where) expect(e.where).toMatch(/^#\/[\w/-]*$/);
    for (let i = 1; i < cl.versions.length; i++) expect(cmpVersion(cl.versions[i - 1]!.version, cl.versions[i]!.version)).toBeGreaterThan(0);
  });
});

describe('D-055 검토 4·7: 새 기능 점은 where 마다, 그 화면을 열면 그 점만 지움', () => {
  it('올라온 버전들의 where (중복·이상한 값 제외)', () => {
    expect(wheresOf(entriesSince(list, '0.8.12-preview', '0.9.0-preview'))).toEqual(['#/settings/about', '#/stats']);
    expect(wheresOf([{ ...E('1.0.0'), where: 'javascript:x' }, E('1.0.1', 1, '#/plan'), E('1.0.2', 1, '#/plan')])).toEqual(['#/plan']);
  });
  it('설정만 열면 앱 정보 점은 그대로, 앱 정보를 열어야 지워짐. 기록 상세도 기록 탭 점을 지움', () => {
    const d = ['#/settings/about', '#/stats'];
    expect(clearVisited(d, '/settings')).toEqual(d);
    expect(clearVisited(d, '/settings/about')).toEqual(['#/stats']);
    expect(clearVisited(d, '/stats/w/abc')).toEqual(['#/settings/about']);
    expect(visits('#/', '/plan')).toBe(false);
    expect(visits('#/', '/')).toBe(true);
    expect(visits('#/routines', '/routines?hidden')).toBe(true);
    expect(visits('#/stats', '/statsx')).toBe(false);
  });
  it('점 위치: 탭 또는 설정 버튼', () => {
    expect([...dotTargets(['#/settings/about', '#/stats', '#/routines'])]).toEqual(['settings', 'stats', 'home']);
  });
  it('화면 표시 버전은 꼬리표 없이 (A5)', () => {
    expect(displayVersion('0.9.0-preview')).toBe('0.9.0');
    expect(displayVersion('1.2.3')).toBe('1.2.3');
  });
});

describe('D-055 검토 R1: 대기 서비스 워커가 생겼을 때', () => {
  it('서버 버전이 지금 버전 이하면 조용히 (배너·새로 고침 없음), 더 새로우면 배너, 못 읽으면 배너', () => {
    expect(waitingDecision('0.9.0-preview', '0.9.0-preview')).toBe('silent');
    expect(waitingDecision('0.8.13-preview', '0.9.0-preview')).toBe('silent');
    expect(waitingDecision('0.9.1-preview', '0.9.0-preview')).toBe('banner');
    expect(waitingDecision(undefined, '0.9.0-preview')).toBe('banner');
  });
});

describe('D-055 3차 지적: 조용한 교체 뒤 새로 고침 건너뛰기는 그 워커일 때만', () => {
  it('같은 워커만 true, 다른 워커·없음은 false', () => {
    const a = { id: 'a' }; const b = { id: 'b' };
    expect(skipReloadFor(a, a)).toBe(true);
    expect(skipReloadFor(a, b)).toBe(false);
    expect(skipReloadFor(null, a)).toBe(false);
    expect(skipReloadFor(a, null)).toBe(false);
  });
});
