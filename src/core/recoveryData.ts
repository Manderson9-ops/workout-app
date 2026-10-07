/**
 * D-057 회복 근거 DB 형식과 정렬·거르기 (순수 함수). 데이터는 data/recovery_papers.json · recovery_rules.json (tools/recovery_import.mjs 로 만듦)
 */
export interface Paper {
  id: string; authors: string; year: number; title: string; journal: string;
  doi?: string; pmid?: string; url: string;
  type: string; evidence_level: 'A' | 'B' | 'C' | string; topics: string[]; key_findings: string[];
  citation_count: number; citation_source: string; citation_checked: string;
}
export interface Rule { id: string; text: string; papers: string[]; label: string; app_use: string; conflict: string }

/** 인용순: 인용 수 많은 순, 같으면 최신, 같으면 ID */
export const byCitation = (ps: readonly Paper[]): Paper[] => [...ps].sort((a, b) => b.citation_count - a.citation_count || b.year - a.year || a.id.localeCompare(b.id));
/** 최신순: 연도 최신 순, 같으면 인용 수, 같으면 ID */
export const byRecent = (ps: readonly Paper[]): Paper[] => [...ps].sort((a, b) => b.year - a.year || b.citation_count - a.citation_count || a.id.localeCompare(b.id));

/** 주제 목록 (논문 수 많은 순, 같으면 가나다) */
export function topicsOf(ps: readonly Paper[]): { topic: string; n: number }[] {
  const m = new Map<string, number>();
  for (const p of ps) for (const t of p.topics) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n || a.topic.localeCompare(b.topic));
}

/** 거르기: 주제 또는 규칙(그 규칙의 근거 논문) */
export function filterPapers(ps: readonly Paper[], f: { topic?: string; rule?: Rule }): Paper[] {
  return ps.filter((p) => (f.topic ? p.topics.includes(f.topic) : true) && (f.rule ? f.rule.papers.includes(p.id) : true));
}

/** 라벨 안의 두 갈래: "연구 근거" / "앱 판단 추정" 이 들어 있는지 (배지용, 라벨 글은 그대로 보여 줌) */
export function labelKinds(label: string): ('연구 근거' | '앱 판단 추정')[] {
  return (['연구 근거', '앱 판단 추정'] as const).filter((k) => label.includes(k));
}

/** 논문 짧은 이름: "Thomas 2018" */
export const shortRef = (p: Pick<Paper, 'authors' | 'year'>): string => `${p.authors.split(',')[0]!.trim().split(' ')[0]} ${p.year}`;

/** DOI 주소 (없으면 url) */
export const paperHref = (p: Pick<Paper, 'doi' | 'url'>): string => (p.doi ? `https://doi.org/${p.doi}` : p.url);

/** 단백질 하루 목표 (AR-11): 1.6 g/kg, 범위 1.4~2.2 (반올림 g) */
export function proteinTarget(kg: number): { target: number; low: number; high: number } {
  return { target: Math.round(kg * 1.6), low: Math.round(kg * 1.4), high: Math.round(kg * 2.2) };
}
