import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';

describe('formatNumber', () => {
  it('returns em dash for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns em dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('formats a number with locale grouping', () => {
    const result = formatNumber(12345);
    // fi-FI uses non-breaking space as thousands separator
    expect(result.replace(/\s/g, '')).toBe('12345');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatEuro', () => {
  it('returns em dash for null', () => {
    expect(formatEuro(null)).toBe('—');
  });

  it('appends € symbol', () => {
    const result = formatEuro(30000);
    expect(result).toContain('€');
    expect(result.replace(/\s/g, '')).toContain('30000€');
  });
});

describe('formatPct', () => {
  it('returns em dash for null', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('formats with 1 decimal by default', () => {
    expect(formatPct(12.567)).toBe('12.6 %');
  });

  it('respects custom decimal count', () => {
    expect(formatPct(12.567, 2)).toBe('12.57 %');
  });

  it('formats zero', () => {
    expect(formatPct(0)).toBe('0.0 %');
  });
});

describe('formatDiff', () => {
  it('returns empty string for null value', () => {
    expect(formatDiff(null, 10)).toBe('');
  });

  it('returns empty string for null avg', () => {
    expect(formatDiff(10, null)).toBe('');
  });

  it('formats positive difference with + sign', () => {
    expect(formatDiff(15, 10)).toBe('+5.0');
  });

  it('formats negative difference with - sign', () => {
    expect(formatDiff(8, 10)).toBe('-2.0');
  });

  it('formats zero difference without + prefix', () => {
    expect(formatDiff(10, 10)).toBe('0.0');
  });
});

describe('diffColor', () => {
  it('returns neutral color for null value', () => {
    expect(diffColor(null, 10)).toBe('text-surface-400');
  });

  it('returns neutral color for null avg', () => {
    expect(diffColor(10, null)).toBe('text-surface-400');
  });

  it('returns emerald when higher is better and value > avg', () => {
    expect(diffColor(15, 10, true)).toBe('text-emerald-400');
  });

  it('returns rose when higher is better and value < avg', () => {
    expect(diffColor(8, 10, true)).toBe('text-rose-400');
  });

  it('returns emerald when lower is better and value < avg', () => {
    expect(diffColor(8, 10, false)).toBe('text-emerald-400');
  });

  it('returns rose when lower is better and value > avg', () => {
    expect(diffColor(15, 10, false)).toBe('text-rose-400');
  });

  it('returns emerald for equal values (higherIsBetter=true)', () => {
    expect(diffColor(10, 10, true)).toBe('text-emerald-400');
  });

  it('returns emerald for equal values (higherIsBetter=false)', () => {
    expect(diffColor(10, 10, false)).toBe('text-emerald-400');
  });
});
