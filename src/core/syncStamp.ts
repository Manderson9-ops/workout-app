/**
 * 동기화 표시 붙이기 (S2a, D-029). 기록을 저장할 때마다 DB 층(미들웨어)이 자동으로 부른다.
 * 기록 안의 `_s` 에 동기화 정보를 둔다 (백업 파일로 내보낼 때는 뺌).
 *
 *  h: HLC(고친 시각)  d: 고친 기기  q: localSeq(기기 안에서 그 건을 고칠 때마다 +1)
 *  y: dirty(1 = 아직 서버가 확정 안 함)  b: baseRev(이 수정을 시작할 때 알던 그 건의 serverRev)  r: serverRev
 *  f: (설정·운동 표시만) 최상위 항목별 HLC → 항목 단위 합치기
 */
import { hlcZero } from './hlc.ts';

export interface SyncStamp { h: string; d: string; q: number; y: 0 | 1; b?: number; r?: number; f?: Record<string, string> }

/** 동기화하는 표. diag(진단)는 보내기만, tombs(지움 표시)는 따로 */
export const SYNC_TABLES = ['routines', 'workouts', 'meta', 'custom', 'settings', 'bodyweight', 'feedback'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
/** 항목 단위로 합치는 표 */
export const FIELD_TABLES: readonly string[] = ['settings', 'meta'];
/** 기기마다 다른 설정 (동기화하지 않음, D-029) */
export const LOCAL_SETTINGS_FIELDS: readonly string[] = ['key', 'lastBackupAt', 'storageNoticeSeen', 'soundOn', 'keepAwake'];
/** 표마다 기본 키 이름 (지움 표시·동기화 단위) */
export const PK: Record<SyncTable, string> = { routines: 'id', workouts: 'id', meta: 'exerciseId', custom: 'id', settings: 'key', bodyweight: 'date', feedback: 'id' };

type Rec = Record<string, unknown> & { _s?: SyncStamp & { remote?: boolean } };

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const withoutStamp = (v: Rec | undefined) => { if (!v) return v; const { _s: _x, ...rest } = v; return rest; };

/** 동기화하는 항목만 (설정의 기기별 항목·키 제외) */
export function syncedFields(table: string, v: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!v) return out;
  for (const k of Object.keys(v)) {
    if (k === '_s' || v[k] === undefined) continue;
    if (table === 'settings' && LOCAL_SETTINGS_FIELDS.includes(k)) continue;
    if (table === 'meta' && k === 'exerciseId') continue;
    out[k] = v[k];
  }
  return out;
}

/** 옮김(마이그레이션)·백업 불러오기로 들어온 기록의 첫 표시: HLC 0, 아직 안 보냄 */
export function baseStamp(table: string, v: Record<string, unknown>, dev: string): SyncStamp {
  const s: SyncStamp = { h: hlcZero(dev), d: dev, q: 1, y: 1 };
  if (FIELD_TABLES.includes(table)) s.f = Object.fromEntries(Object.keys(syncedFields(table, v)).map((k) => [k, s.h]));
  return s;
}

/**
 * 새 값에 표시를 붙임.
 * - 서버에서 온 값(_s.remote)은 그대로 저장 (표시만 떼어 냄)
 * - 동기화하는 내용이 그대로면 표시도 그대로 (예: 설정의 마지막 백업 시각만 바뀜 → 보낼 것 없음)
 * - 바뀌었으면 새 HLC, localSeq +1, dirty. baseRev는 "처음 고치기 시작할 때" 알던 serverRev를 유지
 * - 설정·운동 표시는 바뀐 항목에만 새 HLC
 */
export function stampValue(table: string, oldV: Rec | undefined, newV: Rec, tick: () => string, dev: string): Rec {
  const incoming = newV._s;
  if (incoming?.remote) { const { remote: _r, ...s } = incoming; return { ...newV, _s: s }; }
  const olds = oldV?._s;
  const before = syncedFields(table, oldV), after = syncedFields(table, newV);
  const changed = oldV === undefined || stableJson(before) !== stableJson(after);
  if (!changed) return { ...newV, _s: olds ?? incoming ?? baseStamp(table, newV, dev) };
  const h = tick();
  const s: SyncStamp = { h, d: dev, q: (olds?.q ?? 0) + 1, y: 1 };
  const base = olds?.y === 1 ? olds.b : olds?.r;
  if (base !== undefined) s.b = base;
  if (olds?.r !== undefined) s.r = olds.r;
  if (FIELD_TABLES.includes(table)) {
    const f: Record<string, string> = { ...(olds?.f ?? {}) };
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (stableJson(before[k]) !== stableJson(after[k])) f[k] = h;
    s.f = f;
  }
  return { ...newV, _s: s };
}

/** 지움 표시 한 건 (tombs 표). 키 = "표/ID" */
export interface Tomb { k: string; table: SyncTable; id: string; _s: SyncStamp }
export const tombKey = (table: string, id: string) => `${table}/${id}`;
