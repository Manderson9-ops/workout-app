/**
 * 기기 쪽 동기화 (S2b, D-027~D-029). 네트워크와 분리: transport(요청) → 응답 을 받아 쓰므로
 * 테스트에서는 가짜 서버(같은 합치기 코드)로 기기 여러 대를 돌려 수렴을 확인한다.
 *
 * 대원칙: 서버가 최종 판정, 기기는 따른다. 기기는 "아직 서버가 확정 안 한 내 수정(dirty)"만 지킨다.
 */
import type { WorkoutDB } from './db';
import { SYNC_TABLES, PK, FIELD_TABLES, LOCAL_SETTINGS_FIELDS, syncedFields, withoutStamp, tombKey } from '../core/syncStamp';
import type { SyncStamp, SyncTable, Tomb } from '../core/syncStamp';
import { SYNC_SCHEMA } from '../core/syncMerge';
import type { Mutation, ServerRec, SyncRequest, SyncResponse } from '../core/syncMerge';

export type Transport = (req: SyncRequest) => Promise<SyncResponse | { ok: false; error: string }>;
export interface SyncKv { since: number; epoch: number; stash?: Mutation[]; connected?: boolean; lastOkAt?: string }

type Row = Record<string, unknown> & { _s?: SyncStamp };

export async function getKv(db: WorkoutDB): Promise<SyncKv> {
  return ((await db.kv.get('sync'))?.v as SyncKv | undefined) ?? { since: 0, epoch: 0 };
}
export async function setKv(db: WorkoutDB, patch: Partial<SyncKv>): Promise<void> {
  const cur = await getKv(db);
  await db.kv.put({ k: 'sync', v: { ...cur, ...patch } });
}

/** 수정 ID = 기기:표:ID:HLC. HLC는 기기 안에서 절대 겹치지 않아, 지운 뒤 같은 키로 다시 만들어도 재전송 판정이 틀리지 않음 (S2a 검토) */
const midOf = (dev: string, table: string, id: string, h: string) => `${dev}:${table}:${id}:${h}`;

/** 아직 서버가 확정 안 한 수정 모으기 */
export async function collectMutations(db: WorkoutDB): Promise<Mutation[]> {
  const out: Mutation[] = [];
  for (const t of SYNC_TABLES) {
    const rows = (await db.table(t).toArray()) as Row[];
    for (const r of rows) {
      const s = r._s;
      if (!s || s.y !== 1) continue;
      const id = String(r[PK[t]]);
      const data = FIELD_TABLES.includes(t) ? syncedFields(t, r) : (withoutStamp(r) as Record<string, unknown>);
      out.push({ mid: midOf(s.d, t, id, s.h), table: t, id, hlc: s.h, dev: s.d, ...(s.b !== undefined ? { baseRev: s.b } : {}), data, ...(s.f ? { f: s.f } : {}) });
    }
  }
  for (const tb of await db.tombs.toArray()) {
    if (tb._s.y !== 1) continue;
    // 지운 뒤 같은 키로 다시 만든 기록이 있으면 지움 표시는 보내지 않음 (살아 있는 기록이 더 나중)
    if (await db.table(tb.table).get(tb.id)) continue;
    out.push({ mid: midOf(tb._s.d, tb.table, tb.id, tb._s.h), table: tb.table, id: tb.id, hlc: tb._s.h, dev: tb._s.d, ...(tb._s.b !== undefined ? { baseRev: tb._s.b } : {}), deleted: true });
  }
  return out;
}

/** 서버가 확정한 건을 이 기기에 씀 (dirty 아님). 설정은 기기별 항목을 지킴 */
async function writeRemote(db: WorkoutDB, rec: ServerRec, localQ: number): Promise<void> {
  const t = rec.table as SyncTable;
  if (!(SYNC_TABLES as readonly string[]).includes(t)) return;
  const key = tombKey(t, rec.id);
  const s: SyncStamp & { remote: true } = { h: rec.hlc, d: rec.dev, q: localQ, y: 0, r: rec.rev, ...(rec.f ? { f: rec.f } : {}), remote: true };
  if (rec.deleted) {
    await db.table(t).delete(rec.id);
    const { remote: _r, ...ts } = s;
    await db.tombs.put({ k: key, table: t, id: rec.id, _s: ts });
    return;
  }
  let data: Record<string, unknown> = { ...(rec.data ?? {}), [PK[t]]: t === 'bodyweight' || t === 'settings' || t === 'meta' ? rec.id : (rec.data?.[PK[t]] ?? rec.id) };
  if (t === 'settings') {
    const cur = (await db.settings.get(rec.id)) as Row | undefined;
    const local = Object.fromEntries(LOCAL_SETTINGS_FIELDS.filter((k) => cur && cur[k] !== undefined).map((k) => [k, cur![k]]));
    data = { ...data, ...local, key: rec.id };
  }
  await db.table(t).put({ ...data, _s: s });
  await db.tombs.delete(key);
}

async function localStamp(db: WorkoutDB, table: string, id: string): Promise<SyncStamp | undefined> {
  const r = (await db.table(table).get(id)) as Row | undefined;
  if (r?._s) return r._s;
  return (await db.tombs.get(tombKey(table, id)))?._s;
}

export interface ApplyResult { confirmed: number; received: number; stashed?: number; full?: boolean }

/** 응답 반영 (한 트랜잭션). 보낸 수정은 localSeq가 그대로일 때만 확정 (보내는 동안 또 고쳤으면 dirty 유지) */
export async function applyResponse(db: WorkoutDB, resp: SyncResponse, sent: Mutation[]): Promise<ApplyResult> {
  const tables = [...SYNC_TABLES.map((t) => db.table(t)), db.tombs, db.kv];
  let confirmed = 0, received = 0, stashed: number | undefined;
  await db.transaction('rw', tables, async () => {
    if (resp.full) {
      // 서버가 되돌려짐(epoch 바뀜): 안 보낸 수정은 따로 보관 → 전체 다시 받기
      const dirty = await collectMutations(db);
      stashed = dirty.length;
      for (const t of SYNC_TABLES) await db.table(t).clear();
      await db.tombs.clear();
      for (const c of resp.changes) { await writeRemote(db, c, 0); received++; }
      await setKv(db, { since: resp.rev, epoch: resp.epoch, ...(dirty.length ? { stash: dirty } : {}), lastOkAt: new Date().toISOString() });
      return;
    }
    const sentByMid = new Map(sent.map((m) => [m.mid, m]));
    const done = new Set<string>();
    let maxSeen = '';
    for (const r of resp.results) {
      const m = sentByMid.get(r.mid);
      if (!m) continue;
      const cur = await localStamp(db, m.table, m.id);
      // 보낸 뒤 또 고치지 않았을 때만 확정 (기기 쪽 HLC가 보낸 것과 같음). 서버가 다시 찍은 HLC와는 비교하지 않음
      if (cur && cur.h === m.hlc && cur.y === 1) {
        await writeRemote(db, r.rec, cur.q);
        confirmed++;
        done.add(tombKey(r.rec.table, r.rec.id));
        // 서버가 내 시각을 낮춰 다시 찍었으면(미래 시계) 기기 기준도 낮춤
        if (r.rec.dev === m.dev && r.rec.hlc < m.hlc) db.clock.lower(r.rec.hlc);
      }
      for (const c of r.copies) { const cs = await localStamp(db, c.table, c.id); if (!cs || cs.y !== 1) { await writeRemote(db, c, cs?.q ?? 0); received++; } done.add(tombKey(c.table, c.id)); }
      if (r.rec.hlc > maxSeen) maxSeen = r.rec.hlc;
    }
    for (const c of resp.changes) {
      const k = tombKey(c.table, c.id);
      if (done.has(k)) continue;
      const cur = await localStamp(db, c.table, c.id);
      if (cur?.y === 1) continue; // 내 안 보낸 수정은 지킴 (다음 보내기에서 서버가 판정)
      if (cur && cur.r !== undefined && cur.r >= c.rev) continue; // 이미 반영
      await writeRemote(db, c, cur?.q ?? 0);
      received++;
      if (c.hlc > maxSeen) maxSeen = c.hlc;
    }
    if (maxSeen) db.clock.observe(maxSeen);
    await setKv(db, { since: resp.rev, epoch: resp.epoch, lastOkAt: new Date().toISOString() });
  });
  return { confirmed, received, ...(stashed !== undefined ? { stashed, full: true } : {}) };
}

export interface Conflict { table: string; id: string; label: string; local: Record<string, unknown>; server: Record<string, unknown>; rev: number }
export type ChooseFn = (conflicts: Conflict[]) => Promise<Record<string, 'local' | 'server'>>;
const keepLocal: ChooseFn = async (cs) => Object.fromEntries(cs.map((c) => [tombKey(c.table, c.id), 'local' as const]));

const same = (a: unknown, b: unknown) => JSON.stringify(sortObj(a)) === JSON.stringify(sortObj(b));
function sortObj(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortObj);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, sortObj((v as Record<string, unknown>)[k])]));
  return v;
}

/**
 * 처음 연결 (D-029 4.2-6, 순서 고정): ① (앱이 백업 파일 저장) ② 서버 전체 받기 — 아직 안 올림
 * ③ 같은 ID인데 내용이 다른 건 비교 ④ 사용자가 고름 ⑤ 그다음 이 기기 기록 올리기
 */
export async function firstConnect(db: WorkoutDB, transport: Transport, choose: ChooseFn = keepLocal): Promise<ApplyResult & { conflicts: number; error?: string }> {
  const pull = await transport({ op: 'sync', schema: SYNC_SCHEMA, epoch: 0, since: 0, muts: [] });
  if (!pull.ok) return { confirmed: 0, received: 0, conflicts: 0, error: pull.error };
  const conflicts: Conflict[] = [];
  for (const c of pull.changes) {
    if (c.deleted || !(SYNC_TABLES as readonly string[]).includes(c.table)) continue;
    const local = (await db.table(c.table).get(c.id)) as Row | undefined;
    if (!local) continue;
    const mine = FIELD_TABLES.includes(c.table) ? syncedFields(c.table, local) : (withoutStamp(local) as Record<string, unknown>);
    const theirs = FIELD_TABLES.includes(c.table) ? syncedFields(c.table, c.data) : (c.data ?? {});
    if (!same(mine, theirs)) conflicts.push({ table: c.table, id: c.id, label: String(mine.name ?? theirs.name ?? c.id), local: mine, server: theirs, rev: c.rev });
  }
  const picks = conflicts.length ? await choose(conflicts) : {};
  let received = 0;
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.tombs, db.kv], async () => {
    for (const c of pull.changes) {
      const k = tombKey(c.table, c.id);
      const cur = await localStamp(db, c.table, c.id);
      const conflict = conflicts.find((x) => tombKey(x.table, x.id) === k);
      if (conflict && picks[k] === 'local') {
        // 이 기기 것을 올림: 서버 값을 보고 고친 것으로(순서대로) 표시 → 서버가 받아들임
        const r = (await db.table(c.table).get(c.id)) as Row;
        await db.table(c.table).put({ ...r, _s: { ...r._s!, y: 1, b: c.rev, r: c.rev, h: db.clock.tick(db.dev()), q: (r._s?.q ?? 0) + 1, remote: true, ...(r._s?.f ? { f: Object.fromEntries(Object.keys(r._s.f).map((f) => [f, db.clock.tick(db.dev())])) } : {}) } });
        continue;
      }
      if (cur?.y === 1 && !conflict && !c.deleted) {
        // 같은 내용이면 서버 값으로 확정 (다시 올리지 않음)
        await writeRemote(db, c, cur.q); received++; continue;
      }
      if (cur?.y === 1 && c.deleted) continue; // 이 기기에 살아 있는 건은 올림 (서버가 판정)
      await writeRemote(db, c, cur?.q ?? 0); received++;
    }
    await setKv(db, { since: pull.rev, epoch: pull.epoch, connected: true });
  });
  const push = await syncOnce(db, transport);
  return { ...push, received: push.received + received, conflicts: conflicts.length };
}

/** 한 번 동기화: 보낼 것 보내고 받은 것 반영. 처음이면 firstConnect */
export async function syncOnce(db: WorkoutDB, transport: Transport, choose?: ChooseFn): Promise<ApplyResult & { error?: string; conflicts?: number }> {
  const kv = await getKv(db);
  if (!kv.epoch) return firstConnect(db, transport, choose);
  const muts = await collectMutations(db);
  const resp = await transport({ op: 'sync', schema: SYNC_SCHEMA, epoch: kv.epoch, since: kv.since, muts });
  if (!resp.ok) return { confirmed: 0, received: 0, error: resp.error };
  return applyResponse(db, resp, muts);
}

/** 되돌리기 뒤 보관한 수정 다시 올리기: 새 epoch의 serverRev를 baseRev로 다시 잡고 dirty로 되돌림 */
export async function restoreStash(db: WorkoutDB): Promise<number> {
  const kv = await getKv(db);
  const stash = kv.stash ?? [];
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.tombs, db.kv], async () => {
    for (const m of stash) {
      const cur = await localStamp(db, m.table, m.id);
      const q = (cur?.q ?? 0) + 1;
      const s: SyncStamp = { h: db.clock.tick(db.dev()), d: db.dev(), q, y: 1, ...(cur?.r !== undefined ? { b: cur.r, r: cur.r } : {}) };
      if (m.deleted) {
        await db.table(m.table).delete(m.id);
        await db.tombs.put({ k: tombKey(m.table, m.id), table: m.table as SyncTable, id: m.id, _s: s } as Tomb);
      } else {
        const ex = (await db.table(m.table).get(m.id)) as Row | undefined;
        const data = m.table === 'settings' ? { ...(ex ?? {}), ...m.data, key: m.id } : { ...m.data, [PK[m.table as SyncTable]]: m.id };
        if (FIELD_TABLES.includes(m.table)) s.f = Object.fromEntries(Object.keys(m.f ?? {}).map((k) => [k, s.h]));
        await db.table(m.table).put({ ...data, _s: { ...s, remote: true } });
      }
    }
    await setKv(db, { stash: undefined });
  });
  return stash.length;
}
export async function dropStash(db: WorkoutDB): Promise<void> { await setKv(db, { stash: undefined }); }
