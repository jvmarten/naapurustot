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
    // PO-2: mirror the production `__COVERAGE_PCT__` define (vite.config.ts) so the
    // coverage helper resolves under test. A small slice of the real build_metadata.json
    // coverage values is sufficient — tests assert the helper plumbing, not every metric.
    __COVERAGE_PCT__: JSON.stringify({
      quality_index: 100,
      hr_mtu: 97.5,
      transit_stop_density: 10.9,
      school_quality_score: 10.3,
      property_price_sqm: 30.3,
      rental_price_sqm: 15.7,
    }),
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
