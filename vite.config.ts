import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// GitHub Pages 주소: https://manderson9-ops.github.io/workout-app/
export default defineConfig({
  base: '/workout-app/',
  plugins: [preact()],
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

