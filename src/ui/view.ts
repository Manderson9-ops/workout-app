/**
 * "폰 화면으로 보기" (D-030): PC에서도 폰과 똑같은 폭·배치로. 폰 화면 문제를 PC에서 재현·확인할 때
 */
import { lsGet, lsSet } from './appName';

export const phoneView = () => lsGet('view.phone') === '1';
export function applyView(): void { document.documentElement.classList.toggle('phone-view', phoneView()); }
export function setPhoneView(on: boolean): void { lsSet('view.phone', on ? '1' : '0'); applyView(); }
