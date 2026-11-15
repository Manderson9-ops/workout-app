/**
 * D-080 종목 바꾸기: 운동 중 ⇄ 바로 교체(비슷한 운동·지난 기록·완료 세트 보존), 루틴 카드 미리보기 ⇄ (저장·되돌리기), 홈 다음 운동 줄, 루틴 편집 ⇄
 * 기록·루틴은 저장소(IndexedDB)에 직접 넣어 시작 (usage2.spec.ts 와 같은 방식)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });
/** 가로 스크롤 없음, 44pt 터치 영역 (app.spec.ts 와 같은 검사) */
async function checkScreen(page: Page, name: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, '가로 스크롤').toBeLessThanOrEqual(r.cw);
  const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, input:not([type=checkbox]), select, [role=button], nav a, a.btn, a.banner')]
    .filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (b.width < 43.5 || b.height < 43.5); })
    .map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`));
  expect(bad, '44pt 미만 터치 영역').toEqual([]);
  await page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });
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
const DAY = 86_400_000;
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
type R = { id: string; name: string; updatedAt: string; blocks: { kind: string; items: { exerciseId: string; sets: number }[] }[] };
type W = { id: string; endedAt?: string; blocks: { kind: string; restSec: number; items: { exerciseId: string; target: { sets: number }; sets: { done: boolean }[] }[] }[] };
const routines = async (page: Page) => (await idbAll(page, 'routines')) as unknown as R[];
const activeWorkout = async (page: Page) => ((await idbAll(page, 'workouts')) as unknown as W[]).find((w) => !w.endedAt)!;

const one = (exerciseId: string, sets: number) => ({ kind: 'single', items: [{ exerciseId, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const pair = (a: string, b: string, sets: number) => ({ kind: 'superset', items: [{ exerciseId: a, sets, reps: 10 }, { exerciseId: b, sets, reps: 10 }], restSec: 75, roundRestSec: 120, transitionSec: 10 });
const routine = (id: string, name: string, blocks: Row[]) => ({ id, name, createdAt: iso(Date.now() - DAY), updatedAt: iso(Date.now() - DAY), blocks, warmupSec: 0 });
/** 끝낸 운동: 한 종목 한 세트 */
const past = (id: string, daysAgo: number, exerciseId: string, weight: number, reps: number) => {
  const start = Date.now() - daysAgo * DAY;
  return { id, name: '지난 운동', startedAt: iso(start), endedAt: iso(start + 40 * MIN), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId, target: { sets: 1, reps }, sets: [{ warmup: false, done: true, weight, reps, doneAt: iso(start + 5 * MIN) }] }] }] };
};

test('D-080 운동 중 ⇄: 비슷한 운동 구역 + 지난 기록 → 완료 2세트는 그대로, 남은 2세트만 새 운동 카드로', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 2, 'smith_bench_press', 70, 6), past('p2', 9, 'bench_press', 80, 5)]);
  await idbPut(page, 'routines', [routine('r1', '가슴 테스트', [one('bench_press', 4), one('pull_up', 3)])]);
  await page.reload();
  await page.getByRole('button', { name: '가슴 테스트 시작', exact: true }).first().click();
  const done = page.getByRole('button', { name: '현재 세트 완료', exact: true });
  await done.click();
  await done.click();

  const swap = page.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true });
  await expect(swap).toBeVisible();
  const box = (await swap.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(43.5);
  expect(box.height).toBeGreaterThanOrEqual(43.5);
  await expect(page.getByRole('button', { name: '바벨 벤치프레스 메뉴' })).toBeVisible(); // ⋯ 메뉴는 그대로
  await checkScreen(page, 'sw1-workout');
  await swap.click();

  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  const sim = dlg.getByRole('group', { name: '비슷한 운동' });
  await expect(sim).toBeVisible();
  const rows = sim.getByRole('button');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  // 같은 family 안에서는 해 본 운동이 먼저 + 지난 기록 한 줄
  await expect(rows.first()).toHaveAttribute('aria-label', /^스미스머신 벤치프레스 · 지난번/);
  await expect(rows.first()).toContainText('지난번 70kg×6 · 2일 전');
  await expect(sim.getByRole('button', { name: /^덤벨 벤치프레스 · / })).toContainText('아직 안 해 봄');
  await expect(sim.getByRole('button', { name: /^바벨 벤치프레스 · / })).toHaveCount(0); // 자기 자신 제외
  // 전체 목록에는 같은 운동이 한 번 더 나오지 않음
  await expect(dlg.getByRole('button', { name: /^스미스머신 벤치프레스 · / })).toHaveCount(1);
  await checkScreen(page, 'sw2-picker');
  // 검색 중에는 비슷한 운동 구역이 숨음
  await dlg.getByLabel('운동 검색').fill('덤벨 벤치');
  await expect(dlg.getByRole('group', { name: '비슷한 운동' })).toHaveCount(0);
  await dlg.getByLabel('운동 검색').fill('');
  await dlg.getByRole('group', { name: '비슷한 운동' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(dlg).toHaveCount(0);

  const w = await activeWorkout(page);
  expect(w.blocks.map((b) => b.items.map((i) => i.exerciseId))).toEqual([['bench_press'], ['db_bench_press'], ['pull_up']]);
  expect(w.blocks[0]!.items[0]!.sets).toHaveLength(2);
  expect(w.blocks[0]!.items[0]!.sets.every((s) => s.done)).toBe(true);
  expect(w.blocks[1]!.items[0]!.sets).toHaveLength(2);
  expect(w.blocks[1]!.restSec).toBe(90);
  await expect(page.locator('.wk-card').nth(1)).toContainText('덤벨 벤치프레스');
  await expect(page.getByRole('button', { name: '덤벨 벤치프레스 바로 교체' })).toBeVisible();
  await checkScreen(page, 'sw3-after');
});

test('D-080 운동 중 ⇄ 묶음: 완료 세트가 있으면 새 운동은 묶음 다음에 따로, 알림 한 줄', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r2', '묶음 테스트', [pair('incline_db_press', 'chin_up', 3)])]);
  await page.reload();
  await page.getByRole('button', { name: '묶음 테스트 시작', exact: true }).first().click();
  await page.getByRole('button', { name: /^현재 세트 완료/ }).click(); // 1라운드 (A1+B1) 한 번에
  const swap = page.getByRole('button', { name: '인클라인 덤벨 프레스 바로 교체', exact: true });
  await expect(swap).toBeVisible();
  await expect(page.getByText('1라운드 · 완료').first()).toBeVisible(); // 완료 표시가 그려진 뒤에 찍음
  await checkScreen(page, 'sw4-group');
  await swap.click();
  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  await dlg.getByLabel('운동 검색').fill('덤벨 벤치');
  await dlg.getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(page.getByRole('status').filter({ hasText: '묶음 다음에 따로 해요' })).toBeVisible();
  const w = await activeWorkout(page);
  expect(w.blocks.map((b) => [b.kind, b.items.map((i) => i.exerciseId)])).toEqual([['superset', ['incline_db_press', 'chin_up']], ['single', ['db_bench_press']]]);
  expect(w.blocks[0]!.items[0]!.sets).toHaveLength(1);
  expect(w.blocks[0]!.items[1]!.sets).toHaveLength(3);
  expect(w.blocks[1]!.items[0]!.sets).toHaveLength(2);
  expect(w.blocks[1]!.restSec).toBe(75);
});

test('D-080 루틴 카드 → 내용 보기 → ⇄ 바로 교체: 루틴에 저장, [되돌리기]로 복구', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 3, 'bench_press', 120, 10)]);
  await idbPut(page, 'routines', [routine('r3', '가슴 미리보기', [one('bench_press', 4), pair('incline_db_press', 'chin_up', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload(); // 저장소에 직접 넣은 루틴을 다시 읽음
  const card = page.getByRole('group', { name: '루틴 가슴 미리보기' });
  await expect(card).toBeVisible();
  const open = card.getByRole('button', { name: '가슴 미리보기 내용 보기' });
  await expect(open).toBeVisible();
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await open.click();

  const pv = page.getByRole('dialog', { name: '가슴 미리보기 내용' });
  await expect(pv).toBeVisible();
  await expect(pv).toContainText('바벨 벤치프레스');
  await expect(pv).toContainText('4×10 · 지난 120kg×10');
  await expect(pv).toContainText('3×10 · 처음');
  await expect(pv).toContainText('A. 인클라인 덤벨 프레스');
  await expect(pv).toContainText('B. 언더그립 풀업');
  await expect(pv).toContainText('슈퍼세트');
  await expect(pv).toContainText('세트 간 휴식 90초');
  await expect(pv).toContainText('라운드 후 휴식 120초');
  await expect(pv.getByRole('button', { name: '가슴 미리보기 루틴 시작하기' })).toBeVisible();
  await expect(pv.getByRole('button', { name: '가슴 미리보기 루틴 편집' })).toBeVisible();
  await checkScreen(page, 'sw5-preview');

  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await expect(pick.getByRole('group', { name: '비슷한 운동' })).toBeVisible();
  await pick.getByRole('group', { name: '비슷한 운동' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(pick).toHaveCount(0);

  await expect(pv).toContainText('덤벨 벤치프레스');
  await expect(pv.locator('.pv-toast').filter({ hasText: '바벨 벤치프레스 → 덤벨 벤치프레스: 바꿨어요' })).toBeVisible();
  await checkScreen(page, 'sw6-swapped');
  const saved = (await routines(page)).find((r) => r.id === 'r3')!;
  expect(saved.blocks[0]!.items[0]).toMatchObject({ exerciseId: 'db_bench_press', sets: 4 });
  expect(saved.updatedAt > iso(Date.now() - DAY + 1000)).toBe(true);

  await pv.getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r3')!.blocks[0]!.items[0]!.exerciseId).toBe('bench_press');
  await expect(pv).toContainText('바벨 벤치프레스');
  // 5초 뒤 알림은 사라짐
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(pv.locator('.pv-toast')).toBeVisible();
  await expect(pv.locator('.pv-toast')).toHaveCount(0, { timeout: 8000 });
  // [시작] 은 루틴을 시작함
  await pv.getByRole('button', { name: '가슴 미리보기 루틴 시작하기' }).click();
  await expect(page.getByRole('button', { name: '끝내기', exact: true })).toBeVisible();
});

test('D-080 홈 다음 운동 카드: 기존 한 줄은 그대로, 아래에 운동 줄 전부 + ⇄', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 1, 'bench_press', 100, 8)]);
  await idbPut(page, 'routines', [routine('r4', '홈 줄 테스트', [one('bench_press', 4), pair('incline_db_press', 'chin_up', 3), one('plank', 3)])]);
  await page.reload();
  const next = page.getByTestId('home-next');
  await expect(next.locator('.next-meta')).toHaveText('운동 4개');
  const lines = next.locator('.pv-row');
  await expect(lines).toHaveCount(4);
  await expect(next).toContainText('4×10 · 지난 100kg×8');
  await expect(next.getByRole('button', { name: /바로 교체$/ })).toHaveCount(4);
  await checkScreen(page, 'sw7-home');
  await next.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await pick.getByLabel('운동 검색').fill('데드버그');
  await pick.getByRole('button', { name: /^데드버그/ }).first().click();
  await expect(page.locator('.toast').filter({ hasText: '플랭크 → 데드버그: 바꿨어요' })).toBeVisible();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r4')!.blocks[2]!.items[0]!.exerciseId).not.toBe('plank');
});

test('D-080 루틴 편집: 펼친 운동 이름 옆 ⇄ 로 ⋯ 메뉴 없이 교체 (세트 수 유지), 기존 ⋯ 메뉴 교체도 그대로', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r5', '편집 교체', [one('bench_press', 4)])]);
  await page.goto('./#/routines');
  await page.reload(); // 저장소에 직접 넣은 루틴을 다시 읽음
  await page.getByRole('group', { name: '루틴 편집 교체' }).getByRole('button', { name: '편집 교체 메뉴' }).click();
  await page.getByRole('button', { name: '편집 교체 편집' }).click();
  await page.getByRole('button', { name: /^바벨 벤치프레스/ }).first().click(); // 카드 펼치기
  const swap = page.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true });
  await expect(swap).toBeVisible();
  await swap.click();
  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  await expect(dlg.getByRole('group', { name: '비슷한 운동' })).toBeVisible();
  await dlg.getByRole('group', { name: '비슷한 운동' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await page.getByRole('button', { name: '루틴 저장하기', exact: true }).click();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r5')!.blocks[0]!.items[0]).toMatchObject({ exerciseId: 'db_bench_press', sets: 4 });
});

test('D-080 검토: 4세트 중 2세트 하고 ⇄ → 끝낼 때 "교체:" 로 묻고, [루틴 업데이트] 뒤 루틴은 제자리·세트 수 그대로', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r6', '교체 반영', [one('bench_press', 4), one('pull_up', 3)])]);
  await page.reload();
  await page.getByRole('button', { name: '교체 반영 시작', exact: true }).first().click();
  const done = page.getByRole('button', { name: '현재 세트 완료', exact: true });
  await done.click();
  await done.click();
  await page.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  const dlg0 = page.getByRole('dialog', { name: '운동 교체' });
  await dlg0.getByLabel('운동 검색').fill('덤벨 벤치');
  await dlg0.getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(dlg0).toHaveCount(0);
  expect((await activeWorkout(page)).blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['bench_press', 'db_bench_press', 'pull_up']); // 기록은 갈라져 있음

  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  await page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
  const ask = page.getByRole('dialog', { name: '루틴에 반영할까요?' });
  await expect(ask).toContainText('교체: 바벨 벤치프레스 → 덤벨 벤치프레스');
  await expect(ask).not.toContainText('추가:');
  await ask.getByRole('button', { name: '루틴 업데이트' }).click();
  await expect(ask).toHaveCount(0);
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r6')!.blocks[0]!.items[0]!.exerciseId).toBe('db_bench_press');
  const saved = (await routines(page)).find((r) => r.id === 'r6')!;
  expect(saved.blocks.map((b) => b.items.map((i) => [i.exerciseId, i.sets]))).toEqual([[['db_bench_press', 4]], [['pull_up', 3]]]);

  await page.goto('./#/routines');
  const open = page.getByRole('group', { name: '루틴 교체 반영' }).getByRole('button', { name: '교체 반영 내용 보기' });
  await open.click();
  const pv = page.getByRole('dialog', { name: '교체 반영 내용' });
  await expect(pv.locator('.pv-row')).toHaveCount(2);
  await expect(pv.locator('.pv-row').first()).toContainText('덤벨 벤치프레스');
  await expect(pv.locator('.pv-row').first()).toContainText('4×');
});

test('D-080 검토 2차: 긴 루틴 미리보기에서 7번째 ⇄ → 고른 뒤 바뀐 줄·[되돌리기]가 화면 안, 초점은 그 줄 ⇄, 되돌리면 옛 줄 ⇄ 와 수정 시각 그대로', async ({ page }) => {
  const ids = ['pull_up', 'chin_up', 'plank', 'incline_db_press', 'deadlift', 'lat_pulldown', 'bench_press', 'leg_press'];
  await idbPut(page, 'routines', [routine('r8', '긴 루틴', ids.map((x) => one(x, 3)))]);
  await page.goto('./#/routines');
  await page.reload();
  const before = (await routines(page)).find((r) => r.id === 'r8')!.updatedAt;
  await page.getByRole('group', { name: '루틴 긴 루틴' }).getByRole('button', { name: '긴 루틴 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '긴 루틴 내용' });
  await expect(pv.locator('.pv-row')).toHaveCount(8);
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await pick.getByRole('group', { name: '비슷한 운동' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(pv.locator('.pv-toast')).toBeVisible();
  const swapped = pv.getByRole('button', { name: '덤벨 벤치프레스 바로 교체', exact: true });
  await expect(swapped).toBeInViewport();
  await expect(swapped).toBeFocused();
  await expect(pv.getByRole('button', { name: '되돌리기' })).toBeInViewport();
  await expect(pv.getByRole('status')).toHaveText('바벨 벤치프레스 → 덤벨 벤치프레스: 바꿨어요'); // 화면 읽기용 알림칸
  await pv.getByRole('button', { name: '되돌리기' }).click();
  const back = pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true });
  await expect(back).toBeFocused();
  await expect(back).toBeInViewport();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r8')!.blocks[6]!.items[0]!.exerciseId).toBe('bench_press');
  expect((await routines(page)).find((r) => r.id === 'r8')!.updatedAt).toBe(before);
  // 고르지 않고 닫으면 그 ⇄ 로 초점이 돌아감
  await back.click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: '닫기' }).click();
  await expect(back).toBeFocused();
});

test('D-080 검토 2차: 플랜 교체 → 새 운동 직접 추가 → 추가하면 그 자리에 반영, 추가 없이 닫으면 고르기 창이 다시 보임', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '등 선택 안 함' }).click();
  await page.getByRole('dialog', { name: '등 우선순위' }).getByRole('button', { name: '완료' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const plan = page.getByRole('region', { name: '생성된 플랜' });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: '교체' }).first().click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await pick.getByRole('button', { name: /새 운동 직접 추가/ }).click();
  const custom = page.getByRole('dialog', { name: '운동 직접 추가' });
  await expect(custom).toBeVisible();
  await expect(pick).toHaveCount(0); // 두 창이 겹치지 않음
  await custom.getByRole('button', { name: '닫기' }).click();
  await expect(pick).toBeVisible(); // 추가 없이 닫으면 다시 보임
  await pick.getByRole('button', { name: /새 운동 직접 추가/ }).click();
  await page.getByLabel('운동 이름').fill('교체용 로우 머신');
  await page.getByRole('button', { name: '운동 추가하기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(plan.locator('.card, section, div').filter({ hasText: '교체용 로우 머신' }).first()).toBeVisible();
  await expect(plan.getByText('교체용 로우 머신', { exact: true })).toHaveCount(1);
});

test('D-080 검토 2차: 고르기 창 줄의 읽는 이름에 지난 기록, Tab 으로 비슷한 운동 줄에 닿고 Enter 로 고름', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 2, 'smith_bench_press', 70, 6)]);
  await idbPut(page, 'routines', [routine('r9', '키보드', [one('bench_press', 3), one('pull_up', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  await page.getByRole('group', { name: '루틴 키보드' }).getByRole('button', { name: '키보드 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '키보드 내용' });
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  const sim = dlg.getByRole('group', { name: '비슷한 운동' });
  await expect(sim.getByRole('button', { name: /^스미스머신 벤치프레스 · 지난번 70kg×6/ })).toBeVisible();
  await expect(sim.getByRole('button', { name: /^덤벨 벤치프레스 · 아직 안 해 봄/ })).toBeVisible();
  const close = dlg.getByRole('button', { name: '닫기' });
  await close.focus();
  await page.keyboard.press('Tab'); // 검색칸
  await page.keyboard.press('Tab'); // 첫 비슷한 운동 줄
  const first = sim.getByRole('button').first();
  await expect(first).toBeFocused();
  const name = (await first.getAttribute('aria-label'))!.split(' · ')[0]!;
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r9')!.blocks[0]!.items[0]!.exerciseId).not.toBe('bench_press');
  await expect(pv.locator('.pv-row').first()).toContainText(name);
});
