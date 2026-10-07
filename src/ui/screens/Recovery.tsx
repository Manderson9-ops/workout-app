/**
 * D-057 회복 팁(#/recovery)과 근거 논문 DB(#/recovery/papers). 처음 열 때 받는 화면 묶음 (논문 데이터는 첫 화면 묶음에 안 들어감).
 * 규칙 글·라벨·상충은 docs/research/운동회복_논문DB.md 그대로 (data/recovery_rules.json). 제목 한 줄과 계산만 앱이 씀
 */
import { useState } from 'preact/hooks';
import papersFile from '../../../data/recovery_papers.json';
import type { AppState } from '../store';
import type { Paper, Rule } from '../../core/recoveryData';
import { byCitation, byRecent, topicsOf, filterPapers, labelKinds, shortRef, paperHref, proteinTarget } from '../../core/recoveryData';
import { RULES, ruleById } from '../recoveryDb';
import { ScreenHeader } from '../header';
import { Metric } from '../components';
import { Icon } from '../icons';

const PAPERS = (papersFile as { papers: Paper[] }).papers;
const paperById = new Map(PAPERS.map((p) => [p.id, p]));
const back = { label: '뒤로', onClick: () => history.back(), aria: '뒤로' };

/** 팁 카드 (D-057 app_use=팁: AR-04, AR-09~16). 제목은 앱이 붙인 한 줄 요약 */
export const TIP_TITLES: Record<string, string> = {
  'AR-04': '낯선 운동·오랜만이면 천천히',
  'AR-09': '잠을 못 잔 날',
  'AR-10': '잠은 충분히',
  'AR-11': '단백질 하루 목표',
  'AR-12': '단백질 나눠 먹기',
  'AR-13': '근육을 키우려면 운동 직후 냉수욕은 피하기',
  'AR-14': '근육통 줄이기',
  'AR-15': '세트는 1~3회 남기고 (RIR 1~3)',
  'AR-16': '디로드 (가볍게 하는 주) 제안',
};
/** 단정하지 않게 (D-057 2차 검증): "근거 없음" → "이 DB 범위에서는 근거가 없어요" */
const soften = (s: string) => s.replace('운동 몇 시간 뒤 냉수욕의 영향은 근거 없음', '이 DB 범위에서는 운동 몇 시간 뒤 냉수욕 근거가 없어요');

function LabelChips({ r }: { r: Rule }) {
  return <>{labelKinds(r.label).map((k) => <span key={k} class={`lbl-chip ${k === '연구 근거' ? 'research' : 'app'}`}>{k}</span>)}</>;
}
function RefChips({ r }: { r: Rule }) {
  return (
    <div class="ref-chips" aria-label={`${r.id} 근거 논문`}>
      {r.papers.map((id) => { const p = paperById.get(id); return p ? <a key={id} href={`#/recovery/papers?rule=${r.id}`} aria-label={`${id} ${shortRef(p)} 근거 보기`}>{id} · {shortRef(p)}</a> : null; })}
    </div>
  );
}

function ProteinBox({ s }: { s: AppState }) {
  const last = [...s.bodyweight].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last) {
    return <p class="rec-note" role="note"><Icon name="info" size={18} /><span>체중을 기록하면 계산해 드려요 (기록 탭 → 체중). 하루 1.6 g/kg, 여유 범위 1.4~2.2 g/kg</span></p>;
  }
  const t = proteinTarget(last.kg);
  return (
    <div class="metrics2" data-testid="protein-box">
      <Metric label={`하루 목표 (체중 ${last.kg}kg × 1.6)`} value={t.target} unit="g" status={`${last.date} 체중 기준`} />
      <Metric label="여유 범위 (1.4~2.2 g/kg)" parts={[[t.low, 'g'], [`~${t.high}`, 'g']]} status="연구 근거 범위" />
    </div>
  );
}

export function RecoveryTips({ s }: { s: AppState }) {
  const tips = Object.keys(TIP_TITLES).map((id) => ruleById(id)).filter((r): r is Rule => !!r);
  return (
    <main>
      <ScreenHeader back={back} title="회복 팁" />
      <p class="sub small">근거 논문 {PAPERS.length}편에서 고른 팁이에요. 배지: <span class="lbl-chip research">연구 근거</span> 논문 수치가 직접 뒷받침 · <span class="lbl-chip app">앱 판단 추정</span> 방향은 맞지만 수치·적용은 앱이 정한 보수적 추정</p>
      {tips.map((r) => (
        <section class="card tip-card" key={r.id} aria-label={TIP_TITLES[r.id]} data-testid={`tip-${r.id}`}>
          <h2>{TIP_TITLES[r.id]}</h2>
          <div class="rule-head"><span class="sub small">{r.id}</span><LabelChips r={r} /></div>
          {r.id === 'AR-11' && <ProteinBox s={s} />}
          <p>{soften(r.text)}</p>
          {r.id === 'AR-13' && <p class="sub small">이 DB 범위에서는 운동 몇 시간 뒤 냉수욕 근거가 없어요. 시합·통증 관리 목적이면 써도 돼요.</p>}
          <p class="sub small">라벨: {r.label}</p>
          {r.conflict && <p class="sub small"><strong>주의·상충:</strong> {soften(r.conflict)}</p>}
          <RefChips r={r} />
        </section>
      ))}
      <a class="card row-link" href="#/recovery/papers"><Icon name="info" /><span class="grow"><span class="rl-title">근거 논문 전체 보기</span><span class="sub rl-sub">{PAPERS.length}편 · 인용순·최신순</span></span><Icon name="chevron" size={18} /></a>
    </main>
  );
}

const SOURCE_SHORT = (s: string) => (/semantic scholar/i.test(s) ? 'Semantic Scholar' : s);

function PaperItem({ p }: { p: Paper }) {
  return (
    <article class="card paper" data-testid="paper" aria-label={`${p.id} ${shortRef(p)}`}>
      <div class="paper-meta">
        <span class="ev-badge" title="근거 수준 (A 체계적 고찰·메타분석 등, B 실험, C 리뷰·합의·설문)">근거 {p.evidence_level}</span>
        <span class="sub small">{p.type}</span>
        <span class="sub small">{p.id}</span>
      </div>
      <p class="paper-title" lang="en">{p.title}</p>
      <p class="sub small" lang="en">{shortRef(p)} · {p.journal}</p>
      <p class="sub small" data-testid="cite">인용 {p.citation_count.toLocaleString()} · {SOURCE_SHORT(p.citation_source)} · {p.citation_checked} 확인</p>
      <details>
        <summary>핵심 결과 ({p.key_findings.length})</summary>
        <ul>{p.key_findings.map((k, i) => <li key={i}>{k}</li>)}</ul>
        <p class="sub small" lang="en">{p.authors}</p>
      </details>
      <a class="ext-link small" href={paperHref(p)} target="_blank" rel="noopener noreferrer">{p.doi ? `DOI ${p.doi}` : '원문 보기'} <Icon name="chevron" size={14} /></a>
    </article>
  );
}

export function RecoveryPapers({ query }: { query: string }) {
  const q = new URLSearchParams(query);
  const [sort, setSort] = useState<'cite' | 'recent'>('cite');
  const [topic, setTopic] = useState<string>(q.get('topic') ?? '');
  const rule = q.get('rule') ? ruleById(q.get('rule')!) : undefined;
  const list = filterPapers(sort === 'cite' ? byCitation(PAPERS) : byRecent(PAPERS), { ...(topic ? { topic } : {}), ...(rule ? { rule } : {}) });
  const topics = topicsOf(PAPERS);
  return (
    <main>
      <ScreenHeader back={back} title="근거 논문" />
      <p class="sub small">운동 회복 연구 {PAPERS.length}편 (저항운동). 인용 수는 Semantic Scholar 한 곳 기준이라 Google Scholar 와 다를 수 있어요.</p>
      {rule && (
        <div class="rule-box" data-testid="rule-filter">
          <div class="rule-head"><strong>{rule.id}</strong><LabelChips r={rule} /><a class="ev-link small" href="#/recovery/papers">모두 보기</a></div>
          <p class="small">{soften(rule.text)}</p>
        </div>
      )}
      <div class="seg sort-seg" role="group" aria-label="정렬">
        <button class={sort === 'cite' ? 'on' : ''} aria-pressed={sort === 'cite'} onClick={() => setSort('cite')}>인용순</button>
        <button class={sort === 'recent' ? 'on' : ''} aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>최신순</button>
      </div>
      {!rule && (
        <div class="topic-row" role="group" aria-label="주제로 거르기">
          <button class={`chip ${!topic ? 'on' : ''}`} aria-pressed={!topic} onClick={() => setTopic('')}>전체</button>
          {topics.map((t) => <button key={t.topic} class={`chip ${topic === t.topic ? 'on' : ''}`} aria-pressed={topic === t.topic} onClick={() => setTopic(t.topic)}>{t.topic} {t.n}</button>)}
        </div>
      )}
      <p class="sub small" aria-live="polite" data-testid="paper-count">{list.length}편{topic ? ` · 주제 ${topic}` : ''}</p>
      {list.map((p) => <PaperItem key={p.id} p={p} />)}
      <p class="sub small">규칙 {RULES.length}개 중 앱 동작에 쓰는 것: 회복 상태 AR-01·02·03·05·19, 플랜 안내 AR-01, 팁 AR-04·09~16. 나머지는 이 화면에만 보여요.</p>
    </main>
  );
}
