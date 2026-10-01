/**
 * 근육별 한 번 볼륨 (D-041).
 * 근거: Remmert 외 2025 (SportRxiv 537) 회차당 볼륨 메타 회귀. 근비대는 "근육별" 약 11 fractional 세트에서
 * 더 해도 차이를 찾기 어려운 지점(PUOS)이 나옴. fractional = 주동근으로 쓰는 운동 1세트, 보조로 쓰는 운동 0.5세트.
 * 그 이상이 해롭다는 뜻은 아니며 자료가 적어 조심해서 해석하라고 함 → 앱은 "더 넣어도 이득을 확인하기 어려운 지점"으로 상한을 둔다.
 * 초보 8은 연구 수치가 아니라 앱 판단(처음에는 적은 볼륨으로 시작)이다.
 */
import type { Level } from './types';

/** 근육 이름 → 근육 그룹. 같은 그룹 안의 세부 이름(대퇴직근, 이두 장두 등)은 한 근육으로 센다 */
export const MUSCLE_GROUP: Record<string, string> = {
  대흉근: '가슴', '대흉근 상부': '가슴', '대흉근 하부': '가슴',
  광배근: '광배근', 대원근: '광배근',
  능형근: '승모근·능형근', 승모근: '승모근·능형근', '상부 승모근': '승모근·능형근', '중부 승모근': '승모근·능형근', '하부 승모근': '승모근·능형근',
  척추기립근: '척추기립근',
  '전면 삼각근': '전면 삼각근', '측면 삼각근': '측면 삼각근', '후면 삼각근': '후면 삼각근', 회전근개: '회전근개',
  이두: '이두', '이두 장두': '이두', '이두 단두': '이두', 상완근: '이두',
  삼두: '삼두', '삼두 장두': '삼두', '삼두 내측두': '삼두', '삼두 외측두': '삼두',
  전완: '전완·악력', '전완 굴곡근': '전완·악력', '전완 신전근': '전완·악력', 상완요골근: '전완·악력',
  악력: '전완·악력', '악력 (손가락)': '전완·악력', '손가락 굴곡근': '전완·악력',
  대퇴사두: '대퇴사두', 대퇴직근: '대퇴사두',
  햄스트링: '햄스트링',
  둔근: '둔근', 중둔근: '둔근',
  내전근: '내전근',
  비복근: '종아리', 가자미근: '종아리',
  복직근: '복근', '복직근 하부': '복근', 복횡근: '복근', 복사근: '복근', 코어: '복근',
  '고관절 굴곡근': '고관절 굴곡근',
  // 직접 추가한 운동은 근육 칸에 부위 이름이 들어감. 한 근육으로 분명한 부위만 맞춤 (어깨·하체는 여러 근육이라 부위 이름 그대로)
  등: '광배근', 가슴: '가슴', '전완·악력': '전완·악력',
};

/** 표에 없는 이름(직접 추가한 운동의 부위 이름 등)은 그 이름 그대로 한 그룹 */
export const groupOf = (m: string): string => MUSCLE_GROUP[m] ?? m;

/** 근육별 한 번 상한 (fractional 세트). 중급·상급 11 = 연구 PUOS, 초보 8 = 앱 판단 */
export const SESSION_CAP: Record<Level, number> = { 초보: 8, 중급: 11, 상급: 11 };
/** 운동당 최대 세트 (플랜 자동 생성 기준, 앱 판단). 직접 고치는 것은 1~8 그대로 */
export const MAX_SETS_BY_LEVEL: Record<Level, number> = { 초보: 3, 중급: 4, 상급: 4 };

/** 한 세트가 근육 그룹마다 몇 세트로 세어지는지: 주 근육(muscles[0])의 그룹 1, 나머지 그룹 0.5 (같은 그룹은 큰 값) */
const shareCache = new WeakMap<readonly string[], Map<string, number>>();
export function setShares(muscles: readonly string[]): Map<string, number> {
  const hit = shareCache.get(muscles);
  if (hit) return new Map(hit);
  const out = computeShares(muscles);
  shareCache.set(muscles, out);
  return new Map(out);
}
/** 플랜 생성의 후보 수만 번 계산용: 캐시된 값을 그대로 (바꾸지 말 것) */
function sharesRO(muscles: readonly string[]): ReadonlyMap<string, number> {
  let v = shareCache.get(muscles);
  if (!v) { v = computeShares(muscles); shareCache.set(muscles, v); }
  return v;
}
function computeShares(muscles: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  muscles.forEach((m, i) => {
    const g = groupOf(m); const v = i === 0 ? 1 : 0.5;
    if ((out.get(g) ?? 0) < v) out.set(g, v);
  });
  return out;
}

/** 운동 목록의 근육 그룹별 fractional 세트 합 */
export function sessionLoad(items: readonly { muscles: readonly string[]; sets: number }[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const it of items) for (const [g, v] of sharesRO(it.muscles)) load.set(g, (load.get(g) ?? 0) + v * it.sets);
  return load;
}

/** 상한을 넘는 그룹. 잠금만으로 이미 상한을 넘으면 그 양까지는 인정(사용자 선택) */
export function overCap(load: Map<string, number>, cap: number, lockedLoad?: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [g, v] of load) if (v > Math.max(cap, lockedLoad?.get(g) ?? 0) + 1e-9) out.push(g);
  return out;
}

/** 이 운동을 sets세트 더하면 상한을 넘는지 (load는 바꾸지 않음) */
export function exceedsWith(load: ReadonlyMap<string, number>, muscles: readonly string[], sets: number, cap: number, lockedLoad?: ReadonlyMap<string, number>): boolean {
  for (const [g, v] of sharesRO(muscles)) if ((load.get(g) ?? 0) + v * sets > Math.max(cap, lockedLoad?.get(g) ?? 0) + 1e-9) return true;
  return false;
}
/** load에 더함 (제자리) */
export function addLoad(load: Map<string, number>, muscles: readonly string[], sets: number): void {
  for (const [g, v] of sharesRO(muscles)) load.set(g, (load.get(g) ?? 0) + v * sets);
}

/** 받침에 맞는 목적격 조사 (을/를) */
export function objParticle(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '을' : '를';
}

/** 표시용: 0.5 단위 숫자 */
export const fmtSets = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
