/**
 * 애플워치(건강 앱) 데이터 받기 (D-058). 순수 함수 한 벌을
 *  - 구글 Apps Script 서버(tools/gas/build.ts 가 HealthIngest 로 붙여 넣음)와
 *  - 앱 테스트
 * 가 함께 쓴다. 외부 모듈을 가져오지 않는다 (Apps Script에서 그대로 돌아야 함). 숫자 구분자를 쓰지 않음.
 *
 * 아이폰 단축어가 보내는 것: { op:"health", key, kind:"workout"|"daily", hr, energy, sleep, rhr, hrv } (또는 samples:{...} 안에)
 * 값마다 여러 줄 글. 한 줄 = "시작 날짜 | 값 [| 끝 날짜] [| 수면 단계]" (구분은 탭 또는 |)
 * 날짜: ISO 8601(권장), 단축어 한국어 기본 형식("2026. 10. 8. 오전 11:24", "2026년 10월 8일 오전 11:24:05"), 2026-10-08 11:24:05.
 * 시간대가 없으면 한국 시간(+09:00)으로 본다.
 *
 * 저장(동기화 기록 표 'health', 서버만 씀, 기기는 읽기만):
 *  hr-YYYY-MM-DD   {type:'hr', day, t0(그날 0시 ms), p:[초,심박, 초,심박 ...]}  초 = 그날 0시부터, 5초 단위로 같은 칸이면 나중 값
 *  en-YYYY-MM-DD   {type:'energy', day, t0, p:[시작초,길이초,kcal×10, ...]}  (같은 시작초면 나중 값)
 *  sl-YYYY-MM-DD   {type:'sleep', day, seg:[시작(유닉스초),끝(유닉스초),단계, ...]}  day = 그 밤이 끝난 날 (전날 12시~그날 12시)
 *  dy-YYYY-MM-DD   {type:'daily', day, rhr?, hrvP:[초,ms×10...], hrv?, hrvN?, sleepMin?}  요약은 계속 보관
 *  canary          {type:'canary', at, received, skipped}  연결 시험(tools/watch_canary.mjs): 저장 경로만 확인, 앱은 무시
 *  ws-<운동ID>     {type:'ws', workoutId, startedAt, endedAt, hrAvg?, hrMax?, hrN, kcal?, src:'watch', computedAt}  운동별 요약 (D-059, 지우지 않음)
 *  wsmeta          {type:'wsmeta', done, after}  배포 뒤 처음 받을 때 옛 운동 요약을 나눠 채우는 위치 (앱은 무시)
 * 원본(hr·energy·sleep)은 최근 RAW_KEEP_DAYS일만 (오래된 것은 지움 표시), 요약(daily·ws)은 계속.
 */

export const HEALTH_TABLE = 'health';
export const RAW_KEEP_DAYS = 120;
export const HR_BUCKET_SEC = 5;
export const MAX_LINES = 30000;
export const MAX_DAY_POINTS = 17280; // 하루 86400초 / 5초
export const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export type SleepStage = 0 | 1 | 2 | 3 | 4 | 5; // 0 잠(구분 없음) 1 코어 2 깊은 3 렘 4 깨어 있음 5 침대에 있음
export const ASLEEP_STAGES: readonly number[] = [0, 1, 2, 3];
export interface Sample { t: number; v: number; end?: number; stage?: SleepStage }
export type HealthField = 'hr' | 'energy' | 'sleep' | 'rhr' | 'hrv';
export const HEALTH_FIELDS: readonly HealthField[] = ['hr', 'energy', 'sleep', 'rhr', 'hrv'];

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
/** 한국 시간 날짜 'YYYY-MM-DD' */
export function kstDay(ms: number): string {
  const d = new Date(ms + KST_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
/** 그 한국 날짜 0시의 ms */
export function kstDayStart(day: string): number {
  const p = day.split('-').map(Number);
  return Date.UTC(p[0]!, p[1]! - 1, p[2]!) - KST_MS;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function to24(h: number, ap: string | undefined): number {
  if (!ap) return h;
  const pm = /오후|pm/i.test(ap);
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}
function kstMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  return Date.UTC(y, mo - 1, d, h, mi, s) - KST_MS;
}

/** 날짜 글 → ms (못 읽으면 undefined) */
export function parseDate(text: string): number | undefined {
  const s = String(text || '').replace(/\u202f|\u00a0/g, ' ').trim();
  if (!s) return undefined;
  // ISO 8601: 2026-10-08T11:24:05+09:00 / Z / 시간대 없음(한국 시간)
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const y = +iso[1]!, mo = +iso[2]!, d = +iso[3]!, h = +iso[4]!, mi = +iso[5]!, sec = +(iso[6] || 0);
    if (!iso[7]) return kstMs(y, mo, d, h, mi, sec);
    const base = Date.UTC(y, mo - 1, d, h, mi, sec);
    if (iso[7] === 'Z') return base;
    const m = /([+-])(\d{2}):?(\d{2})/.exec(iso[7])!;
    const off = (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!) * 60000;
    return base - off;
  }
  // 한국어·숫자 형식: 2026. 10. 8. 오전 11:24 / 2026년 10월 8일 오후 11:24:05 / 2026/10/08 23:10 / 2026-10-08 23:10
  const ko = /^(\d{4})\s*(?:\.|년|\/|-)\s*(\d{1,2})\s*(?:\.|월|\/|-)\s*(\d{1,2})\s*(?:\.|일)?\s*(?:\(?[월화수목금토일]\)?\s*)?(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(오전|오후|AM|PM)?$/i.exec(s);
  if (ko) return kstMs(+ko[1]!, +ko[2]!, +ko[3]!, to24(+ko[5]!, ko[4] || ko[8]), +ko[6]!, +(ko[7] || 0));
  // 영어: Oct 8, 2026 at 11:24 AM / October 8, 2026, 11:24:05 PM
  const en = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (en && MONTHS[en[1]!.toLowerCase()]) return kstMs(+en[3]!, MONTHS[en[1]!.toLowerCase()]!, +en[2]!, to24(+en[4]!, en[7]), +en[5]!, +(en[6] || 0));
  return undefined;
}

/** 값 글 → 숫자 ("128 count/min", "128 회/분", "45.2 ms", "1,234.5 kcal"). 못 읽으면 undefined */
export function parseNumber(text: string): number | undefined {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(text || ''));
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** 단축어가 수면 '값'을 숫자로 줄 때 (HKCategoryValueSleepAnalysis): 0 침대, 1 잠(구분 없음), 2 깨어 있음, 3 코어, 4 깊은, 5 렘 → 이 앱 번호 */
export const HK_SLEEP: Record<number, SleepStage> = { 0: 5, 1: 0, 2: 4, 3: 1, 4: 2, 5: 3 };
/** 킬로줄 표시 (kJ, 킬로줄) → kcal 로 바꿈 */
export const KJ_PER_KCAL = 4.184;
const isKJ = (s: string) => /kj\b|킬로줄/i.test(s);

/** 수면 단계 글 → 번호 (못 읽으면 undefined) */
export function parseStage(text: string): SleepStage | undefined {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return undefined;
  if (/깨어|awake/.test(s)) return 4;
  if (/침대|in ?bed/.test(s)) return 5;
  if (/깊은|deep/.test(s)) return 2;
  if (/렘|rem\b|^rem/.test(s)) return 3;
  if (/코어|core|가벼운|light/.test(s)) return 1;
  if (/수면|잠|asleep|sleep/.test(s)) return 0;
  return undefined;
}

const RANGE: Record<HealthField, [number, number]> = { hr: [25, 250], energy: [0, 2000], sleep: [0, 0], rhr: [25, 150], hrv: [1, 300] };

/** 여러 줄 글 → 샘플. 못 읽은 줄은 개수만 (skipped). 미래(+1일)·너무 옛날(-400일) 날짜도 건너뜀 */
export function parseLines(field: HealthField, text: unknown, nowMs: number): { samples: Sample[]; skipped: number } {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const samples: Sample[] = [];
  let skipped = 0;
  for (const line of lines) {
    const parts = line.split(/\t|\s*\|\s*/).map((x) => x.trim()).filter((x) => x !== '');
    const t = parseDate(parts[0] || '');
    if (t === undefined || t > nowMs + DAY_MS || t < nowMs - 400 * DAY_MS) { skipped++; continue; }
    if (field === 'sleep') {
      // 수면: 시작 | (단계 또는 값) | 끝 | (단계)  — 순서가 섞여도 날짜인 칸 = 끝, 단계 글인 칸 = 단계
      let end: number | undefined; let stage: SleepStage | undefined;
      for (const p of parts.slice(1)) {
        const d = parseDate(p);
        if (d !== undefined) { if (end === undefined) end = d; continue; }
        const st = parseStage(p);
        if (st !== undefined && stage === undefined) stage = st;
      }
      // 단계 글이 없으면 숫자 값(0~5, HealthKit 수면 분석 값)으로
      if (stage === undefined) { const num = parts.slice(1).find((p) => /^\d$/.test(p) && HK_SLEEP[Number(p)] !== undefined); if (num !== undefined) stage = HK_SLEEP[Number(num)]; }
      if (end === undefined || end <= t || end - t > DAY_MS || stage === undefined) { skipped++; continue; }
      samples.push({ t, v: 0, end, stage });
      continue;
    }
    const raw = parseNumber(parts[1] || '');
    // 활동 에너지를 킬로줄로 쓰는 아이폰 설정이면 kcal 로 바꿈 (D-058 검토 G3)
    const v = raw !== undefined && field === 'energy' && isKJ(parts[1] || '') ? Math.round((raw / KJ_PER_KCAL) * 10) / 10 : raw;
    const r = RANGE[field];
    if (v === undefined || v < r[0] || v > r[1]) { skipped++; continue; }
    let end: number | undefined;
    if (parts[2] !== undefined) { const d = parseDate(parts[2]); if (d !== undefined && d >= t && d - t <= DAY_MS) end = d; }
    samples.push(end === undefined ? { t, v } : { t, v, end });
  }
  return { samples, skipped };
}

// ---------- 서버 저장 (기록 표 'health') ----------
export interface HRec { table: string; id: string; data?: Record<string, unknown>; deleted?: boolean; hlc: string; dev: string; rev: number }
export interface HState { rev: number; recs: Record<string, HRec> }
export interface HealthReq { kind?: string; samples?: Record<string, unknown>; [k: string]: unknown }
export type IngestResult = { ok: true; received: number; skipped: number; stored: string[] } | { ok: false; error: string };

const hlcOf = (ms: number) => String(Math.floor(ms)).padStart(13, '0') + '.0000.srv';
const keyOf = (id: string) => HEALTH_TABLE + '/' + id;
function put(state: HState, id: string, data: Record<string, unknown>, nowMs: number): void {
  state.rev += 1;
  state.recs[keyOf(id)] = { table: HEALTH_TABLE, id, data, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev };
}
function cur(state: HState, id: string): Record<string, unknown> | undefined {
  const r = state.recs[keyOf(id)];
  return r && !r.deleted ? r.data : undefined;
}
/** 평평한 배열을 width개씩 → 첫 값(키)으로 묶은 Map */
function toMap(flat: unknown, width: number): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const a = Array.isArray(flat) ? (flat as number[]) : [];
  for (let i = 0; i + width <= a.length; i += width) m.set(a[i]!, a.slice(i, i + width));
  return m;
}
function flatSorted(m: Map<number, number[]>): number[] {
  const keys = Array.from(m.keys()).sort((a, b) => a - b);
  const out: number[] = [];
  for (const k of keys) for (const x of m.get(k)!) out.push(x);
  return out;
}
/** 수면 밤의 날짜: 끝 시각 기준 전날 12시 ~ 그날 12시 → 그날 */
export const sleepDay = (endMs: number) => kstDay(endMs - 12 * 3600 * 1000 + DAY_MS);
/** 겹치는 잠 구간을 합친 총 분 (여러 기기·단계가 겹쳐도 두 번 세지 않음) */
export function asleepMinutes(seg: readonly number[]): number {
  const iv: [number, number][] = [];
  for (let i = 0; i + 3 <= seg.length; i += 3) if (ASLEEP_STAGES.includes(seg[i + 2]!)) iv.push([seg[i]!, seg[i + 1]!]);
  iv.sort((a, b) => a[0] - b[0]);
  let total = 0, s = -1, e = -1;
  for (const [a, b] of iv) {
    if (a > e) { if (e > s) total += e - s; s = a; e = b; } else if (b > e) e = b;
  }
  if (e > s) total += e - s;
  return Math.round(total / 60);
}

/** 단축어 요청 하나 반영 (state 를 제자리에서 바꿈). kind:'canary' 는 읽기만 하고 canary 기록 하나만 씀 */
export function ingestHealth(state: HState, req: HealthReq, nowMs: number): IngestResult {
  const src = (req.samples && typeof req.samples === 'object' ? req.samples : req) as Record<string, unknown>;
  let lines = 0;
  for (const f of HEALTH_FIELDS) lines += String(src[f] ?? '').split(/\r?\n/).filter((l) => l.trim()).length;
  if (lines > MAX_LINES) return { ok: false, error: 'too_many' };
  const parsed = {} as Record<HealthField, Sample[]>;
  let received = 0, skipped = 0;
  for (const f of HEALTH_FIELDS) {
    const r = parseLines(f, src[f], nowMs);
    parsed[f] = r.samples; received += r.samples.length; skipped += r.skipped;
  }
  const rx = new Date(nowMs).toISOString();
  const kind = String(req.kind || 'workout');
  if (kind === 'canary') { put(state, 'canary', { id: 'canary', type: 'canary', at: rx, received, skipped }, nowMs); return { ok: true, received, skipped, stored: ['canary'] }; }
  const cutoff = kstDay(nowMs - RAW_KEEP_DAYS * DAY_MS);
  const touched = new Map<string, Record<string, unknown>>();
  const get = (id: string, init: () => Record<string, unknown>) => {
    let d = touched.get(id);
    if (!d) { const c = cur(state, id); d = c ? JSON.parse(JSON.stringify(c)) as Record<string, unknown> : init(); touched.set(id, d); }
    return d;
  };
  // 심박: 그날 0시부터 초, 5초 칸마다 하나
  const hrMaps = new Map<string, Map<number, number[]>>();
  for (const x of parsed.hr) {
    const day = kstDay(x.t); if (day < cutoff) continue;
    const id = 'hr-' + day;
    const d = get(id, () => ({ id, type: 'hr', day, t0: kstDayStart(day), p: [] }));
    let m = hrMaps.get(id); if (!m) { m = toMap(d.p, 2); hrMaps.set(id, m); }
    const sec = Math.floor((x.t - (d.t0 as number)) / 1000 / HR_BUCKET_SEC) * HR_BUCKET_SEC;
    m.set(sec, [sec, Math.round(x.v)]);
  }
  for (const [id, m] of hrMaps) { const d = touched.get(id)!; let flat = flatSorted(m); if (flat.length > 2 * MAX_DAY_POINTS) flat = flat.slice(flat.length - 2 * MAX_DAY_POINTS); d.p = flat; }
  // 활동 에너지: [시작초, 길이초, kcal×10]
  const enMaps = new Map<string, Map<number, number[]>>();
  for (const x of parsed.energy) {
    const day = kstDay(x.t); if (day < cutoff) continue;
    const id = 'en-' + day;
    const d = get(id, () => ({ id, type: 'energy', day, t0: kstDayStart(day), p: [] }));
    let m = enMaps.get(id); if (!m) { m = toMap(d.p, 3); enMaps.set(id, m); }
    const sec = Math.floor((x.t - (d.t0 as number)) / 1000);
    m.set(sec, [sec, Math.max(0, Math.round(((x.end ?? x.t) - x.t) / 1000)), Math.round(x.v * 10)]);
  }
  for (const [id, m] of enMaps) touched.get(id)!.p = flatSorted(m);
  // 수면: [시작, 끝(유닉스초), 단계], 같은 (시작, 단계)는 하나
  const slMaps = new Map<string, Map<string, number[]>>();
  for (const x of parsed.sleep) {
    const day = sleepDay(x.end!); if (day < cutoff) continue;
    const id = 'sl-' + day;
    const d = get(id, () => ({ id, type: 'sleep', day, seg: [] }));
    let m = slMaps.get(id);
    if (!m) { m = new Map(); const a = Array.isArray(d.seg) ? (d.seg as number[]) : []; for (let i = 0; i + 3 <= a.length; i += 3) m.set(a[i] + ':' + a[i + 2], a.slice(i, i + 3)); slMaps.set(id, m); }
    const s0 = Math.floor(x.t / 1000);
    m.set(s0 + ':' + x.stage, [s0, Math.floor(x.end! / 1000), x.stage!]);
  }
  for (const [id, m] of slMaps) {
    const segs = Array.from(m.values()).sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!);
    const flat: number[] = []; for (const s of segs) flat.push(s[0]!, s[1]!, s[2]!);
    const d = touched.get(id)!; d.seg = flat;
    const day = d.day as string;
    const dy = get('dy-' + day, () => ({ id: 'dy-' + day, type: 'daily', day }));
    dy.sleepMin = asleepMinutes(flat);
  }
  // 안정 심박: 그날 마지막 값 / HRV: 그날 평균 (샘플을 모아 둠)
  for (const x of parsed.rhr) {
    const day = kstDay(x.t); const id = 'dy-' + day;
    const dy = get(id, () => ({ id, type: 'daily', day }));
    if (!(typeof dy.rhrAt === 'number') || x.t >= (dy.rhrAt as number)) { dy.rhr = Math.round(x.v); dy.rhrAt = x.t; }
  }
  const hvMaps = new Map<string, Map<number, number[]>>();
  for (const x of parsed.hrv) {
    const day = kstDay(x.t); const id = 'dy-' + day;
    const dy = get(id, () => ({ id, type: 'daily', day }));
    let m = hvMaps.get(id); if (!m) { m = toMap(dy.hrvP, 2); hvMaps.set(id, m); }
    const sec = Math.floor((x.t - kstDayStart(day)) / 1000);
    m.set(sec, [sec, Math.round(x.v * 10)]);
  }
  for (const [id, m] of hvMaps) {
    const dy = touched.get(id)!; const flat = flatSorted(m); dy.hrvP = flat;
    let sum = 0, n = 0; for (let i = 1; i < flat.length; i += 2) { sum += flat[i]!; n++; }
    dy.hrv = n ? Math.round(sum / n) / 10 : undefined; dy.hrvN = n;
  }
  const stored: string[] = [];
  for (const [id, d] of touched) { d.rx = rx; put(state, id, d, nowMs); stored.push(id); }
  // D-059 운동별 요약: 받은 샘플 시간(±1일)과 겹치는 끝난 운동 + (배포 뒤 처음이면) 옛 운동을 나눠서
  let tMin = Infinity, tMax = -Infinity;
  for (const f of ['hr', 'energy'] as const) for (const x of parsed[f]) { if (x.t < tMin) tMin = x.t; const e = x.end ?? x.t; if (e > tMax) tMax = e; }
  if (tMin <= tMax) refreshSummaries(state, (w) => Date.parse(w.startedAt) <= tMax + DAY_MS && Date.parse(w.endedAt) >= tMin - DAY_MS, nowMs);
  backfillSummaries(state, nowMs);
  // 오래된 원본 정리 (요약 dy- 는 남김)
  for (const k of Object.keys(state.recs)) {
    const r = state.recs[k]!;
    if (r.table !== HEALTH_TABLE || r.deleted || !/^(hr|en|sl)-\d{4}-\d{2}-\d{2}$/.test(r.id)) continue;
    if (r.id.slice(3) < cutoff) { state.rev += 1; state.recs[k] = { table: HEALTH_TABLE, id: r.id, deleted: true, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev }; }
  }
  return { ok: true, received, skipped, stored: stored.sort() };
}

// ---------- D-059 운동별 애플워치 요약 (지우지 않음) ----------
export const BACKFILL_CAP = 150;
export interface RowLike { t0?: unknown; p?: unknown; [k: string]: unknown }
export interface WindowSummary { hrAvg?: number; hrMax?: number; hrN: number; kcal?: number }
/** 운동 시간 [a,b] 안 심박(평균·최고·개수)과 겹친 활동 에너지(겹친 비율만큼). 행은 ID 로 찾음 (hr-날짜, en-날짜) */
export function windowSummary(get: (id: string) => RowLike | undefined, a: number, b: number): WindowSummary {
  if (!(b > a)) return { hrN: 0 };
  let sum = 0, n = 0, max = 0, kcal = 0, anyK = false;
  for (let d = kstDayStart(kstDay(a - DAY_MS)); d <= b; d += DAY_MS) {
    const day = kstDay(d);
    const hr = get('hr-' + day);
    if (hr && Array.isArray(hr.p) && typeof hr.t0 === 'number' && d >= kstDayStart(kstDay(a))) {
      const p = hr.p as number[];
      for (let i = 0; i + 1 < p.length; i += 2) { const t = hr.t0 + p[i]! * 1000; if (t < a || t > b) continue; const v = p[i + 1]!; sum += v; n++; if (v > max) max = v; }
    }
    const en = get('en-' + day);
    if (en && Array.isArray(en.p) && typeof en.t0 === 'number') {
      const p = en.p as number[];
      for (let i = 0; i + 2 < p.length; i += 3) {
        const s = en.t0 + p[i]! * 1000, dur = p[i + 1]! * 1000, k = p[i + 2]! / 10;
        if (dur <= 0) { if (s >= a && s <= b) { kcal += k; anyK = true; } continue; }
        const ov = Math.min(b, s + dur) - Math.max(a, s);
        if (ov > 0) { kcal += k * (ov / dur); anyK = true; }
      }
    }
  }
  const out: WindowSummary = { hrN: n };
  if (n) { out.hrAvg = Math.round(sum / n); out.hrMax = max; }
  if (anyK) out.kcal = Math.round(kcal);
  return out;
}
interface WLike { id: string; startedAt: string; endedAt: string }
/** 기록 파일의 끝난 운동 (지운 것·늦게 온 사본 제외) */
function finishedWorkouts(state: HState): WLike[] {
  const out: WLike[] = [];
  for (const k of Object.keys(state.recs)) {
    const r = state.recs[k]!;
    if (r.table !== 'workouts' || r.deleted || !r.data) continue;
    const d = r.data;
    if (typeof d.endedAt !== 'string' || typeof d.startedAt !== 'string' || d.pendingMerge) continue;
    out.push({ id: r.id, startedAt: d.startedAt, endedAt: d.endedAt });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** 운동 시간 [a,b] 에 걸친 날 중 원본(prefix-날짜) 기록이 없거나 지워진 날이 있는지 (120일 정리 등) */
function rawMissing(state: HState, prefix: string, a: number, b: number, lookback: number): boolean {
  for (let d = kstDayStart(kstDay(a - lookback)); d <= b; d += DAY_MS) if (!cur(state, prefix + kstDay(d))) return true;
  return false;
}
/**
 * 운동 하나의 요약을 다시 계산해 저장. 바뀐 게 없으면 쓰지 않음. 나빠지지 않게 (D-059, 검토 E1):
 * - 새 계산이 심박 0개·칼로리 없음인데 저장된 요약이 있으면: 시간이 같으면 그대로, 시간을 고쳤으면 값은 두고
 *   시간만 새로 + stale:true (원본이 정리돼 다시 셀 수 없음)
 * - 시간이 같고 새 심박 개수가 더 적으면 저장된 심박 값 유지
 * - 저장된 kcal 보다 새 kcal 이 없거나 작은데 그 시간의 에너지 원본이 빠져 있으면 저장된 kcal 유지
 * - 심박·칼로리가 둘 다 없고 저장된 것도 없으면 만들지 않음
 */
export function refreshSummary(state: HState, w: WLike, nowMs: number): boolean {
  const id = 'ws-' + w.id;
  const old = cur(state, id);
  const a = Date.parse(w.startedAt), b = Date.parse(w.endedAt);
  const s = windowSummary((rid) => cur(state, rid) as RowLike | undefined, a, b);
  const sameTime = !!old && old.startedAt === w.startedAt && old.endedAt === w.endedAt;
  const empty = !s.hrN && !s.kcal;
  if (!old && empty) return false;
  const base: Record<string, unknown> = { id, type: 'ws', workoutId: w.id, startedAt: w.startedAt, endedAt: w.endedAt, src: 'watch', computedAt: new Date(nowMs).toISOString() };
  if (old && empty) {
    if (sameTime) return false;
    const keep: Record<string, unknown> = { ...base };
    for (const k of ['hrN', 'hrAvg', 'hrMax', 'kcal']) if (old[k] !== undefined) keep[k] = old[k];
    keep.stale = true;
    put(state, id, keep, nowMs);
    return true;
  }
  const oldN = old && typeof old.hrN === 'number' ? (old.hrN as number) : 0;
  const oldK = old && typeof old.kcal === 'number' ? (old.kcal as number) : undefined;
  let hrN = s.hrN, hrAvg = s.hrAvg, hrMax = s.hrMax, kcal = s.kcal;
  if (sameTime && hrN < oldN) { hrN = oldN; hrAvg = old!.hrAvg as number | undefined; hrMax = old!.hrMax as number | undefined; }
  let stale = false;
  if (oldK !== undefined && (kcal === undefined || kcal < oldK) && (sameTime || kcal === undefined) && rawMissing(state, 'en-', a, b, DAY_MS)) { kcal = oldK; stale = !sameTime; }
  if (sameTime && hrN === oldN && hrAvg === old!.hrAvg && hrMax === old!.hrMax && kcal === oldK && !old!.stale) return false;
  const data: Record<string, unknown> = { ...base, hrN };
  if (hrAvg !== undefined) { data.hrAvg = hrAvg; data.hrMax = hrMax; }
  if (kcal !== undefined) data.kcal = kcal;
  if (stale) data.stale = true;
  put(state, id, data, nowMs);
  return true;
}
/** 조건에 맞는 끝난 운동들의 요약 다시 계산. 쓴 개수 */
export function refreshSummaries(state: HState, pick: (w: WLike) => boolean, nowMs: number): number {
  let n = 0;
  for (const w of finishedWorkouts(state)) if (pick(w) && refreshSummary(state, w, nowMs)) n++;
  return n;
}
/** 배포 뒤 처음: 옛 운동 요약을 BACKFILL_CAP 개씩 (Apps Script 실행 시간 안에서), 다음 요청에 이어서 */
export function backfillSummaries(state: HState, nowMs: number, cap = BACKFILL_CAP): number {
  const meta = cur(state, 'wsmeta');
  if (meta && meta.done) return 0;
  const after = meta && typeof meta.after === 'string' ? (meta.after as string) : '';
  const list = finishedWorkouts(state).filter((w) => w.id > after);
  if (!list.length && !meta) return 0; // 할 일이 없으면 표시도 쓰지 않음 (운동은 올라올 때 afterWorkoutMuts 가 채움)
  const batch = list.slice(0, cap);
  let n = 0;
  for (const w of batch) if (refreshSummary(state, w, nowMs)) n++;
  const done = list.length <= cap;
  put(state, 'wsmeta', { id: 'wsmeta', type: 'wsmeta', done, after: batch.length ? batch[batch.length - 1]!.id : after, at: new Date(nowMs).toISOString() }, nowMs);
  return n;
}
/**
 * 기기가 운동을 올린 뒤 (서버 handler 의 sync_ 가 부름): 끝난 운동이면 요약 다시 계산, 지운 운동이면 요약도 지움.
 * 바꾼 게 있으면 true (서버는 응답의 rev·health 를 다시 채움)
 */
export function afterWorkoutMuts(state: HState, ids: readonly string[], nowMs: number): boolean {
  let changed = false;
  for (const wid of ids) {
    const r = state.recs['workouts/' + wid];
    const key = keyOf('ws-' + wid);
    const ws = state.recs[key];
    if (!r || r.deleted || !r.data || typeof r.data.endedAt !== 'string' || r.data.pendingMerge) {
      if (r && r.deleted && ws && !ws.deleted) { state.rev += 1; state.recs[key] = { table: HEALTH_TABLE, id: 'ws-' + wid, deleted: true, hlc: hlcOf(nowMs), dev: 'srv', rev: state.rev }; changed = true; }
      continue;
    }
    if (refreshSummary(state, { id: wid, startedAt: r.data.startedAt as string, endedAt: r.data.endedAt as string }, nowMs)) changed = true;
  }
  return changed;
}

/** 단축어가 보내는 모양 고르기: JSON 글 또는 폼(a=b&c=d) 글. 키·종류·값들 */
export function readHealthBody(body: string, params?: Record<string, string>): Record<string, unknown> | undefined {
  const t = String(body || '').trim();
  if (t.charAt(0) === '{') { try { return JSON.parse(t) as Record<string, unknown>; } catch (e) { return undefined; } }
  if (params && (params.key || params.kind)) return Object.assign({}, params);
  if (t.indexOf('=') > 0) {
    const out: Record<string, string> = {};
    for (const kv of t.split('&')) { const i = kv.indexOf('='); if (i <= 0) continue; out[decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); }
    return out;
  }
  return undefined;
}
