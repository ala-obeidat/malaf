import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: 'go run .',
      cwd: '../backend',
      url: 'http://127.0.0.1:8081/api/health',
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        MALAF_ADDR: '127.0.0.1:8081',
        MALAF_FILES_DIR: './.e2e/files',
        MALAF_CLAIMED_DIR: './.e2e/claimed',
        MALAF_UPLOADS_PER_HOUR: '1000'
      }
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      timeout: 30_000,
      reuseExistingServer: !process.env.CI
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
