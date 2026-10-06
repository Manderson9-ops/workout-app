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

/** "2026-10-06" → "10월 6일" */
export function koDate(d: string): string {
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : d;
}
