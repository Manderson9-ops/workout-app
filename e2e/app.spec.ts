import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });

/** 가로 스크롤 없음 (7.1) */
async function noHorizontalScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, '가로 스크롤').toBeLessThanOrEqual(r.cw);
}
/** 보이는 버튼·입력·탭의 터치 영역 44×44 이상 (7.1). 열린 시트 안도 포함 */
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

/** 플랜을 만들어 루틴으로 저장만 (홈으로) */
async function makeRoutine(page: Page, parts: string[], minutes: string) {
  await page.getByRole('link', { name: '플랜' }).click();
  for (const p of parts) await page.getByRole('button', { name: `${p} 선택 안 함` }).click();
  if (parts.length > 1) await page.getByRole('button', { name: `${parts[1]} 높음` }).click();
  await page.getByRole('button', { name: minutes }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장만' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 아이폰에만 저장돼요')).toBeVisible(); // 첫 실행 안내
  await page.getByRole('button', { name: '알겠어요' }).click();
});

test('핵심 흐름: 플랜 → 루틴 저장 → 홈에서 시작 → 세트 3개 → 종료 (탭 수 12 이하)', async ({ page }) => {
  let taps = 0;
  const tap = async (l: Locator) => { taps++; await l.click(); };
  page.on('dialog', (d) => { taps++; void d.accept(); }); // 확인창도 한 번의 탭으로 셈

  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '등 선택 안 함' }).click();
  await page.getByRole('button', { name: '삼두 선택 안 함' }).click();
  await page.getByRole('button', { name: '삼두 높음' }).click();
  await page.getByRole('button', { name: '45분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  await expect(planSec.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
  await expect(planSec.getByText(/예상 \d+:\d{2} \/ 45분/)).toBeVisible();
  await expect(planSec.getByText(/라운드 후 휴식 \d+초/).first()).toBeVisible(); // 블록별 휴식 표시 (5.10)
  await checkScreen(page, '02-plan');
  // 다른 화면에 다녀와도 플랜 유지
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByRole('link', { name: '플랜' }).click();
  await expect(planSec.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
  // 모두 잠그고 다시 생성 → 같은 운동 (lockedOnly, D-015)
  const names = await planSec.locator('strong').allTextContents();
  const unlocked = planSec.getByRole('button', { name: '잠금', exact: true });
  while (await unlocked.count()) await unlocked.first().click();
  await planSec.getByRole('button', { name: /다시 생성 \(잠금 \d+개 유지\)/ }).click();
  expect(await planSec.locator('strong').allTextContents()).toEqual(names);
  // 교체 시트도 44pt 검사
  await planSec.getByRole('button', { name: '교체' }).first().click();
  await expect(page.getByRole('dialog', { name: '운동 교체' })).toBeVisible();
  await touchTargets(page);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByLabel('루틴 이름')).toHaveValue('등+삼두 45분');
  await page.getByRole('button', { name: '저장만' }).click();

  // 7.1 핵심 흐름: 홈에서 시작 → 세트 3개 → 종료
  taps = 0;
  await tap(page.getByRole('button', { name: /등\+삼두 45분 시작/ }));
  await expect(page).toHaveURL(/#\/workout/);
  await expect(page.getByRole('heading', { name: '등+삼두 45분', exact: true })).toBeVisible();
  await checkScreen(page, '03-workout');
  const big = page.getByRole('button', { name: '현재 세트 완료' });
  // 아이폰처럼 입력칸 포커스를 빼지 않고 바로 완료 (blur 없이 click 이벤트만)
  await page.getByLabel('원암 랫풀다운 1세트 무게', { exact: true }).click();
  await page.getByLabel('원암 랫풀다운 1세트 무게', { exact: true }).pressSequentially('40');
  taps++; await big.dispatchEvent('click');
  await expect(page.getByLabel('원암 랫풀다운 1세트 무게', { exact: true })).toHaveValue('40');
  await expect(page.getByRole('timer')).toContainText('다음 운동으로 바로 (묶음)'); // 슈퍼세트 전환
  await expect(page.getByLabel('원암 랫풀다운 2세트 무게', { exact: true })).toHaveValue('40'); // 앞 세트 무게 이어받기
  await tap(big);
  await expect(page.getByRole('timer')).toContainText('라운드 후 휴식');
  const before = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  await page.getByRole('button', { name: '15초 늘리기' }).click();
  await expect.poll(async () => Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0])).toBeGreaterThanOrEqual(before + 13);
  await checkScreen(page, '04-timer');
  await tap(big);
  await expect(page.getByText(/3\/\d+세트/)).toBeVisible();
  // 입력 중 새로고침해도 값 유지 (늦춘 저장 후)
  await page.getByLabel('원암 랫풀다운 2세트 횟수', { exact: true }).fill('9');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByLabel('원암 랫풀다운 2세트 횟수', { exact: true })).toHaveValue('9');
  await expect(page.getByLabel(/휴식 남은 시간 \d+초/)).toBeVisible(); // 타이머도 유지
  await tap(page.getByRole('button', { name: '종료' }));
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect(page.getByText(/작업 세트 3개/)).toBeVisible();
  expect(taps, '루틴 시작 → 세트 3개 → 종료 (확인창 포함)').toBeLessThanOrEqual(12);
  await checkScreen(page, '05-home-after');

  // 다시 시작: 지난번 무게가 미리 채워짐 + 웜업 세트 순서
  await page.getByRole('button', { name: /등\+삼두 45분 시작/ }).click();
  await expect(page.getByLabel('원암 랫풀다운 1세트 무게', { exact: true })).toHaveValue('40');
  await expect(page.getByText(/지난번: 40kg/).first()).toBeVisible();
  await page.getByRole('button', { name: '+ 웜업' }).first().click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText('웜업 완료');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('timer')).toContainText('웜업 후 휴식');
});

test('운동 종목: 초성 검색, 장비·등급 필터, 상세의 영상 링크, 즐겨찾기', async ({ page }) => {
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByLabel('운동 검색').fill('ㄹㅍㄷ');
  await expect(page.getByRole('button', { name: '랫풀다운', exact: true })).toBeVisible();
  await checkScreen(page, '06-exercises');
  await page.getByLabel('운동 검색').fill('');
  await page.getByLabel('장비 필터').selectOption('smith');
  await page.getByLabel('등급 필터').selectOption('S');
  await expect(page.getByRole('button', { name: '스미스머신 JM프레스' })).toBeVisible();
  await expect(page.getByRole('button', { name: '원암 랫풀다운' })).toHaveCount(0);
  await page.getByRole('button', { name: '스미스머신 JM프레스' }).click();
  await expect(page.getByRole('heading', { name: '영상 등급' })).toBeVisible();
  await expect(page.getByRole('link', { name: /최고의 삼두근 운동/ }).first()).toHaveAttribute('href', /i40LqeORuxA&t=\d+s/);
  await page.getByRole('button', { name: '☆ 즐겨찾기' }).click();
  await expect(page.getByRole('button', { name: '★ 즐겨찾기' })).toBeVisible();
  await noHorizontalScroll(page); await touchTargets(page);
  await shot(page, '07-exercise-detail');
});

test('직접 추가한 운동을 플랜에서 교체로 쓰기, 설정의 기본 휴식', async ({ page }) => {
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByRole('button', { name: '+ 직접 추가' }).click();
  await page.getByLabel('운동 이름').fill('우리 헬스장 로우 머신');
  await page.getByLabel('부위').selectOption('등');
  await page.getByLabel('종류').selectOption('compound');
  await touchTargets(page);
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '등 선택 안 함' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  await page.getByRole('region', { name: '생성된 플랜' }).getByRole('button', { name: '교체' }).first().click();
  await page.getByLabel('운동 검색').last().fill('우리 헬스장');
  await page.getByRole('dialog').getByRole('button', { name: '우리 헬스장 로우 머신' }).click();
  await expect(page.getByRole('region', { name: '생성된 플랜' }).getByText('우리 헬스장 로우 머신', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '상급' }).click();
  await expect(page.getByRole('button', { name: '상급' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '운동 사이 늘리기' }).click();
  await expect(page.getByText('75초')).toBeVisible();
  await checkScreen(page, '08-settings');
});

test('루틴 직접 만들기·편집: 운동 추가, 목표 횟수, 슈퍼세트로 묶기, 저장', async ({ page }) => {
  await page.getByRole('button', { name: '+ 직접' }).click();
  await page.getByLabel('루틴 이름').fill('팔 루틴');
  for (const q of ['해머 컬', '로프 푸시다운']) {
    await page.getByRole('button', { name: '+ 운동 추가' }).click();
    await page.getByLabel('운동 검색').fill(q);
    await page.getByRole('dialog').getByRole('button').filter({ hasText: q }).first().click();
  }
  await page.getByRole('button', { name: '목표 횟수 늘리기' }).first().click();
  await expect(page.getByText('13회')).toBeVisible();
  await page.getByRole('button', { name: /다음 운동과 슈퍼세트로 묶기/ }).click();
  await expect(page.getByText('슈퍼세트', { exact: true })).toBeVisible();
  await expect(page.getByText('묶음 안 전환')).toBeVisible();
  await checkScreen(page, '09-routine-editor');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '팔 루틴' })).toBeVisible();
  await expect(page.getByText(/약 \d+분/).first()).toBeVisible();
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

void makeRoutine;
