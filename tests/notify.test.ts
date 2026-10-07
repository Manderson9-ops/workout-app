import { describe, it, expect } from 'vitest';
import { shouldNotify, restNotifyBody, permissionText, deniedText, delayedResultText, isIosLike } from '../src/core/notify';
import { restHintText, testResultText } from '../src/ui/haptics';
import { summarizeDiag, verdicts } from '../src/core/diag';
import type { DiagEntry } from '../src/core/diag';

describe('D-056 실험 알림: 보낼지 판단', () => {
  const base = { on: true, permission: 'granted' as const, endsAt: 10_000, now: 10_000 };
  it('켜 둠 + 허용 + 이 휴식에 처음 + 늦지 않음일 때만', () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, on: false })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'default' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'unsupported' })).toBe(false);
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

describe('D-056 검토 S1: 10초 뒤 시험 결과·막힘 안내', () => {
  it('실제로 걸린 초, 15초 넘으면 이유', () => {
    expect(delayedResultText(10_200)).toMatch(/^10초 뒤 보냈어요\. /);
    expect(delayedResultText(15_000)).not.toContain('화면을 잠그면');
    expect(delayedResultText(42_600)).toMatch(/^43초 뒤 보냈어요 · 화면을 잠그면 아이폰이 앱을 멈춰 늦어져요/);
  });
  it('막혔을 때: 아이폰은 설정 앱 → 알림 → 앱 이름, 그 밖은 브라우저 사이트 설정', () => {
    expect(deniedText(true)).toContain('아이폰 설정 앱 → 알림 → 이 앱 이름');
    expect(deniedText(false)).toContain('사이트 설정');
    expect(permissionText('denied', false)).toBe(deniedText(false));
    expect(isIosLike('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)')).toBe(true);
    expect(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIosLike('Mozilla/5.0 (Linux; Android 15)')).toBe(false);
  });
});

