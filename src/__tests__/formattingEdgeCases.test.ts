import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';
import { setLang } from '../utils/i18n';

beforeEach(() => {
  setLang('fi');
});

describe('formatting — type coercion from string inputs', () => {
  it('formatNumber handles string numbers', () => {
    const result = formatNumber('12345');
    expect(result).not.toBe('—');
    // Should parse as 12345 and format with locale
  });

  it('formatNumber returns — for non-numeric strings', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('formatNumber treats empty string as 0 (Number("") === 0)', () => {
    // This is JavaScript behavior: Number('') === 0
    expect(formatNumber('')).not.toBe('—');
  });

  it('formatEuro handles string numbers', () => {
    const result = formatEuro('50000');
    expect(result).toContain('€');
    expect(result).not.toBe('—');
  });

  it('formatPct handles string input', () => {
    expect(formatPct('12.5')).toBe('12.5 %');
  });

  it('formatPct respects custom decimal places', () => {
    expect(formatPct(12.345, 2)).toBe('12.35 %');
    expect(formatPct(12.345, 0)).toBe('12 %');
  });
});

describe('formatting — special numeric values', () => {
  it('formatNumber returns — for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('formatNumber returns — for Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
    expect(formatNumber(-Infinity)).toBe('—');
  });

  it('formatEuro returns — for NaN', () => {
    expect(formatEuro(NaN)).toBe('—');
  });

  it('formatPct returns — for NaN', () => {
    expect(formatPct(NaN)).toBe('—');
  });

  it('formatNumber handles zero', () => {
    expect(formatNumber(0)).not.toBe('—');
  });

  it('formatNumber handles negative numbers', () => {
    const result = formatNumber(-5000);
    expect(result).not.toBe('—');
  });
});

describe('formatDiff — difference calculation', () => {
  it('positive difference shows + sign', () => {
    expect(formatDiff(75, 50)).toBe('+25.0');
  });

  it('negative difference shows - sign', () => {
    expect(formatDiff(30, 50)).toBe('-20.0');
  });

  it('equal values show +0.0', () => {
    expect(formatDiff(50, 50)).toBe('+0.0');
  });

  it('returns empty string when value is null', () => {
    expect(formatDiff(null, 50)).toBe('');
  });

  it('returns empty string when avg is null', () => {
    expect(formatDiff(50, null)).toBe('');
  });

  it('handles string inputs', () => {
    expect(formatDiff('75', '50')).toBe('+25.0');
  });

  it('returns empty for NaN input', () => {
    expect(formatDiff(NaN, 50)).toBe('');
  });

  it('handles very small differences', () => {
    expect(formatDiff(50.001, 50)).toBe('+0.0');
  });
});

describe('diffColor — CSS class selection', () => {
  it('green for value > avg when higherIsBetter', () => {
    expect(diffColor(60, 50, true)).toBe('text-emerald-400');
  });

  it('red for value < avg when higherIsBetter', () => {
    expect(diffColor(40, 50, true)).toBe('text-rose-400');
  });

  it('red for value > avg when higherIsBetter=false (e.g., crime)', () => {
    expect(diffColor(60, 50, false)).toBe('text-rose-400');
  });

  it('green for value < avg when higherIsBetter=false', () => {
    expect(diffColor(40, 50, false)).toBe('text-emerald-400');
  });

  it('defaults higherIsBetter to true', () => {
    expect(diffColor(60, 50)).toBe('text-emerald-400');
  });

  it('gray for null value', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
  });

  it('gray for null avg', () => {
    expect(diffColor(50, null)).toBe('text-surface-400');
  });

  it('green when equal (diff >= 0) with higherIsBetter', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
  });

  it('green when equal (diff <= 0) with higherIsBetter=false', () => {
    expect(diffColor(50, 50, false)).toBe('text-emerald-400');
  });
});
