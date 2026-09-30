/**
 * 동기화 서버의 합치기 규칙 (S2b, D-029). 순수 함수 한 벌을
 *  - 앱 테스트(수렴·장애 주입)와
 *  - 구글 Apps Script 서버(빌드해서 붙여 넣음: tools/gas/build.ts)
 * 가 함께 쓴다. 대원칙: 서버가 최종 판정, 기기는 따른다.
 *
 * 외부 모듈을 가져오지 않는다 (Apps Script에서 그대로 돌아야 함).
 */

export const SYNC_SCHEMA = 1;
export const FIELD_TABLES_M = ['settings', 'meta'];
export const MUT_KEEP = 5000;
/** 서버 시각보다 이만큼 넘게 미래인 HLC는 서버 시각으로 다시 찍음 */
export const FUTURE_MS = 10 * 60_000;

export interface ServerRec {
  table: string; id: string;
  data?: Record<string, unknown>;
  deleted?: boolean;
  hlc: string; dev: string; rev: number;
  /** 항목 단위 표(설정·운동 표시)의 항목별 HLC */
  f?: Record<string, string>;
}
export interface ServerState {
  epoch: number; rev: number;
  recs: Record<string, ServerRec>;
  /** mutationId → 결과 rev (최근 MUT_KEEP개, 재전송을 한 번만 반영) */
  muts: Record<string, number>;
  mutOrder: string[];
}
export interface Mutation {
  mid: string; table: string; id: string;
  hlc: string; dev: string; baseRev?: number;
  data?: Record<string, unknown>; deleted?: boolean;
  f?: Record<string, string>;
}
export interface MutResult { mid: string; key: string; rec: ServerRec; copies: ServerRec[]; dup?: boolean }

export const emptyState = (): ServerState => ({ epoch: 1, rev: 0, recs: {}, muts: {}, mutOrder: [] });
export const recKey = (table: string, id: string) => `${table}/${id}`;

const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).padStart(w, '0');
const fmt = (ms: number, c: number, dev: string) => `${pad(ms, 13)}.${pad(c, 4)}.${dev}`;
const parse = (h: string) => { const [a, b] = (h || '').split('.'); return { ms: Number(a) || 0, c: Number(b) || 0 }; };
/** h보다 큰 HLC (같은 기기 표시), 서버 시각 이상 */
function after(h: string, nowMs: number, dev: string): string {
  const p = parse(h);
  const ms = Math.max(nowMs, p.ms);
  return fmt(ms, ms === p.ms ? p.c + 1 : 0, dev);
}
const maxH = (a: string, b: string) => (a > b ? a : b);

function clampFuture(h: string, nowMs: number, dev: string): string {
  return parse(h).ms > nowMs + FUTURE_MS ? fmt(nowMs, 0, dev) : h;
}

/** 늦게 온 세트 사본: 서버본에서 아직 안 끝낸(또는 없는) 세트 가운데 기기가 끝낸 것만 */
function lateSets(server: Record<string, unknown>, mine: Record<string, unknown>): Record<string, unknown> | undefined {
  type S = { done?: boolean; warmup?: boolean };
  type It = { exerciseId: string; sets: S[] };
  type B = { items: It[] };
  const sb = (server.blocks as B[] | undefined) ?? [], mb = (mine.blocks as B[] | undefined) ?? [];
  let any = false;
  const blocks = mb.map((b, bi) => ({
    ...b,
    items: b.items.map((it, ii) => {
      const sItem = sb[bi]?.items?.[ii];
      const sets = it.sets.filter((s, k) => s.done && !(sItem && sItem.exerciseId === it.exerciseId && sItem.sets?.[k]?.done));
      if (sets.length) any = true;
      return { ...it, sets };
    }).filter((it) => it.sets.length),
  })).filter((b) => b.items.length);
  if (!any) return undefined;
  return { ...mine, blocks };
}

/**
 * 수정들을 반영. state를 제자리에서 바꾼다 (서버는 반영 뒤 파일로 저장).
 * 결과: 수정마다 확정된 건(+ 만들어진 사본들)
 */
export function applyMutations(state: ServerState, muts: Mutation[], nowMs: number): MutResult[] {
  const out: MutResult[] = [];
  const bump = (rec: ServerRec) => { rec.rev = ++state.rev; state.recs[recKey(rec.table, rec.id)] = rec; return rec; };
  for (const m0 of muts) {
    const key = recKey(m0.table, m0.id);
    // 재전송: 이미 반영한 수정이면 지금 값만 돌려줌
    if (state.muts[m0.mid] !== undefined) {
      const cur = state.recs[key];
      if (cur) out.push({ mid: m0.mid, key, rec: cur, copies: [], dup: true });
      continue;
    }
    const m: Mutation = { ...m0, hlc: clampFuture(m0.hlc, nowMs, m0.dev) };
    const ex = state.recs[key];
    const copies: ServerRec[] = [];
    // 동시 수정 = 기기가 모르는 사이 서버가 다른 기기 수정으로 바뀜 (건별 baseRev + 마지막 수정 기기가 다름)
    const concurrent = !!ex && (m.baseRev ?? 0) < ex.rev && ex.dev !== m.dev;
    let rec: ServerRec;

    if (FIELD_TABLES_M.includes(m.table)) {
      // 항목 단위: 항목별 HLC가 큰 쪽 (지움 없음)
      const data: Record<string, unknown> = { ...(ex?.data ?? {}) };
      const f: Record<string, string> = { ...(ex?.f ?? {}) };
      let changed = !ex;
      for (const [k, h0] of Object.entries(m.f ?? {})) {
        const h = clampFuture(h0, nowMs, m.dev);
        if (!f[k] || h > f[k]!) {
          f[k] = h;
          if (m.data && k in m.data) data[k] = m.data[k]; else delete data[k];
          changed = true;
        }
      }
      if (changed) rec = bump({ table: m.table, id: m.id, data, f, hlc: maxH(ex?.hlc ?? '', m.hlc), dev: m.dev, rev: 0 });
      else rec = ex!;
    } else if (m.deleted) {
      if (!ex) rec = bump({ table: m.table, id: m.id, deleted: true, hlc: m.hlc, dev: m.dev, rev: 0 });
      else if (ex.deleted) rec = ex;
      else if (concurrent) {
        // 수정 대 지움이 동시면 수정이 이김: 다시 찍어 지운 기기에도 되살아나게
        rec = bump({ ...ex, hlc: after(maxH(ex.hlc, m.hlc), nowMs, 'srv'), dev: ex.dev, rev: 0 });
      } else rec = bump({ table: m.table, id: m.id, deleted: true, hlc: maxH(m.hlc, after(ex.hlc, 0, m.dev)), dev: m.dev, rev: 0 });
    } else {
      const data = m.data ?? {};
      const isWorkout = m.table === 'workouts';
      const exOwner = ex?.data?.ownerDeviceId as string | undefined;
      const newOwner = data.ownerDeviceId as string | undefined;
      const ownerChanged = isWorkout && !!ex && !ex.deleted && !!exOwner && !!newOwner && exOwner !== newOwner;
      // 주인 바뀜: ownerAt(주인이 된 시각)이 더 새로운 쪽이 주인. 더 오래된 주인의 수정 = 가져간 뒤 늦게 온 옛 주인 기록
      const staleOwner = ownerChanged && String(data.ownerAt ?? '') < String(ex!.data!.ownerAt ?? '');
      const takeover = ownerChanged && !staleOwner;
      if (takeover) {
        rec = bump({ table: m.table, id: m.id, data, hlc: m.hlc > ex!.hlc ? m.hlc : after(ex!.hlc, nowMs, m.dev), dev: m.dev, rev: 0 });
      } else if (staleOwner) {
        // 주인이 넘어간 뒤 옛 주인이 보낸 기록: 버리지 않고 서버본에 없는 세트만 사본으로 (통계 제외, 합치기/지우기 고르게)
        const late = lateSets(ex!.data!, data);
        if (late) {
          const cid = `${m.id}~late~${m.dev}`;
          const cex = state.recs[recKey(m.table, cid)];
          const cdata = { ...late, id: cid, name: `${String(data.name ?? '')} (다른 기기 기록)`, pendingMerge: m.id, ownerDeviceId: m.dev, endedAt: (data.endedAt as string | undefined) ?? new Date(nowMs).toISOString(), timer: null };
          copies.push(bump({ table: m.table, id: cid, data: cdata, hlc: after(maxH(cex?.hlc ?? '', m.hlc), nowMs, m.dev), dev: m.dev, rev: 0 }));
        }
        rec = ex!;
      } else if (!ex || ex.deleted) {
        rec = bump({ table: m.table, id: m.id, data, hlc: ex ? maxH(m.hlc, after(ex.hlc, 0, m.dev)) : m.hlc, dev: m.dev, rev: 0 });
      } else if (!concurrent) {
        // 순서대로 고친 것(기기가 서버 값을 보고 고침): 받아들이고, 시계가 느려도 서버 값보다 나중으로 찍음
        rec = bump({ table: m.table, id: m.id, data, hlc: m.hlc > ex.hlc ? m.hlc : after(ex.hlc, nowMs, m.dev), dev: m.dev, rev: 0 });
      } else {
        // 동시 수정: HLC가 큰 쪽이 이김. 루틴은 진 쪽을 사본 1개로 (ID가 정해져 있어 재전송·두 기기 동시에도 하나)
        const mineWins = m.hlc > ex.hlc;
        const winner = mineWins ? { data, hlc: m.hlc, dev: m.dev } : { data: ex.data!, hlc: ex.hlc, dev: ex.dev };
        const loser = mineWins ? { data: ex.data!, hlc: ex.hlc, dev: ex.dev } : { data, hlc: m.hlc, dev: m.dev };
        if (m.table === 'routines') {
          const cid = `${m.id}~${loser.hlc.slice(0, 13)}${loser.hlc.slice(14, 18)}${loser.dev}`;
          if (!state.recs[recKey(m.table, cid)]) {
            copies.push(bump({ table: m.table, id: cid, data: { ...loser.data, id: cid, name: `${String(loser.data.name ?? '')} (다른 기기 수정본)` }, hlc: loser.hlc, dev: loser.dev, rev: 0 }));
          }
        }
        rec = mineWins ? bump({ table: m.table, id: m.id, data: winner.data, hlc: winner.hlc, dev: winner.dev, rev: 0 }) : ex;
      }
    }
    state.muts[m0.mid] = rec.rev;
    state.mutOrder.push(m0.mid);
    while (state.mutOrder.length > MUT_KEEP) delete state.muts[state.mutOrder.shift()!];
    out.push({ mid: m0.mid, key, rec, copies });
  }
  return out;
}

/** since 이후 바뀐 건 전부 */
export function changesSince(state: ServerState, since: number): ServerRec[] {
  return Object.values(state.recs).filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
}

export interface SyncRequest { key?: string; op: 'sync'; schema: number; epoch: number; since: number; muts: Mutation[] }
export interface SyncResponse { ok: true; epoch: number; rev: number; results: MutResult[]; changes: ServerRec[]; full?: boolean }

/**
 * 요청 하나 처리 (서버 핸들러의 핵심). epoch가 다르면 전체를 다시 보냄(full). 기기는 epoch가 바뀌면 안 보낸 수정을 따로 보관한다.
 */
export function handleSync(state: ServerState, req: SyncRequest, nowMs: number): SyncResponse | { ok: false; error: string } {
  if (req.schema < SYNC_SCHEMA) return { ok: false, error: 'update_app' };
  if (req.epoch !== state.epoch) return { ok: true, epoch: state.epoch, rev: state.rev, results: [], changes: changesSince(state, 0), full: true };
  const results = applyMutations(state, req.muts ?? [], nowMs);
  return { ok: true, epoch: state.epoch, rev: state.rev, results, changes: changesSince(state, req.since) };
}

/** 서버를 백업(또는 스냅숏)으로 바꿈: epoch를 올리고 rev는 줄지 않게, mutationId 기록은 비움 */
export function replaceState(state: ServerState, recs: ServerRec[]): ServerState {
  let rev = Math.max(state.rev, ...recs.map((r) => r.rev), 0);
  const map: Record<string, ServerRec> = {};
  for (const r of recs) map[recKey(r.table, r.id)] = { ...r, rev: ++rev };
  return { epoch: state.epoch + 1, rev, recs: map, muts: {}, mutOrder: [] };
}
