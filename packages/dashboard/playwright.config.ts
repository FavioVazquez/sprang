import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : '50%',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'pnpm preview --port 4173 --host',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
