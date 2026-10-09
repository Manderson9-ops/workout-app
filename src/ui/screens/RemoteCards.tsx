import type { AppState } from '../store';
import { mutate, remoteActiveOf, lateCopiesOf, db } from '../store';
import { softDelete } from '../../db/db';
import { deviceId } from '../deviceId';
import { parseHlc } from '../../core/hlc';
import type { Workout } from '../../core/session';
import { mergeLate } from '../../core/session';
import { syncNow } from '../sync';
import { go } from '../nav';
import { askConfirm, showNotice } from '../confirm';
import { Icon } from '../icons';
import { agoText } from '../../core/dateText';

const since = (ms: number) => agoText(ms, Date.now()); // "방금", "5분 전", "오늘 오전 9:10" (D-060)
/** 가져오기 진행 중 (확인·동기화를 기다리는 동안 다시 눌러 두 번 가져오지 않게) */
let taking = false;
const doneSets = (w: Workout) => w.blocks.flatMap((b) => b.items.flatMap((i) => i.sets)).filter((x) => x.done && !x.warmup).length;

/** 홈: 다른 기기에서 진행 중인 운동(읽기 전용, 가져오기), 늦게 온 기록(합치기/지우기) */
export function RemoteCards({ s }: { s: AppState }) {
  const remote = remoteActiveOf(s);
  const late = lateCopiesOf(s);
  return (
    <>
      {remote && (
        <div class="card" role="note" aria-label="다른 기기에서 진행 중">
          <div class="row remote-head"><Icon name="workout" size={18} /><span><strong>다른 기기에서 진행 중</strong> · {remote.name}</span></div>
          {remote.timer && remote.timer.endsAt > Date.now() && <p class="small">휴식 중 · 약 {Math.round((remote.timer.endsAt - Date.now()) / 1000)}초 남음 <span class="sub">(다른 기기 시계 기준)</span></p>}
          <p class="sub small">세트 {doneSets(remote)}개 완료 · 마지막 신호 {since(parseHlc((remote as Workout & { _s?: { h: string } })._s?.h).ms || Date.parse(remote.startedAt))}. 이 기기에서는 볼 수만 있어요.</p>
          <button onClick={async () => {
            if (taking) return;
            taking = true;
            try {
            if (!(await askConfirm({ title: '이 기기로 가져올까요?', message: '다른 기기에서는 더 기록할 수 없게 돼요.', ok: '가져오기', danger: true }))) return;
            if (!(await askConfirm({ title: '정말 가져올까요?', message: '다른 기기가 꺼졌거나 잃어버렸을 때 쓰세요.', ok: '가져오기', danger: true }))) return;
            // 먼저 동기화해서 최신 세트를 받은 뒤 가져옴 (서버도 놓친 세트를 합쳐 줌, D-029)
            await syncNow('before-takeover');
            const cur = await db.workouts.get(remote.id);
            if (!cur || cur.endedAt) { await showNotice('그 운동은 이미 끝났어요'); return; }
            await mutate((d) => d.workouts.put({ ...cur, ownerDeviceId: deviceId(), ownerAt: new Date().toISOString(), ownerSeq: (cur.ownerSeq ?? 1) + 1 }));
            void syncNow('takeover');
            go('#/workout');
            } finally { taking = false; }
          }}>이 기기로 가져오기</button>
        </div>
      )}
      {late.map((c) => {
        const orig = s.workouts.find((w) => w.id === c.pendingMerge);
        // 원래 운동의 주인 기기이거나 원래 운동이 끝났을 때만 합치기 (다른 기기가 기록 중이면 부딪혀 잃을 수 있음)
        const canMerge = !orig || !!orig.endedAt || orig.ownerDeviceId === deviceId();
        return (
        <div class="card" role="note" aria-label="늦게 온 기록" key={c.id}>
          <div><strong>늦게 온 기록</strong> · {c.name}</div>
          <p class="sub small">운동을 다른 기기로 가져간 뒤 원래 기기에서 기록한 세트 {doneSets(c)}개예요. 합치기 전에는 통계에 넣지 않아요.</p>
          <div class="row wrap">
            <button class="primary" disabled={!canMerge} onClick={async () => {
              await mutate(async (d) => {
                if (orig) { const cur = (await d.workouts.get(orig.id))!; await d.workouts.put(mergeLate(cur, c)); }
                await softDelete(d, 'workouts', c.id);
              });
            }}>원래 운동에 합치기</button>
            <button class="danger" onClick={async () => { if (await askConfirm({ title: '늦게 온 기록을 지울까요?', ok: '지우기', danger: true })) await mutate((d) => softDelete(d, 'workouts', c.id)); }}>지우기</button>
          </div>
          {!canMerge && <p class="sub small">원래 운동이 다른 기기에서 진행 중이에요. 그 기기에서 합치거나, 운동이 끝난 뒤 합치세요.</p>}
        </div>
        );
      })}
    </>
  );
}
