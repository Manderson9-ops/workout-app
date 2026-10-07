import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { mkdirSync, readFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSyncDir } from '../tools/sync_check';
import { emptyState, handleSync } from '../src/core/syncMerge';
import { APP_VERSION } from '../src/core/version';
import { displayVersion } from '../src/core/changelog';

/** 플랜 결과의 예상 시간 숫자 (예상 시간은 '플랜 요약' 첫 칸 한 곳에만, 분:초) */
const estMetric = (root: Page | Locator) => root.getByLabel('플랜 요약').locator('.metric').first();
const SHOWN_VERSION = displayVersion(APP_VERSION); // 화면 표시 버전 ("0.9.0", 꼬리표 없음 D-055 검토 A5)

mkdirSync('reports/screens', { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `reports/screens/${test.info().project.name}-${name}.png` });

/** 위쪽 "종료" → 앱 안 확인 창 "끝내기" (D-038: 브라우저 기본 confirm 대신) */
async function endWorkout(p: Page) {
  await p.getByRole('button', { name: '끝내기', exact: true }).click();
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
/**
 * 다음 문서 로드 때 앱 스크립트보다 먼저 localStorage 를 바꿈 (이 탭에서 한 번만).
 * page.evaluate 로 바로 바꾸면, 아직 시작 판단(새로 바뀐 점: 마지막 본 버전 읽고 지금 버전 저장)을 하기 전인 페이지가
 * 그 값을 먼저 써 버려 새로 고친 뒤에는 시트가 안 뜰 수 있음 (WebKit 에서 재현, D-055). 그래서 새 문서 시작 시점에 넣는다
 */
async function seedNextLoad(page: Page, seed: Record<string, string | null>) {
  const once = `e2e-seed-${Date.now()}-${Math.random()}`;
  await page.addInitScript(([key, s]) => {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    for (const [k, v] of Object.entries(s)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
  }, [once, seed] as const);
}
async function checkScreen(page: Page, name: string) { await noHorizontalScroll(page); await touchTargets(page); await shot(page, name); }
/** D-055: 루틴 카드의 ⋯ → [편집]/[지우기] (홈·내 루틴. 운동 탭 고르기는 편집이 바로 보임) */
async function routineMenu(scope: Page | Locator, name: string, action: '편집' | '지우기') {
  await scope.getByRole('button', { name: `${name} 메뉴`, exact: true }).click();
  await scope.getByRole('button', { name: `${name} ${action}`, exact: true }).click();
}
/** D-055: 홈 최근 운동 카드의 ⋯ → [수정]/[삭제] */
async function recentMenu(card: Locator, action: '수정' | '삭제') {
  await card.getByRole('button', { name: / 메뉴$/ }).click();
  await card.getByRole('button', { name: new RegExp(` ${action}$`) }).click();
}

/** 플랜을 만들어 루틴으로 저장만 (홈으로) */
/** D-047: 부위 버튼 → 우선순위 창(기본 높음) → (원하면 고르기) → 완료 */
async function pickPart(p: Page, part: string, pr?: '높음' | '보통' | '낮음') {
  await p.getByRole('button', { name: `${part} 선택 안 함` }).click();
  const dlg = p.getByRole('dialog', { name: `${part} 우선순위` });
  if (pr) await dlg.getByRole('radio', { name: new RegExp('^' + pr + ':') }).click();
  await dlg.getByRole('button', { name: '완료' }).click();
}
async function makeRoutine(page: Page, parts: string[], minutes: string) {
  await page.getByRole('link', { name: '플랜' }).click();
  for (const [k, p] of parts.entries()) await pickPart(page, p, k === 1 ? '보통' : undefined);
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
  await pickPart(page, '등');
  await pickPart(page, '삼두', '보통');
  await page.getByRole('button', { name: '45분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  await expect(planSec.getByText('원암 랫풀다운', { exact: true })).toBeVisible();
  await expect(estMetric(planSec)).toHaveText(/^예상 시간\d+:\d{2}목표 45분$/);
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
  await tap(page.getByRole('button', { name: '끝내기', exact: true }));
  await tap(page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' })); // 앱 안 확인 창 (D-038)
  await expect(page.getByText('최근 운동')).toBeVisible();
  await expect(page.getByRole('group', { name: /^최근 운동 / }).first()).toContainText('세트 3');
  expect(taps, '루틴 시작 → 세트 3개 → 종료 (확인창 포함)').toBeLessThanOrEqual(12);
  await checkScreen(page, '05-home-after');

  // 다시 시작: 지난번 무게가 미리 채워짐 + 웜업 세트 순서
  await page.getByRole('button', { name: /등\+삼두 45분 시작/ }).click();
  await expect(page.getByLabel('원암 랫풀다운 1세트 무게', { exact: true })).toHaveValue('40');
  await expect(page.getByLabel(/^원암 랫풀다운 1세트 지난번 40×\d+$/)).toBeVisible(); // 세트 표 지난번 칸 (D-055 2단계)
  await page.getByRole('button', { name: '+ 웜업' }).first().click();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toContainText('웜업 완료');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await expect(page.getByRole('timer')).toContainText('웜업 후 휴식');
  // 메모 시트 (한 손 입력, prompt 대신)
  await page.getByRole('button', { name: '운동 메모' }).click();
  await page.getByRole('dialog', { name: '오늘 운동 메모' }).getByRole('textbox').fill('컨디션 좋음');
  await touchTargets(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('컨디션 좋음', { exact: true })).toBeVisible(); // 메모는 아이콘 + 글 (이모지 없음, D-055 3단계)
});

test('운동 끝내기 (D-038): 앱 안 확인 창(기본 확인 창 0번), 취소하면 계속, 끝내지 못하면 이유 표시·진단 기록, 새로 시작 확인', async ({ page }) => {
  // 기본 확인 창이 뜨면 취소로 답함 = 예전에 조용히 안 끝났던 상황. 이 시험에서는 한 번도 뜨면 안 됨
  let native = 0;
  page.on('dialog', (d) => { native++; void d.dismiss(); });
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '이두');
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
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
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
  // 창이 열린 채 뒤로 가기 → 창만 닫히고 가려던 화면으로 (취소처럼 운동 화면으로 끌고 가지 않음, D-039 검토)
  await page.getByRole('link', { name: '기록' }).click();
  await page.getByRole('link', { name: '홈' }).click();
  await startBtn.click();
  await expect(ask).toBeVisible();
  await page.goBack();
  await expect(ask).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/stats$/);
  await page.getByRole('link', { name: '홈' }).click();
  await startBtn.click();
  await ask.getByRole('button', { name: '끝내고 새로 시작' }).click();
  await expect(doneBtn).toBeVisible();
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('group', { name: /^최근 운동 / })).toHaveCount(1); // 앞 운동은 끝난 기록으로

  // 4) 정상 끝내기 (끝내기 두 번 빠르게 눌러도 한 번) → 홈, 최근 운동 2개, 기본 확인 창은 한 번도 안 뜨었음
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
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
  // 장비·등급·주 근육은 [필터] 안 (D-055 v0.9.2 검토): 처음엔 접힘, 적용 개수 배지
  const ft = page.getByRole('button', { name: /^필터 \(장비·등급·주 근육\)/ });
  await expect(ft).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('장비 필터')).toHaveCount(0);
  await ft.click();
  await page.getByLabel('장비 필터').selectOption('smith');
  await page.getByLabel('등급 필터').selectOption('S');
  await expect(ft).toHaveAccessibleName('필터 (장비·등급·주 근육), 2개 적용');
  await expect(page.getByRole('button', { name: '스미스머신 JM프레스' })).toBeVisible();
  await expect(page.getByRole('button', { name: '원암 랫풀다운' })).toHaveCount(0);
  await page.getByRole('button', { name: '스미스머신 JM프레스' }).click();
  await expect(page.getByRole('heading', { name: '영상 등급' })).toBeVisible();
  await expect(page.getByRole('link', { name: /최고의 삼두근 운동/ }).first()).toHaveAttribute('href', /i40LqeORuxA&t=\d+s/);
  await page.getByRole('button', { name: '즐겨찾기', exact: true, pressed: false }).click();
  await expect(page.getByRole('button', { name: '즐겨찾기', exact: true, pressed: true })).toBeVisible();
  await noHorizontalScroll(page); await touchTargets(page);
  await shot(page, '07-exercise-detail');
});

test('D-041 플랜 볼륨: 하체 75분 B- → 70분 이상, 가슴만 75분 → 짧은 이유·삼두 더해서 다시 만들기, 종목 탭 주/보조 근육·근육 필터', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await expect(page.getByTestId('level-rule')).toHaveText('중급: 운동당 최대 4세트(앱 기준) · 한 근육은 한 번에 11세트까지(연구 근거, 보조로 쓰이면 0.5세트로 셈)');
  await pickPart(page, '하체');
  await page.getByRole('button', { name: '75분' }).click();
  await page.getByLabel('최소 등급').selectOption('B-');
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  // 이전에는 "예상 33:12 / 75분"
  await expect(estMetric(page)).toHaveText(/^예상 시간7[0-5]:\d\d목표 75분$/);
  await expect(page.getByRole('status', { name: '목표 시간보다 짧은 이유' })).toHaveCount(0);
  for (const n of ['스미스머신 스쿼트', '루마니안 데드리프트', '라잉 레그 컬', '바벨 힙 쓰러스트', '스탠딩 카프 레이즈']) await expect(page.getByRole('button', { name: `${n} 삭제` })).toBeVisible();
  await shot(page, '41-plan-legs-75');
  // 하체 빼고(높음→보통→낮음→빼기) 가슴만
  await page.getByRole('button', { name: '하체 높음' }).click(); // 창에서 빼기 (D-047)
  await page.getByRole('dialog', { name: '하체 우선순위' }).getByRole('button', { name: '이 부위 빼기' }).click();
  await pickPart(page, '가슴');
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const note = page.getByRole('status', { name: '목표 시간보다 짧은 이유' });
  await expect(note).toContainText(/목표보다 약 \d+분 짧아요/);
  await expect(note).toContainText('한 근육을 한 번에 약 11세트보다 많이 해도 근성장 차이를 확인하기 어려웠다');
  await checkScreen(page, '42-plan-chest-slack');
  const before = (await estMetric(page).textContent())!;
  await note.getByRole('button', { name: '+ 삼두 더해서 다시 만들기' }).click();
  await expect(page.getByRole('button', { name: '삼두 보통' })).toBeVisible();
  await expect(page.getByText(/^삼두 [SABCDF][+-]? \(/).first()).toBeVisible();
  const after = (await estMetric(page).textContent())!;
  const mins = (t: string) => Number(/(\d+):/.exec(t)![1]);
  expect(mins(after)).toBeGreaterThan(mins(before) + 10);
  // 종목 탭: 주/보조 근육 표시, 주 근육 필터
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByRole('button', { name: '하체', exact: true }).click();
  await expect(page.getByRole('button', { name: '스미스머신 스쿼트' })).toContainText('주 대퇴사두 · 보조 둔근');
  await page.getByRole('button', { name: /^필터 \(장비·등급·주 근육\)/ }).click();
  await page.getByLabel('주 근육 필터').selectOption('햄스트링');
  const rows = page.locator('.list-item .muscles');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  for (const t of await rows.allTextContents()) expect(t.startsWith('주 햄스트링')).toBe(true);
  await checkScreen(page, '43-exercises-muscle-filter');
});

test('개선 메모 (D-042~D-045): 인체 그림으로 부위 고르기·우선순위 선택 상자(기본 높음), 세트 8 넘게, 운동 추가 부위 기억·들어 있는 부위, 음악과 같이 듣기 설정', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  const map = page.getByTestId('bodymap');
  // D-047: 앞 그림 가슴을 누르면 '높음'으로 골라지고 우선순위 창이 열림
  await map.locator('rect[data-part="가슴"]').click();
  const dlgC = page.getByRole('dialog', { name: '가슴 우선순위' });
  await expect(dlgC.getByRole('radio', { name: /^높음:/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dlgC.getByRole('radio', { name: /^높음:/ })).toBeFocused(); // 열리면 고른 단계에 초점
  await expect(page.getByRole('button', { name: '가슴 높음' })).toBeVisible();
  await dlgC.getByRole('button', { name: '완료' }).click();
  // 뒤 그림으로 바꿔 등 → 창에서 낮음
  await map.getByRole('button', { name: '뒤' }).click();
  await map.locator('rect[data-part="등"]').click();
  const dlgB = page.getByRole('dialog', { name: '등 우선순위' });
  await dlgB.getByRole('radio', { name: /^낮음:/ }).click();
  await expect(dlgB.getByRole('radio', { name: /^낮음:/ })).toHaveAttribute('aria-checked', 'true');
  // 화살표로 보통 → 다시 낮음
  await dlgB.getByRole('radio', { name: /^낮음:/ }).press('ArrowUp');
  await expect(dlgB.getByRole('radio', { name: /^보통:/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '등 보통' })).toBeVisible();
  await dlgB.getByRole('radio', { name: /^보통:/ }).press('ArrowDown');
  await expect(page.getByRole('button', { name: '등 낮음' })).toBeVisible(); // 고르자마자 반영
  await checkScreen(page, '46-plan-part-sheet');
  await dlgB.getByRole('button', { name: '완료' }).click();
  await expect(map.locator('path[data-vis="등"].p-low').first()).toBeVisible();
  // 뒤 그림 삼두: 보이는 근육 위 실제 위치로 눌러도 켜짐, 누르는 영역은 44px 이상
  const svg = map.locator('svg');
  const fb = (await svg.boundingBox())!;
  const sx = fb.width / 724, sy = fb.height / 1290;
  await page.mouse.click(fb.x + (930 - 724) * sx, fb.y + (460 - 80) * sy);
  await expect(page.getByRole('dialog', { name: '삼두 우선순위' })).toBeVisible();
  await page.getByRole('dialog', { name: '삼두 우선순위' }).getByRole('button', { name: '이 부위 빼기' }).click();
  await expect(page.getByRole('button', { name: '삼두 선택 안 함' })).toBeVisible();
  const sizes = await map.locator('rect.bm-hit').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('data-part'), Math.round(r.width), Math.round(r.height)]; }));
  for (const [part, w, h] of sizes as [string, number, number][]) expect(Math.min(w, h), `${part} 누르는 영역`).toBeGreaterThanOrEqual(44);
  // 보이는 근육 가운데를 실제로 누르면 그 근육의 부위 창이 열림 (누르는 사각형이 근육을 가리지 않음, 아이폰 탭 보정 포함)
  const tapMuscle = async (side: '앞' | '뒤', part: string, nth = 0) => {
    await map.getByRole('button', { name: side }).click();
    // 근육 모양 안쪽에서 가장 가운데에 가까운 점 (bbox 가운데가 모양 밖일 수 있음)
    // nth < 0 이면 그 부위에서 가장 큰 조각 (아주 가는 조각은 손가락 크기보다 작아 어느 쪽인지 정의하기 어려움)
    const pieces = map.locator(`path[data-vis="${part}"]`);
    const areas = await pieces.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.width * r.height; }));
    const idx = nth >= 0 ? nth : areas.indexOf(Math.max(...areas));
    const pt = await pieces.nth(idx).evaluate((el) => {
      const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; let best: [number, number] | null = null, bd = 1e9;
      for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const x = r.x + (r.width * i) / 12, y = r.y + (r.height * j) / 12; const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (document.elementFromPoint(x, y) === el && d < bd) { bd = d; best = [x, y]; } }
      return best;
    });
    expect(pt, `${side} ${part} ${nth}번째 근육이 보임`).not.toBeNull();
    await page.mouse.click(pt![0], pt![1]);
    const dlg = page.getByRole('dialog', { name: /우선순위$/ });
    await expect(dlg, `${side} ${part} ${nth}번째 근육`).toHaveAccessibleName(`${part} 우선순위`);
    await dlg.getByRole('button', { name: '이 부위 빼기' }).click();
  };
  for (const [side, part, n] of [['앞', '가슴', -1], ['앞', '어깨', -1], ['앞', '이두', -1], ['앞', '전완·악력', -1], ['앞', '코어', -1], ['앞', '코어', 6], ['앞', '하체', -1],
    ['뒤', '어깨', -1], ['뒤', '등', -1], ['뒤', '등', 3], ['뒤', '삼두', -1], ['뒤', '전완·악력', -1], ['뒤', '하체', -1]] as ['앞' | '뒤', string, number][]) await tapMuscle(side, part, n);
  // 앞의 가는 삼두·승모근은 장식 (뒤 그림에서 고름)
  await map.getByRole('button', { name: '앞' }).click();
  await expect(map.locator('path[data-vis="삼두"], path[data-vis="등"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /(높음|보통|낮음)$/ })).toHaveCount(0); // 고른 가슴·등도 그림에서 열어 뺐음
  // 버튼으로 연 창은 Esc로 닫으면 그 버튼으로 초점이 돌아옴
  await page.getByRole('button', { name: '코어 선택 안 함' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '코어 우선순위' })).toHaveCount(0);
  // WebKit은 버튼을 눌러도 초점을 주지 않아(실제 사파리와 같음) 돌아올 초점이 없음 → Chromium에서만 확인
  if (test.info().project.name.includes('chromium')) await expect(page.getByRole('button', { name: '코어 높음' })).toBeFocused();
  await page.getByRole('button', { name: '코어 높음' }).click();
  await page.getByRole('dialog', { name: '코어 우선순위' }).getByRole('button', { name: '이 부위 빼기' }).click();
  // 부위를 많이 골라 버튼 글자가 길어져도 그림 위치는 그대로 (연속으로 눌러도 빗나가지 않게)
  const y0 = (await map.locator('svg').boundingBox())!.y;
  for (const p of ['가슴', '등', '어깨', '이두', '삼두', '전완·악력', '하체', '코어']) await pickPart(page, p);
  expect((await map.locator('svg').boundingBox())!.y).toBe(y0);
  for (const p of ['가슴', '등', '어깨', '이두', '삼두', '전완·악력', '하체', '코어']) { await page.getByRole('button', { name: `${p} 높음` }).click(); await page.getByRole('dialog', { name: `${p} 우선순위` }).getByRole('button', { name: '이 부위 빼기' }).click(); }
  // 그림 저작권 고지(MIT)가 배포본에 남아 있음
  expect(await (await page.request.get('./THIRD_PARTY_LICENSES.txt')).text()).toContain('Copyright (c) 2022 ELABBASSI Hicham');
  await checkScreen(page, '46-plan-bodymap');
  // 세트 8 넘게 (D-042)
  await pickPart(page, '이두');
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const first = (await planSec.locator('.card').nth(0).locator('strong').allTextContents())[0]!;
  const plus = planSec.getByRole('button', { name: `${first} 세트 늘리기` });
  for (let k = 0; k < 9; k++) await plus.click();
  await expect(planSec.getByRole('group', { name: `${first} 세트` })).toContainText(/1[0-3]\s*세트/);
  await expect(plus).toBeEnabled();
  // 운동 추가: 들어 있는 부위 줄, 마지막으로 고른 부위 기억 (D-044)
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  const dlg = page.getByRole('dialog', { name: '운동 추가' });
  await expect(dlg.getByRole('group', { name: '지금 들어 있는 부위' }).getByRole('button', { name: '이두' })).toBeVisible();
  await expect(dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '전체' })).toHaveClass(/\bon\b/);
  await dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '코어' }).click();
  await checkScreen(page, '47-picker-parts');
  await dlg.getByRole('button', { name: '닫기' }).click();
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  await expect(dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '코어' })).toHaveClass(/\bon\b/);
  await dlg.getByRole('group', { name: '지금 들어 있는 부위' }).getByRole('button', { name: '이두' }).click();
  await expect(dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '이두' })).toHaveClass(/\bon\b/);
  // 기억된 부위(이두)에 없는 운동을 검색하면 모든 부위에서 찾아 줌
  await dlg.getByLabel('운동 검색').fill('플랭크');
  await expect(dlg.getByRole('status')).toContainText('이두에는 "플랭크" 운동이 없어 모든 부위에서 찾았어요');
  await expect(dlg.getByRole('button', { name: '플랭크', exact: true })).toBeVisible();
  await dlg.getByRole('button', { name: '닫기' }).click();
  // 교체 창에서 부위를 바꿔도 추가 창의 기억은 그대로 (이두)
  await planSec.getByRole('button', { name: '교체' }).first().click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '가슴' }).click();
  await page.getByRole('dialog', { name: '운동 교체' }).getByRole('button', { name: '닫기' }).click();
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  await expect(dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '이두' })).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('button', { name: '닫기' }).click();
  // 음악과 같이 듣기 (D-045): 두 엔진 모두 navigator.audioSession이 없어 가짜 객체로 실제 값을 검사
  await page.addInitScript(() => { Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true }); });
  await page.goto('./#/settings');
  await page.reload(); // 해시만 바뀌면 문서가 그대로라 초기 스크립트가 안 들어감
  const am = page.getByLabel('다른 앱 음악과 같이 들을 때 (이 기기만)');
  await expect(am).toHaveValue('mix');
  const sessionType = () => page.evaluate(() => (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type ?? 'none');
  expect(await sessionType()).toBe('auto'); // 누르기 전에는 바꾸지 않음
  await page.locator('main h1').first().click();
  expect(await sessionType()).toBe('transient');
  await am.selectOption('solo');
  expect(await sessionType()).toBe('playback');
  await expect(page.getByText('앱을 누르면 다른 앱 음악이 멈춰요')).toBeVisible();
  await page.reload();
  await expect(am).toHaveValue('solo');
  await page.locator('main h1').first().click();
  expect(await sessionType()).toBe('playback');
  await am.selectOption('mix');
  expect(await sessionType()).toBe('transient');
  await expect(page.getByText('무음 모드(무음 스위치)에서는 휴식 끝 알림음이 안 나요')).toBeVisible();
  // 소리 끔이면 눌러도 세션을 잡지 않음
  await page.getByRole('button', { name: '소리 켬' }).click();
  await expect(page.getByRole('button', { name: '소리 끔' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '소리 끔' })).toBeVisible();
  await page.locator('main h1').first().click();
  expect(await sessionType()).toBe('auto');
  await page.getByRole('button', { name: '소리 끔' }).click();
});

test('플랜에서 다음 운동과 묶기 (D-046): 같은 부위 컴파운드 세트, 다른 부위 슈퍼세트, 예상 시간 줄어듦, 풀기, 저장하고 시작하면 운동 화면도 묶음', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '이두');
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const est = async () => { const t = (await estMetric(planSec).textContent())!; const m = t.match(/(\d+):(\d{2})/)!; return Number(m[1]) * 60 + Number(m[2]); };
  // 다른 부위(코어) 운동을 뒤에 추가
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  const dlg = page.getByRole('dialog', { name: '운동 추가' });
  await dlg.getByLabel('운동 검색').fill('플랭크');
  await dlg.getByRole('button', { name: '플랭크', exact: true }).click();
  const cards = planSec.locator('.card');
  const n0 = await cards.count();
  // 1·2번째(둘 다 이두) → 컴파운드 세트
  const e0 = await est();
  await cards.nth(0).getByRole('button', { name: /^다음과 묶기 · 컴파운드 세트: / }).click();
  await expect(cards).toHaveCount(n0 - 1);
  await expect(cards.nth(0).locator('.badge.kind')).toHaveText('컴파운드 세트');
  expect(await est(), '묶으면 예상 시간이 줄어듦').toBeLessThan(e0);
  // 끝에서 두 번째(이두) + 마지막(플랭크, 코어) → 슈퍼세트
  const last = await cards.count();
  await cards.nth(last - 2).getByRole('button', { name: /^다음과 슈퍼세트로 묶기: .* \+ 플랭크$/ }).click();
  await expect(cards.nth(last - 2).locator('.badge.kind')).toHaveText('슈퍼세트');
  await expect(cards.nth(last - 2)).toContainText('플랭크');
  await checkScreen(page, '49-plan-superset');
  // 묶은 뒤 키보드로 순서를 옮기면 옮김 안내가 읽힘 (묶기 안내가 가리지 않음)
  const live = planSec.locator('p.sr-only[aria-live="polite"]');
  await expect(live).toContainText('묶었어요');
  await cards.nth(0).getByRole('button', { name: /순서 옮기기, 지금 1번째/ }).press('ArrowDown');
  await expect(live).toContainText('2번째로 옮김');
  await cards.nth(1).getByRole('button', { name: /순서 옮기기, 지금 2번째/ }).press('ArrowUp');
  // 풀기 → 다시 단일
  await cards.nth(0).getByRole('button', { name: /^묶음 풀기: / }).click();
  await expect(cards.nth(0).locator('.badge.kind')).toHaveCount(0);
  // 저장하고 시작 → 운동 화면에도 슈퍼세트
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page.getByText('슈퍼세트').first()).toBeVisible();
  await endWorkout(page);
});

test('플랜 일괄·묶음 고치기 (D-051): 모든 운동 세트·횟수, 묶음 휴식·전환·세트, 묶음에 운동 추가, 저장하고 시작', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '이두');
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const est = async () => { const t = (await estMetric(planSec).textContent())!; const m = t.match(/(\d+):(\d{2})/)!; return Number(m[1]) * 60 + Number(m[2]); };
  // 묶음 밖의 단일 카드를 하나 두려고 코어 운동을 뒤에 추가
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  const dlg0 = page.getByRole('dialog', { name: '운동 추가' });
  await dlg0.getByLabel('운동 검색').fill('사이드 플랭크');
  await dlg0.getByRole('button', { name: '사이드 플랭크', exact: true }).click();
  const cards = planSec.locator('.card');
  await cards.nth(0).getByRole('button', { name: /^다음과 묶기 · 컴파운드 세트: / }).click();
  await expect(cards.nth(0).locator('.badge.kind')).toHaveText('컴파운드 세트');
  const grp = cards.nth(0);
  const nCards = await cards.count();
  expect(nCards).toBeGreaterThanOrEqual(2);
  const setVals = async (loc: Locator = planSec) => (await loc.locator('.plan-steps').getByText(/^\d+세트$/).allTextContents()).map((x) => parseInt(x, 10));
  const repVals = async (loc: Locator = planSec) => (await loc.locator('.plan-steps').getByText(/^\d+회$/).allTextContents()).map((x) => parseInt(x, 10));
  const live = planSec.locator('p.sr-only[aria-live="polite"]');
  // 모든 운동 세트 +1 / 횟수 -1
  const s0 = await setVals(), r0 = await repVals();
  await planSec.getByRole('button', { name: '모든 운동 세트 늘리기' }).click();
  expect(await setVals()).toEqual(s0.map((x) => x + 1));
  await expect(live).toContainText(/운동 \d+개 세트 \+1/);
  // 일괄 버튼 가운데에는 지금 값(범위)이 보임
  await expect(planSec.getByRole('group', { name: '모든 운동 세트', exact: true }).locator('.val')).toHaveText(/^\d+(~\d+)?세트$/);
  await expect(planSec.getByRole('group', { name: '모든 운동 횟수', exact: true }).locator('.val')).toHaveText(/^\d+(~\d+)?(회|초)( · \d+(~\d+)?초)?$/);
  await planSec.getByRole('button', { name: '모든 운동 횟수 줄이기' }).click();
  expect(await repVals()).toEqual(r0.map((x) => x - 1));
  // D-052: 이 묶음 세트·횟수는 묶음 설정을 열지 않아도 보임 (접힌 <details> 밖)
  await expect(grp.getByText('이 묶음 세트', { exact: true })).toBeVisible();
  await expect(grp.getByText('이 묶음 횟수', { exact: true })).toBeVisible();
  await expect(grp.getByRole('button', { name: /세트 모두 늘리기$/ })).toBeVisible();
  expect(await grp.locator('details.group-settings').getByText('이 묶음 세트').count()).toBe(0);
  // 묶음 설정은 기본으로 접혀 있고, 요약에 지금 값이 보임. 열고 나서 라운드 후 휴식 -15
  const det = grp.locator('details.group-settings');
  await expect(det).not.toHaveAttribute('open', '');
  await expect(det.locator('summary')).toContainText(/묶음 설정 · 라운드 후 \d+초 · 전환 \d+초/);
  expect((await det.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await det.locator('summary').click();
  await expect(det).toHaveAttribute('open', '');
  const pill = grp.locator('.pill', { hasText: '라운드 후 휴식' });
  const rr0 = Number((await pill.textContent())!.match(/라운드 후 휴식 (\d+)초/)![1]);
  const e1 = await est();
  await grp.getByRole('button', { name: /라운드 후 휴식 줄이기$/ }).click();
  await expect(pill).toContainText(`라운드 후 휴식 ${rr0 - 15}초`);
  await expect(grp.getByText(`${rr0 - 15}초`, { exact: true })).toBeVisible();
  expect(await est(), '라운드 휴식을 줄이면 예상 시간이 줄어듦').toBeLessThan(e1);
  await expect(det.locator('summary')).toContainText(`라운드 후 ${rr0 - 15}초`);
  // 전환 +5 (기본 10 → 15)
  const e2 = await est();
  await grp.getByRole('button', { name: /운동 사이 전환 늘리기$/ }).click();
  await expect(grp.getByText('15초', { exact: true })).toBeVisible();
  expect(await est(), '전환을 늘리면 예상 시간이 늘어남').toBeGreaterThan(e2);
  // 이 묶음 세트 +1: 묶음만 바뀜
  const gs = await setVals(grp), os = await setVals(cards.nth(nCards - 1));
  await grp.getByRole('button', { name: /세트 모두 늘리기$/ }).click();
  expect(await setVals(grp)).toEqual(gs.map((x) => x + 1));
  expect(await setVals(cards.nth(nCards - 1))).toEqual(os);
  // 일괄 버튼은 더 줄일 수 없으면 꺼짐 (모든 운동 세트를 1까지 줄이면)
  const allDec = planSec.getByRole('button', { name: '모든 운동 세트 줄이기' });
  for (let k = 0; k < 120 && await allDec.isEnabled(); k++) await allDec.click();
  await expect(allDec).toBeDisabled();
  await expect(planSec.getByRole('button', { name: '모든 운동 세트 늘리기' })).toBeEnabled();
  // 묶음에 운동 추가
  await grp.getByRole('button', { name: /^\+ 묶음에 운동 추가/ }).click();
  const dlg = page.getByRole('dialog', { name: '묶음에 운동 추가' });
  await dlg.getByLabel('운동 검색').fill('플랭크');
  await dlg.getByRole('button', { name: '플랭크', exact: true }).click();
  await expect(planSec.locator('.card').nth(0)).toContainText('플랭크');
  await expect(planSec.locator('.card').nth(0).locator('.badge.kind')).toBeVisible();
  // 초점은 새로 추가한 운동의 '세트 늘리기'로 (카드가 다시 만들어져도)
  await expect(planSec.getByRole('button', { name: '플랭크 세트 늘리기', exact: true })).toBeFocused();
  await checkScreen(page, '62-plan-bulk-group');
  // 저장하고 시작 → 운동 화면에 추가한 운동
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await expect(page.getByText('플랭크').first()).toBeVisible();
  // 바꾼 라운드 후 휴식이 운동 화면에 그대로
  await expect(page.getByText(`라운드 후 휴식 ${rr0 - 15}초`).first()).toBeVisible();
  await endWorkout(page);
});
test('내 루틴 (D-048): 홈은 최근 한 순 3개 + 모두 보기, 카드에 부위·마지막 날짜·횟수, 목록에서만 숨기기 ↔ 다시 보이기, 완전 삭제, 운동 탭에서 바로 고르기', async ({ page }) => {
  for (const [p, m] of [['등', '30분'], ['가슴', '30분'], ['하체', '45분'], ['이두', '30분']] as [string, string][]) {
    await makeRoutine(page, [p], m);
    // 플랜 만들기는 고른 부위를 기억하므로 다음 루틴 전에 뺌
    await page.getByRole('link', { name: '플랜' }).click();
    await page.getByRole('button', { name: `${p} 높음` }).click();
    await page.getByRole('dialog', { name: `${p} 우선순위` }).getByRole('button', { name: '이 부위 빼기' }).click();
  }
  // 하체 루틴으로 한 번 운동 → 최근 한 순 맨 앞, "오늘 · 1회"
  await page.getByRole('link', { name: '홈' }).click();
  await page.getByRole('button', { name: '하체 45분 시작' }).click();
  await endWorkout(page);
  await page.getByRole('link', { name: '홈' }).click();
  const home = page.getByRole('region', { name: '내 루틴' });
  await expect(home.locator('.routine-card')).toHaveCount(3);
  await expect(home.locator('.routine-card').first()).toHaveAttribute('aria-label', '루틴 하체 45분');
  await expect(home.locator('.routine-card').first()).toContainText('오늘');
  await expect(home.locator('.routine-card').first()).toContainText('1회');
  await expect(home.locator('.routine-card').first().locator('.tag')).toHaveText(['하체']);
  await checkScreen(page, '55-home-routines');
  // 모두 보기 → 4개, 정렬 바꾸기(이름 순)
  await page.getByRole('button', { name: '내 루틴 모두 보기 (4개)' }).click();
  await expect(page).toHaveURL(/#\/routines/);
  const list = page.getByRole('region', { name: '내 루틴' });
  await expect(list.locator('.routine-card')).toHaveCount(4);
  await list.getByRole('button', { name: '이름 순' }).click();
  expect(await list.locator('.routine-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['루틴 가슴 30분', '루틴 등 30분', '루틴 이두 30분', '루틴 하체 45분']);
  // 목록에서만 숨기기 → 숨긴 루틴에 있음 → 다시 보이기
  await routineMenu(list, '가슴 30분', '지우기');
  await answer(page, '목록에서만 숨기기');
  await expect(page.getByRole('status').filter({ hasText: '「가슴 30분」 루틴을 목록에서 숨겼어요' })).toHaveCount(1);
  await expect(page.locator('.toast').getByRole('button', { name: '되돌리기' })).toBeVisible();
  await expect(list.locator('.routine-card:not(.is-hidden)')).toHaveCount(3);
  await list.getByRole('button', { name: /숨긴 루틴 1개/ }).click();
  await expect(list.locator('.routine-card.is-hidden')).toHaveAttribute('aria-label', '루틴 가슴 30분');
  await checkScreen(page, '56-routines-hidden');
  await list.getByRole('button', { name: '가슴 30분 다시 보이기' }).click();
  await expect(list.locator('.routine-card:not(.is-hidden)')).toHaveCount(4);
  // 숨긴 루틴은 운동 탭 고르기에도 안 나옴 / 완전 삭제는 되돌릴 수 없음 (확인 창)
  await routineMenu(list, '이두 30분', '지우기');
  await answer(page, '목록에서만 숨기기');
  await routineMenu(list, '등 30분', '지우기');
  await answer(page, '완전 삭제');
  await expect(list.getByRole('group', { name: '루틴 등 30분' })).toHaveCount(0);
  await expect(list.getByRole('button', { name: /숨긴 루틴 1개/ })).toHaveAttribute('aria-expanded', 'true'); // 아까 펼친 그대로
  await list.getByRole('button', { name: '이두 30분 완전 삭제' }).click();
  await answer(page, '완전 삭제');
  await expect(list.getByRole('button', { name: /숨긴 루틴/ })).toHaveCount(0);
  // 검색어가 남은 채 개수가 줄어도 검색창·지우기 버튼은 남음 (루틴 5개 → 검색 → 숨겨 4개)
  for (const n of ['A', 'B', 'C']) { await page.getByRole('button', { name: '+ 직접' }).click(); await page.getByLabel('루틴 이름').fill('빈 ' + n); await page.getByRole('button', { name: '저장', exact: true }).click(); }
  await page.getByRole('button', { name: /^내 루틴 모두 보기/ }).click();
  await expect(list.locator('.routine-card:not(.is-hidden)')).toHaveCount(5);
  await expect(list.getByRole('group', { name: '루틴 빈 A' }).getByRole('button', { name: '빈 A 운동 넣기' })).toBeVisible(); // 운동 없는 루틴은 시작 대신 운동 넣기
  await list.getByLabel('루틴 검색').fill('빈');
  await expect(list.locator('.routine-card')).toHaveCount(3);
  await routineMenu(list, '빈 A', '지우기');
  await answer(page, '목록에서만 숨기기');
  await expect(list.getByLabel('루틴 검색')).toHaveValue('빈');
  await list.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(list.locator('.routine-card:not(.is-hidden)')).toHaveCount(4);
  for (const n of ['B', 'C']) { await routineMenu(list, `빈 ${n}`, '지우기'); await answer(page, '완전 삭제'); }
  if ((await list.getByRole('button', { name: /숨긴 루틴/ }).getAttribute('aria-expanded')) !== 'true') await list.getByRole('button', { name: /숨긴 루틴/ }).click();
  await list.getByRole('button', { name: '빈 A 완전 삭제' }).click();
  await answer(page, '완전 삭제');
  // 운동 탭: 진행 중 운동이 없으면 바로 루틴 고르기 (시작·편집, 지우기 없음 D-053)
  await page.getByRole('link', { name: '운동' }).click();
  await expect(page.getByRole('heading', { name: '루틴 고르기' })).toBeVisible();
  const pick = page.getByRole('region', { name: '내 루틴' });
  expect(await pick.locator('.routine-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['루틴 가슴 30분', '루틴 하체 45분']); // 정렬은 내 루틴 화면에서 고른 것(이름 순)을 따름
  await expect(pick.getByRole('button', { name: /지우기/ })).toHaveCount(0);
  await expect(pick.getByRole('button', { name: '가슴 30분 편집' })).toBeVisible();
  await expect(pick.getByRole('button', { name: '하체 45분 편집' })).toBeVisible();
  await checkScreen(page, '57-workout-pick');
  // 편집 → 루틴 편집 화면 → "← 운동"으로 운동 탭(루틴 고르기)에 돌아감
  await pick.getByRole('button', { name: '하체 45분 편집' }).click();
  await expect(page).toHaveURL(/#\/routine\//);
  await expect(page.getByLabel('루틴 이름')).toHaveValue('하체 45분');
  await expect(page.getByRole('button', { name: '운동', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '홈', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '운동', exact: true }).click();
  await expect(page).toHaveURL(/#\/workout/);
  await expect(page.getByRole('heading', { name: '루틴 고르기' })).toBeVisible();
  await pick.getByRole('button', { name: '가슴 30분 시작' }).click();
  await expect(page.getByRole('heading', { name: '가슴 30분' })).toBeVisible();
  await endWorkout(page);
  // 기록은 남음: 지운 루틴으로 한 운동도 기록 탭에 그대로
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('하체 45분').first()).toBeVisible();
});
test('직접 추가한 운동을 플랜에서 교체로 쓰기, 설정의 기본 휴식', async ({ page }) => {
  await page.getByRole('link', { name: '종목' }).click();
  await page.getByRole('button', { name: '운동 직접 추가' }).click(); // 제목 줄 원형 + 버튼 (0.9.3 검토)
  await page.getByLabel('운동 이름').fill('우리 헬스장 로우 머신');
  await page.getByLabel('부위').selectOption('등');
  await page.getByLabel('종류').selectOption('compound');
  await touchTargets(page);
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '등');
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
  await page.getByRole('button', { name: '해머 컬 목표 횟수 늘리기', exact: true }).click();
  await expect(page.getByText('13회', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /다음 운동과 슈퍼세트로 묶기/ }).click();
  await expect(page.getByText('슈퍼세트', { exact: true })).toBeVisible();
  await expect(page.getByText('묶음 안 전환')).toBeVisible();
  await checkScreen(page, '09-routine-editor');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '팔 루틴' })).toBeVisible();
  await expect(page.getByText(/약 \d+분/).first()).toBeVisible();
});

test('루틴 편집 (D-052): 부위 눌러 추가, 모든 운동·이 묶음 세트·횟수', async ({ page }) => {
  await page.getByRole('button', { name: '+ 직접' }).click();
  await page.getByLabel('루틴 이름').fill('부위 추가 루틴');
  for (const q of ['해머 컬', '로프 푸시다운']) {
    await page.getByRole('button', { name: '+ 운동 추가', exact: true }).click();
    await page.getByLabel('운동 검색').fill(q);
    await page.getByRole('dialog').getByRole('button').filter({ hasText: q }).first().click();
  }
  const parts = page.getByRole('group', { name: '부위별 운동 추가' });
  // 들어 있는 부위는 켜지고 운동 수가 보임, 없는 부위는 그냥 이름
  const biceps = parts.getByRole('button', { name: /^이두 운동 추가/ });
  await expect(biceps).toHaveClass(/\bon\b/);
  await expect(biceps).toHaveText('이두 · 1');
  await expect(biceps).toHaveAttribute('aria-label', '이두 운동 추가 (지금 1개)');
  await expect(biceps).not.toHaveAttribute('aria-pressed', /.*/);
  const chest = parts.getByRole('button', { name: /^가슴 운동 추가/ });
  await expect(chest).toHaveText('가슴');
  await expect(chest).not.toHaveClass(/\bon\b/);
  // 가슴 누르기 → 가슴으로 열림 → 첫 운동 고르기
  await chest.click();
  const dlg = page.getByRole('dialog', { name: '운동 추가', exact: true });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('group', { name: '모든 부위' }).getByRole('button', { name: '가슴', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const first = dlg.locator('.list-item').first();
  await expect(first).toContainText('가슴');
  const nm = (await first.getAttribute('aria-label'))!;
  await first.click();
  await expect(page.getByRole('button', { name: `${nm} 세트 늘리기`, exact: true })).toBeFocused();
  await expect(page.locator('p.sr-only[aria-live="polite"]')).toContainText(`${nm}: 추가했어요`);
  await expect(parts.getByRole('button', { name: /^가슴 운동 추가/ })).toHaveText('가슴 · 1');
  // 기억된 부위(마지막으로 고른 부위)는 부위 버튼으로는 바뀌지 않음
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('picker.part')).length)).toBe(0);
  // 앞의 두 운동 묶기
  await page.getByRole('button', { name: /다음 운동과 슈퍼세트로 묶기/ }).first().click();
  const cards = page.locator('main .card');
  await expect(cards).toHaveCount(2);
  const sets = async (c: Locator) => (await c.locator('span:not(.val)').filter({ hasText: /^\d+세트$/ }).allTextContents()).map((x) => parseInt(x, 10));
  const g0 = await sets(cards.nth(0)), o0 = await sets(cards.nth(1));
  // 묶음 카드에는 이 묶음 세트·횟수가 항상 보이고, 단일 카드에는 없음
  await expect(cards.nth(0).getByText('이 묶음 세트', { exact: true })).toBeVisible();
  await expect(cards.nth(1).getByText('이 묶음 세트', { exact: true })).toHaveCount(0);
  await cards.nth(0).getByRole('button', { name: /세트 모두 늘리기$/ }).click();
  expect(await sets(cards.nth(0))).toEqual(g0.map((x) => x + 1));
  expect(await sets(cards.nth(1))).toEqual(o0);
  await expect(page.locator('p.sr-only[aria-live="polite"]')).toContainText('묶음 운동 2개 세트 +1');
  // 이 묶음 횟수 -1
  const reps = async (c: Locator) => (await c.locator('span:not(.val)').filter({ hasText: /^\d+회$/ }).allTextContents()).map((x) => parseInt(x, 10));
  const gr0 = await reps(cards.nth(0)), or0 = await reps(cards.nth(1));
  await cards.nth(0).getByRole('button', { name: /횟수 모두 줄이기$/ }).click();
  expect(await reps(cards.nth(0))).toEqual(gr0.map((x) => x - 1));
  expect(await reps(cards.nth(1))).toEqual(or0);
  // 모든 운동 세트 +1: 전부 바뀜
  const g1 = await sets(cards.nth(0)), o1 = await sets(cards.nth(1));
  await page.getByRole('button', { name: '모든 운동 세트 늘리기' }).click();
  expect(await sets(cards.nth(0))).toEqual(g1.map((x) => x + 1));
  expect(await sets(cards.nth(1))).toEqual(o1.map((x) => x + 1));
  await expect(page.locator('p.sr-only[aria-live="polite"]')).toContainText('운동 3개 세트 +1');
  await expect(page.getByRole('group', { name: '모든 운동 세트', exact: true }).locator('.val')).toHaveText(/^\d+(~\d+)?세트$/);
  const finalG = await sets(cards.nth(0)), finalO = await sets(cards.nth(1));
  const finalGr = await reps(cards.nth(0));
  await checkScreen(page, '63-routine-part-add');
  // 저장 → 다시 편집: 값 유지
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await routineMenu(page, '부위 추가 루틴', '편집');
  await expect(page.getByRole('button', { name: '홈', exact: true })).toBeVisible(); // 홈·내 루틴에서 연 편집은 홈으로
  const cards2 = page.locator('main .card');
  await expect(cards2).toHaveCount(2);
  expect(await sets(cards2.nth(0))).toEqual(finalG);
  expect(await sets(cards2.nth(1))).toEqual(finalO);
  expect(await reps(cards2.nth(0))).toEqual(finalGr);
});

test('시간이 너무 짧으면 이유를 보여줌, 부위 없이 만들 수 없음', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await expect(page.getByRole('button', { name: '부위를 먼저 고르세요' })).toBeDisabled();
  for (const p of ['하체', '등', '가슴']) await pickPart(page, p);
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
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '해머 컬 세트 줄이기', exact: true }).click(); // 해머 컬 1세트
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
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '바벨 컬 세트 줄이기', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await page.getByLabel('바벨 컬 1세트 무게', { exact: true }).fill('30');
  // 현재 세트 펼침은 2줄 (① kg·회 −/+ · 원판, ② RIR · 메모) → 세트 줄 포함 3줄 이하 (iPhone 13 폭)
  const det = page.locator('.set-detail').filter({ has: page.getByRole('button', { name: '바벨 컬 1세트 원판 계산' }) });
  const tops = await det.getByRole('button').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
  expect(tops.length).toBeLessThanOrEqual(2);
  for (const bb of await det.getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(bb).toBeGreaterThanOrEqual(44);
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
  await expect(page.getByTestId('this-week')).toContainText('1회');
  // D-054: 일요일 시작 달력, 이번 주 요일 띠(7칸, 운동한 날 표시), 월 회수
  await expect(page.locator('.cal-wd').first()).toHaveText('일');
  await expect(page.locator('.cal-wd').nth(6)).toHaveText('토');
  const dayStrip = page.getByRole('list', { name: '이번 주 운동한 날' }).getByRole('listitem');
  await expect(dayStrip).toHaveCount(7);
  await expect(dayStrip.first()).toContainText('일');
  await expect(dayStrip.last()).toContainText('토');
  await expect(page.locator('.daydot.did')).toHaveCount(1);
  await expect(page.locator('.daydot.did')).toHaveAttribute('aria-label', /운동함/);
  await expect(page.getByText(/이번 달 1회/)).toBeVisible();
  const d = new Date();
  const todayBtn = page.getByRole('button', { name: `${d.getMonth() + 1}월 ${d.getDate()}일 운동 1회` });
  await expect(todayBtn).toBeEnabled();
  await todayBtn.click();
  await expect(page.getByRole('button', { name: /팔 테스트/ }).first()).toBeVisible();
  // 부위별 세트: 이두 줄에 1세트, 열 지도, 운동 기록 카드에 종목 줄(최고)
  await expect(page.getByTestId('part-row').filter({ hasText: '이두' })).toContainText('1세트');
  await expect(page.getByTestId('bodyheat')).toBeVisible();
  await expect(page.getByTestId('bodyheat').locator('svg')).toHaveCount(2); // 앞·뒤 나란히
  await expect(page.getByRole('button', { name: /^팔 테스트,.*세트 1,.*바벨 컬 1세트 최고 30kg × 10회/ }).first()).toBeVisible(); // 카드 요약 이름
  await expect(page.getByRole('group', { name: /부위별 세트 열 지도: .*이두 1세트/ })).toBeVisible();
  const wcard = page.getByRole('button', { name: /팔 테스트/ }).first();
  await expect(wcard).toContainText('바벨 컬 · 1세트 · 최고 30kg × 10회');
  // 빈 주: 이전 주로 가면 안내 문구, 다시 이번 주로
  await page.getByRole('button', { name: '이전 주' }).click();
  await expect(page.getByText('이 주에는 운동 기록이 없어요')).toBeVisible();
  await expect(page.getByTestId('part-row')).toHaveCount(0);
  await page.getByRole('button', { name: '다음 주' }).click();
  await expect(page.getByTestId('part-row').first()).toBeVisible();
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
  await expect(page.getByLabel('PC로 보내기 상태')).toContainText('PC로 보냄');
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
  await routineMenu(page, '예전 루틴', '지우기');
  await answer(page, '완전 삭제');
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
  await page.locator('.routine-card').first().getByRole('button', { name: / 메뉴$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: / 편집$/ }).click();
  await page.getByLabel('루틴 이름').fill('PC에서 짠 루틴');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '설정' }).click();
  await page.getByRole('button', { name: '지금 동기화' }).click();
  await expect(page.getByLabel('PC와 폰 동기화')).toContainText('인터넷에 연결되지 않았어요');
  down = false;
  await syncNowOn(page); await syncNowOn(pc);
  // PC에서 루틴 지움 → 폰에서도 사라짐
  await pc.getByRole('link', { name: '홈' }).click();
  await routineMenu(pc, 'PC에서 짠 루틴', '지우기');
  await answer(pc, '완전 삭제');
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
  await pickPart(pc, '등');
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
  await expect(pc.getByText(/^1\/\d+세트$/)).toBeVisible(); // 세트 수는 플랜 규칙(D-041)에 따라 바뀜
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
  await expect(pc.getByText(/^[12]\/\d+세트$/)).toBeVisible();
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
  const card = page.getByRole('group', { name: /^최근 운동 / }).first();
  await expect(card).toContainText('세트 1');
  // 카드 누르면 상세
  await card.locator('button.wcard').click();
  await expect(page).toHaveURL(/#\/stats\/w\//);
  await page.getByRole('link', { name: '홈' }).click();
  // 수정
  await recentMenu(card, '수정');
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
  await expect(page.getByText(/45분/)).toBeVisible();
  // 홈 카드에도 반영, 그리고 삭제
  await page.getByRole('link', { name: '홈' }).click();
  const card2 = page.getByLabel('최근 운동 등 (고침)', { exact: true });
  await expect(card2).toContainText('세트 2'); await expect(card2).toContainText('45분'); await expect(card2).toContainText('고침');
  // 삭제 → 두 갈래 (D-040). 닫기·Esc는 아무것도 안 함, 처음 초점은 안전한 "목록에서만 빼기"
  const del2 = { click: async () => { await card2.getByRole('button', { name: '최근 운동 등 (고침) 메뉴' }).click(); await card2.getByRole('button', { name: '최근 운동 등 (고침) 삭제' }).click(); } };
  const sheet = page.locator('.sheet[aria-modal="true"]');
  await del2.click();
  await expect(sheet.getByRole('heading', { name: '이 운동을 어떻게 할까요?' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '목록에서만 빼기', exact: true })).toBeFocused();
  await expect(sheet.getByRole('button', { name: '완전 삭제', exact: true })).toHaveClass(/danger-fill/);
  await noHorizontalScroll(page);
  await checkScreen(page, '34-recent-delete-choice');
  await page.keyboard.press('Escape');
  await expect(card2).toBeVisible();
  // 1) 목록에서만 빼기 → 홈에서 사라짐, 기록 탭·통계에는 그대로("홈에서 뺌" 표시)
  await del2.click();
  await answer(page, '목록에서만 빼기');
  await expect(card2).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '홈에서 뺐어요' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '최근 운동' })).toHaveCount(0);
  await page.getByRole('link', { name: '기록' }).click();
  const row = page.getByRole('button', { name: /^등 \(고침\),.*\(홈에서 뺌\)$/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('홈에서 뺌');
  await expect(page.getByText('아직 끝낸 운동이 없어요')).toHaveCount(0);
  // 고쳐도 "홈에서 뺌"은 유지
  await row.click();
  await expect(page.getByLabel('홈에서 뺌 기록')).toBeVisible();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('운동 이름').fill('등 (고침)2');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '등 (고침)2' })).toBeVisible();
  await expect(page.getByLabel('홈에서 뺌 기록')).toBeVisible();
  // 2) 기록 상세에서 "홈에 다시 보이기" → 홈에 다시 나타남
  await page.getByRole('button', { name: '홈에 다시 보이기' }).click();
  await expect(page.getByLabel('홈에서 뺌 기록')).toHaveCount(0);
  await page.getByRole('link', { name: '홈' }).click();
  const card3 = page.getByLabel('최근 운동 등 (고침)2', { exact: true });
  await expect(card3).toBeVisible();
  // 3) 완전 삭제 → 기록 탭에서도 사라짐
  await recentMenu(card3, '삭제');
  await answer(page, '완전 삭제');
  await expect(card3).toHaveCount(0);
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
  await page.getByRole('group', { name: /^최근 운동 / }).first().getByRole('button', { name: / 메뉴$/ }).click();
  await page.getByRole('button', { name: /^최근 운동 .* 수정$/ }).click();
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
  const card = page.getByRole('group', { name: /^최근 운동 / }).first();
  const before = await card.textContent();
  await recentMenu(card, '수정');
  await page.getByLabel('운동 이름').fill('바뀌면 안 됨');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await answer(page, '버리기');
  await expect(page).toHaveURL(/#\/stats\/w\//);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('group', { name: /^최근 운동 / }).first()).toHaveText(before!);
});

void makeRoutine;

test('앱 안 확인 창 (D-039): 삭제는 취소·Esc·닫기·화면 이동이면 그대로 / 동기화 중 초기화·불러오기 두 갈래: 닫으면 아무것도 안 바꿈, "이 기기만"은 동기화 끄고 진행', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  await makeRoutine(page, ['등'], '30분');
  const del = { click: () => routineMenu(page, '등 30분', '지우기') }; // D-055: ⋯ 안의 [지우기]
  const card = page.getByRole('heading', { name: '등 30분', exact: true });
  const sheet = page.locator('.sheet[aria-modal="true"]');
  const syncOn = () => page.evaluate(() => localStorage.getItem('sync.on'));

  // 1) 지우기 (D-048): 처음 초점은 되돌릴 수 있는 "목록에서만 숨기기"(Enter 한 번으로 완전 삭제되지 않음)·Esc·✕·화면 이동은 그대로
  await del.click();
  await expect(sheet.getByRole('heading', { name: '이 루틴을 어떻게 할까요?' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '목록에서만 숨기기', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); // Enter 한 번 = 되돌릴 수 있는 숨기기 (완전 삭제 아님)
  await expect(sheet).toHaveCount(0);
  await expect(card).toHaveCount(0);
  // 카드가 사라졌으니 초점은 아래 알림의 [되돌리기]로
  await expect(page.locator('.toast').getByRole('button', { name: '되돌리기' })).toBeFocused();
  await page.locator('.toast').getByRole('button', { name: '되돌리기' }).click();
  await expect(card).toBeVisible();
  await expect(page.locator('.toast')).toContainText('다시 보이게 했어요');
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
  await answer(page, '완전 삭제');
  await expect(card).toHaveCount(0);
});

test('기록 고치기 저장 (D-039): 고치는 동안 다른 기기에서 바뀌면 묻고, 묻는 동안 또 바뀌면 다시 물음 / 지워졌으면 되살려 저장', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: /시작/ }).first().click();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page).toHaveURL(/#\/$/);
  const card = page.getByRole('group', { name: /^최근 운동 / }).first();
  await card.locator('button.wcard').click();
  const id = decodeURIComponent(page.url().split('/').pop()!);
  await page.getByRole('link', { name: '홈' }).click();
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
  await recentMenu(card, '수정');
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
  await pickPart(page, '이두');
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
  const est0 = await estMetric(planSec).textContent();
  await planSec.getByRole('button', { name: `${first} 횟수 줄이기` }).click();
  await expect(repsBox).toContainText(`${reps0 + 1}회`);
  expect(await estMetric(planSec).textContent(), '횟수를 바꾸면 예상 시간도 다시 계산').not.toBe(est0);

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
  // 내 운동 DB가 없는 운동(벤트오버 리어 델트 플라이는 영상 등급·자세 포인트 없음. 프론트 레이즈는 M-30 어깨 영상 반영 때 자세 포인트가 생겨 바꿈) → 흐린 기본 "정보": 운동 추가로 넣어 확인
  await page.getByRole('button', { name: /운동 추가/ }).first().click();
  await page.getByRole('dialog').getByLabel('운동 검색').fill('벤트오버');
  await page.getByRole('dialog').getByRole('button', { name: /벤트오버 리어 델트 플라이/ }).first().click();
  await page.getByRole('button', { name: /^벤트오버 리어 델트 플라이 (세트 간|라운드 후) 휴식/ }).first().click();
  const plain = page.getByRole('link', { name: '벤트오버 리어 델트 플라이 정보 (DB 없음)' });
  await expect(plain).toBeVisible();
  await expect(plain).not.toHaveClass(/info-db/);
  await plain.locator('xpath=..').screenshot({ path: `reports/screens/${test.info().project.name}-23-info-plain.png` });
  await checkScreen(page, '21-workout-info');
});

test('플랜 바로 고치기 (D-036): 시간 운동 초 −/+ 가 예상 시간에 반영, 잠금 다시 생성해도 바꾼 횟수·다른 부위 추가 운동 유지', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '이두');
  await page.getByRole('button', { name: '60분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  const est = async () => { const t = (await estMetric(planSec).textContent())!; const m = t.match(/(\d+):(\d{2})/)!; return Number(m[1]) * 60 + Number(m[2]); };

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
  await pickPart(page, '이두');
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
  await routineMenu(page, '끌기 루틴', '편집');
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

test('기록 탭 빈 이번 주 (D-054): 지난주에만 운동이 있으면 안내·지난주 요약·"운동 시작" → 운동 화면, 타일 증감 한 줄', async ({ page }) => {
  // 지난주 일요일 10시에 끝난 운동 하나를 저장소에 직접 넣음 (이번 주 일~토와 겹치지 않음)
  await page.evaluate(async () => {
    const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() - 7, 10, 0);
    const w = { id: 'w-lastweek', name: '지난주 팔', startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 30 * 60000).toISOString(), timer: null,
      blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'barbell_curl', target: { sets: 1, reps: 10 }, sets: [{ weight: 30, reps: 10, warmup: false, done: true }] }] }] };
    await new Promise<void>((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('workouts', 'readwrite'); tx.objectStore('workouts').put(w); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); });
  });
  await page.reload();
  await page.getByRole('link', { name: '기록' }).click();
  await expect(page.getByText('이번 주는 아직 운동이 없어요')).toBeVisible();
  await expect(page.getByText('지난주: 이두 1세트')).toBeVisible();
  await expect(page.getByTestId('part-row')).toHaveCount(0);
  await expect(page.getByTestId('this-week')).toContainText('지난주 같은 요일');
  // 타일 증감은 한 줄 (390px)
  const hs = await page.locator('.tile-delta').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(hs).toHaveLength(4);
  for (const h of hs) expect(h, '타일 증감 줄 높이(한 줄)').toBeLessThan(24);
  await checkScreen(page, '10b-stats-empty-week');
  await page.getByRole('button', { name: '운동 시작' }).click();
  await expect(page).toHaveURL(/#\/workout/);
});

// ===== D-055 디자인 1단계: 업데이트 안내·틀 =====
test('D-055 탭 5개·위 원형 버튼·빈 홈, 새로 바뀐 점(예전 버전에서 올라왔을 때)·보러 가기·새 기능 점, 앱 정보, version.json', async ({ page }) => {
  // 처음 설치: 시트 없이 지금 버전만 저장 (이 기기 localStorage)
  await expect(page.getByRole('dialog', { name: '새로 바뀐 점' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('app.lastSeenVersion'))).toBe(APP_VERSION);
  // 아래 탭은 정확히 5개, 설정·개선은 제목 줄 오른쪽 원형 버튼
  const nav = page.getByRole('navigation', { name: '주 메뉴' });
  await expect(nav.getByRole('link')).toHaveCount(5);
  await expect(nav.getByRole('link')).toHaveText(['홈', '플랜', '운동', '기록', '종목']);
  await expect(nav.getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: '설정', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '개선 메모 쓰기' })).toBeVisible();
  // 빈 홈: "이번 주"는 -- + 아직 기록 없음, 다음 운동은 빈 카드 + 플랜 만들기
  await expect(page.getByRole('heading', { name: '오늘', exact: true })).toBeVisible();
  await expect(page.getByTestId('home-week')).toContainText('--');
  await expect(page.getByTestId('home-week')).toContainText('아직 기록 없음');
  await expect(page.getByRole('region', { name: '다음 운동' })).toContainText('아직 루틴이 없어요');
  await checkScreen(page, '64-home-empty');
  // 빈 기록 탭
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByText('아직 끝낸 운동이 없어요')).toBeVisible();
  await page.getByRole('link', { name: '홈', exact: true }).click();

  // version.json: 빌드 때 생성, 지금 버전·바뀐 점 (서비스 워커가 저장하지 않음)
  const vj = await (await page.request.get('./version.json')).json();
  expect(vj.version).toBe(APP_VERSION);
  expect(vj.changes.length).toBeGreaterThan(0);
  expect(vj.changes.length).toBeLessThanOrEqual(5);

  // 예전 버전(0.8.12)에서 올라온 것처럼 → 시트: 0.9.0 + 0.8.13 (최신 먼저), 확인에 초점
  await seedNextLoad(page, { 'app.lastSeenVersion': '0.8.12-preview' });
  await page.reload();
  const sheet = page.getByRole('dialog', { name: '새로 바뀐 점' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  const entries = sheet.locator('.wn-entry');
  await expect(entries.first()).toHaveAttribute('aria-label', `${SHOWN_VERSION} 바뀐 점`);
  await expect(entries.nth(1)).toHaveAttribute('aria-label', '0.9.4 바뀐 점'); // 0.9.5(3줄) + 0.9.4(3줄) + 0.9.3(2줄) = 8줄
  await expect(sheet.locator('.wn-lines li')).toHaveCount(8); // 최대 8줄 + 모두 보기
  await expect(sheet.getByRole('button', { name: /^모두 보기/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '확인' })).toBeFocused();
  await checkScreen(page, '65-whats-new');
  await sheet.getByRole('button', { name: /^모두 보기/ }).click();
  await expect(sheet.locator('.wn-lines li')).toHaveCount(28); // 0.9.5·0.9.4 3줄 + 0.9.3 2줄 + 0.9.2·0.9.1·0.9.0·0.8.13 각 5줄
  // 다시 열면 안 뜸 (본 버전 저장)
  expect(await page.evaluate(() => localStorage.getItem('app.lastSeenVersion'))).toBe(APP_VERSION);
  // [보러 가기] → 그 화면(앱 정보)으로 가고 시트는 닫힘
  // 0.8.12 에서 올라옴 → 점 2개: 앱 정보(설정 버튼)·기록 탭 (0.8.13 where #/stats)
  const statsTab = page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '기록' });
  await expect(statsTab).toHaveAttribute('aria-describedby', 'new-dot-desc');
  await sheet.getByRole('button', { name: '0.9.0 바뀐 곳 보러 가기' }).click(); // 0.9.0 의 where = 앱 정보
  await expect(page).toHaveURL(/#\/settings\/about$/);
  await expect(sheet).toHaveCount(0);
  // 앱 정보: 버전 칩(본판), 마지막 업데이트 날짜, 버전별 바뀐 점(최신만 펼침), 오픈소스 고지
  await expect(page.getByRole('heading', { name: '앱 정보' })).toBeVisible();
  await expect(page.getByTestId('about-version')).toHaveText(SHOWN_VERSION);
  await expect(page.getByTestId('about-edition')).toHaveText('판: 본판');
  await expect(page.getByLabel('지금 버전')).toContainText(`빌드 이름 ${APP_VERSION}`);
  await expect(page.getByLabel('지금 버전')).toContainText('마지막 업데이트');
  await expect(page.locator('details.cl-item[open]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '오픈소스 고지' })).toBeVisible();
  await page.getByRole('button', { name: '새 버전 확인' }).click();
  await expect(page.getByLabel('지금 버전').getByRole('status')).toHaveText(`지금 최신 버전이에요 (${SHOWN_VERSION})`); // 서버 version.json 과 비교
  // 기록 탭 점: 앱 정보를 열어도 그대로, 기록 탭을 열면 사라짐 (where 마다 따로)
  await expect(statsTab.locator('.ndot')).toHaveCount(1);
  await statsTab.click();
  await expect(statsTab.locator('.ndot')).toHaveCount(0);
  await page.goto('./#/settings/about');
  await checkScreen(page, '66-about');
  await page.reload();
  await expect(page.getByRole('heading', { name: '앱 정보' })).toBeVisible(); // 앱이 뜬 뒤에 (뜨기 전 '시트 없음'은 의미 없음)
  await expect(page.getByRole('dialog', { name: '새로 바뀐 점' })).toHaveCount(0);

  // 새 기능 점: 0.9.0의 where(#/settings/about) → 설정 버튼에 점. 설정만 열면 그대로("앱 정보" 줄에 "새"), 앱 정보를 열어야 사라짐. Esc로 시트 닫기
  await page.goto('./#/');
  await seedNextLoad(page, { 'app.lastSeenVersion': '0.8.13-preview', 'app.newDots': null });
  await page.reload();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.wn-entry')).toHaveCount(3); // 0.9.5(3줄) + 0.9.4(3줄) + 0.9.3(2줄) = 8줄, 0.9.2 이전은 [모두 보기]
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const gear = page.getByRole('link', { name: '설정', exact: true });
  await expect(gear.locator('.ndot')).toHaveCount(1);
  await expect(gear).toHaveAttribute('aria-describedby', 'new-dot-desc');
  await expect(page.getByRole('navigation', { name: '주 메뉴' }).locator('.ndot')).toHaveCount(2); // 0.9.2 = 기록 탭, 0.9.1 = 운동 탭 (0.9.3 = 홈, 지금 홈이라 점 없음), 0.9.0 은 탭이 아니라 설정 버튼
  await gear.click();
  const aboutRow = page.getByRole('link', { name: /앱 정보·업데이트 내역/ });
  await expect(aboutRow).toContainText('새');
  await expect(aboutRow).toHaveAttribute('aria-label', /새 기능 있음/);
  await checkScreen(page, '71-settings-new');
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(gear.locator('.ndot')).toHaveCount(1); // 설정만 열어서는 안 지워짐
  await gear.click();
  await aboutRow.click();
  await expect(page.getByRole('heading', { name: '앱 정보' })).toBeVisible();
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.getByRole('link', { name: '설정', exact: true }).locator('.ndot')).toHaveCount(0);
  await page.getByRole('link', { name: '설정', exact: true }).click();
  await expect(aboutRow).not.toHaveAttribute('aria-label', /새 기능 있음/);
});

test('D-055 0.8.x 에서 올라옴: 마지막 본 버전 기록이 없고 루틴이 있으면 "새로 바뀐 점"(이번 버전만)을 보여 줌', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await seedNextLoad(page, { 'app.lastSeenVersion': null, 'app.newDots': null });
  await page.reload();
  const sheet = page.getByRole('dialog', { name: '새로 바뀐 점' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.wn-entry')).toHaveCount(1);
  await expect(sheet.locator('.wn-entry')).toHaveAttribute('aria-label', `${SHOWN_VERSION} 바뀐 점`);
  await sheet.getByRole('button', { name: '확인' }).click();
  expect(await page.evaluate(() => localStorage.getItem('app.lastSeenVersion'))).toBe(APP_VERSION);
  await page.reload();
  await expect(sheet).toHaveCount(0);
});

test.describe('D-055 실제 업데이트 경로 (흉내 이벤트 없이 서버 version.json 비교)', () => {
  // 서비스 워커를 막아 version.json 요청이 페이지에서 바로 나가게 함 (가로채기 가능). 대기 워커가 없으니 [지금 적용] = 새로 고침 경로
  test.use({ serviceWorkers: 'block' });
  test('서버가 더 새 버전(9.9.9)이면 배너 + 앱 정보 "새 버전 9.9.9가 있어요", 적용은 한 번만 새로 고침(무한 새로 고침 없음)', async ({ page }) => {
    await page.route('**/version.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9-preview', date: '2026-12-01', changes: ['서버에 올라온 새 기능', '둘째'] }) }));
    await page.reload();
    const banner = page.getByRole('status', { name: '새 버전 안내' });
    await expect(banner).toContainText('새 버전 9.9.9 준비됨');
    await expect(banner).toContainText('서버에 올라온 새 기능');
    await checkScreen(page, '72-update-banner-real');
    await banner.getByRole('button', { name: '나중에' }).click();
    await expect(banner).toHaveCount(0);
    // 앱 정보 [새 버전 확인]: 서버와 비교해 새 버전이라고 답하고 [지금 적용]
    await page.goto('./#/settings/about');
    await page.getByRole('button', { name: '새 버전 확인' }).click();
    const card = page.getByLabel('지금 버전');
    await expect(card.getByRole('status')).toHaveText('새 버전 9.9.9가 있어요');
    await expect(banner).toBeVisible(); // 확인하면 [나중에] 로 숨긴 배너도 다시
    // 적용 → 새로 고침 1번 (아직 옛 버전이 오면 다시 배너) → 두 번째 적용은 새로 고치지 않고 안내
    let loads = 0; page.on('load', () => { loads++; });
    await banner.getByRole('button', { name: '지금 적용' }).click();
    await expect.poll(() => loads).toBe(1);
    await expect(banner).toContainText('새 버전 9.9.9 준비됨');
    await banner.getByRole('button', { name: '지금 적용' }).click();
    await expect(banner.getByRole('alert')).toContainText('아직 새 버전을 받지 못했어요');
    await page.waitForTimeout(500);
    expect(loads).toBe(1);
    // 서버가 같은 버전이면 "최신"
    await page.unroute('**/version.json');
    await page.goto('./#/settings/about');
    await page.getByRole('button', { name: '새 버전 확인' }).click();
    await expect(card.getByRole('status')).toHaveText(`지금 최신 버전이에요 (${SHOWN_VERSION})`);
  });
});

test('D-055 sw.js 는 빌드 이름(버전 포함)을 담음 (배포마다 바뀌어 새 서비스 워커가 설치됨)', async ({ page }) => {
  const sw = await (await page.request.get('./sw.js')).text();
  expect(sw).toContain(`const BUILD = '${APP_VERSION}+`);
  expect(sw).not.toContain('__BUILD__');
  expect(sw).toContain("if (new URL(req.url).pathname.endsWith('/version.json')) return;"); // version.json 은 저장하지 않음
});

test('D-055 새 버전 배너: 버전·바뀐 점 한 줄·[지금 적용][나중에], 파일을 못 읽으면 "새 버전이 있어요", 운동 중엔 작게·확인 후 적용', async ({ page }) => {
  // 시험 표시(__wkTest)를 세운 뒤에만 흉내 이벤트가 먹힘 (본판에서 우연히 뜨지 않게)
  const sim = (detail: unknown) => page.evaluate((d) => { (window as Window & { __wkTest?: boolean }).__wkTest = true; window.dispatchEvent(new CustomEvent('app:sim-update', { detail: d })); }, detail);
  // 표시 없이 보낸 이벤트는 무시됨
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('app:sim-update', { detail: { version: '9.9.9', changes: ['x'] } })));
  await expect(page.getByRole('status', { name: '새 버전 안내' })).toHaveCount(0);
  await sim({ version: '0.9.9-preview', date: '2026-10-07', changes: ['운동 중 화면 새 모양', '둘째 줄'] });
  const banner = page.getByRole('status', { name: '새 버전 안내' });
  await expect(banner).toContainText('새 버전 0.9.9 준비됨');
  await expect(banner).toContainText('운동 중 화면 새 모양');
  await expect(banner).not.toContainText('둘째 줄');
  await expect(banner.getByRole('button', { name: '지금 적용' })).toBeVisible();
  await checkScreen(page, '67-update-banner');
  await banner.getByRole('button', { name: '나중에' }).click();
  await expect(banner).toHaveCount(0);
  await sim(null); // version.json 읽기 실패
  await expect(banner).toContainText('새 버전이 있어요');
  // 운동 중: 작은 한 줄, [적용]은 확인 창을 거침 (취소하면 그대로)
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('button', { name: '등 30분 시작' }).click();
  await expect(banner).toHaveCount(0); // 운동 화면에서는 숨김
  await expect(page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '운동' })).toHaveAttribute('aria-describedby', 'wk-dot-desc'); // 운동 중 점
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(banner).toContainText('새 버전 준비됨');
  await banner.getByRole('button', { name: '적용' }).click();
  await expect(page.getByRole('dialog', { name: '운동 중이에요' })).toBeVisible();
  await answer(page, '취소');
  await expect(banner).toBeVisible();
});

test('D-055 홈: 이번 주·다음 운동 [▶ 시작], 루틴 ⋯ 창(편집·지우기, Esc·초점 되돌림), 최근 운동은 기록 탭과 같은 카드', async ({ page }) => {
  await makeRoutine(page, ['등'], '30분');
  await page.getByRole('link', { name: '홈', exact: true }).click();
  const next = page.getByRole('region', { name: '다음 운동' });
  await expect(next).toContainText('등 30분');
  await next.getByRole('button', { name: '다음 운동으로 시작: 등 30분' }).click();
  await expect(page.getByRole('heading', { name: '등 30분', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await expect(page.getByTestId('home-week')).toContainText('1회');
  await expect(page.getByTestId('home-week')).toHaveAttribute('href', '#/stats');
  // 다음 운동 (앱 판단): 하나뿐인 루틴을 오늘 했으면 그대로 보이고 이유 줄 "오늘 이미 했어요"
  await expect(next).toContainText('오늘 이미 했어요');
  // 390×844 첫 화면: 백업 알림은 다음 운동 아래, [▶ 시작]은 탭 바 위에 다 보임 (검토 A3)
  // 재기 전에 초점·스크롤이 가라앉게 (Chromium 모바일 흉내에서 한 번 탭 바 위치가 흔들린 적 있음)
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  const backup = page.getByRole('note', { name: '백업 알림' });
  await expect(backup).toBeVisible();
  const startBox = (await next.getByRole('button', { name: /^다음 운동으로 시작/ }).boundingBox())!;
  const navBox = (await page.locator('nav.nav').boundingBox())!;
  expect(startBox.y + startBox.height, '[▶ 시작] 아래 끝 < 탭 바 위 끝').toBeLessThan(navBox.y);
  expect((await backup.boundingBox())!.y).toBeGreaterThan(startBox.y);
  await expect(backup.getByRole('button', { name: '지금 백업' })).not.toHaveClass(/primary/);
  await expect(page.locator('.routine-card').first().locator('.next-tag')).toHaveText('다음 운동');
  // 최근 운동 = 기록 탭 카드(button.wcard) + ⋯
  const recent = page.getByRole('group', { name: '최근 운동 등 30분' });
  await expect(recent.locator('button.wcard')).toContainText('세트 1');
  // ⋯ → 편집·지우기 창, 처음 초점은 편집, Esc로 닫으면 ⋯ 버튼으로 초점
  const more = page.getByRole('button', { name: '등 30분 메뉴', exact: true });
  await more.focus(); await page.keyboard.press('Enter'); // 키보드로 열기 (WebKit은 누른 버튼에 초점을 주지 않음)
  const menu = page.getByRole('dialog', { name: '등 30분' });
  await expect(menu.getByRole('button', { name: '등 30분 편집' })).toBeFocused();
  await expect(menu.getByRole('button', { name: '등 30분 지우기' })).toBeVisible();
  await checkScreen(page, '68-routine-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await routineMenu(page, '등 30분', '편집');
  await expect(page.getByLabel('루틴 이름')).toHaveValue('등 30분');
  // 루틴 편집에서도 개선 메모·설정 원형 버튼 (예전엔 아래 메뉴에서 어디서든)
  await expect(page.getByRole('button', { name: '개선 메모 쓰기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '설정', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await checkScreen(page, '69-home');
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByRole('button', { name: /^등 30분,/ })).toContainText('세트 1');
  // 끝낸 운동 수정: 개선 메모는 있고 설정은 없음 (취소/저장으로만 떠남)
  await page.getByRole('link', { name: '홈', exact: true }).click();
  await recentMenu(page.getByRole('group', { name: '최근 운동 등 30분' }), '수정');
  await expect(page.getByRole('heading', { name: '운동 기록 수정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '개선 메모 쓰기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '설정', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '개선 메모 쓰기' }).click();
  await expect(page.getByRole('dialog', { name: '개선 메모' })).toBeVisible();
  await checkScreen(page, '70-workout-edit-feedback');
});

test('D-055 검토 R2: 서비스 워커를 켠 채 새 워커가 대기할 때, 서버 version.json 이 같은 버전이면 배너·새로 고침 없이 조용히 교체, 더 새로우면 배너 (배너 단계는 Chromium 만)', async ({ page, browserName }) => {
  type W = Window & { __cc?: number };
  // 서비스 워커가 화면을 맡을 때까지 (처음 설치 때의 한 번 새로 고침은 예전 동작 그대로)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  // 앱이 load 때 하는 자기 등록(sw.js)이 끝나 설치 중·대기 워커가 없을 때까지 (안 기다리면 그 등록이 배포 흉내 뒤에 와서 교체가 한 번 더 일어남)
  await page.waitForLoadState('load');
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r && !r.installing && !r.waiting && !!r.active?.scriptURL.endsWith('/sw.js'); }), { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as W).__cc = 0; navigator.serviceWorker.addEventListener('controllerchange', () => { (window as W).__cc!++; }); });
  let loads = 0; page.on('load', () => { loads++; });
  // 배포 흉내: 같은 범위에 스크립트 주소만 바꿔 다시 등록 → 브라우저가 새 워커를 설치해 대기시킴 (앱의 updatefound → installed → setWaiting 경로 그대로)
  // (Playwright 는 서비스 워커 스크립트 요청을 가로채지 못해 sw.js 내용을 바꾸는 대신 주소를 바꿈)
  const deploy = (n: number) => page.evaluate(async (k) => { await navigator.serviceWorker.register(`${location.pathname.replace(/[^/]*$/, '')}sw.js?deploy=${k}`); }, n);
  const banner = page.getByRole('status', { name: '새 버전 안내' });

  // 1) 서버 version.json = 지금 버전 (페이지가 이미 새 코드) → 조용히 새 워커로 바뀌고, 배너·새로 고침 없음
  await deploy(1);
  await expect.poll(() => page.evaluate(() => (window as W).__cc), { timeout: 15000 }).toBe(1);
  await page.waitForTimeout(800);
  expect(loads, '조용한 교체에서는 새로 고치지 않음').toBe(0);
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(false);

  // WebKit: 서비스 워커가 화면을 맡은 뒤의 version.json 요청은 Playwright 가로채기가 안 먹어 2) 는 Chromium 만 (1) 조용한 교체는 두 엔진 모두 시험)
  if (browserName !== 'chromium') return;
  // 2) 서버가 더 새 버전 → 새 워커가 대기하면 배너 "새 버전 9.9.9 준비됨" (적용 전에는 새로 고치지 않음)
  await page.context().route('**/version.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9-preview', date: '2026-12-01', changes: ['대기 워커 경로 시험'] }) }));
  await deploy(2);
  await expect(banner).toContainText('새 버전 9.9.9 준비됨', { timeout: 15000 });
  await expect(banner).toContainText('대기 워커 경로 시험');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(true);
  expect(loads).toBe(0);
  // [지금 적용] → 대기 워커로 바꾸고 한 번 새로 고침
  await banner.getByRole('button', { name: '지금 적용' }).click();
  await expect.poll(() => loads, { timeout: 15000 }).toBe(1);
});

// ===== D-055 2단계: 운동 중 화면 =====
test('D-055 2단계 운동 화면: 숫자 3개·세트 표(지난번)·완료 줄 초록·휴식 알약(고리·±15)·기록 갱신 배지·⋯ 메뉴·끝낼 때 갱신 알림', async ({ page }) => {
  await makeRoutine(page, ['이두'], '30분');
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(page).toHaveURL(/#\/workout/);
  // 위: 루틴 이름 + [끝내기], 숫자 3개 (시간·볼륨·세트)
  const metrics = page.getByRole('region', { name: '운동 진행' });
  await expect(metrics).toContainText('시간');
  await expect(metrics).toContainText('볼륨');
  await expect(metrics.getByText(/^0\/\d+세트$/)).toBeVisible();
  await expect(page.getByRole('button', { name: '끝내기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '개선 메모 쓰기' })).toBeVisible(); // 원형 버튼 유지
  // 세트 표 머리: 세트 | 지난번 | kg | 회 | ✓
  const first = page.locator('.wk-card').first();
  await expect(first.locator('.set-head').first()).toHaveText(/세트\s*지난번\s*kg\s*회/);
  const name = (await page.locator('input[aria-label$=" 1세트 무게"]').first().getAttribute('aria-label'))!.replace(/ 1세트 무게$/, '');
  await expect(page.getByLabel(`${name} 1세트 지난번 없음`)).toBeVisible(); // 처음 하는 운동
  // 1회차: 1세트 20kg × 10 완료 → 줄이 초록(done) + 휴식 알약
  await page.getByLabel(`${name} 1세트 무게`, { exact: true }).fill('20');
  await page.getByLabel(`${name} 1세트 횟수`, { exact: true }).fill('10');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  const row1 = first.locator('.set-row:not(.set-head)').first();
  await expect(row1).toHaveClass(/done/);
  await expect(row1.getByRole('button', { name: '완료 취소' })).toBeVisible();
  const pill = page.locator('.rest-pill');
  await expect(pill).toBeVisible();
  await expect(pill.locator('svg.ring circle.ring-fg')).toHaveCount(1);
  await expect(pill.getByRole('button', { name: '15초 줄이기' })).toBeVisible();
  await expect(pill.getByRole('button', { name: '15초 늘리기' })).toBeVisible();
  await expect(page.getByLabel(/휴식 남은 시간 \d+초/)).toBeVisible();
  // 알약은 아래 메뉴 위에 뜸 (겹치지 않음)
  const pb = (await pill.boundingBox())!; const nb = (await page.locator('nav.nav').boundingBox())!;
  expect(pb.y + pb.height).toBeLessThanOrEqual(nb.y);
  // 도크 하나: 휴식 중에는 알약 안에 둥근 ✓(현재 세트 완료), 도크+메뉴 ≤ 화면 높이 22% (844 → 185px)
  await expect(pill.getByRole('button', { name: '현재 세트 완료' })).toBeVisible();
  await expect(page.getByRole('button', { name: '현재 세트 완료' })).toHaveCount(1);
  const vh = page.viewportSize()!.height;
  const dock = (await page.locator('.timer').boundingBox())!;
  expect(vh - dock.y, '도크+메뉴 높이').toBeLessThanOrEqual(vh * 0.22);
  // 맨 아래까지 내리면 마지막 내용(운동 끝내기 버튼)이 도크 위로 올라옴 (가려지지 않음)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastBtn = (await page.getByRole('button', { name: '운동 끝내기', exact: true }).boundingBox())!;
  expect(lastBtn.y + lastBtn.height, '마지막 버튼 아래 끝 ≤ 도크 위 끝').toBeLessThanOrEqual((await page.locator('.timer').boundingBox())!.y);
  // 고리 = 남은 비율 (휴식 도중: 시계를 앞당겨 흉내)
  const total = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  const ringEl = pill.locator('svg.ring');
  expect(Number(await ringEl.getAttribute('data-fraction'))).toBeGreaterThan(0.9);
  await page.evaluate((ms) => { const o = Date.now.bind(Date); (window as Window & { __dn?: () => number }).__dn = o; Date.now = () => o() + ms; }, Math.round(total * 500));
  await expect.poll(async () => Number(await ringEl.getAttribute('data-fraction'))).toBeLessThan(0.6);
  const remMid = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
  expect(Math.abs(Number(await ringEl.getAttribute('data-fraction')) - remMid / total)).toBeLessThan(0.06);
  await page.evaluate(() => { const w = window as Window & { __dn?: () => number }; if (w.__dn) Date.now = w.__dn; });
  await checkScreen(page, '73-workout-rest-pill');
  await expect(metrics.getByText(/^1\/\d+세트$/)).toBeVisible();
  await expect(metrics).toContainText('200kg'); // 볼륨 20 × 10
  // 처음 하는 운동은 기록 갱신 없음
  await expect(page.locator('.pr-badge')).toHaveCount(0);
  // ⋯ 메뉴: 교체·건너뛰기·메모·정보 (원판은 바벨·스미스만)
  await page.getByRole('button', { name: `${name} 메뉴`, exact: true }).click();
  const menu = page.getByRole('dialog', { name });
  for (const a of ['교체', '건너뛰기', '메모', '정보 보기']) await expect(menu.getByRole('button', { name: `${name} ${a}` })).toBeVisible();
  await page.keyboard.press('Escape');
  // 세트 번호를 누르면 RIR·세트 메모 (현재 세트가 아닌 줄)
  await row1.getByRole('button', { name: /자세히/ }).click();
  await expect(first.getByRole('button', { name: `${name} 1세트 메모` })).toBeVisible();
  await endWorkout(page);
  // 2회차: 지난번 칸에 20×10, 더 무거운 세트 → ★ 기록 갱신 배지 (앱 기준), 끝낼 때 알림
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(page.getByLabel(`${name} 1세트 지난번 20×10`)).toBeVisible();
  await page.getByLabel(`${name} 1세트 무게`, { exact: true }).fill('25');
  await page.getByLabel(`${name} 1세트 횟수`, { exact: true }).fill('10');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  const badge = page.locator('.pr-line').first();
  await expect(badge).toContainText('기록 갱신');
  await expect(badge).toContainText('앱 기준');
  await checkScreen(page, '74-workout-pr');
  await endWorkout(page);
  await expect(page.getByRole('status').filter({ hasText: '기록 갱신 1개 운동 (앱 기준)' })).toBeVisible();
});

// ===== D-055 3단계 =====
test('D-055 3단계 플랜 단계 카드(1 부위 → 2 시간·등급 → 3 결과 숫자)·종목 줄 배지·상세 숫자', async ({ page }) => {
  await page.getByRole('link', { name: '플랜' }).click();
  const s1 = page.getByRole('region', { name: '1단계 부위·우선순위' });
  const s2 = page.getByRole('region', { name: '2단계 시간·등급·묶음' });
  await expect(s1).toContainText('아직 없음');
  await expect(s1.getByRole('group', { name: '부위' })).toBeVisible();
  await expect(s2.getByRole('button', { name: '45분' })).toBeVisible();
  await expect(s2.getByLabel('최소 등급')).toBeVisible();
  await pickPart(page, '등');
  await expect(s1).toContainText('1개 고름');
  await s2.getByRole('button', { name: '30분' }).click();
  await s2.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const res = page.getByRole('region', { name: '생성된 플랜' });
  const sum = res.getByLabel('플랜 요약');
  await expect(sum).toContainText('예상 시간');
  await expect(sum).toContainText('목표 30분');
  const items = await res.getByRole('button', { name: / 삭제$/ }).count();
  await expect(sum).toContainText(`운동${items}개`);
  await checkScreen(page, '75-plan-steps');
  // 종목: 줄 = 등급 배지 + 이름 + 부위 태그, 상세 = 숫자 3개 (기록 없으면 --)
  await page.getByRole('link', { name: '종목' }).click();
  const row = page.getByRole('button', { name: '랫풀다운', exact: true });
  await expect(row.locator('.badge')).toHaveCount(1);
  await expect(row.locator('.tag')).toHaveText('등');
  await checkScreen(page, '76-exercises');
  await row.click();
  const m = page.getByRole('region', { name: '내 기록 요약' });
  await expect(m).toContainText('추정 1RM');
  await expect(m).toContainText('--');
  await page.getByRole('button', { name: '즐겨찾기', exact: true, pressed: false }).click();
  await page.getByRole('button', { name: '뒤로' }).click();
  await expect(page.getByRole('button', { name: '랫풀다운', exact: true }).locator('.ex-fav')).toHaveCount(1);
});

test('D-055 3단계 설정 묶음 카드: 운동·소리·화면·동기화·백업·데이터·앱 정보, 컨트롤 그대로', async ({ page }) => {
  await page.getByRole('link', { name: '설정', exact: true }).click();
  for (const g of ['운동', '소리·화면', '동기화·백업', '데이터', '앱 정보·도구']) await expect(page.getByRole('region', { name: g, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '운동', exact: true }).getByRole('button', { name: '중급' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '소리·화면' }).getByLabel('폰 화면으로 보기')).toBeVisible();
  await expect(page.getByRole('region', { name: '동기화·백업' }).getByRole('button', { name: '백업 파일 저장' })).toBeVisible();
  await expect(page.getByRole('region', { name: '데이터', exact: true }).getByLabel('진단 기록 남기기')).toBeVisible();
  // 선택 칩은 채우지 않음 (옅은 파랑 + 테두리): 배경이 채운 파랑(#2563eb)이 아님
  const bg = await page.getByRole('region', { name: '운동', exact: true }).getByRole('button', { name: '중급' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(37, 99, 235)');
  await checkScreen(page, '77-settings');
});

test('D-055 3단계 기록 탭: 부위 막대·몸 그림을 누르면 그 주 그 부위 운동 창, 10~20 참고 띠', async ({ page }) => {
  await makeRoutine(page, ['이두'], '30분');
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  const name = (await page.locator('input[aria-label$=" 1세트 무게"]').first().getAttribute('aria-label'))!.replace(/ 1세트 무게$/, '');
  await page.getByLabel(`${name} 1세트 무게`, { exact: true }).fill('12');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await endWorkout(page);
  await page.getByRole('link', { name: '기록', exact: true }).click();
  const bar = page.getByRole('button', { name: /^이두 1세트, 이 주 운동 보기$/ });
  await expect(bar.locator('.band')).toHaveCount(1);
  await expect(page.locator('.band-label')).toHaveText('10~20 참고');
  await expect(page.getByText(/연구 참고 범위 10~20세트/)).toContainText('목표·상한 아님');
  await bar.click();
  const sheet = page.getByRole('dialog', { name: /^이두 · 이번 주/ });
  await expect(sheet).toContainText('작업 세트 1개 · 운동 1개');
  await expect(sheet.getByRole('list', { name: '운동별 세트' })).toContainText('1세트');
  await expect(sheet.getByRole('button', { name: new RegExp(`${name.replace(/[()]/g, '.')} 1세트 최고 12kg`) })).toBeVisible();
  await checkScreen(page, '78-stats-part-sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // 세트가 없는 부위 막대는 누를 수 없음
  await expect(page.getByRole('button', { name: '가슴 0세트' })).toBeDisabled();
  await checkScreen(page, '79-stats');
});

test('D-055 3단계 운동 화면: 시간 운동 지난번(초), 고친 지난 기록 기준 기록 갱신, 번호 펼침 표시·[끝내기] 보통 버튼', async ({ page }) => {
  // 플랭크(시간 운동)를 넣은 루틴
  await page.getByRole('link', { name: '플랜' }).click();
  await pickPart(page, '등');
  await page.getByRole('button', { name: '30분' }).click();
  await page.getByRole('button', { name: '플랜 만들기', exact: true }).click();
  const planSec = page.getByRole('region', { name: '생성된 플랜' });
  await planSec.getByRole('button', { name: '+ 운동 추가' }).click();
  await page.getByRole('dialog', { name: '운동 추가' }).getByLabel('운동 검색').fill('플랭크');
  await page.getByRole('dialog', { name: '운동 추가' }).getByRole('button', { name: '플랭크', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '저장만' }).click();
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(page.getByRole('button', { name: '끝내기', exact: true })).not.toHaveClass(/danger-fill/);
  const first = (await page.locator('input[aria-label$=" 1세트 무게"]').first().getAttribute('aria-label'))!.replace(/ 1세트 무게$/, '');
  // 1회차: 첫 운동 50kg × 8, 플랭크 1세트
  await page.getByLabel(`${first} 1세트 무게`, { exact: true }).fill('50');
  await page.getByLabel(`${first} 1세트 횟수`, { exact: true }).fill('8');
  await page.getByRole('button', { name: '현재 세트 완료' }).click();
  await page.getByRole('button', { name: /^플랭크 (세트 간|라운드 후) 휴식/ }).first().click();
  const sec = await page.getByLabel('플랭크 1세트 초', { exact: true }).inputValue();
  await page.getByRole('button', { name: '플랭크 1세트 완료' }).click();
  // 번호 펼침 표시: 끝낸 줄 번호는 펼칠 수 있음 (aria-expanded + ⌄)
  const idx = page.getByRole('button', { name: `${first} 1세트 자세히 (RIR·메모)` });
  await expect(idx).toHaveAttribute('aria-expanded', 'false');
  await expect(idx.locator('.idx-chev')).toHaveCount(1);
  await endWorkout(page);
  // 지난 기록을 60kg × 8 로 고침
  await recentMenu(page.getByRole('group', { name: /^최근 운동 / }).first(), '수정');
  await page.locator(`input[aria-label="${first} 1세트 무게"]`).first().fill('60');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('link', { name: '홈', exact: true }).click();
  // 2회차: 지난번 = 고친 값 60×8, 플랭크 지난번 = 초, 55kg × 8 은 갱신 아님 (고친 60 기준)
  await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
  await expect(page.getByLabel(`${first} 1세트 지난번 60×8`)).toBeVisible();
  await page.getByRole('button', { name: /^플랭크 (세트 간|라운드 후) 휴식/ }).first().click();
  await expect(page.getByLabel(`플랭크 1세트 지난번 ${sec}초`)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${first.replace(/[()+]/g, '.')} (세트 간|라운드 후) 휴식`) }).first().click();
  await page.getByLabel(`${first} 1세트 무게`, { exact: true }).fill('55');
  await page.getByLabel(`${first} 1세트 횟수`, { exact: true }).fill('8');
  await page.getByRole('button', { name: `${first} 1세트 완료` }).click();
  await expect(page.locator('.pr-line')).toHaveCount(0);
  await checkScreen(page, '80-workout-p3');
});

test('0.9.3 성능 관문: 화면을 나눠 받아도 한 번 연 뒤에는 인터넷 없이 안 열어 본 화면(종목·기록·플랜)까지 열림 (서비스 워커가 모든 묶음을 미리 담음, 오프라인 단계는 Chromium 만)', async ({ page, context, browserName }) => {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  await page.waitForLoadState('load');
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r && !r.installing && !r.waiting && !!r.active; }), { timeout: 15000 }).toBe(true);
  // 설치 때 담은 JS 묶음 수 = sw.js 의 ASSETS 중 JS 수 (화면을 열지 않았어도 다 담김)
  const want = await page.evaluate(async () => { const t = await (await fetch('sw.js', { cache: 'no-store' })).text(); return (t.match(/'assets\/[^']+\.js'/g) ?? []).length; });
  expect(want).toBeGreaterThanOrEqual(8);
  // 화면을 맡은 뒤 나머지 묶음을 담으므로 다 담길 때까지 기다림
  await expect.poll(() => page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).filter((r) => /\/assets\/[^/]+\.js$/.test(r.url)).length; return n; }), { timeout: 15000 }).toBeGreaterThanOrEqual(want);
  // WebKit 은 Playwright 오프라인 상태에서 새로 고침이 내부 오류로 끝남 (도구 한계) → 담긴 묶음 수까지만 확인
  if (browserName === 'webkit') return;
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '오늘' })).toBeVisible();
  await page.getByRole('link', { name: '종목' }).click();
  await expect(page.getByRole('button', { name: '랫풀다운', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '랫풀다운', exact: true }).click();
  await expect(page.getByRole('heading', { name: '영상 등급' })).toBeVisible(); // 자세 포인트(나눠 받는 데이터)까지
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('this-week')).toBeVisible();
  await page.getByRole('link', { name: '플랜' }).click();
  await expect(page.getByRole('region', { name: '1단계 부위·우선순위' })).toBeVisible();
  await context.setOffline(false);
});

test.describe('0.9.3 검토: 나눠 받는 화면을 못 받으면', () => {
  test.use({ serviceWorkers: 'block' }); // 서비스 워커 저장본이 아니라 네트워크 실패를 흉내
  test('"새 버전이 나왔거나 인터넷이 끊겼을 수 있어요" + [다시 시도], 다시 받을 수 있게 되면 다시 시도로 열림 (다시 시도 단계는 Chromium 만)', async ({ page, browserName }) => {
    const chunk = '**/assets/Stats-*.js';
    await page.route(chunk, (r) => r.fulfill({ status: 404, body: 'not found', headers: { 'cache-control': 'no-store' } }));
    await page.reload(); // 새 문서 (이전 문서가 미리 받아 둔 묶음 없이)
    await expect(page.getByRole('heading', { name: '오늘' })).toBeVisible();
    await page.getByRole('link', { name: '기록', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: '화면을 불러오지 못했어요' });
    await expect(alert).toContainText('새 버전이 나왔거나 인터넷이 끊겼을 수 있어요');
    await checkScreen(page, '81-lazy-load-error');
    await expect(alert.getByRole('button', { name: '다시 시도' })).toBeVisible();
    // Playwright WebKit 은 한 번 실패한 모듈 묶음을 새로 고침 뒤에도 다시 요청하지 않음 (요청 자체가 안 나감, 도구 쪽 동작으로 보임) → 다시 시도 단계는 Chromium 만
    if (browserName === 'webkit') return;
    await page.unroute(chunk);
    await alert.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByTestId('this-week')).toBeVisible();
  });
});

test.describe('D-056 휴식 끝 진동', () => {
  type HW = Window & { __wkTest?: boolean; __hapticCalls?: { pulses: number; method: string }[]; __dn?: () => number };
  test('설정: 휴식 끝 진동 켜기/끄기(이 기기만), [소리·진동 시험] 결과 글, 숨긴 스위치는 초점·스크롤에 영향 없음, 안내 카드', async ({ page }) => {
    await page.getByRole('link', { name: '설정', exact: true }).click();
    const grp = page.getByRole('region', { name: '소리·화면' });
    await grp.getByRole('button', { name: '휴식 끝 진동 켬' }).click();
    await expect(grp.getByRole('button', { name: '휴식 끝 진동 끔' })).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(grp.getByRole('button', { name: '휴식 끝 진동 끔' })).toBeVisible();
    await grp.getByRole('button', { name: '휴식 끝 진동 끔' }).click();
    await expect(grp.getByRole('button', { name: '휴식 끝 진동 켬' })).toHaveAttribute('aria-pressed', 'true');
    // 안내는 접혀 있음 (검토 S4): 요약 줄 44px, 누르면 펼침. 켜기·시험 버튼은 늘 보임
    const guide = grp.getByTestId('guide-music');
    await expect(guide).not.toHaveAttribute('open', '');
    await expect(guide.locator('li').first()).toBeHidden();
    const sum = guide.locator('summary');
    expect((await sum.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await sum.click();
    await expect(guide).toHaveAttribute('open', '');
    await expect(guide.locator('li')).toHaveCount(4);
    await expect(grp.getByRole('button', { name: '소리·진동 시험' })).toBeVisible();
    await expect(guide).toContainText('사운드 및 햅틱');
    // 시험 버튼: 누른 버튼에 초점이 그대로, 스크롤 그대로
    const btn = grp.getByRole('button', { name: '소리·진동 시험' });
    await btn.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => window.scrollY);
    await btn.click();
    const res = page.getByTestId('alert-test-result');
    await expect(res).toContainText(/iOS 햅틱을 시도했어요 · 떨렸는지 직접 확인해 주세요|진동 방식: 진동|진동 방식: 진동 지원 안 함\(화면 깜빡임만\)/);
    await expect(res).toContainText('아이폰 진동은 버튼을 누르지 않은 순간이라 안 올 수 있어요');
    await expect(guide).toContainText('애플 제한으로 진동이 안 올 수 있어요');
    await expect(grp).not.toContainText('그때는 진동으로 알려요'); // 진동을 약속하는 옛 문구 없음 (검토 R1)
    await expect(res).toContainText('무음 스위치를 확인하세요');
    await expect(res).toContainText('운동 중에는 휴식이 끝나면 자동으로');
    await page.waitForTimeout(400); // 나머지 두 번 누르기(120ms 간격)까지
    // 초점은 브라우저 기본(누른 버튼, WebKit 은 body) 그대로, 숨긴 스위치·라벨로 가지 않음
    const ae = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return { inBox: !!el?.closest('.haptic-box'), tag: el?.tagName, text: el?.tagName === 'BUTTON' ? el.textContent : '' }; });
    expect(ae.inBox).toBe(false);
    expect(ae.tag === 'BODY' || ae.text === '소리·진동 시험').toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(y0);
    await noHorizontalScroll(page);
    await btn.focus();
    await checkScreen(page, '82-settings-alert');
  });

  test('휴식: 첫 휴식에 안내 한 줄(닫기), 10초 전 짧게 1번·끝에 3번 진동(한 번만), 늦게 돌아오면 진동 안 함', async ({ page, browserName }) => {
    await page.addInitScript(() => { (window as HW).__wkTest = true; });
    await page.reload();
    await makeRoutine(page, ['이두'], '30분');
    await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    const hint = page.getByRole('note', { name: '휴식 알림 안내' });
    // 진동 이야기는 진동 켬 + 방법이 있을 때만 (Chromium = vibrate, Playwright WebKit = 없음)
    await expect(hint).toHaveText(browserName === 'chromium' ? '무음 모드면 알림음 대신 진동·화면 깜빡임으로 알려요' : '무음 모드면 알림음이 안 나요 · 벨소리 모드로 두면 음악 위로 들려요');
    await checkScreen(page, '83-rest-hint');
    const calls = () => page.evaluate(() => ((window as HW).__hapticCalls ?? []).map((c) => c.pulses));
    const shift = (ms: number) => page.evaluate((m) => { const w = window as HW; w.__dn ??= Date.now.bind(Date); const o = w.__dn; Date.now = () => o() + m; }, ms);
    const total = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
    await shift((total - 5) * 1000);
    await expect.poll(calls).toEqual([1]); // 10초 전 짧게
    await shift((total + 1) * 1000);
    await expect(page.locator('.rest-pill.end')).toBeVisible();
    await expect.poll(calls).toEqual([1, 3]); // 끝에 3번
    await page.waitForTimeout(800);
    expect(await calls()).toEqual([1, 3]); // 다시 울리지 않음
    await page.reload();
    await expect(page.locator('.rest-pill.end, .rest-pill')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => ((window as HW).__hapticCalls ?? []).length)).toBe(0); // 새로 고쳐도 같은 휴식 끝은 다시 안 울림
    // 안내는 이 기기 처음 휴식에만
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    await expect(page.getByLabel(/휴식 남은 시간 \d+초/)).toBeVisible();
    await expect(hint).toHaveCount(0);
    // 늦게 돌아옴: 끝난 지 30초 지나서 화면을 봄 → 진동 안 함 (소리·깜빡임은 그대로)
    const t2 = Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);
    await shift((t2 + 30) * 1000);
    await expect(page.locator('.rest-pill.end')).toBeVisible();
    await page.waitForTimeout(500);
    expect((await calls()).filter((p) => p === 3)).toEqual([]);
  });

  test('안내 한 줄은 닫을 수 있음', async ({ page }) => {
    await makeRoutine(page, ['등'], '30분');
    await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    const hint = page.getByRole('note', { name: '휴식 알림 안내' });
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: '안내 닫기' }).click();
    await expect(hint).toHaveCount(0);
  });
});

test.describe('D-056 검토: 진동 끔·소리 끔, 실험 알림', () => {
  type NW = Window & { __wkTest?: boolean; __hapticCalls?: { pulses: number }[]; __notifyCalls?: { title: string; body: string }[]; __dn?: () => number };
  const shift = (page: Page, ms: number) => page.evaluate((m) => { const w = window as NW; w.__dn ??= Date.now.bind(Date); const o = w.__dn; Date.now = () => o() + m; }, ms);
  const restTotal = async (page: Page) => Number((await page.getByLabel(/휴식 남은 시간/).getAttribute('aria-label'))!.match(/\d+/)![0]);

  test('진동 끔이면 첫 휴식 안내는 벨소리 이야기, 소리 끔 + 진동 켬이면 10초 전 진동은 그대로', async ({ page }) => {
    await page.addInitScript(() => { (window as NW).__wkTest = true; });
    await page.getByRole('link', { name: '설정', exact: true }).click();
    const grp = page.getByRole('region', { name: '소리·화면' });
    await grp.getByRole('button', { name: '휴식 끝 진동 켬' }).click();
    await makeRoutine(page, ['이두'], '30분');
    await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    await expect(page.getByRole('note', { name: '휴식 알림 안내' })).toHaveText('무음 모드면 알림음이 안 나요 · 벨소리 모드로 두면 음악 위로 들려요');
    // 소리 끔 + 진동 켬
    await page.getByRole('link', { name: '설정', exact: true }).click();
    await grp.getByRole('button', { name: '휴식 끝 진동 끔' }).click();
    await grp.getByRole('button', { name: '소리 켬' }).click();
    await page.reload(); // 새 문서에서 __wkTest 다시
    await page.getByRole('link', { name: '운동', exact: true }).click();
    const total = await restTotal(page);
    await shift(page, (total - 5) * 1000);
    await expect.poll(() => page.evaluate(() => ((window as NW).__hapticCalls ?? []).map((c) => c.pulses))).toEqual([1]);
  });

  test('실험 알림: 켜면 권한을 묻고, [알림 시험]·휴식 끝에 한 번 보냄, 늦게 돌아오면 안 보냄 (Chromium, 권한 허용) / WebKit 은 안내만', async ({ page, context, browserName }) => {
    const sec = page.getByRole('region', { name: '휴식 끝 알림으로 받기 (실험)' });
    if (browserName !== 'chromium') {
      await page.getByRole('link', { name: '설정', exact: true }).click();
      await expect(sec).toBeVisible();
      await expect(sec.getByTestId('notify-perm')).toBeVisible(); // 켜기 버튼 또는 "쓸 수 없어요" 안내
      return;
    }
    await context.grantPermissions(['notifications']);
    // 헤드리스 Chromium 은 권한을 줘도 Notification.permission 이 'denied' 로 보임 (permissions.query 는 granted) → 시험에서만 허용으로 보이게
    await page.addInitScript(() => { (window as NW).__wkTest = true; Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); Notification.requestPermission = async () => 'granted'; });
    await page.reload();
    await page.getByRole('link', { name: '설정', exact: true }).click();
    await expect(sec.getByTestId('guide-notify')).not.toHaveAttribute('open', '');
    await sec.getByTestId('guide-notify').locator('summary').click();
    await expect(sec).toContainText('홈 화면에 추가한 앱에서만');
    await sec.getByRole('button', { name: '휴식 끝 알림 끔' }).click();
    await expect(sec.getByRole('button', { name: '휴식 끝 알림 켬' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sec.getByTestId('notify-perm')).toHaveText('알림 허용됨');
    await sec.getByRole('button', { name: '알림 시험', exact: true }).click();
    await expect(sec.getByTestId('notify-result')).toContainText(/알림을 보냈어요|보내지 못했어요/);
    await checkScreen(page, '84-settings-notify');
    const calls = () => page.evaluate(() => ((window as NW).__notifyCalls ?? []).map((c) => `${c.title}|${c.body}`));
    expect(await calls()).toEqual(['알림 시험|배너·진동이 왔나요?']);
    // 휴식 끝 → 한 번
    await makeRoutine(page, ['이두'], '30분');
    await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    const t1 = await restTotal(page);
    await shift(page, (t1 + 1) * 1000);
    await expect(page.locator('.rest-pill.end')).toBeVisible();
    await expect.poll(async () => (await calls()).filter((c) => c.startsWith('휴식 끝|'))).toHaveLength(1);
    expect((await calls()).find((c) => c.startsWith('휴식 끝|'))).toMatch(/^휴식 끝\|다음: /);
    await page.waitForTimeout(600);
    expect((await calls()).filter((c) => c.startsWith('휴식 끝|'))).toHaveLength(1);
    // 늦게 돌아옴 → 안 보냄
    await page.getByRole('button', { name: '현재 세트 완료' }).click();
    const t2 = await restTotal(page);
    await shift(page, (t1 + 1 + t2 + 30) * 1000);
    await expect(page.locator('.rest-pill.end')).toBeVisible();
    await page.waitForTimeout(500);
    expect((await calls()).filter((c) => c.startsWith('휴식 끝|'))).toHaveLength(1);
    // 끄면 다시 끔
    await page.getByRole('link', { name: '설정', exact: true }).click();
    await sec.getByRole('button', { name: '휴식 끝 알림 켬' }).click();
    await expect(sec.getByRole('button', { name: '휴식 끝 알림 끔' })).toBeVisible();
  });
});

test.describe('D-057 회복', () => {
  type RW = Window & { __dn?: () => number };
  const shiftH = (page: Page, h: number) => page.evaluate((ms) => { const w = window as RW; w.__dn ??= Date.now.bind(Date); const o = w.__dn; Date.now = () => o() + ms; }, h * 3_600_000);
  const unshift = (page: Page) => page.evaluate(() => { const w = window as RW; if (w.__dn) Date.now = w.__dn; });

  test('하체를 많이 하면 기록 탭 회복 중(남은 시간)·설명 창, 80시간 뒤 회복됨 · 홈 한 줄·다음 운동 안내 · 플랜 안내', async ({ page }) => {
    await makeRoutine(page, ['하체'], '60분');
    await page.getByRole('button', { name: /^다음 운동으로 시작/ }).click();
    const done = page.getByRole('button', { name: '현재 세트 완료' });
    await expect(done).toBeVisible(); // 운동 화면(나눠 받는 묶음)이 뜰 때까지
    for (let i = 0; i < 16 && (await done.count()); i++) {
      const kg = page.locator('.set-row.current input[aria-label$=" 무게"]');
      if ((await kg.count()) && !(await kg.first().inputValue())) await kg.first().fill('40');
      await done.click();
    }
    await endWorkout(page);
    // 기록 탭: 하체 회복 중, 약 N시간 남음 → 누르면 설명 창
    await page.getByRole('link', { name: '기록', exact: true }).click();
    const card = page.getByTestId('recovery-card');
    await expect(card).toContainText('추정 · 앱 기준');
    const row = card.getByRole('button', { name: /^하체 회복 중, 약 \d+시간 남음, 자세히$/ });
    await expect(row).toBeVisible();
    const left = Number((await row.getAttribute('aria-label'))!.match(/약 (\d+)시간/)![1]);
    await row.click();
    const sheet = page.getByRole('dialog', { name: '하체 회복 추정' });
    const sets = Number((await sheet.textContent())!.match(/하체 작업 세트 (\d+)개/)![1]);
    expect(left).toBe(sets >= 10 ? 72 : 48); // 방금 끝냄: 기본 48, 10세트 이상 72 (실패 세트 없음)
    await expect(sheet).toContainText('실패 세트(RIR 0 기록) 0개');
    await expect(sheet).toContainText('등 근육을 측정한 연구는 없음'); // 규칙의 주의·상충 (검토 F1)
    await expect(card.getByTestId('rec-evidence')).toContainText(sets >= 10 ? '규칙 AR-01·AR-03·AR-05·AR-19' : '규칙 AR-01·AR-05·AR-19'); // 쓴 규칙에서 만듦 (검토 F4)
    await expect(sheet.getByText('AR-01', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'AR-01 근거 논문 3편 보기' })).toHaveAttribute('href', '#/recovery/papers?rule=AR-01');
    await expect(sheet.locator('.lbl-chip.research').first()).toHaveText('연구 근거');
    await checkScreen(page, '85-recovery-sheet');
    await page.keyboard.press('Escape');
    await checkScreen(page, '86-recovery-card');
    // 홈: 한 줄 + 다음 운동(같은 하체 루틴) 안내
    await page.getByRole('link', { name: '홈', exact: true }).click();
    await expect(page.getByTestId('home-recovery')).toContainText(`회복 중: 하체(약 ${left}시간)`);
    await expect(page.getByTestId('home-recovery')).toHaveAttribute('href', '#/stats');
    await expect(page.getByTestId('next-rec-note')).toContainText('회복 중으로 추정: 하체(약');
    await checkScreen(page, '87-home-recovery');
    // 플랜: 하체를 고르면 안내 (막지 않음)
    await page.getByRole('link', { name: '플랜' }).click();
    if (await page.getByRole('button', { name: '하체 선택 안 함' }).count()) await pickPart(page, '하체');
    await expect(page.getByTestId('plan-rec-note')).toContainText(/하체는 (방금|약 \d+시간 전)에 했어요 · 회복 추정 약 \d+시간 남음/);
    await expect(page.getByRole('button', { name: '플랜 만들기', exact: true })).toBeEnabled();
    await checkScreen(page, '88-plan-recovery-note');
    // 80시간 뒤: 회복됨, 홈 안내 사라짐
    await shiftH(page, 80);
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(card.getByRole('button', { name: '하체 회복됨, 회복됨, 자세히' })).toBeVisible();
    await page.getByRole('link', { name: '홈', exact: true }).click();
    await expect(page.getByTestId('home-recovery')).toContainText('회복됨: 하체');
    await expect(page.getByTestId('next-rec-note')).toHaveCount(0);
    // 15일 뒤: 최근 14일 기록 없음 → 목록·홈 줄에서 빠지고 "기록 없는 부위"로 (검토 F6)
    await shiftH(page, 15 * 24);
    await expect(page.getByTestId('home-recovery')).toHaveCount(0);
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(card).toContainText('최근 14일 안에 한 운동이 없어요');
    await unshift(page);
  });

  test('기록 없음: 회복 카드는 빈 안내, 홈 한 줄 없음', async ({ page }) => {
    await expect(page.getByTestId('home-recovery')).toHaveCount(0);
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await expect(page.getByTestId('recovery-card')).toContainText('아직 회복을 추정할 운동이 없어요');
  });

  test('회복 팁: 체중이 없으면 안내, 기록하면 단백질 1.6 g/kg 계산 · 근거 논문: 인용순·최신순·주제·규칙 거르기·DOI 링크', async ({ page }) => {
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await page.getByTestId('recovery-card').getByRole('link', { name: /회복 팁·근거/ }).click();
    await expect(page).toHaveURL(/#\/recovery$/);
    await expect(page.getByTestId('tip-AR-11')).toContainText('체중을 기록하면 계산해 드려요');
    await expect(page.getByTestId('tip-AR-13')).toContainText('이 DB 범위에서는 근거 없음'); // 데이터 문구 그대로, 같은 문장 두 번 없음 (검토 F3)
    expect(((await page.getByTestId('tip-AR-13').textContent())!.match(/이 DB 범위에서는/g) ?? []).length).toBe(1);
    await expect(page.getByTestId('tip-AR-16').locator('.lbl-chip')).toHaveText(['앱 판단 추정', '근거 약함']);
    await expect(page.getByTestId('tip-AR-12').locator('.lbl-chip.weak')).toHaveText('근거 약함');
    await expect(page.getByTestId('tip-AR-09')).not.toContainText('7.6');
    for (const id of ['AR-04', 'AR-09', 'AR-10', 'AR-11', 'AR-12', 'AR-13', 'AR-14', 'AR-15', 'AR-16']) await expect(page.getByTestId(`tip-${id}`)).toBeVisible();
    // 체중 75kg → 120g (105~165)
    await page.getByRole('link', { name: '기록', exact: true }).click();
    await page.getByLabel('체중', { exact: true }).fill('75');
    await page.getByRole('button', { name: '기록', exact: true }).click();
    await page.goto('./#/recovery');
    const pb = page.getByTestId('protein-box');
    await expect(pb).toContainText('120g');
    await expect(pb).toContainText('105g');
    await expect(pb).toContainText('~165g');
    await checkScreen(page, '89-recovery-tips');
    // 근거 논문: 38편, 인용순 → 최신순
    await page.getByRole('link', { name: /근거 논문 전체 보기/ }).click();
    await expect(page.getByTestId('paper-count')).toHaveText(/^(\d+)편$/);
    expect(Number((await page.getByTestId('paper-count').textContent())!.match(/\d+/)![0])).toBeGreaterThanOrEqual(10);
    const cites = async () => (await page.getByTestId('cite').allTextContents()).map((x) => Number(x.match(/인용 ([\d,]+)/)![1]!.replace(/,/g, '')));
    const c = await cites();
    for (let i = 1; i < c.length; i++) expect(c[i - 1]!).toBeGreaterThanOrEqual(c[i]!);
    await page.getByRole('button', { name: '최신순' }).click();
    await expect(page.getByRole('button', { name: '최신순' })).toHaveAttribute('aria-pressed', 'true');
    const years = (await page.getByTestId('paper').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))).map((x) => Number(x.match(/(\d{4})$/)![1]));
    for (let i = 1; i < years.length; i++) expect(years[i - 1]!).toBeGreaterThanOrEqual(years[i]!);
    const doi = page.getByTestId('paper').first().getByRole('link', { name: /^DOI / });
    await expect(doi).toHaveAttribute('target', '_blank');
    await expect(doi).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(doi).toHaveAttribute('href', /^https:\/\/doi\.org\//);
    await page.getByRole('group', { name: '주제로 거르기' }).getByRole('button', { name: /^세트 간 휴식 \d+$/ }).click();
    await expect(page.getByTestId('paper-count')).toHaveText(/^\d+편 · 주제 세트 간 휴식$/);
    await checkScreen(page, '90-recovery-papers');
    // 주소로 바로 열고 [뒤로] → 앱 밖이 아니라 기록 탭으로 (검토 메모)
    await page.goto('./#/recovery/papers?rule=AR-07');
    await page.reload();
    await page.getByRole('button', { name: '뒤로' }).click();
    await expect(page).toHaveURL(/#\/stats$/);
    // 규칙으로 거르기
    await page.goto('./#/recovery/papers?rule=AR-07');
    await expect(page.getByTestId('rule-filter')).toContainText('AR-07');
    await expect(page.getByTestId('paper-count')).toHaveText('4편');
    // 설정 기본 휴식 옆 "근거" → 세트 간 휴식 논문
    await page.goto('./#/settings');
    await page.getByRole('link', { name: '세트 간 휴식 근거 논문' }).click();
    await expect(page.getByTestId('paper-count')).toHaveText(/^\d+편 · 주제 세트 간 휴식$/);
  });
});

