import '@testing-library/jest-dom/vitest';
import en from '../locales/en.json';
import sv from '../locales/sv.json';
import { __testInjectLocale } from '../utils/i18n';

// Production loads en/sv lazily via fetch; in jsdom tests there's no asset
// server, so preload them synchronously here. Production bundles do not
// include this file, so the static JSON imports stay test-only.
__testInjectLocale('en', en as Record<string, string>);
__testInjectLocale('sv', sv as Record<string, string>);
