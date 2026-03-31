import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { setLang } from '../utils/i18n';

describe('formatting — edge cases and correctness', () => {
  beforeEach(() => {
    setLang('fi');
  });

  describe('formatNumber', () => {
    it('returns — for null', () => {
      expect(formatNumber(null)).toBe('—');
    });

    it('returns — for undefined', () => {
      expect(formatNumber(undefined)).toBe('—');
    });

    it('returns — for NaN string', () => {
      expect(formatNumber('not a number')).toBe('—');
    });

    it('formats zero correctly', () => {
      expect(formatNumber(0)).toBe('0');
    });

    it('formats negative numbers', () => {
      const result = formatNumber(-1234);
      // Should contain 1234 with some separator or minus
      expect(result).toContain('1');
      expect(result).toMatch(/^-|−/); // minus sign (various formats)
    });

    it('accepts string numbers', () => {
      const result = formatNumber('1000');
      expect(result).not.toBe('—');
    });

    it('returns — for Infinity', () => {
      expect(formatNumber(Infinity)).toBe('—');
    });

    it('returns — for -Infinity', () => {
      expect(formatNumber(-Infinity)).toBe('—');
    });
  });

  describe('formatEuro', () => {
    it('appends € symbol', () => {
      const result = formatEuro(30000);
      expect(result).toContain('€');
    });

    it('returns — for null', () => {
      expect(formatEuro(null)).toBe('—');
    });

    it('handles zero', () => {
      expect(formatEuro(0)).toContain('€');
    });
  });

  describe('formatPct', () => {
    it('appends % symbol with default 1 decimal', () => {
      expect(formatPct(12.345)).toBe('12.3 %');
    });

    it('respects custom decimals', () => {
      expect(formatPct(12.345, 2)).toBe('12.35 %');
    });

    it('returns — for null', () => {
      expect(formatPct(null)).toBe('—');
    });

    it('formats zero correctly', () => {
      expect(formatPct(0)).toBe('0.0 %');
    });

    it('handles negative percentages', () => {
      expect(formatPct(-5.7)).toBe('-5.7 %');
    });
  });

  describe('formatDiff', () => {
    it('shows + for positive difference', () => {
      expect(formatDiff(110, 100)).toBe('+10.0');
    });

    it('shows negative difference without + sign', () => {
      expect(formatDiff(90, 100)).toBe('-10.0');
    });

    it('shows 0.0 for equal values (no + sign)', () => {
      // diff = 0, sign = '' (not >0)
      expect(formatDiff(100, 100)).toBe('0.0');
    });

    it('returns empty string when value is null', () => {
      expect(formatDiff(null, 100)).toBe('');
    });

    it('returns empty string when average is null', () => {
      expect(formatDiff(100, null)).toBe('');
    });

    it('accepts string numbers', () => {
      expect(formatDiff('150', '100')).toBe('+50.0');
    });
  });

  describe('diffColor', () => {
    it('returns green for value above average (higherIsBetter default)', () => {
      expect(diffColor(110, 100)).toBe('text-emerald-400');
    });

    it('returns red for value below average', () => {
      expect(diffColor(90, 100)).toBe('text-rose-400');
    });

    it('returns green for equal values (>= comparison)', () => {
      expect(diffColor(100, 100)).toBe('text-emerald-400');
    });

    it('returns green for lower value when higherIsBetter is false', () => {
      expect(diffColor(5, 10, false)).toBe('text-emerald-400');
    });

    it('returns red for higher value when higherIsBetter is false', () => {
      expect(diffColor(15, 10, false)).toBe('text-rose-400');
    });

    it('returns muted color for null value', () => {
      expect(diffColor(null, 100)).toBe('text-surface-400');
    });

    it('returns muted color for null average', () => {
      expect(diffColor(100, null)).toBe('text-surface-400');
    });
  });
});
