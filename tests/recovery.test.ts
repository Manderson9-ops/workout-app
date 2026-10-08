import { describe, it, expect } from 'vitest';
import papersFile from '../data/recovery_papers.json';
import rulesFile from '../data/recovery_rules.json';
import { recoveryByPart, estimateHours, statusOf, sortedRecovery, recoveryLine, agoText, busyParts, CAP_H, topicJosa, splitRecent, evidenceIds } from '../src/core/recovery';
import { byCitation, byRecent, topicsOf, filterPapers, labelKinds, shortRef, paperHref, proteinTarget, isWeakLabel } from '../src/core/recoveryData';
import type { Paper, Rule } from '../src/core/recoveryData';
import type { Workout, SetLog } from '../src/core/session';
import type { Part } from '../src/core/types';

const H = 3_600_000;
const byId = new Map<string, { part: Part }>([['squat', { part: '하체' }], ['bench', { part: '가슴' }], ['row', { part: '등' }], ['curl', { part: '이두' }]]);
const set = (o: Partial<SetLog> = {}): SetLog => ({ weight: 50, reps: 8, warmup: false, done: true, ...o });
function wk(id: string, endIso: string, items: [string, SetLog[]][], extra: Partial<Workout> = {}): Workout {
  return {
    id, name: id, startedAt: new Date(Date.parse(endIso) - H).toISOString(), endedAt: endIso, timer: null,
    blocks: items.map(([ex, sets]) => ({ kind: 'single', items: [{ exerciseId: ex, target: { sets: sets.length, reps: 8 }, sets }], restSec: 90, roundRestSec: 120, transitionSec: 10 })),
    ...extra,
  } as Workout;
}
const n = (k: number, o: Partial<SetLog> = {}) => Array.from({ length: k }, () => set(o));

describe('D-057 회복 추정: 계산', () => {
  it('기본 48 · 10세트 이상 72 · 실패 +24 · 상한 72 (연구 추적 범위)', () => {
    expect(estimateHours(4, 0)).toBe(48);
    expect(estimateHours(10, 0)).toBe(72);
    expect(estimateHours(4, 1)).toBe(72);
    expect(estimateHours(12, 2)).toBe(96); // 계산값
    expect(CAP_H).toBe(72);
  });
  it('상태: 지남 ≥ 추정 = 회복됨, ≥ 75% = 거의, 나머지 회복 중', () => {
    expect(statusOf(48, 48)).toBe('recovered');
    expect(statusOf(36, 48)).toBe('almost');
    expect(statusOf(35.9, 48)).toBe('recovering');
  });
});

describe('D-057 회복 추정: 기록에서 부위별', () => {
  const end = '2026-10-08T10:00:00.000Z';
  const t0 = Date.parse(end);
  it('기록 없음 → 빈 결과, 홈 줄 없음', () => {
    const m = recoveryByPart([], byId, t0);
    expect(m.size).toBe(0);
    expect(recoveryLine(sortedRecovery(m))).toBe('');
  });
  it('하체 12세트 + 실패 1 → 계산 96, 보이는 추정 72(상한), 20시간 뒤 남은 52시간 회복 중, 규칙 ID', () => {
    const m = recoveryByPart([wk('a', end, [['squat', [...n(11), set({ rir: 0 })]], ['bench', n(3, { rir: 2 })]])], byId, t0 + 20 * H);
    const r = m.get('하체')!;
    expect(r).toMatchObject({ sets: 12, failSets: 1, rawH: 96, estimateH: 72, overCap: true, remainingH: 52, status: 'recovering' });
    expect(r.rules).toEqual(['AR-01', 'AR-05', 'AR-19', 'AR-03', 'AR-02']);
    expect(m.get('가슴')).toMatchObject({ sets: 3, failSets: 0, estimateH: 48, overCap: false, remainingH: 28, status: 'recovering' });
    expect(recoveryLine(sortedRecovery(m))).toBe('회복 중: 하체(약 52시간), 가슴(약 28시간)');
  });
  it('80시간 뒤 → 모두 회복됨', () => {
    const m = recoveryByPart([wk('a', end, [['squat', n(12, { rir: 0 })]])], byId, t0 + 80 * H);
    expect(m.get('하체')).toMatchObject({ status: 'recovered', remainingH: 0 });
    expect(recoveryLine(sortedRecovery(m))).toBe('회복됨: 하체');
  });
  it('웜업·안 끝낸 세트는 안 셈, RIR 0 만 실패, 세트 0인 부위는 없음', () => {
    const m = recoveryByPart([wk('a', end, [['squat', [set({ warmup: true, rir: 0 }), set({ done: false, rir: 0 }), set({ rir: 1 })]], ['curl', [set({ done: false })]]])], byId, t0);
    expect(m.get('하체')).toMatchObject({ sets: 1, failSets: 0, estimateH: 48 });
    expect(m.has('이두')).toBe(false);
  });
  it('여러 세션: 그 부위의 가장 최근 세션 하나로 (단순화), 다른 부위는 각자 최근', () => {
    const old = wk('old', '2026-10-07T10:00:00.000Z', [['squat', n(12)], ['row', n(4)]]);
    const neu = wk('new', end, [['squat', n(3)]]);
    const m = recoveryByPart([old, neu], byId, t0 + H);
    expect(m.get('하체')).toMatchObject({ workoutId: 'new', sets: 3, estimateH: 48, remainingH: 47 });
    expect(m.get('등')).toMatchObject({ workoutId: 'old', remainingH: 23 });
  });
  it('안 끝난 운동·완료 세트 0 운동·늦게 온 사본·지금보다 나중 기록은 뺌', () => {
    const live = wk('live', end, [['squat', n(5)]], { endedAt: undefined });
    const zero = wk('zero', end, [['squat', n(3, { done: false })]]);
    const late = wk('late', end, [['squat', n(5)]], { pendingMerge: 'x' });
    const future = wk('fut', '2026-10-09T10:00:00.000Z', [['squat', n(5)]]);
    expect(recoveryByPart([live, zero, late, future], byId, t0 + H).size).toBe(0);
  });
  it('시간대: 같은 순간을 다른 시간대로 적어도 결과가 같음', () => {
    const a = recoveryByPart([wk('a', '2026-10-08T19:00:00+09:00', [['bench', n(4)]])], byId, t0 + 10 * H);
    const b = recoveryByPart([wk('a', '2026-10-08T10:00:00Z', [['bench', n(4)]])], byId, t0 + 10 * H);
    expect(a.get('가슴')!.remainingH).toBe(38);
    expect(b.get('가슴')!.remainingH).toBe(38);
  });
  it('정렬·바쁜 부위·몇 시간 전', () => {
    const m = recoveryByPart([wk('a', end, [['squat', n(12)], ['bench', n(3)], ['curl', n(2)]])], byId, t0 + 40 * H);
    expect(sortedRecovery(m).map((r) => `${r.part}:${r.status}`)).toEqual(['하체:recovering', '가슴:almost', '이두:almost']);
    expect(busyParts(m, ['하체', '등', '가슴']).map((r) => r.part)).toEqual(['하체', '가슴']);
    expect([agoText(0.5), agoText(20.7), agoText(80)]).toEqual(['방금', '약 20시간 전', '3일 전']);
    expect([topicJosa('가슴'), topicJosa('하체'), topicJosa('등'), topicJosa('전완·악력')]).toEqual(['가슴은', '하체는', '등은', '전완·악력은']);
  });
});

describe('D-057 근거 DB 데이터', () => {
  const papers = papersFile.papers as Paper[];
  const rules = rulesFile.rules as Rule[];
  const ids = new Set(papers.map((p) => p.id));
  it('논문 10편 이상, 모두 DOI 또는 주소, 인용 수·출처·날짜, 핵심 결과', () => {
    expect(papers.length).toBeGreaterThanOrEqual(10);
    for (const p of papers) {
      expect(p.doi || p.url, p.id).toBeTruthy();
      expect(paperHref(p)).toMatch(/^https:\/\//);
      expect(typeof p.citation_count).toBe('number');
      expect(p.citation_source).toBeTruthy();
      expect(p.citation_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.key_findings.length).toBeGreaterThan(0);
      expect(['A', 'B', 'C']).toContain(p.evidence_level);
    }
    expect(ids.size).toBe(papers.length);
  });
  it('규칙 19개, 모든 근거 ID가 논문에 있음, 라벨은 연구 근거/앱 판단 추정 중 하나 이상', () => {
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 19 }, (_, i) => `AR-${String(i + 1).padStart(2, '0')}`));
    for (const r of rules) {
      expect(r.papers.length, r.id).toBeGreaterThan(0);
      for (const id of r.papers) expect(ids.has(id), `${r.id} → ${id}`).toBe(true);
      expect(labelKinds(r.label).length, r.id).toBeGreaterThan(0);
    }
    expect(labelKinds(rules.find((r) => r.id === 'AR-16')!.label)).toEqual(['앱 판단 추정']);
    expect(labelKinds(rules.find((r) => r.id === 'AR-01')!.label)).toEqual(['연구 근거', '앱 판단 추정']);
  });
  it('공개 사본: 대상·한계·검증 목록은 없음, 수면 −7.6% 수치는 어디에도 없음', () => {
    const all = JSON.stringify(papersFile) + JSON.stringify(rulesFile);
    expect(all).not.toMatch(/7\.6\s*%/);
    for (const p of papers as unknown as Record<string, unknown>[]) { expect(p.limitations).toBeUndefined(); expect(p.verified_by).toBeUndefined(); expect(p.population).toBeUndefined(); }
  });
  it('정렬: 인용순·최신순, 주제·규칙 거르기, 짧은 이름, 단백질', () => {
    const c = byCitation(papers);
    for (let i = 1; i < c.length; i++) expect(c[i - 1]!.citation_count).toBeGreaterThanOrEqual(c[i]!.citation_count);
    const r = byRecent(papers);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.year).toBeGreaterThanOrEqual(r[i]!.year);
    const fake = [{ id: 'X1', year: 2020, citation_count: 5, topics: ['a'] }, { id: 'X2', year: 2020, citation_count: 5, topics: ['a', 'b'] }] as unknown as Paper[];
    expect(byCitation(fake).map((p) => p.id)).toEqual(['X1', 'X2']); // 같으면 ID
    expect(topicsOf(fake)).toEqual([{ topic: 'a', n: 2 }, { topic: 'b', n: 1 }]);
    expect(filterPapers(papers, { topic: '세트 간 휴식' }).length).toBeGreaterThanOrEqual(3);
    const ar07 = rules.find((x) => x.id === 'AR-07')!;
    expect(filterPapers(papers, { rule: ar07 }).map((p) => p.id).sort()).toEqual([...ar07.papers].sort());
    expect(shortRef({ authors: 'Thomas K, Brownstein CG', year: 2018 })).toBe('Thomas 2018');
    expect(proteinTarget(75)).toEqual({ target: 120, low: 105, high: 165 });
  });
});

describe('D-057 검토 F4·F6·메모', () => {
  const end = '2026-10-08T10:00:00.000Z';
  const t0 = Date.parse(end);
  it('최근 14일 안에 한 부위만 목록에, 나머지는 기록 없는 부위', () => {
    const old = wk('old', '2026-09-20T10:00:00.000Z', [['row', n(4)]]);
    const neu = wk('new', end, [['squat', n(3)]]);
    const { recent, staleParts } = splitRecent(sortedRecovery(recoveryByPart([old, neu], byId, t0 + H)));
    expect(recent.map((r) => r.part)).toEqual(['하체']);
    expect(staleParts).toContain('등');
    expect(staleParts).not.toContain('하체');
    // 정확히 14일은 포함, 넘으면 빠짐
    const edge = recoveryByPart([wk('e', end, [['bench', n(3)]])], byId, t0 + 14 * 24 * H);
    expect(splitRecent([...edge.values()]).recent).toHaveLength(1);
    expect(splitRecent([...recoveryByPart([wk('e', end, [['bench', n(3)]])], byId, t0 + 14 * 24 * H + 1).values()]).recent).toHaveLength(0);
  });
  it('근거 ID는 실제로 쓴 규칙에서 (중복 없이 번호 순)', () => {
    const papersOf = (id: string) => (rulesFile.rules as Rule[]).find((r) => r.id === id)!.papers;
    expect(evidenceIds(['AR-01', 'AR-05', 'AR-19'], papersOf)).toEqual({ rules: ['AR-01', 'AR-05', 'AR-19'], papers: ['R-01', 'R-02', 'R-03', 'R-07', 'R-08', 'R-23'] });
    expect(evidenceIds(['AR-01', 'AR-02', 'AR-01'], papersOf).papers).toEqual(['R-01', 'R-02', 'R-03', 'R-04', 'R-05']);
  });
  it('라벨에 약한·약함이 있으면 근거 약함', () => {
    const rules = rulesFile.rules as Rule[];
    expect(rules.filter((r) => isWeakLabel(r.label)).map((r) => r.id)).toEqual(expect.arrayContaining(['AR-12', 'AR-16']));
    expect(isWeakLabel(rules.find((r) => r.id === 'AR-11')!.label)).toBe(false);
  });
});

