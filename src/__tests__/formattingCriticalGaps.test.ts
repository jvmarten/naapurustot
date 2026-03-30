import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { setLang } from '../utils/i18n';

describe('formatting — null/undefined/NaN handling', () => {
  it('formatNumber returns em dash for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('formatNumber returns em dash for Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('formatEuro returns em dash for NaN', () => {
    expect(formatEuro(NaN)).toBe('—');
  });

  it('formatPct returns em dash for NaN', () => {
    expect(formatPct(NaN)).toBe('—');
  });

  it('formatNumber handles string numbers', () => {
    const result = formatNumber('12345');
    // Should format as a number, not return raw string
    expect(result).not.toBe('—');
    expect(result).toContain('12');
  });

  it('formatNumber returns em dash for non-numeric string', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('formatEuro handles zero', () => {
    const result = formatEuro(0);
    expect(result).toContain('0');
    expect(result).toContain('€');
  });

  it('formatPct handles zero', () => {
    expect(formatPct(0)).toBe('0.0 %');
  });

  it('formatPct custom decimals', () => {
    expect(formatPct(33.333, 0)).toBe('33 %');
    expect(formatPct(33.333, 2)).toBe('33.33 %');
  });
});

describe('formatDiff — edge cases', () => {
  it('returns empty string when value is null', () => {
    expect(formatDiff(null, 50)).toBe('');
  });

  it('returns empty string when avg is null', () => {
    expect(formatDiff(50, null)).toBe('');
  });

  it('returns +0.0 when values are equal', () => {
    // diff = 0, sign is empty string (not +)
    expect(formatDiff(50, 50)).toBe('0.0');
  });

  it('formats positive difference with + sign', () => {
    expect(formatDiff(55, 50)).toBe('+5.0');
  });

  it('formats negative difference without + sign', () => {
    expect(formatDiff(45, 50)).toBe('-5.0');
  });

  it('handles string inputs', () => {
    expect(formatDiff('55', '50')).toBe('+5.0');
  });

  it('handles very small differences', () => {
    // 50.05 - 50 = 0.05, diff > 0 → sign is '+', toFixed(1) = '0.0' → '+0.0'
    // This is a quirk: +0.0 looks odd but is technically correct
    expect(formatDiff(50.05, 50)).toBe('+0.0');
    // Larger diff that rounds to visible value
    expect(formatDiff(50.06, 50)).toBe('+0.1');
  });
});

describe('diffColor — logic correctness', () => {
  it('returns green when value > avg and higherIsBetter=true', () => {
    expect(diffColor(60, 50, true)).toBe('text-emerald-400');
  });

  it('returns red when value < avg and higherIsBetter=true', () => {
    expect(diffColor(40, 50, true)).toBe('text-rose-400');
  });

  it('returns green when value < avg and higherIsBetter=false (inverted)', () => {
    expect(diffColor(40, 50, false)).toBe('text-emerald-400');
  });

  it('returns red when value > avg and higherIsBetter=false (inverted)', () => {
    expect(diffColor(60, 50, false)).toBe('text-rose-400');
  });

  it('returns green when values are equal (>= 0 diff)', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
  });

  it('returns neutral when value is null', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
  });

  it('returns neutral when avg is null', () => {
    expect(diffColor(50, null)).toBe('text-surface-400');
  });

  it('defaults higherIsBetter to true', () => {
    expect(diffColor(60, 50)).toBe('text-emerald-400');
  });
});

describe('formatting — locale awareness', () => {
  beforeEach(() => {
    setLang('fi');
  });

  it('formatNumber uses Finnish locale', () => {
    setLang('fi');
    const result = formatNumber(12345);
    // Finnish uses non-breaking space as thousands separator
    expect(result).toMatch(/12\s*345/);
  });

  it('formatNumber uses English locale', () => {
    setLang('en');
    const result = formatNumber(12345);
    // English uses comma as thousands separator
    expect(result).toContain('12,345');
  });

  it('formatEuro uses correct locale', () => {
    setLang('en');
    const result = formatEuro(12345);
    expect(result).toContain('€');
    expect(result).toContain('12,345');
  });
});
