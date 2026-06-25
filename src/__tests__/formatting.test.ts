import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor, formatYtlGrade, formatYtlGradeFull, parseSchools } from '../utils/formatting';

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
    expect(formatPct(12.567)).toBe('12,6 %');
  });

  it('respects custom decimal count', () => {
    expect(formatPct(12.567, 2)).toBe('12,57 %');
  });

  it('formats zero', () => {
    expect(formatPct(0)).toBe('0,0 %');
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
    expect(formatDiff(15, 10)).toBe('+5,0');
  });

  it('formats negative difference with - sign', () => {
    expect(formatDiff(8, 10)).toBe('-2,0');
  });

  it('formats zero difference without + prefix', () => {
    expect(formatDiff(10, 10)).toBe('0,0');
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

describe('formatYtlGrade', () => {
  it('returns em dash for null/undefined', () => {
    expect(formatYtlGrade(null)).toBe('—');
    expect(formatYtlGrade(undefined)).toBe('—');
  });

  // Reference table cross-checked against published YTL grade examples
  // (e.g. 6.71 → L-, 6.50 → E½, 5.14 → M+, 4.88 → M, 3.83 → C-, 3.60 → B½).
  it.each<[number, string]>([
    [(6.71 / 7) * 100, 'L-'],
    [(6.50 / 7) * 100, 'E½'],
    [(6.20 / 7) * 100, 'E+'],
    [(5.20 / 7) * 100, 'M+'],
    [(5.14 / 7) * 100, 'M+'],
    [(4.88 / 7) * 100, 'M'],
    [(4.20 / 7) * 100, 'C+'],
    [(4.14 / 7) * 100, 'C+'],
    [(3.83 / 7) * 100, 'C-'],
    [(3.60 / 7) * 100, 'B½'],
    [73.4, 'M+'], // Otaniemi's actual score
    [100, 'L'],
    [0, 'I'],
    // The YTL scale skips integer 1 (I=0 → A=2). Scores that round into that gap
    // must render as the next real grade, not a placeholder dash.
    [10, 'A-'], // mean ≈ 0.70
    [15, 'A'], //  mean ≈ 1.05
  ])('maps score %f to grade %s', (score, expected) => {
    expect(formatYtlGrade(score)).toBe(expected);
  });

  it('clamps out-of-range values', () => {
    expect(formatYtlGrade(150)).toBe('L');
    expect(formatYtlGrade(-10)).toBe('I');
  });
});

describe('formatYtlGradeFull', () => {
  it('returns em dash for null', () => {
    expect(formatYtlGradeFull(null)).toBe('—');
  });

  it('includes letter grade and mean on 0-7 scale', () => {
    expect(formatYtlGradeFull(73.4)).toBe('M+ (5,14)');
  });
});

describe('parseSchools', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseSchools(null)).toBeNull();
    expect(parseSchools(undefined)).toBeNull();
    expect(parseSchools('')).toBeNull();
  });

  it('passes a real array through unchanged', () => {
    const arr = [{ name: 'Otaniemen lukio', score: 77.6 }];
    expect(parseSchools(arr)).toBe(arr);
  });

  it('parses a JSON-encoded string (MapLibre serialization)', () => {
    const json = '[{"name":"Otaniemen lukio","score":77.6}]';
    expect(parseSchools(json)).toEqual([{ name: 'Otaniemen lukio', score: 77.6 }]);
  });

  it('returns null on invalid JSON', () => {
    expect(parseSchools('not json')).toBeNull();
  });

  it('returns null when parsed value is not an array', () => {
    expect(parseSchools('{"not":"array"}')).toBeNull();
    expect(parseSchools(42)).toBeNull();
  });
});
