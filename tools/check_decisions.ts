/**
 * 결정 기록 일치 검사 (BLUEPRINT 11장, D-012)
 * docs/DECISIONS.md 의 M-xxx 상태와 data/merge_decisions.json 이 같은지 확인한다. 다르면 exit 1.
 * 실행: npm run decisions:check   (기록 위치 변경: DECISIONS_MD 환경 변수)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MD = process.env.DECISIONS_MD ?? 'G:\\내 드라이브\\WORK_OUT_APP\\docs\\DECISIONS.md';
const STATUS_MAP: Record<string, string> = { 승인: 'APPROVED', 거절: 'REJECTED', 변경: 'CUSTOM', 제안: 'PENDING' };

const json = JSON.parse(readFileSync(join(ROOT, 'data/merge_decisions.json'), 'utf8').replace(/^\uFEFF/, ''));
const md = readFileSync(MD, 'utf8');
const mdStatus = new Map<string, string>();
for (const line of md.split(/\r?\n/)) {
  const m = line.match(/^\|\s*(M-\d{2,})\s*\|.*\|\s*([^|]+?)\s*\|\s*$/);
  if (m) mdStatus.set(m[1]!, STATUS_MAP[m[2]!.split(/\s|\(/)[0]!] ?? `알 수 없음(${m[2]})`);
}
const errors: string[] = [];
for (const d of json.decisions) {
  const s = mdStatus.get(d.id);
  if (!s) errors.push(`${d.id}: DECISIONS.md에 없음`);
  else if (s !== d.status) errors.push(`${d.id}: DECISIONS.md=${s}, merge_decisions.json=${d.status}`);
}
for (const id of mdStatus.keys()) if (!json.decisions.some((d: { id: string }) => d.id === id)) errors.push(`${id}: merge_decisions.json에 없음`);
console.log(`M 결정 ${json.decisions.length}개 검사, 불일치 ${errors.length}건`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
