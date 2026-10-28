import { test, expect } from '@playwright/test';
import type { Page, Browser } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * D-079 UX/UI 가이드 화면 측정 (docs/uxui). 폰(iPhone 13)과 PC(1280)에서 주요 화면을 돌며
 * 화면당 채운 주 버튼 수(M05)·44pt 미만(M10)·가로 스크롤·상자 실선(M01)·키보드 초점 링(M16)·blur 뒤 검증(M08)을 잰다.
 * 줄바꿈 뒤 줄머리 닫는 문장부호·줄끝 여는 따옴표/괄호(punct_breaks)도 잰다.
 * iphone-chromium 결과를 reports/uxui-runtime.json 에 남기고(모든 expect 가 통과한 뒤에만) tools/uxui_audit.ts 가 읽는다.
 * code_hash = src/ui/*.ts(x) + src/ui/screens/*.ts(x) (경로 정렬) + styles.css(맨 끝)의 sha256 앞 16자리 — 측정 뒤 화면 코드가 바뀌었는지 알아보는 표.
 */
type Row = { screen: string; view: string; primary: number; primaryNames: string[]; small: string[]; hscroll: boolean; lineBoxes: number; punct: string[] };

async function measure(page: Page, screen: string, view: string): Promise<Row> {
  await page.waitForLoadState('networkidle');
  return { screen, view, ...(await page.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const outSheet = (el: Element) => !el.closest('.sheet');
    const prim = [...document.querySelectorAll('button.primary, .btn.primary')].filter((el) => vis(el) && outSheet(el));
    const primary = prim.length, primaryNames = prim.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24));
    const small = [...document.querySelectorAll<HTMLElement>('button, input:not([type=checkbox]), select, [role=button], nav a, a.btn, a.banner')]
      .filter((el) => vis(el) && (el.getBoundingClientRect().width < 43.5 || el.getBoundingClientRect().height < 43.5))
      .map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
    const lineBoxes = [...document.querySelectorAll('.card, .panel, .wk-metrics, button.wcard, .notice')]
      .filter((el) => vis(el) && !el.matches('.is-hidden, .active, .dragging, .all-done') && (() => { const cs = getComputedStyle(el); return cs.borderTopStyle === 'solid' && parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopColor !== 'rgba(0, 0, 0, 0)'; })()).length;
    // 줄머리 닫는 부호(, . ) 」 』 ’ ”) · 줄끝 여는 따옴표/괄호(' ‘ “ ( 「): 줄바꿈 된 글 마디만, 마디 안 줄바꿈 자리만 본다
    const CLOSE = ',.)」』’”', OPEN = '‘“(「';
    const punct: string[] = [];
    const main = document.querySelector('main');
    if (main) {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const el = n.parentElement;
        if (!el || n.data.trim().length < 3 || !el.closest('p, li, span') || !vis(el)) continue;
        range.selectNodeContents(n);
        if (range.getClientRects().length < 2) continue;
        const lines: { top: number; s: number; e: number }[] = [];
        for (let i = 0; i < n.length; i++) {
          if (/\s/.test(n.data[i]!)) continue;
          range.setStart(n, i); range.setEnd(n, i + 1);
          const r = range.getClientRects()[0];
          if (!r || !r.width) continue;
          const last = lines[lines.length - 1];
          if (last && Math.abs(r.top - last.top) <= 3) last.e = i; else lines.push({ top: r.top, s: i, e: i });
        }
        lines.forEach((l, k) => {
          const head = n.data[l.s]!, tail = n.data[l.e]!;
          const openQuote = tail === "'" && (l.e === 0 || /\s/.test(n.data[l.e - 1]!)); // 곧은 따옴표는 앞이 공백일 때만 여는 따옴표
          if (k > 0 && CLOSE.includes(head)) punct.push(`줄머리 "${n.data.slice(l.s, l.s + 14)}"`);
          if (k < lines.length - 1 && (OPEN.includes(tail) || openQuote)) punct.push(`줄끝 "${n.data.slice(Math.max(l.s, l.e - 13), l.e + 1)}"`);
        });
      }
    }
    return { primary, primaryNames, small, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, lineBoxes, punct };
  })) };
}

/** 지연 로딩 화면: 뼈대(.skel)가 사라지고, 색 전환(200ms)이 끝나면 잼 */
async function settle(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.skel'));
  await page.waitForTimeout(250);
  await expect(page.locator('main').first()).toBeVisible();
}
/** 화면 전체 스크린샷 (문서 높이 16000px 넘거나, 기기 픽셀로 32000 넘으면(엔진 한도 32767) 보이는 만큼만) */
async function shot(page: Page, view: string, label: string) {
  const { css, px } = await page.evaluate(() => ({ css: document.documentElement.scrollHeight, px: document.documentElement.scrollHeight * (window.devicePixelRatio || 1) }));
  const fullPage = css <= 16000 && px <= 32000;
  // 전체 화면 사진에서는 고정 막대(탭·타이머·알림)가 첫 화면 바닥에 찍혀 글을 가리므로, 사진 찍을 때만 문서 흐름(static)으로 내리고 가림막은 숨김 (3차 검토 D1)
  await page.screenshot({ path: `reports/screens/${test.info().project.name}-uxui-${view}-${label.replace(/[#/:]+/g, '_').replace(/^_|_$/g, '') || 'home'}.png`, fullPage, style: fullPage && view === 'phone' ? '.nav, .timer, .toast, .app-toast, .banner { position: static !important; } .nav-scrim { display: none !important; }' : undefined }); // PC 왼쪽 메뉴는 글을 가리지 않으므로 그대로 (4차 검토 E1)
}
/** 지금 화면을 재고 스크린샷 */
async function snap(page: Page, view: string, label: string, rows: Row[]) {
  await settle(page);
  rows.push(await measure(page, label, view));
  await shot(page, view, label);
}
function codeHash(): string {
  const tsx = (d: string) => readdirSync(d).filter((f) => /\.tsx?$/.test(f)).map((f) => `${d}/${f}`); // 화면 동작 .ts 도 포함 (3차 검토 D3)
  const h = createHash('sha256');
  for (const f of [...tsx('src/ui'), ...tsx('src/ui/screens')].sort()) h.update(readFileSync(f, 'utf8'));
  h.update(readFileSync('src/ui/styles.css', 'utf8'));
  return h.digest('hex').slice(0, 16);
}

/** L-01 WebKit 줄 끝 문장부호 상한: 측정값보다 늘면 실패 (줄면 이 값도 내림). mapping runtime_gates 와 같은 값 */
const WEBKIT_PUNCT_MAX = 32; // 시험 데이터 시각을 고정한 뒤 측정값 (늘면 실패, 줄면 이 값도 내림)
type Obj = Record<string, unknown>;
const MIN = 60_000, DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const idbPut = (page: Page, store: string, rows: Obj[]) => page.evaluate(async ([s, rs]) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, [store, rows] as const);
const single = (ex: string, sets: Obj[]) => ({ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: ex, target: { sets: sets.length, reps: 10 }, sets }] });
const doneSet = (weight: number, reps: number, at: number) => ({ weight, reps, warmup: false, done: true, doneAt: iso(at) });

async function startUp(page: Page) {
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 기기에만 저장돼요')).toBeVisible();
  await page.getByRole('button', { name: '알겠어요' }).click();
}
async function pickPart(p: Page, part: string) {
  await p.getByRole('button', { name: `${part} 선택 안 함` }).click();
  await p.getByRole('dialog', { name: `${part} 우선순위` }).getByRole('button', { name: '완료' }).click();
}
const SCREENS = ['#/', '#/routines', '#/plan', '#/stats', '#/exercises', '#/settings', '#/settings/about', '#/tools', '#/recovery', '#/stats/new'];

/** 주소로 가서 재기 (주소가 바뀐 뒤 뼈대가 사라질 때까지 기다림) */
async function visit(page: Page, h: string, view: string, rows: Row[]) {
  await page.evaluate((x) => { location.hash = x; }, h);
  await page.waitForFunction((x) => (location.hash || '#/') === x && !document.querySelector('.skel'), h);
  await expect(page.locator('main h1').first()).toBeVisible();
  await snap(page, view, h, rows);
}
async function tour(page: Page, view: string, rows: Row[]) {
  for (const h of SCREENS) {
    await visit(page, h, view, rows);
    if (h === '#/stats') { // 기록 탭은 세 탭을 각각 잰다 (요약 → 운동 기록 → 분석 → 요약)
      for (const [tab, suffix] of [['운동 기록', 'log'], ['분석', 'analysis']] as const) { await page.getByRole('tab', { name: tab }).click(); await snap(page, view, `#/stats_${suffix}`, rows); }
      await page.getByRole('tab', { name: '요약' }).click();
    }
  }
}
/** 등 30분 플랜을 만들어 루틴으로 저장 (홈에 루틴이 생김) */
async function makeRoutine(page: Page, view: string, rows: Row[]) {
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '등');
  await page.getByRole('button', { name: '30분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  await expect(page.getByRole('region', { name: '생성된 플랜' })).toBeVisible();
  rows.push(await measure(page, '#/plan (결과)', view));
  await page.getByRole('button', { name: '루틴으로 저장', exact: true }).click();
  await page.getByRole('button', { name: '저장만' }).click();
}

test('D-079 화면 측정: 주 버튼 1개·44pt·가로 스크롤 0·상자 실선 0·초점 링·blur 뒤 검증', async ({ page, browser }, info) => {
  test.setTimeout(120_000); // 기록 탭 3개를 각각 재고 찍어 WebKit 에서 60초를 넘음
  const rows: Row[] = [];
  await startUp(page);
  rows.push(await measure(page, '#/ (빈 홈)', 'phone'));
  // 루틴 하나 만들기 → 데이터가 있는 화면
  await makeRoutine(page, 'phone', rows);
  await tour(page, 'phone', rows);
  // 루틴 편집 화면: 홈 루틴 카드 ⋯ → 편집
  await page.evaluate(() => { location.hash = '#/'; });
  await page.locator('.routine-card').first().getByRole('button', { name: / 메뉴$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: / 편집$/ }).click();
  await expect(page).toHaveURL(/#\/routine\/[^/]+$/);
  await snap(page, 'phone', '#/routine/:id', rows);
  // 운동 중 화면
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  rows.push(await measure(page, '#/workout', 'phone'));

  // M16 키보드 초점 링: Tab 으로 옮긴 요소에 outline 이 보임
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; const cs = el ? getComputedStyle(el) : null; return !!cs && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });

  // 세트 하나 완료 → 끝내기 → 기록 상세 → [수정] (끝낸 운동 고치기)
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  await page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
  await page.getByRole('group', { name: /^최근 운동 / }).first().locator('button.wcard').click(); // 끝내면 홈으로 → 최근 운동 카드로 상세
  await expect(page).toHaveURL(/#\/stats\/w\/[^/]+$/);
  await snap(page, 'phone', '#/stats/w/:id', rows);
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await expect(page.getByRole('button', { name: '기록 저장하기' })).toBeVisible();
  await snap(page, 'phone', '#/stats/w/:id/edit', rows);

  // 운동 지우기 → [되돌리기] (D-079 Undo): 초점은 되돌리기로, 누르면 카드 복귀 / 5초 지나면 알림만 사라지고 초점은 + 운동 추가로
  const first = page.getByRole('group', { name: / 세트 고치기$/ }).first();
  const exName = ((await first.getAttribute('aria-label')) ?? '').replace(/ 세트 고치기$/, '');
  const card = page.getByRole('group', { name: `${exName} 세트 고치기` });
  const toast = page.locator('.toast');
  const live = page.locator('p.sr-only[role="status"]');
  await page.getByRole('button', { name: `${exName} 운동 지우기` }).click();
  await expect(card).toHaveCount(0);
  await expect(toast.getByRole('button', { name: '되돌리기' })).toBeFocused();
  await expect(live).toContainText('뺐어요');
  await toast.getByRole('button', { name: '되돌리기' }).click();
  await expect(card).toHaveCount(1);
  await expect(toast).toHaveCount(0);
  await page.getByRole('button', { name: `${exName} 운동 지우기` }).click();
  await expect(card).toHaveCount(0);
  await expect(toast).toHaveCount(1);
  await page.waitForTimeout(5500);
  await expect(toast).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(live).toHaveText('');
  await expect(page.getByRole('button', { name: '+ 운동 추가' })).toBeFocused();
  await page.getByRole('button', { name: '취소', exact: true }).first().click();
  await page.locator('.sheet[aria-modal="true"]').getByRole('button', { name: '버리기', exact: true }).click();
  await expect(page).toHaveURL(/#\/stats\/w\/[^/]+$/);

  // 운동 정보·워치·근거 논문
  await visit(page, '#/exercises', 'phone', []);
  await page.locator('.ex-row').first().click();
  await expect(page).toHaveURL(/#\/exercises\/[^/]+$/);
  await snap(page, 'phone', '#/exercises/:id', rows);
  await visit(page, '#/settings/watch', 'phone', rows);
  await visit(page, '#/recovery/papers', 'phone', rows);

  // M08·M13 운동 직접 추가: 입력 중엔 조용, 칸을 벗어나면 같은 이름 경고 / 빈 이름으로 눌러도 버튼은 살아 있고 칸으로 초점
  await page.evaluate(() => { location.hash = '#/exercises'; });
  await page.getByRole('button', { name: '운동 직접 추가' }).click();
  const sheet = page.getByRole('dialog', { name: '운동 직접 추가' });
  const nameBox = sheet.getByLabel('운동 이름');
  await nameBox.fill('원암 랫풀다운');
  const whileTyping = await sheet.locator('.field-err').count();
  await nameBox.blur();
  await expect(sheet.locator('.field-err')).toHaveText('같은 이름의 운동이 이미 있어요');
  await nameBox.fill('');
  const add = sheet.getByRole('button', { name: '운동 추가하기' });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet.locator('.field-err')).toHaveText('운동 이름을 적어 주세요');
  await expect(nameBox).toBeFocused();
  await expect(nameBox).toHaveAttribute('aria-invalid', 'true');
  const onBlur = whileTyping === 0;

  // N4 기록 정리 카드(4구역)가 떠 있는 #/stats: 구역 버튼이 4개여도 채운 주 버튼은 1개 이하 (usage.spec 'D-065' 기록 시드와 같은 방식)
  const day = Math.floor((Date.now() + 9 * 3600_000) / DAY) * DAY - 9 * 3600_000 - 3 * DAY + 12 * 3600_000, d2 = day - 2 * DAY; // 3일 전 정오(KST) 고정: 실행 시각에 따라 '마지막 세트 오전/오후 H:MM' 문구가 달라져 줄바꿈 수가 흔들리지 않게
  await idbPut(page, 'workouts', [
    { id: 'f-late', name: '늦게 끝냄', startedAt: iso(day), endedAt: iso(day + 90 * MIN), timer: null, blocks: [single('barbell_curl', [doneSet(30, 10, day + 20 * MIN), doneSet(30, 10, day + 40 * MIN)])] },
    { id: 'f-long', name: '25시간 기록', startedAt: iso(d2), endedAt: iso(d2 + 25 * 60 * MIN), timer: null,
      blocks: [single('rope_pushdown', [doneSet(30, 10, d2 + 10 * MIN), doneSet(30, 10, d2 + 50 * MIN), doneSet(30, 10, d2 + 25 * 60 * MIN - MIN)])] },
    { id: 'f-empty', name: '빈 기록', startedAt: iso(day + 3 * 3600000), endedAt: iso(day + 3 * 3600000 + MIN), timer: null, blocks: [single('barbell_curl', [{ warmup: false, done: false, reps: 10 }])] },
    { id: 'f-warm', name: '웜업 기록', startedAt: iso(day + 5 * 3600000), endedAt: iso(day + 5 * 3600000 + 12 * MIN), timer: null,
      blocks: [single('barbell_curl', [doneSet(20, 15, day + 5 * 3600000 + 2 * MIN), doneSet(50, 8, day + 5 * 3600000 + 5 * MIN), doneSet(50, 8, day + 5 * 3600000 + 9 * MIN)])] },
  ]);
  await page.reload();
  await expect(page.locator('main h1').first()).toBeVisible();
  await visit(page, '#/stats', 'phone', rows);
  const fixCard = page.getByTestId('record-fix');
  await expect(fixCard).toBeVisible();
  await fixCard.getByRole('button', { name: '정리하기' }).click(); // 접힌 한 줄 → 펼친 4구역도 잰다
  for (const id of ['fix-end', 'fix-long', 'fix-empty', 'fix-warm']) await expect(fixCard.getByTestId(id)).toBeVisible();
  rows.push(await measure(page, '#/stats (기록 정리 카드 4구역)', 'phone'));
  const fixRow = rows[rows.length - 1]!;
  const fixPrimary = fixRow.primary;

  // PC 넓은 화면 (1280)
  const pc = await (browser as Browser).newContext({ viewport: { width: 1280, height: 860 } });
  const pp = await pc.newPage();
  await startUp(pp);
  await makeRoutine(pp, 'pc', rows);
  await tour(pp, 'pc', rows);
  await pp.evaluate(() => { location.hash = '#/'; });
  await pp.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(pp.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  rows.push(await measure(pp, '#/workout', 'pc'));
  await shot(pp, 'pc', '#/workout');
  await pc.close();

  const bad = (f: (r: Row) => boolean) => rows.filter(f).map((r) => `${r.view} ${r.screen}`);
  const out = {
    code_hash: codeHash(),
    primary_per_screen: { value: Math.max(...rows.map((r) => r.primary)), evidence: rows.map((r) => `${r.view} ${r.screen}: ${r.primary}${r.primary > 1 ? ` (${r.primaryNames.join(' / ')})` : ''}`) },
    touch_under_44: { value: rows.reduce((n, r) => n + r.small.length, 0), evidence: rows.flatMap((r) => r.small.map((s) => `${r.view} ${r.screen} ${s}`)) },
    hscroll_screens: { value: bad((r) => r.hscroll).length, evidence: bad((r) => r.hscroll) },
    line_boxes: { value: rows.reduce((n, r) => n + r.lineBoxes, 0), evidence: rows.filter((r) => r.lineBoxes).map((r) => `${r.view} ${r.screen}: ${r.lineBoxes}`) },
    focus_ring: { value: ring, evidence: ['운동 화면 Tab 1회'] },
    validation_on_blur: { value: onBlur, evidence: ['운동 직접 추가: 입력 중 경고 0 → blur 뒤 경고, 빈 이름 클릭 → 오류·초점'] },
    punct_breaks: { value: rows.reduce((n, r) => n + r.punct.length, 0), evidence: rows.flatMap((r) => r.punct.map((p) => `${r.view} ${r.screen} ${p}`)) },
  };
  // 엔진별 자세한 값 (조사용): 실패해도 남김. reports/uxui-runtime.json 은 아래 expect 가 모두 통과한 뒤에만 씀 (실패한 실행이 새 code_hash 를 남기지 않게)
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/uxui-runtime-${info.project.name}.json`, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'string' ? v : v.value]))));
  expect(out.primary_per_screen.evidence.filter((e) => !/: [01]$/.test(e)), '화면당 채운 주 버튼 1개 이하 (M05)').toEqual([]);
  expect(out.touch_under_44.evidence, '44pt 미만 (M10)').toEqual([]);
  expect(out.hscroll_screens.evidence, '가로 스크롤 (7.1)').toEqual([]);
  expect(out.line_boxes.evidence, '상자 실선 (M01)').toEqual([]);
  expect(ring, '키보드 초점 링 (M16)').toBe(true);
  expect(onBlur, '입력 중 경고 없음 (M08)').toBe(true);
  expect(fixPrimary, '기록 정리 카드가 뜬 #/stats 의 채운 주 버튼 (N4)').toBeLessThanOrEqual(1);
  // WebKit 은 word-break: keep-all 일 때 ( 뒤·, . ) 앞에서도 줄을 바꾼다 (L-01: line-break·overflow-wrap·U+2060 로는 못 막음, 마크업 감싸기만 효과 — 제안 P-03).
  // Chromium 은 0, WebKit(아이폰 엔진)은 늘지 않게 상한 (3차 검토 D4: 엔진이 다르면 실제 대상 엔진도 판정)
  if (info.project.name === 'iphone-chromium') expect(out.punct_breaks.evidence, '줄머리 닫는 부호·줄끝 여는 따옴표/괄호').toEqual([]);
  else expect(out.punct_breaks.value, 'WebKit 줄 끝 문장부호 상한 (L-01)').toBeLessThanOrEqual(WEBKIT_PUNCT_MAX);
  mkdirSync('reports', { recursive: true });
  writeFileSync(info.project.name === 'iphone-chromium' ? 'reports/uxui-runtime.json' : `reports/uxui-runtime-${info.project.name}.json`, JSON.stringify(out, null, 2) + '\n');
});

// N9 눌러도 늘 켜져 있는 버튼 → 빈 칸이면 role=alert 문구 + 그 칸으로 초점 (화면마다 하나씩)
test('N9 기록 정리: 아무것도 안 고르고 누르면 알림 + 첫 체크 상자로 초점', async ({ page }) => {
  await startUp(page);
  const day = Date.now() - 3 * DAY;
  await idbPut(page, 'workouts', [{ id: 'f-late', name: '늦게 끝냄', startedAt: iso(day), endedAt: iso(day + 90 * MIN), timer: null, blocks: [single('barbell_curl', [doneSet(30, 10, day + 20 * MIN), doneSet(30, 10, day + 40 * MIN)])] }]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await page.getByTestId('record-fix').getByRole('button', { name: '정리하기' }).click();
  const sec = page.getByTestId('record-fix').getByTestId('fix-end');
  const box = sec.getByRole('checkbox').first();
  await box.uncheck();
  await sec.getByRole('button', { name: '끝난 시각 고치기 (0건)' }).click();
  await expect(sec.getByRole('alert')).toHaveText('고칠 항목을 1개 이상 골라 주세요');
  await expect(box).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('N9 루틴 편집: 운동 없이 [저장하고 시작] → 알림 + [+ 운동 추가]로 초점', async ({ page }) => {
  await startUp(page);
  await page.evaluate(() => { location.hash = '#/routines'; });
  await page.getByRole('button', { name: '+ 직접', exact: true }).click();
  await expect(page).toHaveURL(/#\/routine\/[^/]+$/);
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page.getByRole('alert')).toHaveText('운동을 1개 이상 추가해 주세요');
  await expect(page.getByRole('button', { name: '+ 운동 추가' })).toBeFocused();
});

test('N9 루틴 이름 바꾸기: 빈 이름 → 알림 + 입력 칸으로 초점', async ({ page }) => {
  await startUp(page);
  const mk = (id: string, name: string, ago: number, ex: string) => ({ id, name, createdAt: iso(Date.now() - ago), updatedAt: iso(Date.now() - ago), warmupSec: 480, blocks: [{ kind: 'single', items: [{ exerciseId: ex, sets: 3, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 }] });
  await idbPut(page, 'routines', [mk('r-old', '하체 75분', 4 * DAY, 'back_squat'), mk('r-new', '하체 75분', 2 * DAY, 'hack_squat')]);
  await page.reload();
  await page.evaluate(() => { location.hash = '#/routines'; });
  await page.getByTestId('dup-note').getByRole('button', { name: /이름 바꾸기$/ }).click();
  const sh = page.getByRole('dialog', { name: '루틴 이름 바꾸기' });
  const input = sh.getByLabel('새 루틴 이름');
  await input.fill('');
  await sh.getByRole('button', { name: '이름 바꾸기', exact: true }).click();
  await expect(sh.getByRole('alert')).toHaveText('루틴 이름을 적어 주세요');
  await expect(input).toBeFocused();
});

test('N9 개선 메모: 빈 내용으로 저장 → 알림 + 글 칸으로 초점', async ({ page }) => {
  await startUp(page);
  await page.getByRole('button', { name: '개선 메모 쓰기' }).click();
  await page.getByRole('button', { name: '메모 저장하기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '내용을 적어 주세요' })).toBeVisible();
  await expect(page.getByLabel('개선 메모 내용')).toBeFocused();
});

test('N9 자동 보내기: 빈 설정으로 [저장하고 연결 확인] → 알림 + 입력 칸으로 초점', async ({ page }) => {
  await startUp(page);
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '설정 글(https://…#…)을 붙여 넣어 주세요' })).toBeVisible();
  await expect(page.getByLabel('자동 보내기 설정 붙여넣기')).toBeFocused();
});

test('A05 필터 결과 0건: 진짜 0건과 구분해 [필터 초기화] → 목록이 돌아옴', async ({ page }) => {
  await startUp(page);
  await page.evaluate(() => { location.hash = '#/exercises'; });
  const search = page.getByLabel('운동 검색');
  await search.fill('없는운동이름zzz');
  await expect(page.getByText('검색 결과가 없어요')).toBeVisible();
  await page.getByRole('button', { name: '필터 초기화' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByText('검색 결과가 없어요')).toHaveCount(0);
  await expect(page.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
});

test('A05 루틴 검색 0건: [검색어 지우기] → 목록이 돌아오고 초점은 검색 칸', async ({ page }) => {
  await startUp(page);
  const mk = (id: string, name: string, ago: number, ex: string) => ({ id, name, createdAt: iso(Date.now() - ago), updatedAt: iso(Date.now() - ago), warmupSec: 480, blocks: [{ kind: 'single', items: [{ exerciseId: ex, sets: 3, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 }] });
  await idbPut(page, 'routines', ['가슴', '등', '하체', '어깨', '팔'].map((n, i) => mk(`r-${i}`, `${n} 루틴`, (i + 1) * DAY, 'back_squat')));
  await page.reload();
  await expect(page.locator('main h1').first()).toBeVisible(); // WebKit: 다시 읽은 뒤 앱이 준비되기 전 주소를 바꾸면 루틴을 못 읽은 채 그려짐
  await page.evaluate(() => { location.hash = '#/routines'; });
  await expect(page.getByText('가슴 루틴', { exact: true }).first()).toBeVisible();
  const search = page.getByLabel('루틴 검색');
  await search.fill('없는루틴zzz');
  await page.getByRole('button', { name: '검색어 지우기', exact: true }).last().click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByText('가슴 루틴', { exact: true }).first()).toBeVisible();
});
