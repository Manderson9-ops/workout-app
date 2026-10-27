/**
 * 사용 분석 개선 2단계 화면 시험 (D-067 내 속도·내 시간에 맞추기·같은 이름 루틴, D-068 끝낼 때 루틴 반영, 묶음 등급 배지)
 * 기록·루틴은 저장소(IndexedDB)에 직접 넣어 시작
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
type R = { id: string; name: string; blocks: { kind: string; items: { exerciseId: string; sets: number }[] }[] };
const routines = async (page: Page) => (await idbAll(page, 'routines')) as unknown as R[];

const one = (exerciseId: string, sets: number) => ({ kind: 'single', items: [{ exerciseId, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const pair = (a: string, b: string, sets: number) => ({ kind: 'superset', items: [{ exerciseId: a, sets, reps: 10 }, { exerciseId: b, sets, reps: 10 }], restSec: 90, roundRestSec: 120, transitionSec: 10 });
const routine = (id: string, name: string, blocks: Row[], createdAgo = DAY) => ({ id, name, createdAt: iso(Date.now() - createdAgo), updatedAt: iso(Date.now() - createdAgo), blocks, warmupSec: 480 });
/** 끝낸 운동: 벤치 20세트, 150초 간격, 시작 30초 뒤 첫 세트 → 내 속도 세트당 150초 */
function past(id: string, daysAgo: number) {
  const start = Date.now() - daysAgo * DAY;
  const sets = Array.from({ length: 20 }, (_, k) => ({ warmup: false, done: true, weight: 60, reps: 8, doneAt: iso(start + 30_000 + k * 150_000) }));
  return { id, name: '지난 운동', startedAt: iso(start), endedAt: iso(start + 30_000 + 19 * 150_000 + 3 * MIN), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench_press', target: { sets: 20, reps: 8 }, sets }] }] };
}
/** 사용자 루틴 모양: 가슴+등 9블록 56세트 */
const chestBack = routine('r-cb', '가슴+등 75분', [
  one('bench_press', 5), one('pull_up', 5), pair('incline_db_press', 'chin_up', 4), pair('db_bench_press', 'pull_up_wide', 4), one('decline_bench_press', 5),
  one('pull_up_neutral', 5), one('smith_bench_press', 5), one('pull_up_overhand_mid', 5), pair('towel_pull_up', 'incline_bench_press', 5),
]);

test('D-067 내 속도: 카드·편집 화면 한 줄, [맞추기] → 미리 보기(목표 바꾸기) → 적용하면 75분 안', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 1), past('p2', 3), past('p3', 5), past('p4', 7)]);
  await idbPut(page, 'routines', [{ ...chestBack, estimatedSec: 152 * 60 }]); // 앱 기본 예상 152분 (사용자 루틴 모양)
  await page.reload();
  // 홈: 내 속도 줄은 루틴마다 한 번. 이 루틴은 "다음 운동"이라 그 카드에만 (내 루틴 목록 카드에는 다시 안 보임)
  const next = page.getByTestId('home-next');
  const card = page.getByRole('group', { name: '루틴 가슴+등 75분' });
  await expect(next.getByTestId('pace-line')).toHaveText('내 속도로 약 139분 (최근 4회)·목표 75분이면 못 할 운동 5개');
  // [시간 맞추기]는 [시작] 아래 보조 자리 (시작을 밀어 내리지 않음)
  const startBox = await next.getByRole('button', { name: /^다음 운동으로 시작/ }).boundingBox();
  const fitBox = await next.getByRole('button', { name: '가슴+등 75분 내 시간에 맞추기' }).boundingBox();
  expect(fitBox!.y).toBeGreaterThan(startBox!.y);
  await expect(page.getByTestId('pace-line')).toHaveCount(1);
  await expect(card.getByTestId('pace-line')).toHaveCount(0);
  // 내 속도 예상이 있으면 앱 기본 예상("· 약 N분")은 카드에서 빠짐
  await expect(next.locator('.next-meta')).toHaveText('운동 12개');
  await expect(card).not.toContainText(/운동 \d+개 · 약/);
  await checkScreen(page, 'u10-pace-card');
  // 내 루틴 화면(다음 운동 카드 없음)에서는 목록 카드에 보임
  await page.goto('./#/routines');
  const card2 = page.getByRole('group', { name: '루틴 가슴+등 75분' });
  await expect(card2.getByTestId('pace-line')).toHaveText('내 속도로 약 139분 (최근 4회)·목표 75분이면 못 할 운동 5개시간 맞추기');
  await page.goto('./#/');
  await next.getByRole('button', { name: '가슴+등 75분 내 시간에 맞추기' }).click();
  const dlg = page.getByRole('dialog', { name: '내 시간에 맞추기' });
  await expect(dlg).toContainText('약 139분 → 71분'); // 주 운동(바벨 벤치 등)은 고르게 맨 나중에 줄여 묶음 라운드째 줄어 71분
  await expect(dlg).toContainText('내 속도: 세트당 약 2.5분 (최근 4회 기록)');
  await expect(dlg.getByTestId('fit-app-default')).toHaveText('앱 기본 예상: 약 152분');
  // 첫 운동(바벨 벤치프레스)은 제자리, 덜 한 등은 그 뒤로 앞당김 (한 줄 요약), 많이 한 가슴은 세트를 줄임
  await expect(dlg.getByRole('listitem').first()).toContainText('바벨 벤치프레스');
  await expect(dlg.getByTestId('fit-move')).toHaveText(/^등 운동 \d+개.*를 앞으로$/);
  await expect(dlg.locator('.fit-up')).toHaveCount(0);
  // 아래 [취소]·[적용]은 창 아래에 붙어 늘 보임
  await expect(dlg.getByRole('button', { name: '맞춘 루틴 적용하기' })).toBeInViewport();
  await checkScreen(page, 'u11-fit-preview');
  // 목표 바꾸기
  await dlg.getByRole('button', { name: '목표 시간 5분 늘리기' }).click();
  await expect(dlg).toContainText('(목표 80분)');
  await dlg.getByRole('button', { name: '목표 시간 5분 줄이기' }).click();
  await expect(dlg).toContainText('(목표 75분)');
  // 적용 전에는 그대로
  expect((await routines(page)).find((r) => r.id === 'r-cb')!.blocks[0]!.items[0]!.exerciseId).toBe('bench_press');
  await dlg.getByRole('button', { name: '맞춘 루틴 적용하기' }).click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r-cb')!.blocks.flatMap((b) => b.items).reduce((s, i) => s + i.sets, 0)).toBe(29);
  const saved = (await routines(page)).find((r) => r.id === 'r-cb')!;
  expect(saved.blocks[0]!.items[0]!.exerciseId).toBe('bench_press');
  expect(saved.blocks.flatMap((b) => b.items)).toHaveLength(12);
  await expect(page.getByTestId('pace-line')).toContainText('목표 75분 안');
  // 편집 화면 예상은 한 모양(약 N분): 내 속도가 먼저, 앱 기본 예상은 이름을 붙여
  await expect(page.getByTestId('editor-app-est')).toHaveText(/^앱 기본 예상 약 \d+분 \(웜업 8분 포함\)$/);
  await checkScreen(page, 'u12-fit-applied');
});

test('맞추기 창 PC 1280×860: 높이 제한, [취소]·[적용]이 창 아래에 붙어 보임', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const pc = await ctx.newPage();
  await pc.goto('./#/');
  await pc.getByRole('button', { name: '알겠어요' }).click();
  await idbPut(pc, 'workouts', [past('p1', 1), past('p2', 3), past('p3', 5), past('p4', 7)]);
  await idbPut(pc, 'routines', [{ ...chestBack, estimatedSec: 152 * 60 }]);
  await pc.reload();
  await pc.getByTestId('home-next').getByRole('button', { name: '가슴+등 75분 내 시간에 맞추기' }).click();
  const dlg = pc.getByRole('dialog', { name: '내 시간에 맞추기' });
  await expect(dlg.getByRole('listitem')).toHaveCount(12);
  const box = (await dlg.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(721);
  await expect(dlg.getByRole('button', { name: '맞춘 루틴 적용하기' })).toBeInViewport();
  await expect(dlg.getByRole('button', { name: '취소' })).toBeInViewport();
  const ok = (await dlg.getByRole('button', { name: '맞춘 루틴 적용하기' }).boundingBox())!;
  expect(ok.y + ok.height).toBeLessThanOrEqual(box.y + box.height + 1);
  await pc.screenshot({ path: `reports/screens/${test.info().project.name}-u12b-fit-pc.png` });
  await ctx.close();
});

test('D-067 기록이 3회보다 적으면 내 속도 줄은 안 보임', async ({ page }) => {
  await idbPut(page, 'workouts', [past('p1', 1), past('p2', 3)]);
  await idbPut(page, 'routines', [{ ...chestBack, estimatedSec: 152 * 60 }]);
  await page.reload();
  await expect(page.getByRole('group', { name: '루틴 가슴+등 75분' })).toBeVisible();
  await expect(page.getByTestId('pace-line')).toHaveCount(0);
  // 내 속도가 없으면 앱 기본 예상은 그대로 (다음 운동·목록 카드)
  await expect(page.getByTestId('home-next').locator('.next-meta')).toHaveText('운동 12개 · 약 152분');
  await expect(page.getByRole('group', { name: '루틴 가슴+등 75분' })).toContainText('운동 12개 · 약 152분');
});

test('D-067 같은 이름 루틴: 오래된 것 [숨기기](묻지 않고 바로 숨김·[되돌리기]) · [이름 바꾸기]', async ({ page }) => {
  await idbPut(page, 'routines', [
    routine('r-old', '이두+삼두+어깨 75분.2', [one('barbell_curl', 3)], 3 * DAY), routine('r-new', '이두+삼두+어깨 75분.2', [one('hammer_curl', 3)], DAY),
    routine('r-b1', '하체 75분', [one('back_squat', 3)], 4 * DAY), routine('r-b2', '하체 75분', [one('hack_squat', 3)], 2 * DAY),
  ]);
  await page.reload();
  // 홈 목록에도 나오고, 내 루틴 화면에서도
  await expect(page.getByTestId('dup-note')).toHaveCount(2);
  await page.getByRole('button', { name: /내 루틴 모두 보기/ }).click();
  await expect(page).toHaveURL(/#\/routines$/);
  await expect(page.getByRole('button', { name: '+ 플랜' })).toBeVisible();
  const notes = page.getByTestId('dup-note');
  await expect(notes).toHaveCount(2);
  await checkScreen(page, 'u13-dup-notice');
  await notes.filter({ hasText: '이두+삼두+어깨' }).getByRole('button', { name: /숨기기$/ }).click();
  // 되돌릴 수 있어 묻지 않고 바로 숨김 → [되돌리기] 알림
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '되돌리기' })).toBeVisible();
  await expect(notes).toHaveCount(1);
  await expect.poll(async () => ((await idbAll(page, 'settings'))[0] as { routineHidden?: string[] }).routineHidden).toEqual(['r-old']);
  // 이름 바꾸기
  await notes.getByRole('button', { name: /이름 바꾸기$/ }).click();
  const sh = page.getByRole('dialog', { name: '루틴 이름 바꾸기' });
  await expect(sh.getByLabel('새 루틴 이름')).toHaveValue('하체 75분 (이전)');
  await sh.getByLabel('새 루틴 이름').fill('하체 75분 옛날');
  await sh.getByRole('button', { name: '이름 바꾸기' }).click();
  await expect(notes).toHaveCount(0);
  await expect.poll(async () => (await routines(page)).find((r) => r.id === 'r-b1')?.name).toBe('하체 75분 옛날');
  expect((await routines(page)).find((r) => r.id === 'r-b2')?.name).toBe('하체 75분');
});

/** 루틴으로 시작한 진행 중 운동 + 루틴에 없는 운동(해머 컬) 하나 더함 */
function activeFrom(rid: string, wid: string) {
  const now = Date.now();
  const s = (done: boolean, k: number) => ({ warmup: false, done, weight: 40, reps: 10, ...(done ? { doneAt: iso(now - (10 - k) * MIN) } : {}) });
  const blk = (ex: string, sets: Row[]) => ({ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: ex, target: { sets: 2, reps: 10 }, sets }] });
  return { id: wid, routineId: rid, name: '팔 75분', startedAt: iso(now - 20 * MIN), timer: null,
    blocks: [blk('barbell_curl', [s(true, 1), s(true, 2)]), blk('long_rope_pushdown', [s(true, 3), s(false, 0)]), blk('hammer_curl', [s(true, 4), s(true, 5)])] };
}
const armR = (id: string) => routine(id, '팔 75분', [one('barbell_curl', 2), one('long_rope_pushdown', 2)]);

for (const pick of ['루틴 업데이트', '원래대로', '새 루틴으로 저장'] as const) {
  test(`D-068 끝낼 때 루틴 반영: 운동을 더했으면 묻기 → [${pick}]`, async ({ page }) => {
    const rid = `r-arm-${pick.length}`;
    await idbPut(page, 'routines', [armR(rid)]);
    await idbPut(page, 'workouts', [activeFrom(rid, `w-arm-${pick.length}`)]);
    await page.reload();
    await page.getByRole('link', { name: '운동', exact: true }).click();
    await page.getByRole('button', { name: '끝내기', exact: true }).click();
    await page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
    const dlg = page.getByRole('dialog', { name: '루틴에 반영할까요?' });
    await expect(dlg).toContainText('이번 운동이 「팔 75분」 루틴과 달라요.');
    await expect(dlg).toContainText('추가: 해머 컬');
    await expect(dlg).toContainText('운동 목록·순서와 세트 수를 이번 운동대로 바꿔요 (무게·횟수는 넣지 않아요)');
    await expect(page.getByText('최근 운동')).toBeVisible(); // 끝내기는 이미 됨 (홈)
    if (pick === '루틴 업데이트') await checkScreen(page, 'u14-routine-update-ask');
    await dlg.getByRole('button', { name: pick }).click();
    await expect(dlg).toHaveCount(0);
    const all = await routines(page);
    const r = all.find((x) => x.id === rid)!;
    if (pick === '루틴 업데이트') {
      await expect.poll(async () => (await routines(page)).find((x) => x.id === rid)!.blocks.length).toBe(3);
      await expect(page.getByText('「팔 75분」 루틴을 업데이트했어요')).toBeVisible();
    } else if (pick === '원래대로') {
      expect(r.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['barbell_curl', 'long_rope_pushdown']);
      expect(all).toHaveLength(1);
    } else {
      await expect.poll(async () => (await routines(page)).length).toBe(2);
      const n = (await routines(page)).find((x) => x.id !== rid)!;
      expect(n.name).toMatch(/^팔 75분 \(\d+월 \d+일\)$/);
      expect(n.blocks.map((b) => b.items[0]!.exerciseId)).toEqual(['barbell_curl', 'long_rope_pushdown', 'hammer_curl']);
      expect(r.blocks).toHaveLength(2);
    }
  });
}

test('P4 운동 중 루틴이 바뀌었으면 [루틴 업데이트] 없이 경고, 기본은 원래대로 → [새 루틴으로 저장]', async ({ page }) => {
  // 루틴이 운동 시작(20분 전) 뒤인 5분 전에 고쳐짐 (다른 화면·기기)
  await idbPut(page, 'routines', [{ ...armR('r-chg'), updatedAt: iso(Date.now() - 5 * MIN) }]);
  await idbPut(page, 'workouts', [activeFrom('r-chg', 'w-chg')]);
  await page.reload();
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  await page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
  const dlg = page.getByRole('dialog', { name: '운동 중 루틴이 바뀌었어요' });
  await expect(dlg).toContainText('추가: 해머 컬');
  await expect(dlg.getByRole('button', { name: '루틴 업데이트' })).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: '원래대로' })).toBeFocused();
  await checkScreen(page, 'u14b-routine-changed-during');
  await dlg.getByRole('button', { name: '새 루틴으로 저장' }).click();
  await expect.poll(async () => (await routines(page)).length).toBe(2);
  expect((await routines(page)).find((x) => x.id === 'r-chg')!.blocks).toHaveLength(2);
});

test('D-068 무게·횟수만 바뀌었으면 묻지 않음', async ({ page }) => {
  const w = activeFrom('r-same', 'w-same');
  w.blocks.pop();
  await idbPut(page, 'routines', [armR('r-same')]);
  await idbPut(page, 'workouts', [w]);
  await page.reload();
  await page.getByRole('link', { name: '운동', exact: true }).click();
  await page.getByRole('button', { name: '끝내기', exact: true }).click();
  await page.getByRole('dialog', { name: '운동을 끝낼까요?' }).getByRole('button', { name: '끝내기' }).click();
  await expect(page.getByText('최근 운동')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog', { name: '루틴에 반영할까요?' })).toHaveCount(0);
});

test('묶음 카드: 운동 글자(A·B)와 등급 배지를 구분 ("등급 S" 이름 뒤)', async ({ page }) => {
  const now = Date.now();
  const st = { warmup: false, done: false, weight: 20, reps: 10 };
  await idbPut(page, 'workouts', [{ id: 'w-ss', name: '묶음 시험', startedAt: iso(now - MIN), timer: null,
    blocks: [{ kind: 'superset', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [
      { exerciseId: 'barbell_curl', target: { sets: 2, reps: 10 }, sets: [st, st] }, { exerciseId: 'long_rope_pushdown', target: { sets: 2, reps: 10 }, sets: [st, st] }] }] }]);
  await page.reload();
  await page.getByRole('link', { name: '운동', exact: true }).click();
  const head = page.locator('.grp-item .wk-item-head').first();
  await expect(head.locator('strong')).toHaveText('A. 바벨 컬');
  const badge = head.locator('.badge.grade-tag');
  await expect(badge).toContainText('등급');
  await expect(badge).toHaveAttribute('aria-label', /^등급 /);
  // 글자가 배지보다 앞(왼쪽)
  const [lx, bx] = await Promise.all([head.locator('strong').boundingBox(), badge.boundingBox()]);
  expect(lx!.x).toBeLessThan(bx!.x);
  await checkScreen(page, 'u15-group-grade-badge');
});

test('D-078 기록 탭에서 운동 기록 직접 작성 (진입, 종목 추가, 세트 입력, 저장 및 상세 확인)', async ({ page }) => {
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기록', exact: true })).toBeVisible();

  // 헤더의 운동 기록 직접 작성 버튼 클릭
  const addBtn = page.getByRole('button', { name: '운동 기록 직접 작성' }).first();
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  await expect(page.getByRole('heading', { name: '운동 기록 직접 작성' })).toBeVisible();
  await checkScreen(page, 'd078-manual-workout-form');

  // 운동 추가
  await page.getByRole('button', { name: '+ 운동 추가' }).click();
  const picker = page.getByRole('dialog', { name: '운동 추가' });
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: '운동 검색' }).fill('바벨 벤치프레스');
  await picker.getByRole('button', { name: '바벨 벤치프레스', exact: true }).click();

  // 바벨 벤치프레스 카드 및 기본 세트 확인
  await expect(page.getByText('바벨 벤치프레스', { exact: true })).toBeVisible();

  // 세트 추가
  await page.getByRole('button', { name: '바벨 벤치프레스 세트 추가' }).click();

  // 저장
  await page.getByRole('button', { name: '기록 저장하기', exact: true }).click();

  // 저장 후 운동 상세 화면으로 이동 확인
  await expect(page.locator('main')).toContainText('바벨 벤치프레스');
  await checkScreen(page, 'd078-manual-workout-detail');

  // 기록 목록으로 돌아가서 카드 확인
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByText('바벨 벤치프레스')).toBeVisible();
});

test('D-078 빈 기록 상태에서 직접 작성 진입 및 취소 확인', async ({ page }) => {
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기록', exact: true })).toBeVisible();

  // 빈 상태의 직접 작성 버튼
  const emptyAdd = page.getByRole('button', { name: '직접 작성', exact: true });
  await expect(emptyAdd).toBeVisible();
  await emptyAdd.click();

  await expect(page.getByRole('heading', { name: '운동 기록 직접 작성' })).toBeVisible();

  // 수정 없이 취소 클릭 시 확인창 없이 바로 기록 탭으로 복귀
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('heading', { name: '기록', exact: true })).toBeVisible();
});

