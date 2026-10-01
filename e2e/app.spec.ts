import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { mkdirSync, readFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSyncDir } from '../tools/sync_check';
import { emptyState, handleSync } from '../src/core/syncMerge';

mkdirSync('reports/screens', { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });

/** 위쪽 "종료" → 앱 안 확인 창 "끝내기" (D-038: 브라우저 기본 confirm 대신) */
async function endWorkout(p: Page) {
  await p.getByRole('button', { name: '종료' }).click();
  await p.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
}

/** 앱 안 확인 창(D-038·D-039)에서 버튼 하나 누름. 확인 창은 aria-modal 시트 */
async function answer(p: Page, button: string) {
  await p.locator('.sheet[aria-modal="true"]').getByRole('button', { name: button, exact: true }).click();
}

/** 브라우저 기본 확인·알림 창은 하나도 뜨면 안 됨 (D-039). 뜨면 취소로 답하고 시험 끝에 실패 */
const nativeDialogs: string[] = [];
function noNativeDialog(p: Page) { p.on('dialog', (d) => { nativeDialogs.push(`${d.type()}: ${d.message()}`); void d.dismiss().catch(() => undefined); }); }
test.afterEach(() => { expect(nativeDialogs, '브라우저 기본 확인·알림 창 (D-039)').toEqual([]); });

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
  nativeDialogs.length = 0;
  noNativeDialog(page);
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 기기에만 저장돼요')).toBeVisible(); // 첫 실행 안내
  await page.getByRole('button', { name: '알겠어요' }).click();
});

test('핵심 흐름: 플랜 → 루틴 저장 → 홈에서 시작 → 세트 3개 → 종료 (탭 수 12 이하)', async ({ page }) => {
  let taps = 0;
  const tap = async (l: Locator) => { taps++; await l.click(); };

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
  await tap(page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' })); // 앱 안 확인 창 (D-038)
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

test('운동 끝내기 (D-038): 앱 안 확인 창(기본 확인 창 0번), 취소하면 계속, 끝내지 못하면 이유 표시·진단 기록, 새로 시작 확인', async ({ page }) => {
  // 기본 확인 창이 뜨면 취소로 답함 = 예전에 조용히 안 끝났던 상황. 이 시험에서는 한 번도 뜨면 안 됨
  let native = 0;
  page.on('dialog', (d) => { native++; void d.dismiss(); });
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '이두 선택 안 함' }).click();
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  const doneBtn = page.getByRole('button', { name: '현재 세트 완료' });
  await expect(doneBtn).toBeVisible();

  // 1) 아래 "운동 끝내기" → 앱 안 확인 창 (남은 세트 수) → 취소하면 운동 그대로
  await page.getByRole('button', { name: '운동 끝내기' }).click();
  const dlg = page.getByRole('dialog', { name: '운동을 끝낼까요?' });
  await expect(dlg).toContainText(/아직 \d+세트 남았어요/);
  await expect(dlg.getByRole('button', { name: '취소' })).toBeFocused(); // 위험한 확인은 취소에 초점 (Enter 한 번으로 끝나지 않게)
  await expect(dlg).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Tab');
  await expect(dlg.getByRole('button', { name: '끝내기' })).toBeFocused();
  await page.keyboard.press('Tab'); // 창 안에서만 돎 (✕ → 취소 → 끝내기)
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused();
  await touchTargets(page);
  await dlg.getByRole('button', { name: '취소' }).click();
  await expect(dlg).toBeHidden();
  await expect(doneBtn).toBeVisible();
  // Esc도 취소
  await page.getByRole('button', { name: '종료' }).click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(doneBtn).toBeVisible();

  // 2) 끝낼 수 없는 상태(다른 기기로 넘어감)를 저장소에만 만들고 끝내기 → 조용히 넘어가지 않고 이유가 보임
  const setOwner = (owner: string | null) => page.evaluate(async (o) => new Promise<void>((res, rej) => {
    const q = indexedDB.open('workout-app');
    q.onsuccess = () => {
      const db = q.result; const tx = db.transaction('workouts', 'readwrite'); const st = tx.objectStore('workouts');
      const g = st.getAll();
      g.onsuccess = () => { for (const w of g.result) if (!w.endedAt) { if (o) w.ownerDeviceId = o; else delete w.ownerDeviceId; st.put(w); } };
      tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
    };
  }), owner);
  await setOwner('zzzzzz');
  await endWorkout(page);
  await expect(page.getByRole('alert')).toContainText('다른 기기로 넘어가서 여기서 끝낼 수 없어요');
  await page.getByRole('button', { name: '알림 닫기' }).click(); // 닫을 수 있음 (검토 N5)
  await expect(page.getByRole('alert')).toHaveCount(0);
  // 진단 기록(오류)에 남음 (2초 모았다 저장)
  await expect.poll(() => page.evaluate(async () => new Promise<string[]>((res) => {
    const q = indexedDB.open('workout-app');
    q.onsuccess = () => { const db = q.result; const g = db.transaction('diag').objectStore('diag').getAll(); g.onsuccess = () => { res(g.result.filter((e) => e.k === 'error').map((e) => e.m)); db.close(); }; };
  })), { timeout: 6000 }).toContain('운동 끝내기 안 됨: other-device');

  // 3) 되돌리면 다시 끝낼 수 있음. 진행 중에 다른 루틴 시작 → 앱 안 확인 창 (취소 = 운동 화면으로, 확인 = 앞 운동 끝내고 새로)
  await setOwner(null);
  await page.reload();
  await page.getByRole('link', { name: '홈' }).click();
  const startBtn = page.getByRole('button', { name: / 시작$/ }).first();
  await startBtn.click();
  const ask = page.getByRole('dialog', { name: '진행 중인 운동이 있어요' });
  await expect(ask).toContainText('끝내고 새로 시작할까요?');
  await ask.getByRole('button', { name: '취소' }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  await expect(doneBtn).toBeVisible();
  await page.getByRole('link', { name: '홈' }).click();
  await startBtn.click();
  await ask.getByRole('button', { name: '끝내고 새로 시작' }).click();
  await expect(doneBtn).toBeVisible();
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('group', { name: /^최근 운동 / })).toHaveCount(1); // 앞 운동은 끝난 기록으로

  // 4) 정상 끝내기 (끝내기 두 번 빠르게 눌러도 한 번) → 홈, 최근 운동 2개, 기본 확인 창은 한 번도 안 뜨었음
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await page.getByRole('button', { name: '종료' }).click();
  await dlg.getByRole('button', { name: '끝내기' }).dblclick();
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect(page.getByRole('group', { name: /^최근 운동 / })).toHaveCount(2);
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await expect(page.getByText('진행 중인 운동이 없어요.')).toBeVisible();
  expect(native, '브라우저 기본 확인 창이 뜨지 않음').toBe(0);
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
  await expect(page.getByRole('button', { name: '해머 컬 1세트 원판 계산' })).toHaveCount(0); // 덤벨 운동엔 원판 버튼 없음
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('timer')).toContainText('다음 운동으로 이동');
  const sec = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  expect(sec).toBeGreaterThanOrEqual(73); // 운동 사이 휴식 = 설정 75초
  expect(sec).toBeLessThanOrEqual(75);
});

test('P4 기록·도구·백업: 운동 후 달력·상세·추이, 체중, 원판·1RM, 백업 → 초기화 → 복원 100% 일치', async ({ page }) => {
  // 공유 시트 대신 다운로드 경로로 고정 (테스트 브라우저에는 공유 시트가 없음)
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  // 운동 하나 끝내기: 바벨 컬 1세트 30kg × 10 (기본 목표 횟수)
  await page.getByRole('button', { name: '+ 직접' }).click();
  await page.getByLabel('루틴 이름').fill('팔 테스트');
  await page.getByRole('button', { name: '+ 운동 추가' }).click();
  await page.getByLabel('운동 검색').fill('바벨 컬');
  await page.getByRole('dialog').getByRole('button').filter({ hasText: '바벨 컬' }).first().click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '세트 줄이기' }).first().click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await page.getByLabel('바벨 컬 1세트 무게', { exact: true }).fill('30');
  // 운동 중 원판 계산 시트 (바벨·스미스 운동에만 버튼)
  await page.getByRole('button', { name: '바벨 컬 1세트 원판 계산' }).click();
  await expect(page.getByRole('dialog', { name: '원판 계산기' })).toBeVisible();
  await expect(page.getByLabel('원판 계산 결과')).toContainText('한쪽에: 5');
  await touchTargets(page);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page.getByText('최근 운동')).toBeVisible();
  // 홈 백업 알림 (백업한 적 없음)
  await expect(page.getByRole('note', { name: '백업 알림' })).toContainText('아직 백업한 적이 없어요');

  // 기록 탭: 이번 주 1회, 오늘 달력 표시 → 상세
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('1회', { exact: true })).toBeVisible();
  const d = new Date();
  const todayBtn = page.getByRole('button', { name: `${d.getMonth() + 1}월 ${d.getDate()}일 운동 1회` });
  await expect(todayBtn).toBeEnabled();
  await todayBtn.click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /이번 주 부위별 작업 세트: .*이두 1세트/ })).toBeVisible();
  await expect(page.getByRole('table', { name: '최근 4주 부위별 작업 세트' })).toContainText('이두');
  await expect(page.getByRole('img', { name: /최근 8주 주간 볼륨: .*300kg/ })).toBeVisible();
  // 체중: 범위 밖은 거절, 정상 값 기록
  await page.getByLabel('체중', { exact: true }).fill('700');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('20~300kg');
  await page.getByLabel('체중', { exact: true }).fill('72.5');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('img', { name: /체중: .*72\.5kg/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '고치기' })).toBeVisible();
  await checkScreen(page, '10-stats');
  await page.getByRole('button', { name: /팔 테스트/ }).first().click();
  await expect(page.getByRole('heading', { name: '팔 테스트' })).toBeVisible();
  await expect(page.getByText(/30kg × 10회/)).toBeVisible();
  await expect(page.getByRole('button', { name: '이 운동 다시 하기' })).toBeVisible();
  await checkScreen(page, '11-workout-detail');

  // 종목 상세: 내 기록 그래프
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByLabel('운동 검색').fill('바벨 컬');
  await page.getByRole('button', { name: '바벨 컬', exact: true }).click();
  await expect(page.getByRole('img', { name: /추정 1RM 추이/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /볼륨 추이: .*300kg/ })).toBeVisible();
  await checkScreen(page, '14-exercise-history');

  // 도구: 원판 100kg (20kg 바) → 25 + 15, 원판 [15,10]만 → 60kg = 10 + 10, 1RM 100×5 → 116.7
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '원판 계산기 · 1RM 계산기' }).click();
  await page.getByLabel('원판 계산 목표 무게', { exact: true }).fill('100');
  await expect(page.getByLabel('원판 계산 결과')).toContainText('한쪽에: 25 + 15');
  await page.getByLabel('1RM 계산 무게', { exact: true }).fill('100');
  await page.getByLabel('1RM 계산 횟수', { exact: true }).fill('5');
  await expect(page.getByLabel('1RM 계산 결과')).toContainText('추정 1RM 116.7kg');
  await checkScreen(page, '12-tools');
  await page.getByLabel('1RM 계산 횟수', { exact: true }).fill('20');
  await expect(page.getByLabel('1RM 계산 결과')).toContainText('12회보다 많으면');
  for (const p of ['25', '20', '5', '2.5', '1.25']) await page.getByRole('button', { name: p, exact: true }).click();
  await page.getByLabel('원판 계산 목표 무게', { exact: true }).fill('60');
  await expect(page.getByLabel('원판 계산 결과')).toContainText('한쪽에: 10 + 10');
  for (const p of ['25', '20', '5', '2.5', '1.25']) await page.getByRole('button', { name: p, exact: true }).click(); // 되돌림 (localStorage)

  // 백업 저장 → 모든 데이터 지우기 → 불러오기 → 다시 백업: 내용 100% 일치 (7.1)
  await page.getByRole('link', { name: '설정' }).click();
  await expect(page.getByText('마지막 백업: 없음')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^workout-backup-\d{8}-\d{4}\.json$/);
  const file = await dl.path();
  await expect(page.getByText(/백업 파일을 내려받았어요/)).toBeVisible();
  await expect(page.getByText('마지막 백업: 없음')).toHaveCount(0);
  await checkScreen(page, '13-settings-backup');
  await page.getByText('모든 데이터 지우기 (초기화)').click();
  await page.getByRole('button', { name: '모든 데이터 지우기', exact: true }).click();
  await answer(page, '지우기');
  await answer(page, '계속 지우기');
  await expect(page.getByText('모든 데이터를 지웠어요')).toBeVisible();
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('아직 끝낸 운동이 없어요')).toBeVisible();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByLabel('백업 파일 고르기').setInputFiles(file);
  await answer(page, '바꾸기');
  await expect(page.getByText('백업을 불러왔어요')).toBeVisible();
  await expect(page.getByText('마지막 백업: 없음')).toHaveCount(0); // 복원해도 백업 시각 유지
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  const strip = (t: string) => { const j = JSON.parse(t); for (const s of j.data.settings) delete s.lastBackupAt; return j.data; };
  expect(strip(readFileSync(await dl2.path(), 'utf8'))).toEqual(strip(readFileSync(file, 'utf8')));
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /체중: .*72\.5kg/ })).toBeVisible();
  // 다른 앱 파일·깨진 파일은 거절, 기존 데이터 유지
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByLabel('백업 파일 고르기').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await expect(page.getByText(/불러오지 못했어요: 이 앱의 백업 파일이 아니에요/)).toBeVisible();
  const broken = JSON.parse(readFileSync(file, 'utf8')); broken.data.workouts[0].blocks = [{}]; delete broken.counts;
  await page.getByLabel('백업 파일 고르기').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
  await expect(page.getByText(/불러오지 못했어요: 운동 기록 중 형식이 맞지 않는/)).toBeVisible();
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
});
test('P5a 진단 → PC로 보내기 → sync:check 왕복, 비밀 값 없음, 끄기', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  // 비밀 값 흉내: 자동 보내기 키는 localStorage에만. 어떤 파일에도 나가면 안 됨 (D-025)
  await page.evaluate(() => localStorage.setItem('send.cfg', 'https://script.google.com/macros/s/AKfycbzTESTaaaaaaaaaaaaaaaaaaaa/exec#SECRETKEY1234567890ABCDEFGH'));
  await makeRoutine(page, ['등'], '30분'); // 플랜 생성 → 진단 'plan'
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await page.getByRole('link', { name: '설정' }).click();
  const box = page.getByLabel('진단 요약');
  await expect(box).toContainText('11 플랜 속도');
  await expect(box).toContainText('오류 없음');
  await checkScreen(page, '15-settings-diag');
  await page.getByText('최근 기록 50건 보기').click();
  await expect(page.getByText(/앱 시작 · .*브라우저 탭/).first()).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PC로 보내기 (파일)' }).click()]);
  await expect(page.getByText(/PC로 보낼 파일을 내려받았어요/)).toBeVisible();
  const text = readFileSync(await dl.path(), 'utf8');
  expect(text).not.toContain('SECRETKEY1234567890ABCDEFGH');
  const j = JSON.parse(text);
  expect(j.schema).toBe(3);
  expect(j.device.label).toMatch(/Safari|Chrome/);
  expect(j.data.diag.map((x: { k: string }) => x.k)).toEqual(expect.arrayContaining(['start', 'plan']));
  // PC 쪽 검사 도구로 왕복
  const dir = mkdtempSync(join(tmpdir(), 'e2e-sync-'));
  checkSyncDir(dir);
  copyFileSync(await dl.path(), join(dir, 'inbox', dl.suggestedFilename()));
  const { results } = checkSyncDir(dir, { settleMs: 0 });
  expect(results).toEqual([{ file: dl.suggestedFilename(), ok: true, savedAs: dl.suggestedFilename() }]);
  expect(readFileSync(join(dir, 'checked', dl.suggestedFilename().replace('.json', '.summary.md')), 'utf8')).toContain('11 플랜 속도');
  // 끄면 더 이상 쌓이지 않음
  await page.getByLabel('진단 기록 남기기').uncheck();
  expect(await page.evaluate(() => localStorage.getItem('diag.off'))).toBe('1');
});

test.describe('서비스 워커 없이 (Playwright WebKit은 서비스 워커가 있으면 다른 주소 요청을 가짜 서버로 못 돌림)', () => {
test.use({ serviceWorkers: 'block' });
test('P5a 자동 보내기(T2): 연결 확인 → 운동 끝나면 보냄 ✓, 실패하면 다음에 열 때 다시, 키는 어디에도 안 보임', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  const KEY = 'K'.repeat(36) + 'Z9x8';
  const URL_ = 'https://script.google.com/macros/s/AKfycbzTEST' + 'a'.repeat(30) + '/exec';
  const got: { key: string; ping?: boolean; file?: { app: string; schema: number; data: { workouts: unknown[]; diag: { k: string }[] } } }[] = [];
  let fail = false, hang = false, badKey = false;
  let gate: Promise<void> | null = null;
  const ctypes: string[] = [];
  await page.route(URL_, async (route) => {
    if (fail) return route.abort('internetdisconnected');
    if (hang) return; // 응답 없이 멈춤 (보내는 도중 앱이 닫히는 상황)
    let body: typeof got[number];
    try { body = JSON.parse(route.request().postData() ?? '{}'); } catch (e) { console.log('PARSE', String(e)); body = { key: '' }; }
    got.push(body);
    ctypes.push(route.request().headers()['content-type'] ?? '');
    if (gate) await gate; // 응답을 늦춤 (보내는 중에 또 보내기)
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body.key === KEY && !badKey ? (body.ping ? { ok: true, ping: true } : { ok: true, name: 'auto-x.json' }) : { ok: false, error: 'bad_key' }) });
  });
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByLabel('자동 보내기 설정 붙여넣기').fill(`https://evil.example.com/x/exec#${KEY}`);
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('구글 Apps Script 주소(/exec)가 아니에요')).toBeVisible();
  await page.getByLabel('자동 보내기 설정 붙여넣기').fill(`workout-app 자동 보내기 설정\n${URL_}#${KEY}`);
  await page.getByRole('button', { name: '저장하고 연결 확인' }).click();
  await expect(page.getByText('연결됐어요. 이제 설정.txt를 지워 주세요')).toBeVisible();
  await expect(page.getByLabel('자동 보내기')).toContainText('키 ••••Z9x8');
  await checkScreen(page, '16-settings-autosend');
  expect(got[0]).toEqual({ key: KEY, ping: true });
  expect(ctypes.every((t) => t.toLowerCase().startsWith('text/plain'))).toBe(true);
  // 운동 끝 → 자동으로 보냄
  await makeRoutine(page, ['이두'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page.getByLabel('PC로 보내기 상태')).toContainText('PC로 보냄 ✓');
  const sent = got[got.length - 1]!;
  expect(sent.file!.app).toBe('workout-app');
  expect(sent.file!.schema).toBe(3);
  expect(sent.file!.data.workouts).toHaveLength(1);
  expect(sent.file!.data.diag.map((x) => x.k)).toContain('send');
  // 키는 보낸 파일 안에도, 화면에도, 백업 파일에도 없음 (D-025)
  expect(JSON.stringify(sent.file)).not.toContain(KEY);
  expect(await page.content()).not.toContain(KEY);
  await page.getByRole('link', { name: '설정' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  expect(readFileSync(await dl.path(), 'utf8')).not.toContain(KEY);
  // 실패 → 안내, 다음에 앱을 열 때 다시 보냄
  fail = true;
  const n = got.length;
  await page.getByRole('button', { name: '지금 보내기' }).click();
  await expect(page.getByText('보내지 못했어요')).toBeVisible();
  await expect(page.getByLabel('자동 보내기')).toContainText('보낼 것 있음');
  fail = false;
  await page.reload();
  await expect.poll(() => got.length).toBe(n + 1);
  await page.getByRole('link', { name: '설정' }).click();
  await expect(page.getByLabel('자동 보내기')).not.toContainText('보낼 것 있음');
  // 보내는 도중 앱이 닫혀도(새로고침) 다음에 열 때 다시 보냄 (검토 1차 막는 문제 1)
  hang = true;
  await page.getByRole('button', { name: '지금 보내기' }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => localStorage.getItem('send.pending'))).toBe('1');
  hang = false;
  const n2 = got.length;
  await page.reload();
  await expect.poll(() => got.length).toBe(n2 + 1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('send.pending'))).toBeNull();
  // 인터넷이 끊겼다가 다시 연결되면 자동으로 다시 보냄 (막는 문제 2)
  await page.getByRole('link', { name: '설정' }).click();
  await page.context().setOffline(true); fail = true; // Chromium은 가짜 서버가 오프라인에도 응답하므로 함께 끊음
  await page.getByRole('button', { name: '지금 보내기' }).click();
  await expect(page.getByText(/보내지 못했어요: 인터넷에 연결되지 않았어요/)).toBeVisible();
  const n3 = got.length;
  fail = false; await page.context().setOffline(false);
  await expect.poll(() => got.length).toBe(n3 + 1);
  // 보내는 중에 운동을 끝내면, 지금 보내기가 끝난 뒤 한 번 더 보냄 (검토 2차 막는 문제)
  let release!: () => void;
  gate = new Promise<void>((r) => { release = r; });
  const n4 = got.length;
  await page.getByRole('button', { name: '지금 보내기' }).click();
  await expect.poll(() => got.length).toBe(n4 + 1); // 첫 요청 도착 (응답은 멈춤)
  await page.getByRole('link', { name: '홈' }).click();
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  gate = null; release();
  await expect.poll(() => got.length).toBe(n4 + 2);
  expect(got[got.length - 1]!.file!.data.workouts).toHaveLength(2); // 방금 끝낸 운동까지 들어감
  await expect.poll(() => page.evaluate(() => localStorage.getItem('send.pending'))).toBeNull();
  // 다시 해도 안 되는 오류(키 틀림)는 자동 재시도를 멈춤 (데이터 낭비 방지)
  await page.getByRole('link', { name: '설정' }).click();
  badKey = true;
  await page.getByRole('button', { name: '지금 보내기' }).click();
  await expect(page.getByText(/보내지 못했어요: 키가 맞지 않아요/)).toBeVisible();
  await expect(page.getByLabel('자동 보내기')).toContainText('자동 재시도 멈춤');
  const n5 = got.length;
  await page.reload();
  await page.waitForTimeout(1500);
  expect(got.length).toBe(n5);
  badKey = false;
  // 끄기
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '끄기' }).click();
  await answer(page, '끄기');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('send.cfg'))).toBeNull();
});
});

test('S2a 실제 브라우저에서 예전 저장소(v3) → v4 옮김: 기록 그대로, 지우기는 지움 표시', async ({ page }) => {
  // 앱이 연 저장소를 닫고 지운 뒤, 0.3.0(v3)과 같은 구조로 직접 만들어 기록을 넣음
  await page.evaluate(async () => {
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('workout-app'); r.onsuccess = () => res(); r.onerror = () => res(); r.onblocked = () => res(); });
    await new Promise<void>((res, rej) => {
      const o = indexedDB.open('workout-app', 30);
      o.onupgradeneeded = () => {
        const db = o.result;
        db.createObjectStore('routines', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        const w = db.createObjectStore('workouts', { keyPath: 'id' }); w.createIndex('startedAt', 'startedAt'); w.createIndex('endedAt', 'endedAt');
        db.createObjectStore('meta', { keyPath: 'exerciseId' });
        db.createObjectStore('custom', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('bodyweight', { keyPath: 'date' });
        db.createObjectStore('diag', { keyPath: 'id', autoIncrement: true }).createIndex('t', 't');
      };
      o.onsuccess = () => {
        const db = o.result; const tx = db.transaction(['routines', 'settings', 'bodyweight'], 'readwrite');
        tx.objectStore('routines').put({ id: 'r-old', name: '예전 루틴', createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'hammer_curl', sets: 3, reps: 10 }] }] });
        tx.objectStore('settings').put({ key: 'main', level: '상급', storageNoticeSeen: true });
        tx.objectStore('bodyweight').put({ date: '2026-09-29', kg: 71 });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
      o.onerror = () => rej(o.error);
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '예전 루틴' })).toBeVisible();
  await page.getByRole('link', { name: '설정' }).click();
  await expect(page.getByRole('button', { name: '상급' })).toHaveAttribute('aria-pressed', 'true');
  const info = await page.evaluate(async () => new Promise<{ ver: number; stamped: boolean }>((res) => {
    const o = indexedDB.open('workout-app');
    o.onsuccess = () => { const db = o.result; const g = db.transaction('routines').objectStore('routines').get('r-old'); g.onsuccess = () => { res({ ver: db.version, stamped: !!g.result?._s && g.result._s.y === 1 }); db.close(); }; };
  }));
  expect(info).toEqual({ ver: 50, stamped: true });
  // 지우면 기록은 없어지고 지움 표시가 남음
  await page.getByRole('link', { name: '홈' }).click();
  await page.getByRole('button', { name: '예전 루틴 삭제' }).click();
  await answer(page, '지우기');
  await expect(page.getByRole('heading', { name: '예전 루틴' })).toHaveCount(0);
  const tomb = await page.evaluate(async () => new Promise<boolean>((res) => {
    const o = indexedDB.open('workout-app');
    o.onsuccess = () => { const db = o.result; const g = db.transaction('tombs').objectStore('tombs').get('routines/r-old'); g.onsuccess = () => { res(!!g.result); db.close(); }; };
  }));
  expect(tomb).toBe(true);
});

test.describe('S2b 양방향 동기화 (두 브라우저 + 가짜 서버, 실제 합치기 코드)', () => {
test.use({ serviceWorkers: 'block' });
test('PC에서 만든 루틴 → 폰, 폰 운동 진행 중 → PC 읽기 전용, 끝낸 운동 → PC 기록, 지움 전파', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const URL_ = 'https://script.google.com/macros/s/AKfycbzSYNCTEST' + 'b'.repeat(30) + '/exec';
  const KEY = 'S'.repeat(36) + 'Q1w2';
  const state = emptyState();
  let down = false;
  const route = async (p: Page) => p.route(URL_, async (r) => {
    if (down) return r.abort('internetdisconnected');
    const body = JSON.parse(r.request().postData() ?? '{}');
    let res: unknown = { ok: false, error: 'bad_key' };
    if (body.key === KEY) res = body.op === 'sync' ? handleSync(state, JSON.parse(JSON.stringify(body)), Date.now()) : body.ping ? { ok: true, ping: true } : { ok: true };
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res) });
  });
  const connect = async (p: Page) => {
    await p.evaluate(([u, k]) => localStorage.setItem('send.cfg', `${u}#${k}`), [URL_, KEY]);
    await p.reload();
    await p.getByRole('link', { name: '설정' }).click();
    await p.getByRole('button', { name: '동기화 연결하기' }).click();
    await p.getByRole('button', { name: '이미 저장했어요' }).click();
    await p.getByRole('button', { name: '연결 시작' }).click();
    await expect(p.getByLabel('PC와 폰 동기화')).toContainText('동기화됨');
  };
  const syncNowOn = async (p: Page) => { await p.getByRole('link', { name: '설정' }).click(); await p.getByRole('button', { name: '지금 동기화' }).click(); await expect(p.getByLabel('PC와 폰 동기화')).toContainText('동기화됨'); };
  // 폰 = 기본 page (아이폰 크기), PC = 새 창 (넓은 화면)
  const pcCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pc = await pcCtx.newPage();
  noNativeDialog(pc);
  await route(page); await route(pc);
  await pc.goto('./#/');
  await pc.getByRole('button', { name: '알겠어요' }).click();
  await connect(page);
  await connect(pc);
  // PC에서 루틴 만들기
  await pc.getByRole('link', { name: '홈' }).click();
  await pc.getByRole('button', { name: '+ 직접' }).click();
  await pc.getByLabel('루틴 이름').fill('PC에서 짠 루틴');
  await pc.getByRole('button', { name: '+ 운동 추가' }).click();
  await pc.getByLabel('운동 검색').fill('해머 컬');
  await pc.getByRole('dialog').getByRole('button').filter({ hasText: '해머 컬' }).first().click();
  await pc.getByRole('button', { name: '저장', exact: true }).click();
  await syncNowOn(pc);
  await syncNowOn(page);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('heading', { name: 'PC에서 짠 루틴' })).toBeVisible();
  // 폰에서 시작 → 세트 완료 → PC에서는 "다른 기기에서 진행 중"
  await page.getByRole('button', { name: /PC에서 짠 루틴 시작/ }).click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await syncNowOn(page);
  await syncNowOn(pc);
  await pc.getByRole('link', { name: '홈' }).click();
  await expect(pc.getByLabel('다른 기기에서 진행 중')).toContainText('PC에서 짠 루틴');
  await expect(pc.getByRole('link', { name: '운동 계속하기' })).toHaveCount(0);
  await checkScreen(pc, '17-pc-remote-workout');
  // PC가 가져오기 → PC가 주인, 폰은 "다른 기기로 넘어갔어요" (세트는 그대로)
  await pc.getByRole('button', { name: '이 기기로 가져오기' }).click();
  await answer(pc, '가져오기');
  await answer(pc, '가져오기');
  await expect(pc).toHaveURL(/#\/workout/);
  await expect(pc.getByText(/1\/\d+세트/)).toBeVisible();
  await syncNowOn(pc); await syncNowOn(page);
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await expect(page.getByText(/다른 기기로 넘어갔어요/)).toBeVisible();
  // PC에서 끝냄 → 폰 기록
  await pc.getByRole('link', { name: '운동', exact: true }).click();
  await endWorkout(pc);
  await syncNowOn(pc); await syncNowOn(page);
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByRole('button', { name: /PC에서 짠 루틴/ }).first()).toBeVisible();
  await pc.getByRole('link', { name: '기록' }).click();
  await expect(pc.getByRole('button', { name: /PC에서 짠 루틴/ }).first()).toBeVisible();
  await pc.getByRole('link', { name: '홈' }).click();
  await expect(pc.getByLabel('다른 기기에서 진행 중')).toHaveCount(0);
  // 폰이 인터넷 없이 루틴 이름을 고침 → 동기화 실패 표시 → 다시 연결되면 PC에 반영
  down = true;
  await page.getByRole('link', { name: '홈' }).click();
  await page.getByRole('button', { name: '편집' }).first().click();
  await page.getByLabel('루틴 이름').fill('PC에서 짠 루틴');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '지금 동기화' }).click();
  await expect(page.getByLabel('PC와 폰 동기화')).toContainText('인터넷에 연결되지 않았어요');
  down = false;
  await syncNowOn(page); await syncNowOn(pc);
  // PC에서 루틴 지움 → 폰에서도 사라짐
  await pc.getByRole('link', { name: '홈' }).click();
  await pc.getByRole('button', { name: 'PC에서 짠 루틴 삭제', exact: true }).click();
  await answer(pc, '지우기');
  await syncNowOn(pc); await syncNowOn(page);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('heading', { name: 'PC에서 짠 루틴' })).toHaveCount(0);
  await checkScreen(page, '18-phone-after-sync');
  await pcCtx.close();
});
});

test('S1 PC 넓은 화면: 왼쪽 메뉴, 플랜 2단, Enter·Ctrl+Enter, 폰 화면으로 보기', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pc = await ctx.newPage();
  noNativeDialog(pc);
  await pc.goto('./#/');
  await pc.getByRole('button', { name: '알겠어요' }).click();
  const nav = await pc.locator('nav.nav').boundingBox();
  expect(nav!.x).toBe(0);
  expect(nav!.width).toBeLessThan(200);
  expect(nav!.height).toBeGreaterThan(nav!.width);
  // 플랜: 왼쪽 조건, 오른쪽 결과
  await pc.getByRole('link', { name: '플랜' }).click();
  await pc.getByRole('button', { name: '등 선택 안 함' }).click();
  await pc.getByRole('button', { name: '45분' }).click();
  await pc.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const form = await pc.getByRole('button', { name: '플랜 만들기', exact: true }).boundingBox();
  const res = await pc.getByRole('region', { name: '생성된 플랜' }).boundingBox();
  expect(res!.x).toBeGreaterThan(form!.x + form!.width - 5);
  await checkScreen(pc, '19-pc-plan');
  // 저장하고 시작 → 무게 입력 후 Enter = 다음 칸(횟수), Ctrl+Enter = 현재 세트 완료
  await pc.getByRole('button', { name: '저장', exact: true }).click();
  await pc.getByRole('button', { name: '저장하고 시작' }).click();
  const w = pc.locator('input[aria-label$="1세트 무게"]').first();
  await w.click(); await w.fill('40'); await w.press('Enter');
  expect(await pc.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/1세트 횟수$/);
  await pc.keyboard.press('Control+Enter');
  await expect(pc.getByText('1/9세트')).toBeVisible();
  await expect(pc.getByRole('timer')).toBeVisible();
  // 아래 고정 바는 메뉴를 덮지 않고 바닥에 붙음
  const tb = await pc.locator('.timer').boundingBox();
  expect(tb!.x).toBeGreaterThanOrEqual(199);
  expect(Math.round(tb!.y + tb!.height)).toBe(900);
  // Ctrl+Enter를 누르고 있어도(반복) 세트가 연달아 끝나지 않음
  const doneBefore = await pc.locator('[aria-label$="완료됨"], .set.done').count();
  await pc.keyboard.down('Control'); await pc.keyboard.down('Enter');
  await pc.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, repeat: true })));
  await pc.keyboard.up('Enter'); await pc.keyboard.up('Control');
  expect(await pc.locator('[aria-label$="완료됨"], .set.done').count()).toBeLessThanOrEqual(doneBefore + 1);
  await expect(pc.getByText(/^[12]\/9세트$/)).toBeVisible();
  await checkScreen(pc, '20-pc-workout');
  // 폰 화면으로 보기
  await pc.getByRole('link', { name: '설정' }).click();
  await pc.getByLabel('폰 화면으로 보기').check();
  const main = await pc.locator('main').boundingBox();
  expect(main!.width).toBeLessThanOrEqual(430);
  const nav2 = await pc.locator('nav.nav').boundingBox();
  expect(nav2!.width).toBeLessThanOrEqual(430);
  // 운동 화면 고정 바도 폰 폭
  await pc.getByRole('link', { name: '운동', exact: true }).click();
  const tb2 = await pc.locator('.timer').boundingBox();
  expect(tb2!.width).toBeLessThanOrEqual(430);
  await pc.getByRole('link', { name: '설정' }).click();
  await pc.getByLabel('폰 화면으로 보기').uncheck();
  await ctx.close();
});


test('S3 개선 메모: 운동 중 어디서든 적기 → 화면·운동이 붙음 → 설정에서 상태 보기·지우기', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  await expect(page).toHaveURL(/#\/workout/);
  await page.getByRole('button', { name: '개선 메모 쓰기' }).click();
  await expect(page.getByText(/#\/workout/)).toBeVisible();
  await page.getByLabel('개선 메모 내용').fill('휴식 끝 소리가 작아요');
  await checkScreen(page, '21-feedback-sheet');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '설정' }).click();
  const card = page.getByLabel(/^개선 메모 FB-\d{8}-[a-z0-9]+-\d{8}$/i).filter({ hasText: '휴식 끝 소리가 작아요' });
  await expect(card).toContainText('휴식 끝 소리가 작아요');
  await expect(card).toContainText('접수');
  await expect(card).toContainText('#/workout');
  await checkScreen(page, '22-feedback-list');
  await card.getByRole('button', { name: /지우기/ }).click();
  await answer(page, '지우기');
  await expect(card).toHaveCount(0);
  // 저장 알림은 시트 밖에 보임, 새 메모도 목록에
  await page.getByRole('button', { name: '개선 메모 쓰기' }).click();
  await expect(page.getByLabel('개선 메모 내용')).toBeFocused();
  await page.getByLabel('개선 메모 내용').fill('두 번째');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /저장했어요 \(FB-\d{8}-[a-z0-9]+-\d{8}\)/i })).toBeVisible();
  await expect(page.getByLabel(/^개선 메모 FB-/).filter({ hasText: '두 번째' })).toHaveCount(1);
});


test('최근 운동 고치기·지우기 (D-035): 홈 카드 → 수정 → 무게·시간·세트 → 저장 → 상세·통계 반영, 홈에서 삭제', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  const w = page.locator('input[aria-label$="1세트 무게"]').first();
  await w.fill('40');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page).toHaveURL(/#\/$/);
  const card = page.locator('.card[aria-label^="최근 운동 "]').first();
  await expect(card).toContainText('작업 세트 1개');
  // 카드 누르면 상세
  await card.getByRole('link').click();
  await expect(page).toHaveURL(/#\/stats\/w\//);
  await page.getByRole('link', { name: '홈' }).click();
  // 수정
  await card.getByRole('button', { name: /수정$/ }).click();
  await expect(page.getByRole('heading', { name: '운동 기록 수정' })).toBeVisible();
  await page.getByLabel('운동 이름').fill('등 (고침)');
  await page.getByLabel('운동 시간(분)').fill('45');
  const first = page.locator('input[aria-label$=" 1세트 무게"]').first();
  await first.fill('42.5');
  await page.locator('input[aria-label$=" 2세트 완료"]').first().check();
  await page.locator('input[aria-label$=" 2세트 무게"]').first().fill('40');
  await page.locator('input[aria-label$=" 2세트 횟수"]').first().fill('8');
  await checkScreen(page, '23-workout-edit');
  // 잘못된 값은 저장 안 됨
  await page.locator('input[aria-label$=" 1세트 RIR"]').first().fill('15');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('RIR');
  await page.locator('input[aria-label$=" 1세트 RIR"]').first().fill('2');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '등 (고침)' })).toBeVisible();
  await expect(page.getByText(/에 고침$/)).toBeVisible();
  await expect(page.getByText(/42\.5kg × \d+회 · RIR 2/)).toBeVisible();
  await expect(page.getByText(/작업 세트 2/)).toBeVisible();
  await expect(page.getByText(/45:00/)).toBeVisible();
  // 홈 카드에도 반영, 그리고 삭제
  await page.getByRole('link', { name: '홈' }).click();
  const card2 = page.getByLabel('최근 운동 등 (고침)', { exact: true });
  await expect(card2).toContainText('작업 세트 2개 · 45분 · 고침');
  await card2.getByRole('button', { name: '최근 운동 등 (고침) 삭제' }).click();
  await answer(page, '지우기');
  await expect(card2).toHaveCount(0);
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('아직 끝낸 운동이 없어요')).toBeVisible();
});

test('수정 화면: 입력 중 세트를 지워도 값이 옆 세트로 가지 않음, 시작을 옮겨도 운동 시간 그대로, 편집 중 메뉴 숨김', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  const w = page.locator('input[aria-label$="1세트 무게"]').first();
  await w.fill('40'); await page.getByRole('button', { name: '현재 세트 완료' }).click();
  const w2 = page.locator('input[aria-label$="2세트 무게"]').first();
  await w2.fill('50'); await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await page.locator('.card[aria-label^="최근 운동 "]').first().getByRole('button', { name: /수정$/ }).click();
  await expect(page.locator('nav.nav')).toBeHidden();
  const before = await page.getByLabel('운동 시간(분)').inputValue();
  await page.getByLabel('시작 날짜와 시각').fill('2026-09-28T07:30');
  await expect(page.getByLabel('운동 시간(분)')).toHaveValue(before);
  // 1세트 무게에 입력하는 도중(포커스 유지) 1세트 지우기 → 남은 세트(원래 2세트)는 50 그대로
  const f1 = page.locator('input[aria-label$=" 1세트 무게"]').first();
  await f1.click(); await page.keyboard.type('9');
  await page.locator('button[aria-label$=" 1세트 지우기"]').first().evaluate((b: HTMLButtonElement) => b.click());
  await expect(page.locator('input[aria-label$=" 1세트 무게"]').first()).toHaveValue('50');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/#\/stats\/w\/[^/]+$/);
  await expect(page.getByText(/9월 28일/)).toBeVisible();
  await expect(page.getByText(/50kg × \d+회/).first()).toBeVisible();
  await expect(page.getByText(/409kg|409/)).toHaveCount(0);
  await expect(page.locator('nav.nav')).toBeVisible();
});

test('수정 화면: 취소하면 기록 그대로', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  const card = page.locator('.card[aria-label^="최근 운동 "]').first();
  const before = await card.textContent();
  await card.getByRole('button', { name: /수정$/ }).click();
  await page.getByLabel('운동 이름').fill('바뀌면 안 됨');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await answer(page, '버리기');
  await expect(page).toHaveURL(/#\/stats\/w\//);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.locator('.card[aria-label^="최근 운동 "]').first()).toHaveText(before!);
});

void makeRoutine;

test('앱 안 확인 창 (D-039): 삭제는 취소·Esc·닫기·화면 이동이면 그대로 / 동기화 중 초기화·불러오기 두 갈래: 닫으면 아무것도 안 바꿈, "이 기기만"은 동기화 끄고 진행', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  await makeRoutine(page, ['등'], '30분');
  const del = page.getByRole('button', { name: '등 30분 삭제', exact: true });
  const card = page.getByRole('heading', { name: '등 30분', exact: true });
  const sheet = page.locator('.sheet[aria-modal="true"]');
  const syncOn = () => page.evaluate(() => localStorage.getItem('sync.on'));

  // 1) 삭제 확인: 취소(위험한 확인은 취소에 초점, Enter 한 번으로 안 지워짐)·Esc·✕·화면 이동은 그대로
  await del.click();
  await expect(sheet.getByRole('heading', { name: '루틴을 지울까요?' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet).toHaveCount(0);
  await expect(card).toBeVisible();
  // 연 버튼으로 초점이 돌아옴 (WebKit은 버튼을 눌러도 초점을 주지 않아 Chromium에서만 봄)
  if (test.info().project.name.includes('chromium')) await expect(del).toBeFocused();
  await del.click(); await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(card).toBeVisible();
  await del.click();
  await checkScreen(page, '31-in-app-confirm-home');
  await sheet.getByRole('button', { name: '닫기' }).click();
  await expect(card).toBeVisible();
  // 창이 열린 채 뒤로 가기(스와이프) → 창이 닫히고 지우지 않음 (떠난 화면의 일을 나중에 하지 않게)
  await page.getByRole('link', { name: '기록' }).click();
  await page.getByRole('link', { name: '홈' }).click();
  await del.click(); await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/stats/);
  await expect(sheet).toHaveCount(0);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(card).toBeVisible();

  // 백업 파일 하나 만들어 둠
  await page.getByRole('link', { name: '설정' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  const file = await dl.path();
  const restoreWith = async () => { await page.getByLabel('백업 파일 고르기').setInputFiles(file); await answer(page, '바꾸기'); };

  // 2) 동기화 켜진 채 초기화: 세 갈래 선택에서 Esc → 지우지 않음 (예전 기본 창은 [취소]가 "동기화 끄고 비우기"였음)
  await page.evaluate(() => localStorage.setItem('sync.on', '1'));
  const resetTo = async (pick: string | null) => {
    await page.getByRole('link', { name: '설정' }).click();
    const summary = page.getByText('모든 데이터 지우기 (초기화)');
    if (!(await page.getByRole('button', { name: '모든 데이터 지우기', exact: true }).isVisible())) await summary.click();
    await page.getByRole('button', { name: '모든 데이터 지우기', exact: true }).click();
    await answer(page, '지우기');
    await answer(page, '계속 지우기');
    await expect(sheet.getByRole('heading', { name: '동기화가 켜져 있어요' })).toBeVisible();
    if (pick) await answer(page, pick); else await page.keyboard.press('Escape');
  };
  await resetTo(null);
  for (const b of ['비우고 서버에서 다시 받기', '비우고 동기화 끄기', '취소']) await expect(page.getByRole('button', { name: b, exact: true })).toHaveCount(0);
  expect(await syncOn()).toBe('1');
  await expect(page.getByText(/지웠어요|다시 받았어요/)).toHaveCount(0);

  // 3) 동기화 켜진 채 불러오기: 세 갈래 선택에서 Esc → 아무것도 안 바꿈 / "이 기기만" → 동기화 끄고 불러옴
  await page.getByLabel('백업 파일 고르기').setInputFiles(file);
  await answer(page, '바꾸기');
  await expect(sheet.getByRole('heading', { name: '동기화가 켜져 있어요' })).toBeVisible();
  for (const b of ['서버·다른 기기까지', '이 기기만 (동기화 끄기)', '취소']) await expect(sheet.getByRole('button', { name: b, exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await noHorizontalScroll(page);
  await checkScreen(page, '32-in-app-choice');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('백업을 불러왔어요')).toHaveCount(0);
  expect(await syncOn()).toBe('1');
  await restoreWith();
  await answer(page, '이 기기만 (동기화 끄기)');
  await expect(page.getByText('백업을 불러왔어요')).toBeVisible();
  expect(await syncOn()).toBe('0');

  // 4) 동기화 켜진 채 초기화 "비우고 동기화 끄기" → 비우고 동기화 꺼짐
  await page.evaluate(() => localStorage.setItem('sync.on', '1'));
  await resetTo('비우고 동기화 끄기');
  await expect(page.getByText('모든 데이터를 지웠어요')).toBeVisible();
  expect(await syncOn()).toBe('0');
  await page.getByRole('link', { name: '홈' }).click();
  await expect(card).toHaveCount(0);

  // 5) 동기화 꺼진 채 불러오기(확인 한 번) → 루틴이 돌아옴 → 삭제 확인에서 "지우기"만 지움
  await page.getByRole('link', { name: '설정' }).click();
  await restoreWith();
  await expect(page.getByText('백업을 불러왔어요')).toBeVisible();
  await page.getByRole('link', { name: '홈' }).click();
  await expect(card).toBeVisible();
  await del.click();
  await answer(page, '지우기');
  await expect(card).toHaveCount(0);
});

test('기록 고치기 저장 (D-039): 고치는 동안 다른 기기에서 바뀌면 묻고, 묻는 동안 또 바뀌면 다시 물음 / 지워졌으면 되살려 저장', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page).toHaveURL(/#\/$/);
  const card = page.locator('.card[aria-label^="최근 운동 "]').first();
  const id = decodeURIComponent((await card.getByRole('link').first().getAttribute('href'))!.split('/').pop()!);
  // 다른 기기 흉내: 앱을 거치지 않고 저장소의 기록을 직접 바꿈 (동기화로 들어온 것과 같은 결과)
  const remote = (memo: string | null) => page.evaluate(([wid, m]) => new Promise<void>((res, rej) => {
    const o = indexedDB.open('workout-app');
    o.onsuccess = () => {
      const tx = o.result.transaction('workouts', 'readwrite'); const st = tx.objectStore('workouts');
      if (m === null) st.delete(wid!); else { const g = st.get(wid!); g.onsuccess = () => st.put({ ...g.result, memo: m }); }
      tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = () => rej(tx.error);
    };
  }), [id, memo] as const);
  const stored = () => page.evaluate((wid) => new Promise<{ name: string; memo?: string } | undefined>((res) => {
    const o = indexedDB.open('workout-app');
    o.onsuccess = () => { const g = o.result.transaction('workouts').objectStore('workouts').get(wid); g.onsuccess = () => { res(g.result); o.result.close(); }; };
  }), id);
  const sheet = page.locator('.sheet[aria-modal="true"]');

  // 바뀜 → 묻는 동안 또 바뀜 → 덮어쓰기 → 다시 물음 → 덮어쓰기 → 저장
  await card.getByRole('button', { name: /수정$/ }).click();
  await page.getByLabel('운동 이름').fill('내 수정 1');
  await remote('다른 기기 A');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: '다른 기기에서 이 기록이 바뀌었어요' })).toBeVisible();
  await remote('다른 기기 B');
  await answer(page, '덮어쓰기');
  await expect(sheet.getByRole('heading', { name: '다른 기기에서 이 기록이 바뀌었어요' })).toBeVisible(); // 다시 물음
  expect((await stored())!.name).not.toBe('내 수정 1');
  await answer(page, '덮어쓰기');
  await expect(page).toHaveURL(/#\/stats\/w\//);
  expect((await stored())!.name).toBe('내 수정 1');

  // 계속 고치기 → 저장 안 됨, 편집 화면에 남음
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('운동 이름').fill('내 수정 2');
  await remote('다른 기기 C');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await answer(page, '계속 고치기');
  await expect(page).toHaveURL(/\/edit$/);
  expect((await stored())!.name).toBe('내 수정 1');

  // 지워짐 → 되살려 저장
  await remote(null);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: '다른 기기에서 이 기록이 지워졌어요' })).toBeVisible();
  await answer(page, '되살려 저장');
  await expect(page).toHaveURL(/#\/stats\/w\//);
  expect((await stored())!.name).toBe('내 수정 2');
});

test('플랜 바로 고치기 (D-036): 세트·횟수 따로 −/+, 순서 바꾸기, 운동 추가 → 저장하고 시작, 내 운동 DB 정보 버튼', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '이두 선택 안 함' }).click();
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const cards = planSec.locator('.card');
  expect(await cards.count()).toBeGreaterThan(1);
  const first = (await cards.nth(0).locator('strong').allTextContents())[0]!;
  const second = await cards.nth(1).locator('strong').allTextContents();

  // 횟수만 +1 (세트는 그대로), 세트만 −1 (횟수는 그대로)
  const setsBox = planSec.getByRole('group', { name: `${first} 세트` });
  const repsBox = planSec.getByRole('group', { name: `${first} 횟수` });
  const sets0 = Number((await setsBox.textContent())!.match(/(\d+)세트/)![1]);
  const reps0 = Number((await repsBox.textContent())!.match(/(\d+)회/)![1]);
  await planSec.getByRole('button', { name: `${first} 횟수 늘리기` }).click();
  await planSec.getByRole('button', { name: `${first} 횟수 늘리기` }).click();
  await expect(repsBox).toContainText(`${reps0 + 2}회`);
  await expect(setsBox).toContainText(`${sets0}세트`);
  await planSec.getByRole('button', { name: `${first} 세트 늘리기` }).click();
  await expect(setsBox).toContainText(`${sets0 + 1}세트`);
  await expect(repsBox).toContainText(`${reps0 + 2}회`);
  const est0 = await planSec.getByText(/예상 \d+:\d{2}/).textContent();
  await planSec.getByRole('button', { name: `${first} 횟수 줄이기` }).click();
  await expect(repsBox).toContainText(`${reps0 + 1}회`);
  expect(await planSec.getByText(/예상 \d+:\d{2}/).textContent(), '횟수를 바꾸면 예상 시간도 다시 계산').not.toBe(est0);

  // 순서: 1번째 블록을 아래로 → 2번째 블록이 맨 위
  const firstBlock = (await cards.nth(0).locator('strong').allTextContents()).join(' + ');
  await expect(planSec.getByRole('button', { name: `${firstBlock} 위로 (지금 1번째)` })).toBeDisabled();
  await planSec.getByRole('button', { name: `${firstBlock} 아래로 (지금 1번째)` }).click();
  // 누른 ↓가 아직 켜져 있으면 그대로, 끝에 닿아 꺼졌으면 같은 블록의 ↑로 초점
  await expect(planSec.getByRole('button', { name: `${firstBlock} ${(await cards.count()) > 2 ? '아래로' : '위로'} (지금 2번째)` })).toBeFocused();
  expect(await cards.nth(0).locator('strong').allTextContents()).toEqual(second);
  expect((await cards.nth(1).locator('strong').allTextContents())[0]).toBe(first);
  await expect(repsBox).toContainText(`${reps0 + 1}회`); // 옮겨도 값 유지

  // 운동 추가: 다른 부위(삼두)의 영상 등급 운동
  const n0 = await cards.count();
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  const dlg = page.getByRole('dialog', { name: '운동 추가' });
  await expect(dlg).toBeVisible();
  await touchTargets(page);
  await dlg.getByLabel('운동 검색').fill('JM');
  await dlg.getByRole('button', { name: '스미스머신 JM프레스' }).click();
  await expect(dlg).toBeHidden();
  await expect(cards).toHaveCount(n0 + 1);
  await expect(cards.nth(n0)).toContainText('스미스머신 JM프레스');
  await expect(cards.nth(n0)).toContainText('직접 추가');
  // 추가한 운동을 맨 위로
  for (let k = n0; k > 0; k--) await planSec.getByRole('button', { name: `스미스머신 JM프레스 위로 (지금 ${k + 1}번째)` }).click();
  await expect(planSec.getByRole('button', { name: '스미스머신 JM프레스 아래로 (지금 1번째)' })).toBeFocused(); // 맨 위에 닿아 ↑가 꺼지면 ↓로 초점
  await expect(cards.nth(0)).toContainText('스미스머신 JM프레스');
  await checkScreen(page, '20-plan-edit');

  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page).toHaveURL(/#\/workout/);
  // 첫 블록 = 추가한 JM프레스: 내 운동 DB 정보 버튼(강조)
  const dbLink = page.getByRole('link', { name: '스미스머신 JM프레스 정보 (내 운동 DB: 영상 등급·자세 포인트)' });
  await expect(dbLink).toBeVisible();
  await expect(dbLink).toHaveClass(/info-db/);
  await dbLink.locator('xpath=..').screenshot({ path: `reports/screens/${test.info().project.name}-22-info-db.png` });
  // 바꾼 세트·횟수가 루틴으로 이어짐
  // 카드 머리(펼치기)를 누름. 이름이 같은 손잡이(≡ 순서 옮기기)는 제외 (D-037)
  await page.getByRole('button', { name: new RegExp(`^${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (세트 간|라운드 후) 휴식`) }).first().click();
  await expect(page.getByLabel(`${first} 1세트 횟수`, { exact: true })).toHaveValue(String(reps0 + 1));
  await expect(page.getByLabel(`${first} ${sets0 + 1}세트 횟수`, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${first} ${sets0 + 2}세트 횟수`, { exact: true })).toHaveCount(0);
  // 이두도 이제 내 운동 DB(이두 티어 2026)가 있음 → 강조된 정보 버튼
  const biDb = page.getByRole('link', { name: `${first} 정보 (내 운동 DB: 영상 등급·자세 포인트)` });
  await expect(biDb).toBeVisible();
  await expect(biDb).toHaveClass(/info-db/);
  // 내 운동 DB가 없는 운동(프론트 레이즈는 영상 등급·자세 포인트 없음) → 흐린 기본 "정보": 운동 추가로 넣어 확인
  await page.getByRole('button', { name: /운동 추가/ }).first().click();
  await page.getByRole('dialog').getByLabel('운동 검색').fill('프론트 레이즈');
  await page.getByRole('dialog').getByRole('button', { name: /덤벨 프론트 레이즈/ }).first().click();
  await page.getByRole('button', { name: /^덤벨 프론트 레이즈 (세트 간|라운드 후) 휴식/ }).first().click();
  const plain = page.getByRole('link', { name: '덤벨 프론트 레이즈 정보 (DB 없음)' });
  await expect(plain).toBeVisible();
  await expect(plain).not.toHaveClass(/info-db/);
  await plain.locator('xpath=..').screenshot({ path: `reports/screens/${test.info().project.name}-23-info-plain.png` });
  await checkScreen(page, '21-workout-info');
});

test('플랜 바로 고치기 (D-036): 시간 운동 초 −/+ 가 예상 시간에 반영, 잠금 다시 생성해도 바꾼 횟수·다른 부위 추가 운동 유지', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '이두 선택 안 함' }).click();
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const est = async () => { const t = (await planSec.getByText(/예상 \d+:\d{2}/).textContent())!; const m = t.match(/(\d+):(\d{2})/)!; return Number(m[1]) * 60 + Number(m[2]); };

  // 다른 부위(코어)의 시간 운동 추가 → 초 조절
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  await page.getByRole('dialog', { name: '운동 추가' }).getByLabel('운동 검색').fill('플랭크');
  await page.getByRole('dialog', { name: '운동 추가' }).getByRole('button', { name: '플랭크', exact: true }).click();
  const secBox = planSec.getByRole('group', { name: '플랭크 시간' });
  await expect(secBox).toContainText('45초');
  const e0 = await est();
  for (let k = 0; k < 3; k++) await planSec.getByRole('button', { name: '플랭크 시간 늘리기' }).click();
  await expect(secBox).toContainText('60초');
  expect(await est(), '3세트 × 15초 늘림 → 예상 +45초').toBe(e0 + 45);

  // 첫 이두 운동 횟수 바꾸고 잠금, 플랭크도 잠금 → 다시 생성
  const first = (await planSec.locator('.card').nth(0).locator('strong').allTextContents())[0]!;
  const repsBox = planSec.getByRole('group', { name: `${first} 횟수` });
  const r0 = Number((await repsBox.textContent())!.match(/(\d+)회/)![1]);
  await planSec.getByRole('button', { name: `${first} 횟수 늘리기` }).click();
  await planSec.getByRole('button', { name: `${first} 횟수 늘리기` }).click();
  const lockBtn = (n: string) => planSec.locator('.card').filter({ hasText: n }).getByRole('button', { name: '잠금', exact: true });
  await lockBtn(first).first().click();
  await lockBtn('플랭크').click();
  await planSec.getByRole('button', { name: '다시 생성 (잠금 2개 유지)' }).click();
  await expect(planSec.getByRole('group', { name: '플랭크 시간' })).toContainText('60초');
  await expect(planSec.getByRole('group', { name: `${first} 횟수` })).toContainText(`${r0 + 2}회`);
  await expect(planSec.getByRole('button', { name: '다시 생성 (잠금 2개 유지)' })).toBeVisible();

  // 플랭크를 지우면 잠금 수도 줄어듦
  await planSec.getByRole('button', { name: '플랭크 삭제' }).click();
  await expect(planSec.getByRole('button', { name: '다시 생성 (잠금 1개 유지)' })).toBeVisible();
});

/** 손잡이(≡)를 끌어 target 카드 가운데에 놓기. Chromium은 실제 터치(CDP), 그 밖에는 마우스 */
async function dragTo(page: Page, handle: Locator, target: Locator, useTouch = false) {
  await handle.scrollIntoViewIfNeeded();
  const h = (await handle.boundingBox())!;
  const x0 = h.x + h.width / 2, y0 = h.y + h.height / 2;
  const tb = async () => (await target.boundingBox())!;
  if (useTouch) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', x0, y0);
    for (let k = 1; k <= 12; k++) { const t = await tb(); await touch('touchMove', x0 + ((t.x + t.width / 2 - x0) * k) / 12, y0 + ((t.y + t.height / 2 - y0) * k) / 12); }
    await touch('touchEnd', 0, 0);
    await cdp.detach();
  } else {
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let k = 1; k <= 12; k++) { const t = await tb(); await page.mouse.move(x0 + ((t.x + t.width / 2 - x0) * k) / 12, y0 + ((t.y + t.height / 2 - y0) * k) / 12); }
    await page.mouse.up();
  }
}
const namesOf = async (cards: Locator) => { const n = await cards.count(); const out: string[] = []; for (let i = 0; i < n; i++) out.push((await cards.nth(i).locator('strong').allTextContents()).join(' + ')); return out; };

test('끌어서 순서 바꾸기 (D-037): 플랜 → 운동 중(끝낸 세트 유지, 현재 세트 따라감, 키보드) → 루틴 편집', async ({ page }, info) => {
  const touch = info.project.name.includes('chromium');
  await page.getByRole('link', { name: '플랜' }).click();
  await page.getByRole('button', { name: '이두 선택 안 함' }).click();
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const cards = planSec.locator('.card');
  expect(await cards.count()).toBeGreaterThan(2);
  const p0 = await namesOf(cards);
  // 1번째 블록을 3번째 카드 위로 끌기 → [2, 3, 1, ...]
  await dragTo(page, planSec.getByRole('button', { name: `${p0[0]} 순서 옮기기, 지금 1번째 (끌거나 ↑↓ 키)` }), cards.nth(2), touch);
  await expect.poll(() => namesOf(cards)).toEqual([p0[1], p0[2], p0[0], ...p0.slice(3)]);
  await expect(planSec.locator('.card.dragging')).toHaveCount(0);
  await expect(page.locator('html.sorting')).toHaveCount(0);
  // 조금만 움직이면(6px 미만) 아무 일 없음
  const hb = (await planSec.locator('.drag-handle').first().boundingBox())!;
  await page.mouse.move(hb.x + 20, hb.y + 20); await page.mouse.down(); await page.mouse.move(hb.x + 22, hb.y + 23); await page.mouse.up();
  expect(await namesOf(cards)).toEqual([p0[1], p0[2], p0[0], ...p0.slice(3)]);
  await checkScreen(page, '24-plan-drag');
  const p1 = await namesOf(cards);

  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page).toHaveURL(/#\/workout/);
  const main = page.locator('main');
  const wcards = main.locator('.card');
  const heads = async () => { const n = await wcards.count(); const out: string[] = []; for (let i = 0; i < n; i++) out.push((await wcards.nth(i).locator('[role=button] strong').first().textContent())!.trim()); return out; };
  await expect.poll(heads).toEqual(p1);
  // 첫 세트 끝내기
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText(`${p1[0]} 2세트`);
  // 마지막 블록을 맨 앞으로 → 현재 세트가 그 운동 1세트로, 앞서 끝낸 세트는 원래 운동에 그대로
  const last = p1[p1.length - 1]!;
  await dragTo(page, main.getByRole('button', { name: `${last} 순서 옮기기, 지금 ${p1.length}번째 (끌거나 ↑↓ 키)` }), wcards.nth(0), touch);
  await expect.poll(heads).toEqual([last, ...p1.slice(0, -1)]);
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText(`${last} 1세트`);
  await wcards.nth(1).locator('[role=button]').click();
  await expect(page.getByRole('button', { name: '완료 취소' })).toHaveCount(1);
  // 손잡이만 눌렀다 떼면 카드가 열리거나 닫히지 않음
  const exp0 = await wcards.nth(1).locator('[role=button]').getAttribute('aria-expanded');
  await wcards.nth(1).locator('.drag-handle').click();
  expect(await wcards.nth(1).locator('[role=button]').getAttribute('aria-expanded')).toBe(exp0);
  // 키보드: 손잡이에 초점 → ↓ = 한 칸 아래, 초점은 옮긴 카드 손잡이에, 소리로 읽을 글
  const h1 = main.getByRole('button', { name: `${p1[0]} 순서 옮기기, 지금 2번째 (끌거나 ↑↓ 키)` });
  await h1.focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(heads).toEqual([last, p1[1], p1[0], ...p1.slice(2, -1)]);
  await expect(main.getByRole('button', { name: `${p1[0]} 순서 옮기기, 지금 3번째 (끌거나 ↑↓ 키)` })).toBeFocused();
  await expect(main.locator('p[aria-live]').filter({ hasText: '3번째로 옮김' })).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect.poll(heads).toEqual([p1[0], last, p1[1], ...p1.slice(2, -1)]);
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText(`${p1[0]} 2세트`); // 끝낸 1세트 유지
  await checkScreen(page, '25-workout-drag');
  // 새로 고쳐도 순서 저장됨
  await page.reload();
  await expect.poll(heads).toEqual([p1[0], last, p1[1], ...p1.slice(2, -1)]);
  await endWorkout(page);

  // 루틴 편집: 끌어서 옮기고 저장 → 다시 열면 그 순서
  await page.getByRole('button', { name: '+ 직접' }).click();
  await page.getByLabel('루틴 이름').fill('끌기 루틴');
  for (const q of ['해머 컬', '로프 푸시다운', '레그 프레스']) {
    await page.getByRole('button', { name: '+ 운동 추가' }).click();
    await page.getByLabel('운동 검색').fill(q);
    await page.getByRole('dialog').getByRole('button').filter({ hasText: q }).first().click();
  }
  const rcards = page.locator('main .card');
  const rn = () => page.locator('main .card').evaluateAll((els) => els.map((e) => e.querySelector('strong')?.textContent?.trim() ?? ''));
  const r0 = await rn();
  await dragTo(page, rcards.nth(2).locator('.drag-handle'), rcards.nth(0), touch);
  await expect.poll(rn).toEqual([r0[2], r0[0], r0[1]]);
  await checkScreen(page, '26-routine-drag');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.locator('main .card').filter({ has: page.getByRole('heading', { name: '끌기 루틴' }) }).getByRole('button', { name: '편집' }).click();
  await expect(async () => expect(await rn()).toEqual([r0[2], r0[0], r0[1]])).toPass({ timeout: 5000 });
});

test('끌어서 순서 바꾸기 (D-037) PC 2단: 오른쪽 카드를 왼쪽으로, 놓을 칸 테두리, 끄는 도중 카드가 사라져도 멈추지 않음', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pc = await ctx.newPage();
  await pc.goto('./#/');
  await pc.getByRole('button', { name: '알겠어요' }).click();
  await pc.getByRole('button', { name: '+ 직접' }).click();
  for (const q of ['해머 컬', '로프 푸시다운', '레그 프레스']) {
    await pc.getByRole('button', { name: '+ 운동 추가' }).click();
    await pc.getByLabel('운동 검색').fill(q);
    await pc.getByRole('dialog').getByRole('button').filter({ hasText: q }).first().click();
  }
  const cards = pc.locator('main .card');
  const rn = () => pc.locator('main .card').evaluateAll((els) => els.map((e) => e.querySelector('strong')?.textContent?.trim() ?? ''));
  const r0 = await rn();
  const b0 = (await cards.nth(0).boundingBox())!, b1 = (await cards.nth(1).boundingBox())!;
  expect(Math.abs(b0.y - b1.y), '2단 배치').toBeLessThan(4);
  // 2번째(오른쪽) 카드를 1번째(왼쪽) 위로: 끄는 도중 놓을 칸 테두리
  const h = (await cards.nth(1).locator('.drag-handle').boundingBox())!;
  await pc.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await pc.mouse.down();
  for (let k = 1; k <= 10; k++) await pc.mouse.move(h.x + h.width / 2 + ((b0.x + b0.width / 2 - h.x - h.width / 2) * k) / 10, h.y + h.height / 2 + ((b0.y + b0.height / 2 - h.y - h.height / 2) * k) / 10);
  await expect(cards.nth(0)).toHaveAttribute('data-drop', 'before');
  await expect(cards.nth(0)).toHaveAttribute('data-drop-grid', '');
  await expect(cards.nth(1)).toHaveClass(/dragging/);
  await pc.screenshot({ path: `reports/screens/${test.info().project.name}-27-pc-drag.png` });
  await pc.mouse.up();
  await expect.poll(rn).toEqual([r0[1], r0[0], r0[2]]);
  // 끄는 도중 손잡이가 사라지면(다른 화면으로 바뀜 등) 끌기 상태가 풀림
  const h2 = (await cards.nth(2).locator('.drag-handle').boundingBox())!;
  await pc.mouse.move(h2.x + 20, h2.y + 20); await pc.mouse.down(); await pc.mouse.move(h2.x + 20, h2.y - 60);
  await expect(pc.locator('html.sorting')).toHaveCount(1);
  await pc.evaluate(() => document.querySelectorAll('.drag-handle').forEach((e) => e.remove()));
  await expect(pc.locator('html.sorting')).toHaveCount(0);
  await expect(pc.locator('.card.dragging')).toHaveCount(0);
  await pc.mouse.up();
  await ctx.close();
});
