import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// GitHub Pages 주소: https://manderson9-ops.github.io/workout-app/
export default defineConfig({
  base: '/workout-app/',
  plugins: [preact()],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'reports/coverage',
    },
  },
});

