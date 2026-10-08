/**
 * 단색 선 아이콘 (D-055 디자인 시스템 2장). 24px 격자, 선 굵기 2, 색은 글자색(currentColor)을 따름.
 * 탭·메뉴·원형 버튼에서 이모지 대신 쓴다. 장식용이라 화면 읽기에서는 숨김(aria-hidden) — 이름은 버튼·링크에 붙인다.
 */
export type IconName = 'home' | 'plan' | 'workout' | 'stats' | 'exercises' | 'settings' | 'feedback' | 'more' | 'back' | 'play' | 'chevron' | 'close' | 'info' | 'sparkle'
  | 'swap' | 'skip' | 'undo' | 'note' | 'plate' | 'check' | 'star' | 'starLine' | 'plus' | 'minus' | 'alert' | 'sync' | 'video' | 'lock' | 'clock';

const P: Record<IconName, string[]> = {
  // 집
  home: ['M3 11 12 4l9 7', 'M5.5 9.5V20h13V9.5', 'M10 20v-5.5h4V20'],
  // 퍼즐 조각처럼 칸 4개 (플랜 = 조합)
  plan: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M16.5 13v7', 'M13 16.5h7'],
  // 덤벨
  workout: ['M6.5 7v10', 'M3.5 9.5v5', 'M17.5 7v10', 'M20.5 9.5v5', 'M6.5 12h11'],
  // 막대 그래프
  stats: ['M4 20h16', 'M7 20v-6', 'M12 20V8', 'M17 20v-9'],
  // 책 (종목 사전)
  exercises: ['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z', 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3', 'M9 7.5h6'],
  // 톱니바퀴 (원 + 이 8개)
  settings: ['M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3', 'M5.3 5.3l2.1 2.1', 'M16.6 16.6l2.1 2.1', 'M18.7 5.3l-2.1 2.1', 'M7.4 16.6l-2.1 2.1'],
  // 말풍선
  feedback: ['M4 5h16v11H9l-5 4z', 'M8 9.5h8', 'M8 12.5h5'],
  more: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'],
  back: ['M15 5l-7 7 7 7'],
  play: ['M8 5.5v13l10.5-6.5z'],
  chevron: ['M9 5l7 7-7 7'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5.5', 'M12 7.5h.01'],
  // 교체: 서로 반대 화살표 두 개
  swap: ['M4 8h13', 'M14 4.5 17.5 8 14 11.5', 'M20 16H7', 'M10 12.5 6.5 16l3.5 3.5'],
  // 건너뛰기: 앞으로 + 세로줄
  skip: ['M5 5.5v13l9-6.5z', 'M18 5.5v13'],
  undo: ['M9 7 4.5 11.5 9 16', 'M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2'],
  // 메모: 연필
  note: ['M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z', 'M14 8l3 3'],
  // 원판: 두 원
  plate: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'],
  starLine: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'],
  // 주의: 세모 + 느낌표
  alert: ['M12 4 2.8 19.5h18.4z', 'M12 10v4.5', 'M12 17h.01'],
  // 동기화: 위·아래 화살표
  sync: ['M8 4v15', 'M4.5 7.5 8 4l3.5 3.5', 'M16 20V5', 'M19.5 16.5 16 20l-3.5-3.5'],
  // 영상: 화면 + 재생
  video: ['M3.5 6h17v12h-17z', 'M10 9.5v5l4.5-2.5z'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  sparkle: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2.5 2.5', 'M15.5 15.5 18 18', 'M18 6l-2.5 2.5', 'M8.5 15.5 6 18'],
};

export function Icon({ name, size = 24, class: cls }: { name: IconName; size?: number; class?: string }) {
  const dots = name === 'more';
  return (
    <svg class={`icon${cls ? ` ${cls}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' || name === 'star' ? 'currentColor' : 'none'} stroke="currentColor"
      stroke-width={dots ? 3.2 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {P[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
