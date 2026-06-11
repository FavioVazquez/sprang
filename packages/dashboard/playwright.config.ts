import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // bridge.spec.ts needs mock platform CLIs on PATH — it runs under
  // playwright.bridge.config.ts (pnpm test:e2e:bridge) instead.
  testIgnore: /bridge\.spec\.ts/,
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
