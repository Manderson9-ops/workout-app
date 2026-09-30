import changelog from '../../CHANGELOG.json';
import { applyChangelog } from '../core/feedback';
import { db, mutate } from './store';
import { lsSet } from './appName';

/** 반영됨 알림 문구 (메뉴 옆에 한 번 표시, FeedbackButton이 읽고 지움) */
export const FB_NOTICE_KEY = 'fb.notice';

/**
 * CHANGELOG의 feedback_ids / deferred 로 개선 메모 상태를 "반영됨 (버전)" / "보류 (이유)"로 (S3, BLUEPRINT 6.3).
 * 앱 시작 때와 동기화로 무언가 받은 뒤 실행. 바뀌는 메모만 저장 → 동기화로 다른 기기에도 퍼짐
 */
export async function applyFeedbackStatus(): Promise<number> {
  const items = await db.feedback.toArray();
  const changed = applyChangelog(items, (changelog as { versions: Parameters<typeof applyChangelog>[1] }).versions);
  if (!changed.length) return 0;
  await mutate((d) => d.feedback.bulkPut(changed));
  const done = changed.filter((f) => f.status === '반영됨').length, held = changed.length - done;
  lsSet(FB_NOTICE_KEY, [done ? `개선 메모 ${done}개가 반영됐어요` : '', held ? `${held}개는 보류됐어요` : ''].filter(Boolean).join(', ') + ' (설정 → 개선 메모)');
  window.dispatchEvent(new Event('fb-notice'));
  return changed.length;
}
