/**
 * WORK_OUT_K 가져오기 로직 (파일 입출력 없음, 테스트 가능).
 * CLI: tools/import_workout_k.ts. 기준: BLUEPRINT 3장, exercise-sync 스킬.
 */
import type { Exercise, GradeEntry, GuideItem, Part, Level } from './types';

export interface AliasEntry { name: string; exercise?: string; exercises?: string[]; families?: string[]; status: 'CONFIRMED' | 'PROPOSED' | 'PENDING_MERGE'; decision?: string; note?: string }
export interface GradeRule { video_id: string; exercise: string; grade: string; purpose_part?: Part; purpose_note?: string; sub_goal_only?: boolean; primary_topic?: boolean; decision?: string; note?: string }
/** 반영하지 않는 티어 항목(영상+이름+등급)·이름. 실패가 아니라 '미적용'으로 기록 (M-15·16·22·24·26) */
export interface SkipItem { video_id: string; exercise: string; grade?: string; reason: string; decision?: string }
export interface SkipName { name: string; reason: string; decision?: string }
/** 자세 포인트 한 개(영상+시점)를 지정한 앱 운동에만 붙임. 영상 속 일반 이름(예: "오버헤드 프레스")이 별칭 묶음으로 풀려 다른 운동에까지 붙는 것을 막음. 원본(WORK_OUT_K)은 고치지 않는다 (M-30) */
export interface GuideRule { video_id: string; timestamp: string; exercise?: string; only: string[]; reason: string; decision?: string }
export interface Decision { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CUSTOM'; title: string; proposal: string; while_pending: string; resolution?: string }
export interface Template { id: string; name: string; wk_names: string[]; per_week: string; days: Part[][]; generatable: boolean }
export interface SubGoalRule { template: string; wk_name: string; purpose_note: string; sub_goal_only: boolean; decision?: string }
export interface Combo { id: string; part: Part; video_id: string; wk_unrated: string; timestamp: string; exercises: string[]; extra_if_three?: string; text: string }
export interface TierItem { exercise: string; grade: string; levels?: Level[]; target?: string; why?: string; timestamp?: string }
export interface WkRecord {
  video_id: string; title: string; channel: string; publish_date: string;
  key_points?: { type: string; body_part?: string; exercise?: string; text: string; timestamp: string }[];
  tier_list?: { key: string; topic: string; items: TierItem[]; unrated?: { exercise: string; text: string; timestamp: string }[] };
}
export interface ImportInput {
  base: Exercise[];
  families: Record<string, string>;
  aliases: AliasEntry[];
  topicParts: Record<string, Part>;
  /** 운동이 아닌 티어 주제 (유전자·근육 난이도 등): 등급으로 쓰지 않음. 자세 포인트는 그대로 봄 (M-25) */
  ignoreTopics?: string[];
  skipItems?: SkipItem[];
  skipNames?: SkipName[];
  guideRules?: GuideRule[];
  rules: GradeRule[];
  decisions: Decision[];
  templates: Template[];
  subGoalRules: SubGoalRule[];
  combos: Combo[];
  records: WkRecord[];
}
export interface TemplateGrade { value: string; levels: Level[]; purpose_note?: string; sub_goal_only?: boolean; why?: string; video_id: string; timestamp?: string; wk_name: string }
export interface ImportResult {
  grades: Record<string, GradeEntry[]>;
  guides: Record<string, GuideItem[]>;
  templates: (Template & { grades: TemplateGrade[]; notes: { text: string; video_id: string; timestamp: string }[] })[];
  combos: Combo[];
  unapplied: { video_id: string; exercise: string; grade?: string; reason: string }[];
  unresolved: string[];
  /** [주제, 영상 속 이름, 등급, 수준, 앱 운동 id, 연결 방법] */
  mapped: string[][];
  tierItemCount: number;
}

/** 이름 비교용: 공백과 · ( ) / 제거, 소문자 */
export function normalizeName(s: string): string {
  return s.replace(/[\s·()/]/g, '').toLowerCase();
}

export function runImport(inp: ImportInput): ImportResult {
  const decisions = new Map(inp.decisions.map((d) => [d.id, d]));
  const allows = (id: string | undefined, needApproval: boolean): boolean => {
    if (!id) return true;
    const d = decisions.get(id);
    if (!d) throw new Error(`알 수 없는 결정 ID: ${id}`);
    if (d.status === 'REJECTED') return false;
    return needApproval ? d.status === 'APPROVED' : true;
  };

  const byId = new Map(inp.base.map((e) => [e.id, e]));
  const byName = new Map<string, string>();
  for (const e of inp.base) {
    for (const n of [e.name_ko, ...(e.aliases ?? [])]) {
      const k = normalizeName(n);
      if (byName.has(k) && byName.get(k) !== e.id) throw new Error(`이름 중복(정규화 후): '${n}' (${byName.get(k)}, ${e.id})`);
      byName.set(k, e.id);
    }
  }
  const aliasByName = new Map(inp.aliases.map((a) => [normalizeName(a.name), a]));

  const usedSkips = new Set<SkipItem>(), usedSkipNames = new Set<SkipName>(), usedGuideRules = new Set<GuideRule>();
  const skipNames = new Map((inp.skipNames ?? []).map((s) => [normalizeName(s.name), s]));
  const resolve = (name: string): { ids: string[]; via: string } | { ids: null; failed: boolean; reason: string } => {
    const sk = skipNames.get(normalizeName(name));
    if (sk && allows(sk.decision, false)) { usedSkipNames.add(sk); return { ids: null, failed: false, reason: `반영 안 함: ${sk.reason}` }; }
    const a = aliasByName.get(normalizeName(name));
    if (a) {
      if (!allows(a.decision, a.status === 'PENDING_MERGE')) return { ids: null, failed: false, reason: `결정 ${a.decision} 대기/거절로 미적용` };
      if (a.exercise || a.exercises) {
        const ids = a.exercises ?? [a.exercise!];
        const missing = ids.filter((x) => !byId.has(x));
        if (missing.length) return { ids: null, failed: true, reason: `별칭 대상 운동 없음: ${missing.join(', ')}` };
        return { ids, via: `별칭(${a.status})` };
      }
      const ids = inp.base.filter((e) => a.families!.includes(e.family)).map((e) => e.id);
      if (!ids.length) return { ids: null, failed: true, reason: `별칭 대상 묶음 비어 있음` };
      return { ids, via: `묶음 별칭(${a.status}): ${a.families!.join(', ')}` };
    }
    const id = byName.get(normalizeName(name));
    if (id) return { ids: [id], via: byId.get(id)!.name_ko === name ? '이름 일치' : '별칭·표기 차이 일치' };
    return { ids: null, failed: true, reason: '연결 실패 (별칭 없음)' };
  };

  const grades: Record<string, GradeEntry[]> = {};
  const guides: Record<string, GuideItem[]> = {};
  const mapped: string[][] = [];
  const unapplied: ImportResult['unapplied'] = [];
  const unresolved: string[] = [];
  const usedRules = new Set<GradeRule>();
  const templates: ImportResult['templates'] = inp.templates.map((t) => ({ ...t, grades: [], notes: [] }));
  let tierItemCount = 0;

  for (const r of inp.records) {
    const tl = r.tier_list;
    if (tl && tl.key === 'split') {
      for (const it of tl.items) {
        const t = templates.find((x) => x.wk_names.includes(it.exercise));
        if (!t) { unresolved.push(`[분할] ${it.exercise}`); continue; }
        const sg = inp.subGoalRules.find((s) => s.wk_name === it.exercise && allows(s.decision, false));
        t.grades.push({ value: it.grade, levels: it.levels ?? [], ...(sg ? { purpose_note: sg.purpose_note, sub_goal_only: sg.sub_goal_only } : {}),
          why: it.why, video_id: r.video_id, timestamp: it.timestamp, wk_name: it.exercise });
        mapped.push(['분할', it.exercise, it.grade, (it.levels ?? []).join('·') || '전체', t.id, '템플릿 이름 일치']);
      }
      for (const u of tl.unrated ?? []) {
        const t = templates.find((x) => x.wk_names.includes(u.exercise));
        if (!t) { unresolved.push(`[분할 미평가] ${u.exercise}`); continue; }
        t.notes.push({ text: u.text, video_id: r.video_id, timestamp: u.timestamp });
      }
    } else if (tl) {
      const part = inp.topicParts[tl.key];
      const ignored = (inp.ignoreTopics ?? []).includes(tl.key);
      if (!part && !ignored) unresolved.push(`[주제] ${tl.key} (topic_parts에 부위 매핑 없음)`);
      for (const it of part && !ignored ? tl.items : []) {
        tierItemCount++;
        const skip = (inp.skipItems ?? []).find((s) => s.video_id === r.video_id && s.exercise === it.exercise && (!s.grade || s.grade === it.grade));
        if (skip && allows(skip.decision, false)) { usedSkips.add(skip); unapplied.push({ video_id: r.video_id, exercise: it.exercise, grade: it.grade, reason: `반영 안 함: ${skip.reason}` }); continue; }
        const res = resolve(it.exercise);
        if (res.ids === null) {
          if (res.failed) unresolved.push(`[${tl.topic}] ${it.exercise}: ${res.reason}`);
          else unapplied.push({ video_id: r.video_id, exercise: it.exercise, grade: it.grade, reason: res.reason });
          continue;
        }
        const rule = inp.rules.find((x) => x.video_id === r.video_id && x.exercise === it.exercise && x.grade === it.grade);
        if (rule) usedRules.add(rule);
        const ok = rule ? allows(rule.decision, false) : false;
        for (const id of res.ids) {
          const g: GradeEntry = {
            value: it.grade as GradeEntry['value'], levels: it.levels ?? [],
            purpose_part: (ok && rule?.purpose_part) || part!,
            ...(ok && rule?.purpose_note ? { purpose_note: rule.purpose_note } : {}),
            ...(ok && rule?.sub_goal_only ? { sub_goal_only: true } : {}),
            source: 'VIDEO', why: it.why, target: it.target, video_id: r.video_id, timestamp: it.timestamp,
            primary_topic: rule?.primary_topic ?? true,
          };
          (grades[id] ??= []).push(g);
          mapped.push([tl.topic, it.exercise, it.grade, g.levels.join('·') || '전체', id, `${res.via}; 목적 ${g.purpose_part}${g.purpose_note ? '(' + g.purpose_note + ')' : ''}${g.sub_goal_only ? ' [세부목표 전용]' : ''}`]);
        }
      }
    }
    for (const kp of r.key_points ?? []) {
      if (!kp.exercise) continue;
      const res = resolve(kp.exercise);
      if (res.ids === null) {
        if (res.failed) unresolved.push(`[자세 포인트] ${kp.exercise}: ${res.reason}`);
        else unapplied.push({ video_id: r.video_id, exercise: kp.exercise, reason: res.reason });
        continue;
      }
      let ids = res.ids;
      const gr = (inp.guideRules ?? []).find((g) => g.video_id === r.video_id && g.timestamp === kp.timestamp && (!g.exercise || g.exercise === kp.exercise) && allows(g.decision, false));
      if (gr) {
        usedGuideRules.add(gr);
        const missing = gr.only.filter((x) => !byId.has(x));
        if (missing.length) unresolved.push(`[자세 포인트 규칙] ${gr.video_id}@${gr.timestamp}: 앱에 없는 운동 ${missing.join(', ')}`);
        const outside = gr.only.filter((x) => byId.has(x) && !ids.includes(x));
        if (outside.length) unresolved.push(`[자세 포인트 규칙] ${gr.video_id}@${gr.timestamp}: only 의 ${outside.join(', ')} 은(는) 이 항목의 연결 결과(${ids.join(', ')})에 없음`);
        ids = ids.filter((x) => gr.only.includes(x));
        if (!ids.length) { unresolved.push(`[자세 포인트 규칙] ${gr.video_id}@${gr.timestamp}: 연결된 운동(${res.ids.join(', ')})과 only(${gr.only.join(', ')})가 겹치지 않음`); continue; }
      }
      for (const id of ids) (guides[id] ??= []).push({ type: kp.type, text: kp.text, video_id: r.video_id, timestamp: kp.timestamp });
    }
  }

  // '참고용'(primary_topic=false)은 같은 운동에 주제 영상 등급이 있을 때만 의미가 있다
  for (const gs of Object.values(grades)) {
    if (!gs.some((g) => g.primary_topic)) for (const g of gs) g.primary_topic = true;
  }

  const combos = inp.combos.filter((c) => {
    const rec = inp.records.find((r) => r.video_id === c.video_id);
    const ok = !!rec?.tier_list?.unrated?.some((u) => u.exercise === c.wk_unrated) && [...c.exercises, ...(c.extra_if_three ? [c.extra_if_three] : [])].every((id) => byId.has(id));
    if (!ok) unresolved.push(`[추천 조합] ${c.id}`);
    return ok;
  });
  for (const x of inp.rules) if (!usedRules.has(x)) unresolved.push(`[규칙 미사용] ${x.video_id} ${x.exercise} ${x.grade}`);
  for (const x of inp.skipItems ?? []) if (!usedSkips.has(x)) unresolved.push(`[규칙 미사용] 빼기 ${x.video_id} ${x.exercise} ${x.grade ?? ''}`.trim());
  for (const x of inp.guideRules ?? []) if (!usedGuideRules.has(x)) unresolved.push(`[규칙 미사용] 자세 포인트 ${x.video_id}@${x.timestamp}`);
  for (const x of inp.skipNames ?? []) if (!usedSkipNames.has(x)) unresolved.push(`[규칙 미사용] 빼기 이름 ${x.name}`);
  for (const f of new Set(inp.base.map((e) => e.family))) if (!inp.families[f]) unresolved.push(`[family 이름 없음] ${f}`);

  return { grades, guides, templates, combos, unapplied, unresolved, mapped, tierItemCount };
}
