/**
 * 끝내기 시각 바로잡기 (D-065) · 빈 운동 (D-072). 화면과 분리된 순수 함수.
 * - 끝내기 때 마지막 세트가 15분 넘게 지났으면 "마지막 세트 + 3분 / 지금" 고르기
 * - 운동 중 마지막 세트(없으면 시작) 뒤 30분이 지나 앱으로 돌아오면 "운동 끝났나요?" 띠
 */
import type { Workout } from './session';
import { timeText, dateTimeText, daysAgo } from './dateText';
import { durText } from './stats';

export const FINISH_RULE = {
  /** 끝내기 때 묻는 기준: 마지막 세트 뒤 15분 */
  askAfterMs: 15 * 60_000,
  /** 띠를 띄우는 기준: 마지막 세트(없으면 시작) 뒤 30분 */
  bannerAfterMs: 30 * 60_000,
  /** 제안하는 끝난 시각 = 마지막 세트 + 3분 */
  padMs: 3 * 60_000,
  /** 아주 긴 기록 기준: 12시간 */
  longMs: 12 * 3_600_000,
  /** 본 묶음: 앞 세트와 3시간 안의 세트 */
  clusterGapMs: 3 * 3_600_000,
} as const;

/** 완료한 세트 수 (웜업 포함) */
export function doneCount(w: Workout): number {
  let n = 0;
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) if (s.done) n++;
  return n;
}

/** 완료 세트의 끝낸 시각들 (ms, 오름차순). doneAt 없는 세트는 뺌 */
export function doneTimes(w: Workout): number[] {
  const out: number[] = [];
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) {
    if (!s.done || !s.doneAt) continue;
    const t = Date.parse(s.doneAt);
    if (!Number.isNaN(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** 마지막으로 완료한 세트 시각 (ms). 없으면 undefined */
export function lastDoneMs(w: Workout): number | undefined {
  const t = doneTimes(w);
  return t.length ? t[t.length - 1] : undefined;
}

/** 마지막 세트 + 3분 (지금보다 늦지 않게, 시작보다 이르지 않게) */
export function endAtLastSet(w: Workout, nowMs: number): string {
  const start = Date.parse(w.startedAt);
  const last = lastDoneMs(w) ?? start;
  return new Date(Math.min(nowMs, Math.max(start, last + FINISH_RULE.padMs))).toISOString();
}

/** 끝내기 때 끝난 시각을 물을지: 완료 세트가 있고 마지막 세트가 15분 넘게 지남 */
export function shouldAskEndTime(w: Workout, nowMs: number): boolean {
  const last = lastDoneMs(w);
  return last !== undefined && nowMs - last > FINISH_RULE.askAfterMs;
}

/** 휴식 타이머가 돌고 있는지 */
export const restRunning = (w: Workout, nowMs: number) => !!w.timer && w.timer.endsAt > nowMs;

/** "운동 끝났나요?" 띠를 띄울지: 진행 중, 휴식 중 아님, 마지막 세트(없으면 시작) 뒤 30분 넘음 */
export function shouldAskEnded(w: Workout, nowMs: number): boolean {
  if (w.endedAt || restRunning(w, nowMs)) return false;
  const ref = lastDoneMs(w) ?? Date.parse(w.startedAt);
  return nowMs - ref > FINISH_RULE.bannerAfterMs;
}

/** 화면 글자: 오늘이면 "오전 11:58", 아니면 "어제 오후 7:05" (D-060) */
export function whenText(iso: string | number, nowMs: number): string {
  return daysAgo(iso, nowMs) === 0 ? timeText(iso) : dateTimeText(iso, nowMs);
}

/**
 * 기록 수정 화면에서 완료로 바꾼 세트가 있는지 (A1). 그 세트의 끝낸 시각은 실제 시각이 아니라
 * workoutEdit.finalizeEdit 이 붙인 "시작 + k초"(k = 1, 2, …)라서 속도·끝 시각 계산에 쓰면 안 됨
 */
export function hasEditStamps(w: Workout): boolean {
  if (!w.editedAt) return false;
  // finalizeEdit 은 1초부터 차례로 붙이므로 "시작 + 정확히 1초" 세트가 있으면 그 모양 (실제 체크 시각은 ms 단위라 거의 안 겹침)
  const first = new Date(Date.parse(w.startedAt) + 1000).toISOString();
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) if (s.done && s.doneAt === first) return true;
  return false;
}

// ---------- 기존 기록 정리 (한 번 확인) ----------

export interface EndFix { id: string; name: string; startedAt: string; endedAt: string; lastAt: string; newEnd: string; stragglers: number }

/**
 * 늘어진 끝난 시각 후보 (12시간 이하 기록): 마지막 세트 → 끝이 15분 넘음 → 새 끝 = 마지막 세트 + 3분
 */
export function endFixes(history: readonly Workout[]): EndFix[] {
  const out: EndFix[] = [];
  for (const w of history) {
    // 사용자가 기록 수정 화면에서 고친 기록(editedAt)은 건드리지 않음: 끝 시각을 직접 정했거나 세트 시각이 "시작 + k초"라 믿을 수 없음 (A1)
    if (!w.endedAt || w.pendingMerge || w.editedAt) continue;
    const end = Date.parse(w.endedAt), start = Date.parse(w.startedAt);
    if (end - start > FINISH_RULE.longMs) continue; // 긴 기록은 따로 (longFixes)
    const last = lastDoneMs(w);
    if (last === undefined || end - last <= FINISH_RULE.askAfterMs) continue;
    const newEnd = Math.max(start + 60_000, last + FINISH_RULE.padMs);
    if (newEnd >= end) continue;
    out.push({ id: w.id, name: w.name, startedAt: w.startedAt, endedAt: w.endedAt, lastAt: new Date(last).toISOString(), newEnd: new Date(newEnd).toISOString(), stragglers: 0 });
  }
  return out;
}

/**
 * 본 묶음: 앞 세트와 3시간 안으로 이어진 세트 덩어리 중 세트가 가장 많은 것 (같으면 앞의 것).
 * 다음 날 늦게 체크한 세트 같은 떨어진 세트는 뺌
 */
export function mainCluster(times: readonly number[]): { first: number; last: number; count: number } | undefined {
  if (!times.length) return undefined;
  let best = { first: times[0]!, last: times[0]!, count: 1 };
  let cur = { ...best };
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! <= FINISH_RULE.clusterGapMs) { cur.last = times[i]!; cur.count++; }
    else cur = { first: times[i]!, last: times[i]!, count: 1 };
    if (cur.count > best.count) best = { ...cur };
  }
  return best;
}

/** 12시간 넘는 기록: 새 끝 = 본 묶음 마지막 세트 + 3분 (떨어진 세트 수도 알려 줌) */
export function longFixes(history: readonly Workout[]): EndFix[] {
  const out: EndFix[] = [];
  for (const w of history) {
    // 사용자가 기록 수정 화면에서 고친 기록(editedAt)은 건드리지 않음: 끝 시각을 직접 정했거나 세트 시각이 "시작 + k초"라 믿을 수 없음 (A1)
    if (!w.endedAt || w.pendingMerge || w.editedAt) continue;
    const end = Date.parse(w.endedAt), start = Date.parse(w.startedAt);
    if (end - start <= FINISH_RULE.longMs) continue;
    const times = doneTimes(w);
    const c = mainCluster(times);
    if (!c) continue;
    const newEnd = Math.max(start + 60_000, c.last + FINISH_RULE.padMs);
    if (newEnd >= end) continue;
    out.push({ id: w.id, name: w.name, startedAt: w.startedAt, endedAt: w.endedAt, lastAt: new Date(c.last).toISOString(), newEnd: new Date(newEnd).toISOString(), stragglers: times.length - c.count });
  }
  return out;
}

/** 완료 세트가 0개인 끝난 기록 (지우기 후보, D-072) */
export function emptyFinished(history: readonly Workout[]): Workout[] {
  return history.filter((w) => !!w.endedAt && !w.pendingMerge && doneCount(w) === 0);
}

/** 끝난 시각 고치기: 운동 기록 수정과 같이 고친 시각(editedAt)을 남김 (D-035) */
export function applyEnd(w: Workout, newEnd: string, nowIso: string): Workout {
  return { ...w, endedAt: newEnd, timer: null, editedAt: nowIso };
}

/** 같은 날(기준 base)이면 시각만, 아니면 날짜·시각 (기록 정리 화면) */
export const atText = (iso: string, base: string) => (daysAgo(iso, base) === 0 ? timeText(iso) : dateTimeText(iso, base, { relative: false }));
/**
 * 끝 시각 전 → 후 (B2): 새 끝이 원래 끝과 다른 날이면 새 끝에도 날짜를 붙이고, 운동 시간도 전 → 후로
 * 예: "끝 10월 3일(토) 오전 1:17 → 10월 2일(금) 오전 1:03 · 25시간 17분 → 1시간 3분"
 */
export function endChangeText(f: Pick<EndFix, 'startedAt' | 'endedAt' | 'newEnd'>): string {
  const oldEnd = atText(f.endedAt, f.startedAt);
  const newEnd = daysAgo(f.newEnd, f.endedAt) !== 0 ? dateTimeText(f.newEnd, f.startedAt, { relative: false }) : atText(f.newEnd, f.startedAt);
  const dur = (iso: string) => durText((Date.parse(iso) - Date.parse(f.startedAt)) / 1000);
  return `끝 ${oldEnd} → ${newEnd} · ${dur(f.endedAt)} → ${dur(f.newEnd)}`;
}
