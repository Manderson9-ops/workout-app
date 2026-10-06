import { describe, expect, it } from 'vitest';
import { runImport, normalizeName } from '../src/core/wkImport';
import type { ImportInput, WkRecord } from '../src/core/wkImport';
import type { Exercise } from '../src/core/types';

const ex = (id: string, name_ko: string, family: string, extra: Partial<Exercise> = {}): Exercise => ({
  id, name_ko, family, part: '등', muscles: ['광배근'], pattern: 'V_PULL', mechanics: 'compound', equipment: ['cable'], ...extra,
});

function input(records: WkRecord[], patch: Partial<ImportInput> = {}): ImportInput {
  return {
    base: [
      ex('lat_pulldown', '랫풀다운', 'lat', { aliases: ['렛풀다운'] }),
      ex('assist', '어시스트 풀업 (머신)', 'pull'),
      ex('towel', '타월 풀업', 'pull'),
      ex('row_a', '체스트 서포티드 T바로우', 'sup'),
      ex('row_b', '캠 머신 로우', 'sup'),
    ],
    families: { lat: '랫풀', pull: '풀업', sup: '서포티드' },
    aliases: [
      { name: '어시스트 풀업 (피니셔)', exercise: 'assist', status: 'PENDING_MERGE', decision: 'M-01' },
      { name: '체스트 서포티드 로우', families: ['sup'], status: 'PROPOSED', decision: 'M-06' },
    ],
    topicParts: { back: '등' },
    rules: [{ video_id: 'v1', exercise: '타월 풀업', grade: 'A', purpose_part: '전완·악력', purpose_note: '악력' }],
    decisions: [
      { id: 'M-01', status: 'PENDING', title: '', proposal: '', while_pending: '' },
      { id: 'M-06', status: 'PENDING', title: '', proposal: '', while_pending: '' },
    ],
    templates: [{ id: 'full', name: '무분할', wk_names: ['무분할 (전신)'], per_week: '3', days: [['등']], generatable: true }],
    subGoalRules: [],
    combos: [],
    records,
    ...patch,
  };
}

const rec = (items: { exercise: string; grade: string; levels?: ('초보' | '중급' | '상급')[] }[], extra: Partial<WkRecord> = {}): WkRecord => ({
  video_id: 'v1', title: 't', channel: 'c', publish_date: '2026-01-01',
  tier_list: { key: 'back', topic: '등', items: items.map((i) => ({ ...i, why: 'w', timestamp: '01:00' })) }, ...extra,
});

describe('WORK_OUT_K 가져오기', () => {
  it('이름 정규화: 공백·가운뎃점·괄호 무시', () => {
    expect(normalizeName('랫 풀다운')).toBe(normalizeName('랫풀다운'));
    expect(normalizeName('어시스트 풀업 (머신)')).toBe('어시스트풀업머신');
  });
  it('이름 일치, 운동 별칭, 표기 차이 모두 연결', () => {
    const r = runImport(input([rec([{ exercise: '랫풀다운', grade: 'A+', levels: ['초보'] }, { exercise: '렛풀다운', grade: 'A', levels: ['상급'] }, { exercise: '랫 풀다운', grade: 'A' }])], { rules: [] }));
    expect(r.unresolved).toEqual([]);
    expect(r.grades.lat_pulldown!.map((g) => g.value)).toEqual(['A+', 'A', 'A']);
    expect(r.grades.lat_pulldown![0]!).toMatchObject({ purpose_part: '등', source: 'VIDEO', video_id: 'v1', timestamp: '01:00', primary_topic: true });
  });
  it('연결 실패는 unresolved (CLI는 exit 1)', () => {
    const r = runImport(input([rec([{ exercise: '없는 운동', grade: 'S' }])], { rules: [] }));
    expect(r.unresolved).toEqual(['[등] 없는 운동: 연결 실패 (별칭 없음)']);
  });
  it('합치기 결정 대기 항목은 미적용, 승인되면 적용', () => {
    const items = [{ exercise: '어시스트 풀업 (피니셔)', grade: 'B+' }];
    const pending = runImport(input([rec(items)]));
    expect(pending.unapplied).toHaveLength(1);
    expect(pending.grades.assist).toBeUndefined();
    const approved = runImport(input([rec(items)], { decisions: [{ id: 'M-01', status: 'APPROVED', title: '', proposal: '', while_pending: '' }, { id: 'M-06', status: 'PENDING', title: '', proposal: '', while_pending: '' }] }));
    expect(approved.grades.assist).toHaveLength(1);
    expect(approved.tierItemCount).toBe(1);
  });
  it('거절된 제안 별칭은 적용 안 함', () => {
    const kp = { key_points: [{ type: 'FORM_CUE', exercise: '체스트 서포티드 로우', text: 'x', timestamp: '00:10' }] };
    expect(Object.keys(runImport(input([rec([], kp)])).guides).sort()).toEqual(['row_a', 'row_b']);
    const rejected = runImport(input([rec([], kp)], { decisions: [{ id: 'M-01', status: 'PENDING', title: '', proposal: '', while_pending: '' }, { id: 'M-06', status: 'REJECTED', title: '', proposal: '', while_pending: '' }] }));
    expect(rejected.guides).toEqual({});
    expect(rejected.unapplied).toHaveLength(1);
  });
  it('항목별 규칙: 목적 부위와 세부 목표', () => {
    const r = runImport(input([rec([{ exercise: '타월 풀업', grade: 'A' }, { exercise: '타월 풀업', grade: 'D' }])]));
    expect(r.grades.towel!.map((g) => [g.value, g.purpose_part, g.purpose_note])).toEqual([['A', '전완·악력', '악력'], ['D', '등', undefined]]);
  });
  it('쓰이지 않은 규칙, 없는 결정 ID, 없는 family 이름은 오류', () => {
    expect(runImport(input([rec([])])).unresolved).toContain('[규칙 미사용] v1 타월 풀업 A');
    expect(() => runImport(input([rec([{ exercise: '체스트 서포티드 로우', grade: 'A' }])], { decisions: [] }))).toThrow('알 수 없는 결정 ID');
    expect(runImport(input([rec([])], { families: { lat: 'x', pull: 'y' }, rules: [] })).unresolved).toContain('[family 이름 없음] sup');
  });
  it('자세 포인트 규칙(guide_rules): 일반 이름이 묶음으로 풀려도 지정한 운동에만 붙음, 쓰이지 않거나 겹치지 않으면 오류 (M-30)', () => {
    const kp = (text: string, timestamp: string) => ({ type: 'FORM_CUE', body_part: 'BACK.LATS', exercise: '체스트 서포티드 로우', text, timestamp });
    const r1: WkRecord = { video_id: 'v1', title: 't', channel: 'c', publish_date: '2026-01-01', key_points: [kp('모든 서포티드 로우 공통', '01:00'), kp('T바 전용', '02:00')] };
    const base = { rules: [], decisions: [{ id: 'M-06', status: 'APPROVED' as const, title: '', proposal: '', while_pending: '' }, { id: 'M-30', status: 'APPROVED' as const, title: '', proposal: '', while_pending: '' }] };
    const none = runImport(input([r1], base));
    expect(none.guides.row_a!.length).toBe(2); expect(none.guides.row_b!.length).toBe(2);
    const ruled = runImport(input([r1], { ...base, guideRules: [{ video_id: 'v1', timestamp: '02:00', exercise: '체스트 서포티드 로우', only: ['row_a'], reason: 't', decision: 'M-30' }] }));
    expect(ruled.guides.row_a!.map((g) => g.timestamp)).toEqual(['01:00', '02:00']);
    expect(ruled.guides.row_b!.map((g) => g.timestamp)).toEqual(['01:00']);
    expect(ruled.unresolved).toEqual([]);
    expect(runImport(input([r1], { ...base, guideRules: [{ video_id: 'v1', timestamp: '09:00', only: ['row_a'], reason: 't' }] })).unresolved).toContain('[규칙 미사용] 자세 포인트 v1@09:00');
    expect(runImport(input([r1], { ...base, guideRules: [{ video_id: 'v1', timestamp: '02:00', only: ['lat_pulldown'], reason: 't' }] })).unresolved.some((u) => u.includes('겹치지 않음'))).toBe(true);
    expect(runImport(input([r1], { ...base, guideRules: [{ video_id: 'v1', timestamp: '02:00', only: ['nope'], reason: 't' }] })).unresolved.some((u) => u.includes('앱에 없는 운동 nope'))).toBe(true);
    // only 에 앱에는 있지만 이 항목의 연결 결과에 없는 운동이 있으면 조용히 무시하지 않고 알림
    expect(runImport(input([r1], { ...base, guideRules: [{ video_id: 'v1', timestamp: '02:00', only: ['row_a', 'lat_pulldown'], reason: 't' }] })).unresolved.some((u) => u.includes('lat_pulldown 은(는) 이 항목의 연결 결과'))).toBe(true);
    // 결정 상태: 대기(PENDING)는 '제안대로 적용'(다른 규칙과 같음), 거절(REJECTED)이면 규칙이 적용되지 않아 '규칙 미사용' 오류로 드러남 (조용히 잘못 붙지 않음)
    const withM30 = (status: 'PENDING' | 'REJECTED') => ({ rules: [], decisions: [{ id: 'M-06', status: 'APPROVED' as const, title: '', proposal: '', while_pending: '' }, { id: 'M-30', status, title: '', proposal: '', while_pending: '' }] });
    const gRule = [{ video_id: 'v1', timestamp: '02:00', only: ['row_a'], reason: 't', decision: 'M-30' }];
    const pending = runImport(input([r1], { ...withM30('PENDING'), guideRules: gRule }));
    expect(pending.guides.row_b!.map((g) => g.timestamp)).toEqual(['01:00']);
    expect(runImport(input([r1], { ...withM30('REJECTED'), guideRules: gRule })).unresolved).toContain('[규칙 미사용] 자세 포인트 v1@02:00');
  });
  it('참고용 표시는 같은 운동에 주제 영상 등급이 있을 때만', () => {
    const rules = [{ video_id: 'v1', exercise: '랫풀다운', grade: 'A', primary_topic: false }];
    const only = runImport(input([rec([{ exercise: '랫풀다운', grade: 'A' }])], { rules }));
    expect(only.grades.lat_pulldown![0]!.primary_topic).toBe(true);
    const both = runImport(input([rec([{ exercise: '랫풀다운', grade: 'A' }, { exercise: '랫풀다운', grade: 'S' }])], { rules }));
    expect(both.grades.lat_pulldown!.map((g) => g.primary_topic)).toEqual([false, true]);
  });
  it('분할 항목은 템플릿으로, 없는 템플릿·주제는 오류', () => {
    const split: WkRecord = { video_id: 'v2', title: '', channel: '', publish_date: '', tier_list: { key: 'split', topic: '분할', items: [{ exercise: '무분할 (전신)', grade: 'S', levels: ['초보'] }, { exercise: '없는 분할', grade: 'A' }], unrated: [{ exercise: '무분할 (전신)', text: 'n', timestamp: '1' }, { exercise: '없는 미평가', text: 'n', timestamp: '1' }] } };
    const other: WkRecord = { ...split, video_id: 'v3', tier_list: { key: 'legs', topic: '하체', items: [] } };
    const r = runImport(input([split, other], { rules: [] }));
    expect(r.templates[0]!.grades).toMatchObject([{ value: 'S', levels: ['초보'], wk_name: '무분할 (전신)' }]);
    expect(r.templates[0]!.notes).toHaveLength(1);
    expect(r.unresolved).toEqual(['[분할] 없는 분할', '[분할 미평가] 없는 미평가', '[주제] legs (topic_parts에 부위 매핑 없음)']);
  });
  it('추천 조합은 영상 미평가 항목과 운동이 모두 있어야 통과', () => {
    const recU = rec([], { tier_list: { key: 'back', topic: '등', items: [], unrated: [{ exercise: '2개만', text: '', timestamp: '1' }] } });
    const combos = [
      { id: 'ok', part: '등' as const, video_id: 'v1', wk_unrated: '2개만', timestamp: '1', exercises: ['lat_pulldown'], text: '' },
      { id: 'bad', part: '등' as const, video_id: 'v1', wk_unrated: '2개만', timestamp: '1', exercises: ['ghost'], text: '' },
    ];
    const r = runImport(input([recU], { combos, rules: [] }));
    expect(r.combos.map((c) => c.id)).toEqual(['ok']);
    expect(r.unresolved).toEqual(['[추천 조합] bad']);
  });
  it('기본 종목 이름이 정규화 후 겹치면 중단', () => {
    expect(() => runImport(input([], { base: [ex('a', '랫풀다운', 'lat'), ex('b', '랫 풀다운', 'lat')] }))).toThrow('이름 중복');
  });
  it('별칭 대상이 없으면 연결 실패', () => {
    const r = runImport(input([rec([{ exercise: 'X', grade: 'A' }, { exercise: 'Y', grade: 'A' }])], { rules: [], aliases: [{ name: 'X', exercise: 'ghost', status: 'CONFIRMED' }, { name: 'Y', families: ['none'], status: 'CONFIRMED' }] }));
    expect(r.unresolved).toEqual(['[등] X: 별칭 대상 운동 없음: ghost', '[등] Y: 별칭 대상 묶음 비어 있음']);
  });
});

describe('새 티어 반영용 규칙 (M-15~M-26, 2026-10-01)', () => {
  const fails = (r: { unresolved: string[] }) => r.unresolved.filter((x) => !x.startsWith('[규칙 미사용]'));
  it('운동이 아닌 주제는 등급으로 쓰지 않되 자세 포인트는 봄, 연결 실패도 아님 (M-25)', () => {
    const r = runImport(input([{ ...rec([{ exercise: '작은 키', grade: '망함' }]), tier_list: { key: 'genes', topic: '유전자', items: [{ exercise: '작은 키', grade: '망함' }] }, key_points: [{ type: 'tip', exercise: '랫풀다운', text: 'x', timestamp: '00:10' }] }], { ignoreTopics: ['genes'] }));
    expect(fails(r)).toEqual([]);
    expect(r.tierItemCount).toBe(0);
    expect(r.guides.lat_pulldown).toHaveLength(1);
  });
  it('매핑 없는 주제는 여전히 연결 실패로 알리고, 자세 포인트는 계속 봄', () => {
    const r = runImport(input([{ ...rec([]), tier_list: { key: 'neck', topic: '목', items: [{ exercise: '랫풀다운', grade: 'S' }] }, key_points: [{ type: 'tip', exercise: '랫풀다운', text: 'x', timestamp: '00:10' }] }]));
    expect(fails(r)).toEqual(['[주제] neck (topic_parts에 부위 매핑 없음)']);
    expect(r.guides.lat_pulldown).toHaveLength(1);
  });
  it('빼기로 한 티어 항목·이름은 미적용(반영 안 함)으로, 실패 아님', () => {
    const r = runImport(input([rec([{ exercise: '랫풀다운 (붐빌 때)', grade: 'B' }, { exercise: '랫풀다운', grade: 'S' }], { key_points: [{ type: 'tip', exercise: '잽', text: 'x', timestamp: '00:10' }] })], {
      skipItems: [{ video_id: 'v1', exercise: '랫풀다운 (붐빌 때)', grade: 'B', reason: '대안 설명' }], skipNames: [{ name: '잽', reason: '격투기' }],
    }));
    expect(fails(r)).toEqual([]);
    expect(r.unapplied.map((u) => u.reason)).toEqual(['반영 안 함: 대안 설명', '반영 안 함: 격투기']);
    expect(r.grades.lat_pulldown).toHaveLength(1);
  });
  it('쓰이지 않는 빼기 규칙은 알림(빌드 중단)', () => {
    const r = runImport(input([rec([{ exercise: '랫풀다운', grade: 'S' }])], { skipItems: [{ video_id: 'v1', exercise: '없는 항목', reason: 'x' }], skipNames: [{ name: '없는 이름', reason: 'y' }] }));
    expect(r.unresolved).toEqual(expect.arrayContaining(['[규칙 미사용] 빼기 v1 없는 항목', '[규칙 미사용] 빼기 이름 없는 이름']));
  });
  it('별칭이 여러 운동을 가리키면 모두에 등급 (M-21 해머·리버스 컬), 없는 운동이면 실패', () => {
    const r = runImport(input([rec([{ exercise: '두 로우', grade: 'B' }])], { aliases: [{ name: '두 로우', exercises: ['row_a', 'row_b'], status: 'CONFIRMED' }] }));
    expect(Object.keys(r.grades).sort()).toEqual(['row_a', 'row_b']);
    const bad = runImport(input([rec([{ exercise: '두 로우', grade: 'B' }])], { aliases: [{ name: '두 로우', exercises: ['row_a', 'ghost'], status: 'CONFIRMED' }] }));
    expect(bad.unresolved[0]).toContain('ghost');
  });
});
