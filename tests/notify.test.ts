import { describe, it, expect } from 'vitest';
import { shouldNotify, restNotifyBody, permissionText } from '../src/core/notify';
import { restHintText, testResultText } from '../src/ui/haptics';
import { summarizeDiag, verdicts } from '../src/core/diag';
import type { DiagEntry } from '../src/core/diag';

describe('D-056 실험 알림: 보낼지 판단', () => {
  const base = { on: true, permission: 'granted' as const, endsAt: 10_000, now: 10_000, sentFor: null };
  it('켜 둠 + 허용 + 이 휴식에 처음 + 늦지 않음일 때만', () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, on: false })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'default' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'unsupported' })).toBe(false);
    expect(shouldNotify({ ...base, sentFor: 10_000 })).toBe(false); // 같은 휴식 두 번 안 보냄
    expect(shouldNotify({ ...base, sentFor: 5_000 })).toBe(true);
    expect(shouldNotify({ ...base, now: 15_000 })).toBe(true); // 5초까지
    expect(shouldNotify({ ...base, now: 15_001 })).toBe(false); // 늦게 돌아옴
  });
  it('본문·권한 글', () => {
    expect(restNotifyBody('바벨 컬 2세트')).toBe('다음: 바벨 컬 2세트');
    expect(restNotifyBody('  ')).toBe('운동 화면으로 돌아오세요');
    expect(restNotifyBody('가'.repeat(60)).length).toBeLessThanOrEqual(44);
    expect(permissionText('unsupported')).toContain('홈 화면에 추가한 앱에서만');
    expect(permissionText('denied')).toContain('설정 앱');
  });
});

describe('D-056 검토 R1·R2: 정직한 문구', () => {
  it('첫 휴식 안내: 진동 켬 + 방법 있음일 때만 진동 이야기, 아이폰은 약속하지 않음', () => {
    expect(restHintText(true, 'vibrate')).toContain('진동');
    expect(restHintText(true, 'switch')).toContain('진동도 안 올 수 있어요');
    expect(restHintText(false, 'vibrate')).toContain('벨소리');
    expect(restHintText(false, 'vibrate')).not.toContain('진동');
    expect(restHintText(true, 'none')).toContain('벨소리');
    expect(restHintText(true, 'none')).not.toContain('진동');
  });
  it('시험 결과: 아이폰은 "시도했어요 · 직접 확인"', () => {
    expect(testResultText('switch')).toBe('iOS 햅틱을 시도했어요 · 떨렸는지 직접 확인해 주세요');
    expect(testResultText('none')).toContain('화면 깜빡임만');
  });
  it('진단 요약: 알림 보냄·실패·허용', () => {
    const e = (m: string, ok: boolean): DiagEntry => ({ t: '2026-10-07T00:00:00.000Z', k: 'notify', d: 'ab12', m, ok });
    const s = summarizeDiag([e('granted', true), e('shown', true), e('shown', true), e('error: TypeError', false)]);
    expect(s.notify).toEqual({ shown: 2, failed: 1, granted: 1 });
    expect(verdicts(s).find((x) => x.item === '2~4 알림(실험)')!.text).toContain('보냄 2번');
  });
});
