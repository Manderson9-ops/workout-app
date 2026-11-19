/**
 * D-082 기록 요약 탭 2차 개선 (SPEC docs/mockups/records/SPEC.md '시험 항목'): 승인 목업의 상황 11개를 시험 데이터로 옮겨 단위(주·월·년·전체) × 보기(누적·막대·막대+누적)를 돈다.
 * 기대값은 e2e/fixtures/recordsOracle.ts 가 SPEC 식으로 따로 계산하고(숫자), 한 문장 틀은 승인된 목업 문구 그대로 쓴다. 하네스 상수는 tests/recordsOracle.test.ts 에서 대조만 한다.
 * 한 상황의 상태들은 새로 고침 없이 이어서 돌린다 (화면 상태를 한 번에 읽어 오라클과 견줌)
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SCEN_IDS, gen, toWorkout } from './fixtures/recordsMock';
import type { MockRow } from './fixtures/recordsMock';
import { KINDS, KIND_BUTTON, METRICS, MODES, MODE_BUTTON, LOAD_NOTE, ZONE_NAME, expectView, histOf, loadExpect } from './fixtures/recordsOracle';
import type { Kind, Metric, Mode, ViewExpect } from './fixtures/recordsOracle';
import { touchTargets } from './helpers';

test.use({ timezoneId: 'Asia/Seoul', locale: 'ko-KR' }); // 날짜 계산이 시험 PC 의 시간대·언어에 안 흔들리게
type Row = Record<string, unknown>;
const idbPut = (page: Page, store: string, rows: Row[]) => page.evaluate(async ([s, rs]) => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('workout-app'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise<void>((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}, [store, rows] as const);

/** 시각을 그 날 낮 12시(한국)로 고정하고 기록을 저장소에 넣은 뒤 기록 → 요약 탭을 연다 */
async function open(page: Page, W: MockRow[], today: string) {
  await page.clock.setFixedTime(new Date(`${today}T12:00:00+09:00`));
  await page.goto('./#/');
  await expect(page.getByText('기록은 이 기기에만 저장돼요')).toBeVisible();
  await page.getByRole('button', { name: '알겠어요' }).click();
  await idbPut(page, 'workouts', W.map((r) => toWorkout(r)));
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('this-week')).toBeVisible();
}

const card = (page: Page) => page.getByTestId('this-week');
const unitBtn = (page: Page, k: Kind) => card(page).getByRole('group', { name: '기간 단위' }).getByRole('button', { name: KIND_BUTTON[k], exact: true });
const viewBtn = (page: Page, m: Mode) => page.getByTestId(`view-${m}`);

/** 화면 상태 한 번 읽기 (브라우저 안에서 글자·개수만 모음) */
interface Snap {
  label: string | null; range: string | null; heroLabel: string | null; hero: string | null; headline: string | null; subs: string[];
  cards: { hero: string; small: string[]; glyph: string }[]; note: boolean; foot: string | null; caption: string | null; legend: string[] | null; avg: string | null;
  chart: string; emptyText: string | null; counts: Record<'cur' | 'prev' | 'bar' | 'polyCur' | 'polyPrev' | 'end' | 'slider', number>;
  kinds: string[]; modes: string[]; metrics: string[];
  hist: { title: string | null; rows: { d: string; n: string; m: string }[]; more: string | null; empty: string | null };
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => {
  const tid = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const txt = (id: string) => tid(id)?.textContent ?? null;
  const n = (sel: string) => document.querySelectorAll(sel).length;
  const root = tid('this-week')!;
  const pressed = (els: Element[]) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent ?? '');
  const lg = tid('period-legend');
  return {
    label: txt('period-label'), range: txt('period-range'), heroLabel: txt('period-hero-label'), hero: txt('period-hero'), headline: txt('period-headline'),
    subs: [...document.querySelectorAll('[data-testid="period-sub"]')].map((e) => e.textContent ?? ''),
    cards: ['count', 'sets', 'volume', 'time'].map((m) => {
      const c = tid(`pm-${m}`)!;
      return { hero: c.querySelector('.m-val')?.textContent ?? '', small: [...c.querySelectorAll('.pm-prev')].map((e) => e.textContent ?? ''), glyph: c.querySelector('.pm-badge')?.textContent ?? '' };
    }),
    note: !!tid('pm-note'), foot: txt('period-foot'), caption: txt('period-caption'),
    legend: lg ? [...lg.querySelectorAll('.ps-lg-i')].map((e) => e.textContent ?? '') : null, avg: txt('period-avg'),
    chart: tid('period-chart') ? (tid('period-chart')!.getAttribute('role') === 'slider' ? 'bars' : 'chart?') : tid('period-cum') ? 'cum' : tid('period-chart-empty') ? 'empty' : 'none',
    emptyText: txt('period-chart-empty'),
    counts: { cur: n('rect.pb-cur'), prev: n('rect.pb-prev'), bar: n('rect.pb-bar'), polyCur: n('polyline.pb-cum.cur'), polyPrev: n('polyline.pb-cum.prev'), end: n('circle.pb-cum-end'), slider: n('[role="slider"][data-testid="period-chart"]') },
    kinds: pressed([...root.querySelectorAll('.ps-seg button')]), modes: pressed([...root.querySelectorAll('.ps-viewseg button')]), metrics: pressed([...root.querySelectorAll('.pm-card')]),
    hist: {
      title: txt('history-title'),
      rows: [...document.querySelectorAll('[data-testid="history-row"]')].map((r) => ({ d: r.querySelector('.ph-d')?.textContent ?? '', n: r.querySelector('.ph-n')?.textContent ?? '', m: r.querySelector('.ph-m')?.textContent ?? '' })),
      more: txt('history-more'), empty: txt('history-empty'),
    },
  };
});

/** 요약 탭 카드 세로 위치: 기간 카드 → 훈련 부하 → 회복 → 기간 내역 (SPEC #2). 내역이 비면 제목이 없어 '기간 내역' h2 로 대신 */
const cardTops = (page: Page): Promise<Record<'period' | 'load' | 'recovery' | 'history', number | null>> => page.evaluate(() => {
  const top = (e: Element | null | undefined) => (e ? e.getBoundingClientRect().top : null);
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const hist = q('history-title') ?? [...document.querySelectorAll('h2')].find((h) => h.textContent === '기간 내역');
  return { period: top(q('this-week')), load: top(q('load-card')), recovery: top(q('recovery-card')), history: top(hist) };
});

/** 막대+누적 그래프의 svg 기하: 글씨 y(기준선 위 글씨 = 눈금), 막대 맨 위 y, 두 누적선 맨 위 y (둘 다 svg 속성에서 읽음, 고정 픽셀 없음) */
const bothGeom = (page: Page) => page.getByTestId('period-chart').locator('svg').evaluate((svg) => {
  const num = (e: Element, a: string) => Number(e.getAttribute(a));
  const base = num(svg.querySelector('line.ch-grid')!, 'y1');
  const rects = [...svg.querySelectorAll('rect.pb-prev, rect.pb-cur')];
  const pts = [...svg.querySelectorAll('polyline.pb-cum')].flatMap((p) => (p.getAttribute('points') ?? '').split(' ').map((s) => Number(s.split(',')[1])));
  return {
    base, textsAboveBase: [...svg.querySelectorAll('text')].filter((t) => num(t, 'y') < base).map((t) => t.textContent ?? ''), allTexts: svg.querySelectorAll('text').length,
    barTop: rects.length ? Math.min(...rects.map((r) => num(r, 'y'))) : NaN, barH: rects.length ? Math.max(...rects.map((r) => num(r, 'height'))) : NaN,
    barBottoms: rects.map((r) => num(r, 'y') + num(r, 'height')), lineTop: pts.length ? Math.min(...pts) : NaN, h: num(svg, 'height'),
  };
});

const ws = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const nows = (s: string | null) => (s ?? '').replace(/\s+/g, '');

/** 화면(snap)과 오라클(e) 차이 목록. 비어 있어야 통과 */
function diffs(s: Snap, e: ViewExpect, kind: Kind, mode: Mode): string[] {
  const out: string[] = [];
  const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${name}: 화면 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`); };
  eq('눌린 단위', s.kinds, [KIND_BUTTON[kind]]); eq('눌린 보기', s.modes, [MODE_BUTTON[mode]]);
  eq('기간 이름', ws(s.label), e.label); eq('범위 줄', ws(s.range), e.range);
  eq('큰 숫자 이름', ws(s.heroLabel), e.heroLabel); eq('큰 숫자', nows(s.hero), nows(e.hero));
  eq('한 문장', ws(s.headline), e.headline);
  eq('둘째 줄', s.subs.map(ws), e.subs);
  e.cards.forEach((c, i) => {
    eq(`카드 ${c.metric} 큰 숫자`, nows(s.cards[i]!.hero), nows(c.hero));
    eq(`카드 ${c.metric} 작은 줄`, s.cards[i]!.small.map(ws), c.small);
    eq(`카드 ${c.metric} ▲▼`, s.cards[i]!.glyph, c.glyph);
  });
  eq('안내(pm-note) 보임', s.note, e.noteShown);
  const foot = ws(s.foot);
  if (e.foot.exact !== undefined) eq('각주', foot, e.foot.exact);
  if (e.foot.includes !== undefined && !foot.includes(e.foot.includes)) out.push(`각주: ${JSON.stringify(foot)} 에 ${JSON.stringify(e.foot.includes)} 없음`);
  if (e.foot.startsWith !== undefined && !foot.startsWith(e.foot.startsWith)) out.push(`각주: ${JSON.stringify(foot)} 가 ${JSON.stringify(e.foot.startsWith)} 로 시작하지 않음`);
  eq('눌린 지표 카드 수', s.metrics.length, 1);
  eq('그래프 종류', s.chart, e.chart);
  if (e.chart === 'empty') eq('빈 그래프 문구', ws(s.emptyText), e.emptyText);
  eq('그래프 안내(caption)', ws(s.caption), e.caption);
  eq('범례', s.legend ? s.legend.map(ws) : null, e.legend);
  eq('평균 범례', s.avg === null ? null : ws(s.avg), e.avg);
  eq('슬라이더(누적 보기에는 없음)', s.counts.slider, mode === 'cum' || e.chart === 'empty' ? 0 : 1);
  if (e.chart !== 'empty') {
    if (mode === 'both') { eq('rect.pb-cur 수', s.counts.cur, e.counts.cur); eq('rect.pb-prev 수', s.counts.prev, e.counts.prev); }
    if (mode === 'bar') eq('rect.pb-bar 수', s.counts.bar, e.counts.slots);
    else eq('rect.pb-bar 수(막대 보기가 아님)', s.counts.bar, 0);
    if (mode !== 'bar') { eq('polyline.pb-cum.cur 수', s.counts.polyCur, e.counts.polyCur); eq('polyline.pb-cum.prev 수', s.counts.polyPrev, e.counts.polyPrev); eq('circle.pb-cum-end 수', s.counts.end, e.counts.end); }
    else eq('누적선 없음(막대 보기)', s.counts.polyCur + s.counts.polyPrev + s.counts.end, 0);
  }
  eq('내역 제목', ws(s.hist.title), e.hist.title);
  eq('내역 행', s.hist.rows.map((r) => ({ d: ws(r.d), n: ws(r.n), m: ws(r.m) })), e.hist.rows);
  eq('더 보기', s.hist.more === null ? null : ws(s.hist.more), e.hist.more);
  eq('내역 빈 상태', s.hist.empty === null ? null : ws(s.hist.empty), e.hist.empty);
  return out;
}

/** 지금 화면이 오라클과 같아질 때까지 (한 번에 그려지므로 보통 첫 읽기에서 통과) */
async function verify(page: Page, W: MockRow[], today: string, kind: Kind, metric: Metric, mode: Mode, sel: number | null = null) {
  const e = expectView(W, today, kind, metric, mode, sel);
  await expect.poll(async () => diffs(await snap(page), e, kind, mode), { message: `${today} ${KIND_BUTTON[kind]} / ${metric} / ${MODE_BUTTON[mode]}`, timeout: 8000 }).toEqual([]);
}

// ---------- 상황 11개 × 단위 4 × 보기 3 ----------
for (const sc of SCEN_IDS) {
  const { W, today } = gen(sc);

  test(`${sc}: 단위 4 × 보기 3 (이름·범위·큰 숫자·한 문장·둘째 줄·카드·범례·막대 수·내역)`, async ({ page }) => {
    await open(page, W, today);
    const t = await cardTops(page); // SPEC #2: 위에서 아래로 기간 카드 → 훈련 부하 → 회복 → 내역
    expect(Object.values(t).every((y) => y !== null), `카드 4개 모두 있음 ${JSON.stringify(t)}`).toBe(true);
    expect(t.period! < t.load! && t.load! < t.recovery! && t.recovery! < t.history!, `카드 순서 기간<부하<회복<내역 ${JSON.stringify(t)}`).toBe(true);
    for (const kind of KINDS) {
      await unitBtn(page, kind).click();
      for (const mode of MODES) {
        await viewBtn(page, mode).click();
        await verify(page, W, today, kind, 'sets', mode);
        if (mode === 'both' && await page.getByTestId('period-chart').count()) {
          const g = await bothGeom(page);
          const tag = `${sc} ${KIND_BUTTON[kind]} 막대+누적`;
          expect(g.textsAboveBase, `${tag}: 눈금·최댓값 글씨 없음 (기준선 위 <text>)`).toEqual([]);
          if (sc === 'normal' && kind === 'week') { // SPEC #7: 막대 높이는 두 막대 최댓값, 선 높이는 두 누적선 최댓값을 따로 기준으로
            expect(Number.isFinite(g.barTop) && Number.isFinite(g.lineTop), `${tag}: 막대·누적선 있음 ${JSON.stringify(g)}`).toBe(true);
            expect(Math.max(...g.barBottoms) - g.barTop, `${tag}: 가장 높은 막대 = 그래프 전체 높이(기준선~맨 위)`).toBeCloseTo(g.base - Math.min(g.barTop, g.lineTop), 0);
            expect(g.lineTop, `${tag}: 누적선 맨 위 = 그래프 맨 위 (가장 높은 막대 위와 같음)`).toBeCloseTo(g.barTop, 0);
          }
        }
      }
      // 다른 지표 3개 (막대+누적 보기): 문장·큰 숫자·카드는 지표마다 다름. 지표를 바꿔도 보기는 그대로
      for (const metric of ['count', 'volume', 'time'] as const) {
        await card(page).getByTestId(`pm-${metric}`).click();
        await verify(page, W, today, kind, metric, 'both');
      }
      await card(page).getByTestId('pm-sets').click();
    }
  });

  test(`${sc}: 훈련 부하 카드 (숫자·구간·지난주 줄·해설 괄호·7일 점)`, async ({ page }) => {
    await open(page, W, today);
    const l = loadExpect(W, today), load = page.getByTestId('load-card');
    await expect(load.getByTestId('load-note')).toHaveText(LOAD_NOTE);
    if (!l.show) {
      await expect(load.getByTestId('load-wait')).toHaveText(l.wait);
      await expect(load.getByTestId('load-body')).toHaveCount(0);
      return;
    }
    await expect(load.getByTestId('load-wait')).toHaveCount(0);
    await expect(load.getByTestId('load-ratio')).toHaveText(l.ratio!);
    await expect(load.getByTestId('load-zone')).toHaveText(l.zoneName!);
    await expect(load.getByTestId('load-zone')).toHaveClass(new RegExp(`\\b${l.zone}\\b`));
    await expect(load.getByTestId('load-week')).toHaveText(l.week!);
    await expect(load.getByTestId('load-say')).toHaveText(l.say!);
    const mk = await load.locator('.load-mk').evaluate((el) => (el as HTMLElement).style.left);
    expect(Number(/calc\(([\d.]+)%/.exec(mk)?.[1]), '띠 위치(%)').toBeCloseTo(l.mk!, 6);
    const dots = await load.locator('svg').evaluate((svg) => ({
      vals: [...svg.querySelectorAll('text.ch-val:not(.ld-today-text)')].map((t) => t.textContent ?? ''),
      none: [...svg.querySelectorAll('text.ch-text')].filter((t) => t.textContent === '–').length,
      prev: svg.querySelectorAll('circle.ld-prev-dot').length,
      today: svg.querySelector('circle.ld-today')?.getAttribute('class') ?? '',
    }));
    expect(dots.vals, '7일 점 값').toEqual(l.rs!.filter((x) => x !== null).map((x) => x!.toFixed(2)));
    expect(dots.none, '비율 없는 날 "–"').toBe(l.rs!.filter((x) => x === null).length);
    expect(dots.prev, '지난주 같은 요일 점 수').toBe(l.rp!.filter((x) => x !== null).length);
    expect(dots.today, '오늘 점 구간 색').toContain(l.zone!);
    expect(ZONE_NAME[l.zone!]).toBe(l.zoneName); // 오라클 자체 점검
  });
}

// ---------- 그래프 초점·화살표·고른 칸 문구 ----------
test('normal 주·막대+누적: 그래프 초점 → ArrowRight → SPEC #7 문구(지난주 값 포함)·aria-valuetext·내역 제목, 지표 바꿔도 고른 칸 유지', async ({ page }) => {
  const { W, today } = gen('normal');
  await open(page, W, today);
  const chart = page.getByTestId('period-chart'), cap = card(page).getByTestId('period-caption');
  await verify(page, W, today, 'week', 'sets', 'both');
  await chart.focus();
  await page.keyboard.press('ArrowRight'); // 고른 칸이 없으면 첫 화살표는 오늘(화) 칸을 고름
  await verify(page, W, today, 'week', 'sets', 'both', 2);
  const want2 = expectView(W, today, 'week', 'sets', 'both', 2).caption;
  expect(want2).toMatch(/^11월 17일 \(화\) · 작업 세트 12세트 · 누적 \d[\d,]*세트 · 지난주 같은 요일 \d[\d,]*세트$/); // 오늘 12세트(목업 규칙), 문구 틀 = SPEC #7
  await expect(cap).toHaveText(want2);
  await expect(chart).toHaveAttribute('aria-valuetext', want2);
  await expect(chart).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByTestId('history-title')).toHaveText('11월 17일 운동 1개');
  await page.keyboard.press('ArrowLeft'); // 월
  const want1 = expectView(W, today, 'week', 'sets', 'both', 1).caption;
  await verify(page, W, today, 'week', 'sets', 'both', 1);
  await expect(chart).toHaveAttribute('aria-valuetext', want1);
  expect(want1).toContain('지난주 같은 요일');
  // 지표를 바꿔도 고른 칸이 그대로 (0.9.17 동작): 볼륨 값으로 다시 쓰인 같은 칸 문구
  await card(page).getByTestId('pm-volume').click();
  await verify(page, W, today, 'week', 'volume', 'both', 1);
  await expect(chart).toHaveAttribute('aria-valuetext', expectView(W, today, 'week', 'volume', 'both', 1).caption);
  await expect(chart).toHaveAttribute('aria-valuenow', '2');
  await card(page).getByTestId('pm-sets').click();
  // 해제
  await chart.focus(); await page.keyboard.press('Escape'); // 클릭으로 초점이 지표 카드로 옮겨졌으므로 그래프에 다시 초점
  await verify(page, W, today, 'week', 'sets', 'both', null);
  // 단위를 바꾸면 고른 칸을 비움
  await chart.focus(); await page.keyboard.press('ArrowLeft');
  await verify(page, W, today, 'week', 'sets', 'both', 2);
  await unitBtn(page, 'month').click();
  await verify(page, W, today, 'month', 'sets', 'both', null);
  // 막대 보기에서도 같은 칸 문구 틀(앱 문구: 운동 횟수 덧붙임)
  await viewBtn(page, 'bar').click();
  await page.getByTestId('period-chart').focus(); await page.keyboard.press('ArrowLeft');
  await verify(page, W, today, 'month', 'sets', 'bar', 16); // 11월 17일 = 17번째 칸
});

// ---------- 내역 ----------
test('normal 내역: 행·5개씩 더 보기·초점·행을 누르면 그 기록 상세', async ({ page }) => {
  const { W, today } = gen('normal');
  await open(page, W, today);
  await unitBtn(page, 'year').click();
  const e0 = expectView(W, today, 'year', 'sets', 'both').hist;
  expect(e0.total).toBeGreaterThan(15);
  const rows = page.getByTestId('history-row'), more = page.getByTestId('history-more');
  let shown = 5;
  for (;;) {
    const e = histOf(W, today, '2026-01-01', '2027-01-01', '올해', shown);
    await expect(page.getByTestId('history-title')).toHaveText(e.title);
    await expect(rows).toHaveCount(Math.min(shown, e.total));
    if (e.more === null) { await expect(more).toHaveCount(0); break; }
    await expect(more).toHaveText(e.more);
    await more.click();
    shown += 5;
  }
  await expect(page.getByTestId('history-title')).toBeFocused(); // 다 펼치면 눌렀던 버튼이 사라져 초점을 제목으로
  await unitBtn(page, 'month').click(); // 보기를 바꾸면 다시 5개
  await expect(rows).toHaveCount(5);
  await rows.first().click();
  await expect(page).toHaveURL(/#\/stats\/w\/rm-2026-11-17$/);
});

// ---------- 시간 지표: 화면에 보이는 값끼리 견줌 (D-081) ----------
test('시간 지표: 보이는 분 끼리 방향·차이·같음이 문장·카드·남은 양에서 같은 말을 한다 (주 2분 짧아요, 월 같아요)', async ({ page }) => {
  const r = (date: string, time: number): MockRow => ({ date, name: '시간 시험', sets: 3, volume: 1500, time });
  // 주: 오늘(화) 3,629초(60.48분→60분) vs 지난주 화 3,691초(61.52분→62분) → 보이는 값 차이 2분 (원래 값 차이는 1분 2초)
  // 월: 11월 합 7,320초(122분) vs 10월 1~17일 합 7,340초(122.33분→122분) → 보이는 값이 같음 (원래 값은 20초 다름)
  const W: MockRow[] = [r('2026-01-05', 3600), r('2026-10-06', 3670), r('2026-10-13', 3670), r('2026-11-10', 3691), r('2026-11-17', 3629)];
  const today = '2026-11-17';
  await open(page, W, today);
  await card(page).getByTestId('pm-time').click();
  await verify(page, W, today, 'week', 'time', 'both');
  await expect(card(page).getByTestId('period-headline')).toHaveText('이번 주: 지난주 이맘때보다 시간이 2분 짧아요');
  await expect(card(page).getByTestId('pm-time').locator('.pm-badge')).toHaveText('▼');
  await unitBtn(page, 'month').click();
  await verify(page, W, today, 'month', 'time', 'both');
  await expect(card(page).getByTestId('period-headline')).toHaveText('이번 달: 지난달 이맘때와 시간이 같아요');
  await expect(card(page).getByTestId('pm-time').locator('.pm-badge')).toHaveText('=');
  await expect(card(page).getByTestId('period-sub')).toHaveText('지난달 전체(2시간 2분)를 넘었어요'); // 남은 양도 보이는 값끼리: 122분 vs 122분 → 남은 양 0 이하
});

// ---------- 보기 저장 ----------
test('보기 저장: 처음 막대+누적 → 막대 → 새로 고침 → 막대, 옛 값(mode 없음)은 막대+누적', async ({ page }) => {
  const { W, today } = gen('normal');
  await open(page, W, today);
  await expect(viewBtn(page, 'both')).toHaveAttribute('aria-pressed', 'true'); // 처음
  await expect(viewBtn(page, 'bar')).toHaveAttribute('aria-pressed', 'false');
  await viewBtn(page, 'bar').click();
  await expect(viewBtn(page, 'bar')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(card(page)).toBeVisible();
  await expect(viewBtn(page, 'bar')).toHaveAttribute('aria-pressed', 'true'); // 마지막에 고른 보기를 기억
  await expect(viewBtn(page, 'both')).toHaveAttribute('aria-pressed', 'false');
  await unitBtn(page, 'all').click(); // 전체 탭도 저장됨
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(unitBtn(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  // 옛 저장값
  await page.evaluate(() => localStorage.setItem('stats.period.v1', '{"kind":"month","metric":"volume"}'));
  await page.reload();
  await page.getByRole('link', { name: '기록', exact: true }).click();
  await expect(card(page)).toBeVisible();
  await expect(unitBtn(page, 'month')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('pm-volume')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewBtn(page, 'both')).toHaveAttribute('aria-pressed', 'true');
  await verify(page, W, today, 'month', 'volume', 'both');
});

// ---------- 375px · 320px ----------
for (const w of [375, 320]) {
  for (const sc of ['normal', 'monthend'] as const) {
    test(`${w}px ${sc}: 단위 4 × 막대+누적 — 가로 스크롤 없음, 카드·범례·둘째 줄이 카드 안, 월 파랑 막대 ≥5px, 터치 44pt`, async ({ page }) => {
      const { W, today } = gen(sc);
      await open(page, W, today);
      await page.setViewportSize({ width: w, height: 800 });
      for (const kind of KINDS) {
        await unitBtn(page, kind).click();
        await viewBtn(page, 'both').click();
        await verify(page, W, today, kind, 'sets', 'both');
        const tag = `${w}px ${sc} ${KIND_BUTTON[kind]}`;
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth), `${tag} 가로 스크롤 없음`).toBe(true);
        const box = (await card(page).boundingBox())!;
        const inside = (b: { x: number; width: number }) => b.x >= box.x - 0.5 && b.x + b.width <= box.x + box.width + 0.5;
        for (const m of METRICS) {
          const c = card(page).getByTestId(`pm-${m}`), cb = (await c.boundingBox())!;
          const within = (b: { x: number; width: number }) => b.x >= cb.x - 0.5 && b.x + b.width <= cb.x + cb.width + 0.5;
          expect(within((await c.locator('.m-val').boundingBox())!), `${tag} ${m} 큰 숫자가 카드 안`).toBe(true);
          for (const p of await c.locator('.pm-prev').all()) expect(within((await p.boundingBox())!), `${tag} ${m} 작은 줄이 카드 안`).toBe(true);
        }
        for (const lg of await card(page).locator('[data-testid="period-legend"] .ps-lg-i').all()) expect(inside((await lg.boundingBox())!), `${tag} 범례가 카드 안`).toBe(true);
        expect(await card(page).getByTestId('period-legend').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `${tag} 범례 안 넘침`).toBe(true);
        for (const s of await card(page).getByTestId('period-sub').all()) { expect(inside((await s.boundingBox())!), `${tag} 둘째 줄이 카드 안`).toBe(true); expect(await s.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `${tag} 둘째 줄 안 넘침`).toBe(true); }
        expect(inside((await card(page).getByTestId('period-chart').boundingBox())!), `${tag} 그래프가 카드 안`).toBe(true);
        if (kind === 'month') {
          await expect.poll(() => card(page).locator('rect.pb-cur').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width))), { message: `${tag} 파랑 막대 너비` }).toBeGreaterThanOrEqual(4.99);
        }
        await touchTargets(page);
      }
    });
  }
}
