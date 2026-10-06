/**
 * 화면 머리 (D-055 디자인 시스템 3장 1단계 4번): [작은 날짜·머리말] + 큰 제목 + 오른쪽 원형 버튼 [개선] [설정], 제목 아래 작은 동기화 줄.
 * 뒤로 가기가 있는 화면은 맨 위 줄 왼쪽에 뒤로, 오른쪽에 같은 원형 버튼 (뒤로 위치를 화면마다 같게).
 */
import type { ComponentChildren } from 'preact';
import { Icon } from './icons';
import { FeedbackNavItem } from './screens/FeedbackUi';
import { SyncBadge } from './screens/SyncSection';
import { newDotTarget } from './whatsNew';

export function HeadButtons() {
  const onSettings = (location.hash || '#/').startsWith('#/settings');
  const dot = newDotTarget() === 'settings';
  return (
    <div class="head-btns">
      <FeedbackNavItem />
      <a class="icon-btn round" href="#/settings" aria-label="설정" aria-current={onSettings ? 'page' : undefined} aria-describedby={dot ? 'new-dot-desc' : undefined}>
        <Icon name="settings" />{dot && <i class="ndot" aria-hidden="true" />}
      </a>
    </div>
  );
}

export function ScreenHeader({ title, eyebrow, back, children, titleClass }: {
  title?: ComponentChildren; eyebrow?: string;
  /** 뒤로 버튼 (글자, 누르면 할 일) */
  back?: { label: string; onClick: () => void; aria?: string };
  /** 제목 아래 줄 (버튼 등) */
  children?: ComponentChildren; titleClass?: string;
}) {
  return (
    <header class="scr-head">
      {back && (
        <div class="scr-backrow">
          <button class="ghost back" onClick={back.onClick} aria-label={back.aria}><Icon name="back" size={20} />{back.label}</button>
          <HeadButtons />
        </div>
      )}
      {title !== undefined && (
        <div class="scr-titlerow">
          <div class="grow">
            {eyebrow && <p class="eyebrow">{eyebrow}</p>}
            <h1 class={titleClass}>{title}</h1>
          </div>
          {!back && <HeadButtons />}
        </div>
      )}
      <SyncBadge />
      {children}
    </header>
  );
}
