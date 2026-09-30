/**
 * 끝낸 운동 고치기 (D-035). 화면(WorkoutEdit)은 초안(draft)을 이 함수들로 바꾸고, 저장 때 editProblem → finalizeEdit.
 * 진행 중 운동은 여기서 고치지 않는다 (운동 화면과 주인 규칙이 따로 있음).
 * 동기화: 저장은 보통 저장과 같음 (기록 한 건 전체). 두 기기가 같은 기록을 동시에 고치면 나중 수정이 이김 (D-029, D-035)
 */
import type { Workout, WorkoutBlock, SetLog } from './session';

export const EDIT_LIMITS = { nameMax: 60, weight: 1000, reps: 1000, seconds: 3600, rir: 10, maxMinutes: 12 * 60, memoMax: 2000 } as const;

const p2 = (n: number) => String(n).padStart(2, '0');
/** ISO → <input type="datetime-local"> 값 (이 기기 시간대) */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** <input type="datetime-local"> 값 → ISO (잘못된 값이면 undefined) */
export function fromLocalInput(v: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? undefined : d.toISOString();
}
/** 운동 시간(분, 반올림) */
export const durationMin = (w: Workout) => Math.round((Date.parse(w.endedAt ?? w.startedAt) - Date.parse(w.startedAt)) / 60000);

/** 시작 시각·운동 시간(분)으로 시작·끝 다시 정함. 시작을 옮기면 세트의 끝낸 시각(doneAt)도 같은 만큼 옮김 */
export function setTimes(w: Workout, startIso: string, minutes: number): Workout {
  const shift = Date.parse(startIso) - Date.parse(w.startedAt);
  const blocks = !shift ? w.blocks : w.blocks.map((b) => ({ ...b, items: b.items.map((it) => ({ ...it, sets: it.sets.map((s) => (s.doneAt ? { ...s, doneAt: new Date(Date.parse(s.doneAt) + shift).toISOString() } : s)) })) }));
  return { ...w, blocks, startedAt: startIso, endedAt: new Date(Date.parse(startIso) + Math.round(minutes) * 60000).toISOString() };
}

/** 시작만 옮김: 운동 길이는 초 단위까지 그대로 (분으로 반올림하지 않음) */
export function moveStart(w: Workout, startIso: string): Workout {
  const len = Date.parse(w.endedAt ?? w.startedAt) - Date.parse(w.startedAt);
  const moved = setTimes(w, startIso, 0);
  return { ...moved, endedAt: new Date(Date.parse(startIso) + len).toISOString() };
}

/**
 * 편집 중 세트를 가리키는 임시 열쇠(_k): 순번은 지우기·추가로 바뀌므로, 늦게 도착한 입력이 다른 세트에 들어가지 않게 열쇠로 찾음.
 * 초안을 만들 때 붙이고(withKeys) 저장 때 뗌(finalizeEdit)
 */
type Keyed = SetLog & { _k?: string };
let keySeq = 0;
const newKey = () => `k${++keySeq}`;
export function withKeys(w: Workout): Workout {
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, items: b.items.map((it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, _k: (s as Keyed)._k ?? newKey() }) as SetLog) })) })) };
}
export const keyOf = (s: SetLog) => (s as Keyed)._k ?? '';
const stripKey = (s: SetLog): SetLog => { const { _k: _x, ...rest } = s as Keyed; return rest; };
/** 열쇠로 세트 찾아 고치기 (없으면 그대로: 이미 지운 세트에 늦게 온 입력은 버림) */
export function patchSetByKey(w: Workout, key: string, patch: Partial<SetLog>): Workout {
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, items: b.items.map((it) => (it.sets.some((s) => keyOf(s) === key) ? { ...it, sets: it.sets.map((s) => (keyOf(s) === key ? { ...s, ...patch, auto: false } : s)) } : it)) })) };
}

const mapBlocks = (w: Workout, fn: (b: WorkoutBlock, bi: number) => WorkoutBlock | null): Workout => ({
  ...w, blocks: w.blocks.map(fn).filter((b): b is WorkoutBlock => !!b && b.items.length > 0),
});

export function patchSet(w: Workout, bi: number, ii: number, k: number, patch: Partial<SetLog>): Workout {
  return mapBlocks(w, (b, x) => (x !== bi ? b : { ...b, items: b.items.map((it, y) => (y !== ii ? it : { ...it, sets: it.sets.map((s, z) => (z === k ? { ...s, ...patch, auto: false } : s)) })) }));
}
/** 세트 추가: 마지막 세트 값을 이어받은 완료 세트 (끝낸 운동에 더하는 것이므로 완료로) */
export function appendDoneSet(w: Workout, bi: number, ii: number): Workout {
  return mapBlocks(w, (b, x) => (x !== bi ? b : { ...b, items: b.items.map((it, y) => {
    if (y !== ii) return it;
    const last = [...it.sets].reverse().find((s) => !s.warmup);
    const s = { _k: newKey(), warmup: false, done: true, ...(last?.weight !== undefined ? { weight: last.weight } : {}), ...(it.target.seconds !== undefined ? { seconds: last?.seconds ?? it.target.seconds } : { reps: last?.reps ?? it.target.reps }) } as Keyed as SetLog;
    return { ...it, skipped: false, sets: [...it.sets, s] };
  }) }));
}
export function deleteSet(w: Workout, bi: number, ii: number, k: number): Workout {
  return mapBlocks(w, (b, x) => (x !== bi ? b : { ...b, items: b.items.map((it, y) => (y !== ii ? it : { ...it, sets: it.sets.filter((_, z) => z !== k) })) }));
}
/** 운동(종목) 지우기. 블록이 비면 블록도, 묶음에 하나만 남으면 단일로 */
export function deleteItem(w: Workout, bi: number, ii: number): Workout {
  return mapBlocks(w, (b, x) => {
    if (x !== bi) return b;
    const items = b.items.filter((_, y) => y !== ii);
    if (!items.length) return null;
    return items.length === 1 && b.kind !== 'single' ? { ...b, kind: 'single', items, restSec: b.restSec || b.roundRestSec } : { ...b, items };
  });
}

const intIn = (v: number | undefined, max: number) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= max);
const numIn = (v: number | undefined, max: number) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= max);

/**
 * 저장 전 검사. 문제가 있으면 사람이 읽는 이유, 없으면 null. name: 종목 ID → 이름.
 * allowShort: 원래 1분 미만이던 기록을 시간은 그대로 두고 다른 것만 고칠 때 (시간 검사 건너뜀)
 */
export function editProblem(w: Workout, nowMs: number, name: (id: string) => string = (id) => id, opts: { allowShort?: boolean } = {}): string | null {
  const nm = w.name.trim();
  if (!nm) return '운동 이름을 적어 주세요';
  if (nm.length > EDIT_LIMITS.nameMax) return `운동 이름은 ${EDIT_LIMITS.nameMax}자까지예요`;
  const st = Date.parse(w.startedAt), en = Date.parse(w.endedAt ?? '');
  if (Number.isNaN(st)) return '시작 시각이 잘못됐어요';
  if (Number.isNaN(en) || en < st || (en - st < 60000 && !opts.allowShort)) return '운동 시간(분)을 1 이상으로 적어 주세요';
  if (en - st > EDIT_LIMITS.maxMinutes * 60000) return `운동 시간은 ${EDIT_LIMITS.maxMinutes / 60}시간까지예요`;
  if (st > nowMs + 5 * 60000) return '시작 시각이 미래예요';
  if ((w.memo ?? '').length > EDIT_LIMITS.memoMax) return `메모는 ${EDIT_LIMITS.memoMax}자까지예요`;
  if (!w.blocks.some((b) => b.items.length)) return '운동이 하나도 없어요. 기록을 지우려면 삭제를 눌러 주세요';
  let n = 0;
  for (const b of w.blocks) for (const it of b.items) {
    n++;
    for (const [k, s] of it.sets.entries()) {
      const at = `${n}번째 운동(${name(it.exerciseId)}) ${k + 1}번째 세트`;
      if (!numIn(s.weight, EDIT_LIMITS.weight)) return `${at}: 무게는 0~${EDIT_LIMITS.weight}kg`;
      if (!intIn(s.reps, EDIT_LIMITS.reps)) return `${at}: 횟수는 0~${EDIT_LIMITS.reps} 사이 정수`;
      if (!intIn(s.seconds, EDIT_LIMITS.seconds)) return `${at}: 시간은 0~${EDIT_LIMITS.seconds}초 사이 정수`;
      if (!intIn(s.rir, EDIT_LIMITS.rir)) return `${at}: RIR은 0~${EDIT_LIMITS.rir} 사이 정수`;
    }
  }
  return null;
}

/**
 * 저장할 모양으로 정리: 이름·메모 다듬기, 타이머 없음, 완료 세트에 끝낸 시각(doneAt, 없으면 시작 시각 기준으로 겹치지 않게),
 * 완료를 끈 세트는 doneAt 없앰, 완료 세트가 생긴 종목은 건너뜀 해제, 고친 시각(editedAt). 주인·늦은 기록 표시는 그대로
 */
export function finalizeEdit(w: Workout, nowIso: string): Workout {
  const used = new Set<string>();
  for (const b of w.blocks) for (const it of b.items) for (const s of it.sets) if (s.done && s.doneAt) used.add(s.doneAt);
  let seq = 0;
  const freshAt = () => { let t: string; do { t = new Date(Date.parse(w.startedAt) + ++seq * 1000).toISOString(); } while (used.has(t)); used.add(t); return t; };
  const memo = w.memo?.trim();
  return {
    ...w,
    name: w.name.trim(),
    memo: memo ? memo : undefined,
    timer: null,
    editedAt: nowIso,
    blocks: w.blocks.filter((b) => b.items.length).map((b) => ({ ...b, items: b.items.map((it) => {
      const sets = it.sets.map((s) => {
        const { auto: _a, doneAt, ...rest } = stripKey(s);
        return s.done ? { ...rest, doneAt: doneAt ?? freshAt() } : rest;
      });
      return { ...it, sets, skipped: !!it.skipped && !sets.some((s) => s.done) };
    }) })),
  };
}

/** 고친 것이 있는지 (동기화 표시 _s·편집 열쇠 _k 제외) */
export function sameWorkout(a: Workout, b: Workout): boolean {
  const strip = (w: Workout) => JSON.stringify({ ...w, _s: undefined, blocks: w.blocks.map((bl) => ({ ...bl, items: bl.items.map((it) => ({ ...it, sets: it.sets.map(stripKey) })) })) });
  return strip(a) === strip(b);
}
