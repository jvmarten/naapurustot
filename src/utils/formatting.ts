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

function localeTag(): string {
  // PO-7: Swedish must map to sv-SE, not silently fall through to fi-FI — this
  // matches the sv-SE tag the prerender/SEO scripts already use so the runtime
  // app and its prerendered pages format numbers identically.
  const lang = getLang();
  return lang === 'en' ? 'en-US' : lang === 'sv' ? 'sv-SE' : 'fi-FI';
}

function getNumberFormatter(): Intl.NumberFormat {
  const loc = localeTag();
  if (cachedNumberFmt && cachedLocale === loc) return cachedNumberFmt;
  cachedLocale = loc;
  cachedNumberFmt = new Intl.NumberFormat(loc);
  return cachedNumberFmt;
}

// PO-2: cached fixed-decimal formatters per (locale, decimals). Routing the
// `toFixed`-based formatters (percentages, diffs, YTL mean) through Intl makes
// FI/SV render "12,3 %" with a comma, matching the rest of the locale-formatted
// UI and the prerendered pages — instead of the en-only "12.3 %". Keyed by
// locale so a language switch never returns a stale formatter; bounded (3 locales
// × a couple of decimal counts).
const fixedFmtCache = new Map<string, Intl.NumberFormat>();
function getFixedFormatter(decimals: number): Intl.NumberFormat {
  const key = `${localeTag()}:${decimals}`;
  let fmt = fixedFmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(localeTag(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    fixedFmtCache.set(key, fmt);
  }
  return fmt;
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

/** Format a number as a percentage (e.g., FI "12,3 %", EN "12.3 %"). Returns '—' for null/undefined. */
export function formatPct(v: number | string | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n == null) return '—';
  // Locale separator via Intl, but a predictable ASCII "-" for negatives (Intl's
  // fi-FI would emit U+2212) — consistent with formatDiff and the rest of the app.
  const sign = n < 0 ? '-' : '';
  return `${sign}${getFixedFormatter(decimals).format(Math.abs(n))} %`;
}

/**
 * Format a number with a fixed decimal count in the active locale ("48,0" in
 * fi/sv, "48.0" in en). Use instead of `.toFixed()` anywhere the result is
 * shown to the user: toFixed always emits a dot, so a Finnish page ends up
 * mixing "48.0 v" with the Intl-formatted "39,7 %" right beside it.
 */
export function formatDecimal(v: number | string | null | undefined, decimals = 1): string {
  const n = toNum(v);
  if (n == null) return '—';
  // ASCII "-" rather than Intl's fi-FI U+2212, matching formatPct/formatDiff.
  const sign = n < 0 ? '-' : '';
  return `${sign}${getFixedFormatter(decimals).format(Math.abs(n))}`;
}

/** Format the difference between a value and average with a +/- sign (locale decimals). */
export function formatDiff(value: number | string | null, avg: number | string | null): string {
  const a = toNum(value);
  const b = toNum(avg);
  if (a == null || b == null) return '';
  const diff = a - b;
  // Format the magnitude through Intl and add an ASCII sign ourselves, so the
  // separator is locale-correct while the sign stays a predictable "+"/"-".
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  return `${sign}${getFixedFormatter(1).format(Math.abs(diff))}`;
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

/**
 * Format a number as density (e.g., "1 234 /km²"). Uses cached Intl.NumberFormat.
 *
 * Whole numbers are right for population density in a town, but NOT below 1: Inari
 * Keskus holds 1,194 residents over 3,423 km², a real 0.35/km², and rounding printed
 * "0 /km²" for an inhabited area — 177 of them nationally. Sub-1 keeps two significant
 * digits; everything at or above 1 rounds exactly as before.
 */
export function formatDensity(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) return `${getSigFormatter().format(n)} /km²`;
  return `${getNumberFormatter().format(Math.round(n))} /km²`;
}

// Two-significant-digit formatter, cached per locale — the sub-1 branch of
// formatFineDensity below.
const sigFmtCache = new Map<string, Intl.NumberFormat>();
function getSigFormatter(): Intl.NumberFormat {
  const loc = localeTag();
  let fmt = sigFmtCache.get(loc);
  if (!fmt) {
    fmt = new Intl.NumberFormat(loc, { maximumSignificantDigits: 2 });
    sigFmtCache.set(loc, fmt);
  }
  return fmt;
}

/**
 * Format a fine-grained per-km² density (e.g. "13,8 /km²", "0,4 /km²").
 *
 * Service and transit densities span 0.0001–237/km², so `formatDensity`'s
 * whole-number rounding is wrong for them: it renders a real 0.4 stops/km² as
 * "0" — 1,379 of the 3,018 areas for transit stops alone, the same false zero
 * the data pipeline stores 4 decimals to avoid. Below 1 this keeps two
 * significant digits instead, matching the map legend's `density` formatter
 * (colorScales.ts) so the profile page and the map agree.
 */
export function formatFineDensity(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${formatFineNumber(n)} /km²`;
}

/**
 * The bare number `formatFineDensity` prints, for surfaces whose label already
 * carries the unit (the CSV/PDF export's "(/km²)" columns, the wizard's fit
 * reasons). Same rule, one implementation — a second `toFixed(1)` copy is how
 * six correctly-stored 4-decimal columns came to render as "0,0" in the panel.
 */
export function formatFineNumber(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  const abs = Math.abs(n);
  return (abs > 0 && abs < 1 ? getSigFormatter() : getFixedFormatter(1)).format(n);
}

/** Format a number as €/m² (e.g., "3 500 €/m²"). Uses cached Intl.NumberFormat. */
export function formatEuroSqm(v: number | string | null | undefined): string {
  const n = toNum(v);
  if (n == null) return '—';
  return `${getNumberFormatter().format(n)} €/m²`;
}

/** Return a Tailwind text color class (green or red) based on whether the value beats the average. */
export function diffColor(value: number | string | null, avg: number | string | null, higherIsBetter: boolean | null = true): string {
  const a = toNum(value);
  const b = toNum(avg);
  // A11y: light-mode shades meet WCAG AA on the light card background (the 400 shades
  // are ~1.75–2.8:1 and fail); the dark: variants keep the brighter shade on dark bg.
  if (a == null || b == null) return 'text-surface-600 dark:text-surface-400';
  // PO-1: a null direction means there is no objective "better" (e.g. price — a
  // seller wants high, a buyer wants low), so show it neutral with no +/− color.
  if (higherIsBetter === null) return 'text-surface-600 dark:text-surface-400';
  const diff = a - b;
  const positive = higherIsBetter ? diff >= 0 : diff <= 0;
  return positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400';
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
  // The scale skips 1 (I=0 jumps straight to A=2). Rounding in formatYtlGrade can
  // produce a computed index of 1 within the I→A gap; map it up to the next real
  // grade (A) so the gap renders as "A"/"A-" instead of a placeholder dash.
  const idx = n === 1 ? 2 : n;
  return YTL_GRADE_LETTERS[idx] ?? '—';
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
  return `${formatYtlGrade(n)} (${getFixedFormatter(2).format(mean)})`;
}

/**
 * Normalize a `schools` feature property into an array.
 *
 * MapLibre's vector-tile pipeline (used when reading feature.properties from
 * a tile-rendered source like GeoJSON/TopoJSON) only supports scalar values,
 * so array/object properties come back as JSON-encoded strings. Code that
 * looks up features directly from the JSON source sees real arrays. This
 * helper accepts either shape and returns the array (or null).
 */
export function parseSchools(value: unknown): Array<{ name: string; score: number }> | null {
  if (!value) return null;
  if (Array.isArray(value)) return value as Array<{ name: string; score: number }>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
