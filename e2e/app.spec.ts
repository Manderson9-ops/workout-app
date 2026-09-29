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
  // 메모 시트 (한 손 입력, prompt 대신)
  await page.getByRole('button', { name: '운동 메모' }).click();
  await page.getByRole('dialog', { name: '오늘 운동 메모' }).getByRole('textbox').fill('컨디션 좋음');
  await touchTargets(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('📝 컨디션 좋음')).toBeVisible();
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

test('설정의 기본 휴식이 루틴·운동까지 이어짐, 입력 직후 −/+', async ({ page }) => {
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '운동 사이 늘리기' }).click(); // 60 → 75
  await page.getByRole('button', { name: '단관절 세트 간 줄이기' }).click(); // 90 → 75
  await page.getByRole('link', { name: '홈' }).click();
  await page.getByRole('button', { name: '+ 직접' }).click();
  for (const q of ['해머 컬', '케이블 크런치']) {
    await page.getByRole('button', { name: '+ 운동 추가' }).click();
    await page.getByLabel('운동 검색').fill(q);
    await page.getByRole('dialog').getByRole('button').filter({ hasText: q }).first().click();
  }
  await expect(page.getByText('75초').first()).toBeVisible(); // 새로 추가한 단관절 블록 = 설정값
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '세트 줄이기' }).first().click(); // 해머 컬 1세트
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page).toHaveURL(/#\/workout/);
  // 입력 직후(포커스 유지) + 버튼: 입력값 12.5에 2.5를 더해 15
  await page.getByLabel('해머 컬 1세트 무게', { exact: true }).click();
  await page.getByLabel('해머 컬 1세트 무게', { exact: true }).pressSequentially('12.5');
  await page.getByRole('button', { name: '해머 컬 1세트 무게 조절 늘리기' }).dispatchEvent('click');
  await expect(page.getByLabel('해머 컬 1세트 무게', { exact: true })).toHaveValue('15');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('timer')).toContainText('다음 운동으로 이동');
  const sec = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  expect(sec).toBeGreaterThanOrEqual(73); // 운동 사이 휴식 = 설정 75초
  expect(sec).toBeLessThanOrEqual(75);
});

test('P4 기록·도구·백업: 운동 후 달력·상세, 체중, 원판·1RM, 백업 저장 → 삭제 → 불러오기', async ({ page }) => {
  // 공유 시트 대신 다운로드 경로로 고정 (테스트 브라우저에는 공유 시트가 없음)
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  page.on('dialog', (d) => void d.accept());
  // 운동 하나 끝내기: 해머 컬 1세트 12.5kg × 12
  await page.getByRole('button', { name: '+ 직접' }).click();
  await page.getByLabel('루틴 이름').fill('팔 테스트');
  await page.getByRole('button', { name: '+ 운동 추가' }).click();
  await page.getByLabel('운동 검색').fill('해머 컬');
  await page.getByRole('dialog').getByRole('button').filter({ hasText: '해머 컬' }).first().click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '세트 줄이기' }).first().click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await page.getByLabel('해머 컬 1세트 무게', { exact: true }).fill('12.5');
  // 운동 중 원판 계산 시트
  await page.getByRole('button', { name: '해머 컬 1세트 원판 계산' }).click();
  await expect(page.getByRole('dialog', { name: '원판 계산기' })).toBeVisible();
  await touchTargets(page);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await page.getByRole('button', { name: '종료' }).click();
  await expect(page.getByText('최근 운동')).toBeVisible();

  // 기록 탭: 이번 주 1회, 오늘 달력 표시 → 상세
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('1회', { exact: true })).toBeVisible();
  const d = new Date();
  const todayBtn = page.getByRole('button', { name: `${d.getMonth() + 1}월 ${d.getDate()}일 운동 1회` });
  await expect(todayBtn).toBeEnabled();
  await todayBtn.click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /이번 주 부위별 작업 세트: .*이두 1세트/ })).toBeVisible();
  // 체중 기록
  await page.getByLabel('오늘 체중', { exact: true }).fill('72.5');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('img', { name: /체중: .*72\.5kg/ })).toBeVisible();
  await checkScreen(page, '10-stats');
  await page.getByRole('button', { name: /팔 테스트/ }).first().click();
  await expect(page.getByRole('heading', { name: '팔 테스트' })).toBeVisible();
  await expect(page.getByText(/12\.5kg × 12회/)).toBeVisible();
  await expect(page.getByRole('button', { name: '이 운동 다시 하기' })).toBeVisible();
  await checkScreen(page, '11-workout-detail');

  // 종목 상세: 내 기록 그래프
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByLabel('운동 검색').fill('해머 컬');
  await page.getByRole('button', { name: '해머 컬', exact: true }).click();
  await expect(page.getByRole('img', { name: /추정 1RM 추이/ })).toBeVisible();

  // 도구: 원판 100kg (20kg 바) → 25 + 15, 1RM 100×5 → 116.7
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '원판 계산기 · 1RM 계산기' }).click();
  await page.getByLabel('원판 계산 목표 무게', { exact: true }).fill('100');
  await expect(page.getByLabel('원판 계산 결과')).toContainText('한쪽에: 25 + 15');
  await page.getByLabel('1RM 계산 무게', { exact: true }).fill('100');
  await page.getByLabel('1RM 계산 횟수', { exact: true }).fill('5');
  await expect(page.getByLabel('1RM 계산 결과')).toContainText('추정 1RM 116.7kg');
  await checkScreen(page, '12-tools');

  // 백업 저장 → 기록 삭제 → 불러오기로 복구
  await page.getByRole('link', { name: '설정' }).click();
  await expect(page.getByText('마지막 백업: 없음')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^workout-backup-\d{8}-\d{4}\.json$/);
  const file = await dl.path();
  await expect(page.getByText('백업 파일을 저장했어요')).toBeVisible();
  await expect(page.getByText('마지막 백업: 없음')).toHaveCount(0);
  await checkScreen(page, '13-settings-backup');
  await page.getByRole('link', { name: '기록' }).click();
  await page.getByRole('button', { name: /팔 테스트/ }).first().click();
  await page.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByText('아직 끝낸 운동이 없어요')).toBeVisible();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByLabel('백업 파일 고르기').setInputFiles(file);
  await expect(page.getByText('백업을 불러왔어요')).toBeVisible();
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /체중: .*72\.5kg/ })).toBeVisible();
  // 다른 앱 파일은 거절, 기존 데이터 유지
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByLabel('백업 파일 고르기').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await expect(page.getByText('불러오지 못했어요: 이 앱의 백업 파일이 아니에요')).toBeVisible();
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
});

void makeRoutine;
