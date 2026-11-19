/**
 * D-082 훈련 부하 (SPEC #5). 기대값은 시험 안에서 따로 짠 날짜 반복문(위로 세는 구간 합)으로 계산한다 — 목업·하네스 값을 복사하지 않음.
 * 문구는 승인 목업(record-mock.html zoneOf·drawLoad·고정 안내)의 글자 그대로 비교
 */
import { describe, expect, it } from 'vitest';
import { dailyWorkSets, loadRatio, loadVd, loadZone, loadView } from '../src/core/stats';
import type { LoadShown } from '../src/core/stats';
import { firstRecordDate } from '../src/core/period';
import { LOAD_EMPTY_SAY, LOAD_EMPTY_WEEK, LOAD_NOTE, LOAD_ZONE_NAME, LOAD_ZONE_SAY, loadChartLabel, loadEmptyWindows, loadSayText, loadWaitText, loadWeekText, loadWindowSets } from '../src/core/loadText';
import type { Workout, SetLog } from '../src/core/session';
import type { Exercise } from '../src/core/types';

const ex = (id: string, equipment: Exercise['equipment']): Exercise => ({ id, name_ko: id, family: id, part: '가슴', muscles: ['m'], pattern: 'H_PUSH', mechanics: 'compound', equipment });
const byId = new Map([['bench', ex('bench', ['barbell'])], ['pushup', ex('pushup', ['bodyweight'])], ['plank', ex('plank', ['bodyweight'])]]);
const set = (extra: Partial<SetLog> = {}): SetLog => ({ weight: 50, reps: 5, warmup: false, done: true, ...extra });
const many = (n: number): SetLog[] => Array.from({ length: n }, () => set());

/** 'YYYY-MM-DD' → 일 번호 (UTC) 와 되돌리기: 시험의 날짜 계산은 앱 함수를 쓰지 않음 */
const dn = (s: string): number => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86400000; };
const ds = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

function wk(id: string, date: string, sets: SetLog[], o: { exerciseId?: string; ended?: boolean } = {}): Workout {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!, 10).toISOString();
  return {
    id, name: id, startedAt: start, ...(o.ended === false ? {} : { endedAt: new Date(Date.parse(start) + 3600000).toISOString() }), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: o.exerciseId ?? 'bench', target: { sets: 3, reps: 8 }, sets }] }],
  };
}

/** 날짜 → 세트 수 목록을 운동 목록으로 */
const fromCounts = (counts: Record<string, number>): Workout[] => Object.entries(counts).map(([date, n], i) => wk(`w${i}`, date, many(n)));

/** 독립 구현: 첫 기록일 first 부터 d 까지의 부하 비율 (SPEC 식, 위로 세는 구간 합) */
function oracle(counts: Record<string, number>, first: string, d: string): number | null {
  const at = (n: number) => counts[ds(n)] ?? 0;
  const nd = Math.min(28, dn(d) - dn(first) + 1);
  if (nd < 21) return null;
  let a7 = 0;
  for (let k = dn(d) - 6; k <= dn(d); k++) a7 += at(k);
  let c = 0;
  for (let k = dn(d) - nd + 1; k <= dn(d); k++) c += at(k);
  return c === 0 ? 0 : a7 / (c / (nd / 7));
}
const fix2 = (v: number) => Number(v.toFixed(2));

const shown = (v: ReturnType<typeof loadView>): LoadShown => { if (!v.show) throw new Error('hidden'); return v; };
const view = (ws: Workout[], today: string) => loadView(ws, byId, today, firstRecordDate(ws, today));

describe('부하 비율: 첫 기록일부터 며칠째인가', () => {
  const FIRST = '2026-09-01';
  // 첫 기록일에 3세트, 이후 3일마다 3세트, 마지막 주에 몇 번 더
  const base = (n: number): Record<string, number> => {
    const c: Record<string, number> = {};
    for (let k = 0; k < n; k += 3) c[ds(dn(FIRST) + k)] = 3;
    c[ds(dn(FIRST) + n - 1)] = (c[ds(dn(FIRST) + n - 1)] ?? 0) + 4;
    c[ds(dn(FIRST) + n - 3)] = (c[ds(dn(FIRST) + n - 3)] ?? 0) + 2;
    return c;
  };
  for (const n of [20, 21, 22, 27, 28, 29]) {
    it(`${n}일째: ${n < 21 ? '숨김' : '보임'}`, () => {
      const counts = base(n);
      const today = ds(dn(FIRST) + n - 1);
      const v = view(fromCounts(counts), today);
      expect(v.histDays).toBe(n);
      expect(v.nd).toBe(Math.min(28, n));
      if (n < 21) { expect(v.show).toBe(false); return; }
      const s = shown(v);
      const want = oracle(counts, FIRST, today)!;
      expect(want).not.toBeNull();
      expect(s.vd).toBe(fix2(want));
      expect(s.zone).toBe(loadZone(fix2(want)));
      // 지난주 같은 요일은 첫 기록일부터 21일이 지나야 있음 → 28일째부터
      const prev = oracle(counts, FIRST, ds(dn(today) - 7));
      expect(s.prevVd).toBe(prev === null ? null : fix2(prev));
      expect(n >= 28).toBe(s.prevVd !== null);
    });
  }

  it('오늘 운동 전이어도 오늘이 7일에 들어간다 (a7 은 오늘 포함, R12)', () => {
    const counts: Record<string, number> = { [FIRST]: 2 };
    for (let k = 2; k <= 6; k++) counts[ds(dn(FIRST) + 21 - k)] = 3; // 오늘−2 … 오늘−6 에만 운동, 오늘(21일째 = 첫 기록 +21)은 쉼
    const today = ds(dn(FIRST) + 21);
    const s = shown(view(fromCounts(counts), today));
    expect(s.last7).toBe(15);
    expect(s.vd).toBe(fix2(oracle(counts, FIRST, today)!));
  });

  it('기록이 없으면 숨김, histDays 0', () => {
    const v = loadView([], byId, '2026-11-17', firstRecordDate([], '2026-11-17'));
    expect(v).toEqual({ show: false, histDays: 0, nd: 0 });
  });
});

describe('분모 = 달력 날 수 (쉰 날 포함)', () => {
  const FIRST = '2026-09-01';
  const everyOther = (days: number): Record<string, number> => { const c: Record<string, number> = {}; for (let k = 0; k < days; k += 2) c[ds(dn(FIRST) + k)] = 3; return c; };

  it('이틀에 한 번 3세트, 30일째: 28일 창에 7일합 9 ÷ (42 ÷ 4) = 0.857', () => {
    const counts = everyOther(30);
    const today = ds(dn(FIRST) + 29);
    const s = shown(view(fromCounts(counts), today));
    expect(s.vd).toBe(0.86); // 손계산: a7 = 오프셋 24·26·28 → 9, c = 오프셋 2..28 짝수 14일 → 42, 9 ÷ 10.5
    expect(s.vd).toBe(fix2(oracle(counts, FIRST, today)!));
    expect(s.last7).toBe(9);
    expect(s.nd).toBe(28);
  });

  it('이틀에 한 번 3세트, 23일째: 23일 창, 12 ÷ (36 ÷ (23/7)) = 1.095', () => {
    const counts = everyOther(23);
    const today = ds(dn(FIRST) + 22);
    const s = shown(view(fromCounts(counts), today));
    expect(s.vd).toBe(1.1); // a7 = 오프셋 16·18·20·22 → 12, c = 오프셋 0..22 짝수 12일 → 36
    expect(s.nd).toBe(23);
    expect(s.vd).toBe(fix2(oracle(counts, FIRST, today)!));
  });

  it('4주 합이 0 이면 비율 0', () => {
    const counts = { [FIRST]: 3 };
    const today = ds(dn(FIRST) + 29); // 28일 창에 첫 기록일(오프셋 0)이 들어오지 않음
    expect(shown(view(fromCounts(counts), today)).vd).toBe(0);
    expect(loadRatio(dailyWorkSets(fromCounts(counts), byId, today), FIRST, today)).toBe(0);
  });
});

describe('dailyWorkSets: 무엇을 1세트로 세나', () => {
  const today = '2026-11-17';
  it('맨몸·시간 세트도 1세트, 웜업·안 한 세트 제외, 같은 날 운동 합산', () => {
    const ws = [
      wk('a', '2026-11-10', [set(), set({ warmup: true }), set({ done: false }), set()]), // 작업 2
      wk('b', '2026-11-10', [{ reps: 12, warmup: false, done: true }, { reps: 12, warmup: false, done: true }, { seconds: 45, warmup: false, done: true }], { exerciseId: 'pushup' }), // 맨몸 무게 없음 2 + 시간 1
      wk('c', '2026-11-11', [{ seconds: 60, warmup: false, done: true }], { exerciseId: 'plank' }),
    ];
    const m = dailyWorkSets(ws, byId, today);
    expect(m.get('2026-11-10')).toBe(5);
    expect(m.get('2026-11-11')).toBe(1);
    expect(m.size).toBe(2);
  });
  it('끝나지 않은 운동·미래 날짜·작업 세트 0 운동은 제외, 오늘은 포함', () => {
    const ws = [
      wk('open', '2026-11-12', many(3), { ended: false }),
      wk('future', '2026-11-18', many(3)),
      wk('warmOnly', '2026-11-13', [set({ warmup: true }), set({ done: false })]),
      wk('today', '2026-11-17', many(2)),
    ];
    const m = dailyWorkSets(ws, byId, today);
    expect([...m.entries()]).toEqual([['2026-11-17', 2]]);
  });
  it('첫 기록일(firstRecordDate)도 같은 기준: 끝나지 않은 운동·미래 날짜는 첫 기록일이 되지 않음', () => {
    const ws = [wk('open', '2026-10-01', many(3), { ended: false }), wk('future', '2026-12-01', many(3)), wk('real', '2026-11-05', many(1))];
    expect(firstRecordDate(ws, today)).toBe('2026-11-05');
    expect(view(ws, today).histDays).toBe(13);
  });
});

describe('화면 값 vd 와 구간', () => {
  it('loadVd: toFixed — 0.625 → 0.63, 1.304 → 1.30, 0.795 → 0.80', () => {
    expect(loadVd(0.625)).toBe(0.63);
    expect(loadVd(1.304)).toBe(1.3);
    expect(loadVd(0.795)).toBe(0.8);
    expect(loadVd(1.2999)).toBe(1.3);
    expect(loadVd(0.8)).toBe(0.8);
  });
  it('구간 경계: 0.79 적음 · 0.8 평소 · 1.3 평소 · 1.31 많음 · 1.5 많음 · 1.51 크게 많음', () => {
    expect([0.79, 0.8, 1.3, 1.31, 1.5, 1.51].map(loadZone)).toEqual(['low', 'ok', 'ok', 'warn', 'warn', 'bad']);
    expect(loadZone(0)).toBe('low');
    expect(loadZone(4)).toBe('bad');
  });
  it('구간은 화면 값으로: 원래 1.304 → "1.30 · 평소 수준", 0.795 → "0.80 · 평소 수준"', () => {
    expect(loadZone(loadVd(1.304))).toBe('ok');
    expect(loadZone(loadVd(0.795))).toBe('ok');
    expect(loadZone(loadVd(1.3049))).toBe('ok');
    expect(loadZone(loadVd(1.306))).toBe('warn'); // 1.31
  });

  /** 마지막 날(오늘 = 첫 기록 +29일) 합 c·a7 을 정확히 정해 4a/c 를 만든다. 첫 기록은 창 밖(오프셋 29)에 1세트 */
  const stage = (a7: number, rest: number): { s: LoadShown; counts: Record<string, number> } => {
    const first = '2026-09-01', today = ds(dn(first) + 29);
    const counts: Record<string, number> = { [first]: 1 };
    counts[today] = a7; // 오늘 하루에 몰아 넣어도 a7
    if (rest) counts[ds(dn(today) - 14)] = rest; // 창 안, 7일 밖
    return { s: shown(view(fromCounts(counts), today)), counts };
  };
  it('화면: 4×5 ÷ 32 = 0.625 → 0.63 · 평소보다 적음', () => {
    const { s, counts } = stage(5, 27);
    expect(s.vd).toBe(0.63);
    expect(s.zone).toBe('low');
    expect(s.vd).toBe(fix2(oracle(counts, '2026-09-01', ds(dn('2026-09-01') + 29))!));
  });
  it('화면: 4×15 ÷ 46 = 1.304 → 1.30 · 평소 수준', () => {
    const { s } = stage(15, 31);
    expect(s.vd).toBe(1.3);
    expect(s.zone).toBe('ok');
  });
  it('화면: 4×159 ÷ 800 = 0.795 → 0.80 · 평소 수준 (구간은 vd 로)', () => {
    const { s } = stage(159, 641);
    expect(s.vd).toBe(0.8);
    expect(s.zone).toBe('ok');
  });
  it('띠 위치 mk = min(100, vd/2·100)', () => {
    expect(stage(15, 31).s.mk).toBeCloseTo(65, 10); // vd 1.30 → 65%
    expect(stage(5, 27).s.mk).toBeCloseTo(31.5, 10); // vd 0.63
    const c = stage(10, 0).s; // 4×10 ÷ 10 = 4
    expect(c.vd).toBe(4);
    expect(c.mk).toBe(100);
    expect(c.zone).toBe('bad');
    const two = stage(10, 10).s; // 4×10 ÷ 20 = 2 → 정확히 100%
    expect(two.vd).toBe(2);
    expect(two.mk).toBe(100);
  });
});

describe('4주 창이 빈 경우 판정 (loadEmptyWindows)', () => {
  const first = '2026-08-01';
  const at = (k: number) => ds(dn(first) + k);
  // 창 합은 표(오프셋 → 세트)를 직접 더해 구함: day 오프셋 e 의 창 = [e − nd + 1, e]
  const windowSum = (counts: Record<string, number>, e: number, nd: number) => { let t = 0; for (let k = e - nd + 1; k <= e; k++) t += counts[at(k)] ?? 0; return t; };
  it('첫 기록(오프셋 0~5)만 있고 오늘이 45일째: 오늘 창(18~45)·지난주 창(11~38) 모두 비어 둘 다 empty', () => {
    const counts: Record<string, number> = { [at(0)]: 2, [at(5)]: 1 };
    const today = at(45), ws = fromCounts(counts);
    const s = shown(view(ws, today));
    expect(s.vd).toBe(0);
    expect(s.prevVd).toBe(0);
    expect([windowSum(counts, 45, 28), windowSum(counts, 38, 28)]).toEqual([0, 0]);
    const daily = dailyWorkSets(ws, byId, today);
    expect(loadWindowSets(daily, today, 28)).toBe(0);
    expect(loadEmptyWindows(daily, today, s.nd, s.histDays, s.prevVd !== null)).toEqual({ empty: true, prevEmpty: true });
  });
  it('4주 창 안에 7일 밖 세트가 있으면(오프셋 20, 오늘 45) 비율은 0 이지만 비지 않음', () => {
    const counts: Record<string, number> = { [at(0)]: 2, [at(20)]: 3 };
    const today = at(45), ws = fromCounts(counts);
    const s = shown(view(ws, today));
    expect(s.vd).toBe(0); // 최근 7일(39~45)에 없음
    expect([windowSum(counts, 45, 28), windowSum(counts, 38, 28)]).toEqual([3, 3]);
    expect(loadEmptyWindows(dailyWorkSets(ws, byId, today), today, s.nd, s.histDays, s.prevVd !== null)).toEqual({ empty: false, prevEmpty: false });
  });
  it('오늘 창만 비고 지난주 창에는 세트가 있음: empty 만 true (지난주 비율은 0 이 아님)', () => {
    const counts: Record<string, number> = { [at(0)]: 2, [at(11)]: 4, [at(12)]: 4 };
    const today = at(40), ws = fromCounts(counts); // 오늘 창 13~40 (비어 있음), 지난주 같은 요일 33 의 창 6~33 (11·12 포함)
    const s = shown(view(ws, today));
    expect([windowSum(counts, 40, 28), windowSum(counts, 33, 28)]).toEqual([0, 8]);
    expect(s.vd).toBe(0);
    expect(s.prevVd).toBe(0); // 지난주 같은 요일의 최근 7일(27~33)은 비어 있어 그날 비율도 0
    expect(loadEmptyWindows(dailyWorkSets(ws, byId, today), today, s.nd, s.histDays, s.prevVd !== null)).toEqual({ empty: true, prevEmpty: false });
  });
  it('21~27일째(창이 28일보다 짧음): 지난주 같은 요일 비율이 없으면 prevEmpty false', () => {
    const counts: Record<string, number> = { [at(0)]: 1 };
    const today = at(22), ws = fromCounts(counts);
    const s = shown(view(ws, today));
    expect(s.prevVd).toBeNull();
    expect(loadEmptyWindows(dailyWorkSets(ws, byId, today), today, s.nd, s.histDays, false)).toEqual({ empty: false, prevEmpty: false }); // 창(23일)에 첫 기록 1세트
  });
});

describe('7일 점 그래프 값', () => {
  it('날마다 2세트 40일: 비율 모두 1.00, 세로 범위가 최소 폭 0.6 으로 넓어짐 (0.7 ~ 1.3)', () => {
    const first = '2026-08-01', counts: Record<string, number> = {};
    for (let k = 0; k < 40; k++) counts[ds(dn(first) + k)] = 2;
    const today = ds(dn(first) + 39);
    const s = shown(view(fromCounts(counts), today));
    expect(s.days).toEqual(Array.from({ length: 7 }, (_, i) => ds(dn(today) - 6 + i)));
    expect(s.rs.every((r) => r !== null && Math.abs(r - 1) < 1e-12)).toBe(true);
    expect(s.rp.every((r) => r !== null && Math.abs(r - 1) < 1e-12)).toBe(true);
    // 손계산: 최솟값·최댓값 1 → lo 0.8, hi 1.2 (폭 0.4 < 0.6) → 가운데 1.0 에서 ±0.3
    expect(s.lo).toBeCloseTo(0.7, 10);
    expect(s.hi).toBeCloseTo(1.3, 10);
    expect(s.vd).toBe(1);
    expect(s.mk).toBe(50);
  });

  it('값이 넓게 퍼지면 최소 폭 규칙 없이 ±0.15 바깥 한 칸 눈금', () => {
    const first = '2026-08-01', counts: Record<string, number> = {};
    for (let k = 0; k < 36; k++) counts[ds(dn(first) + k)] = k % 7 === 0 ? 6 : k >= 30 ? 0 : 1; // 일주일에 한 번 크게, 마지막 6일은 쉼
    const today = ds(dn(first) + 35);
    const s = shown(view(fromCounts(counts), today));
    const seen = [...s.days, ...s.days.map((d) => ds(dn(d) - 7))].map((d) => oracle(counts, first, d)).filter((x): x is number => x !== null);
    const lo = Math.max(0, Math.floor((Math.min(...seen) - 0.15) * 10) / 10), hi = Math.ceil((Math.max(...seen) + 0.15) * 10) / 10;
    expect(hi - lo).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(s.lo).toBeCloseTo(lo, 10);
    expect(s.hi).toBeCloseTo(hi, 10);
    for (const r of [...s.rs, ...s.rp]) if (r !== null) { expect(r).toBeGreaterThanOrEqual(s.lo); expect(r).toBeLessThanOrEqual(s.hi); }
  });

  it('21일째: 오늘만 비율이 있고 나머지는 null, 지난주 줄 없음', () => {
    const first = '2026-09-01', counts = { [first]: 3, '2026-09-10': 4, '2026-09-19': 5, '2026-09-21': 2 };
    const today = '2026-09-21';
    const s = shown(view(fromCounts(counts), today));
    expect(s.rs.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(s.rs[6]).toBeCloseTo(oracle(counts, first, today)!, 12);
    expect(s.rp).toEqual([null, null, null, null, null, null, null]);
    expect(s.prevVd).toBeNull();
    const seen = s.rs[6]!;
    expect(s.hi - s.lo).toBeCloseTo(0.6, 10);
    expect(s.lo).toBeLessThanOrEqual(seen); expect(s.hi).toBeGreaterThanOrEqual(seen);
  });

  it('범위 끝이 0 밑으로 내려가지 않음 (lo ≥ 0)', () => {
    const first = '2026-08-01', counts: Record<string, number> = { [first]: 1 };
    counts[ds(dn(first) + 5)] = 1; // 4주 동안 거의 안 함 → 비율 0
    const today = ds(dn(first) + 40);
    const s = shown(view(fromCounts(counts), today));
    expect(s.vd).toBe(0);
    expect(s.lo).toBe(0);
    expect(s.hi).toBeCloseTo(0.6, 10);
  });
});

describe('문구 (승인 목업 글자 그대로)', () => {
  it('구간 이름', () => {
    expect(LOAD_ZONE_NAME).toEqual({ low: '평소보다 적음', ok: '평소 수준', warn: '평소보다 많음', bad: '평소보다 크게 많음' });
  });
  it('구간 한 문장', () => {
    expect(LOAD_ZONE_SAY.low).toBe('최근 7일이 평소(4주 평균)보다 가벼워요. 쉬거나 일부러 줄인 주라면 자연스러워요.');
    expect(LOAD_ZONE_SAY.ok).toBe('최근 7일이 평소(4주 평균)와 비슷한 양이에요.');
    expect(LOAD_ZONE_SAY.warn).toBe('최근 7일이 평소보다 많아요. 쉬었다가 돌아온 주라면 흔히 이렇게 나와요.');
    expect(LOAD_ZONE_SAY.bad).toBe('최근 7일이 평소보다 크게 많아요. 쉬었다 돌아온 주라면 자연스러운 숫자예요. 통증이나 피로가 쌓이면 다음 운동 양을 줄여 보세요.');
  });
  it('해설 끝 괄호: 28일이면 뒤쪽 없음, 미만이면 "기록이 nd일이라 nd일 평균과 비교"', () => {
    expect(loadSayText('ok', 31, 28)).toBe('최근 7일이 평소(4주 평균)와 비슷한 양이에요. (오늘까지 7일 31세트)');
    expect(loadSayText('ok', 31, 23)).toBe('최근 7일이 평소(4주 평균)와 비슷한 양이에요. (오늘까지 7일 31세트 · 기록이 23일이라 23일 평균과 비교)');
    expect(loadSayText('low', 1234, 21)).toBe(`${LOAD_ZONE_SAY.low} (오늘까지 7일 1,234세트 · 기록이 21일이라 21일 평균과 비교)`);
  });
  it('지난주 줄 3가지 + 비율 없음', () => {
    expect(loadWeekText('화', 1.1, 0.7)).toBe('지난주 화요일 0.70 → 오늘 1.10 · 지난주보다 0.40 높아요');
    expect(loadWeekText('화', 0.7, 1.1)).toBe('지난주 화요일 1.10 → 오늘 0.70 · 지난주보다 0.40 낮아요');
    expect(loadWeekText('일', 1.3, 1.3)).toBe('지난주 일요일 1.30 → 오늘 1.30 · 지난주와 같아요');
    expect(loadWeekText('수', 1.15, 1.1)).toBe('지난주 수요일 1.10 → 오늘 1.15 · 지난주보다 0.05 높아요'); // 회귀 고정값: 화면 값 1.15·1.10 의 차이는 hundredths 정수(115−110=5)로 구해 0.05 (부동소수 1.15−1.1 을 그대로 쓰지 않음)
    expect(loadWeekText('수', 0.3, 0.29)).toBe('지난주 수요일 0.29 → 오늘 0.30 · 지난주보다 0.01 높아요');
    expect(loadWeekText('금', 0.8, null)).toBe('지난주 금요일은 기록이 3주가 안 돼 견줄 비율이 없어요.');
  });
  it('4주 창이 비면(c = 0) 한 문장·지난주 줄을 안내 문구로, 숫자·괄호는 그대로', () => {
    expect(LOAD_EMPTY_SAY).toBe('최근 4주 동안 운동 기록이 없어요. 다시 운동하면 평소와 견줘 보여 드려요.');
    expect(LOAD_EMPTY_WEEK).toBe('지난주와 이번 주 모두 최근 4주 기록이 없어요.');
    expect(loadSayText('low', 0, 28, true)).toBe('최근 4주 동안 운동 기록이 없어요. 다시 운동하면 평소와 견줘 보여 드려요. (오늘까지 7일 0세트)');
    expect(loadSayText('low', 0, 23, true)).toBe('최근 4주 동안 운동 기록이 없어요. 다시 운동하면 평소와 견줘 보여 드려요. (오늘까지 7일 0세트 · 기록이 23일이라 23일 평균과 비교)');
    expect(loadSayText('low', 0, 28)).toBe(`${LOAD_ZONE_SAY.low} (오늘까지 7일 0세트)`); // 창에 세트가 있고 최근 7일만 쉼: 기존 문장
    expect(loadWeekText('목', 0, 0, true)).toBe('지난주와 이번 주 모두 최근 4주 기록이 없어요.');
    expect(loadWeekText('목', 0, 0)).toBe('지난주 목요일 0.00 → 오늘 0.00 · 지난주와 같아요');
    expect(loadWeekText('목', 0, 0.9, false)).toBe('지난주 목요일 0.90 → 오늘 0.00 · 지난주보다 0.90 낮아요');
  });
  it('기다림: 일수 있음/기록 0 이면 일수 생략', () => {
    expect(loadWaitText(20)).toBe('기록이 3주 쌓이면 부하 비율을 보여 드려요. 지금 20일째예요.');
    expect(loadWaitText(1)).toBe('기록이 3주 쌓이면 부하 비율을 보여 드려요. 지금 1일째예요.');
    expect(loadWaitText(0)).toBe('기록이 3주 쌓이면 부하 비율을 보여 드려요.');
  });
  it('고정 안내', () => {
    expect(LOAD_NOTE).toBe("구간 값(0.8·1.3·1.5)은 팀 스포츠 연구에서 온 참고값이에요. 세트 수로 센 근력 운동에서는 근거가 약해서, 판단보다 '평소와 얼마나 다른가'를 보는 참고로 쓰세요. 첫 기록 21일째부터 보이고, 4주가 안 되면 첫 기록일부터 지난 날 수(쉰 날 포함)로 평균을 내요.");
  });
  it('그래프 낭독: 날짜·화면 값·지난주 값, 없는 날은 "비율 없음"', () => {
    const dates = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
    const t = loadChartLabel(dates, [null, null, 0.9, 1, 1.05, 1.1, 1.2], [null, null, null, 0.8, 0.9, 1, 1.3]);
    expect(t).toBe('최근 7일 부하 비율과 지난주 같은 요일 비율. 11월 11일 비율 없음(지난주 비율 없음), 11월 12일 비율 없음(지난주 비율 없음), 11월 13일 0.90(지난주 비율 없음), 11월 14일 1.00(지난주 0.80), 11월 15일 1.05(지난주 0.90), 11월 16일 1.10(지난주 1.00), 11월 17일 1.20(지난주 1.30)');
  });
});
