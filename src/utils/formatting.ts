/**
 * Formatting utilities for displaying numbers, currencies, and percentages.
 *
 * All functions accept null/undefined/string inputs and return '—' for missing values.
 * Intl.NumberFormat instances are cached per locale to avoid reconstruction on the
 * tooltip hot path (~60Hz mousemove).
 */

import { getLang } from './i18n';

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// Cache Intl.NumberFormat instances per locale to avoid recreating them on every
// format call. Construction is ~10-50x more expensive than calling .format().
// This matters on the tooltip hot path (mousemove at ~60Hz) and panel renders
// (~20+ format calls per panel). The cache is invalidated on language change.
let cachedLocale = '';
let cachedNumberFmt: Intl.NumberFormat | null = null;

function getNumberFormatter(): Intl.NumberFormat {
  const loc = getLang() === 'en' ? 'en-US' : 'fi-FI';
  if (cachedNumberFmt && cachedLocale === loc) return cachedNumberFmt;
  cachedLocale = loc;
  cachedNumberFmt = new Intl.NumberFormat(loc);
  return cachedNumberFmt;
}

/** Format a number with locale-appropriate thousand separators. Returns '—' for null/undefined. */
export function formatNumber(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return getNumberFormatter().format(n);
}

/** Format a number as euros with locale-appropriate formatting. Returns '—' for null/undefined. */
export function formatEuro(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${getNumberFormatter().format(n)} €`;
}

/** Format a number as a percentage (e.g., "12.3 %"). Returns '—' for null/undefined. */
export function formatPct(v: number | string | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(decimals)} %`;
}

/** Format the difference between a value and average with a +/- sign. */
export function formatDiff(value: number | string | null, avg: number | string | null): string {
  const a = toNum(value);
  const b = toNum(avg);
  if (a == null || b == null) return '';
  const diff = a - b;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}`;
}

/** Escape a string for safe HTML embedding. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a number as density (e.g., "1 234 /km²"). Uses cached Intl.NumberFormat. */
export function formatDensity(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${getNumberFormatter().format(Math.round(n))} /km²`;
}

/** Format a number as €/m² (e.g., "3 500 €/m²"). Uses cached Intl.NumberFormat. */
export function formatEuroSqm(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${getNumberFormatter().format(n)} €/m²`;
}

/** Return a Tailwind text color class (green or red) based on whether the value beats the average. */
export function diffColor(value: number | string | null, avg: number | string | null, higherIsBetter = true): string {
  const a = toNum(value);
  const b = toNum(avg);
  if (a == null || b == null) return 'text-surface-400';
  const diff = a - b;
  const positive = higherIsBetter ? diff >= 0 : diff <= 0;
  return positive ? 'text-emerald-400' : 'text-rose-400';
}

// YTL matriculation grade letters by integer value. The scale skips 1 — it
// jumps from improbatur (I=0) straight to approbatur (A=2).
const YTL_GRADE_LETTERS: Record<number, string> = {
  0: 'I',
  2: 'A',
  3: 'B',
  4: 'C',
  5: 'M',
  6: 'E',
  7: 'L',
};

function ytlLetter(n: number): string {
  return YTL_GRADE_LETTERS[n] ?? '—';
}

/**
 * Convert a 0-100 school_quality_score back to its YTL matriculation letter
 * grade with +/-/½ modifier (e.g. 73.4 → "M+", because 73.4/100 × 7 = 5.14,
 * which is just above magna cum laude).
 */
export function formatYtlGrade(value: number | string | null | undefined): string {
  const n = toNum(value);
  if (n == null) return '—';
  const mean = (Math.max(0, Math.min(100, n)) / 100) * 7;
  const lower = Math.floor(mean);
  const frac = mean - lower;
  if (frac < 0.1) return ytlLetter(lower);
  if (frac < 0.4) return `${ytlLetter(lower)}+`;
  if (frac < 0.7) return `${ytlLetter(lower)}½`;
  if (frac < 0.85) return `${ytlLetter(lower + 1)}-`;
  return ytlLetter(lower + 1);
}

/** YTL grade with the underlying mean grade on the 0-7 scale, e.g. "M+ (5.14)". */
export function formatYtlGradeFull(value: number | string | null | undefined): string {
  const n = toNum(value);
  if (n == null) return '—';
  const mean = (Math.max(0, Math.min(100, n)) / 100) * 7;
  return `${formatYtlGrade(n)} (${mean.toFixed(2)})`;
}
