/** 빌드 때 data/exercises.workout_k.json 을 나눈 가상 모듈 (vite.config.ts wkSplit) */
declare module 'virtual:wk-light' {
  const light: { grades: Record<string, unknown>; templates: unknown; source_videos: unknown; combos: unknown };
  export default light;
}
declare module 'virtual:wk-guides' {
  import type { GuideItem } from './core/types';
  const guides: Record<string, GuideItem[]>;
  export default guides;
}
