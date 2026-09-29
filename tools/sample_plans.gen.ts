/**
 * 샘플 플랜 문서 생성 (P2 사용자 확인용). 실행: npm run samples  (SAMPLES_OUT 경로에 markdown 저장)
 * vitest로 실행하는 이유: src 모듈을 확장자 없이 import 하기 위함.
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import baseFile from '../data/exercises.base.json';
import wkFile from '../data/exercises.workout_k.json';
import stapleFile from '../data/staples.json';
import { buildExercises } from '../src/core/exercises';
import type { WorkoutKData } from '../src/core/exercises';
import { generatePlan } from '../src/core/planner';
import type { PlanRequest } from '../src/core/planner';
import { validatePlan } from '../src/core/validatePlan';
import type { Exercise, Part } from '../src/core/types';

const all = buildExercises(baseFile.exercises as Exercise[], wkFile as unknown as WorkoutKData, stapleFile.order as Partial<Record<Part, string[]>>);
const mmss = (s: number) => `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
const PR = { high: '높음', normal: '보통', low: '낮음' } as const;

const samples: { title: string; req: PlanRequest }[] = [
  { title: '등 + 삼두, 60분, 슈퍼세트 허용', req: { parts: [{ part: '등', priority: 'high' }, { part: '삼두', priority: 'normal' }], level: '중급', minGrade: 'A-', targetMinutes: 60, groupings: ['superset'] } },
  { title: '등 + 삼두, 45분, 슈퍼세트 허용', req: { parts: [{ part: '등', priority: 'high' }, { part: '삼두', priority: 'normal' }], level: '중급', minGrade: 'A-', targetMinutes: 45, groupings: ['superset'] } },
  { title: '가슴 + 등 (몸통-말단-하체 1일차), 45분, 슈퍼세트 허용', req: { parts: [{ part: '가슴', priority: 'high' }, { part: '등', priority: 'high' }], level: '중급', targetMinutes: 45, groupings: ['superset'] } },
  { title: '가슴 + 어깨 + 삼두 (밀기), 60분', req: { parts: [{ part: '가슴', priority: 'high' }, { part: '어깨', priority: 'normal' }, { part: '삼두', priority: 'low' }], level: '중급', targetMinutes: 60 } },
  { title: '하체 + 코어, 50분', req: { parts: [{ part: '하체', priority: 'high' }, { part: '코어', priority: 'low' }], level: '중급', targetMinutes: 50 } },
  { title: '삼두만, 20분, 컴파운드 세트 허용', req: { parts: [{ part: '삼두', priority: 'high' }], level: '중급', targetMinutes: 20, groupings: ['compound'] } },
  { title: '등 + 이두, 30분, 초보', req: { parts: [{ part: '등', priority: 'high' }, { part: '이두', priority: 'normal' }], level: '초보', targetMinutes: 30, groupings: ['superset'] } },
  { title: '무분할 전신 (하체·등·가슴·어깨·삼두·이두), 70분, 슈퍼세트 허용', req: { parts: [{ part: '하체', priority: 'high' }, { part: '등', priority: 'high' }, { part: '가슴', priority: 'normal' }, { part: '어깨', priority: 'normal' }, { part: '삼두', priority: 'low' }, { part: '이두', priority: 'low' }], level: '중급', targetMinutes: 70, groupings: ['superset'] } },
];

it('샘플 플랜 생성', () => {
  const out = process.env.SAMPLES_OUT;
  const L: string[] = ['# P2 샘플 플랜 (사용자 확인용)', '', '실제 앱 데이터로 플랜 생성기를 돌린 결과입니다. 횟수는 운동별 기본 범위의 가운데, 시간은 BLUEPRINT 5.6 기본값(1회 3초, 세팅 20초, 휴식 다관절 150초·단관절 90초 등)으로 계산했습니다.', '', '확인해 주실 것: 운동 선택이 납득되는지, 세트·휴식·시간이 현실적인지, 이유 문구가 이해되는지.', ''];
  samples.forEach((s, n) => {
    const p = generatePlan(s.req, all);
    const errs = validatePlan(p, s.req, all);
    if (errs.length) throw new Error(`${s.title}: ${errs.join('; ')}`);
    L.push(`## ${n + 1}. ${s.title}`, '');
    L.push(`- 입력: ${s.req.parts.map((x) => `${x.part}(${PR[x.priority]})`).join(', ')} / 수준 ${s.req.level} / 최소 등급 ${s.req.minGrade ?? 'B'} / 목표 ${s.req.targetMinutes ?? '-'}분${s.req.groupings?.length ? ' / 묶음: ' + s.req.groupings.map((g) => (g === 'superset' ? '슈퍼세트' : '컴파운드 세트')).join(', ') : ''}`);
    L.push(`- 결과: **예상 ${mmss(p.estimatedSec)}**${p.status !== 'ok' ? ` (${p.status})` : ''}, ${p.warmup.label}, 휴식 다관절 ${p.rest.compound}초 · 단관절 ${p.rest.isolation}초 · 묶음 라운드 후 ${p.rest.round}초`, '');
    L.push('| 순서 | 방식 | 운동 | 세트×횟수 | 등급 (근거) | 블록 시간 |', '|---|---|---|---|---|---|');
    p.blocks.forEach((b, i) => {
      const kind = b.kind === 'single' ? '일반' : b.kind === 'superset' ? '슈퍼세트' : '컴파운드';
      L.push(`| ${i + 1} | ${kind} | ${b.items.map((x) => x.name).join(' + ')} | ${b.items.map((x) => `${x.sets}×${x.reps}`).join(' + ')} | ${b.items.map((x) => x.why).join(' / ').replace(/\|/g, '/')} | ${mmss(b.timeSec)} |`);
    });
    L.push('', '이유:', ...p.reasons.map((r) => `- ${r}`), '');
  });
  if (out) writeFileSync(out, L.join('\n') + '\n', 'utf8');
});
