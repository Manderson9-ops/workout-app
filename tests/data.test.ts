import { describe, expect, it } from 'vitest';
import baseFile from '../data/exercises.base.json';
import familyFile from '../data/families.json';
import wkFile from '../data/exercises.workout_k.json';
import { buildExercises, eligibleParts, resolveGrade, validateExerciseData, defaultReps, equipmentAvailable, isHeavyHinge } from '../src/core/exercises';
import type { Exercise, BuiltExercise, GradeEntry } from '../src/core/types';
import { EQUIPMENT_RANK } from '../src/core/types';
import type { WorkoutKData } from '../src/core/exercises';

const base = baseFile.exercises as Exercise[];
const wk = wkFile as unknown as WorkoutKData;
const all = buildExercises(base, wk);
const get = (id: string) => all.find((e) => e.id === id)!;

describe('운동 데이터 검증', () => {
  it('오류 0건', () => {
    expect(validateExerciseData(base, familyFile.families, wk)).toEqual([]);
  });
  it('기본 종목 120개 이상(설계 약 120~150, 추가 여유 200까지), 8개 부위 모두 있음', () => {
    expect(base.length).toBeGreaterThanOrEqual(120);
    expect(base.length).toBeLessThanOrEqual(200);
    expect(new Set(base.map((e) => e.part)).size).toBe(8);
  });
  it('WORK_OUT_K 영상 등급 91개가 82개 운동에 연결, 미적용은 결정으로 뺀 것만 (M-15·16·22·24·26·31)', () => {
    expect(Object.keys(wk.grades).length).toBe(82);
    expect(Object.values(wk.grades).flat().length).toBe(91);
    const un = (wkFile as { unapplied: { reason: string }[] }).unapplied;
    expect(un.length).toBe(48);
    expect(un.every((u) => u.reason.startsWith('반영 안 함'))).toBe(true);
  });
  it('어깨 영상 등급 4개 (M-29·M-30): 영상에서 확정한 것만, 이름 연결은 별칭', () => {
    const g = (id: string) => wk.grades[id]!.map((x: { value: string }) => x.value);
    expect(g('machine_shoulder_press')).toEqual(['S']);
    expect(g('cable_rear_delt_fly')).toEqual(['S']); // M-29: 케이블 리버스 플라이 = 케이블 리어 델트 플라이
    expect(g('barbell_ohp')).toEqual(['B+']);
    expect(g('db_shoulder_press')).toEqual(['B+']);
    // 등급 글자가 자막에서 빠진 11개는 등급을 만들지 않음 (영상에 없는 등급은 만들지 않는다)
    for (const id of ['smith_shoulder_press', 'arnold_press', 'db_lateral_raise', 'cable_lateral_raise', 'machine_lateral_raise', 'reverse_pec_deck', 'face_pull']) expect(wk.grades[id]).toBeUndefined();
  });
  it('분할 템플릿 8개, 추천 조합 1개', () => {
    expect(wk.templates.length).toBe(8);
    expect(wk.combos.length).toBe(1);
  });
});

describe('검증 함수가 오류를 잡는지', () => {
  const bad = (patch: Partial<Exercise>) => [{ ...base[0]!, ...patch } as Exercise];
  const empty: WorkoutKData = { grades: {}, guides: {}, templates: [], combos: [] };
  const fam = { chest_press_flat: 'x' };
  it('잘못된 값들', () => {
    expect(validateExerciseData(bad({ id: 'Bad Id' }), fam, empty)).toContain('id 형식: Bad Id');
    expect(validateExerciseData(bad({ part: '목' as never }), fam, empty).some((x) => x.startsWith('부위 값'))).toBe(true);
    expect(validateExerciseData(bad({ pattern: 'X' as never }), fam, empty).some((x) => x.startsWith('동작 값'))).toBe(true);
    expect(validateExerciseData(bad({ mechanics: 'x' as never }), fam, empty).some((x) => x.startsWith('mechanics'))).toBe(true);
    expect(validateExerciseData(bad({ equipment: [] }), fam, empty).some((x) => x.startsWith('장비 값'))).toBe(true);
    expect(validateExerciseData(bad({ family: 'nope' }), fam, empty).some((x) => x.startsWith('family 없음'))).toBe(true);
    expect(validateExerciseData(bad({ muscles: [] }), fam, empty).some((x) => x.startsWith('근육'))).toBe(true);
    expect(validateExerciseData(bad({ measure: 'time', default_seconds: 0 }), fam, empty).some((x) => x.startsWith('시간 운동'))).toBe(true);
    expect(validateExerciseData(bad({ default_reps: [10, 5] }), fam, empty).some((x) => x.startsWith('횟수 범위'))).toBe(true);
    expect(validateExerciseData([base[0]!, base[0]!], fam, empty).some((x) => x.startsWith('id 중복'))).toBe(true);
    expect(validateExerciseData([base[0]!, { ...base[3]!, family: 'chest_press_flat', name_ko: base[0]!.name_ko }], fam, empty).some((x) => x.startsWith('이름 중복'))).toBe(true);
    expect(validateExerciseData(bad({}), { ...fam, empty_f: 'y' }, empty)).toContain('빈 family: empty_f');
  });
  it('잘못된 등급 데이터', () => {
    const g: GradeEntry = { value: 'Z' as never, levels: ['왕초보' as never], purpose_part: '목' as never, source: 'VIDEO', sub_goal_only: true };
    const errs = validateExerciseData(bad({}), fam, { ...empty, grades: { ghost: [g], [base[0]!.id]: [g] }, guides: { ghost2: [] } });
    for (const p of ['등급 대상 운동 없음', '등급 값', '목적 부위 값', '수준 값', '영상 근거 없음', '세부 목표 전용', '가이드 대상 운동 없음'])
      expect(errs.some((x) => x.startsWith(p))).toBe(true);
  });
});

describe('등급 고르기 (BLUEPRINT 3.3)', () => {
  it('수준별 등급: 랫풀다운 중급 A+, 상급 A', () => {
    expect(resolveGrade(get('lat_pulldown'), '등', '중급').value).toBe('A+');
    expect(resolveGrade(get('lat_pulldown'), '등', '상급').value).toBe('A');
  });
  it('풀업(일반)은 등 영상 등급만 있어 참고용 표시 없이 사용', () => {
    const r = resolveGrade(get('pull_up'), '등', '상급');
    expect(r.value).toBe('A+');
    expect(r.estimated).toBe(false);
    expect(get('pull_up').grades.every((g) => g.primary_topic)).toBe(true);
  });
  it('주제 영상 등급과 참고용 등급이 충돌하면 주제 영상 우선', () => {
    const ex = { ...get('pull_up'), grades: [
      { value: 'A+', levels: ['상급'], purpose_part: '등', source: 'VIDEO', video_id: 'x', timestamp: '0', primary_topic: false },
      { value: 'B+', levels: ['상급'], purpose_part: '등', source: 'VIDEO', video_id: 'y', timestamp: '0', primary_topic: true },
    ] } as BuiltExercise;
    expect(resolveGrade(ex, '등', '상급').value).toBe('B+');
  });
  it('세부 목표 등급이 내 수준에 없으면 일반 등급으로', () => {
    const ex = { ...get('pull_up'), grades: [
      { value: 'D', levels: ['초보'], purpose_part: '등', purpose_note: '광배 집중', sub_goal_only: true, source: 'VIDEO', video_id: 'x', timestamp: '0', primary_topic: true },
      { value: 'A', levels: [], purpose_part: '등', source: 'VIDEO', video_id: 'x', timestamp: '0', primary_topic: true },
    ] } as BuiltExercise;
    expect(resolveGrade(ex, '등', '상급', '광배 집중').value).toBe('A');
    expect(resolveGrade(ex, '등', '초보', '광배 집중').value).toBe('D');
  });
  it('목적별 등급: 타월 풀업 등=D, 전완·악력 기본=B-(낮은 쪽), 악력 목표=A', () => {
    expect(resolveGrade(get('towel_pull_up'), '등', '중급').value).toBe('D');
    expect(resolveGrade(get('towel_pull_up'), '전완·악력', '중급').value).toBe('B-');
    expect(resolveGrade(get('towel_pull_up'), '전완·악력', '중급', '악력').value).toBe('A');
  });
  it('세부 목표 전용: 와이드 그립 풀업 기본 A, 광배 집중이면 D', () => {
    expect(resolveGrade(get('pull_up_wide'), '등', '중급').value).toBe('A');
    expect(resolveGrade(get('pull_up_wide'), '등', '중급', '광배 집중').value).toBe('D');
  });
  it('M-01 합침: 어시스트 풀업 (머신) 초보 S, 중급·상급 B+(피니셔)', () => {
    expect(resolveGrade(get('assisted_pull_up_machine'), '등', '초보').value).toBe('S');
    expect(resolveGrade(get('assisted_pull_up_machine'), '등', '중급')).toMatchObject({ value: 'B+', estimated: false });
    expect(resolveGrade(get('assisted_pull_up_machine'), '등', '상급').entry?.purpose_note).toBe('마지막 세트 피니셔');
  });
  it('수준에 맞는 등급이 없으면 앱 기본값 B 추정', () => {
    const ex = { ...get('assisted_pull_up_machine'), grades: [get('assisted_pull_up_machine').grades[0]!] } as BuiltExercise;
    expect(resolveGrade(ex, '등', '중급')).toMatchObject({ value: 'B', estimated: true, source: 'APP_DEFAULT' });
  });
  it('영상 없는 운동은 B 추정, 사용자 등급이 최우선', () => {
    expect(resolveGrade(get('leg_press'), '하체', '중급')).toMatchObject({ value: 'B', estimated: true });
    expect(resolveGrade(get('leg_press'), '하체', '중급', undefined, 'S')).toMatchObject({ value: 'S', source: 'USER' });
  });
  it('딥스: 가슴 부위이면서 삼두 등급(B)으로 삼두 후보', () => {
    const dip = get('dip') as BuiltExercise;
    expect(eligibleParts(dip)).toEqual(['가슴', '삼두']);
    expect(resolveGrade(dip, '삼두', '중급').value).toBe('B');
    expect(resolveGrade(dip, '가슴', '중급').estimated).toBe(true);
  });
  it('기본 횟수: 다관절 6~10, 단관절 10~15, 지정값 우선', () => {
    expect(defaultReps(get('bench_press'))).toEqual([6, 10]);
    expect(defaultReps(get('cable_fly'))).toEqual([10, 15]);
    expect(defaultReps(get('push_up'))).toEqual([8, 20]);
  });
  it('자세 포인트 연결: 고블릿 스쿼트, 스쿼트 계열(M-05), 체스트 서포티드 로우 계열(M-06)', () => {
    expect(get('goblet_squat').guide.length).toBeGreaterThan(10);
    expect(get('back_squat').guide.length).toBe(16); // 초보 스쿼트 3 + 새 영상의 스쿼트·하프·풀 스쿼트 자세 포인트
    expect(get('lever_row_machine').guide.length).toBe(9); // 등 영상 1 + 새 영상의 로우 공통·서포티드 로우 자세 포인트 + 어깨 영상 2개의 '로우' 언급(Bc27jDy5dsk 풀다운/로우 비교, ZqJ_OS7rTnY 후면 삼각근 로우)
  });
  it('무거운 운동·한쪽씩 표시 (묶음 제외, 시간 계산에 사용)', () => {
    for (const id of ['bench_press', 'back_squat', 'deadlift', 'romanian_deadlift', 'barbell_row', 'close_grip_bench', 'good_morning', 'rack_pull', 'trap_bar_deadlift']) expect(get(id).heavy).toBe(true);
    for (const id of ['db_bench_press', 'lat_pulldown', 'goblet_squat']) expect(get(id).heavy).toBeFalsy();
    for (const id of ['one_arm_lat_pulldown', 'oh_cable_ext_single', 'bulgarian_split_squat', 'one_arm_db_row']) expect(get(id).unilateral).toBe(true);
    expect(get('landmine_press').unilateral).toBeFalsy();
  });
  it('무거운 힌지는 한 묶음: 데드리프트·랙풀·트랩바', () => {
    expect(['deadlift', 'rack_pull', 'trap_bar_deadlift'].map((id) => get(id).family)).toEqual(['deadlift', 'deadlift', 'deadlift']);
  });
  it('장비 순서 = BLUEPRINT 5.4 (케이블 = 머신 > 스미스 > 덤벨 > 맨몸 > 밴드 > 바벨)', () => {
    const order = ['cable', 'machine', 'smith', 'dumbbell', 'bodyweight', 'band', 'barbell'] as const;
    for (let i = 1; i < order.length; i++) expect(EQUIPMENT_RANK[order[i]!]).toBeGreaterThanOrEqual(EQUIPMENT_RANK[order[i - 1]!]);
    expect(EQUIPMENT_RANK.cable).toBe(EQUIPMENT_RANK.machine);
    expect(EQUIPMENT_RANK.machine).toBeLessThan(EQUIPMENT_RANK.smith);
  });
});

describe('장비·무거운 힌지·묶음 고정', () => {
  it('장비는 적힌 것이 모두 있어야 가능 (실 로우 = 바벨 + 기타)', () => {
    expect(equipmentAvailable(get('seal_row'), ['barbell'])).toBe(false);
    expect(equipmentAvailable(get('seal_row'), ['barbell', 'other'])).toBe(true);
    expect(equipmentAvailable(get('lat_pulldown'), ['cable', 'machine'])).toBe(true);
  });
  it('무거운 힌지 판별 (M-12)', () => {
    const heavyHinges = all.filter(isHeavyHinge).map((e) => e.id).sort();
    expect(heavyHinges).toEqual(['deadlift', 'good_morning', 'rack_pull', 'romanian_deadlift', 'sumo_deadlift', 'trap_bar_deadlift']);
  });
  it('운동 → 묶음 전체 스냅샷 (묶음이 바뀌면 검토 후 스냅샷 갱신)', () => {
    expect({ exercise_family: Object.fromEntries(base.map((e) => [e.id, e.family])), family_labels: familyFile.families }).toMatchSnapshot();
  });
});