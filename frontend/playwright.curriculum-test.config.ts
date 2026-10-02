import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../tests/curriculum-e2e',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4202',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env['CURRICULUM_TEST_CHROME'] || undefined,
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4202',
    url: 'http://127.0.0.1:4202',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
