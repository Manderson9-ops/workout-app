import { defineConfig, devices } from '@playwright/test';

/**
 * 화면 테스트 (BLUEPRINT 7.1 헬스장 사용성, 7.2 관문 1).
 * iPhone 13 (390×844) 에뮬레이션: WebKit(사파리 엔진) + Chromium. 실제 아이폰 확인은 7.4 체크리스트.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4321/workout-app/', trace: 'off' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --port 4321 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4321/workout-app/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
