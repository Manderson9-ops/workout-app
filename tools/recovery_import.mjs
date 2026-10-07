// D-057: 운동 회복 근거 DB(G:\내 드라이브\WORK_OUT_APP\docs\research)에서 앱용 공개 가능한 사본을 만든다.
// 실행: node tools/recovery_import.mjs [연구 폴더]
// - data/recovery_papers.json: 서지 정보 + 한국어 핵심 결과 + 근거 수준·종류 + 주제 + doi/pmid/url + 인용 수(출처·확인 날짜). 대상·한계·검증 URL 목록은 뺌
// - data/recovery_rules.json: 앱 규칙 후보 AR-01~19 (md 표 그대로: 규칙 글, 근거 ID, 라벨, app_use, 상충·주의)
// - 수면 메타분석의 "−7.6%" 수치는 앱에 보이지 않게 그 문장을 지움 (AR-09 주의 사항, 여러 운동 범주 합산 평균·이질성 큼)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'G:/내 드라이브/WORK_OUT_APP/docs/research';
const papers = JSON.parse(readFileSync(join(dir, 'recovery_papers.json'), 'utf8').replace(/^\uFEFF/, ''));
const md = readFileSync(join(dir, '운동회복_논문DB.md'), 'utf8').replace(/^\uFEFF/, '');

const noFigure = (s) => s.split(/(?<=[.)])\s+/).filter((x) => !/7\.6\s*%/.test(x)).join(' ').trim();
const unbold = (s) => s.replace(/\*\*/g, '');

const outPapers = papers.map((p) => ({
  id: p.id, authors: p.authors, year: p.year, title: p.title, journal: p.journal,
  ...(p.doi ? { doi: p.doi } : {}), ...(p.pmid ? { pmid: p.pmid } : {}), url: p.url,
  type: p.type, evidence_level: p.evidence_level, topics: p.topics,
  key_findings: p.key_findings.map(noFigure).filter(Boolean),
  citation_count: p.citation_count, citation_source: p.citation_source, citation_checked: p.citation_checked,
}));

const rows = md.split(/\r?\n/).filter((l) => /^\| AR-\d+ \|/.test(l));
const outRules = rows.map((l) => {
  const c = l.split('|').slice(1, -1).map((x) => x.trim());
  const [id, text, refs, label, appUse, conflict] = c;
  return {
    id, text: unbold(text), papers: [...refs.matchAll(/R-\d+/g)].map((m) => m[0]), label: unbold(label),
    app_use: unbold(appUse), conflict: conflict === '—' ? '' : noFigure(unbold(conflict)),
  };
});
if (outRules.length !== 19) throw new Error(`규칙 수가 이상해요: ${outRules.length}`);

const meta = { source: 'docs/research/recovery_papers.json · 운동회복_논문DB.md (D-057)', generated: new Date().toISOString().slice(0, 10) };
writeFileSync('data/recovery_papers.json', JSON.stringify({ ...meta, papers: outPapers }, null, 1) + '\n');
writeFileSync('data/recovery_rules.json', JSON.stringify({ ...meta, rules: outRules }, null, 1) + '\n');
console.log(`papers ${outPapers.length}, rules ${outRules.length}`);
