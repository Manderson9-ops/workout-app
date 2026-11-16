/**
 * D-081 기록 요약 탭의 기간 요약 카드 (주·월·년, 비교 문장, 지표 카드, 막대 그래프).
 * 시각을 2026-11-16(월) 낮 12시로 고정하고 기록은 저장소(IndexedDB)에 직접 넣는다 (swap.spec.ts 와 같은 방식)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const TODAY = new Date('2026-11-16T12:00:00');
const MIN = 60_000;
type Row = Record<string, unknown>;
const idbPut = (page: Page, store: string, rows: Row[]) => page.evaluate(async ([s, rs]) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, [store, rows] as const);
/** 끝낸 운동: 한 종목, 같은 세트 n 개 (로컬 시각 y-m-d 10시, 40분) */
const done = (id: string, y: number, m: number, d: number, sets: number, weight = 50, reps = 10) => {
  const start = new Date(y, m - 1, d, 10).getTime();
  return { id, name: '기록 테스트', startedAt: new Date(start).toISOString(), endedAt: new Date(start + 40 * MIN).toISOString(), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench_press', target: { sets, reps }, sets: Array.from({ length: sets }, () => ({ warmup: false, done: true, weight, reps, doneAt: new Date(start + 5 * MIN).toISOString() })) }] }] };
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(TODAY);
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 기기에만 저장돼요')).toBeVisible();
  await page.getByRole('button', { name: '알겠어요' }).click();
  await idbPut(page, 'workouts', [
    done('t1', 2026, 11, 16, 4), done('t2', 2026, 11, 15, 3), // 이번 주 (월·일)
    done('l1', 2026, 11, 9, 5), done('l2', 2026, 11, 13, 2), // 지난주 (같은 요일까지: l1 만)
    done('s1', 2026, 9, 10, 3), // 9월
    done('y1', 2025, 6, 7, 6), // 작년 (가장 오래된 기록)
  ]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('this-week')).toBeVisible();
});

const card = (page: Page) => page.getByTestId('this-week');
const chart = (page: Page) => page.getByTestId('period-chart');
const bars = (page: Page) => chart(page).locator('rect.pb-bar');
const kind = (page: Page, n: string) => card(page).getByRole('group', { name: '기간 단위' }).getByRole('button', { name: n, exact: true });

test('기본 주 보기: 7칸, 이번 주 이름, 비교 문장, 카드 4개', async ({ page }) => {
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 주');
  await expect(bars(page)).toHaveCount(7);
  await expect(chart(page)).toHaveAttribute('aria-valuemax', '7');
  await expect(chart(page)).toHaveAttribute('aria-label', '일별 작업 세트 그래프');
  await expect(kind(page, '주')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('period-headline')).toHaveText('지난주 이맘때보다 작업 세트가 2세트 많아요'); // 7 vs 5
  await expect(card(page).getByRole('button', { name: '운동 2회, 지난주 같은 요일까지 1회보다 1회 많음' })).toBeVisible();
  await expect(card(page)).toContainText('지난주 같은 요일(일~월)까지와 비교');
  await expect(card(page).getByTestId('period-caption')).toHaveText('합계 · 작업 세트 7세트');
});

test('월·년으로 바꾸면 칸 수와 이름이 바뀐다', async ({ page }) => {
  await kind(page, '월').click();
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 달');
  await expect(bars(page)).toHaveCount(30);
  await expect(card(page)).toContainText('지난달 같은 날(1~16일)까지와 비교');
  await kind(page, '년').click();
  await expect(card(page).getByTestId('period-label')).toHaveText('올해');
  await expect(bars(page)).toHaveCount(12);
  await expect(chart(page)).toHaveAttribute('aria-label', '월별 작업 세트 그래프');
});

test('이전·다음 이동과 끝 비활성', async ({ page }) => {
  const prev = card(page).getByRole('button', { name: '이전 주' }), next = card(page).getByRole('button', { name: '다음 주' });
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(card(page).getByTestId('period-label')).toHaveText('지난주');
  await expect(card(page).getByTestId('period-range')).toContainText('vs. 그 전 주');
  await expect(next).toBeEnabled();
  await next.click();
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 주');
  await kind(page, '년').click();
  const py = card(page).getByRole('button', { name: '이전 해' });
  await py.click();
  await expect(card(page).getByTestId('period-label')).toHaveText('작년');
  await expect(py).toBeDisabled(); // 가장 오래된 기록이 2025년
  await expect(card(page).getByRole('button', { name: '다음 해' })).toBeEnabled();
  await expect(card(page).getByTestId('period-headline')).toContainText('그 전 해는 기록이 없었어요');
});

test('볼륨 카드를 누르면 그래프 지표가 바뀐다', async ({ page }) => {
  const vol = card(page).getByTestId('pm-volume');
  await expect(vol).toHaveAttribute('aria-pressed', 'false');
  await vol.click();
  await expect(vol).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('pm-sets')).toHaveAttribute('aria-pressed', 'false');
  await expect(chart(page)).toHaveAttribute('aria-label', '일별 볼륨 그래프');
  await expect(card(page).getByTestId('period-caption')).toHaveText('합계 · 볼륨 3,500kg'); // 7세트 × 500
  await expect(card(page).getByTestId('period-headline')).toContainText('볼륨이');
});

test('슬라이더: 화살표로 칸을 고르고 Esc 로 해제', async ({ page }) => {
  const c = chart(page), cap = card(page).getByTestId('period-caption');
  await c.focus();
  await page.keyboard.press('ArrowLeft'); // 고른 칸이 없으면 첫 화살표는 오늘(월) 칸을 고름
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트');
  await page.keyboard.press('ArrowLeft');
  await expect(cap).toHaveText('11월 15일 (일) · 작업 세트 3세트');
  await expect(c).toHaveAttribute('aria-valuetext', '11월 15일 (일) · 작업 세트 3세트');
  await expect(c).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트');
  await page.keyboard.press('ArrowRight'); // 미래 칸은 못 고름
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트');
  await page.keyboard.press('Escape');
  await expect(cap).toHaveText('합계 · 작업 세트 7세트');
});

test('고른 단위·지표는 새로 열어도 기억 (이동한 기간은 이번으로)', async ({ page }) => {
  await kind(page, '월').click();
  await card(page).getByTestId('pm-volume').click();
  await card(page).getByRole('button', { name: '이전 달' }).click();
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(kind(page, '월')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('pm-volume')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 달');
});

test('390px 가로 스크롤 없음 (주·월·년), 밝은 화면도 그려짐', async ({ page }) => {
  const noScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
  for (const k of ['주', '월', '년']) {
    await kind(page, k).click();
    await card(page).getByTestId('pm-time').click();
    await noScroll();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(card(page)).toBeVisible();
  await expect(bars(page)).toHaveCount(12);
  await noScroll();
});
