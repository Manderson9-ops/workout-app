/**
 * 화면 머리 (D-055 디자인 시스템 3장 1단계 4번): [작은 날짜·머리말] + 큰 제목 + 오른쪽 원형 버튼 [개선] [설정], 제목 아래 작은 동기화 줄.
 * 뒤로 가기가 있는 화면은 맨 위 줄 왼쪽에 뒤로, 오른쪽에 같은 원형 버튼 (뒤로 위치를 화면마다 같게).
 */
import type { ComponentChildren } from 'preact';
import { Icon } from './icons';
import { FeedbackNavItem } from './screens/FeedbackUi';
import { SyncBadge } from './screens/SyncSection';
import { newDotTargets } from './whatsNew';

/** settings=false: 설정 버튼 없이 개선만 (끝낸 운동 수정처럼 취소/저장으로만 떠나야 하는 화면) */
export function HeadButtons({ settings = true }: { settings?: boolean } = {}) {
  const onSettings = (location.hash || '#/').startsWith('#/settings');
  const dot = newDotTargets().has('settings');
  return (
    <div class="head-btns">
      <FeedbackNavItem />
      {settings && <a class="icon-btn round" href="#/settings" aria-label="설정" aria-current={onSettings ? 'page' : undefined} aria-describedby={dot ? 'new-dot-desc' : undefined}>
        <Icon name="settings" />{dot && <i class="ndot" aria-hidden="true" />}
      </a>}
    </div>
  );
}

/** 뒤로 버튼 (모든 화면 같은 모양: ‹ 아이콘 + 파랑 글자, 맨 위 줄 왼쪽). aria 가 없으면 이름 = 글자 */
export function BackButton({ label, onClick, aria }: { label: string; onClick: () => void; aria?: string }) {
  return <button class="ghost back" onClick={onClick} aria-label={aria}><Icon name="back" size={20} />{label}</button>;
}

export function ScreenHeader({ title, eyebrow, back, children, titleClass, actions }: {
  title?: ComponentChildren; eyebrow?: string;
  /** 뒤로 버튼 (글자, 누르면 할 일) */
  back?: { label: string; onClick: () => void; aria?: string };
  /** 제목 아래 줄 (버튼 등) */
  children?: ComponentChildren; titleClass?: string;
  /** 제목 줄 오른쪽 원형 버튼 앞에 더할 버튼 (예: 종목의 [+ 직접 추가]) */
  actions?: ComponentChildren;
}) {
  return (
    <header class="scr-head">
      {back && (
        <div class="scr-backrow">
          <BackButton {...back} />
          <HeadButtons />
        </div>
      )}
      {title !== undefined && (
        <div class="scr-titlerow">
          <div class="grow">
            {eyebrow && <p class="eyebrow">{eyebrow}</p>}
            <h1 class={titleClass}>{title}</h1>
          </div>
          {actions}
          {!back && <HeadButtons />}
        </div>
      )}
      <SyncBadge />
      {children}
    </header>
  );
}
