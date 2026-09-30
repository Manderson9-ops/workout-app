/**
 * 진단 기록 (D-024, PC_동기화_제안 v3 3장). 화면과 분리된 순수 함수.
 * "앱이 안에서 어떻게 움직였나"를 남겨 PC에서 확인한다. 운동 내용·입력값·주소는 넣지 않는다.
 *
 * 항목별로 믿을 수 있는 정도가 다르다 (TRUST):
 *  - measured: 앱이 직접 잰 값 (타이머 오차, 앱 전환, 오류 등)
 *  - proxy: 대신 보는 값. 실제 결과는 실기기 체크리스트로 확인 (소리 재생 = 소리 장치 상태, 화면 꺼짐 방지 = 요청 성공)
 */
export const DIAG_KINDS = ['start', 'timer', 'audio', 'wake', 'vis', 'input', 'plan', 'error', 'backup', 'send'] as const;
export type DiagKind = (typeof DIAG_KINDS)[number];

export const DIAG_LABEL: Record<DiagKind, string> = {
  start: '앱 시작', timer: '휴식 타이머', audio: '소리', wake: '화면 꺼짐 방지', vis: '앱 전환',
  input: '입력 저장', plan: '플랜 생성', error: '오류', backup: '백업', send: 'PC로 보내기',
};
export const DIAG_TRUST: Record<DiagKind, 'measured' | 'proxy'> = {
  start: 'measured', timer: 'measured', audio: 'proxy', wake: 'proxy', vis: 'measured',
  input: 'measured', plan: 'measured', error: 'measured', backup: 'measured', send: 'measured',
};

/** 한 건 (약 100바이트). t=시각, k=종류, d=기기 ID(짧게), m=짧은 설명, v=숫자 값(ms 등), ok=성공 여부 */
export interface DiagEntry { t: string; k: DiagKind; d: string; m?: string; v?: number; ok?: boolean }

export const DIAG_MAX = 1000;
export const DIAG_MSG_MAX = 200;

/** 오류 메시지 정리: 주소(URL)·경로·긴 숫자·따옴표 안 값(입력값일 수 있음)을 지우고 짧게 */
export function sanitize(msg: unknown, opts: { numbers?: boolean } = {}): string {
  let s = String(msg ?? '');
  s = s.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, '<주소>');
  s = s.replace(/(^|[\s(])(\/|[A-Z]:\\)[^\s)]+/g, '$1<경로>');
  s = s.replace(/(["'`])(?:(?!\1).){1,200}\1/g, '<값>');
  s = s.replace(/\d{5,}/g, '<숫자>');
  if (opts.numbers) s = s.replace(/\b\d+[.,]\d+\b/g, '<숫자>'); // 오류 메시지: 무게 같은 소수 값도 지움
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > DIAG_MSG_MAX ? s.slice(0, DIAG_MSG_MAX - 1) + '…' : s;
}

/**
 * 휴식 끝을 알린 순간의 측정이 믿을 만한지 가르기 (검토 1차):
 *  - measured: 운동 화면이 떠 있었고 앱도 보이는 상태에서 잰 늦음
 *  - offscreen: 휴식이 끝날 때 운동 화면이 아니었음 (홈·기록 탭 등). 운동 화면으로 온 순간 알림 → 늦음은 측정이 아님
 *  - returned: 휴식이 끝날 때 앱이 숨겨져 있었거나(다른 앱), 막 돌아온 직후(1초 안), 또는 숨김 뒤 "보임" 신호가 아직 안 옴
 */
export function classifyTimerEnd(x: { endsAt: number; now: number; screenShownAt: number; lastHiddenAt: number; lastVisibleAt: number; hiddenNow: boolean }): 'measured' | 'offscreen' | 'returned' {
  if (x.hiddenNow) return 'returned';
  if (x.lastHiddenAt > 0 && x.lastHiddenAt >= x.lastVisibleAt) return 'returned'; // 아이폰: 보임 신호보다 타이머가 먼저 돎
  if (x.lastHiddenAt > 0 && x.lastHiddenAt < x.endsAt && x.lastVisibleAt > x.endsAt - 1000) return 'returned';
  if (x.lastVisibleAt > 0 && x.now - x.lastVisibleAt < 1000 && x.now - x.endsAt > 1000) return 'returned';
  if (x.screenShownAt > x.endsAt - 250) return 'offscreen';
  return 'measured';
}

/** 백업 파일 안 진단 한 건 검사 (백업 검사에서 사용) */
export function diagEntryOk(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  return typeof e.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.t) && !Number.isNaN(Date.parse(e.t))
    && DIAG_KINDS.includes(e.k as DiagKind)
    && typeof e.d === 'string' && e.d.length > 0 && e.d.length <= 12
    && (e.m === undefined || (typeof e.m === 'string' && e.m.length <= DIAG_MSG_MAX))
    && (e.v === undefined || (typeof e.v === 'number' && Number.isFinite(e.v)))
    && (e.ok === undefined || typeof e.ok === 'boolean')
    && Object.keys(e).every((k) => ['t', 'k', 'd', 'm', 'v', 'ok', 'id'].includes(k));
}

/** 사파리 버전 (iOS 26부터 브라우저 정보의 iOS 버전은 18.6으로 고정이라 사파리 버전을 대신 봄: 대리 지표) */
export function browserLabel(ua: string): string {
  const safari = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/);
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '기타';
  const br = chrome ? `Chrome ${chrome[1]}` : safari ? `Safari ${safari[1]}` : '기타 브라우저';
  return `${device} · ${br}`;
}

export interface DiagSummary {
  from?: string; to?: string; total: number;
  devices: string[];
  timer: { n: number; lateMaxMs: number; lateAvgMs: number; returned: number; offscreen: number };
  audio: { n: number; notRunning: number };
  wake: { requested: number; failed: number; released: number };
  vis: { hidden: number };
  input: { flushedBeforeAction: number };
  plan: { n: number; maxMs: number };
  errors: string[];
  backup: { ok: number; failed: number };
  send: { ok: number; failed: number };
  lastStart?: string;
}

/** PC에서 한눈에 보는 요약. 판정 문구는 체크리스트 번호와 함께 (BLUEPRINT 7.4) */
export function summarizeDiag(list: DiagEntry[], device?: string): DiagSummary {
  const xs = device ? list.filter((e) => e.d === device) : list;
  const by = (k: DiagKind) => xs.filter((e) => e.k === k);
  const timers = by('timer').filter((e) => e.m === undefined || e.m === 'measured');
  const late = timers.map((e) => Math.max(0, e.v ?? 0));
  const plans = by('plan');
  return {
    ...(xs[0] ? { from: xs[0].t, to: xs[xs.length - 1]!.t } : {}),
    total: xs.length,
    devices: [...new Set(xs.map((e) => e.d))],
    timer: { n: timers.length, lateMaxMs: late.length ? Math.max(...late) : 0, lateAvgMs: late.length ? Math.round(late.reduce((a, b) => a + b, 0) / late.length) : 0, returned: by('timer').filter((e) => e.m === 'returned').length, offscreen: by('timer').filter((e) => e.m === 'offscreen').length },
    audio: { n: by('audio').length, notRunning: by('audio').filter((e) => e.ok === false).length },
    wake: { requested: by('wake').filter((e) => e.m === 'request').length, failed: by('wake').filter((e) => e.ok === false).length, released: by('wake').filter((e) => e.m === 'released').length },
    vis: { hidden: by('vis').filter((e) => e.m === 'hidden').length },
    input: { flushedBeforeAction: by('input').length },
    plan: { n: plans.length, maxMs: plans.length ? Math.max(...plans.map((e) => e.v ?? 0)) : 0 },
    errors: [...new Set(by('error').map((e) => e.m ?? ''))].slice(0, 20),
    backup: { ok: by('backup').filter((e) => e.ok !== false).length, failed: by('backup').filter((e) => e.ok === false).length },
    send: { ok: by('send').filter((e) => e.ok === true).length, failed: by('send').filter((e) => e.ok === false).length },
    ...(by('start').length ? { lastStart: by('start')[by('start').length - 1]!.m } : {}),
  };
}

/** 받은 데이터 글을 판정 문장에 넣을 때: 한 줄, 짧게, 「」로 감쌈 (「」·마크다운 기호는 지움. 지시문 끼워 넣기 방지) */
export const quoteData = (s: unknown, max = 60) => `「${String(s ?? '').replace(/[\r\n`<>#*_[\]|「」『』]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)}」`;

/** 요약을 사람이 읽는 판정 문장으로 (체크리스트 번호 포함). "확인 불가"는 솔직하게 */
export function verdicts(s: DiagSummary): { item: string; text: string; level: 'ok' | 'warn' | 'info' }[] {
  const out: { item: string; text: string; level: 'ok' | 'warn' | 'info' }[] = [];
  if (s.lastStart) {
    const home = s.lastStart.includes('홈 화면 앱'); const kept = s.lastStart.includes('저장 보호 켜짐');
    out.push({ item: '1·9·10 설치·저장', text: `${home ? '홈 화면 앱으로 실행' : '브라우저 탭으로 실행 (아이폰이면 홈 화면에 추가해서 쓰세요)'} · 저장 보호 ${kept ? '켜짐' : '꺼짐'}`, level: home && kept ? 'ok' : 'info' });
  }
  const extra = [s.timer.returned ? `다른 앱에 있다가 돌아와서 안 것 ${s.timer.returned}번` : '', s.timer.offscreen ? `운동 화면 밖에 있다가 와서 안 것 ${s.timer.offscreen}번` : ''].filter(Boolean).join(', ');
  if (s.timer.n) out.push({ item: '7 타이머', text: `운동 화면에서 휴식 끝 ${s.timer.n}번, 늦음 최대 ${(s.timer.lateMaxMs / 1000).toFixed(1)}초 (평균 ${(s.timer.lateAvgMs / 1000).toFixed(1)}초)${extra ? ` · ${extra} (측정에서 뺌)` : ''}`, level: s.timer.lateMaxMs <= 1500 ? 'ok' : 'warn' });
  else if (extra) out.push({ item: '7 타이머', text: `${extra}. 운동 화면에서 잰 기록은 아직 없음`, level: 'info' });
  if (s.audio.n) out.push({ item: '2~4 소리', text: `소리 재생 시도 ${s.audio.n}번 중 소리 장치가 꺼져 있던 것 ${s.audio.notRunning}번. 실제로 들렸는지는 기록으로 알 수 없음 (체크리스트·화면 녹화로 확인)`, level: s.audio.notRunning ? 'warn' : 'info' });
  if (s.wake.requested || s.wake.failed) out.push({ item: '5~6 화면 꺼짐 방지', text: `요청 ${s.wake.requested}번, 실패 ${s.wake.failed}번, 풀림 ${s.wake.released}번. 요청이 성공해도 실제로 화면이 켜져 있었는지는 체크리스트로 확인`, level: s.wake.failed ? 'warn' : 'info' });
  if (s.input.flushedBeforeAction) out.push({ item: '8 입력 후 바로 완료', text: `입력하자마자 버튼을 눌러 먼저 저장한 경우 ${s.input.flushedBeforeAction}번 (정상 동작)`, level: 'ok' });
  if (s.plan.n) out.push({ item: '11 플랜 속도', text: `플랜 생성 ${s.plan.n}번, 가장 오래 걸린 것 ${s.plan.maxMs}ms`, level: s.plan.maxMs <= 1000 ? 'ok' : 'warn' });
  out.push({ item: '오류', text: s.errors.length ? `오류 ${s.errors.length}종: ${s.errors.slice(0, 5).map((e) => quoteData(e)).join(' / ')}` : '오류 없음', level: s.errors.length ? 'warn' : 'ok' });
  if (s.backup.ok || s.backup.failed) out.push({ item: '13~14 백업', text: `성공 ${s.backup.ok}번, 실패 ${s.backup.failed}번`, level: s.backup.failed ? 'warn' : 'ok' });
  if (s.send.ok || s.send.failed) out.push({ item: 'PC로 보내기', text: `성공 ${s.send.ok}번, 실패 ${s.send.failed}번`, level: s.send.failed && !s.send.ok ? 'warn' : s.send.failed ? 'info' : 'ok' });
  return out;
}
