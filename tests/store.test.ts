import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { flushPending, trackInflight, registerPending } from '../src/ui/store';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 제한 시간 안에 끝나는지 (멈춤 = 실패) */
const within = <T,>(p: Promise<T>, ms = 1000) => Promise.race([p, tick(ms).then(() => { throw new Error('HUNG'); })]);

describe('입력 저장 기다리기 (D-017, 검토 N1)', () => {
  it('이미 시작된 저장이 끝날 때까지 기다림', async () => {
    let done = false;
    trackInflight(tick(30).then(() => { done = true; }));
    await within(flushPending());
    expect(done).toBe(true);
  });

  it('저장 도중 자기 자신을 기다리지 않음 (재진입: 멈추지 않음)', async () => {
    // pX: 먼저 시작된 느린 저장
    trackInflight(tick(30));
    // 입력칸 저장 흉내: onChange 안에서 다시 flushPending을 부르고(세트 변경 = updateWorkoutAfterInputs), 자신도 inflight로 등록됨
    const onChange = async () => { await flushPending(); await tick(5); };
    const pA = onChange();
    trackInflight(pA);
    await within(pA);
    // 이후 호출도 멈추지 않음 (inflight가 비워짐)
    await within(flushPending());
  });

  it('대기 중인 입력을 먼저 저장하고, 그 저장이 부른 flushPending도 끝남', async () => {
    const order: string[] = [];
    registerPending('w', async () => { order.push('save-w'); await flushPending(); order.push('after-inner'); });
    await within(flushPending());
    expect(order).toEqual(['save-w', 'after-inner']);
  });

  it('입력칸 두 개가 동시에 대기 중이어도 멈추지 않음 (검토 3차 시나리오)', async () => {
    let aDone = false;
    // A: 포커스가 빠지며 시작된 저장. 안에서 flushPending(세트 변경 경로)
    const a = (async () => { await flushPending(); await tick(5); aDone = true; })();
    trackInflight(a);
    // C1, C2: 대기 중인 입력. 각자 저장하며 flushPending을 다시 부름
    registerPending('c1', async () => { await tick(5); await flushPending(); });
    registerPending('c2', async () => { await flushPending(); });
    await within(flushPending());
    await within(a);
    expect(aDone).toBe(true);
  });
});