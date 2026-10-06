/**
 * 화면이 바뀌어도 남는 짧은 알림 (예: 운동을 끝낸 뒤 홈에서 별 아이콘 + "기록 갱신 2개"). 6초 뒤 사라짐, 화면 읽기는 status 로 읽음
 */
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';
import type { IconName } from './icons';

type T = { text: string; icon?: IconName };
let push: ((t: T) => void) | null = null;
let pending: T | null = null;
/** icon: 글 앞 아이콘 (예: 'star' = 기록 갱신). 이모지 대신 */
export function showToast(text: string, icon?: IconName): void { const v = { text, ...(icon ? { icon } : {}) }; if (push) push(v); else pending = v; }

export function ToastHost() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => { push = setT; if (pending) { setT(pending); pending = null; } return () => { if (push === setT) push = null; }; }, []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), 6000); return () => clearTimeout(h); }, [t]);
  if (!t) return null;
  return (
    <div class="app-toast" role="status">
      {t.icon && <Icon name={t.icon} size={18} class="toast-ico" />}<span class="grow">{t.text}</span>
      <button class="ghost icon-btn" aria-label="알림 닫기" onClick={() => setT(null)}><Icon name="close" size={18} /></button>
    </div>
  );
}
