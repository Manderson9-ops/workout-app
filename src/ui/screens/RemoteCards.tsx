import type { AppState } from '../store';
import { mutate, remoteActiveOf, lateCopiesOf, db } from '../store';
import { softDelete } from '../../db/db';
import { deviceId } from '../deviceId';
import { parseHlc } from '../../core/hlc';
import type { Workout } from '../../core/session';
import { syncNow } from '../sync';
import { go } from '../nav';

const since = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`; };
const doneSets = (w: Workout) => w.blocks.flatMap((b) => b.items.flatMap((i) => i.sets)).filter((x) => x.done && !x.warmup).length;

/** 늦게 온 기록을 원래 운동에 합치기: 같은 자리(블록·운동)의 아직 안 한 세트를 채우고, 없으면 뒤에 붙임 */
export function mergeLate(orig: Workout, copy: Workout): Workout {
  const blocks = orig.blocks.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i, sets: [...i.sets] })) }));
  copy.blocks.forEach((cb, bi) => cb.items.forEach((ci) => {
    const item = blocks[bi]?.items.find((i) => i.exerciseId === ci.exerciseId);
    if (!item) return;
    for (const s of ci.sets) {
      const k = item.sets.findIndex((x) => !x.done && x.warmup === s.warmup);
      if (k >= 0) item.sets[k] = s; else item.sets.push(s);
    }
  }));
  return { ...orig, blocks };
}

/** 홈: 다른 기기에서 진행 중인 운동(읽기 전용, 가져오기), 늦게 온 기록(합치기/지우기) */
export function RemoteCards({ s }: { s: AppState }) {
  const remote = remoteActiveOf(s);
  const late = lateCopiesOf(s);
  return (
    <>
      {remote && (
        <div class="card" role="note" aria-label="다른 기기에서 진행 중">
          <div><strong>📱 다른 기기에서 진행 중</strong> · {remote.name}</div>
          <p class="sub small">세트 {doneSets(remote)}개 완료 · 마지막 신호 {since(parseHlc((remote as Workout & { _s?: { h: string } })._s?.h).ms || Date.parse(remote.startedAt))}. 이 기기에서는 볼 수만 있어요.</p>
          <button onClick={async () => {
            if (!confirm('이 운동을 이 기기로 가져올까요? 다른 기기에서는 더 기록할 수 없게 돼요.')) return;
            if (!confirm('정말 가져올까요? (다른 기기가 꺼졌거나 잃어버렸을 때 쓰세요)')) return;
            const cur = (await db.workouts.get(remote.id))!;
            await mutate((d) => d.workouts.put({ ...cur, ownerDeviceId: deviceId(), ownerAt: new Date().toISOString() }));
            void syncNow('takeover');
            go('#/workout');
          }}>이 기기로 가져오기</button>
        </div>
      )}
      {late.map((c) => (
        <div class="card" role="note" aria-label="늦게 온 기록" key={c.id}>
          <div><strong>늦게 온 기록</strong> · {c.name}</div>
          <p class="sub small">운동을 다른 기기로 가져간 뒤 원래 기기에서 기록한 세트 {doneSets(c)}개예요. 합치기 전에는 통계에 넣지 않아요.</p>
          <div class="row wrap">
            <button class="primary" onClick={async () => {
              const orig = s.workouts.find((w) => w.id === c.pendingMerge);
              await mutate(async (d) => {
                if (orig) { const cur = (await d.workouts.get(orig.id))!; await d.workouts.put(mergeLate(cur, c)); }
                await softDelete(d, 'workouts', c.id);
              });
            }}>원래 운동에 합치기</button>
            <button class="danger" onClick={async () => { if (confirm('늦게 온 기록을 지울까요?')) await mutate((d) => softDelete(d, 'workouts', c.id)); }}>지우기</button>
          </div>
        </div>
      ))}
    </>
  );
}
