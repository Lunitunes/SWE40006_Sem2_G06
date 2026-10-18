import { defineConfig, devices } from '@playwright/test';

// Runs against an already-running app, so the same suite tests local, CI and the EC2 servers:
//   BASE_URL=http://13.239.43.240:3000 E2E_ADMIN_PASSWORD=... pnpm test
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

// Fake camera for the in-page camera tests: Chromium serves a generated test pattern and grants
// the permission prompt automatically
const fakeCamera = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// CI uses Playwright's own Chromium (`playwright install chromium`). Locally you can skip that
// download and drive an installed browser instead: PLAYWRIGHT_CHANNEL=msedge (or chrome)
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // No retries: a test that only passes on retry is a flaky test, and the brief's flake target is < 1%
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // For testing HTTPS locally with a self-signed certificate (e.g. Caddy's internal CA)
    ignoreHTTPSErrors: !!process.env.E2E_IGNORE_HTTPS_ERRORS,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The brief: "accessible through mobile and desktop browsers"
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel, permissions: ['camera'], launchOptions: { args: fakeCamera } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel, permissions: ['camera'], launchOptions: { args: fakeCamera } },
    },
  ],
});
