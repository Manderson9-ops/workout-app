/** 기록 요약 카드의 보기 저장값 (localStorage `stats.period.v1`): 기간 단위·지표·그래프 보기 */
import type { PeriodKind, PeriodMetric } from './period';
import { METRICS } from './periodText';

export type ChartMode = 'cum' | 'bar' | 'both';
export interface PeriodPref { kind: PeriodKind; metric: PeriodMetric; mode: ChartMode }

const KINDS: PeriodKind[] = ['week', 'month', 'year', 'all'];
const MODES: ChartMode[] = ['cum', 'bar', 'both'];

/** 없거나 깨졌거나 모르는 값은 기본값(주·작업 세트·막대+누적). mode 가 없는 옛 저장값도 막대+누적 */
export function parsePeriodPref(raw: string | null | undefined): PeriodPref {
  let v = null as { kind?: unknown; metric?: unknown; mode?: unknown } | null;
  try { v = JSON.parse(raw ?? 'null') as typeof v; } catch { /* 깨진 값은 기본값 */ }
  return { kind: KINDS.find((k) => k === v?.kind) ?? 'week', metric: METRICS.find((m) => m === v?.metric) ?? 'sets', mode: MODES.find((m) => m === v?.mode) ?? 'both' };
}

export function serializePeriodPref(p: PeriodPref): string { return JSON.stringify({ kind: p.kind, metric: p.metric, mode: p.mode }); }
