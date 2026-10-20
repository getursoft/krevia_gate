import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real API (against the isolated `krevia_e2e_test`
 * database, reset and seeded in global-setup) and the real website.
 */
export const E2E = {
  apiPort: 4110,
  webPort: 3110,
  databaseUrl: process.env.E2E_DATABASE_URL ?? `postgresql://${process.env.USER}@localhost:5432/krevia_e2e_test`,
  adminPhone: '9000000009',
  adminPassword: 'AdminE2E123',
  guardPhone: '9000000010',
  guardPassword: 'GuardE2E123',
};

/** PW_CHANNEL: `chrome` (default locally: installed Google Chrome) or `bundled` (Playwright's Chromium, used in CI). */
const pwChannel = process.env.PW_CHANNEL ?? (process.env.CI ? 'bundled' : 'chrome');
const channel = pwChannel === 'bundled' ? undefined : pwChannel;
const webOrigin = `http://localhost:${E2E.webPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], channel }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], channel }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @krevia/api build && node ../api/dist/main.js',
      url: `http://localhost:${E2E.apiPort}/api/v1/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(E2E.apiPort),
        DATABASE_URL: E2E.databaseUrl,
        CORS_ORIGINS: webOrigin,
        AUTH_RATE_LIMIT: '1000',
      },
    },
    {
      command: `next dev -p ${E2E.webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 180_000,
      // Own build dir, so a developer's `pnpm dev:web` on :3100 keeps working during tests.
      env: { API_URL: `http://localhost:${E2E.apiPort}`, NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: '.next-e2e' },
    },
  ],
});
