/**
 * 기기 쪽 동기화 (S2b, D-027~D-029). 네트워크와 분리: transport(요청) → 응답 을 받아 쓰므로
 * 테스트에서는 가짜 서버(같은 합치기 코드)로 기기 여러 대를 돌려 수렴을 확인한다.
 *
 * 대원칙: 서버가 최종 판정, 기기는 따른다. 기기는 "아직 서버가 확정 안 한 내 수정(dirty)"만 지킨다.
 */
import type { WorkoutDB } from './db';
import type { HealthRow } from '../core/health';
import { SYNC_TABLES, PK, FIELD_TABLES, LOCAL_SETTINGS_FIELDS, syncedFields, withoutStamp, tombKey } from '../core/syncStamp';
import type { SyncStamp, SyncTable, Tomb } from '../core/syncStamp';
import { SYNC_SCHEMA } from '../core/syncMerge';
import type { Mutation, ServerRec, SyncRequest, SyncResponse } from '../core/syncMerge';

export const CHUNK = 300;
export type Transport = (req: SyncRequest) => Promise<SyncResponse | { ok: false; error: string }>;
/** healthSince (D-058): 애플워치 기록을 어디까지 받았나 (서버 rev). 따로 두는 까닭: 옛 앱 시절 since 는 이미 앞서 있어도 health 는 처음부터 받아야 함 */
export interface SyncKv { since: number; epoch: number; stash?: Mutation[]; connected?: boolean; lastOkAt?: string; healthSince?: number }

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
    const cur = (await db.table('settings').get(rec.id)) as Row | undefined;
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

/**
 * 애플워치 기록 반영 (D-058): 서버가 health 를 보냈을 때만 (새 서버). 전체 다시 받기면 비우고 다시 채움.
 * health 표는 기기가 고치지 않으므로 동기화 표시·지움 표시 없이 그대로 씀
 */
async function applyHealth(db: WorkoutDB, resp: SyncResponse): Promise<number> {
  const list = resp.health;
  if (!Array.isArray(list)) return 0;
  await db.transaction('rw', [db.health, db.kv], async () => {
    if (resp.full) await db.health.clear();
    for (const c of list) {
      if (c.deleted) await db.health.delete(c.id);
      else if (c.data) await db.health.put({ ...(c.data as Record<string, unknown>), id: c.id } as HealthRow);
    }
    await setKv(db, { healthSince: resp.rev });
  });
  return list.length;
}

export interface ApplyResult { confirmed: number; received: number; stashed?: number; full?: boolean; dedup?: number }

/** 응답 반영 (한 트랜잭션). 보낸 수정은 localSeq가 그대로일 때만 확정 (보내는 동안 또 고쳤으면 dirty 유지) */
export async function applyResponse(db: WorkoutDB, resp: SyncResponse, sent: Mutation[]): Promise<ApplyResult> {
  const tables = [...SYNC_TABLES.map((t) => db.table(t)), db.tombs, db.kv];
  let confirmed = 0, received = 0, stashed: number | undefined;
  await db.transaction('rw', tables, async () => {
    if (resp.full) {
      // 서버가 되돌려짐(epoch 바뀜): 안 보낸 수정은 따로 보관 → 전체 다시 받기 (S2b 검토 반영)
      //  - 기기별 설정(소리·화면 켜 두기·마지막 백업 등)은 비우기 전에 읽어 두었다가 다시 넣음
      //  - 이 기기가 주인인 진행 중 운동은 보관하지 않고 그대로 남겨 다시 올림 (운동 화면에서 사라지지 않게)
      //  - 보관본은 덮어쓰지 않고 합침 (되돌리기가 두 번 일어나도 처음 보관한 수정이 남게)
      const me = db.dev();
      const keepSettings = (await db.table('settings').get('main')) as Row | undefined;
      const mine = ((await db.table('workouts').toArray()) as Row[]).filter((w) => !w.endedAt && !w.pendingMerge && (!w.ownerDeviceId || w.ownerDeviceId === me));
      const mineKeys = new Set(mine.map((w) => String(w.id)));
      const dirty = (await collectMutations(db)).filter((m) => !(m.table === 'workouts' && mineKeys.has(m.id)));
      const prev = (await getKv(db)).stash ?? [];
      const byMid = new Map([...prev, ...dirty].map((m) => [m.mid, m]));
      const stash = [...byMid.values()];
      stashed = dirty.length;
      for (const t of SYNC_TABLES) await db.table(t).clear();
      await db.tombs.clear();
      let maxH = '';
      for (const c of resp.changes) { await writeRemote(db, c, 0); received++; if (c.hlc > maxH) maxH = c.hlc; }
      if (maxH) db.clock.observe(maxH);
      if (keepSettings) {
        const cur = (await db.table('settings').get('main')) as Row | undefined;
        const local = Object.fromEntries(LOCAL_SETTINGS_FIELDS.filter((k) => keepSettings[k] !== undefined).map((k) => [k, keepSettings[k]]));
        if (cur) await db.table('settings').put({ ...cur, ...local, _s: { ...cur._s!, remote: true } });
        else await db.table('settings').put({ ...keepSettings, _s: { ...keepSettings._s!, y: 1, remote: true } });
      }
      for (const w of mine) {
        const { _s: s0, ...rest } = w;
        const cur = (await db.table('workouts').get(String(w.id))) as Row | undefined;
        await db.table('workouts').put({ ...rest, _s: { h: db.clock.tick(me), d: me, q: (s0?.q ?? 0) + 1, y: 1, ...(cur?._s?.r !== undefined ? { b: cur._s.r, r: cur._s.r } : {}), remote: true } });
      }
      await setKv(db, { since: resp.rev, epoch: resp.epoch, stash: stash.length ? stash : undefined, lastOkAt: new Date().toISOString() });
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
        // 동시 수정에서 져서 서버 값이 보낸 것과 다르면 화면도 다시 읽어야 함
        if (r.rec.deleted !== !!m.deleted || (!m.deleted && JSON.stringify(sortObj(r.rec.data)) !== JSON.stringify(sortObj(FIELD_TABLES.includes(m.table) ? { ...(r.rec.data ?? {}), ...m.data } : m.data)))) received++;
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
/** null = 취소 (연결하지 않음, 아무것도 안 바꿈) */
export type ChooseFn = (conflicts: Conflict[]) => Promise<Record<string, 'local' | 'server'> | null>;
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
  const pull = await transport({ op: 'sync', schema: SYNC_SCHEMA, epoch: 0, since: 0, muts: [], healthSince: 0 });
  if (!pull.ok) return { confirmed: 0, received: 0, conflicts: 0, error: pull.error };
  const healthGot = await applyHealth(db, pull);
  const conflicts: Conflict[] = [];
  for (const c of pull.changes) {
    if (c.deleted || !(SYNC_TABLES as readonly string[]).includes(c.table)) continue;
    const local = (await db.table(c.table).get(c.id)) as Row | undefined;
    // 이 기기에서 고친(아직 안 보낸) 기록만 비교. 서버 확정본을 그대로 가진 기록은 서버 값을 받음 (끄고 켠 뒤 옛 사본이 새 수정을 덮지 않게)
    if (!local || local._s?.y !== 1) continue;
    const mine = FIELD_TABLES.includes(c.table) ? syncedFields(c.table, local) : (withoutStamp(local) as Record<string, unknown>);
    const theirs = FIELD_TABLES.includes(c.table) ? syncedFields(c.table, c.data) : (c.data ?? {});
    if (!same(mine, theirs)) conflicts.push({ table: c.table, id: c.id, label: String(mine.name ?? theirs.name ?? c.id), local: mine, server: theirs, rev: c.rev });
  }
  const picks = conflicts.length ? await choose(conflicts) : {};
  if (picks === null) return { confirmed: 0, received: 0, conflicts: conflicts.length, error: 'cancelled' };
  // 이 기기에만 있는 루틴 가운데 서버 루틴과 이름·내용이 같은 것은 중복이라 이 기기 것을 지움 (한 번도 올린 적 없어 지움 표시 불필요)
  const strip = (r: Record<string, unknown> | undefined) => { if (!r) return ''; const { id: _i, createdAt: _c, updatedAt: _u, _s: _x, ...rest } = r; return JSON.stringify(sortObj(rest)); };
  const serverRoutines = new Set(pull.changes.filter((c) => c.table === 'routines' && !c.deleted).map((c) => strip(c.data)));
  const serverIds = new Set(pull.changes.map((c) => tombKey(c.table, c.id)));
  const dupIds = ((await db.table('routines').toArray()) as Row[]).filter((r) => !serverIds.has(tombKey('routines', String(r.id))) && r._s?.r === undefined && serverRoutines.has(strip(r))).map((r) => String(r.id));
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
    for (const id of dupIds) await db.table('routines').delete(id);
    let maxH = '';
    for (const c of pull.changes) if (c.hlc > maxH) maxH = c.hlc;
    if (maxH) db.clock.observe(maxH);
    await setKv(db, { since: pull.rev, epoch: pull.epoch, connected: true });
  });
  const push = await syncOnce(db, transport);
  return { ...push, received: push.received + received + healthGot, conflicts: conflicts.length, ...(dupIds.length ? { dedup: dupIds.length } : {}) };
}

/** 한 번 동기화: 보낼 것 보내고 받은 것 반영. 처음이면 firstConnect */
export async function syncOnce(db: WorkoutDB, transport: Transport, choose?: ChooseFn): Promise<ApplyResult & { error?: string; conflicts?: number }> {
  const kv0 = await getKv(db);
  if (!kv0.epoch) return firstConnect(db, transport, choose);
  // 한 번에 CHUNK건씩 나눠 보냄 (처음 올릴 때 요청이 너무 커지거나 서버 실행 시간을 넘지 않게)
  const total: ApplyResult = { confirmed: 0, received: 0 };
  for (let round = 0; round < 50; round++) {
    const kv = await getKv(db);
    const all = await collectMutations(db);
    const muts = all.slice(0, CHUNK);
    const resp = await transport({ op: 'sync', schema: SYNC_SCHEMA, epoch: kv.epoch, since: kv.since, muts, healthSince: kv.healthSince ?? 0 });
    if (!resp.ok) return { ...total, error: resp.error };
    const r = await applyResponse(db, resp, muts);
    total.confirmed += r.confirmed; total.received += r.received + await applyHealth(db, resp);
    if (r.full) return { ...total, full: true, stashed: r.stashed };
    if (all.length <= CHUNK || r.confirmed === 0) break;
  }
  return total;
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
