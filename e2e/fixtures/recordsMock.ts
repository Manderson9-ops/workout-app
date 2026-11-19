/**
 * D-082 기록판 시험 데이터: 승인 목업(docs/mockups/records/record-mock.html)의 예시 데이터 생성기 gen(sc) 와 상황표 SCENS 를 그대로 옮김.
 * 씨앗 7 · rnd 호출 순서 · 오늘 날짜는 목업과 같아야 한다(바꾸면 하네스 상수와 어긋남). 날짜 계산만 시험 PC 시간대에 안 흔들리게 UTC 로 함.
 * toWorkout(row) 는 한 줄(row)을 앱 저장소의 끝난 운동으로 바꿈
 */

export const SCENS = {
  normal: { label: '평소', note: '오늘(화) 운동을 마친 평범한 주예요. 예시 기록은 2025년 3월 3일부터라, 작년과의 비교는 3월 3일 이후끼리 해요.', today: '2026-11-17' },
  rest: { label: '오늘 쉬는 날', note: '오늘(화)은 아직 운동 전이에요. 비교는 어제(월)까지만 해요.', today: '2026-11-17' },
  first: { label: '주 첫날 운동 전', note: '오늘은 일요일, 주의 첫날이고 아직 운동 전이에요. 주 보기는 "운동하면 비교해요"가 나와요.', today: '2026-11-15' },
  back1: { label: '1주 쉬고 복귀', note: '11월 3~9일을 쉬고 평소처럼 돌아온 주예요. 부하 비율이 평소 운동만으로도 높게 나와요.', today: '2026-11-17' },
  back2: { label: '2주 쉬고 복귀', note: '10월 27일~11월 9일을 쉬고 돌아온 주예요. 부하 비율이 크게 뛰어요.', today: '2026-11-17' },
  deload: { label: '디로드', note: '최근 7일(11월 11~17일)을 일부러 절반만 한 경우예요.', today: '2026-11-17' },
  week3: { label: '앱 쓴 지 3주', note: '기록 21일째, 부하 카드가 처음 보이는 날이에요(20일째까지는 숨김). 4주가 안 돼서 첫 기록일부터 지난 21일(쉰 날 포함)로 평균을 내요. 지난달 이맘때는 기록 전이라 월 비교는 하지 않아요.', today: '2026-11-17' },
  day20: { label: '앱 쓴 지 20일', note: '기록 20일째, 부하 카드가 아직 숨겨진 날이에요(21일째부터 보임).', today: '2026-11-17' },
  newbie: { label: '앱 쓴 지 2주', note: '기록이 2주뿐이에요. 부하 카드는 숨겨지고, 지난달·작년은 기록 전이라 비교하지 않아요.', today: '2026-11-17' },
  monthend: { label: '월말(11/30)', note: "이번 달 마지막 날이에요. 날짜 범위가 1~30일로 꽉 찬 달을 볼 수 있어요. 앱의 '월말 지난달 전체' 비교 규칙은 목업에 없어요(SPEC #12).", today: '2026-11-30' },
  newyear: { label: '연초(1/2)', note: '해가 바뀐 직후예요. 주가 해를 넘고, 년 보기는 작년(2026) 전체와 비교돼요.', today: '2027-01-02' },
} as const;

export type ScenId = keyof typeof SCENS;
export const SCEN_IDS = Object.keys(SCENS) as ScenId[];

/** 한 운동 = 하루 한 줄. volume = kg 합계, time = 초 */
export interface MockRow { date: string; name: string; sets: number; volume: number; time: number }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, d!)); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

const NAMES = ['가슴+삼두', '등+이두', '하체', '어깨+팔', '전신'];
export function gen(sc: ScenId): { W: MockRow[]; today: string } {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const today: string = SCENS[sc].today;
  const start = sc === 'newbie' ? '2026-11-04' : sc === 'week3' ? addDays(today, -20) : sc === 'day20' ? addDays(today, -19) : '2025-03-03';
  const W: MockRow[] = [];
  for (let s = '2025-03-03'; s <= today; s = addDays(s, 1)) {
    const wd = parse(s).getUTCDay();
    const plan = [1, 3, 5].includes(wd) ? 0.9 : wd === 6 ? 0.6 : wd === 2 ? 0.2 : 0.04;
    const hit = rnd() < plan, base = 14 + Math.round(rnd() * 12), vk = 380 + rnd() * 260, tm = 45 + Math.round(rnd() * 35), nm = NAMES[Math.floor(rnd() * NAMES.length)]!;
    let work = hit || s === '2026-11-09' || s === '2026-11-16' || s === start;
    if (s === today) work = !(sc === 'rest' || sc === 'first');
    if (s < start) work = false;
    if (sc === 'back1' && s >= '2026-11-03' && s <= '2026-11-09') work = false;
    if (sc === 'back2' && s >= '2026-10-27' && s <= '2026-11-09') work = false;
    if (!work) continue;
    let sets = s === today ? 12 : base;
    if (sc === 'deload' && s >= addDays(today, -6)) sets = Math.round(sets / 2);
    W.push({ date: s, name: nm, sets, volume: Math.round(sets * vk / 10) * 10, time: tm * 60 });
  }
  return { W, today };
}

/** 앱 저장소의 끝난 운동 한 개: 한국 시각 10시 시작, 끝 = 시작 + time 초, 같은 세트 sets 개(reps 1), 무게 = floor(V/N) 에 앞 (V mod N) 세트는 +1 → 볼륨이 정확히 V */
export function toWorkout(row: MockRow, id: string = `rm-${row.date}`) {
  const start = Date.parse(`${row.date}T10:00:00+09:00`);
  const base = Math.floor(row.volume / row.sets), extra = row.volume % row.sets;
  return {
    id, name: row.name, startedAt: new Date(start).toISOString(), endedAt: new Date(start + row.time * 1000).toISOString(), timer: null,
    blocks: [{ kind: 'single', restSec: 90, roundRestSec: 120, transitionSec: 10, items: [{ exerciseId: 'bench_press', target: { sets: row.sets, reps: 1 },
      sets: Array.from({ length: row.sets }, (_, i) => ({ warmup: false, done: true, weight: base + (i < extra ? 1 : 0), reps: 1, doneAt: new Date(start + 5 * 60_000).toISOString() })) }] }],
  };
}
