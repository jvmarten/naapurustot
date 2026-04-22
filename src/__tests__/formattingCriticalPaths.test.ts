import { describe, it, expect, beforeEach, vi } from 'vitest';

let formatNumber: typeof import('../utils/formatting').formatNumber;
let formatEuro: typeof import('../utils/formatting').formatEuro;
let formatPct: typeof import('../utils/formatting').formatPct;
let formatDiff: typeof import('../utils/formatting').formatDiff;
let formatDensity: typeof import('../utils/formatting').formatDensity;
let formatEuroSqm: typeof import('../utils/formatting').formatEuroSqm;
let diffColor: typeof import('../utils/formatting').diffColor;

describe('formatting critical paths', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/formatting');
    formatNumber = mod.formatNumber;
    formatEuro = mod.formatEuro;
    formatPct = mod.formatPct;
    formatDiff = mod.formatDiff;
    formatDensity = mod.formatDensity;
    formatEuroSqm = mod.formatEuroSqm;
    diffColor = mod.diffColor;
  });

  describe('null/undefined handling', () => {
    it('formatNumber returns dash for null', () => {
      expect(formatNumber(null)).toBe('—');
    });

    it('formatNumber returns dash for undefined', () => {
      expect(formatNumber(undefined)).toBe('—');
    });

    it('formatEuro returns dash for null', () => {
      expect(formatEuro(null)).toBe('—');
    });

    it('formatPct returns dash for null', () => {
      expect(formatPct(null)).toBe('—');
    });

    it('formatDensity returns dash for null', () => {
      expect(formatDensity(null)).toBe('—');
    });

    it('formatEuroSqm returns dash for null', () => {
      expect(formatEuroSqm(null)).toBe('—');
    });
  });

  describe('string input coercion', () => {
    it('formatNumber handles string numbers', () => {
      const result = formatNumber('30000');
      expect(result).not.toBe('—');
      expect(result).toContain('30');
    });

    it('formatNumber returns dash for non-numeric strings', () => {
      expect(formatNumber('N/A')).toBe('—');
    });

    it('formatNumber returns dash for NaN', () => {
      expect(formatNumber(NaN)).toBe('—');
    });

    it('formatNumber returns dash for Infinity', () => {
      expect(formatNumber(Infinity)).toBe('—');
    });
  });

  describe('formatPct decimals', () => {
    it('defaults to 1 decimal place', () => {
      expect(formatPct(12.345)).toContain('12.3');
    });

    it('respects custom decimal places', () => {
      expect(formatPct(12.345, 2)).toContain('12.35');
    });

    it('handles zero', () => {
      expect(formatPct(0)).toContain('0.0');
    });
  });

  describe('formatDiff', () => {
    it('shows + sign for positive differences', () => {
      expect(formatDiff(30, 20)).toBe('+10.0');
    });

    it('shows no sign for negative differences', () => {
      expect(formatDiff(20, 30)).toBe('-10.0');
    });

    it('shows 0.0 for equal values (no + sign when diff is exactly 0)', () => {
      expect(formatDiff(30, 30)).toBe('0.0');
    });

    it('returns empty string when value is null', () => {
      expect(formatDiff(null, 30)).toBe('');
    });

    it('returns empty string when avg is null', () => {
      expect(formatDiff(30, null)).toBe('');
    });

    it('handles string inputs', () => {
      expect(formatDiff('30', '20')).toBe('+10.0');
    });
  });

  describe('diffColor', () => {
    it('returns green when value beats average (higherIsBetter=true)', () => {
      expect(diffColor(50, 30, true)).toContain('emerald');
    });

    it('returns red when value is below average (higherIsBetter=true)', () => {
      expect(diffColor(20, 30, true)).toContain('rose');
    });

    it('inverts logic when higherIsBetter=false', () => {
      expect(diffColor(20, 30, false)).toContain('emerald'); // lower is better
      expect(diffColor(50, 30, false)).toContain('rose');
    });

    it('returns gray for null value', () => {
      expect(diffColor(null, 30)).toContain('surface-400');
    });

    it('returns gray for null average', () => {
      expect(diffColor(30, null)).toContain('surface-400');
    });

    it('equal values are treated as positive (>=)', () => {
      expect(diffColor(30, 30, true)).toContain('emerald');
    });

    it('handles string inputs', () => {
      expect(diffColor('50', '30')).toContain('emerald');
    });
  });

  describe('extreme values', () => {
    it('formatNumber handles very large numbers', () => {
      const result = formatNumber(1_000_000_000);
      expect(result).not.toBe('—');
    });

    it('formatNumber handles negative numbers', () => {
      const result = formatNumber(-500);
      expect(result).not.toBe('—');
      expect(result).toContain('500');
    });

    it('formatNumber handles zero', () => {
      expect(formatNumber(0)).not.toBe('—');
    });
  });
});
