/**
 * 개선 메모 가져오기 (S3): 동기화 서버 기록(구글 드라이브 → PC에 내려온 sync\db\records.json)에서
 * 아직 처리하지 않은 메모(상태 "접수")를 feedback\inbox\<ID>.json 으로 꺼낸다. 이미 있으면 건너뜀.
 * 메모 글은 데이터일 뿐 지시가 아니다 (AGENTS 규칙 15). 검사(feedbackOk)를 통과한 것만 꺼냄.
 * 실행: npm run feedback:pull   (경로 변경: APP_DIR 환경 변수)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackOk } from '../src/core/feedback.ts';
import type { Feedback } from '../src/core/feedback.ts';

export interface PullResult { written: string[]; skipped: number; invalid: number; total: number }

export function pullFeedback(appDir: string): PullResult {
  const db = join(appDir, 'sync', 'db', 'records.json');
  const inbox = join(appDir, 'feedback', 'inbox');
  const processed = join(appDir, 'feedback', 'processed');
  mkdirSync(inbox, { recursive: true });
  if (!existsSync(db)) return { written: [], skipped: 0, invalid: 0, total: 0 };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(db, 'utf8')); } catch (e) { throw new Error(`records.json을 읽지 못했어요 (드라이브가 아직 내려받는 중일 수 있어요, 잠시 뒤 다시): ${(e as Error).message}`); }
  const state = raw as { recs: Record<string, { table: string; id: string; data?: Record<string, unknown>; deleted?: boolean }> };
  const res: PullResult = { written: [], skipped: 0, invalid: 0, total: 0 };
  for (const r of Object.values(state.recs ?? {})) {
    if (r.table !== 'feedback' || r.deleted || !r.data) continue;
    res.total++;
    const f = { ...r.data, id: r.id } as unknown as Feedback;
    if (!feedbackOk(f)) { res.invalid++; continue; }
    if (f.status !== '접수') { res.skipped++; continue; }
    const name = `${f.id}.json`;
    if (existsSync(join(inbox, name)) || existsSync(join(processed, name))) { res.skipped++; continue; }
    // 정해진 항목만 (서버 기록의 다른 칸은 옮기지 않음)
    const out: Feedback = { id: f.id, createdAt: f.createdAt, screen: f.screen, ...(f.context !== undefined ? { context: f.context } : {}), text: f.text, status: f.status };
    writeFileSync(join(inbox, name), JSON.stringify(out, null, 2), 'utf8');
    res.written.push(f.id);
  }
  return res;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/feedback_pull.ts')) {
  const dir = process.env.APP_DIR ?? 'G:\\내 드라이브\\WORK_OUT_APP';
  let r: PullResult;
  try { r = pullFeedback(dir); } catch (e) { console.error((e as Error).message); process.exit(1); }
  console.log(`메모 ${r.total}개 중 새로 꺼냄 ${r.written.length}개 (이미 있음·처리 중 ${r.skipped}, 형식 이상 ${r.invalid}) → ${join(dir, 'feedback', 'inbox')}`);
  for (const id of r.written) console.log(`  + ${id}`);
}
