import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../tests/local-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4206',
    launchOptions: process.env['LOCAL_PROCESSOR_BROWSER_EXECUTABLE']
      ? { executablePath: process.env['LOCAL_PROCESSOR_BROWSER_EXECUTABLE'] }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'local-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'local-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run start -- --host 127.0.0.1 --port 4206',
      url: 'http://127.0.0.1:4206',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `${process.platform === 'win32' ? 'py -3.12' : 'python'} ../tests/local-processor-fixture-server.py`,
      url: 'http://127.0.0.1:43127/v1/health',
      headers: { Origin: 'http://127.0.0.1:4206' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
