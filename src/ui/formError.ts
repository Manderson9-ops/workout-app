/** 잘못된 입력칸을 화면 가운데로 스크롤하고 초점 (모션 줄이기 설정이면 즉시 이동) */
export function focusField(el: HTMLElement | null): void {
  if (!el) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}
