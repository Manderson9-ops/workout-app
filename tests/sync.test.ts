import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { WorkoutDB, softDelete, DEFAULT_SETTINGS, importAll, exportAll } from '../src/db/db';
import { Clock, memoryClockStore } from '../src/core/hlc';
import { emptyState, handleSync, replaceState, changesSince } from '../src/core/syncMerge';
import type { ServerState, SyncRequest } from '../src/core/syncMerge';
import { syncOnce, getKv, restoreStash, collectMutations, CHUNK } from '../src/db/sync';
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
/** 동기화 끄기와 같은 효과: 연결 상태만 비움 (ui/sync.ts disableSync) */
const setKvLike = async (db: WorkoutDB) => { const kv = await getKv(db); await db.kv.put({ k: 'sync', v: { ...kv, epoch: 0, since: 0 } }); };
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
    const w: Workout = { ...startWorkout('w1', R('r1', '등'), '2026-09-30T10:00:00.000Z', []), ownerDeviceId: 'A', ownerAt: '2026-09-30T10:00:00.000Z', ownerSeq: 1 };
    await A.workouts.put(w); await sync(A, transport); await sync(B, transport);
    const bw = (await B.workouts.get('w1'))!;
    bw.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true };
    await B.workouts.put({ ...bw, ownerDeviceId: 'B', ownerAt: '2026-09-30T10:05:00.000Z', ownerSeq: 2 }); await sync(B, transport);
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


describe('S2b 검토 반영', () => {
  const W = (id: string, owner: string, seq = 1): Workout => ({ ...startWorkout(id, R('r1', '등'), '2026-09-30T10:00:00.000Z', []), ownerDeviceId: owner, ownerAt: '2026-09-30T10:00:00.000Z', ownerSeq: seq });
  const setDone = (w: Workout, k: number, kg: number) => { w.blocks[0]!.items[0]!.sets[k] = { weight: kg, reps: 8, warmup: false, done: true }; };
  it('최신이 아닌 화면에서 가져와도 서버에만 있던 세트를 잃지 않음', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.workouts.put(W('w1', 'A')); await sync(A, transport); await sync(B, transport);
    const a = (await A.workouts.get('w1'))!; setDone(a, 0, 50); setDone(a, 1, 51); setDone(a, 2, 52); await A.workouts.put(a); await sync(A, transport);
    const b = (await B.workouts.get('w1'))!; // B는 세트 0개인 옛 화면
    await B.workouts.put({ ...b, ownerDeviceId: 'B', ownerSeq: 2 }); await sync(B, transport); await sync(A, transport);
    const done = (await B.workouts.get('w1'))!.blocks[0]!.items[0]!.sets.filter((x) => x.done).map((x) => x.weight);
    expect(done).toEqual([50, 51, 52]);
    expect((await B.workouts.get('w1'))!.ownerDeviceId).toBe('B');
    expect(await view(A)).toEqual(await view(B));
  });
  it('시계가 늦은 기기가 가져와도 되돌려지지 않음 (ownerSeq)', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B', -3_600_000);
    await A.workouts.put(W('w1', 'A')); await sync(A, transport); await sync(B, transport);
    const b = (await B.workouts.get('w1'))!;
    await B.workouts.put({ ...b, ownerDeviceId: 'B', ownerAt: '2020-01-01T00:00:00.000Z', ownerSeq: 2 }); await sync(B, transport); await sync(A, transport);
    expect((await A.workouts.get('w1'))!.ownerDeviceId).toBe('B');
  });
  it('전체 다시 받기: 기기별 설정·이 기기가 주인인 진행 중 운동은 남고, 보관본은 두 번 되돌려도 합쳐짐', async () => {
    const { s, transport } = server(); const A = dev('A');
    await A.settings.put({ ...DEFAULT_SETTINGS, soundOn: false, lastBackupAt: '2026-09-29T00:00:00.000Z' });
    await A.workouts.put(W('w1', 'A')); await sync(A, transport);
    const snap = changesSince(s.state, 0);
    await A.routines.put(R('r1', '보관1'));
    s.state = replaceState(s.state, snap); await sync(A, transport);
    await A.routines.put(R('r2', '보관2'));
    s.state = replaceState(s.state, snap); await sync(A, transport);
    const st = (await A.settings.get('main'))!;
    expect(st.soundOn).toBe(false); expect(st.lastBackupAt).toBe('2026-09-29T00:00:00.000Z');
    expect(await A.workouts.get('w1')).toBeDefined();
    expect((await getKv(A)).stash!.map((m) => m.id).sort()).toEqual(['r1', 'r2']);
  });
  it('백업 불러오기 뒤에는 처음 연결 절차 (다른 내용은 고르게, 서버 기록 다시 받기)', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', '서버 것')); await A.routines.put(R('r2', 'A만')); await sync(A, transport); await sync(B, transport);
    const backup = await exportAll(B);
    backup.routines = backup.routines.filter((r) => r.id === 'r1').map((r) => ({ ...r, name: '백업 것' }));
    await importAll(B, backup);
    expect((await getKv(B)).epoch).toBe(0);
    let asked = 0;
    await syncOnce(B, transport, async (cs) => { asked = cs.length; return Object.fromEntries(cs.map((c) => [`${c.table}/${c.id}`, 'server' as const])); });
    expect(asked).toBe(1);
    expect(await names(B)).toEqual(['A만', '서버 것']);
  });
  it('처음 연결 취소: 아무것도 안 바꾸고 다음에 다시 처음 연결', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', '서버 것')); await sync(A, transport);
    await B.routines.put(R('r1', 'B 것'));
    const r = await syncOnce(B, transport, async () => null);
    expect(r.error).toBe('cancelled');
    expect(await names(B)).toEqual(['B 것']);
    expect((await getKv(B)).epoch).toBe(0);
  });
  it('처음 연결: 이름·내용이 같은 루틴은 중복으로 보고 하나만', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('rA', '같은 루틴')); await sync(A, transport);
    await B.routines.put(R('rB', '같은 루틴'));
    await sync(B, transport); await sync(A, transport);
    expect(await names(B)).toEqual(['같은 루틴']);
    expect(await names(A)).toEqual(['같은 루틴']);
  });
  it(`${CHUNK}건 넘게 올릴 때 나눠 보냄`, async () => {
    const { transport } = server(); const A = dev('A');
    const sizes: number[] = [];
    const spy: Transport = async (req) => { sizes.push(req.muts.length); return transport(req); };
    await A.bodyweight.bulkPut(Array.from({ length: 650 }, (_, i) => ({ date: `2026-01-${String(i).padStart(3, '0')}`, kg: 70 })));
    await syncOnce(A, spy);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHUNK);
    expect((await collectMutations(A)).length).toBe(0);
  });
});

describe('개선 메모 동기화 (S3)', () => {
  it('폰에서 적은 메모가 PC로, PC가 상태를 바꾸면 폰에도', async () => {
    const { s, transport } = server(); const A = dev('A'), B = dev('B');
    await A.feedback.put({ id: 'FB-20260930-A-01', createdAt: '2026-09-30T10:00:00.000Z', screen: '#/workout', text: '소리', status: '접수' });
    await sync(A, transport); await sync(B, transport);
    expect((await B.feedback.get('FB-20260930-A-01'))?.text).toBe('소리');
    expect(Object.values(s.state.recs).some((r) => r.table === 'feedback')).toBe(true);
    await B.feedback.put({ ...(await B.feedback.get('FB-20260930-A-01'))!, status: '반영됨', note: '0.6.0 에 반영' });
    await sync(B, transport); await sync(A, transport);
    expect((await A.feedback.get('FB-20260930-A-01'))?.status).toBe('반영됨');
  });
});

describe('0.5.0 → 0.6.0 (DB v5)', () => {
  it('예전 기기는 모르는 표(feedback)를 건너뛰고, v5가 되면 받은 위치를 되돌려 놓친 메모를 받음', async () => {
    const { s: srv, transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', 'v1')); await sync(A, transport); await sync(B, transport);
    await A.feedback.put({ id: 'FB-20260930-A-01', createdAt: '2026-09-30T10:00:00.000Z', screen: '#/', text: '메모', status: '접수' });
    await sync(A, transport);
    // B가 0.5.0이었다고 치고: 메모를 건너뛴 채 since만 서버 끝까지 감
    const kv = { ...(await getKv(B)), since: srv.state.rev }; await B.kv.put({ k: 'sync', v: kv });
    await sync(B, transport);
    expect(await B.feedback.count()).toBe(0);
    await B.kv.put({ k: 'sync', v: { ...kv, since: 0 } }); // v5 업그레이드가 하는 일
    await sync(B, transport);
    expect((await B.feedback.get('FB-20260930-A-01'))?.text).toBe('메모');
    expect(await names(B)).toEqual(['v1']);
  });
});

describe('S2b 2차 검토 반영', () => {
  const W = (id: string, owner: string, seq = 1): Workout => ({ ...startWorkout(id, R('r1', '등'), '2026-09-30T10:00:00.000Z', []), ownerDeviceId: owner, ownerSeq: seq });
  it('끄고 → 다른 기기가 고침 → 다시 켜기: 고치지 않은 옛 사본은 충돌로 묻지 않고 서버 값을 받음', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.routines.put(R('r1', 'v1')); await sync(A, transport); await sync(B, transport);
    await setKvLike(B);
    await A.routines.put({ ...(await A.routines.get('r1'))!, name: 'A가 고침' }); await sync(A, transport);
    let asked = -1;
    await syncOnce(B, transport, async (cs) => { asked = cs.length; return {}; });
    expect(asked).toBe(-1);
    expect(await names(B)).toEqual(['A가 고침']);
    await sync(A, transport);
    expect(await names(A)).toEqual(['A가 고침']);
  });
  it('끝낸 시각(doneAt)으로 같은 세트를 알아봄: 서버에서 무게를 고친 세트를 옛 화면에서 가져와도 두 번 생기지 않음', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.workouts.put(W('w1', 'A')); await sync(A, transport);
    const a = (await A.workouts.get('w1'))!;
    a.blocks[0]!.items[0]!.sets[0] = { weight: 60, reps: 8, warmup: false, done: true, doneAt: '2026-09-30T10:01:00.000Z' };
    await A.workouts.put(a); await sync(A, transport); await sync(B, transport);
    const a2 = (await A.workouts.get('w1'))!; a2.blocks[0]!.items[0]!.sets[0]!.weight = 62.5; a2.blocks[0]!.items[0]!.sets[0]!.rir = 1;
    await A.workouts.put(a2); await sync(A, transport);
    const b = (await B.workouts.get('w1'))!; // 60kg 옛 화면
    await B.workouts.put({ ...b, ownerDeviceId: 'B', ownerSeq: 2 }); await sync(B, transport);
    const done = (await B.workouts.get('w1'))!.blocks[0]!.items[0]!.sets.filter((x) => x.done);
    expect(done.map((x) => x.weight)).toEqual([62.5]);
  });
  it('끝낸 시각이 없는 같은 세트 여러 개는 개수로 비교 (3개가 1개로 줄지 않음)', async () => {
    const { transport } = server(); const A = dev('A'), B = dev('B');
    await A.workouts.put(W('w1', 'A')); await sync(A, transport); await sync(B, transport);
    const a = (await A.workouts.get('w1'))!;
    for (let k = 0; k < 3; k++) a.blocks[0]!.items[0]!.sets[k] = { weight: 50, reps: 10, warmup: false, done: true };
    await A.workouts.put(a); await sync(A, transport);
    const b = (await B.workouts.get('w1'))!;
    await B.workouts.put({ ...b, ownerDeviceId: 'B', ownerSeq: 2 }); await sync(B, transport);
    expect((await B.workouts.get('w1'))!.blocks[0]!.items[0]!.sets.filter((x) => x.done)).toHaveLength(3);
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

describe('수렴 + 세트 손실 0: 운동·가져오기·늦은 기록 포함 무작위 300가지', () => {
  it('끝나면 모든 기기가 같고, 누가 기록한 완료 세트든 서버에 남음(원본 또는 늦은 기록 사본)', async () => {
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]!;
    let weight = 1;
    for (let sc = 0; sc < 300; sc++) {
      const { s, transport } = server();
      const devs = [dev('A'), dev('B', 45_000), dev('C', -30_000)];
      const recorded: number[] = [];
      for (let step = 0; step < 14; step++) {
        const i = Math.floor(rnd() * 3); const d = devs[i]!; const me = ['A', 'B', 'C'][i]!; T += Math.floor(rnd() * 4000);
        const op = rnd();
        const w = await d.workouts.get('w1');
        // 실제 앱은 운동 ID가 기기마다 달라 겹치지 않음 → 시작은 한 기기만
        if (op < 0.12 && !w && me === 'A') { await d.workouts.put({ ...startWorkout('w1', R('r1', '등'), '2026-09-30T10:00:00.000Z', []), ownerDeviceId: me, ownerSeq: 1 }); }
        else if (op < 0.45 && w && !w.endedAt && w.ownerDeviceId === me && !w.pendingMerge) {
          const sets = w.blocks[0]!.items[0]!.sets; const k = sets.findIndex((x) => !x.done);
          const kg = weight++; recorded.push(kg);
          const set = { weight: kg, reps: 8, warmup: false, done: true, doneAt: new Date(T).toISOString() + kg };
          if (k >= 0) sets[k] = set; else sets.push(set);
          await d.workouts.put(w);
        }
        else if (op < 0.55 && w && !w.endedAt && w.ownerDeviceId !== me) { await d.workouts.put({ ...w, ownerDeviceId: me, ownerSeq: (w.ownerSeq ?? 1) + 1 }); }
        else if (op < 0.6 && w && !w.endedAt && w.ownerDeviceId === me) { await d.workouts.put({ ...w, endedAt: new Date(T).toISOString(), timer: null }); }
        else if (op < 0.7) { const ex = await d.routines.get('r9'); await d.routines.put(ex ? { ...ex, name: `x${step}` } : R('r9', 'n')); }
        else { s.fail = rnd() < 0.15 ? 'afterApply' : rnd() < 0.1 ? 'before' : ''; await sync(d, transport); s.fail = ''; }
      }
      for (let k = 0; k < 3; k++) for (const d of devs) await sync(d, transport);
      const v0 = await view(devs[0]!);
      for (const d of devs.slice(1)) expect(await view(d), `시나리오 ${sc}`).toEqual(v0);
      const onServer = new Set(Object.values(s.state.recs).filter((r) => r.table === 'workouts' && !r.deleted)
        .flatMap((r) => ((r.data!.blocks as { items: { sets: { weight?: number; done?: boolean }[] }[] }[])).flatMap((b) => b.items.flatMap((it) => it.sets.filter((x) => x.done).map((x) => x.weight)))));
      const lost = recorded.filter((kg) => !onServer.has(kg));
      expect(lost, `시나리오 ${sc} 잃은 세트`).toEqual([]);
      for (const d of devs) d.close();
    }
  }, 300_000);
});
