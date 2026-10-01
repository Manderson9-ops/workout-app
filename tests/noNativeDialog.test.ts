/**
 * 브라우저 기본 confirm/alert/prompt를 쓰지 않는다 (D-039).
 * 이유: 기본 창은 PC 브라우저·에이전트가 붙은 탭 등에서 화면에 안 뜨고 바로 "취소"가 될 수 있어,
 * 삭제·끝내기 같은 버튼이 아무 표시 없이 안 되는 일이 생겼다. 앱 안 확인 창(askConfirm·askChoice·showNotice)을 쓴다.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { askChoice, showNotice } from '../src/ui/confirm';
import { db } from '../src/ui/store';
import { flushDiag } from '../src/ui/diag';

/**
 * 기본 창을 쓰는 곳을 찾음. 주석·문자열을 먼저 지운 뒤 이름 자체를 찾음 (부르기·담기·넘기기 모두).
 * 제외: 다른 객체의 같은 이름 메서드(x.confirm), 객체 키(confirm:), 더 긴 이름(askConfirm, confirmed).
 * 대괄호로 부르기(window['alert'])는 문자열을 지우기 전에 따로 찾음.
 * 사각지대(알고 둠): 템플릿 문자열 안 ${confirm()},  ? confirm : b, 구조 분해 { confirm: c } = window, 따옴표가 섞인 JSX 글 뒤 같은 줄.
 * 그래서 e2e도 기본 창이 하나라도 뜨면 실패하게 둠 (지나가는 화면만).
 */
export function nativeDialogCalls(src: string): string[] {
  const bracket = [...src.matchAll(/(?:window|globalThis|self)\s*(?:\?\.)?\[\s*['"`](confirm|alert|prompt)['"`]\s*\]/g)].map((m) => m[0]);
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, ' ');
  const named = [...code.matchAll(/(?:(?:window|globalThis|self)\s*\??\.\s*)?(?<![\w$.])\b(confirm|alert|prompt)\b(?!\s*:)/g)].map((m) => m[0]);
  const global = [...code.matchAll(/(?:window|globalThis|self)\s*\??\.\s*(confirm|alert|prompt)\b/g)].map((m) => m[0]);
  return [...bracket, ...named, ...global];
}

const files = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
});

describe('기본 확인·알림 창 0개 (D-039)', () => {
  it('찾는 규칙이 실제로 잡음 (음성 대조)', () => {
    for (const bad of [`if (confirm('x')) a();`, `window.alert('y');`, `globalThis.prompt('z')`, `window?.confirm('a')`, `window['alert']('b')`, `const c = window.confirm; c('x')`, `const u = 'a//b'; confirm('c')`, `[1].forEach(alert)`])
      expect(nativeDialogCalls(bad), bad).not.toHaveLength(0);
    expect(nativeDialogCalls(`askConfirm({}); x.confirm(1); const confirmed = 1; // confirm('주석')\n/* alert('주석') */ const s = 'confirm 글자'; const o = { alert: 1 }; <p role="alert">x</p>`)).toEqual([]);
  });
  it('src 전체에 기본 창 호출이 없음', () => {
    const found = files('src').flatMap((f) => nativeDialogCalls(readFileSync(f, 'utf8')).map((c) => `${f}: ${c}`));
    expect(found).toEqual([]);
  });
});

describe('askChoice·showNotice (띄울 곳이 없을 때)', () => {
  it('askChoice는 취소(false)로 끝나고 멈추지 않음 → 두 번째 선택지 일을 하지 않음', async () => {
    await db.diag.clear();
    expect(await askChoice({ title: '시험', ok: 'A', alt: 'B' })).toBe(false);
    await flushDiag();
    expect((await db.diag.toArray()).filter((d) => d.k === 'error').map((d) => d.m)).toContain('확인 창을 띄울 곳이 없음');
  });
  it('showNotice도 멈추지 않고 끝남', async () => {
    await expect(showNotice('시험')).resolves.toBeUndefined();
  });
});
