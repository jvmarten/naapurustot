import '@testing-library/jest-dom/vitest';
import en from '../locales/en.json';
import sv from '../locales/sv.json';
import fiExtra from '../locales/fi-extra.json';
import { __testInjectLocale, __testInjectFiExtra } from '../utils/i18n';

// Production loads en/sv lazily via fetch; in jsdom tests there's no asset
// server, so preload them synchronously here. Production bundles do not
// include this file, so the static JSON imports stay test-only.
__testInjectLocale('en', en as Record<string, string>);
__testInjectLocale('sv', sv as Record<string, string>);
// IN-7: page-only fi strings live in fi-extra.json (a lazy ?url asset in prod);
// inject them synchronously so page-component tests resolve fi headings.
__testInjectFiExtra(fiExtra as Record<string, string>);
