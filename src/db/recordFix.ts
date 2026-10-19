/**
 * 기록 정리 고치기 (D-065·D-070·D-072). RecordFix 화면이 부르고, 시험에서 바로 부를 수 있게 db만 받음.
 * 모두 저장된 최신 기록을 다시 읽어 그 기록으로 다시 계산한 뒤 저장 (그사이 바뀌었으면 건너뜀).
 * 저장은 보통 put 이라 동기화 표시(_s)가 자동으로 올라가고, 지우기는 softDelete(지움 표시)로만.
 */
import type { WorkoutDB } from './db';
import { softDelete } from './db';
import type { Workout } from '../core/session';
import { endFixes, longFixes, applyEnd, doneCount } from '../core/finishTime';
import type { EndFix } from '../core/finishTime';
import { applyWarmups } from '../core/warmupGuess';
import type { WarmupFix } from '../core/warmupGuess';

/**
 * 끝난 시각 고치기. 화면에 보인 후보(f)의 끝 시각이 그대로일 때만, 다시 읽은 기록으로 새 끝을 다시 셈.
 * 12시간 넘는 기록의 떨어진 세트(stragglers, 다음 날 체크 등)는 일부러 지우지도 옮기지도 않음:
 * 실제로 한 세트일 수 있어서 세트 기록은 그대로 두고 끝난 시각만 바꿈 (그래서 그 세트의 doneAt 이 새 끝보다 늦을 수 있음)
 */
export async function fixEndsIn(d: WorkoutDB, list: readonly EndFix[], nowIso: string): Promise<number> {
  let n = 0;
  for (const f of list) {
    await d.transaction('rw', d.workouts, async () => {
      const cur = await d.workouts.get(f.id);
      if (!cur || cur.endedAt !== f.endedAt) return;
      const fresh = endFixes([cur])[0] ?? longFixes([cur])[0];
      if (!fresh) return;
      await d.workouts.put(applyEnd(cur, fresh.newEnd, nowIso)); n++;
    });
  }
  return n;
}

/** 완료 세트 0개 기록 지우기 (지움 표시 남김). 그사이 세트를 완료했으면 건너뜀 */
export async function deleteEmptyIn(d: WorkoutDB, list: readonly Workout[]): Promise<number> {
  let n = 0;
  for (const w of list) {
    await d.transaction('rw', d.workouts, d.tombs, async () => {
      const cur = await d.workouts.get(w.id);
      if (!cur || !cur.endedAt || doneCount(cur) > 0) return;
      await softDelete(d, 'workouts', w.id); n++;
    });
  }
  return n;
}

/** 첫 세트를 웜업으로 (applyWarmups 가 다시 읽은 기록에서 조건을 다시 확인) */
export async function fixWarmupsIn(d: WorkoutDB, list: readonly WarmupFix[], nowIso: string): Promise<number> {
  let n = 0;
  const ids = [...new Set(list.map((f) => f.id))];
  for (const id of ids) {
    await d.transaction('rw', d.workouts, async () => {
      const cur = await d.workouts.get(id);
      if (!cur) return;
      const next = applyWarmups(cur, list, nowIso);
      if (next !== cur) { await d.workouts.put(next); n += list.filter((f) => f.id === id).length; }
    });
  }
  return n;
}
