/**
 * D-081 기록 요약 탭의 기간 요약 카드 (주·월·년, 비교 문장, 지표 카드, 막대 그래프).
 * 시각을 2026-11-16(월) 낮 12시로 고정하고 기록은 저장소(IndexedDB)에 직접 넣는다 (swap.spec.ts 와 같은 방식)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ timezoneId: 'Asia/Seoul', locale: 'ko-KR' }); // 날짜 계산이 시험 PC 의 시간대·언어에 안 흔들리게
const TODAY = new Date('2026-11-16T12:00:00+09:00');
const MIN = 60_000;
type Row = Record<string, unknown>;
const idbPut = (page: Page, store: string, rows: Row[]) => page.evaluate(async ([s, rs]) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, [store, rows] as const);
/** 끝낸 운동: 한 종목, 같은 세트 n 개 (로컬 시각 y-m-d 10시, 40분) */
const done = (id: string, y: number, m: number, d: number, sets: number, weight = 50, reps = 10, mins = 40) => {
  const start = Date.UTC(y, m - 1, d, 1); // 한국 시각 10시 (시험 PC 시간대와 무관)
  return { id, name: '기록 테스트', startedAt: new Date(start).toISOString(), endedAt: new Date(start + mins * MIN).toISOString(), timer: null,
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
  await expect(chart(page)).toHaveAttribute('aria-valuemax', '2'); // 고를 수 있는 마지막 칸 = 오늘(월)
  await expect(chart(page)).toHaveAttribute('aria-valuenow', '2');
  await expect(chart(page)).toHaveAttribute('aria-label', '일별 작업 세트 그래프');
  await expect(kind(page, '주')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('period-headline')).toHaveText('이번 주: 지난주 이맘때보다 작업 세트가 2세트 많아요'); // 7 vs 5
  await expect(card(page).getByRole('button', { name: '운동 2회, 지난주 같은 요일까지 1회보다 1회 많음' })).toBeVisible();
  await expect(card(page)).toContainText('지난주 같은 요일(일~월)까지와 비교');
  await expect(card(page).getByTestId('period-caption')).toHaveText('막대를 누르거나 옆으로 밀면 날짜별 값이 보여요');
  await expect(chart(page)).toHaveAttribute('aria-valuetext', '합계 · 작업 세트 7세트 · 방향키로 칸을 고르면 날짜별 값');
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
  await expect(card(page).getByTestId('period-headline')).toContainText('전년은 운동이 없었어요');
});

test('볼륨 카드를 누르면 그래프 지표가 바뀐다', async ({ page }) => {
  const vol = card(page).getByTestId('pm-volume');
  await expect(vol).toHaveAttribute('aria-pressed', 'false');
  await vol.click();
  await expect(vol).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('pm-sets')).toHaveAttribute('aria-pressed', 'false');
  await expect(chart(page)).toHaveAttribute('aria-label', '일별 볼륨 그래프');
  await expect(chart(page)).toHaveAttribute('aria-valuetext', '합계 · 볼륨 3,500kg · 방향키로 칸을 고르면 날짜별 값'); // 7세트 × 500
  await expect(card(page).getByTestId('period-headline')).toContainText('볼륨이');
});

test('슬라이더: 화살표로 칸을 고르고 Esc 로 해제', async ({ page }) => {
  const c = chart(page), cap = card(page).getByTestId('period-caption');
  await c.focus();
  await page.keyboard.press('ArrowLeft'); // 고른 칸이 없으면 첫 화살표는 오늘(월) 칸을 고름
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트 · 운동 1회');
  await page.keyboard.press('ArrowLeft');
  await expect(cap).toHaveText('11월 15일 (일) · 작업 세트 3세트 · 운동 1회');
  await expect(c).toHaveAttribute('aria-valuetext', '11월 15일 (일) · 작업 세트 3세트 · 운동 1회');
  await expect(c).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowUp'); // ↑ = 오른쪽
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트 · 운동 1회');
  await page.keyboard.press('ArrowRight'); // 미래 칸은 못 고름
  await expect(cap).toHaveText('11월 16일 (월) · 작업 세트 4세트 · 운동 1회');
  await expect(c).toHaveAttribute('aria-valuemax', '2'); // 고를 수 있는 마지막 칸 = 오늘
  await page.keyboard.press('PageDown'); // 한 번에 끝으로
  await expect(cap).toHaveText('11월 15일 (일) · 작업 세트 3세트 · 운동 1회');
  await page.keyboard.press('ArrowDown');
  await expect(cap).toHaveText('11월 15일 (일) · 작업 세트 3세트 · 운동 1회');
  await page.keyboard.press('Escape');
  await expect(cap).toHaveText('막대를 누르거나 옆으로 밀면 날짜별 값이 보여요');
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

test('390px 가로 스크롤 없음 (주·월·년)', async ({ page }) => {
  const noScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
  for (const k of ['주', '월', '년']) {
    await kind(page, k).click();
    await card(page).getByTestId('pm-time').click();
    await noScroll();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bars(page)).toHaveCount(12);
  await noScroll();
});

/** 합성 포인터 이벤트 (pointerType touch): 그래프 가운데 줄 기준 좌표 */
async function ptr(page: Page, type: string, x: number, y: number) {
  await page.getByTestId('period-chart').evaluate((el, a) => {
    el.dispatchEvent(new PointerEvent(a.type, { pointerId: 7, pointerType: 'touch', clientX: a.x, clientY: a.y, bubbles: true, isPrimary: true }));
  }, { type, x, y });
}
/** 주 보기 i 번째 칸(일=0)의 화면 좌표 */
async function slot(page: Page, i: number) {
  const b = (await chart(page).boundingBox())!;
  const s = (b.width - 16) / 7;
  return { x: b.x + 8 + s * (i + 0.5), y: b.y + b.height / 2, s };
}

test('터치: 세로로 끌면 고르지 않고(스크롤), 가로로 끌면 훑고, 탭은 고름·다시 탭하면 해제, 취소는 원래대로', async ({ page }) => {
  const cap = card(page).getByTestId('period-caption');
  const total = '막대를 누르거나 옆으로 밀면 날짜별 값이 보여요';
  const sun = await slot(page, 0), mon = await slot(page, 1);
  // 세로 끌기 + 취소(브라우저가 스크롤로 가져감) → 그대로
  await ptr(page, 'pointerdown', sun.x, sun.y);
  await ptr(page, 'pointermove', sun.x, sun.y + 20);
  await ptr(page, 'pointercancel', sun.x, sun.y + 20);
  await expect(cap).toHaveText(total);
  // 세로 끌기 뒤 떼기도 고르지 않음
  await ptr(page, 'pointerdown', sun.x, sun.y);
  await ptr(page, 'pointermove', sun.x + 2, sun.y + 12);
  await ptr(page, 'pointerup', sun.x + 2, sun.y + 12);
  await expect(cap).toHaveText(total);
  // 가로 끌기: 훑는 동안 고름, 떼도 그대로
  await ptr(page, 'pointerdown', sun.x, sun.y);
  await ptr(page, 'pointermove', mon.x, sun.y);
  await expect(cap).toContainText('11월 16일 (월)');
  await ptr(page, 'pointerup', mon.x, sun.y);
  await expect(cap).toContainText('11월 16일 (월)');
  await chart(page).focus(); await page.keyboard.press('Escape');
  await expect(cap).toHaveText(total);
  // 훑다가 취소 → 처음(고른 칸 없음)으로
  await ptr(page, 'pointerdown', sun.x, sun.y);
  await ptr(page, 'pointermove', mon.x, sun.y);
  await expect(cap).toContainText('11월 16일 (월)');
  await ptr(page, 'pointercancel', mon.x, sun.y);
  await expect(cap).toHaveText(total);
  // 탭 = 고름, 같은 칸 다시 탭 = 해제
  await ptr(page, 'pointerdown', sun.x, sun.y); await ptr(page, 'pointerup', sun.x, sun.y);
  await expect(cap).toContainText('11월 15일 (일)');
  await ptr(page, 'pointerdown', sun.x, sun.y); await ptr(page, 'pointerup', sun.x, sun.y);
  await expect(cap).toHaveText(total);
  // 미래 칸 탭은 무시
  const fri = await slot(page, 5);
  await ptr(page, 'pointerdown', fri.x, fri.y); await ptr(page, 'pointerup', fri.x, fri.y);
  await expect(cap).toHaveText(total);
});

test('운동한 날 점·평균 범례·큰 숫자 쉼표·이동줄', async ({ page }) => {
  await expect(chart(page).locator('circle.pb-dot')).toHaveCount(2); // 일·월
  await expect(card(page).getByTestId('period-avg')).toHaveText('운동한 날 평균 3.5세트'); // (3+4)/2
  await expect(card(page).getByTestId('period-range')).toHaveText('11월 15일~21일 vs. 지난주');
  await card(page).getByTestId('pm-count').click();
  await expect(card(page).getByTestId('period-avg')).toHaveCount(0); // 주·월 보기의 운동 수는 평균선 없음
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await expect(card(page).getByTestId('period-range')).toHaveText('vs. 그 전 주'); // 라벨이 날짜면 범위 줄은 없음
});

test('지난 주 운동 안 한 날을 고르면 "운동 안 함", 일요일 라벨은 빨강·토요일은 파랑', async ({ page }) => {
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await chart(page).focus();
  await page.keyboard.press('Home');
  await expect(card(page).getByTestId('period-caption')).toHaveText('11월 8일 (일) · 운동 안 함');
  await page.keyboard.press('ArrowRight');
  await expect(card(page).getByTestId('period-caption')).toHaveText('11월 9일 (월) · 작업 세트 5세트 · 운동 1회');
  const colors = await chart(page).locator('text.ch-text').evaluateAll((els) => els.map((e) => getComputedStyle(e).fill));
  expect(colors[0], '일요일 라벨').not.toBe(colors[1]);
  expect(colors[6], '토요일 라벨').not.toBe(colors[1]);
});

test('운동한 칸이 하나뿐이면 평균 범례 없음, 기록 없는 기간은 한 줄 안내', async ({ page }) => {
  await kind(page, '월').click();
  await card(page).getByRole('button', { name: '이전 달' }).click();
  await card(page).getByRole('button', { name: '이전 달' }).click(); // 9월: 운동한 날 하루
  await expect(card(page).getByTestId('period-label')).toHaveText('9월');
  await expect(card(page).getByTestId('period-avg')).toHaveCount(0);
  await card(page).getByRole('button', { name: '이전 달' }).click(); // 8월: 기록 없음
  await expect(page.getByTestId('period-chart-empty')).toHaveText('이 기간에는 운동 기록이 없어요');
  await expect(page.getByTestId('period-chart')).toHaveCount(0);
});

test('볼륨 100만 kg 이상이면 카드가 톤으로, 한 줄에 들어감', async ({ page }) => {
  await idbPut(page, 'workouts', [done('big', 2025, 6, 8, 5, 40000), done('mar', 2025, 3, 3, 4, 50)]); // 5세트 × 40,000kg × 10회 = 2,000,000kg
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await kind(page, '년').click();
  const vol = card(page).getByTestId('pm-volume');
  await expect(vol).toContainText('톤');
  await expect(vol).toContainText('이전 2,00');
  await vol.click();
  await card(page).getByRole('button', { name: '이전 해' }).click(); // 지난 해는 진행 중인 달이 없어 평균을 보임 (올해 보기는 이번 달을 평균에서 뺌)
  await expect(card(page).getByTestId('period-avg')).toContainText('톤'); // 평균 범례·맨 위 눈금·읽기 문구도 같은 단위
  await expect(card(page).getByTestId('period-avg')).not.toContainText('kg');
  await expect(chart(page)).toHaveAttribute('aria-valuetext', /톤/);
  await expect(chart(page).locator('text.ch-text').first()).toContainText('톤');
  await expect(vol.locator('.num').first()).toBeVisible();
  const hs = await vol.locator('.num').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of hs) expect(h, '큰 숫자 한 줄').toBeLessThan(40);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
});

test('좁은 화면(320px)에서도 한 문장 안의 값·라벨이 줄 중간에서 갈리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await card(page).getByTestId('pm-volume').click();
  const head = card(page).getByTestId('period-headline');
  await expect(head).toContainText('볼륨이');
  await expect(head).not.toContainText('⁠');
  const hs = await head.locator('.nw').evaluateAll((els) => els.map((e) => ({ t: e.textContent, h: e.getBoundingClientRect().height })));
  expect(hs.some((x) => /kg/.test(x.t ?? ''))).toBe(true);
  for (const x of hs) expect(x.h, `${x.t} 한 줄`).toBeLessThan(26);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
});

test('자정을 넘기면 고른 칸만 비우고 보던 기간은 그대로 (N3·R5)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-16T23:59:58+09:00'));
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  const cap = card(page).getByTestId('period-caption');
  const hint = '막대를 누르거나 옆으로 밀면 날짜별 값이 보여요';
  await chart(page).focus();
  await page.keyboard.press('ArrowLeft'); // 오늘(월) 칸
  await expect(cap).toContainText('11월 16일 (월)');
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await expect(card(page).getByTestId('period-label')).toHaveText('지난주');
  await chart(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(cap).not.toHaveText(hint);
  await page.clock.setFixedTime(new Date('2026-11-17T00:00:03+09:00')); // 앱은 1초마다 다시 그림
  await expect(cap).toHaveText(hint);
  await expect(card(page).getByTestId('period-label')).toHaveText('지난주'); // 같은 주 안이라 보던 지난주 그대로
  await expect(chart(page)).toHaveAttribute('aria-valuetext', /합계/);
});

test('주가 바뀌는 자정: 지난 기간을 보던 중이면 같은 날짜 범위를 계속 보여 준다 (R5)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-21T23:59:58+09:00')); // 토요일 밤
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await expect(card(page).getByTestId('period-label')).toHaveText('지난주'); // 11/8~14
  await page.clock.setFixedTime(new Date('2026-11-22T00:00:03+09:00')); // 일요일 0시
  await expect(card(page).getByTestId('period-label')).toHaveText('11월 8일~14일'); // 이제 2주 전이지만 같은 주
  await card(page).getByRole('button', { name: '다음 주' }).click();
  await card(page).getByRole('button', { name: '다음 주' }).click();
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 주');
});

test('자정에 기간이 바뀌어도 이번 기간을 보던 중이면 새 이번 주·이번 달로 간다 (S1)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-21T23:59:58+09:00')); // 토요일 밤
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 주');
  await expect(card(page).getByTestId('period-range')).toContainText('11월 15일~21일');
  await page.clock.setFixedTime(new Date('2026-11-22T00:00:04+09:00'));
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 주'); // 지난주가 아님
  await expect(card(page).getByTestId('period-range')).toContainText('11월 22일~28일');
  await kind(page, '월').click();
  await page.clock.setFixedTime(new Date('2026-11-30T23:59:58+09:00'));
  await expect(card(page).getByTestId('period-range')).toContainText('11월 1일~30일');
  await page.clock.setFixedTime(new Date('2026-12-01T00:00:04+09:00'));
  await expect(card(page).getByTestId('period-label')).toHaveText('이번 달');
  await expect(card(page).getByTestId('period-range')).toContainText('12월 1일~31일');
});

test('오늘 운동 전이면 지난주는 어제 같은 요일까지만 견준다 (P2)', async ({ page }) => {
  // 화요일(11/17) 낮: 지난주 월(11/9) 5세트, 지난주 화(11/10) 4세트. 오늘 운동 전 = 월까지(5), 오늘 운동 뒤 = 화까지(9)
  await idbPut(page, 'workouts', [done('lt', 2026, 11, 10, 4)]);
  await page.clock.setFixedTime(new Date('2026-11-17T12:00:00+09:00'));
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  const prev = card(page).getByTestId('pm-sets').locator('.pm-prev');
  await expect(prev).toHaveText('이전 5세트');
  await expect(card(page)).toContainText('(일~월)까지와 비교 · 오늘 운동하면 화요일까지'); // 실제로 견주는 구간과 바뀔 구간
  await idbPut(page, 'workouts', [done('td', 2026, 11, 17, 2)]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(prev).toHaveText('이전 9세트');
  await expect(card(page)).toContainText('(일~화)까지와 비교');
  await expect(card(page)).not.toContainText('오늘 운동하면 화요일까지');
});

test('320px: 네 카드의 큰 숫자 줄과 작은 줄이 모두 한 줄이고 안내 글이 보인다 (현재 주의 세 자리 시간·지난 주·지난 달의 16시간 28분) (Q4·R2)', async ({ page }) => {
  await idbPut(page, 'workouts', [
    done('mega', 2026, 11, 15, 1, 50, 10, 10000), // 이번 주 시간 세 자리 시간 (168시간대)
    done('sepl', 2026, 9, 11, 3, 4000, 10, 948), // 9월 시간 16시간 28분 (+ 기본 40분), 볼륨 121,500kg
  ]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  const checkAll = async (tag: string) => {
    await expect(card(page).getByTestId('pm-note'), `${tag} 안내`).toBeVisible();
    for (const id of ['count', 'sets', 'volume', 'time']) {
      const c = card(page).getByTestId(`pm-${id}`);
      const mv = await c.locator('.m-val').evaluate((e) => e.getBoundingClientRect().height);
      const pv = await c.locator('.pm-prev').evaluate((e) => e.getBoundingClientRect().height);
      expect(mv, `${tag} ${id} 큰 숫자 한 줄`).toBeLessThan(34);
      expect(pv, `${tag} ${id} 작은 줄 한 줄`).toBeLessThan(20);
      const b = (await c.boundingBox())!, v = (await c.locator('.m-val').boundingBox())!, p = (await c.locator('.pm-prev').boundingBox())!;
      expect(v.x + v.width, `${tag} ${id} 숫자 줄이 카드 안`).toBeLessThanOrEqual(b.x + b.width + 0.5);
      expect(p.x + p.width, `${tag} ${id} 작은 줄이 카드 안`).toBeLessThanOrEqual(b.x + b.width + 0.5);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth), `${tag} 가로 스크롤 없음`).toBe(true);
  };
  await expect(card(page).getByTestId('pm-time').locator('.num').first()).toHaveText(/^[0-9]{3}$/); // 세 자리 시간
  await checkAll('이번 주');
  await expect(card(page).getByTestId('pm-note')).toHaveText('작은 글씨 = 지난주 이맘때 값');
  await card(page).getByRole('button', { name: '이전 주' }).click();
  await checkAll('지난 주');
  await expect(card(page).getByTestId('pm-note')).toHaveText('작은 글씨 = 그 전 주 전체 값');
  await kind(page, '월').click();
  await card(page).getByRole('button', { name: '이전 달' }).click(); // 10월 (견줄 달 = 9월)
  await checkAll('지난 달');
  await expect(card(page).getByTestId('pm-time').locator('.pm-prev')).toHaveText('이전 16시간 28분');
  await expect(card(page).getByTestId('pm-volume').locator('.pm-prev')).toHaveText('이전 121,500kg');
});

test('기간 첫날 운동 전(일요일 아침): 배지·증감 없이 "운동하면 비교해요", 홈도 증감 없음 (Q2)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T09:00:00+09:00')); // 일요일, 지난주(11/15~21)에 운동 있음
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(card(page).locator('.pm-badge')).toHaveCount(0);
  for (const id of ['count', 'sets', 'volume', 'time']) await expect(card(page).getByTestId(`pm-${id}`).locator('.pm-prev')).toHaveText('운동하면 비교해요');
  await expect(card(page).getByTestId('pm-sets')).toHaveAttribute('aria-label', '작업 세트 0세트, 오늘 운동하면 지난주 같은 요일까지와 비교해요');
  await expect(card(page)).toContainText('오늘 운동하면 지난주 같은 요일(일)까지와 비교');
  await page.getByRole('link', { name: '홈', exact: true }).click();
  const home = page.getByTestId('home-week');
  await expect(home).toBeVisible();
  await expect(home).not.toContainText('지난주');
});

test('오늘 뒤 날짜로 적힌 기록은 기록 탭·홈 어디서도 이번 주에 안 센다 (Q3·P6)', async ({ page }) => {
  await idbPut(page, 'workouts', [done('fut', 2026, 11, 18, 9)]); // 11/16 기준 수요일(미래)
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(card(page).getByTestId('pm-sets')).toHaveAttribute('aria-label', /^작업 세트 7세트/);
  await expect(card(page).getByTestId('pm-count')).toHaveAttribute('aria-label', /^운동 2회/);
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.getByTestId('home-week')).toHaveAttribute('aria-label', /2회, 작업 세트 7개/);
});

test('월말: 이번 달이 더 길면 지난달 전체와 견주고 모든 문구가 같은 말을 한다 (3/30, 운동 전·후) (T1·U4)', async ({ page }) => {
  await idbPut(page, 'workouts', [done('feb', 2027, 2, 10, 4), done('mar', 2027, 3, 10, 3)]);
  await page.clock.setFixedTime(new Date('2027-03-30T10:00:00+09:00'));
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await kind(page, '월').click();
  const check = async (tag: string, gap: string) => {
    await expect(card(page).getByTestId('period-headline'), `${tag} 한 문장`).toContainText('지난달 전체');
    await expect(card(page).getByTestId('pm-note'), `${tag} 안내`).toHaveText('작은 글씨 = 지난달 전체 값');
    await expect(card(page).getByTestId('pm-sets'), `${tag} 카드 읽기`).toHaveAttribute('aria-label', /지난달 전체\(1~28일\)/);
    await expect(card(page), `${tag} 각주`).toContainText(`지난달 전체(1~28일)와 비교 · 이번 달 구간이 ${gap} 더 길어요`);
    await expect(card(page).getByTestId('period-range'), `${tag} 이동줄`).toContainText('vs. 지난달 전체');
  };
  await check('운동 전', '하루'); // 기준일 3/29 → 28일과 1일 차이
  await idbPut(page, 'workouts', [done('today', 2027, 3, 30, 2)]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await check('운동 후', '2일'); // 기준일 3/30
});

test('320px 년 보기: 평균 안내의 값과 각주 날짜가 줄 중간에서 갈리지 않는다 (U1·U2)', async ({ page }) => {
  await idbPut(page, 'workouts', [
    done('a', 2025, 2, 3, 40, 110, 10, 954), done('b', 2025, 3, 3, 30, 90, 10, 700), done('c', 2025, 4, 3, 44, 130, 10, 480),
  ]);
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await kind(page, '년').click();
  await card(page).getByRole('button', { name: '이전 해' }).click(); // 2025: 평균을 보임
  for (const id of ['pm-sets', 'pm-volume', 'pm-time']) {
    await card(page).getByTestId(id).click();
    const v = card(page).getByTestId('period-avg-value');
    await expect(v).toBeVisible();
    expect(await v.evaluate((e) => e.getBoundingClientRect().height), `${id} 평균 값 한 줄`).toBeLessThan(20);
  }
  await card(page).getByRole('button', { name: '다음 해' }).click(); // 올해: 각주의 날짜 묶음
  const dates = await card(page).locator('p.sub.small span.nw').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(dates.length).toBeGreaterThan(0);
  for (const h of dates) expect(h, '각주 날짜 한 줄').toBeLessThan(20);
});

test('320px: 1,000시간이 넘는 시간 카드도 카드 안에 한 줄 (W7)', async ({ page }) => {
  await idbPut(page, 'workouts', [done('huge', 2026, 11, 14, 1, 50, 10, 60500), done('huge25', 2025, 6, 8, 1, 50, 10, 60500)]); // 올해·작년 모두 1,008시간 20분 안팎
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  await kind(page, '년').click();
  const c = card(page).getByTestId('pm-time');
  await expect(c.locator('.num').first()).toHaveText(/^1,0[0-9]{2}$/);
  const b = (await c.boundingBox())!, v = (await c.locator('.m-val').boundingBox())!;
  expect(v.height, '큰 숫자 한 줄').toBeLessThan(34);
  expect(v.x + v.width, '카드 안').toBeLessThanOrEqual(b.x + b.width + 0.5);
  const inner = await c.locator('.m-val').evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
  expect(inner, '넘치지 않음').toBe(true);
  const pv = c.locator('.pm-prev');
  await expect(pv).toContainText('이전 1,0');
  const pb = (await pv.boundingBox())!;
  expect(pb.height, '이전 값 한 줄').toBeLessThan(20);
  expect(pb.x + pb.width, '이전 값이 카드 안').toBeLessThanOrEqual(b.x + b.width + 0.5);
  expect(await pv.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), '이전 값이 넘치지 않음').toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
});
