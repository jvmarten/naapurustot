/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Mirror the production `__BUILD_DATE__` define (vite.config.ts) so components
  // that reference it (SettingsDropdown) don't hit an undefined global under test.
  // Tests don't assert on the freshness date, so an empty string is sufficient.
  define: {
    __BUILD_DATE__: JSON.stringify(''),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // IN-5: coverage only runs when --coverage is passed (npm run test:coverage / CI gate).
    // The default `npm run test` stays fast and uncovered. The CI ratchet step compares the
    // generated coverage/coverage-summary.json against the committed coverage-baseline.json.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      // Only instrument application source. Tests, type-only modules, the prerender-only
      // entrypoint, and generated/locale data carry no meaningful runtime-coverage signal.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/__tests__/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/*.d.ts',
        'src/locales/**',
      ],
      all: true,
    },
  },
});
