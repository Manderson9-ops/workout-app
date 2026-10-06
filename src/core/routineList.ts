/**
 * 내 루틴 목록 (D-048): 최근 한 순 정렬, 부위·마지막 날짜·횟수, 검색, 목록에서만 숨기기.
 * 숨긴 루틴 ID는 설정(settings.routineHidden, 기기 사이 동기화)에 둔다. 루틴 자체는 바꾸지 않는다 (D-040과 같은 방식).
 */
import type { Routine, Workout } from './session';
import type { Part } from './types';
import { PARTS } from './types';
import { matchesQuery } from './search';
import { localDate } from './stats';

export type NextReason = 'oldest' | 'never' | 'doneToday';
export interface NextPick { routine: Routine; reason: NextReason; lastAt?: string }
/**
 * 홈 "다음 운동" 고르기 (D-055 앱 판단, 근거 없는 운동 이론이 아니라 돌려 가며 하기 위한 규칙):
 * 1) 운동이 들어 있는 루틴만 (숨긴 루틴은 부르는 쪽에서 뺀)
 * 2) 오늘 한 루틴은 빼고, 한 적 있는 루틴 중 가장 오래전에 한 것 (돌아가며 하기)
 * 3) 그런 루틴이 없으면 아직 안 한 루틴 중 가장 최근에 만들거나 고친 것 (안 한 루틴은 안 쓰는 초안일 수 있어 뒤로)
 * 4) 모두 오늘 했으면 가장 최근에 한 루틴 + "오늘 이미 했어요"
 * today = 이 기기 지역 날짜 (YYYY-MM-DD)
 */
export function pickNextRoutine(list: readonly Routine[], use: Map<string, RoutineUse>, today: string): NextPick | undefined {
  const withItems = list.filter((r) => r.blocks.some((b) => b.items.length > 0));
  if (!withItems.length) return undefined;
  const lastOf = (r: Routine) => use.get(r.id)?.lastAt;
  const byName = (a: Routine, b: Routine) => a.name.localeCompare(b.name, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const notToday = withItems.filter((r) => { const l = lastOf(r); return !l || localDate(l) !== today; });
  const done = notToday.filter((r) => lastOf(r)).sort((a, b) => (lastOf(a)! < lastOf(b)! ? -1 : lastOf(a)! > lastOf(b)! ? 1 : byName(a, b)));
  if (done[0]) return { routine: done[0], reason: 'oldest', lastAt: lastOf(done[0]) };
  const never = notToday.filter((r) => !lastOf(r)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : byName(a, b)));
  if (never[0]) return { routine: never[0], reason: 'never' };
  const recent = [...withItems].sort((a, b) => (lastOf(a)! < lastOf(b)! ? 1 : lastOf(a)! > lastOf(b)! ? -1 : byName(a, b)))[0]!;
  return { routine: recent, reason: 'doneToday', lastAt: lastOf(recent) };
}

export type RoutineSort = 'recent' | 'name' | 'short';
export interface RoutineUse { lastAt?: string; count: number }

/** 끝낸 운동 중 그 루틴으로 시작한 것의 마지막 시각과 횟수 */
export function routineUse(workouts: readonly Workout[]): Map<string, RoutineUse> {
  const m = new Map<string, RoutineUse>();
  for (const w of workouts) {
    if (!w.routineId || !w.endedAt) continue;
    const u = m.get(w.routineId) ?? { count: 0 };
    u.count++;
    if (!u.lastAt || w.startedAt > u.lastAt) u.lastAt = w.startedAt;
    m.set(w.routineId, u);
  }
  return m;
}

/** 루틴에 들어 있는 부위 (부위 목록 순서) */
export function routineParts(r: Routine, partOf: (exerciseId: string) => Part | undefined): Part[] {
  const s = new Set(r.blocks.flatMap((b) => b.items.map((i) => partOf(i.exerciseId))).filter((x): x is Part => !!x));
  return PARTS.filter((p) => s.has(p));
}

/** 정렬: 최근 한 순(안 한 루틴은 최근 고친 순으로 뒤에) / 이름 / 짧은 시간 순. 같으면 이름 → id (결정적) */
export function sortRoutines(list: readonly Routine[], use: Map<string, RoutineUse>, mode: RoutineSort): Routine[] {
  const name = (a: Routine, b: Routine) => a.name.localeCompare(b.name, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const recentKey = (r: Routine) => use.get(r.id)?.lastAt ?? '';
  return [...list].sort((a, b) => {
    if (mode === 'name') return name(a, b);
    if (mode === 'short') return (a.estimatedSec ?? Infinity) - (b.estimatedSec ?? Infinity) || name(a, b);
    const ra = recentKey(a), rb = recentKey(b);
    if (ra !== rb) return ra < rb ? 1 : -1; // 한 적 있는 것 먼저, 최근 것 먼저
    return (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) || name(a, b);
  });
}

/** 검색: 루틴 이름·운동 이름(초성 가능)·부위 */
export function filterRoutines(list: readonly Routine[], q: string, nameOf: (exerciseId: string) => string, partsOf: (r: Routine) => Part[]): Routine[] {
  if (!q.trim()) return [...list];
  return list.filter((r) => matchesQuery(q, [r.name, ...partsOf(r), ...r.blocks.flatMap((b) => b.items.map((i) => nameOf(i.exerciseId)))]));
}

/** "오늘", "어제", "3일 전", "2주 전", 그 이상은 "9월 3일" (다른 해면 "2025년 9월 3일") */
export function sinceText(iso: string | undefined, now: number): string {
  if (!iso) return '아직 안 함';
  const day = (t: number) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
  const n = day(now) - day(Date.parse(iso));
  if (n <= 0) return '오늘';
  if (n === 1) return '어제';
  if (n < 14) return `${n}일 전`;
  if (n < 56) return `${Math.floor(n / 7)}주 전`;
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일`;
}
