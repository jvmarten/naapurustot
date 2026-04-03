import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';

describe('formatNumber — edge cases', () => {
  it('handles string numeric input', () => {
    const result = formatNumber('12345');
    expect(result).not.toBe('—');
    // Should format as locale number
    expect(result.replace(/\s/g, '').replace(/,/g, '')).toContain('12345');
  });

  it('handles string non-numeric input', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('handles NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('handles Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('handles negative numbers', () => {
    const result = formatNumber(-5000);
    expect(result).not.toBe('—');
    // Finnish locale uses Unicode minus sign (U+2212) not hyphen
    expect(result).toMatch(/[-−]/);
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('handles very large numbers', () => {
    const result = formatNumber(1234567890);
    expect(result).not.toBe('—');
    // Should have separators
    expect(result.length).toBeGreaterThan('1234567890'.length);
  });
});

describe('formatEuro — edge cases', () => {
  it('handles string input', () => {
    const result = formatEuro('30000');
    expect(result).toContain('€');
    expect(result).not.toBe('—');
  });

  it('handles NaN string', () => {
    expect(formatEuro('not a number')).toBe('—');
  });

  it('handles negative euros', () => {
    const result = formatEuro(-500);
    expect(result).toContain('€');
    expect(result).toMatch(/[-−]/);
  });
});

describe('formatPct — edge cases', () => {
  it('respects custom decimal places', () => {
    expect(formatPct(12.3456, 0)).toBe('12 %');
    expect(formatPct(12.3456, 2)).toBe('12.35 %');
    expect(formatPct(12.3456, 3)).toBe('12.346 %');
  });

  it('handles string percentage input', () => {
    expect(formatPct('45.6')).toBe('45.6 %');
  });

  it('handles zero', () => {
    expect(formatPct(0)).toBe('0.0 %');
  });

  it('handles 100%', () => {
    expect(formatPct(100)).toBe('100.0 %');
  });

  it('handles negative percentage', () => {
    expect(formatPct(-5.5)).toBe('-5.5 %');
  });
});

describe('formatDiff — edge cases', () => {
  it('returns empty string when value is null', () => {
    expect(formatDiff(null, 50)).toBe('');
  });

  it('returns empty string when avg is null', () => {
    expect(formatDiff(50, null)).toBe('');
  });

  it('returns empty string when both are null', () => {
    expect(formatDiff(null, null)).toBe('');
  });

  it('formats positive diff with + sign', () => {
    expect(formatDiff(60, 50)).toBe('+10.0');
  });

  it('formats negative diff without explicit sign', () => {
    expect(formatDiff(40, 50)).toBe('-10.0');
  });

  it('formats zero diff without sign', () => {
    expect(formatDiff(50, 50)).toBe('0.0');
  });

  it('handles string inputs', () => {
    expect(formatDiff('60', '50')).toBe('+10.0');
  });

  it('handles very small differences', () => {
    // 50.05 - 50 = 0.04999... due to floating point, rounds to 0.0
    expect(formatDiff(50.05, 50)).toBe('+0.0');
    // Use a larger diff to verify rounding
    expect(formatDiff(50.25, 50)).toBe('+0.3');
  });
});

describe('diffColor — comprehensive', () => {
  it('returns emerald for higher-is-better when value > avg', () => {
    expect(diffColor(60, 50, true)).toBe('text-emerald-400');
  });

  it('returns rose for higher-is-better when value < avg', () => {
    expect(diffColor(40, 50, true)).toBe('text-rose-400');
  });

  it('returns emerald for equal values (higher-is-better)', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
  });

  it('inverts colors when higherIsBetter=false', () => {
    // Lower is better: value < avg → good (emerald)
    expect(diffColor(40, 50, false)).toBe('text-emerald-400');
    // Lower is better: value > avg → bad (rose)
    expect(diffColor(60, 50, false)).toBe('text-rose-400');
  });

  it('returns neutral color for null value', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
  });

  it('returns neutral color for null avg', () => {
    expect(diffColor(50, null)).toBe('text-surface-400');
  });

  it('accepts string inputs', () => {
    expect(diffColor('60', '50', true)).toBe('text-emerald-400');
  });

  it('defaults higherIsBetter to true', () => {
    expect(diffColor(60, 50)).toBe('text-emerald-400');
  });
});
