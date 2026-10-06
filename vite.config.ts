import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVersionInfo } from './src/core/changelog.ts';
import type { ChangelogEntry } from './src/core/changelog.ts';
import { buildSw, buildId } from './tools/sw_build.ts';

/**
 * D-055: 빌드 때 version.json 생성 (dist/ 와 dist-next/ 맨 위). 버전·날짜·이번 버전 바뀐 점 최대 5줄·where 만 (비밀 없음).
 * 앱은 새 서비스 워커가 기다릴 때 이 파일을 cache:'no-store' 로 읽어 "새 버전 0.9.1 준비됨 · 바뀐 점" 배너를 띄운다. sw.js 는 이 파일을 저장하지 않음.
 * package.json 버전과 CHANGELOG.json 맨 위 버전이 다르면 빌드 실패.
 */
function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
      const cl = JSON.parse(readFileSync(new URL('./CHANGELOG.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')) as { versions: ChangelogEntry[] };
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(buildVersionInfo(pkg.version, cl.versions), null, 2) + '\n' });
      // D-055 검토 A1: sw.js 를 틀에서 만들어 빌드 이름(버전+파일 해시)을 넣음 → 배포마다 내용이 달라져 새 서비스 워커가 설치됨
      const tpl = readFileSync(new URL('./src/sw.template.js', import.meta.url), 'utf8');
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js' && f !== 'version.json');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: buildSw(tpl, buildId(pkg.version, files), files.filter((f) => f.startsWith('assets/'))) });
    },
  };
}

/**
 * 성능 관문 (BLUEPRINT 7, 0.9.3): WORK_OUT_K 데이터를 둘로 나눠 첫 화면 JS 를 줄인다. 데이터 파일은 그대로 (빌드 때만 나눔).
 * - virtual:wk-light  = 등급·템플릿·영상 목록·조합 (첫 화면 묶음에 들어감, 작음)
 * - virtual:wk-guides = 자세 포인트(가장 큼). 종목·운동·플랜 등 자세히 보는 화면을 열 때 따로 받음 (ensureFullCatalog)
 * JSON.parse(문자열) 로 내보냄: 큰 객체 리터럴보다 브라우저가 빨리 읽음
 */
function wkSplit(): Plugin {
  const LIGHT = 'virtual:wk-light', GUIDES = 'virtual:wk-guides';
  const file = new URL('./data/exercises.workout_k.json', import.meta.url);
  return {
    name: 'wk-split',
    resolveId(id) { return id === LIGHT || id === GUIDES ? '\0' + id : undefined; },
    load(id) {
      if (id !== '\0' + LIGHT && id !== '\0' + GUIDES) return undefined;
      this.addWatchFile(fileURLToPath(file));
      const j = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
      const { guides, unapplied: _u, _note: _n, ...light } = j;
      const out = id === '\0' + LIGHT ? light : guides;
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(out))});`;
    },
  };
}

// GitHub Pages 주소: https://manderson9-ops.github.io/workout-app/
export default defineConfig({
  base: '/workout-app/',
  plugins: [preact(), versionJson(), wkSplit()],
  test: {
    // 커버리지 계측 중에는 코드가 2~3배 느려지므로 시간 측정 관문은 계측 없는 실행(npm run test:plans)에서만 판정
    env: { COVERAGE_RUN: process.argv.includes('--coverage') ? '1' : '' },
    include: process.env.SAMPLES_OUT ? ['tools/**/*.gen.ts'] : ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'reports/coverage',
    },
  },
});

