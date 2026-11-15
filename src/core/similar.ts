/**
 * D-080: 운동 바꿀 때 "비슷한 운동" 순위와 운동별 마지막 기록 (순수 함수, 화면과 분리).
 * 실기록에서 같은 루틴을 다시 할 때 대부분 종목이 바뀌므로, 바꿀 운동과 닮은 것을 먼저 보여 준다.
 */
import type { Exercise } from './types';
import type { SetLog, Workout } from './session';
import { sinceText } from './routineList';

/** 운동 하나의 마지막 기록: 가장 최근에 한 날의 가장 무거운 완료 작업 세트 */
export interface LastRecord { at: string; endedAt: string; wid: string; set: SetLog }

const weight = (s: SetLog) => (s.weight ?? 0) * 1_000_000 + (s.seconds ?? s.reps ?? 0);

/** 기록을 한 번만 훑어 운동별 마지막 기록을 만든다 (교체 창의 줄마다 기록 전체를 다시 훑지 않게) */
export function lastRecordMap(history: readonly Workout[]): Map<string, LastRecord> {
  const out = new Map<string, LastRecord>();
  for (const w of history) {
    if (!w.endedAt) continue;
    for (const b of w.blocks) for (const it of b.items) {
      if (it.skipped) continue;
      for (const s of it.sets) {
        if (!s.done || s.warmup) continue;
        const cur = out.get(it.exerciseId);
        if (!cur || w.endedAt > cur.endedAt || (w.id === cur.wid && weight(s) > weight(cur.set))) out.set(it.exerciseId, { at: w.startedAt, endedAt: w.endedAt, wid: w.id, set: s });
      }
    }
  }
  return out;
}

/** "60kg×8", 시간 운동 "30초", 맨몸 "맨몸×12" */
export function setBrief(s: SetLog): string {
  if (s.seconds !== undefined) return `${s.seconds}초`;
  if (!s.weight) return s.reps !== undefined ? `맨몸×${s.reps}` : '맨몸';
  return s.reps !== undefined ? `${s.weight}kg×${s.reps}` : `${s.weight}kg`;
}
/** 교체 창 줄: "지난번 60kg×8 · 3일 전", 없으면 "아직 안 해 봄" */
export function lastLineText(rec: LastRecord | undefined, now: number): string {
  return rec ? `지난번 ${setBrief(rec.set)} · ${sinceText(rec.at, now)}` : '아직 안 해 봄';
}
/** 미리보기 줄: "지난 120kg×10", 없으면 "처음" */
export function lastShortText(rec: LastRecord | undefined): string {
  return rec ? `지난 ${setBrief(rec.set)}` : '처음';
}

/** 닮은 정도: 1 = 같은 family, 2 = 같은 pattern + 첫 주동근, 3 = 같은 pattern + 같은 부위, 0 = 닮지 않음 */
export function similarTier(from: Exercise, e: Exercise): 0 | 1 | 2 | 3 {
  if (e.family === from.family) return 1;
  if (e.pattern !== from.pattern) return 0;
  if (from.muscles[0] !== undefined && e.muscles[0] === from.muscles[0]) return 2;
  return e.part === from.part ? 3 : 0;
}

export const SIMILAR_MAX = 5;
export interface SimilarOpts<T extends Exercise = Exercise> {
  /** 빼는 운동 id (이미 들어 있는 운동 등) */
  exclude?: readonly string[];
  /** 내가 뺀 운동 */
  excluded?: (id: string) => boolean;
  /** 내 장비로 할 수 있는지 */
  available?: (e: T) => boolean;
  last: ReadonlyMap<string, LastRecord>;
  /** 작을수록 좋은 등급 순번 */
  gradeRank?: (e: T) => number;
}

/** 비슷한 운동 최대 5개: 단계순 → (단계 안) 해 본 운동 최근 순 → 등급순 → 이름 */
export function similarExercises<T extends Exercise>(fromId: string | undefined, all: readonly T[], o: SimilarOpts<T>): T[] {
  const from = fromId ? all.find((e) => e.id === fromId) : undefined;
  if (!from) return [];
  const skip = new Set(o.exclude ?? []);
  return all
    .filter((e) => e.id !== from.id && !skip.has(e.id) && !o.excluded?.(e.id) && (o.available?.(e) ?? true))
    .map((e) => ({ e, t: similarTier(from, e) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => {
      const ra = o.last.get(a.e.id), rb = o.last.get(b.e.id);
      return a.t - b.t
        || (rb ? 1 : 0) - (ra ? 1 : 0)
        || (ra && rb ? (ra.endedAt < rb.endedAt ? 1 : ra.endedAt > rb.endedAt ? -1 : 0) : 0)
        || (o.gradeRank ? o.gradeRank(a.e) - o.gradeRank(b.e) : 0)
        || a.e.name_ko.localeCompare(b.e.name_ko, 'ko');
    })
    .slice(0, SIMILAR_MAX)
    .map((x) => x.e);
}
