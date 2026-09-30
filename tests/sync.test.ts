import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { WorkoutDB, softDelete, DEFAULT_SETTINGS } from '../src/db/db';
import { Clock, memoryClockStore } from '../src/core/hlc';
import { emptyState, handleSync, replaceState, changesSince } from '../src/core/syncMerge';
import type { ServerState, SyncRequest } from '../src/core/syncMerge';
import { syncOnce, getKv, restoreStash, collectMutations } from '../src/db/sync';
import type { Transport } from '../src/db/sync';
import { SYNC_TABLES, syncedFields, withoutStamp } from '../src/core/syncStamp';
import { planToRoutine, startWorkout } from '../src/core/session';
import type { Routine, Workout } from '../src/core/session';

let T = 1_750_000_000_000;
const now = () => T;
const J = <X,>(x: X): X => JSON.parse(JSON.stringify(x));
function server(state: ServerState = emptyState()) {
  const s = { state, fail: '' as '' | 'afterApply' | 'before' };
  const transport: Transport = async (req: SyncRequest) => {
    if (s.fail === 'before') throw new Error('network');
    const resp = J(handleSync(s.state, J(req), now()));
    if (s.fail === 'afterApply') throw new Error('timeout'); // 서버는 반영했지만 응답이 안 옴
    return resp;
  };
  return { s, transport };
}
const dev = (id: string, skewMs = 0) => new WorkoutDB(`sync-${id}-${Math.random()}`, { clock: new Clock(memoryClockStore(), () => T + skewMs), deviceId: () => id });
const R = (id: string, name: string): Routine => ({ ...planToRoutine(id, name, '2026-09-30T10:00:00.000Z', [{ kind: 'single', items: [{ exerciseId: 'a', name: 'A', part: '등', sets: 3, reps: 8, grade: 'S', gradeSource: 'VIDEO', estimated: false, substituted: false, locked: false, why: '', rank: 0 }], restSec: 90, timeSec: 0 }], 900) });
const sync = async (db: WorkoutDB, t: Transport) => { T += 1000; try { return await syncOnce(db, t); } catch (e) { return { confirmed: 0, received: 0, error: String(e) }; } };
async function view(db: WorkoutDB) {
  const out: Record<string, unknown> = {};
  for (const t of SYNC_TABLES) {
    const rows = (await db.table(t).toArray()) as Record<string, unknown>[];
    out[t] = rows.map((r) => (t === 'settings' || t === 'meta' ? { id: r[t === 'settings' ? 'key' : 'exerciseId'], ...syncedFields(t, r) } : withoutStamp(r as never))).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  }
  return out;
}
const names = async (db: WorkoutDB) => (await db.routines.toArray()).map((r) => r.name).sort();

describe('양방향 동기화: 기본', () => {
  it('A가 만든 루틴 → B에, B가 고친 것 → A에', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', '등 루틴'));
    await sync(A, transport); await sync(B, transport);
    expect(await names(B)).toEqual(['등 루틴']);
    const r = (await B.routines.get('r1'))!; await B.routines.put({ ...r, name: '등 루틴 v2' });
    await sync(B, transport); await sync(A, transport);
    expect(await names(A)).toEqual(['등 루틴 v2']);
    expect((await collectMutations(A)).length).toBe(0);
    expect(await view(A)).toEqual(await view(B));
  });
  it('지움 전파, 지운 뒤 같은 날짜 체중을 다시 적으면 되살아남', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.bodyweight.put({ date: '2026-09-30', kg: 70 });
    await sync(A, transport); await sync(B, transport);
    await softDelete(B, 'bodyweight', '2026-09-30');
    await sync(B, transport); await sync(A, transport);
    expect(await A.bodyweight.count()).toBe(0);
    await A.bodyweight.put({ date: '2026-09-30', kg: 71 });
    await sync(A, transport); await sync(B, transport);
    expect((await B.bodyweight.get('2026-09-30'))?.kg).toBe(71);
  });
  it('설정은 항목 단위: A는 수준, B는 휴식을 동시에 바꿔도 둘 다 남고, 소리 켜기 같은 기기별 항목은 안 넘어감', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.settings.put({ ...DEFAULT_SETTINGS }); await sync(A, transport); await sync(B, transport);
    const sa = (await A.settings.get('main'))!; await A.settings.put({ ...sa, level: '상급', soundOn: false });
    const sb = (await B.settings.get('main'))!; await B.settings.put({ ...sb, rest: { ...sb.rest, between: 75 } });
    await sync(A, transport); await sync(B, transport); await sync(A, transport);
    const a = (await A.settings.get('main'))!, b = (await B.settings.get('main'))!;
    expect(a.level).toBe('상급'); expect(b.level).toBe('상급');
    expect(a.rest.between).toBe(75); expect(b.rest.between).toBe(75);
    expect(a.soundOn).toBe(false); expect(b.soundOn).not.toBe(false);
  });
});

describe('충돌 규칙 (D-029)', () => {
  it('동시 수정: 나중 것이 이기고 루틴은 사본 1개 (재전송해도 1개)', async () => {
    const { s, transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', '루틴')); await sync(A, transport); await sync(B, transport);
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'A 수정' });
    T += 5000;
    await B.routines.put({ ...(await B.routines.get('r1'))!, name: 'B 수정' });
    await sync(A, transport);
    s.fail = 'afterApply'; await sync(B, transport); s.fail = '';
    await sync(B, transport); await sync(A, transport); await sync(B, transport);
    expect(await names(A)).toEqual(['A 수정 (다른 기기 수정본)', 'B 수정']);
    expect(await view(A)).toEqual(await view(B));
  });
  it('수정 대 지움이 동시면 수정이 이겨 되살아남', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', '루틴')); await sync(A, transport); await sync(B, transport);
    await softDelete(A, 'routines', 'r1');
    await B.routines.put({ ...(await B.routines.get('r1'))!, name: '고침' });
    await sync(B, transport); await sync(A, transport); await sync(B, transport);
    expect(await names(A)).toEqual(['고침']);
    expect(await view(A)).toEqual(await view(B));
  });
  it('응답을 못 받은 뒤(서버는 반영) 또 고치고 보내도 가짜 사본이 안 생김', async () => {
    const { s, transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', 'v1')); await sync(A, transport); await sync(B, transport);
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'v2' });
    s.fail = 'afterApply'; await sync(A, transport); s.fail = '';
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'v3' });
    await sync(A, transport); await sync(B, transport);
    expect(await names(B)).toEqual(['v3']);
    expect(await names(A)).toEqual(['v3']);
  });
  it('보내는 동안 또 고치면 확정하지 않고 다음에 다시 보냄 (끝없이 재전송하지 않음)', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await sync(A, transport); // 첫 연결 먼저
    await A.routines.put(R('r1', 'v1'));
    const sneaky: Transport = async (req) => { const r = await transport(req); await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'v2' }); return r; };
    await sync(A, sneaky);
    expect((await collectMutations(A)).length).toBe(1);
    await sync(A, transport);
    expect((await collectMutations(A)).length).toBe(0);
    await sync(B, transport);
    expect(await names(B)).toEqual(['v2']);
  });
  it('같은 요청이 두 번 와도 한 번만 반영', async () => {
    const { s, transport } = server(); const A = dev('A');
    await A.routines.put(R('r1', 'v1'));
    const kv = await getKv(A); const muts = await collectMutations(A);
    const req: SyncRequest = { op: 'sync', schema: 1, epoch: kv.epoch, since: 0, muts };
    await transport(req); const before = s.state.rev; await transport(req);
    expect(s.state.rev).toBe(before);
  });
  it('시계가 하루 빠른 기기: 서버가 다시 찍고 기기 기준도 낮춤, 다른 기기의 나중 수정이 이김', async () => {
    const { transport } = server(); const A = dev('A'), C = dev('C', 86_400_000);
    await A.routines.put(R('r1', 'v1')); await sync(A, transport); await sync(C, transport);
    await C.routines.put({ ...(await C.routines.get('r1'))!, name: 'C 고침' }); await sync(C, transport);
    await sync(A, transport);
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'A 나중에 고침' }); await sync(A, transport);
    await sync(C, transport);
    expect(await names(C)).toEqual(['A 나중에 고침']);
  });
  it('진행 중 운동: 가져간 뒤 옛 주인이 늦게 보낸 세트는 사본(합치기 대기)으로, 원본은 새 주인 것', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    const w: Workout = { ...startWorkout('w1', R('r1', '등'), '2026-09-30T10:00:00.000Z', []), ownerDeviceId: 'A', ownerAt: '2026-09-30T10:00:00.000Z' };
    await A.workouts.put(w); await sync(A, transport); await sync(B, transport);
    const bw = (await B.workouts.get('w1'))!;
    bw.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true };
    await B.workouts.put({ ...bw, ownerDeviceId: 'B', ownerAt: '2026-09-30T10:05:00.000Z' }); await sync(B, transport);
    const aw = (await A.workouts.get('w1'))!;
    aw.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true };
    aw.blocks[0]!.items[0]!.sets[1] = { weight: 62.5, reps: 8, warmup: false, done: true };
    await A.workouts.put(aw); await sync(A, transport); await sync(B, transport); await sync(A, transport);
    const all = await B.workouts.toArray();
    const orig = all.find((x) => x.id === 'w1')!, copy = all.find((x) => x.pendingMerge === 'w1')!;
    expect(orig.ownerDeviceId).toBe('B');
    expect(copy.blocks[0]!.items[0]!.sets.map((x) => x.weight)).toEqual([62.5]);
    expect(await view(A)).toEqual(await view(B));
  });
  it('서버 되돌리기(epoch): 안 보낸 수정은 보관 → 전체 다시 받기 → 다시 올리면 반영', async () => {
    const { s, transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', 'v1')); await sync(A, transport); await sync(B, transport);
    const snap = changesSince(s.state, 0);
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'v2' }); await sync(A, transport);
    s.state = replaceState(s.state, snap);
    await B.routines.put(R('r2', 'B 새것'));
    const r = await sync(B, transport);
    expect(r).toMatchObject({ full: true, stashed: 1 });
    expect(await names(B)).toEqual(['v1']);
    expect(await restoreStash(B)).toBe(1);
    await sync(B, transport); await sync(A, transport);
    expect(await names(A)).toEqual(['B 새것', 'v1']);
    expect((await getKv(A)).epoch).toBe(s.state.epoch);
  });
});

describe('수렴 검사: 기기 3대 무작위 500가지', () => {
  it('어떤 순서·장애가 있어도 마지막에 모든 기기와 서버가 같아짐', async () => {
    let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let sc = 0; sc < 500; sc++) {
      const { s, transport } = server();
      const devs = [dev('A'), dev('B', 30_000), dev('C', -20_000)];
      for (let step = 0; step < 12; step++) {
        const d = pick(devs); const op = rnd(); T += Math.floor(rnd() * 3000);
        const id = pick(['r1', 'r2', 'r3']);
        if (op < 0.3) { const ex = await d.routines.get(id); await d.routines.put(ex ? { ...ex, name: `${id}-${sc}-${step}` } : R(id, `${id}-new-${step}`)); }
        else if (op < 0.4) { if (await d.routines.get(id)) await softDelete(d, 'routines', id); }
        else if (op < 0.5) { await d.bodyweight.put({ date: pick(['2026-09-29', '2026-09-30']), kg: 60 + step }); }
        else if (op < 0.6) { const st = (await d.settings.get('main')) ?? { ...DEFAULT_SETTINGS }; await d.settings.put(rnd() < 0.5 ? { ...st, level: pick(['초보', '중급', '상급']) } : { ...st, defaultMinutes: pick([30, 45, 60, 90]) }); }
        else if (op < 0.65) { await d.meta.put({ exerciseId: pick(['a', 'b']), favorite: rnd() < 0.5 }); }
        else { s.fail = rnd() < 0.15 ? 'afterApply' : rnd() < 0.1 ? 'before' : ''; await sync(d, transport); s.fail = ''; }
      }
      for (let k = 0; k < 2; k++) for (const d of devs) await sync(d, transport);
      const v0 = await view(devs[0]!);
      for (const d of devs.slice(1)) expect(await view(d), `시나리오 ${sc}`).toEqual(v0);
      for (const d of devs) expect((await collectMutations(d)).length, `시나리오 ${sc} 남은 수정`).toBe(0);
      const live = Object.values(s.state.recs).filter((r) => !r.deleted && r.table === 'routines').map((r) => r.id).sort();
      expect((await devs[0]!.routines.toArray()).map((r) => r.id).sort()).toEqual(live);
      for (const d of devs) d.close();
    }
  }, 240_000);
});
