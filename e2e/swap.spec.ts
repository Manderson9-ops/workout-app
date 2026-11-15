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
/** 저장소가 쓸 때마다 붙이는 동기화 표(_s)를 뺀 루틴 (내용 견주기용) */
const content = (r: unknown) => { const { _s: _drop, ...rest } = (r ?? {}) as Record<string, unknown>; return rest; };
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
  await page.mouse.move(1, 1); // 포인터가 알림 위에 있으면 타이머가 멈춤 (D-080 5차)
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

/** 플랜 만들기 화면에서 플랜 하나 만들기 (등 선택 안 함) */
async function makePlan(page: Page) {
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '등 선택 안 함' }).click();
  await page.getByRole('dialog', { name: '등 우선순위' }).getByRole('button', { name: '완료' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const plan = page.getByRole('region', { name: '생성된 플랜' });
  await expect(plan).toBeVisible();
  return plan;
}

test('D-080 검토 3차: 플랜 [운동 추가] → 새 운동 직접 추가 → 추가하면 맨 뒤에 붙고 초점은 [운동 추가] 로', async ({ page }) => {
  const plan = await makePlan(page);
  const names = async () => (await plan.locator('.card').count());
  const before = await names();
  const open = plan.getByRole('button', { name: '+ 운동 추가' }).last();
  await open.click();
  await page.getByRole('dialog', { name: '운동 추가' }).getByRole('button', { name: /새 운동 직접 추가/ }).click();
  await page.getByLabel('운동 이름').fill('끝에 붙일 케이블 로우');
  await page.getByRole('button', { name: '운동 추가하기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(plan.getByText('끝에 붙일 케이블 로우', { exact: true })).toHaveCount(1);
  expect(await names()).toBe(before + 1);
  const cards = plan.locator('.card');
  await expect(cards.last()).toContainText('끝에 붙일 케이블 로우');
  await expect(page.locator('[data-opener="add"]').filter({ visible: true }).first()).toBeFocused();
});

test('D-080 검토 3차: 플랜 [묶음에 운동 추가] → 새 운동 직접 추가 → 추가하면 그 묶음 안에 들어감', async ({ page }) => {
  const plan = await makePlan(page);
  await page.getByRole('button', { name: /구체적인 플랜 만들기/ }).click();
  const first = plan.locator('.card').first();
  await first.getByRole('button', { name: /^다음과 묶기 · / }).click();
  await expect(plan.locator('.card').first().locator('.badge.kind')).toBeVisible();
  await plan.locator('.card').first().getByRole('button', { name: /^\+ 묶음에 운동 추가/ }).click();
  await page.getByRole('dialog', { name: '묶음에 운동 추가' }).getByRole('button', { name: /새 운동 직접 추가/ }).click();
  await page.getByLabel('운동 이름').fill('묶음용 케이블 컬');
  await page.getByRole('button', { name: '운동 추가하기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(plan.locator('.card').first()).toContainText('묶음용 케이블 컬');
  await expect(plan.getByText('묶음용 케이블 컬', { exact: true })).toHaveCount(1);
});

test('D-080 검토 3차: 플랜 교체 → 검색어 입력 → 새 운동 직접 추가 → 닫으면 같은 검색어, 고르기 창을 닫으면 초점은 [교체] 로', async ({ page }) => {
  const plan = await makePlan(page);
  const opener = plan.getByRole('button', { name: '교체' }).first();
  await opener.click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await pick.getByLabel('운동 검색').fill('로우');
  await pick.getByRole('button', { name: /새 운동 직접 추가/ }).click();
  const custom = page.getByRole('dialog', { name: '운동 직접 추가' });
  await expect(custom).toBeVisible();
  await custom.getByRole('button', { name: '닫기' }).click();
  await expect(pick).toBeVisible();
  await expect(pick.getByLabel('운동 검색')).toHaveValue('로우');
  await pick.getByRole('button', { name: '닫기' }).click();
  await expect(pick).toHaveCount(0);
  await expect(opener).toBeFocused();
  // 다시 열면 검색어는 비어 있음
  await opener.click();
  await expect(page.getByRole('dialog', { name: '운동 교체' }).getByLabel('운동 검색')).toHaveValue('');
});

test('D-080 검토 3차: 홈 ⇄ → 고르기 → [되돌리기] 로 원래 운동, 초점은 그 ⇄; 고르지 않고 닫으면 ⇄ 초점·스크롤 그대로', async ({ page }) => {
  const ids = ['pull_up', 'chin_up', 'plank', 'incline_db_press', 'deadlift', 'lat_pulldown', 'bench_press', 'leg_press'];
  await idbPut(page, 'routines', [routine('r10', '홈 3차', ids.map((x) => one(x, 3)))]);
  await page.reload();
  const next = page.getByTestId('home-next');
  const swap = next.getByRole('button', { name: '플랭크 바로 교체', exact: true });
  await swap.click();
  const pick = page.getByRole('dialog', { name: '운동 교체' });
  await pick.getByLabel('운동 검색').fill('데드버그');
  await pick.getByRole('button', { name: /^데드버그/ }).first().click();
  await expect(page.locator('.toast').filter({ hasText: '플랭크 → 데드버그: 바꿨어요' })).toBeVisible();
  await expect(next.getByRole('button', { name: '데드버그 바로 교체', exact: true })).toBeFocused();
  await page.locator('.toast').getByRole('button', { name: '되돌리기' }).click();
  const back = next.getByRole('button', { name: '플랭크 바로 교체', exact: true });
  await expect(back).toBeFocused();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r10')!.blocks[2]!.items[0]!.exerciseId).toBe('plank');
  // 고르지 않고 닫기: 초점은 그 ⇄, 화면은 그대로
  const last = next.getByRole('button', { name: '레그 프레스 바로 교체', exact: true });
  await last.click();
  const y0 = await page.evaluate(() => window.scrollY);
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: '닫기' }).click();
  await expect(last).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
});

test('D-080 검토 4차: 미리보기에서 한 번 교체한 뒤 닫으면 초점은 그 루틴 카드의 내용 보기 버튼', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r9', '초점 루틴', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  const open = page.getByRole('group', { name: '루틴 초점 루틴' }).getByRole('button', { name: '초점 루틴 내용 보기' });
  await open.click();
  const pv = page.getByRole('dialog', { name: '초점 루틴 내용' });
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('group', { name: '비슷한 운동' }).getByRole('button', { name: /^덤벨 벤치프레스 · / }).click();
  await expect(pv.locator('.pv-toast')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pv).toHaveCount(0);
  await expect(open).toBeFocused();
});

/** 비슷한 운동 구역 또는 검색으로 고름 */
async function pickByName(page: Page, name: string) {
  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  await dlg.getByLabel('운동 검색').fill(name);
  await dlg.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(dlg).toHaveCount(0);
}

test('D-080 5차: 미리보기 ⇄ → 고르기 → 다시 뜬 창에서 [시작]은 초점을 받지 않고 바뀐 줄 ⇄ 로 곧장', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r11', '초점 5차', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  await page.getByRole('group', { name: '루틴 초점 5차' }).getByRole('button', { name: '초점 5차 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '초점 5차 내용' });
  const start = pv.getByRole('button', { name: '초점 5차 루틴 시작하기' });
  await expect(start).toBeFocused(); // 처음 열 때만 [시작]
  await pv.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click();
  await page.evaluate(() => {
    const w = window as unknown as { __startFocus: number };
    w.__startFocus = 0;
    document.addEventListener('focusin', (e) => { if ((e.target as HTMLElement).getAttribute?.('aria-label')?.includes('루틴 시작하기')) w.__startFocus++; }, true);
  });
  await pickByName(page, '데드버그');
  const swapped = pv.getByRole('button', { name: '데드버그 바로 교체', exact: true });
  await expect(swapped).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __startFocus: number }).__startFocus), '[시작]이 초점을 받은 횟수').toBe(0);
  // 고르지 않고 닫아도 마찬가지
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: '닫기' }).click();
  await expect(pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __startFocus: number }).__startFocus)).toBe(0);
});

test('D-080 5차: 알림 시간 안에 두 번 바꾸면 "2개 바꿨어요", [되돌리기] 한 번에 처음 모습(수정 시각까지)으로, 초점은 첫 줄 ⇄', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r12', '두 번 교체', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  const before = (await routines(page)).find((r) => r.id === 'r12')!;
  await page.getByRole('group', { name: '루틴 두 번 교체' }).getByRole('button', { name: '두 번 교체 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '두 번 교체 내용' });
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await pickByName(page, '덤벨 벤치프레스');
  await expect(pv.locator('.pv-toast')).toContainText('바벨 벤치프레스 → 덤벨 벤치프레스: 바꿨어요');
  await pv.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click();
  await pickByName(page, '데드버그');
  await expect(pv.locator('.pv-toast')).toContainText('2개 바꿨어요');
  await expect(pv.locator('.pv-toast')).toHaveCount(1);
  await page.mouse.move(1, 1);
  await pv.getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r12')!.blocks[0]!.items[0]!.exerciseId).toBe('bench_press');
  const back = (await routines(page)).find((r) => r.id === 'r12')!;
  expect(back.updatedAt).toBe(before.updatedAt);
  expect(back.blocks).toEqual(before.blocks);
  expect(back.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['bench_press', 'plank']);
  await expect(pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true })).toBeFocused();
  await expect(pv.getByRole('button', { name: '플랭크 바로 교체', exact: true })).toBeVisible();
  await expect(pv.locator('.pv-toast')).toHaveCount(0);
});

test('D-080 5차: 알림에 초점이 있는 동안 5초 타이머는 멈추고, 벗어나면 새 5초 (WCAG 2.2.1)', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r13', '멈춤 루틴', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  await page.getByRole('group', { name: '루틴 멈춤 루틴' }).getByRole('button', { name: '멈춤 루틴 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '멈춤 루틴 내용' });
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await pickByName(page, '덤벨 벤치프레스');
  await page.mouse.move(1, 1);
  const toast = pv.locator('.pv-toast');
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: '되돌리기' }).focus();
  await page.waitForTimeout(6000);
  await expect(toast).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  const t0 = Date.now();
  await expect(toast).toHaveCount(0, { timeout: 7000 });
  expect(Date.now() - t0, '벗어난 뒤 새 5초').toBeGreaterThan(4000);
});

test('D-080 5차: 홈에서 루틴 숨기기 알림과 교체 알림이 함께 뜨면 겹치지 않고 세로로 쌓임', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r14', '홈 쌓기 A', [one('bench_press', 3), one('plank', 3)]), routine('r15', '홈 쌓기 B', [one('pull_up', 3)])]);
  await page.reload();
  const next = page.getByTestId('home-next');
  const nextName = (await next.locator('.next-name').innerText()).trim();
  const other = nextName === '홈 쌓기 A' ? '홈 쌓기 B' : '홈 쌓기 A';
  const swapName = nextName === '홈 쌓기 A' ? '플랭크' : '턱걸이';
  await next.getByRole('button', { name: new RegExp(`^${swapName}.*바로 교체$`) }).first().click();
  await pickByName(page, '데드버그');
  const swapToast = page.locator('.toast').filter({ hasText: '바꿨어요' });
  await expect(swapToast).toBeVisible();
  await page.getByRole('button', { name: `${other} 메뉴`, exact: true }).click();
  await page.getByRole('button', { name: `${other} 지우기`, exact: true }).click();
  await page.getByRole('button', { name: '목록에서만 숨기기', exact: true }).click();
  const hideToast = page.locator('.toast').filter({ hasText: '목록에서 숨겼어요' });
  await expect(hideToast).toBeVisible();
  await expect(swapToast).toBeVisible();
  const a = (await swapToast.boundingBox())!;
  const b = (await hideToast.boundingBox())!;
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, `알림이 겹침 ${JSON.stringify({ a, b })}`).toBe(false);
  expect(b.y, '새 알림이 아래').toBeGreaterThan(a.y);
});

test('D-080 6차: 교체 창을 느리게 골라도(6초) 되돌리기 창이 이어져 "2개 바꿨어요", [되돌리기] 한 번에 둘 다 복구', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r14', '느린 고르기', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  const before = (await routines(page)).find((r) => r.id === 'r14')!;
  await page.getByRole('group', { name: '루틴 느린 고르기' }).getByRole('button', { name: '느린 고르기 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '느린 고르기 내용' });
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await pickByName(page, '덤벨 벤치프레스');
  await page.mouse.move(1, 1);
  await expect(pv.locator('.pv-toast')).toContainText('바벨 벤치프레스 → 덤벨 벤치프레스');
  await pv.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click(); // 4초 안
  await page.waitForTimeout(6000); // 5초보다 길게 고르는 중
  await pickByName(page, '데드버그');
  await page.mouse.move(1, 1);
  await expect(pv.locator('.pv-toast')).toContainText('2개 바꿨어요');
  await pv.getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r14')!.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['bench_press', 'plank']);
  expect((await routines(page)).find((r) => r.id === 'r14')!.updatedAt).toBe(before.updatedAt);
});

test('D-080 6차: 교체 창이 떠 있는 동안 초점은 교체 창 안, 미리보기가 다시 뜨면 창 안 ⇄ (배경 카드로 가지 않음)', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r15', '초점 6차', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  await page.getByRole('group', { name: '루틴 초점 6차' }).getByRole('button', { name: '초점 6차 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '초점 6차 내용' });
  await page.evaluate(() => {
    const w = window as unknown as { __bg: number };
    w.__bg = 0;
    document.addEventListener('focusin', (e) => { if ((e.target as HTMLElement).closest?.('.routine-card')) w.__bg++; }, true);
  });
  await pv.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '운동 교체' });
  await expect(dlg).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-label="운동 교체"]'))).toBe(true);
  // 고르기: 미리보기가 다시 뜨면 곧바로 창 안 ⇄ (옛 줄 또는 새 줄), 배경 카드가 아님
  await dlg.getByLabel('운동 검색').fill('데드버그');
  await dlg.getByRole('button', { name: /^데드버그/ }).first().click();
  await expect(pv).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.sheet') && document.activeElement?.classList.contains('pv-swap'))).toBe(true);
  await expect(pv.getByRole('button', { name: '데드버그 바로 교체', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __bg: number }).__bg), '배경 카드가 초점을 받은 횟수').toBe(0);
  // 고르지 않고 닫아도 배경 카드로 가지 않음
  await pv.getByRole('button', { name: '데드버그 바로 교체', exact: true }).click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: '닫기' }).click();
  await expect(pv.getByRole('button', { name: '데드버그 바로 교체', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __bg: number }).__bg)).toBe(0);
  // 미리보기를 그냥 닫으면 카드의 열기 버튼으로
  await pv.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByRole('button', { name: '초점 6차 내용 보기' })).toBeFocused();
});

test('D-080 6차: 같은 줄을 A → B → A 로 되돌려 놓으면 "원래대로예요", [되돌리기] 없음', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r16', '원래대로', [one('bench_press', 3), one('plank', 3)])]);
  await page.goto('./#/routines');
  await page.reload();
  await page.getByRole('group', { name: '루틴 원래대로' }).getByRole('button', { name: '원래대로 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '원래대로 내용' });
  const before16 = (await routines(page)).find((r) => r.id === 'r16');
  await pv.getByRole('button', { name: '바벨 벤치프레스 바로 교체', exact: true }).click();
  await pickByName(page, '덤벨 벤치프레스');
  await pv.getByRole('button', { name: '덤벨 벤치프레스 바로 교체', exact: true }).click();
  await pickByName(page, '바벨 벤치프레스');
  await page.mouse.move(1, 1);
  await expect(pv.locator('.pv-toast')).toContainText('원래대로예요');
  // 7차: 저장된 루틴도 바꾸기 전과 똑같음 (수정 시각 포함)
  await expect.poll(async () => content((await routines(page)).find((r) => r.id === 'r16'))).toEqual(content(before16));
  await expect(pv.locator('.pv-toast').getByRole('button', { name: '되돌리기' })).toHaveCount(0);
  await expect(pv.getByRole('status')).toHaveText('원래대로예요');
});

test('D-080 7차: 시간 운동(플랭크 60초) → 횟수 운동 → 플랭크로 돌아오면 저장된 루틴이 처음과 똑같음 (60초·수정 시각)', async ({ page }) => {
  await idbPut(page, 'routines', [routine('r17', '시간 원래대로', [one('bench_press', 3), { kind: 'single', items: [{ exerciseId: 'plank', sets: 3, reps: 0, seconds: 60 }], restSec: 90, roundRestSec: 120, transitionSec: 10 }])]);
  await page.goto('./#/routines');
  await page.reload();
  const before = (await routines(page)).find((r) => r.id === 'r17');
  await page.getByRole('group', { name: '루틴 시간 원래대로' }).getByRole('button', { name: '시간 원래대로 내용 보기' }).click();
  const pv = page.getByRole('dialog', { name: '시간 원래대로 내용' });
  await pv.getByRole('button', { name: '플랭크 바로 교체', exact: true }).click();
  await pickByName(page, '데드버그');
  await expect(pv.locator('.pv-toast')).toContainText('플랭크 → 데드버그');
  const mid = (await routines(page)).find((r) => r.id === 'r17')!;
  expect(mid.blocks[1]!.items[0], '횟수 운동으로 바뀐 중간 모습').not.toHaveProperty('seconds');
  await pv.getByRole('button', { name: '데드버그 바로 교체', exact: true }).click();
  await pickByName(page, '플랭크');
  await page.mouse.move(1, 1);
  await expect(pv.locator('.pv-toast')).toContainText('원래대로예요');
  await expect(pv.locator('.pv-toast').getByRole('button', { name: '되돌리기' })).toHaveCount(0);
  await expect.poll(async () => content((await routines(page)).find((r) => r.id === 'r17'))).toEqual(content(before));
  expect((await routines(page)).find((r) => r.id === 'r17')!.blocks[1]!.items[0]).toMatchObject({ exerciseId: 'plank', seconds: 60 });
});
