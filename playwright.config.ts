import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
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
      testIgnore: ['**/visual/**'],
      use: {
        browserName: 'chromium',
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
