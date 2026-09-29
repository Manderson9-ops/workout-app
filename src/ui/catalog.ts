/**
 * 앱에서 쓰는 운동 목록: 기본 종목 + WORK_OUT_K 등급·자세 포인트 + 앱 추천 순서 + 사용자 추가 운동
 */
import baseFile from '../../data/exercises.base.json';
import wkFile from '../../data/exercises.workout_k.json';
import stapleFile from '../../data/staples.json';
import familyFile from '../../data/families.json';
import { buildExercises } from '../core/exercises';
import type { WorkoutKData } from '../core/exercises';
import type { BuiltExercise, Exercise, Part } from '../core/types';
import type { CustomExercise } from '../db/db';

const builtBase = buildExercises(baseFile.exercises as Exercise[], wkFile as unknown as WorkoutKData, stapleFile.order as Partial<Record<Part, string[]>>);

export const families: Record<string, string> = familyFile.families;
export const templates = (wkFile as unknown as { templates: { id: string; name: string; days: Part[][]; generatable: boolean; grades: { value: string; levels: string[]; sub_goal_only?: boolean; purpose_note?: string }[] }[] }).templates;
export const sourceVideos = (wkFile as unknown as { source_videos: { video_id: string; title: string; channel: string }[] }).source_videos;

let cacheKey = '';
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
