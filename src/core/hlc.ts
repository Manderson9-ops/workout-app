/**
 * 하이브리드 논리 시계 HLC (D-029). "언제 고쳤나"를 기기 시계가 조금 틀려도 순서가 뒤집히지 않게 매긴다.
 * 문자열 "ms(13자리).카운터(4자리).기기ID" 라서 문자열 비교 = 시간 비교 (같으면 기기ID로 순서).
 */
export const HLC_ZERO_MS = 0;

export const fmtHlc = (ms: number, c: number, dev: string) => `${String(Math.max(0, Math.floor(ms))).padStart(13, '0')}.${String(c).padStart(4, '0')}.${dev}`;
export const hlcZero = (dev: string) => fmtHlc(0, 0, dev);

export function parseHlc(h: string | null | undefined): { ms: number; c: number } {
  if (!h) return { ms: 0, c: 0 };
  const [ms, c] = h.split('.');
  const m = Number(ms), n = Number(c);
  return { ms: Number.isFinite(m) ? m : 0, c: Number.isFinite(n) ? n : 0 };
}

/** a가 b보다 나중이면 양수 */
export const cmpHlc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ClockStore { get(): string | null; set(v: string): void }

/**
 * 기기 하나의 시계. last = 지금까지 본 가장 큰 (ms, c).
 * tick: 새로 고칠 때. observe: 다른 기기(서버)에서 받은 hlc를 볼 때 (last 갱신). lower: 서버가 다시 찍은 값으로 낮춤 (빠른 시계 기기, D-029)
 */
export class Clock {
  constructor(private store: ClockStore, private now: () => number = () => Date.now()) {}
  private last() { return parseHlc(this.store.get()); }
  tick(dev: string): string {
    const l = this.last();
    const pt = this.now();
    let ms = Math.max(pt, l.ms);
    let c = ms === l.ms ? l.c + 1 : 0;
    if (c > 9999) { ms += 1; c = 0; } // 카운터는 4자리 (문자열 비교 순서 유지)
    this.store.set(`${ms}.${c}`);
    return fmtHlc(ms, c, dev);
  }
  observe(h: string): void {
    const r = parseHlc(h), l = this.last();
    if (r.ms > l.ms || (r.ms === l.ms && r.c > l.c)) this.store.set(`${r.ms}.${r.c}`);
  }
  lower(h: string): void {
    const r = parseHlc(h);
    this.store.set(`${r.ms}.${r.c}`);
  }
}

/** 메모리 저장 (테스트, localStorage 없는 환경) */
export const memoryClockStore = (): ClockStore => { let v: string | null = null; return { get: () => v, set: (x) => { v = x; } }; };
