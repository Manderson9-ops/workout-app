/**
 * WORK_OUT_K → 앱 운동 데이터 가져오기 CLI (로직: src/core/wkImport.ts)
 * - WORK_OUT_K는 읽기만 한다. 실행 전후 원본 해시를 비교해 리포트에 남긴다.
 * - 연결 실패가 있으면 exit 1.
 * 실행: npm run import:workout-k   (원본 위치 변경: WORKOUT_K_DIR 환경 변수)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runImport } from '../src/core/wkImport.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WK_DIR = process.env.WORKOUT_K_DIR ?? 'G:\\내 드라이브\\WORK_OUT_K';
const readJson = (p: string): any => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const recDir = join(WK_DIR, 'db', 'records');
const files = readdirSync(recDir).filter((f) => f.endsWith('.json')).sort();
const hashAll = () => files.map((f) => createHash('sha256').update(readFileSync(join(recDir, f))).digest('hex'));
const hashBefore = hashAll();

const base = readJson(join(ROOT, 'data/exercises.base.json')).exercises;
const families = readJson(join(ROOT, 'data/families.json')).families;
const ruleFile = readJson(join(ROOT, 'data/grade_rules.json'));
const decisionFile = readJson(join(ROOT, 'data/merge_decisions.json'));
const templateFile = readJson(join(ROOT, 'data/split_templates.json'));
const records = files.map((f) => readJson(join(recDir, f)));

const res = runImport({
  base, families, aliases: readJson(join(ROOT, 'data/aliases.json')).aliases,
  topicParts: ruleFile.topic_parts, rules: ruleFile.rules, decisions: decisionFile.decisions,
  templates: templateFile.templates, subGoalRules: templateFile.sub_goal_rules,
  combos: readJson(join(ROOT, 'data/combos.json')).combos, records,
});

const out = {
  _note: 'tools/import_workout_k.ts 자동 생성. 직접 수정 금지',
  source_videos: records.map((r: any) => ({ video_id: r.video_id, title: r.title, channel: r.channel, publish_date: r.publish_date })),
  grades: res.grades, guides: res.guides, templates: res.templates, combos: res.combos, unapplied: res.unapplied,
};
writeFileSync(join(ROOT, 'data/exercises.workout_k.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
const hashAfter = hashAll();
const untouched = hashBefore.every((h, i) => h === hashAfter[i]);

const byId = new Map(base.map((e: any) => [e.id, e]));
const esc = (s: string) => String(s).replace(/\|/g, '/');
const L: string[] = [];
L.push('# WORK_OUT_K 가져오기 리포트', '', `- 원본: \`${WK_DIR}\` (읽기만 함). 실행 전후 해시 ${untouched ? '**동일 (원본 변경 없음)**' : '**다름 (확인 필요)**'}`);
L.push(`- 영상 ${records.length}개, 기본 종목 ${base.length}개, 운동 묶음(family) ${Object.keys(families).length}개`);
L.push(`- 티어 항목 ${res.tierItemCount}개 → 연결 ${res.mapped.filter((m) => m[0] !== '분할').length}개 + 결정 대기로 미적용 ${res.unapplied.filter((u) => u.grade).length}개`);
L.push(`- 영상 등급이 붙은 운동 ${Object.keys(res.grades).length}개 (등급 ${Object.values(res.grades).flat().length}개), 자세 포인트가 붙은 운동 ${Object.keys(res.guides).length}개`);
L.push(`- 연결 실패: **${res.unresolved.length}건**`, '');
if (res.unresolved.length) L.push('## 연결 실패 (빌드 중단)', '', ...res.unresolved.map((u) => `- ${u}`), '');
L.push('## 사용자 결정', '', '| ID | 상태 | 내용 | 제안 | 대기 중 적용 |', '|---|---|---|---|---|');
for (const d of decisionFile.decisions) L.push(`| ${d.id} | ${d.status} | ${esc(d.title)} | ${esc(d.proposal)} | ${esc(d.while_pending)} |`);
L.push('', '## 미적용 항목', '', ...(res.unapplied.length ? res.unapplied.map((u) => `- ${u.exercise}${u.grade ? ' ' + u.grade : ''} (${u.video_id}): ${u.reason}`) : ['- 없음']), '');
L.push('## 티어 항목 연결표', '', '| 주제 | 영상 속 이름 | 등급 | 수준 | 앱 운동 | 연결 방법·비고 |', '|---|---|---|---|---|---|');
for (const m of res.mapped) L.push(`| ${m.map(esc).join(' | ')} |`);
L.push('', '## 한 운동에 영상 등급이 여러 개인 경우', '');
for (const [id, gs] of Object.entries(res.grades)) if (gs.length > 1) L.push(`- ${(byId.get(id) as any).name_ko}: ${gs.map((g) => `${g.value}(${g.levels.join('·') || '전체'}, ${g.purpose_part}${g.purpose_note ? '/' + g.purpose_note : ''}${g.sub_goal_only ? ', 세부목표 전용' : ''}${g.primary_topic ? '' : ', 참고용'})`).join(', ')}`);
L.push('', '## 운동 묶음(family) 표 (M-08)', '', '한 플랜에는 같은 묶음에서 1개만 들어간다.', '', '| 묶음 | 운동 |', '|---|---|');
for (const [f, label] of Object.entries(families)) L.push(`| ${label} | ${base.filter((e: any) => e.family === f).map((e: any) => e.name_ko).join(', ')} |`);
L.push('', '## 분할 템플릿', '', '| 템플릿 | 요일별 부위 | 영상 등급 |', '|---|---|---|');
for (const t of res.templates) L.push(`| ${t.name} | ${t.days.map((d) => d.join('+')).join(' / ') || '(자동 생성 안 함)'} | ${t.grades.map((g) => `${g.value}(${g.levels.join('·') || '전체'}${g.sub_goal_only ? ', ' + g.purpose_note + ' 전용' : ''})`).join(', ') || '미평가'} |`);
L.push('', '코어·전완은 템플릿 요일에 기본으로 넣지 않았다. 플랜을 만들 때 원하는 요일에 부위를 더하면 된다.');
L.push('', '## 원본 파일 해시 (SHA-256)', '', ...files.map((f, i) => `- ${f}: \`${hashAfter[i]}\``));
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports/import_report.md'), L.join('\n') + '\n', 'utf8');

console.log(`영상 ${records.length}, 티어 항목 ${res.tierItemCount}, 등급 운동 ${Object.keys(res.grades).length}, 가이드 운동 ${Object.keys(res.guides).length}, 연결 실패 ${res.unresolved.length}, 미적용 ${res.unapplied.length}, 원본 변경 ${untouched ? '없음' : '있음'}`);
if (res.unresolved.length || !untouched) { console.error(res.unresolved.join('\n')); process.exit(1); }
