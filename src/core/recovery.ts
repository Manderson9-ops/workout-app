/**
 * D-057: 부위별 회복 상태 추정 (순수 함수, 앱 판단 추정).
 * 근거 규칙 (docs/research/운동회복_논문DB.md, data/recovery_rules.json):
 * - AR-01: 모든 부위 같은 기본값 48시간 (근육 크기로 나누지 않음, AR-05)
 * - AR-03: 그 세션에서 그 부위 작업 세트가 많으면(앱 기준 10세트 이상) 72시간
 * - AR-02: 실패 세트(RIR 0 기록)가 있으면 +24시간
 * - 상한 72시간: 연구가 회복을 72시간(R-03)·48시간(R-04)까지만 추적 → 계산이 72시간을 넘으면 72시간으로 보이고 "연구 추적 범위 밖" 안내 (D-057 2차 검증)
 * - AR-19: 화면 문구는 늘 "추정", 근육통 유무로 판단하지 않음
 * 부위는 기록 탭과 같은 주 부위(운동의 part) 기준. 같은 부위를 여러 번 했으면 가장 최근 세션만 (단순화, 앱 판단)
 */
import type { Exercise, Part } from './types';
import { PARTS } from './types';
import type { Workout } from './session';
import { isCountedWorkout } from './stats';

export const BASE_H = 48;
export const HIGH_VOL_H = 72;
export const HIGH_VOL_SETS = 10;
export const FAIL_ADD_H = 24;
export const CAP_H = 72;
export const ALMOST_RATIO = 0.75;

export type RecoveryStatus = 'recovering' | 'almost' | 'recovered';
export const STATUS_LABEL: Record<RecoveryStatus, string> = { recovering: '회복 중', almost: '거의', recovered: '회복됨' };

export interface PartRecovery {
  part: Part;
  workoutId: string;
  workoutName: string;
  /** 그 세션이 끝난 시각 (ISO) */
  at: string;
  sets: number;
  failSets: number;
  /** 계산값 (상한 전) */
  rawH: number;
  /** 보여 줄 추정 (상한 72시간) */
  estimateH: number;
  /** 계산이 72시간을 넘어 72시간으로 줄였는지 (연구 추적 범위 밖) */
  overCap: boolean;
  elapsedH: number;
  /** 남은 시간 (올림, 0 이상) */
  remainingH: number;
  status: RecoveryStatus;
  /** 이 추정에 쓴 규칙 ID */
  rules: string[];
}

/** 세션 하나의 그 부위 추정 시간 (상한 전) */
export function estimateHours(sets: number, failSets: number): number {
  return (sets >= HIGH_VOL_SETS ? HIGH_VOL_H : BASE_H) + (failSets > 0 ? FAIL_ADD_H : 0);
}

export function statusOf(elapsedH: number, estimateH: number): RecoveryStatus {
  if (elapsedH >= estimateH) return 'recovered';
  return elapsedH / estimateH >= ALMOST_RATIO ? 'almost' : 'recovering';
}

const endMs = (w: Workout) => Date.parse(w.endedAt ?? w.startedAt);

/** 부위별 회복 추정 (그 부위를 한 적이 있는 부위만). 끝난·센(완료 세트 있는) 운동만, 늦게 온 사본(pendingMerge) 제외. nowMs 보다 나중 기록은 무시 */
export function recoveryByPart(workouts: readonly Workout[], byId: Map<string, Pick<Exercise, 'part'>>, nowMs: number): Map<Part, PartRecovery> {
  const out = new Map<Part, PartRecovery>();
  const done = workouts.filter((w) => isCountedWorkout(w) && !w.pendingMerge && Number.isFinite(endMs(w)) && endMs(w) <= nowMs)
    .sort((a, b) => endMs(b) - endMs(a)); // 최신 먼저
  for (const w of done) {
    const per = new Map<Part, { sets: number; fail: number }>();
    for (const b of w.blocks) for (const it of b.items) {
      const part = byId.get(it.exerciseId)?.part;
      if (!part) continue;
      for (const s of it.sets) {
        if (!s.done || s.warmup) continue;
        const x = per.get(part) ?? { sets: 0, fail: 0 };
        x.sets++; if (s.rir === 0) x.fail++;
        per.set(part, x);
      }
    }
    for (const [part, x] of per) {
      if (out.has(part) || x.sets === 0) continue; // 더 최근 세션이 이미 있음
      const rawH = estimateHours(x.sets, x.fail);
      const estimateH = Math.min(rawH, CAP_H);
      const elapsedH = (nowMs - endMs(w)) / 3_600_000;
      const rules = ['AR-01', 'AR-05', 'AR-19', ...(x.sets >= HIGH_VOL_SETS ? ['AR-03'] : []), ...(x.fail ? ['AR-02'] : [])];
      out.set(part, {
        part, workoutId: w.id, workoutName: w.name, at: w.endedAt ?? w.startedAt, sets: x.sets, failSets: x.fail,
        rawH, estimateH, overCap: rawH > CAP_H, elapsedH,
        remainingH: Math.max(0, Math.ceil(estimateH - elapsedH)), status: statusOf(elapsedH, estimateH), rules,
      });
    }
  }
  return out;
}

/** 화면 순서: 회복 중(남은 시간 많은 순) → 거의 → 회복됨, 같으면 PARTS 순 */
export function sortedRecovery(m: Map<Part, PartRecovery>): PartRecovery[] {
  const rank: Record<RecoveryStatus, number> = { recovering: 0, almost: 1, recovered: 2 };
  return [...m.values()].sort((a, b) => rank[a.status] - rank[b.status] || b.remainingH - a.remainingH || PARTS.indexOf(a.part) - PARTS.indexOf(b.part));
}

/** 홈 한 줄: "회복 중: 하체(약 20시간) · 회복됨: 가슴·등" (없으면 '') */
export function recoveryLine(list: readonly PartRecovery[]): string {
  const busy = list.filter((r) => r.status !== 'recovered').map((r) => `${r.part}(약 ${r.remainingH}시간)`);
  const ok = list.filter((r) => r.status === 'recovered').map((r) => r.part);
  return [busy.length ? `회복 중: ${busy.join(', ')}` : '', ok.length ? `회복됨: ${ok.join('·')}` : ''].filter(Boolean).join(' · ');
}

/** "약 N시간 전" (1시간 미만은 "방금", 48시간 넘으면 "N일 전") */
export function agoText(elapsedH: number): string {
  if (elapsedH < 1) return '방금';
  if (elapsedH < 48) return `약 ${Math.floor(elapsedH)}시간 전`;
  return `${Math.floor(elapsedH / 24)}일 전`;
}

/** 최근 days일 안에 한 부위만 보이고, 나머지는 "최근 기록 없는 부위"로 (D-057 검토 F6) */
export const RECENT_DAYS = 14;
export function splitRecent(list: readonly PartRecovery[], days = RECENT_DAYS): { recent: PartRecovery[]; staleParts: Part[] } {
  const recent = list.filter((r) => r.elapsedH <= days * 24);
  const have = new Set(recent.map((r) => r.part));
  return { recent, staleParts: PARTS.filter((p) => !have.has(p)) };
}
/** 쓴 규칙들의 근거 논문 ID (중복 없이, 번호 순) — 카드 아래 근거 표시 (검토 F4) */
export function evidenceIds(ruleIds: readonly string[], papersOf: (id: string) => readonly string[]): { rules: string[]; papers: string[] } {
  const rules = [...new Set(ruleIds)].sort();
  const papers = [...new Set(rules.flatMap((id) => papersOf(id)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  return { rules, papers };
}

/** 은/는 (마지막 글자 받침): 가슴은, 하체는 */
export function topicJosa(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${word}은(는)`;
  return `${word}${(c - 0xac00) % 28 ? '은' : '는'}`;
}

/** 아직 회복 중인 부위만 (플랜·다음 운동 안내용) */
export const busyParts = (m: Map<Part, PartRecovery>, parts: readonly Part[]): PartRecovery[] =>
  parts.map((p) => m.get(p)).filter((r): r is PartRecovery => !!r && r.status !== 'recovered');
