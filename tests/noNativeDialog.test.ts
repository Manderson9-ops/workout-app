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

/** 주석을 뺀 코드에서 기본 창 호출을 찾음 (obj.confirm(...) 같은 메서드는 제외) */
export function nativeDialogCalls(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...code.matchAll(/(?<![\w.$])(?:window\.|globalThis\.|self\.)?(confirm|alert|prompt)\s*\(/g)].map((m) => m[0]);
}

const files = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
});

describe('기본 확인·알림 창 0개 (D-039)', () => {
  it('찾는 규칙이 실제로 잡음 (음성 대조)', () => {
    expect(nativeDialogCalls(`if (confirm('x')) a(); window.alert('y'); globalThis.prompt('z')`)).toHaveLength(3);
    expect(nativeDialogCalls(`askConfirm({}); x.confirm(1); // confirm('주석')\n/* alert('주석') */ const s = 'confirm 글자';`)).toHaveLength(0);
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
