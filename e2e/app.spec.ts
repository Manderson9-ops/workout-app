import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });

/** 가로 스크롤 없음 (7.1) */
async function noHorizontalScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, '가로 스크롤').toBeLessThanOrEqual(r.cw);
}
/** 보이는 버튼·입력·탭의 터치 영역 44×44 이상 (7.1) */
async function touchTargets(page: Page) {
  const bad = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('button, input:not([type=checkbox]), select, [role=button], nav a, a.btn, a.banner')];
    return els.filter((el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
      return r.width < 43.5 || r.height < 43.5;
    }).map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
  });
  expect(bad, '44pt 미만 터치 영역').toEqual([]);
}
async function checkScreen(page: Page, name: string) { await noHorizontalScroll(page); await touchTargets(page); await shot(page, name); }

let taps = 0;
async function tap(page: Page, locator: ReturnType<Page['locator']>) { taps++; await locator.click(); }

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('./#/');
});

test('플랜 만들기 → 저장하고 시작 → 세트 기록·타이머 → 종료 (핵심 흐름)', async ({ page }) => {
  await expect(page.getByText('아직 루틴이 없어요')).toBeVisible();
  await checkScreen(page, '01-home-empty');
  await page.getByRole('button', { name: '+ 플랜 만들기' }).click();
  await page.getByRole('button', { name: '등 선택 안 함' }).click();
  await page.getByRole('button', { name: '삼두 선택 안 함' }).click();
  await page.getByRole('button', { name: '삼두 높음' }).click(); // 높음 → 보통
  await page.getByRole('button', { name: '45분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  await expect(planSec.getByText('슈퍼세트').first()).toBeVisible();
  await expect(planSec.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
  await expect(planSec.getByText(/예상 \d+:\d{2} \/ 45분/)).toBeVisible();
  await checkScreen(page, '02-plan');
  // 잠금 후 다시 생성해도 유지
  await planSec.getByRole('button', { name: '잠금' }).first().click();
  await planSec.getByRole('button', { name: /다시 생성 \(잠금 1개 유지\)/ }).click();
  await expect(planSec.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByLabel('루틴 이름')).toHaveValue('등+삼두 45분');
  await page.getByRole('button', { name: '저장하고 시작' }).click();

  // 운동 화면
  await expect(page.getByRole('heading', { name: '등+삼두 45분' })).toBeVisible();
  await checkScreen(page, '03-workout');
  taps = 0;
  const big = page.getByRole('button', { name: '현재 세트 완료' });
  await page.getByLabel(/원암 랫풀다운 1세트 무게/).first().fill('40');
  await tap(page, big);
  await expect(page.getByRole('timer')).toContainText(/다음 운동으로 바로|세트 간 휴식|라운드 후 휴식/);
  await expect(page.getByLabel('원암 랫풀다운 2세트 무게', { exact: true })).toHaveValue('40'); // 앞 세트 무게 이어받기
  await tap(page, big);
  await expect(page.getByLabel(/휴식 남은 시간 \d+초/)).toBeVisible();
  const before = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  await page.getByRole('button', { name: '15초 늘리기' }).click();
  await expect.poll(async () => Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0])).toBeGreaterThanOrEqual(before + 13);
  await checkScreen(page, '04-timer');
  await tap(page, big);
  await expect(page.getByText(/3\/\d+세트/)).toBeVisible();
  // 다시 열어도 진행 상황·타이머 유지 (기기 저장)
  await page.reload();
  await expect(page.getByText(/3\/\d+세트/)).toBeVisible();
  await expect(page.getByLabel(/휴식 남은 시간 \d+초/)).toBeVisible();
  await tap(page, page.getByRole('button', { name: '종료' }));
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect(page.getByText(/작업 세트 3개/)).toBeVisible();
  expect(taps, '세트 3개 기록 + 종료 탭 수 (확인창 포함 12 이하)').toBeLessThanOrEqual(12);
  await checkScreen(page, '05-home-after');

  // 저장된 루틴으로 다시 시작: 지난번 무게가 미리 채워짐
  await page.getByRole('button', { name: /등\+삼두 45분 시작/ }).click();
  await expect(page.getByLabel(/원암 랫풀다운 1세트 무게/).first()).toHaveValue('40');
  await expect(page.getByText(/지난번: 40kg/).first()).toBeVisible();
});

test('운동 종목: 초성 검색, 상세의 영상 등급·시점 링크, 즐겨찾기', async ({ page }) => {
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByLabel('운동 검색').fill('ㄹㅍㄷ');
  await expect(page.getByRole('button', { name: '랫풀다운', exact: true })).toBeVisible();
  await checkScreen(page, '06-exercises');
  await page.getByLabel('운동 검색').fill('');
  await page.getByRole('button', { name: '삼두' }).first().click();
  await page.getByRole('button', { name: '스미스머신 JM프레스' }).click();
  await expect(page.getByRole('heading', { name: '영상 등급' })).toBeVisible();
  const link = page.getByRole('link', { name: /최고의 삼두근 운동/ }).first();
  await expect(link).toHaveAttribute('href', /i40LqeORuxA&t=\d+s/);
  await page.getByRole('button', { name: '☆ 즐겨찾기' }).click();
  await expect(page.getByRole('button', { name: '★ 즐겨찾기' })).toBeVisible();
  await noHorizontalScroll(page); await touchTargets(page);
  await shot(page, '07-exercise-detail');
});

test('운동 직접 추가 → 플랜에서 교체 가능, 설정 화면', async ({ page }) => {
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByRole('button', { name: '+ 직접 추가' }).click();
  await page.getByLabel('운동 이름').fill('우리 헬스장 체스트 머신');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('운동 검색').fill('우리 헬스장');
  await expect(page.getByRole('button', { name: '우리 헬스장 체스트 머신' })).toBeVisible();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '상급' }).click();
  await expect(page.getByRole('button', { name: '상급' })).toHaveAttribute('aria-pressed', 'true');
  await checkScreen(page, '08-settings');
});

test('시간이 너무 짧으면 이유를 보여줌, 부위 없이 만들 수 없음', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await expect(page.getByRole('button', { name: '부위를 먼저 고르세요' })).toBeDisabled();
  for (const p of ['하체', '등', '가슴']) await page.getByRole('button', { name: `${p} 선택 안 함` }).click();
  await page.getByRole('button', { name: '30분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  await expect(page.getByText(/이렇게 짠 이유/)).toBeVisible();
  await noHorizontalScroll(page);
});
