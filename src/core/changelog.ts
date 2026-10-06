/**
 * 업데이트 안내 (D-055 디자인 시스템 3장 1단계): CHANGELOG.json 을 읽는 순수 함수.
 * - 버전 비교 (0.9.0-preview 같은 꼬리표는 무시하고 숫자만)
 * - "새로 바뀐 점": 마지막으로 본 버전(제외) ~ 지금 버전(포함), 최신 먼저
 * - version.json (빌드 때 dist 에 생성): 지금 버전·날짜·바뀐 점 최대 5줄·where
 */
export interface ChangelogEntry { version: string; date: string; changes: string[]; where?: string; feedback_ids?: string[]; decisions?: string[] }
export interface VersionInfo { version: string; date: string; changes: string[]; where?: string }

/** "0.9.0-preview" → [0, 9, 0] */
export function versionParts(v: string): number[] {
  return v.split('-')[0]!.split('.').map((x) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; });
}
/** a < b 이면 음수, 같으면 0, a > b 이면 양수 */
export function cmpVersion(a: string, b: string): number {
  const x = versionParts(a); const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}
/** 최신 먼저 정렬 */
export function sortedEntries(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => cmpVersion(b.version, a.version));
}
/** lastSeen(제외) 보다 새롭고 current(포함) 이하인 항목, 최신 먼저 */
export function entriesSince(entries: readonly ChangelogEntry[], lastSeen: string, current: string): ChangelogEntry[] {
  return sortedEntries(entries).filter((e) => cmpVersion(e.version, lastSeen) > 0 && cmpVersion(e.version, current) <= 0);
}
/** 지금 버전 바로 앞 버전 (기록이 있는데 마지막 본 버전이 없을 때 = 0.9.0 이전에서 올라온 사용자) */
export function previousVersion(entries: readonly ChangelogEntry[], current: string): string {
  return sortedEntries(entries).find((e) => cmpVersion(e.version, current) < 0)?.version ?? '0.0.0';
}

export type WhatsNewDecision = { show: false; store: string } | { show: true; since: string; store: string };
/**
 * 시작할 때 "새로 바뀐 점"을 띄울지.
 * - 마지막 본 버전이 없고 기록도 없음(처음 설치) → 띄우지 않고 지금 버전만 저장
 * - 마지막 본 버전이 없지만 기록이 있음(이 기능 전 버전에서 올라옴) → 바로 앞 버전 이후를 보여 줌
 * - 마지막 본 버전 < 지금 → 그 사이를 보여 줌
 */
export function whatsNewDecision(lastSeen: string | null, current: string, hasData: boolean, entries: readonly ChangelogEntry[]): WhatsNewDecision {
  if (!lastSeen) return hasData ? { show: true, since: previousVersion(entries, current), store: current } : { show: false, store: current };
  if (cmpVersion(lastSeen, current) < 0) return { show: true, since: lastSeen, store: current };
  return { show: false, store: lastSeen };
}

/**
 * 대기 서비스 워커가 생겼을 때 (D-055 검토 R1). 페이지는 화면(HTML)을 네트워크 먼저 받아 이미 새 코드로 돌고 있을 수 있음:
 * - 서버 version.json 이 지금 버전 이하 → 'silent': 배너 없이 조용히 새 워커로 바꾸고 새로 고치지 않음 (이미 그 버전)
 * - 더 새로움 → 'banner' ("새 버전 X 준비됨")
 * - 못 읽음 → 'banner' ("새 버전이 있어요", 지금과 같음)
 */
export function waitingDecision(remoteVersion: string | undefined, appVersion: string): 'banner' | 'silent' {
  if (!remoteVersion) return 'banner';
  return cmpVersion(remoteVersion, appVersion) > 0 ? 'banner' : 'silent';
}

/** controllerchange 때 새로 고침을 건너뛸지: 조용히 바꾼 워커가 있고, 지금 화면을 맡은 워커가 바로 그 워커일 때만 (같은 객체) */
export function skipReloadFor<T>(quiet: T | null | undefined, controller: T | null | undefined): boolean {
  return quiet != null && controller != null && quiet === controller;
}

/**
 * 처음 설치인지 (0.9.3 검토 R1): 이 화면을 맡은 워커도, 이미 활성인 워커도 없을 때만.
 * Shift+새로 고침처럼 화면은 안 맡았지만 활성 워커가 있으면 처음 설치가 아님 (그 뒤 [지금 적용]은 새로 고쳐야 함).
 * 설치 중(installing)이거나 대기(waiting)만 있고 활성이 없으면 아직 처음 설치.
 */
export function isFirstInstall(s: { controlled: boolean; hasActive: boolean }): boolean {
  return !s.controlled && !s.hasActive;
}

/**
 * controllerchange 때 할 일 (0.9.3 검토 R1):
 * - 'skip-quiet': 조용히 바꾼 그 워커 → 새로 고치지 않음
 * - 'skip-first': 처음 설치의 첫 맡기(claim) → 새로 고치지 않음 (화면은 이미 최신)
 * - 'reload': 새 버전으로 교체 → 새로 고침 (한 번만)
 * - 'none': 이미 새로 고치는 중
 */
export function controllerChangeAction(s: { quiet: boolean; firstInstall: boolean; firstClaimed: boolean; reloaded: boolean }): 'skip-quiet' | 'skip-first' | 'reload' | 'none' {
  if (s.quiet) return 'skip-quiet';
  if (s.firstInstall && !s.firstClaimed) return 'skip-first';
  return s.reloaded ? 'none' : 'reload';
}

/** 시트에 보일 줄 (최신 먼저, 최대 max 줄). 잘렸으면 more = 남은 줄 수 */
export function whatsNewLines(list: readonly ChangelogEntry[], max = 8): { entries: { e: ChangelogEntry; lines: string[] }[]; more: number } {
  let left = max; let total = 0;
  const out: { e: ChangelogEntry; lines: string[] }[] = [];
  for (const e of list) {
    total += e.changes.length;
    if (left <= 0) continue;
    const lines = e.changes.slice(0, left);
    left -= lines.length;
    out.push({ e, lines });
  }
  const shown = out.reduce((s, x) => s + x.lines.length, 0);
  return { entries: out, more: total - shown };
}

/** version.json 내용 (빌드 도구가 씀). 버전이 package.json 과 CHANGELOG 맨 위가 다르면 오류 */
export function buildVersionInfo(pkgVersion: string, entries: readonly ChangelogEntry[]): VersionInfo {
  const top = sortedEntries(entries)[0];
  if (!top || top.version !== pkgVersion) throw new Error(`CHANGELOG 맨 위 버전(${top?.version})이 package.json 버전(${pkgVersion})과 달라요`);
  return { version: top.version, date: top.date, changes: top.changes.slice(0, 5), ...(top.where ? { where: top.where } : {}) };
}

/** version.json 이 맞는 모양인지 (받은 파일은 데이터일 뿐, D-025). 아니면 undefined */
export function parseVersionInfo(x: unknown): VersionInfo | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+/.test(o.version) || o.version.length > 40) return undefined;
  const changes = Array.isArray(o.changes) ? o.changes.filter((c): c is string => typeof c === 'string').slice(0, 5).map((c) => c.slice(0, 300)) : [];
  const where = typeof o.where === 'string' && /^#\/[\w/-]*$/.test(o.where) ? o.where : undefined;
  return { version: o.version, date: typeof o.date === 'string' ? o.date.slice(0, 10) : '', changes, ...(where ? { where } : {}) };
}

/** 해시 경로 → 하단 탭 (새 기능 점을 붙일 곳). 탭이 아니면(설정 등) undefined */
export type TabId = 'home' | 'plan' | 'workout' | 'stats' | 'exercises';
export function tabOfPath(path: string): TabId | 'settings' | undefined {
  const p = path.replace(/^#/, '') || '/';
  if (p.startsWith('/plan')) return 'plan';
  if (p.startsWith('/workout')) return 'workout';
  if (p.startsWith('/stats')) return 'stats';
  if (p.startsWith('/exercises')) return 'exercises';
  if (p.startsWith('/settings') || p.startsWith('/tools')) return 'settings';
  if (p === '/' || p.startsWith('/routine')) return 'home';
  return undefined;
}

/**
 * 바뀐 점 한 줄 → 짧은 제목 + 나머지 (새로 바뀐 점 시트용). 첫 ':' 앞이 1~32자면 그것이 제목, 나머지는 설명.
 * ':' 가 없으면 32자 이하는 제목만, 더 길면 28자 안의 마지막 띄어쓰기까지 + '…' 제목에 나머지를 설명으로
 */
export function changeHeadline(line: string): { head: string; rest?: string } {
  const t = line.trim();
  const c = t.indexOf(':');
  if (c >= 1 && c <= 32) { const rest = t.slice(c + 1).trim(); return rest ? { head: t.slice(0, c).trim(), rest } : { head: t.slice(0, c).trim() }; }
  if (t.length <= 32) return { head: t };
  const cut = t.lastIndexOf(' ', 28);
  const at = cut >= 12 ? cut : 28;
  return { head: `${t.slice(0, at).trim()}…`, rest: t.slice(at).trim() };
}

/**
 * 새 기능 점 (D-055 검토 4·7): 올라온 버전들(마지막 본 버전 이후)의 where 마다 점을 하나씩 두고, 그 화면을 열면 그 점만 지운다.
 * where 는 '#/stats' 처럼 해시 경로. '#/settings/about' 은 설정 화면만 열어서는 안 지워지고 앱 정보를 열어야 지워짐
 */
export function wheresOf(entries: readonly ChangelogEntry[]): string[] {
  return [...new Set(entries.map((e) => e.where).filter((w): w is string => !!w && /^#\/[\w/-]*$/.test(w)))];
}
/** 그 화면(path, '#' 없이 '/stats/w/x' 모양)을 열면 지워지는 where 인가 */
export function visits(where: string, path: string): boolean {
  const w = where.replace(/^#/, '') || '/';
  const p = path.replace(/^#/, '') || '/';
  if (w === '/') return p === '/';
  return p === w || p.startsWith(`${w}/`) || p.startsWith(`${w}?`);
}
export function clearVisited(dots: readonly string[], path: string): string[] {
  return dots.filter((w) => !visits(w, path));
}
/** 점이 붙을 곳 (하단 탭 또는 설정 버튼) */
export function dotTargets(dots: readonly string[]): Set<TabId | 'settings'> {
  return new Set(dots.map((w) => tabOfPath(w)).filter((x): x is TabId | 'settings' => !!x));
}

/** 화면에 보이는 버전: 꼬리표(-preview 등)를 뺀 숫자만 (D-055 검토 A5). 판 구분은 "판: 본판/β 미리 보기" 칩으로만 */
export function displayVersion(v: string): string {
  return v.split('-')[0]!;
}

/** "2026-10-06" → "10월 6일" */
export function koDate(d: string): string {
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : d;
}
