/**
 * 화면이 바뀌어도 남는 짧은 알림 (예: 운동을 끝낸 뒤 홈에서 "★ 기록 갱신 2개"). 6초 뒤 사라짐, 화면 읽기는 status 로 읽음
 */
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';

let push: ((t: string) => void) | null = null;
let pending: string | null = null;
export function showToast(text: string): void { if (push) push(text); else pending = text; }

export function ToastHost() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => { push = setT; if (pending) { setT(pending); pending = null; } return () => { if (push === setT) push = null; }; }, []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), 6000); return () => clearTimeout(h); }, [t]);
  if (!t) return null;
  return (
    <div class="app-toast" role="status">
      <span class="grow">{t}</span>
      <button class="ghost icon-btn" aria-label="알림 닫기" onClick={() => setT(null)}><Icon name="close" size={18} /></button>
    </div>
  );
}
