import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newFeedbackId, feedbackOk, applyChangelog, usedFeedbackIds } from '../src/core/feedback';
import { replaceState, emptyState } from '../src/core/syncMerge';
import type { Feedback } from '../src/core/feedback';
import { pullFeedback } from '../tools/feedback_pull';
import { parseBackup, makeBackup } from '../src/core/backup';

const fb = (id: string, extra: Partial<Feedback> = {}): Feedback => ({ id, createdAt: '2026-09-30T10:00:00.000Z', screen: '#/workout', text: '휴식 끝 소리가 작아요', status: '접수', ...extra });

describe('개선 메모 (S3)', () => {
  it('ID: 날짜·기기·그 기기의 그날 순번 (기기마다 달라 겹치지 않음)', () => {
    const d = new Date(2026, 8, 30, 10);
    expect(newFeedbackId(d, 'ab12', [])).toBe('FB-20260930-ab12-01');
    expect(newFeedbackId(d, 'ab12', ['FB-20260930-ab12-01', 'FB-20260930-ab12-07', 'FB-20260930-cd34-09', 'FB-20260929-ab12-12'])).toBe('FB-20260930-ab12-08');
  });
  it('형식 검사: 빈 글·너무 긴 글·모르는 상태·이상한 ID는 거절', () => {
    expect(feedbackOk(fb('FB-20260930-ab12-01'))).toBe(true);
    expect(feedbackOk(fb('FB-20260930-ab12-01', { text: '' }))).toBe(false);
    expect(feedbackOk(fb('FB-20260930-ab12-01', { text: 'x'.repeat(2001) }))).toBe(false);
    expect(feedbackOk(fb('FB-20260930-ab12-01', { status: '끝' as never }))).toBe(false);
    expect(feedbackOk(fb('../../evil'))).toBe(false);
    expect(feedbackOk(null)).toBe(false);
  });
  it('CHANGELOG 반영: 반영됨(버전)·보류(이유), 이미 같은 상태면 저장 안 함, 최신 버전이 먼저', () => {
    const items = [fb('FB-20260930-ab12-01'), fb('FB-20260930-ab12-02'), fb('FB-20260930-ab12-03'), fb('FB-20260930-ab12-04', { status: '반영됨', note: '0.6.0 에 반영' })];
    const out = applyChangelog(items, [
      { version: '0.6.0', feedback_ids: ['FB-20260930-ab12-01', 'FB-20260930-ab12-04'], deferred: [{ id: 'FB-20260930-ab12-02', reason: '아이폰이 막음' }] },
      { version: '0.5.0', feedback_ids: ['FB-20260930-ab12-01'] },
    ]);
    expect(out.map((f) => [f.id, f.status, f.note])).toEqual([['FB-20260930-ab12-01', '반영됨', '0.6.0 에 반영'], ['FB-20260930-ab12-02', '보류', '아이폰이 막음']]);
  });
  it('백업 형식 3: 메모가 들어가고, 깨진 메모가 있으면 거절, 예전(2) 백업은 빈 목록', () => {
    const empty = { routines: [], workouts: [], meta: [], custom: [], settings: [], bodyweight: [], diag: [] };
    const ok = parseBackup(JSON.stringify(makeBackup({ ...empty, feedback: [fb('FB-20260930-ab12-01')] }, '0.6.0', '2026-09-30T10:00:00.000Z')));
    expect(ok.ok && ok.file.data.feedback.length).toBe(1);
    const bad = parseBackup(JSON.stringify(makeBackup({ ...empty, feedback: [fb('FB-20260930-ab12-01', { text: '' })] }, '0.6.0', '2026-09-30T10:00:00.000Z')));
    expect(bad.ok).toBe(false);
    const old = { app: 'workout-app', schema: 2, appVersion: '0.5.0', exportedAt: '2026-09-30T10:00:00.000Z', counts: {}, data: empty };
    const r = parseBackup(JSON.stringify(old));
    expect(r.ok && r.file.data.feedback).toEqual([]);
  });
  it('feedback:pull: 접수 상태만 inbox로, 이미 inbox·processed에 있으면 건너뜀, 깨진 것·지운 것 제외', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fbpull-'));
    mkdirSync(join(dir, 'sync', 'db'), { recursive: true }); mkdirSync(join(dir, 'feedback', 'processed'), { recursive: true });
    const rec = (f: Feedback, deleted = false) => ({ table: 'feedback', id: f.id, data: f, deleted });
    const recs: Record<string, unknown> = {
      a: rec(fb('FB-20260930-ab12-01')), b: rec(fb('FB-20260930-ab12-02', { status: '반영됨' })), c: rec(fb('FB-20260930-ab12-03', { text: '' })),
      d: rec(fb('FB-20260930-ab12-04'), true), e: rec(fb('FB-20260930-ab12-05')), f: { table: 'routines', id: 'r1', data: { id: 'r1' } },
    };
    writeFileSync(join(dir, 'feedback', 'processed', 'FB-20260930-ab12-05.json'), '{}');
    writeFileSync(join(dir, 'sync', 'db', 'records.json'), JSON.stringify({ recs }));
    const r = pullFeedback(dir);
    expect(r.written).toEqual(['FB-20260930-ab12-01']);
    expect(r.invalid).toBe(1);
    expect(readdirSync(join(dir, 'feedback', 'inbox'))).toEqual(['FB-20260930-ab12-01.json']);
    expect(JSON.parse(readFileSync(join(dir, 'feedback', 'inbox', 'FB-20260930-ab12-01.json'), 'utf8')).text).toBe('휴식 끝 소리가 작아요');
    expect(pullFeedback(dir).written).toEqual([]);
  });
  it('지운 메모의 번호는 다시 쓰지 않음 (지움 표시 ID까지 봄)', () => {
    const d = new Date(2026, 8, 30, 10);
    expect(newFeedbackId(d, 'ab12', usedFeedbackIds(['FB-20260930-ab12-01'], ['FB-20260930-ab12-02']))).toBe('FB-20260930-ab12-03');
  });
  it('반영됨은 옛 버전의 보류로 되돌리지 않음 (버전이 섞인 기기끼리 번갈아 바꾸지 않게)', () => {
    const out = applyChangelog([fb('FB-20260930-ab12-01', { status: '반영됨', note: '0.7.0 에 반영' })], [{ version: '0.6.0', deferred: [{ id: 'FB-20260930-ab12-01', reason: '나중에' }] }]);
    expect(out).toEqual([]);
  });
  it('서버 바꾸기: 보낸 기기가 모르는 표(예: 0.5.0의 feedback)는 남김, 아는 표는 교체', () => {
    const st = emptyState();
    st.recs['feedback/FB-1'] = { table: 'feedback', id: 'FB-1', data: { id: 'FB-1' }, hlc: 'h', dev: 'A', rev: 1 };
    st.recs['routines/r1'] = { table: 'routines', id: 'r1', data: { id: 'r1' }, hlc: 'h', dev: 'A', rev: 2 };
    st.rev = 2;
    const old = replaceState(st, [{ table: 'routines', id: 'r2', data: { id: 'r2' }, hlc: 'h', dev: 'B', rev: 0 }]);
    expect(Object.keys(old.recs).sort()).toEqual(['feedback/FB-1', 'routines/r2']);
    const neu = replaceState(st, [], ['routines', 'workouts', 'meta', 'custom', 'settings', 'bodyweight', 'feedback']);
    expect(Object.keys(neu.recs)).toEqual([]);
    expect(old.rev).toBeGreaterThan(st.rev);
  });
  it('feedback:pull: 정해진 칸만 옮기고, records.json이 깨졌으면 안내 오류', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fbpull2-'));
    mkdirSync(join(dir, 'sync', 'db'), { recursive: true });
    writeFileSync(join(dir, 'sync', 'db', 'records.json'), JSON.stringify({ recs: { a: { table: 'feedback', id: 'FB-20260930-ab12-01', data: { ...fb('FB-20260930-ab12-01'), _s: { h: 'x' }, extra: 'secret' } } } }));
    pullFeedback(dir);
    const out = JSON.parse(readFileSync(join(dir, 'feedback', 'inbox', 'FB-20260930-ab12-01.json'), 'utf8'));
    expect(Object.keys(out).sort()).toEqual(['createdAt', 'id', 'screen', 'status', 'text']);
    writeFileSync(join(dir, 'sync', 'db', 'records.json'), '{"recs": {');
    expect(() => pullFeedback(dir)).toThrow(/records.json을 읽지 못했어요/);
  });
});
