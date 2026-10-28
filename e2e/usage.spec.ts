/**
 * 사용 분석 개선 1단계 화면 시험 (D-065 끝내기 시각·띠·기록 정리, D-066 묶음 라운드, D-070 웜업 미리 표시, D-072 빈 운동)
 * 기록·루틴은 저장소(IndexedDB)에 직접 넣어 시작 (시간이 지난 상황을 바로 만듦)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });
/** 가로 스크롤 없음, 44pt 터치 영역 (app.spec.ts 와 같은 검사) */
async function checkScreen(page: Page, name: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, '가로 스크롤').toBeLessThanOrEqual(r.cw);
  const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, input:not([type=checkbox]), select, [role=button], nav a, a.btn, a.banner')]
    .filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (b.width < 43.5 || b.height < 43.5); })
    .map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`));
  expect(bad, '44pt 미만 터치 영역').toEqual([]);
  await shot(page, name);
}

const nativeDialogs: string[] = [];
test.beforeEach(async ({ page }) => {
  nativeDialogs.length = 0;
  page.on('dialog', (d) => { nativeDialogs.push(`${d.type()}: ${d.message()}`); void d.dismiss().catch(() => undefined); });
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 기기에만 저장돼요')).toBeVisible();
  await page.getByRole('button', { name: '알겠어요' }).click();
});
test.afterEach(() => { expect(nativeDialogs, '브라우저 기본 확인·알림 창 (D-039)').toEqual([]); });

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
type Row = Record<string, unknown>;
const idbPut = (page: Page, store: string, rows: Row[]) => page.evaluate(async ([s, rs]) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, [store, rows] as const);
const idbAll = (page: Page, store: string) => page.evaluate(async (s) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out = await new Promise<Row[]>((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result as Row[]); });
  db.close();
  return out;
}, store);
type W = { id: string; endedAt?: string; editedAt?: string; timer?: { kind: string } | null; blocks: { items: { sets: { warmup: boolean; done: boolean; weight?: number }[] }[] }[] };
const workouts = async (page: Page) => (await idbAll(page, 'workouts')) as unknown as W[];
const single = (ex: string, sets: Row[]) => ({ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: ex, target: { sets: sets.length, reps: 10 }, sets }] });
const doneSet = (weight: number, reps: number, at: number, warmup = false) => ({ weight, reps, warmup, done: true, doneAt: iso(at) });
const routine = (id: string, name: string, blocks: Row[]) => ({ id, name, createdAt: iso(Date.now() - 86400000), updatedAt: iso(Date.now() - 86400000), blocks });

test('D-065 "운동 끝났나요?" 띠: 휴식 중엔 안 뜸, 30분 지나면 뜸, 아직 하는 중이면 다시 안 뜸 · 끝내기(마지막 세트 + 3분)', async ({ page }) => {
  const now = Date.now();
  const last = now - 40 * MIN;
  const active = { id: 'w-act1', name: '띠 시험', startedAt: iso(now - 60 * MIN), timer: { startedAt: now, endsAt: now + 120_000, label: '세트 간 휴식', kind: 'set' },
    blocks: [single('barbell_curl', [doneSet(30, 10, last), { warmup: false, done: false, weight: 30, reps: 10 }])] };
  await idbPut(page, 'workouts', [active]);
  await page.reload();
  await expect(page.getByRole('link', { name: '운동 계속하기' })).toBeVisible();
  await expect(page.getByRole('region', { name: '운동 끝났나요?' })).toHaveCount(0); // 휴식 타이머가 도는 중
  // 타이머 없이 → 다시 열면 띠
  await idbPut(page, 'workouts', [{ ...active, timer: null }]);
  await page.reload();
  const band = page.getByRole('region', { name: '운동 끝났나요?' });
  await expect(band).toContainText('마지막 세트:');
  await expect(band.getByRole('button', { name: /^끝내기 \(마지막 세트 \+ 3분 · (어제 )?오[전후] \d+:\d{2}\)$/ })).toBeVisible();
  await checkScreen(page, 'u01-end-ask-banner');
  await band.getByRole('button', { name: '아직 하는 중' }).click();
  await expect(band).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: '운동 계속하기' })).toBeVisible();
  await expect(page.getByRole('region', { name: '운동 끝났나요?' })).toHaveCount(0); // 그 운동에서는 다시 안 띄움
  // 다른 운동: 띠의 끝내기 → 끝난 시각 = 마지막 세트 + 3분
  await idbPut(page, 'workouts', [{ ...active, endedAt: iso(now), timer: null }, { ...active, id: 'w-act2', name: '띠 시험 2', timer: null }]);
  await page.reload();
  await page.getByRole('region', { name: '운동 끝났나요?' }).getByRole('button', { name: /^끝내기 \(마지막 세트/ }).click();
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect.poll(async () => (await workouts(page)).find((w) => w.id === 'w-act2')?.endedAt).toBe(iso(last + 3 * MIN));
});

test('D-065 끝내기: 마지막 세트 뒤 15분 넘으면 "마지막 세트 + 3분 / 지금" 고르기', async ({ page }) => {
  const now = Date.now();
  const last = now - 20 * MIN;
  await idbPut(page, 'workouts', [{ id: 'w-fin', name: '끝내기 시험', startedAt: iso(now - 50 * MIN), timer: null,
    blocks: [single('barbell_curl', [doneSet(30, 10, last - 2 * MIN), doneSet(30, 10, last), { warmup: false, done: false, weight: 30, reps: 10 }])] }]);
  await page.reload();
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '운동을 끝낼까요?' });
  await expect(dlg).toContainText('아직 1세트 남았어요.');
  await expect(dlg).toContainText('끝난 시각을 언제로 할까요?');
  await expect(dlg.getByRole('button', { name: '취소' })).toBeFocused(); // Enter 한 번으로 정하지 않게
  await expect(dlg.getByRole('button', { name: /^지금 \(오[전후] \d+:\d{2}\)$/ })).toBeVisible();
  await checkScreen(page, 'u02-finish-time-choice');
  await dlg.getByRole('button', { name: /^마지막 세트 \+ 3분/ }).click();
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect.poll(async () => (await workouts(page)).find((w) => w.id === 'w-fin')?.endedAt).toBe(iso(last + 3 * MIN));
});

test('D-065·D-070·D-072 기록 정리 카드: 목록 → 확인 → 끝난 시각·긴 기록·빈 기록·웜업 고침, 고르지 않은 것은 다시 안 물음', async ({ page }) => {
  const day = Date.now() - 3 * 86400000;
  const d2 = day - 2 * 86400000;
  const ws = [
    { id: 'f-late', name: '늦게 끝냄', startedAt: iso(day), endedAt: iso(day + 90 * MIN), timer: null, blocks: [single('barbell_curl', [doneSet(30, 10, day + 20 * MIN), doneSet(30, 10, day + 40 * MIN)])] },
    { id: 'f-late2', name: '그대로 둘 기록', startedAt: iso(day - 86400000), endedAt: iso(day - 86400000 + 90 * MIN), timer: null, blocks: [single('barbell_curl', [doneSet(30, 10, day - 86400000 + 20 * MIN)])] },
    { id: 'f-long', name: '25시간 기록', startedAt: iso(d2), endedAt: iso(d2 + 25 * 60 * MIN), timer: null,
      blocks: [single('rope_pushdown', [doneSet(30, 10, d2 + 10 * MIN), doneSet(30, 10, d2 + 50 * MIN), doneSet(30, 10, d2 + 25 * 60 * MIN - MIN)])] },
    { id: 'f-empty', name: '빈 기록', startedAt: iso(day + 3 * 3600000), endedAt: iso(day + 3 * 3600000 + MIN), timer: null, blocks: [single('barbell_curl', [{ warmup: false, done: false, reps: 10 }])] },
    { id: 'f-warm', name: '웜업 기록', startedAt: iso(day + 5 * 3600000), endedAt: iso(day + 5 * 3600000 + 12 * MIN), timer: null,
      blocks: [single('barbell_curl', [doneSet(20, 15, day + 5 * 3600000 + 2 * MIN), doneSet(50, 8, day + 5 * 3600000 + 5 * MIN), doneSet(50, 8, day + 5 * 3600000 + 9 * MIN)])] },
  ];
  await idbPut(page, 'workouts', ws);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  const card = page.getByTestId('record-fix');
  await expect(card).toContainText(/고칠 만한 기록 \d+건/); // D-079 2차: 접힌 한 줄 (끝난 시각·긴 기록·빈 기록·웜업 합)
  await card.getByRole('button', { name: '정리하기' }).click();
  await expect(card).toContainText('기록 정리 (한 번만)');
  await expect(card.getByTestId('fix-end')).toContainText('늦게 끝냄');
  await expect(card.getByTestId('fix-long')).toContainText('떨어진 세트 1개는 그대로');
  // B2: 새 끝이 원래 끝과 다른 날이면 날짜, 운동 시간 전 → 후
  await expect(card.getByTestId('fix-long')).toContainText(/→ \d+월 \d+일\([일월화수목금토]\) 오[전후] \d+:\d{2} · 25시간 → 53분/);
  await expect(card.getByTestId('fix-empty')).toContainText('빈 기록');
  await expect(card.getByTestId('fix-warm')).toContainText('바벨 컬 20kg × 15회');
  await checkScreen(page, 'u03-record-fix-card');
  // 1) 끝난 시각: '그대로 둘 기록'은 체크를 빼고 하나만 고침
  const endSec = card.getByTestId('fix-end');
  await endSec.locator('li', { hasText: '그대로 둘 기록' }).getByRole('checkbox').uncheck();
  await endSec.getByRole('button', { name: '끝난 시각 고치기 (1건)' }).click();
  const dlg = page.getByRole('dialog', { name: '끝난 시각을 고칠까요?' });
  await expect(dlg).toContainText('늦게 끝냄');
  await expect(dlg).not.toContainText('그대로 둘 기록');
  await checkScreen(page, 'u04-record-fix-confirm');
  await dlg.getByRole('button', { name: '끝난 시각 고치기' }).click();
  await expect.poll(async () => (await workouts(page)).find((w) => w.id === 'f-late')?.endedAt).toBe(iso(day + 43 * MIN));
  expect((await workouts(page)).find((w) => w.id === 'f-late')?.editedAt).toBeTruthy();
  await expect(card.getByTestId('fix-end')).toHaveCount(0); // 고르지 않은 것은 기억해서 다시 안 물음
  // 2) 긴 기록
  await card.getByTestId('fix-long').getByRole('button', { name: '긴 기록 고치기 (1건)' }).click();
  await page.getByRole('dialog', { name: '긴 기록의 끝난 시각을 고칠까요?' }).getByRole('button', { name: '긴 기록 고치기' }).click();
  await expect.poll(async () => (await workouts(page)).find((w) => w.id === 'f-long')?.endedAt).toBe(iso(d2 + 53 * MIN));
  // 3) 빈 기록 지우기
  await card.getByTestId('fix-empty').getByRole('button', { name: '지우기 (1건)' }).click();
  await page.getByRole('dialog', { name: '빈 기록을 지울까요?' }).getByRole('button', { name: '지우기' }).click();
  await expect.poll(async () => (await workouts(page)).some((w) => w.id === 'f-empty')).toBe(false);
  // 4) 웜업
  await card.getByTestId('fix-warm').getByRole('button', { name: '웜업으로 바꾸기 (1건)' }).click();
  await page.getByRole('dialog', { name: '웜업으로 바꿀까요?' }).getByRole('button', { name: '웜업으로 바꾸기' }).click();
  await expect.poll(async () => (await workouts(page)).find((w) => w.id === 'f-warm')?.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(true);
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('this-week')).toBeVisible();
  await expect(page.getByTestId('record-fix')).toHaveCount(0);
  expect((await workouts(page)).find((w) => w.id === 'f-late2')?.endedAt).toBe(ws[1]!.endedAt); // 뺀 기록은 그대로
});

test('D-072 빈 운동: 새로 시작하면 "버리고 새로 시작", 끝내기는 "기록하지 않고 버리기"가 기본, 기록 남기기도 가능', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r-empty', '빈 시험', [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', sets: 2, reps: 10 }] }])]);
  await page.reload();
  const start = page.getByRole('button', { name: /빈 시험 시작$/ }).first();
  await start.click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  const firstId = (await workouts(page))[0]!.id;
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await start.click();
  const ask = page.getByRole('dialog', { name: '진행 중인 운동이 있어요' });
  await expect(ask).toContainText('완료한 세트가 없어요');
  await checkScreen(page, 'u05-discard-on-start');
  await ask.getByRole('button', { name: '버리고 새로 시작' }).click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  await expect.poll(async () => (await workouts(page)).map((w) => w.id)).not.toContain(firstId);
  expect(await workouts(page)).toHaveLength(1);
  // 끝내기: 버리기가 기본(초점)
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '운동을 끝낼까요?' });
  await expect(dlg).toContainText('완료한 세트가 없어요');
  await expect(dlg.getByRole('button', { name: '기록하지 않고 버리기' })).toBeFocused();
  await checkScreen(page, 'u06-discard-on-finish');
  await dlg.getByRole('button', { name: '기록하지 않고 버리기' }).click();
  await expect(page.getByText('기록하지 않고 버렸어요')).toBeVisible();
  await expect.poll(async () => (await workouts(page)).length).toBe(0);
  await expect(page.getByRole('group', { name: /^최근 운동 / })).toHaveCount(0);
  // 기록 남기고 끝내기
  await start.click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  await dlg.getByRole('button', { name: '기록 남기고 끝내기' }).click();
  await expect.poll(async () => (await workouts(page)).filter((w) => w.endedAt).length).toBe(1);
});

test('D-070 웜업 미리 표시: 지난번 가벼운 첫 세트(50% 이하·15회 이상)는 W로, [웜업 W]로 끄고 켜기, 뒤 세트 무게는 그대로', async ({ page }) => {
  const day = Date.now() - 86400000;
  await idbPut(page, 'workouts', [{ id: 'h-warm', name: '지난 팔', startedAt: iso(day), endedAt: iso(day + 10 * MIN), timer: null,
    blocks: [single('barbell_curl', [doneSet(20, 15, day + MIN), doneSet(50, 8, day + 4 * MIN), doneSet(50, 8, day + 7 * MIN)])] }]);
  await idbPut(page, 'routines', [routine('r-arm', '팔 시험', [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', sets: 3, reps: 10 }] }])]);
  await page.reload();
  await page.getByRole('button', { name: /팔 시험 시작$/ }).first().click();
  const w0 = page.getByLabel('바벨 컬 웜업 무게', { exact: true });
  await expect(w0).toHaveValue('20');
  await expect(page.getByText('웜업(W)으로 표시했어요')).toBeVisible();
  await expect(page.getByLabel('바벨 컬 1세트 무게', { exact: true })).toHaveValue('50');
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText('웜업 완료');
  const chip = page.getByRole('button', { name: '바벨 컬 웜업 웜업 표시' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await checkScreen(page, 'u07-auto-warmup');
  await chip.click(); // 끄기 → 1세트
  await expect(page.getByLabel('바벨 컬 1세트 무게', { exact: true })).toHaveValue('20');
  await expect(page.getByRole('button', { name: '바벨 컬 1세트 웜업 표시' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await workouts(page)).find((w) => !w.endedAt)?.blocks[0]!.items[0]!.sets[0]!.warmup).toBe(false);
  await page.getByRole('button', { name: '바벨 컬 1세트 웜업 표시' }).click(); // 다시 켜기
  await expect(w0).toHaveValue('20');
  // W 완료 → 웜업 휴식, 뒤 세트 무게(50)는 그대로
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('timer')).toContainText('웜업 후 휴식');
  await expect(page.getByLabel('바벨 컬 1세트 무게', { exact: true })).toHaveValue('50');
});

test('D-066 묶음: 큰 ✓ 한 번에 라운드(A1+B1) 완료·라운드 휴식 한 번, 라운드 묶음 표시, 줄 ✓ 되돌리기', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r-ss', '묶음 시험', [{ kind: 'superset', restSec: 60, roundRestSec: 120, transitionSec: 10,
    items: [{ exerciseId: 'barbell_curl', sets: 2, reps: 10 }, { exerciseId: 'rope_pushdown', sets: 2, reps: 12 }] }])]);
  await page.reload();
  await page.getByRole('button', { name: /묶음 시험 시작$/ }).first().click();
  const r1 = page.getByRole('group', { name: '1라운드', exact: true });
  await expect(r1.locator('.idx-n')).toHaveText(['A1', 'B1']);
  await expect(page.getByRole('group', { name: '2라운드', exact: true }).locator('.idx-n')).toHaveText(['A2', 'B2']);
  const big = page.getByRole('button', { name: '현재 세트 완료 · A+B 1세트 한 번에' });
  await expect(big).toContainText('A+B 1세트 완료');
  await expect(big).toContainText('휴식 120초');
  await checkScreen(page, 'u08-round-group');
  // 무게를 입력하고 포커스를 빼지 않은 채 큰 ✓ (입력 먼저 저장)
  await page.getByLabel('바벨 컬 1세트 무게', { exact: true }).click();
  await page.getByLabel('바벨 컬 1세트 무게', { exact: true }).pressSequentially('40');
  await big.dispatchEvent('click');
  await expect(page.getByRole('group', { name: '1라운드 완료' }).locator('.set-row.done')).toHaveCount(2);
  await expect(page.getByRole('timer')).toContainText('라운드 후 휴식');
  await expect(page.getByLabel('바벨 컬 1세트 무게', { exact: true })).toHaveValue('40');
  await expect(page.getByLabel('바벨 컬 2세트 무게', { exact: true })).toHaveValue('40'); // 무게 이어받기
  // 휴식은 한 번만: 저장된 타이머가 라운드 휴식 (A1 뒤 전환 휴식 없이)
  expect((await workouts(page)).find((w) => !w.endedAt)!.timer?.kind).toBe('round');
  await checkScreen(page, 'u09-round-done');
  // 줄의 ✓ 로 B1 되돌리기 → B1만 다시, 타이머 꺼짐, 큰 ✓ 는 B1만
  await page.getByRole('group', { name: '1라운드 완료' }).getByRole('button', { name: '완료 취소' }).nth(1).click();
  const big2 = page.getByRole('button', { name: '현재 세트 완료', exact: true });
  await expect(big2).toContainText('B. 트라이셉 로프 푸시다운 1세트 완료');
  await expect(page.getByLabel(/휴식 남은 시간/)).toHaveCount(0);
  await big2.click();
  await expect(page.getByRole('timer')).toContainText('라운드 후 휴식');
  // 현재 줄이 아닌 줄의 ✓ 는 그 세트만 (B2만 완료, A2는 남음 → 큰 ✓ 는 A2 하나)
  await page.getByRole('button', { name: '트라이셉 로프 푸시다운 2세트 완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '트라이셉 로프 푸시다운 2세트 완료', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '현재 세트 완료', exact: true })).toContainText('A. 바벨 컬 2세트 완료');
});

test('B1 묶음: 현재 줄의 ✓ 도 그 세트만 (줄마다 체크는 그대로), 라운드 한 번에는 아래 큰 ✓ 만', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r-ss1', '묶음 줄 시험', [{ kind: 'superset', restSec: 60, roundRestSec: 120, transitionSec: 10,
    items: [{ exerciseId: 'barbell_curl', sets: 2, reps: 10 }, { exerciseId: 'rope_pushdown', sets: 2, reps: 12 }] }])]);
  await page.reload();
  await page.getByRole('button', { name: /묶음 줄 시험 시작$/ }).first().click();
  await expect(page.getByRole('button', { name: '현재 세트 완료 · A+B 1세트 한 번에' })).toBeVisible();
  // 현재 줄(A1)의 ✓ → A1만 완료, B1은 남음 (라운드 한 번에가 아님)
  await page.getByRole('group', { name: '1라운드', exact: true }).getByRole('button', { name: '바벨 컬 1세트 완료', exact: true }).click();
  await expect(page.getByRole('group', { name: '1라운드', exact: true }).locator('.set-row.done')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '트라이셉 로프 푸시다운 1세트 완료', exact: true })).toBeVisible();
  const wk = (await workouts(page)).find((w) => !w.endedAt)!;
  expect(wk.blocks[0]!.items[0]!.sets[0]!.done).toBe(true);
  expect(wk.blocks[0]!.items[1]!.sets[0]!.done).toBe(false);
  expect(wk.timer?.kind).toBe('transition');
  // 도크 글도 같은 모양 ("글자 N세트")
  await expect(page.locator('.rp-label')).toHaveText('다음 B 1세트');
  await checkScreen(page, 'u08b-row-check-one');
});
