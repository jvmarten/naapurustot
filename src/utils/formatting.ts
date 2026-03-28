/** Formatting utilities for displaying numbers, currencies, and percentages. */

import { getLang } from './i18n';

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function locale(): string {
  return getLang() === 'en' ? 'en-US' : 'fi-FI';
}

/** Format a number with locale-appropriate thousand separators. Returns '—' for null/undefined. */
export function formatNumber(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return n.toLocaleString(locale());
}

/** Format a number as euros with locale-appropriate formatting. Returns '—' for null/undefined. */
export function formatEuro(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toLocaleString(locale())} €`;
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

/** Return a Tailwind text color class (green or red) based on whether the value beats the average. */
export function diffColor(value: number | string | null, avg: number | string | null, higherIsBetter = true): string {
  const a = toNum(value);
  const b = toNum(avg);
  if (a == null || b == null) return 'text-surface-400';
  const diff = a - b;
  const positive = higherIsBetter ? diff >= 0 : diff <= 0;
  return positive ? 'text-emerald-400' : 'text-rose-400';
}
