/**
 * Critical tests for formatting.ts — edge cases in number formatting,
 * especially around NaN, Infinity, string inputs, and locale handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { setLang } from '../utils/i18n';

describe('formatNumber — edge cases', () => {
  beforeEach(() => setLang('fi'));

  it('returns em dash for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('returns em dash for Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
    expect(formatNumber(-Infinity)).toBe('—');
  });

  it('returns em dash for non-numeric string', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('handles string representation of numbers', () => {
    const result = formatNumber('12345');
    // Should format as a number, not return em dash
    expect(result).not.toBe('—');
  });

  it('handles negative numbers', () => {
    const result = formatNumber(-1234);
    // Should contain minus sign and formatted number
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles very large numbers', () => {
    const result = formatNumber(1_000_000_000);
    expect(result).not.toBe('—');
  });
});

describe('formatEuro — edge cases', () => {
  beforeEach(() => setLang('fi'));

  it('appends € symbol', () => {
    const result = formatEuro(1000);
    expect(result).toContain('€');
  });

  it('returns em dash for null', () => {
    expect(formatEuro(null)).toBe('—');
  });

  it('handles string numbers', () => {
    const result = formatEuro('25000');
    expect(result).toContain('€');
    expect(result).not.toBe('—');
  });
});

describe('formatPct — edge cases', () => {
  it('uses 1 decimal by default', () => {
    expect(formatPct(12.345)).toBe('12.3 %');
  });

  it('respects zero decimals', () => {
    expect(formatPct(12.345, 0)).toBe('12 %');
  });

  it('handles negative percentages', () => {
    expect(formatPct(-5.5)).toBe('-5.5 %');
  });

  it('handles zero', () => {
    expect(formatPct(0)).toBe('0.0 %');
  });
});

describe('formatDiff — edge cases', () => {
  it('shows 0.0 without + prefix when value equals average', () => {
    expect(formatDiff(10, 10)).toBe('0.0');
  });

  it('handles string inputs', () => {
    expect(formatDiff('15', '10')).toBe('+5.0');
  });

  it('returns empty string when both are null', () => {
    expect(formatDiff(null, null)).toBe('');
  });

  it('returns empty for NaN value', () => {
    expect(formatDiff(NaN, 10)).toBe('');
  });

  it('returns empty for Infinity average', () => {
    expect(formatDiff(10, Infinity)).toBe('');
  });
});

describe('diffColor — logic correctness', () => {
  it('higherIsBetter=true: value > avg → emerald (positive)', () => {
    expect(diffColor(60, 50, true)).toBe('text-emerald-400');
  });

  it('higherIsBetter=true: value < avg → rose (negative)', () => {
    expect(diffColor(40, 50, true)).toBe('text-rose-400');
  });

  it('higherIsBetter=false: value < avg → emerald (lower is better)', () => {
    expect(diffColor(40, 50, false)).toBe('text-emerald-400');
  });

  it('higherIsBetter=false: value > avg → rose (lower is better, above is bad)', () => {
    expect(diffColor(60, 50, false)).toBe('text-rose-400');
  });

  it('equal values → emerald for both modes', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
    expect(diffColor(50, 50, false)).toBe('text-emerald-400');
  });

  it('default higherIsBetter is true', () => {
    expect(diffColor(60, 50)).toBe('text-emerald-400');
    expect(diffColor(40, 50)).toBe('text-rose-400');
  });

  it('returns neutral for null inputs', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
    expect(diffColor(50, null)).toBe('text-surface-400');
  });
});
