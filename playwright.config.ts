import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'html',
  /* Abort the entire run if it exceeds 7 minutes (prevents CI hangs). Raised from
   * 5 min when IN-7 added the mobile-a11y project (a few extra axe scans). */
  globalTimeout: 420_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Pin the locale to Finnish (the product default) so i18n-dependent assertions
    // are deterministic. Required since O2 added navigator.language auto-detection:
    // without this, the runner's en-US locale would flip the UI to English and break
    // every test that asserts Finnish chrome ("Aineistot", "Vertailu", "Suodata", …).
    locale: 'fi-FI',
  },
  /* Screenshot comparison settings for visual regression tests */
  expect: {
    toHaveScreenshot: {
      /* Animations can cause flaky diffs — disable them for screenshots */
      animations: 'disabled',
      /* Ignore anti-aliasing differences across render backends */
      threshold: 0.3,
    },
  },
  projects: [
    {
      name: 'e2e',
      testDir: './e2e',
      // mobile-a11y runs only in the dedicated touch project below.
      testIgnore: ['**/visual/**', '**/mobile-a11y.spec.ts'],
      use: {
        browserName: 'chromium',
      },
    },
    {
      // IN-7: phone viewport with touch, so the bottom-sheet / mobile-only UI
      // (which Lighthouse and the desktop e2e project never reach) is axe-scanned.
      name: 'mobile',
      testMatch: ['**/mobile-a11y.spec.ts'],
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'visual',
      testDir: './e2e/visual',
      use: {
        browserName: 'chromium',
        /* Fixed viewport for deterministic screenshots */
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
