import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newFeedbackId, feedbackOk, applyChangelog } from '../src/core/feedback';
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
});
