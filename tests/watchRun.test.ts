import { describe, expect, it } from 'vitest';
import { shortcutRunUrl, dailyDue, kstDay, isAppleMobile, SHORTCUT_NAME, AFTER_WORKOUT_SKIP_MS } from '../src/core/watchRun';

const at = (iso: string) => Date.parse(iso);

describe('D-064 shortcutRunUrl', () => {
  it('이름은 NFD 로 인코딩한다 (맥이 저장한 이름과 같게)', () => {
    const u = shortcutRunUrl('workout');
    expect(u.startsWith('shortcuts://run-shortcut?name=')).toBe(true);
    const name = decodeURIComponent(u.split('name=')[1]!);
    expect(name).toBe(SHORTCUT_NAME.workout.normalize('NFD'));
    expect(name).not.toBe(SHORTCUT_NAME.workout.normalize('NFC'));
    expect(name.normalize('NFC')).toBe('WO 운동 실행');
  });
  it('하루 실행 이름', () => {
    expect(decodeURIComponent(shortcutRunUrl('daily').split('name=')[1]!).normalize('NFC')).toBe('WO 하루 실행');
  });
});

describe('D-064 dailyDue', () => {
  const on = { enabled: true, activeWorkout: false };
  it('오늘 처음, 5시 이후면 한다', () => { expect(dailyDue({}, at('2026-10-12T00:00:00Z'), on)).toBe(true); }); // 한국 09:00
  it('꺼져 있으면 안 한다', () => { expect(dailyDue({}, at('2026-10-12T00:00:00Z'), { enabled: false, activeWorkout: false })).toBe(false); });
  it('운동 중이면 안 한다', () => { expect(dailyDue({}, at('2026-10-12T00:00:00Z'), { enabled: true, activeWorkout: true })).toBe(false); });
  it('오늘 이미 했으면 안 한다 (한국 날짜 기준)', () => {
    const now = at('2026-10-11T16:30:00Z'); // 한국 10/12 01:30 → 5시 전이라 어차피 안 함
    expect(kstDay(now)).toBe('2026-10-12');
    expect(dailyDue({ dailyDay: '2026-10-12' }, at('2026-10-12T03:00:00Z'), on)).toBe(false);
    expect(dailyDue({ dailyDay: '2026-10-11' }, at('2026-10-12T03:00:00Z'), on)).toBe(true);
  });
  it('한국 새벽 5시 전에는 안 한다', () => {
    expect(dailyDue({}, at('2026-10-11T19:59:00Z'), on)).toBe(false); // 한국 04:59
    expect(dailyDue({}, at('2026-10-11T20:00:00Z'), on)).toBe(true); // 한국 05:00
  });
  it('운동 보내기 뒤 2시간 안에는 건너뛴다', () => {
    const now = at('2026-10-12T10:00:00Z');
    expect(dailyDue({ workoutAt: now - 60_000 }, now, on)).toBe(false);
    expect(dailyDue({ workoutAt: now - AFTER_WORKOUT_SKIP_MS }, now, on)).toBe(true);
    expect(dailyDue({ workoutAt: now + 60_000 }, now, on)).toBe(true); // 시계가 뒤로 간 경우 막지 않음
  });
});

describe('D-064 isAppleMobile', () => {
  it('아이폰', () => { expect(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)', 'iPhone', 5)).toBe(true); });
  it('아이패드 데스크톱 모드', () => { expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true); });
  it('맥·윈도 PC 는 아님', () => {
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isAppleMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe(false);
  });
});
