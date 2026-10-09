/**
 * Apps Script 코드 만들기: src/core/syncMerge.ts(형식 지움) + tools/gas/handler.js → tools/gas/Code.gs
 * 합치기 규칙은 앱 테스트와 서버가 같은 코드 한 벌 (D-028).
 * 폴더 ID·주소는 tools/gas/local.json (저장소에 안 올림)에서. 없으면 자리 표시 그대로 (테스트용).
 * 실행: npm run gas:build
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 순수 TS 모듈 하나를 Apps Script 용 이름 공간(var Name = (function(){...})())으로 */
function bundle(file: string, name: string): string {
  const ts = readFileSync(join(ROOT, 'src', 'core', file), 'utf8');
  if (/^\s*import\s/m.test(ts)) throw new Error(`${file}는 다른 모듈을 가져오면 안 됩니다 (Apps Script)`);
  let js = stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/[\u00a0\u2000-\u200b\u3000]/g, ' ');
  if (/\d_\d/.test(js.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ''))) throw new Error(`${file}에 숫자 구분자(예: 60_000)가 있어요`);
  const names = [...js.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  js = js.replace(/^export (const|function) /gm, '$1 ');
  return `// ---- 자동 생성: src/core/${file} (고치지 말 것) ----\nvar ${name} = (function () {\n${js}\nreturn { ${names.join(', ')} };\n})();\n`;
}

export function buildGas(local?: { INBOX_ID: string; EXEC_URL: string }): string {
  const health = bundle('healthIngest.ts', 'HealthIngest'); // D-058 애플워치 받기
  const ts = readFileSync(join(ROOT, 'src', 'core', 'syncMerge.ts'), 'utf8');
  if (/^\s*import\s/m.test(ts)) throw new Error('syncMerge.ts는 다른 모듈을 가져오면 안 됩니다 (Apps Script)');
  // 형식을 지운 자리에 들어가는 특수 공백(U+2002 등)은 Apps Script 편집기가 못 읽어 저장이 안 됨 → 보통 공백으로
  let js = stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/[\u00a0\u2000-\u200b\u3000]/g, ' ');
  // 숫자 구분자(60_000)는 Apps Script가 못 읽음 → syncMerge.ts에는 쓰지 않음 (문자열을 건드리지 않게 치환 대신 검사)
  if (/\d_\d/.test(js.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ''))) throw new Error('syncMerge.ts에 숫자 구분자(예: 60_000)가 있어요');
  const names = [...js.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  js = js.replace(/^export (const|function) /gm, '$1 ');
  const lib = `// ---- 자동 생성: src/core/syncMerge.ts (고치지 말 것) ----\nvar SyncMerge = (function () {\n${js}\nreturn { ${names.join(', ')} };\n})();\n`;
  let handler = readFileSync(join(ROOT, 'tools', 'gas', 'handler.js'), 'utf8');
  // 주석에도 같은 글자가 있어서, 따옴표로 감싼 값 자리만 바꿈
  if (local) handler = handler.replace("'__INBOX_ID__'", JSON.stringify(local.INBOX_ID)).replace("'__EXEC_URL__'", JSON.stringify(local.EXEC_URL));
  return `${lib}\n${health}\n${handler}`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/gas/build.ts')) {
  const lp = join(ROOT, 'tools', 'gas', 'local.json');
  const local = existsSync(lp) ? JSON.parse(readFileSync(lp, 'utf8')) : undefined;
  const out = buildGas(local);
  writeFileSync(join(ROOT, 'tools', 'gas', 'Code.gs'), out, 'utf8');
  console.log(`tools/gas/Code.gs ${out.length}자${local ? '' : ' (local.json 없음: 자리 표시 그대로)'}`);
}
