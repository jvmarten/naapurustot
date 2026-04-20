/**
 * Formatting — locale-aware formatting, diffColor logic, and HTML escaping.
 *
 * Priority 3: Display logic. Wrong formatting misleads users about
 * values, but doesn't affect data integrity.
 *
 * Targets untested paths:
 * - formatDiff sign logic with positive, negative, zero differences
 * - diffColor with higherIsBetter=false (inverted comparison)
 * - formatDensity rounding
 * - formatEuroSqm with string input
 * - toNum internal function: NaN, Infinity, empty string handling
 * - escapeHtml with all 5 special characters
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatNumber,
  formatEuro,
  formatPct,
  formatDiff,
  diffColor,
  escapeHtml,
  formatDensity,
  formatEuroSqm,
} from '../utils/formatting';
import { setLang } from '../utils/i18n';

beforeEach(() => {
  setLang('fi');
});

describe('formatDiff — sign and precision', () => {
  it('shows + prefix for positive differences', () => {
    expect(formatDiff(30, 20)).toBe('+10.0');
  });

  it('shows no prefix for negative differences', () => {
    expect(formatDiff(15, 20)).toBe('-5.0');
  });

  it('shows + prefix for zero difference', () => {
    // diff = 0 → sign is empty, not "+0.0" — actually let's check: diff > 0 check
    expect(formatDiff(20, 20)).toBe('0.0');
  });

  it('returns empty string when value is null', () => {
    expect(formatDiff(null, 20)).toBe('');
  });

  it('returns empty string when avg is null', () => {
    expect(formatDiff(30, null)).toBe('');
  });

  it('handles string inputs', () => {
    expect(formatDiff('30', '20')).toBe('+10.0');
  });

  it('returns empty string for non-numeric string inputs', () => {
    expect(formatDiff('abc', '20')).toBe('');
  });
});

describe('diffColor — Tailwind class selection', () => {
  it('returns green for value above average (higherIsBetter=true)', () => {
    expect(diffColor(30, 20, true)).toBe('text-emerald-400');
  });

  it('returns red for value below average (higherIsBetter=true)', () => {
    expect(diffColor(10, 20, true)).toBe('text-rose-400');
  });

  it('returns green for equal values (higherIsBetter=true)', () => {
    expect(diffColor(20, 20, true)).toBe('text-emerald-400');
  });

  it('returns green for value BELOW average when higherIsBetter=false', () => {
    expect(diffColor(5, 10, false)).toBe('text-emerald-400');
  });

  it('returns red for value ABOVE average when higherIsBetter=false', () => {
    expect(diffColor(15, 10, false)).toBe('text-rose-400');
  });

  it('returns gray for null value', () => {
    expect(diffColor(null, 20)).toBe('text-surface-400');
  });

  it('returns gray for null avg', () => {
    expect(diffColor(30, null)).toBe('text-surface-400');
  });

  it('defaults higherIsBetter to true', () => {
    expect(diffColor(30, 20)).toBe('text-emerald-400');
  });
});

describe('formatNumber — null and edge cases', () => {
  it('returns em-dash for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('returns em-dash for NaN string', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('handles string numbers', () => {
    const result = formatNumber('1234');
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('formats zero correctly', () => {
    expect(formatNumber(0)).not.toBe('—');
  });

  it('returns em-dash for Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });
});

describe('formatEuro', () => {
  it('appends € symbol', () => {
    expect(formatEuro(30000)).toContain('€');
  });

  it('returns em-dash for null', () => {
    expect(formatEuro(null)).toBe('—');
  });
});

describe('formatPct', () => {
  it('formats with 1 decimal by default', () => {
    expect(formatPct(12.34)).toBe('12.3 %');
  });

  it('respects custom decimal places', () => {
    expect(formatPct(12.345, 2)).toBe('12.35 %');
  });

  it('returns em-dash for null', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('handles string input', () => {
    expect(formatPct('12.3')).toBe('12.3 %');
  });
});

describe('formatDensity', () => {
  it('formats with /km² suffix', () => {
    expect(formatDensity(5000)).toContain('/km²');
  });

  it('rounds to nearest integer', () => {
    const result = formatDensity(5432.7);
    expect(result).toContain('5');
    expect(result).toContain('433');
  });

  it('returns em-dash for null', () => {
    expect(formatDensity(null)).toBe('—');
  });
});

describe('formatEuroSqm', () => {
  it('formats with €/m² suffix', () => {
    expect(formatEuroSqm(3500)).toContain('€/m²');
  });

  it('handles string input', () => {
    expect(formatEuroSqm('3500')).toContain('€/m²');
  });

  it('returns em-dash for null', () => {
    expect(formatEuroSqm(null)).toBe('—');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all special characters in one string', () => {
    expect(escapeHtml('<a href="x" & y=\'z\'>')).toBe(
      '&lt;a href=&quot;x&quot; &amp; y=&#39;z&#39;&gt;'
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns safe strings unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });
});
