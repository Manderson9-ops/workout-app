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

export function buildGas(local?: { INBOX_ID: string; EXEC_URL: string }): string {
  const ts = readFileSync(join(ROOT, 'src', 'core', 'syncMerge.ts'), 'utf8');
  if (/^\s*import\s/m.test(ts)) throw new Error('syncMerge.ts는 다른 모듈을 가져오면 안 됩니다 (Apps Script)');
  let js = stripTypeScriptTypes(ts, { mode: 'strip' });
  const names = [...js.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  js = js.replace(/^export (const|function) /gm, '$1 ');
  const lib = `// ---- 자동 생성: src/core/syncMerge.ts (고치지 말 것) ----\nvar SyncMerge = (function () {\n${js}\nreturn { ${names.join(', ')} };\n})();\n`;
  let handler = readFileSync(join(ROOT, 'tools', 'gas', 'handler.js'), 'utf8');
  if (local) handler = handler.replace('__INBOX_ID__', local.INBOX_ID).replace('__EXEC_URL__', local.EXEC_URL);
  return `${lib}\n${handler}`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/gas/build.ts')) {
  const lp = join(ROOT, 'tools', 'gas', 'local.json');
  const local = existsSync(lp) ? JSON.parse(readFileSync(lp, 'utf8')) : undefined;
  const out = buildGas(local);
  writeFileSync(join(ROOT, 'tools', 'gas', 'Code.gs'), out, 'utf8');
  console.log(`tools/gas/Code.gs ${out.length}자${local ? '' : ' (local.json 없음: 자리 표시 그대로)'}`);
}
