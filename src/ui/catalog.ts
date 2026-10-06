/**
 * 앱에서 쓰는 운동 목록: 기본 종목 + WORK_OUT_K 등급·자세 포인트 + 앱 추천 순서 + 사용자 추가 운동
 */
import baseFile from '../../data/exercises.base.json';
import wkFile from 'virtual:wk-light';
import stapleFile from '../../data/staples.json';
import familyFile from '../../data/families.json';
import { buildExercises } from '../core/exercises';
import type { WorkoutKData } from '../core/exercises';
import type { BuiltExercise, Exercise, GuideItem, Part } from '../core/types';
import type { CustomExercise } from '../db/db';

/**
 * 첫 화면(홈)에는 가벼운 목록(자세 포인트 없음, guide: [])을 쓰고, 자세 포인트는 ensureFullCatalog() 로 따로 받는다 (0.9.3 성능 관문).
 * 이름·부위·장비·등급·순서는 두 목록이 같다 (tests/catalog.test.ts). 홈 말고 다른 화면은 열리기 전에 ensureFullCatalog() 를 기다리므로
 * 그 화면에서 catalog() 는 늘 전체 목록이다 (App.tsx 의 lazyScreen).
 */
const build = (guides: Record<string, GuideItem[]>) =>
  buildExercises(baseFile.exercises as Exercise[], { ...(wkFile as unknown as WorkoutKData), guides }, stapleFile.order as Partial<Record<Part, string[]>>);
let builtBase = build({});
let full = false;
let fullP: Promise<void> | null = null;
/** 자세 포인트까지 든 전체 목록을 받아 catalog() 가 그것을 돌려주게 함 (한 번만 받음, 실패하면 다음에 다시) */
export function ensureFullCatalog(): Promise<void> {
  fullP ??= import('virtual:wk-guides').then((m) => { builtBase = build(m.default); full = true; cacheKey = '\u0000'; })
    .catch((e: unknown) => { fullP = null; throw e; });
  return fullP;
}
export const isFullCatalog = () => full;

export const families: Record<string, string> = familyFile.families;
export const templates = (wkFile as unknown as { templates: { id: string; name: string; days: Part[][]; generatable: boolean; grades: { value: string; levels: string[]; sub_goal_only?: boolean; purpose_note?: string }[] }[] }).templates;
export const sourceVideos = (wkFile as unknown as { source_videos: { video_id: string; title: string; channel: string }[] }).source_videos;

let cacheKey = '\u0000';
let cache: BuiltExercise[] = builtBase;
export function catalog(custom: CustomExercise[]): BuiltExercise[] {
  const key = custom.map((c) => c.id).join(',');
  if (key !== cacheKey) {
    cacheKey = key;
    cache = [...builtBase, ...custom.map((c) => ({ ...c, grades: [], guide: [] }))];
  }
  return cache;
}

export const videoUrl = (id: string, ts?: string) => {
  if (!ts) return `https://www.youtube.com/watch?v=${id}`;
  const [m, s] = ts.split(':').map(Number);
  return `https://www.youtube.com/watch?v=${id}&t=${(m ?? 0) * 60 + (s ?? 0)}s`;
};
