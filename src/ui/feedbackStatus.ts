import changelog from '../../CHANGELOG.json';
import { applyChangelog } from '../core/feedback';
import { db, mutate } from './store';

/**
 * 앱 시작 때 CHANGELOG의 feedback_ids / deferred 로 개선 메모 상태를 "반영됨 (버전)" / "보류 (이유)"로 (S3, BLUEPRINT 6.3).
 * 바뀌는 메모만 저장 → 동기화로 다른 기기에도 퍼짐
 */
export async function applyFeedbackStatus(): Promise<number> {
  const items = await db.feedback.toArray();
  const changed = applyChangelog(items, (changelog as { versions: Parameters<typeof applyChangelog>[1] }).versions);
  if (changed.length) await mutate((d) => d.feedback.bulkPut(changed));
  return changed.length;
}
