/**
 * 개선 메모 (S3, BLUEPRINT 6장). 어느 화면에서든 적고, 동기화로 PC에 온다.
 * PC에서 `npm run feedback:pull` → feedback/inbox → "개선 메모 처리해 줘" (app-feedback 스킬).
 * 배포 때 CHANGELOG.json의 feedback_ids / deferred 로 앱의 상태가 "반영됨" / "보류(이유)"로 바뀐다.
 */
export const FB_STATUS = ['접수', '검토', '계획', '반영됨', '보류'] as const;
export type FbStatus = (typeof FB_STATUS)[number];

export interface Feedback {
  /** FB-YYYYMMDD-기기ID-NN (기기마다 달라 겹치지 않음) */
  id: string;
  createdAt: string;
  /** 적을 때 보던 화면 (예: #/workout) */
  screen: string;
  /** 자동으로 붙는 맥락 (예: 진행 중 운동 이름, 앱 버전) */
  context?: string;
  text: string;
  status: FbStatus;
  /** 반영된 버전 또는 보류 이유 */
  note?: string;
}

export const FB_TEXT_MAX = 2000;

/**
 * 새 메모 ID: FB-날짜-기기-시분초+난수2자리 (예: FB-20260930-ab12-10421537).
 * 순번을 쓰지 않아 지우거나 백업을 불러온 뒤에도 옛 번호가 다시 쓰이지 않음 (PC 가져오기·CHANGELOG 상태가 섞이지 않게).
 * existing과 겹치면 난수를 다시 뽑음
 */
export function newFeedbackId(now: Date, dev: string, existing: string[], rnd: () => number = Math.random): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
  const t = `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const used = new Set(existing);
  for (let k = 0; k < 200; k++) { const id = `FB-${d}-${dev}-${t}${p2(Math.floor(rnd() * 100))}`; if (!used.has(id)) return id; }
  return `FB-${d}-${dev}-${t}${String(Date.now() % 100000).padStart(5, '0')}`;
}

export function feedbackOk(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const f = x as Record<string, unknown>;
  return typeof f.id === 'string' && /^FB-\d{8}-[a-z0-9]{1,12}-\d{2,}$/i.test(f.id)
    && typeof f.createdAt === 'string' && !Number.isNaN(Date.parse(f.createdAt))
    && typeof f.screen === 'string' && f.screen.length <= 200
    && (f.context === undefined || (typeof f.context === 'string' && f.context.length <= 300))
    && typeof f.text === 'string' && f.text.length > 0 && f.text.length <= FB_TEXT_MAX
    && FB_STATUS.includes(f.status as FbStatus)
    && (f.note === undefined || (typeof f.note === 'string' && f.note.length <= 500));
}

interface ChangelogVersion { version: string; feedback_ids?: string[]; deferred?: { id: string; reason: string }[] }

/** 새 ID가 겹치지 않는지 볼 목록: 지금 메모 + 지운 메모(지움 표시) ID */
export const usedFeedbackIds = (live: string[], tombIds: string[]) => [...live, ...tombIds];

/**
 * 배포된 CHANGELOG로 상태 갱신: 반영된 메모 → "반영됨 (버전)", 보류 → "보류 (이유)".
 * 바뀌는 메모만 돌려줌 (그대로인 것은 저장하지 않게)
 */
export function applyChangelog(items: Feedback[], versions: ChangelogVersion[]): Feedback[] {
  // versions는 최신이 앞. 반영됨은 "가장 이른 버전"(뒤에 오는 것이 덮어씀) → 옛 기기·새 기기가 같은 결과 (버전이 섞여도 번갈아 바꾸지 않음)
  const done = new Map<string, string>(), deferred = new Map<string, string>();
  for (const v of versions) {
    for (const id of v.feedback_ids ?? []) done.set(id, v.version);
    for (const d of v.deferred ?? []) if (!deferred.has(d.id)) deferred.set(d.id, d.reason);
  }
  const out: Feedback[] = [];
  for (const f of items) {
    if (done.has(f.id)) {
      const note = `${done.get(f.id)} 에 반영`;
      if (f.status !== '반영됨' || f.note !== note) out.push({ ...f, status: '반영됨', note });
    } else if (deferred.has(f.id) && f.status !== '반영됨' && f.status !== '보류') {
      // 이미 보류면 그대로 (기기마다 CHANGELOG의 이유가 달라도 서로 덮어쓰지 않게), 반영됨은 보류로 되돌리지 않음
      out.push({ ...f, status: '보류', note: deferred.get(f.id)! });
    }
  }
  return out;
}
