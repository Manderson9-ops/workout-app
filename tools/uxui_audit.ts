/**
 * UX/UI 가이드 감사 (D-079). 가이드 원문(VIBE_CODER_UXUI_GUIDE.md)과 코드에서 사실을 직접 뽑아
 * 사람이 정한 적용 판단(docs/uxui/uxui_mapping.json)과 합쳐 DB·그래프·요약을 만든다. 손으로 적은 숫자 없음.
 * 실행: npm run uxui:audit            → UXUI_DB.json · uxui_graph.json · UXUI_DB.md 갱신
 *       npm run uxui:audit -- --gate  → 게이트 규칙 중 FAIL 이 있으면 exit 1
 *       npm run uxui:audit -- --impact .card   → 그 선택자·규칙이 닿는 파일·화면
 * 위치 변경: UXUI_GUIDE(가이드 파일), UXUI_DIR(docs/uxui 폴더), UXUI_ROOT(코드 폴더, 기준선 측정용)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.UXUI_ROOT ?? HERE;
const DIR = process.env.UXUI_DIR ?? 'G:\\내 드라이브\\WORK_OUT_APP\\docs\\uxui';
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

const read = (p: string) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const mapping = JSON.parse(read(join(DIR, 'uxui_mapping.json')));
const GUIDE = process.env.UXUI_GUIDE ?? mapping.guide_path_default;
const lineOf = (text: string, idx: number) => text.slice(0, idx).split('\n').length;

// ---------- 1. 가이드 원문 ----------
type GuideRule = { id: string; section: string; title: string; before?: string; after?: string; text?: string; line: number; hash?: string };
function parseGuide(md: string): { rules: GuideRule[]; sources: { path: string; exists: boolean; line: number }[] } {
  const lines = md.split(/\r?\n/);
  const rules: GuideRule[] = [];
  let sec = '';
  lines.forEach((l, i) => {
    const h = l.match(/^##\s+(?:[^\w\s]+\s*)?(\d)\.\s/u); // 이모지 유무와 관계없이 '## 2.' 형식
    if (h) { sec = h[1]!; return; }
    const ln = i + 1;
    let m;
    if (sec === '1' && (m = l.match(/^(\d)\. \*\*(.+?)\*\*/))) rules.push({ id: `R${m[1]}`, section: '1 필수 행동 수칙', title: m[2]!, after: (lines[i + 1] ?? '').replace(/^\s*➔\s*/, '').trim(), line: ln });
    else if (sec === '2' && (m = l.match(/^\| \*\*(\d\d)\*\* \| (.+?) \| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|\s*$/))) rules.push({ id: `M${m[1]}`, section: `2 매트릭스 · ${m[2]}`, title: m[3]!, before: m[4], after: m[5], line: ln });
    else if (sec === '3' && (m = l.match(/^(\d+)\. \*\*(.+?)\*\*: (.+)$/))) rules.push({ id: `A${m[1]!.padStart(2, '0')}`, section: '3 아키텍처 16', title: m[2]!, text: m[3], line: ln });
    // 2026-10-28 가이드 개편: 3장이 표(번호 | 레이어 | 이름 | 단계 | 규격 | 함정 | 레퍼런스)로 바뀜
    else if (sec === '3' && (m = l.match(/^\| \*\*(\d\d)\*\* \| (L\d) \| \*\*(.+?)\*\* \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|\s*$/))) rules.push({ id: `A${m[1]}`, section: `3 아키텍처 16 · ${m[2]} · ${m[4]}`, title: m[3]!, text: m[5], after: m[6], line: ln });
    else if (sec === '4' && (m = l.match(/^(\d+)\. \*\*(.+?)\*\*: (.+)$/))) rules.push({ id: `B${m[1]}`, section: '4 베타 생존 킷', title: m[2]!, text: m[3], line: ln });
  });
  for (const r of rules) r.hash = createHash('sha256').update(lines[r.line - 1]! + (r.id.startsWith('R') ? lines[r.line] ?? '' : '')).digest('hex').slice(0, 8); // 규칙 원문(R 은 다음 ➔ 줄까지) 해시
  const sources: { path: string; exists: boolean; line: number }[] = [];
  lines.forEach((l, i) => { for (const s of l.matchAll(/`(database\/[^`]+)`/g)) sources.push({ path: s[1]!, exists: existsSync(join(dirname(GUIDE), s[1]!)), line: i + 1 }); });
  return { rules, sources };
}

// ---------- 2. 코드 사실 ----------
const cssPath = join(ROOT, 'src/ui/styles.css');
const cssRaw = read(cssPath);
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')); // 주석을 지우되 줄 번호는 그대로
type Rule = { sel: string[]; body: string; line: number; media: string };
const rules: Rule[] = [];
{
  // @media 블록 범위를 먼저 잡아 안쪽 규칙에 조건을 붙임
  const media: { from: number; to: number; q: string }[] = [];
  for (const m of css.matchAll(/@media([^{]+)\{/g)) {
    let d = 1, i = m.index! + m[0].length;
    for (; i < css.length && d; i++) { if (css[i] === '{') d++; else if (css[i] === '}') d--; }
    media.push({ from: m.index!, to: i, q: m[1]!.trim() });
  }
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1]!.replace(/@media[^{]*$/, '').trim();
    if (!head || head.startsWith('@')) continue;
    const at = m.index! + m[0].indexOf(head);
    rules.push({ sel: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2]!, line: lineOf(css, at), media: media.find((x) => at > x.from && at < x.to)?.q ?? '' });
  }
}
const rootEnd = css.indexOf('}', css.indexOf(':root'));
const ruleFor = (s: string) => rules.filter((r) => r.sel.includes(s) && !r.media);

const uiDir = join(ROOT, 'src/ui');
const tsxFiles = [...readdirSync(uiDir).filter((f) => f.endsWith('.tsx')).map((f) => join(uiDir, f)), ...readdirSync(join(uiDir, 'screens')).filter((f) => f.endsWith('.tsx')).map((f) => join(uiDir, 'screens', f))];
const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, '/');
const tsx = new Map(tsxFiles.map((f) => [rel(f), read(f)]));
const app = tsx.get('src/ui/App.tsx') ?? '';

/** 화면 파일의 class 토큰 (class="a b" · class={`a ${x}`} · class={x ? 'a' : 'b'}) */
function classTokens(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/class=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    const s = m[1] ?? (m[2] ?? '').match(/['"`][^'"`]*['"`]/g)?.join(' ') ?? '';
    for (const t of s.replace(/\$\{[^}]*\}/g, ' ').split(/[\s'"`]+/)) if (/^[a-z][\w-]*$/.test(t)) out.add(t);
  }
  return out;
}

function appConfig() {
  const routes: { path: string; component: string; match: string; line: number }[] = [];
  for (const m of app.matchAll(/(?:path\.startsWith\('([^']+)'\)|path === '([^']+)')[^;]*?screen = <(\w+)/g)) {
    let path = `#${m[1] ?? m[2]}`;
    if (m[1]?.endsWith('/')) path += ':id'; // '/stats/w/' 처럼 뒤에 id 가 붙는 주소
    if (/endsWith\('\/edit'\)/.test(m[0])) path += '/edit'; // 같은 접두라도 수정 화면은 따로
    routes.push({ match: m[1] ? 'prefix' : 'exact', path, component: m[3]!, line: lineOf(app, m.index!) });
  }
  routes.push({ match: 'default', path: '#/', component: (app.match(/else screen = <(\w+)/) ?? [])[1] ?? '?', line: lineOf(app, app.indexOf('else screen = <')) });
  const compFile: Record<string, string> = {};
  for (const m of app.matchAll(/import\('\.\/screens\/(\w+)'\)\)?\.then\(\(m\) => m\.(\w+)\)/g)) compFile[m[2]!] = `src/ui/screens/${m[1]}.tsx`;
  for (const m of app.matchAll(/import \{ ([\w, ]+) \} from '\.\/screens\/(\w+)'/g)) for (const c of m[1]!.split(/,\s*/)) compFile[c] = `src/ui/screens/${m[2]}.tsx`;
  const tabs = [...app.matchAll(/\{ id: '(\w+)', h: '([^']+)', ico: '\w+', label: '([^']+)'/g)].map((m) => ({ id: m[1], hash: m[2], label: m[3] }));
  const tokens: Record<string, string> = {};
  for (const m of css.slice(css.indexOf(':root'), rootEnd).matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  const breakpoints = [...new Set([...css.matchAll(/@media \((min|max)-width: (\d+)px\)/g)].map((m) => `${m[1]}-width ${m[2]}px`))];
  const pw = read(join(ROOT, 'playwright.config.ts'));
  const e2eProjects = [...pw.matchAll(/name: '([^']+)', use: \{ \.\.\.devices\['([^']+)'\](?:, browserName: '(\w+)')?/g)].map((m) => ({ name: m[1], device: m[2], browser: m[3] ?? 'webkit' }));
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  return {
    version: pkg.version, framework: Object.keys(pkg.dependencies ?? {}),
    platforms: {
      mobile: { target: 'iPhone PWA (홈 화면 앱)', viewport_test: e2eProjects, layout: '1열 + 떠 있는 알약 탭 바(하단)', nav: tabs },
      web: { target: 'PC 브라우저 (같은 코드)', layout: `${breakpoints.join(' · ')} — 900px 이상 왼쪽 세로 메뉴·카드 2열, 1100px 이상 플랜 2단`, phone_view_toggle: css.includes('html.phone-view') },
    },
    routes: routes.map((r) => ({ ...r, file: compFile[r.component] ?? (r.component === 'Home' ? 'src/ui/screens/Home.tsx' : '?') })),
    breakpoints, tokens, token_count: Object.keys(tokens).length,
    files: [...tsx.keys()],
  };
}

// ---------- 3. 측정 ----------
const surface: string[] = mapping.surface_selectors;
/** e2e/uxui.spec.ts 와 같은 방법: src/ui·src/ui/screens 의 .tsx (상대 경로 정렬) + 마지막에 styles.css */
const CODE_HASH = (() => {
  const h = createHash('sha256');
  // src/ui·src/ui/screens 의 .ts·.tsx (상대 경로 정렬) — 화면 동작 .ts 도 포함 (3차 검토 D3)
  const all = [uiDir, join(uiDir, 'screens')].flatMap((d) => readdirSync(d).filter((f) => /\.tsx?$/.test(f)).map((f) => join(d, f)));
  for (const f of all.map((p) => [rel(p), p] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(read(f[1]));
  h.update(cssRaw);
  return h.digest('hex').slice(0, 16);
})();
const decl = (r: Rule, re: RegExp) => [...r.body.matchAll(re)].length;
function metrics() {
  const m: Record<string, { value: unknown; evidence: string[] }> = {};
  const put = (k: string, value: unknown, evidence: string[] = []) => { m[k] = { value, evidence }; };
  // M01 상자 테두리: 면 선택자에 1px 실선 --line
  const lastPart = (s: string) => s.split(/\s+|>/).filter(Boolean).pop() ?? s;
  const sb = rules.filter((r) => r.sel.some((s) => surface.includes(s.replace(/^html(?:\.[\w-]+|:not\([^)]*\))* /, '')) || surface.includes(lastPart(s))) && /border(?:-color)?\s*:\s*1px (?:solid|dashed) var\(--line\)/.test(r.body));
  put('surface_line_borders', sb.reduce((n, r) => n + decl(r, /border\s*:\s*1px (?:solid|dashed) var\(--line\)/g), 0), sb.map((r) => `styles.css:${r.line} ${r.sel.join(',')}`));
  const ts = ['h1', 'h2', 'h3', '.card-title', '.sub'].filter((s) => ruleFor(s).some((r) => /font-weight/.test(r.body) && /color|font-size/.test(r.body + (s === '.sub' ? '' : 'font-size'))));
  put('type_scale_tokens', ts.length, ts.map((s) => `styles.css:${ruleFor(s)[0]!.line} ${s}`));
  const off: string[] = [];
  for (const r of rules) for (const d of r.body.matchAll(/(padding|margin|gap)[\w-]*\s*:\s*([^;]+)/g)) for (const px of d[2]!.matchAll(/(?<![\w.-])(\d+)px/g)) { const v = +px[1]!; if (v % 4 && !/env\(|calc\(/.test(d[2]!)) off.push(`styles.css:${r.line} ${r.sel[0]} ${d[1]} ${v}px`); }
  put('offgrid_spacing', off.length, off.slice(0, 40));
  const after = css.slice(rootEnd);
  const hex = [...after.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((x) => `styles.css:${lineOf(css, rootEnd + x.index!)} ${x[0]}`);
  for (const [f, s] of tsx) for (const x of s.matchAll(/['"`](#[0-9a-fA-F]{3,8}|rgba?\([^'"`]*)['"`]/g)) hex.push(`${f}:${lineOf(s, x.index!)} ${x[1]}`);
  put('hex_outside_root', hex.length, hex);
  const card = ruleFor('.card').find((r) => /padding/.test(r.body));
  put('card_padding_px', card ? +(card.body.match(/padding\s*:\s*(\d+)px/)?.[1] ?? 0) : 0, card ? [`styles.css:${card.line} .card`] : []);
  const ka = rules.find((r) => r.sel.some((s) => /^(html|body)$/.test(s)) && /word-break\s*:\s*keep-all/.test(r.body));
  put('keep_all_global', !!ka, ka ? [`styles.css:${ka.line}`] : []);
  const bal = rules.filter((r) => /text-wrap\s*:\s*balance/.test(r.body));
  put('text_balance_rules', bal.length, bal.map((r) => `styles.css:${r.line} ${r.sel.join(',')}`));
  // M09 입력 2열: grid2·row 상자를 div 짝을 맞춰 끝까지 읽고, 글 입력칸이 2개 이상이면 2열 (form-1col·filter-row·search-row 제외)
  // 2차 검토 N1: 첫 안쪽 </div> 에서 자르면 row > div > input + div > NumInput 모양을 1개로 셈
  const two: string[] = [];
  const boxBody = (s: string, from: number) => {
    const re = /<div\b[^>]*?(\/)?>|<\/div>/g; re.lastIndex = from; let d = 1, m: RegExpExecArray | null = null;
    while (d && (m = re.exec(s))) { if (m[0].startsWith('</')) d--; else if (!m[1]) d++; }
    return s.slice(from, m ? m.index : from + 2000);
  };
  for (const [f, s] of tsx) for (const x of s.matchAll(/<div class=(?:"((?:row|grid2)[^"]*)"|\{`((?:row|grid2)[^`]*)`\})[^>]*>/g)) {
    const cls = x[1] ?? x[2] ?? '';
    if (/form-1col|filter-row|search-row/.test(cls)) continue;
    const n = [...boxBody(s, x.index! + x[0].length).matchAll(/<(input|NumInput|select|textarea)\b(?![^>]*type="(?:checkbox|radio)")/g)].length;
    if (n >= 2) two.push(`${f}:${lineOf(s, x.index!)} (${cls.split(' ')[0]} 입력 ${n})`);
  }
  put('form_two_col', two.length, two);
  // M11 모호한 단독 라벨 (확인 창 confirm.tsx 는 제목이 문맥이라 제외)
  const vague: string[] = [];
  for (const [f, s] of tsx) if (!f.endsWith('confirm.tsx')) for (const x of s.matchAll(/>(저장|확인|전송|제출|적용|완료)<\/button>/g)) vague.push(`${f}:${lineOf(s, x.index!)} ${x[1]}`);
  put('vague_submit_labels', vague.length, vague);
  // M13 폼 미완성 disabled 주 버튼 (로딩·경계·기능 없음 표시는 제외)
  // 항(||, &&)마다 판정: '!' 로 시작하는 항이 기능 상태(아래 목록)가 아니면 폼 미완성 막기. busy·phase 같은 로딩 항은 '!' 가 아니라 그 자체로 무시
  const FEATURE = /^!\s*(changed|canMerge|cfg|canRunShortcuts\(\))$/; // 바꾼 것 없음·합칠 수 없음·연결 설정 없음·단축어 불가 = 할 일이 없는 상태 (mapping M13)
  const dis: string[] = [];
  for (const [f, s] of tsx) for (const x of s.matchAll(/<button\b/g)) {
    const head = s.slice(x.index!, x.index! + 400).split(/onClick=/)[0]!;
    const d = head.match(/disabled=\{([^}]*)\}/);
    if (d && /primary/.test(head) && d[1]!.split(/\|\||&&/).map((t) => t.trim()).some((t) => t.startsWith('!') && !FEATURE.test(t))) dis.push(`${f}:${lineOf(s, x.index!)} disabled={${d[1]}}`);
  }
  put('form_submit_disabled', dis.length, dis);
  const dh = rules.find((r) => r.sel.some((s) => /^button\.danger:(hover|active)/.test(s)) && /--bad-soft/.test(r.body));
  put('danger_hover', !!dh, dh ? [`styles.css:${dh.line}`] : []);
  const nat: string[] = [];
  for (const [f, s] of tsx) for (const x of s.matchAll(/\b(?:window\.)?(confirm|alert|prompt)\(/g)) {
    const ln = s.slice(s.lastIndexOf('\n', x.index!) + 1, x.index!);
    if (!/^\s*(\/\/|\/?\*)|\/\/|\/\*/.test(ln)) nat.push(`${f}:${lineOf(s, x.index!)}`); // 주석 속 언급은 제외
  }
  put('native_dialogs', nat.length, nat);
  const undo: string[] = [];
  for (const [f, s] of tsx) for (const x of s.matchAll(/되돌리기/g)) undo.push(`${f}:${lineOf(s, x.index!)}`);
  put('undo_actions', undo.length, undo);
  const ub: string[] = [];
  for (const [f, s] of tsx) for (const x of s.matchAll(/class=(?:"|\{`)toast[" $`]/g)) if (/>되돌리기<\/button>/.test(s.slice(x.index!, x.index! + 500))) ub.push(`${f}:${lineOf(s, x.index!)}`); // 5초 알림 안의 [되돌리기]만 (상시 버튼 제외)
  put('undo_toasts', ub.length, ub);
  put('skeleton_present', ruleFor('.skel-card').length > 0, ruleFor('.skel-card').map((r) => `styles.css:${r.line}`));
  const fv = rules.find((r) => r.sel.includes(':focus-visible') && /outline/.test(r.body));
  put('focus_visible_global', !!fv, fv ? [`styles.css:${fv.line}`] : []);
  const pulse = rules.find((r) => r.sel.some((s) => s.startsWith('.ndot.live')) && /animation/.test(r.body));
  put('pulse_status_dot', !!pulse, pulse ? [`styles.css:${pulse.line}`] : []);
  const sh = ruleFor('.sheet').find((r) => /position\s*:\s*fixed/.test(r.body) && /bottom\s*:\s*0/.test(r.body));
  put('bottom_sheet', !!sh, sh ? [`styles.css:${sh.line}`] : []);
  const mt = rules.find((r) => /prefers-reduced-motion:\s*no-preference/.test(r.media) && r.sel.some((s) => /^button\b/.test(s)) && /transition/.test(r.body));
  put('motion_transitions', !!mt, mt ? [`styles.css:${mt.line}`] : []);
  const gas = existsSync(join(ROOT, 'tools/gas/handler.js')) ? read(join(ROOT, 'tools/gas/handler.js')) : '';
  const kc = gas.search(/j\.key !== key/);
  put('server_key_check', kc >= 0, kc >= 0 ? [`tools/gas/handler.js:${lineOf(gas, kc)}`] : []);
  const comp = tsx.get('src/ui/components.tsx') ?? '';
  put('empty_component', /export function Empty\b/.test(comp), [`src/ui/components.tsx:${lineOf(comp, comp.indexOf('export function Empty'))}`]);
  // 화면 측정(e2e/uxui.spec.ts 가 남김)
  // 화면 측정(e2e/uxui.spec.ts) — 지금 코드와 같은 해시일 때만 씀. 다르면 NOT_MEASURED (--gate 실패)
  const rt = join(ROOT, 'reports/uxui-runtime.json');
  if (existsSync(rt)) {
    const j = JSON.parse(read(rt)) as Record<string, { value: unknown; evidence: string[] } | string> & { code_hash?: string };
    put('runtime_fresh', j.code_hash === CODE_HASH, [`runtime ${j.code_hash ?? '없음'} · 지금 ${CODE_HASH}`]);
    if (j.code_hash === CODE_HASH) for (const [k, v] of Object.entries(j)) if (typeof v === 'object') put(`runtime:${k}`, v.value, v.evidence);
  } else put('runtime_fresh', false, ['reports/uxui-runtime.json 없음']);
  // WebKit(아이폰 엔진) 측정 — L-01 상한 판정용 (runtime_gates 의 runtime_webkit:*)
  const rw = join(ROOT, 'reports/uxui-runtime-iphone-webkit.json');
  if (existsSync(rw)) {
    const j = JSON.parse(read(rw)) as Record<string, { value: unknown; evidence: string[] } | string> & { code_hash?: string };
    if (j.code_hash === CODE_HASH) for (const [k, v] of Object.entries(j)) if (typeof v === 'object') put(`runtime_webkit:${k}`, v.value, v.evidence);
  }
  return m;
}

// ---------- 4. 합치기 ----------
const cmp = (v: unknown, g: { op: string; value: unknown }) => g.op === '==' ? v === g.value : g.op === '<=' ? (v as number) <= (g.value as number) : (v as number) >= (g.value as number);
const guideMd = read(GUIDE);
const guide = parseGuide(guideMd);
const cfg = appConfig();
const met = metrics();
const audit = guide.rules.map((g) => {
  let mp = mapping.rules[g.id] ?? null;
  const alias = mp?.same_as as string | undefined;
  if (alias) mp = { ...mapping.rules[alias], same_as: alias };
  if (!mp) return { id: g.id, title: g.title, status: 'UNMAPPED' };
  const mv = mp.metric ? met[mp.metric] : undefined;
  const status = mp.applies === 'no' ? 'N/A' : !mp.gate ? (mv ? 'INFO' : 'JUDGED') : mv === undefined ? 'NOT_MEASURED' : cmp(mv.value, mp.gate) ? 'PASS' : 'FAIL';
  return { id: g.id, title: g.title, applies: mp.applies, same_as: alias, status, metric: mp.metric ?? null, measured: mv?.value ?? null, gate: mp.gate ?? null, evidence: mv?.evidence ?? [], decisions: mp.decisions ?? [], targets: mp.targets ?? [], rationale: mp.rationale, guide_line: g.line };
});

// ---------- 5. 그래프 (규칙 → 선택자 → 화면 파일 → 주소, 규칙 → 결정) ----------
type N = { id: string; kind: string; label: string }; type E = { from: string; to: string; rel: string };
const nodes = new Map<string, N>(); const edges: E[] = [];
const node = (id: string, kind: string, label = id) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label }); return id; };
const fileTokens = new Map([...tsx].map(([f, s]) => [f, classTokens(s)]));
const selTokens = (s: string) => [...s.replace(/^[a-z]+(?=\.)/, '').matchAll(/\.([\w-]+)/g)].map((x) => x[1]!);
for (const a of audit) {
  if (!('applies' in a)) continue;
  node(`rule:${a.id}`, 'rule', `${a.id} ${a.title}`);
  edges.push({ from: `rule:${a.id}`, to: node(`guide:L${a.guide_line}`, 'guide_line', `가이드 ${a.guide_line}줄`), rel: 'sourced_from' });
  for (const d of a.decisions) edges.push({ from: `rule:${a.id}`, to: node(`decision:${d}`, 'decision', d), rel: 'constrained_by' });
  if (a.metric) edges.push({ from: `rule:${a.id}`, to: node(`metric:${a.metric}`, 'metric', a.metric), rel: 'measured_by' });
  const sels = a.targets.flatMap((t: string) => (t === 'surface_selectors' ? surface : [t])).filter((t: string) => t.includes('.'));
  for (const s of sels) {
    edges.push({ from: `rule:${a.id}`, to: node(`sel:${s}`, 'selector', s), rel: 'governs' });
    const toks = selTokens(s);
    if (toks.length) for (const [f, ft] of fileTokens) if (toks.every((t) => ft.has(t))) edges.push({ from: `sel:${s}`, to: node(`file:${f}`, 'file', basename(f)), rel: 'used_in' });
  }
}
for (const r of cfg.routes) if (r.file !== '?') edges.push({ from: node(`file:${r.file}`, 'file', basename(r.file)), to: node(`route:${r.path}`, 'route', r.path), rel: 'renders' });
// 공통 부품 파일 → 그 부품을 가져다 쓰는 화면 파일
for (const [f, s] of tsx) for (const x of s.matchAll(/from '\.\.?\/(components|confirm|toast|header|icons|prioritySheet|bodyMapView|charts|lazy|whatsNew|EndAskBanner)'/g)) {
  const dep = `src/ui/${x[1]}.tsx`; if (tsx.has(dep)) edges.push({ from: node(`file:${dep}`, 'file', basename(dep)), to: node(`file:${f}`, 'file', basename(f)), rel: 'imported_by' });
}
const dedup = [...new Map(edges.map((e) => [`${e.from}|${e.rel}|${e.to}`, e])).values()];
/** 직접 영향(규칙→선택자→그 class 를 쓰는 파일→주소). viaShared=true 면 공통 부품 파일을 가져다 쓰는 화면까지 (넓게 잡힘) */
function reach(start: string, viaShared = false) {
  const rels = ['governs', 'used_in', 'renders', ...(viaShared ? ['imported_by'] : [])];
  const out = new Set<string>(); const q = [start];
  while (q.length) { const c = q.shift()!; for (const e of dedup) if (e.from === c && rels.includes(e.rel) && !out.has(e.to)) { out.add(e.to); q.push(e.to); } }
  return [...out];
}

// ---------- 6. 출력 ----------
const imp = opt('--impact');
if (imp) {
  const start = imp.startsWith('rule:') || imp.startsWith('sel:') ? imp : /^[RMAB]\d/.test(imp) ? `rule:${imp}` : `sel:${imp}`;
  const r = reach(start), wide = reach(start, true);
  const n = (a: string[], k: string) => a.filter((x) => x.startsWith(k)).length;
  console.log(`${start} → 직접: 파일 ${n(r, 'file:')}개 · 화면 ${n(r, 'route:')}개 / 공통 부품 경유 포함: 파일 ${n(wide, 'file:')}개 · 화면 ${n(wide, 'route:')}개`);
  for (const x of r) console.log('  ' + x);
  process.exit(0);
}
const sha = createHash('sha256').update(guideMd).digest('hex').slice(0, 16);
const counts = audit.reduce<Record<string, number>>((o, a) => { o[a.status] = (o[a.status] ?? 0) + 1; return o; }, {});
const db = {
  generated_by: 'tools/uxui_audit.ts', generated_at: new Date().toISOString(), code_root: ROOT,
  guide: { path: GUIDE, sha256_16: sha, rule_count: guide.rules.length, sources: guide.sources, rules: guide.rules },
  app: cfg, metrics: met, audit, summary: counts, proposals: mapping.proposals, known_limits: mapping.known_limits ?? [],
};
const out = opt('--out') ?? DIR;
if (!flag('--no-write')) {
  writeFileSync(join(out, 'UXUI_DB.json'), JSON.stringify(db, null, 2) + '\n');
  writeFileSync(join(out, 'uxui_graph.json'), JSON.stringify({ generated_at: db.generated_at, nodes: [...nodes.values()], edges: dedup }, null, 2) + '\n');
  const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = [
    '# UX/UI 감사 DB 요약 (자동 생성 — 직접 고치지 말 것)', '',
    `- 생성: ${db.generated_at} · \`npm run uxui:audit\` (코드 ${cfg.version})`,
    `- 가이드: \`${GUIDE}\` (sha256 앞 16자 \`${sha}\`, 규칙 ${guide.rules.length}개, 원천 파일 ${guide.sources.filter((s) => s.exists).length}/${guide.sources.length} 존재)`,
    `- 판정 수: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    `- 앱 구성: 화면 주소 ${cfg.routes.length}개 · 토큰 ${cfg.token_count}개 · 반응형 ${cfg.breakpoints.join(', ')} · e2e ${cfg.platforms.mobile.viewport_test.map((p) => p.name).join(', ')}`,
    `- 그래프: 노드 ${nodes.size} · 간선 ${dedup.length} (\`uxui_graph.json\`)`, '',
    '| ID | 규칙 | 적용 | 판정 | 측정값 | 기준 | 근거(앞 2개) | 결정 |', '|---|---|---|---|---|---|---|---|',
    ...audit.map((a) => `| ${a.id}${'same_as' in a && a.same_as ? `→${a.same_as}` : ''} | ${esc(a.title)} | ${'applies' in a ? a.applies : '-'} | **${a.status}** | ${esc('measured' in a ? JSON.stringify(a.measured) : '')} | ${esc('gate' in a && a.gate ? `${a.gate.op} ${a.gate.value}` : '')} | ${esc('evidence' in a && a.evidence ? a.evidence.slice(0, 2).join('; ') : '')} | ${esc('decisions' in a ? a.decisions.join(' ') : '')} |`),
    '', '## 적용 안 함·바꿔 적용한 이유', '',
    ...audit.filter((a) => 'applies' in a && a.applies !== 'yes' && !a.same_as).map((a) => `- **${a.id} ${a.title}** (${'applies' in a ? a.applies : ''}): ${'rationale' in a ? a.rationale : ''}`),
    '', '## 알려진 한계', '', ...((mapping.known_limits ?? []) as { id: string; what: string }[]).map((k) => `- **${k.id}** ${k.what}`),
    '', '## 제안 (사용자 승인 대상)', '', ...mapping.proposals.map((p: { id: string; title: string; why: string; blocker: string }) => `- **${p.id} ${p.title}** — ${p.why} 막힌 이유: ${p.blocker}`), '',
  ].join('\n');
  writeFileSync(join(out, 'UXUI_DB.md'), md);
}
// 가이드 파싱 점검: 장별 규칙 수가 mapping 의 기대와 같고, mapping 의 규칙이 모두 파싱돼야 함 (형식이 바뀌어 규칙이 조용히 사라지는 것 방지)
const parseErr: string[] = [];
for (const [k, n] of Object.entries(mapping.expected_counts as Record<string, number>)) { const got = guide.rules.filter((r) => r.id.startsWith(k)).length; if (got !== n) parseErr.push(`가이드 ${k} 규칙 ${got}개 (기대 ${n})`); }
for (const id of Object.keys(mapping.rules)) if (!guide.rules.some((r) => r.id === id)) parseErr.push(`mapping 의 ${id} 가 가이드에서 안 읽힘`);
for (const e of parseErr) console.log(`  ✗ 파싱: ${e}`);
// 2차 검토 N2: 가이드는 자동 동기화 파일 → 규칙 원문이 검토 때(mapping.guide_review)와 다르면 GUIDE_CHANGED. 다시 판단한 뒤 --accept-guide 로 기록
const reviewed: Record<string, string> = mapping.guide_review?.rules ?? {};
const changed = guide.rules.filter((r) => reviewed[r.id] !== r.hash).map((r) => `${r.id}(${reviewed[r.id] ? '바뀜' : '검토 기록 없음'})`);
if (flag('--accept-guide')) {
  mapping.guide_review = { reviewed_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' '), rules: Object.fromEntries(guide.rules.map((r) => [r.id, r.hash])) };
  writeFileSync(join(DIR, 'uxui_mapping.json'), JSON.stringify(mapping, null, 2) + '\n');
  console.log(`가이드 검토 기록 갱신: 규칙 ${guide.rules.length}개`);
} else if (changed.length) console.log(`  ✗ GUIDE_CHANGED: ${changed.join(' ')} — 규칙 원문이 검토 때와 다름. mapping 판단을 다시 본 뒤 --accept-guide`);
// 2차 검토 N3: 화면 측정의 보조 지표도 감사 게이트에서 직접 판정 (e2e expect 에만 기대지 않음)
const rtFails: string[] = [];
for (const g of (mapping.runtime_gates ?? []) as { metric: string; op: string; value: unknown }[]) {
  const v = met[g.metric];
  if (!v) rtFails.push(`${g.metric} 미측정`); else if (!cmp(v.value, g)) rtFails.push(`${g.metric}=${JSON.stringify(v.value)} (기준 ${g.op} ${g.value})`);
}
for (const e of rtFails) console.log(`  ✗ 화면: ${e}`);
const fails = audit.filter((a) => a.status === 'FAIL' || a.status === 'UNMAPPED' || a.status === 'NOT_MEASURED');
console.log(`UX/UI 감사: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
for (const f of fails) console.log(`  ✗ ${f.id} ${f.title}: ${'measured' in f ? JSON.stringify(f.measured) : '매핑 없음'} (기준 ${'gate' in f && f.gate ? `${f.gate.op} ${f.gate.value}` : '-'})`);
if (flag('--gate') && (fails.length || parseErr.length || rtFails.length || (changed.length && !flag('--accept-guide')))) process.exit(1);
