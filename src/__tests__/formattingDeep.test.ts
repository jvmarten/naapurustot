import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor } from '../utils/formatting';

describe('formatNumber — deep edge cases', () => {
  it('handles NaN input', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('handles Infinity input', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('handles negative Infinity input', () => {
    expect(formatNumber(-Infinity)).toBe('—');
  });

  it('handles string number input', () => {
    expect(formatNumber('12345')).toBe('12\u00a0345');
  });

  it('handles string non-number input', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('handles negative numbers', () => {
    const result = formatNumber(-5000);
    expect(result).toContain('5');
    expect(result).toContain('000');
  });

  it('handles very large numbers', () => {
    const result = formatNumber(1000000);
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatEuro — deep edge cases', () => {
  it('handles NaN', () => {
    expect(formatEuro(NaN)).toBe('—');
  });

  it('handles string input', () => {
    const result = formatEuro('25000');
    expect(result).toContain('€');
    expect(result).toContain('25');
  });

  it('handles negative amounts', () => {
    const result = formatEuro(-1000);
    expect(result).toContain('€');
  });
});

describe('formatPct — deep edge cases', () => {
  it('handles NaN', () => {
    expect(formatPct(NaN)).toBe('—');
  });

  it('handles very small decimals', () => {
    expect(formatPct(0.123)).toBe('0.1 %');
  });

  it('handles 100%', () => {
    expect(formatPct(100)).toBe('100.0 %');
  });

  it('handles values over 100%', () => {
    expect(formatPct(150.5)).toBe('150.5 %');
  });

  it('handles 0 decimals', () => {
    expect(formatPct(42.567, 0)).toBe('43 %');
  });

  it('handles 3 decimals', () => {
    expect(formatPct(42.5678, 3)).toBe('42.568 %');
  });
});

describe('formatDiff — deep edge cases', () => {
  it('returns empty for both null', () => {
    expect(formatDiff(null, null)).toBe('');
  });

  it('handles string inputs', () => {
    expect(formatDiff('10', '5')).toBe('+5.0');
  });

  it('handles very small differences', () => {
    expect(formatDiff(10.01, 10)).toBe('+0.0');
  });

  it('handles equal values', () => {
    expect(formatDiff(5, 5)).toBe('+0.0');
  });

  it('handles large negative difference', () => {
    expect(formatDiff(0, 1000)).toBe('-1000.0');
  });
});

describe('diffColor — deep edge cases', () => {
  it('returns correct color when lower is better and value equals avg', () => {
    // diff = 0, higherIsBetter = false → diff <= 0 is true → emerald
    expect(diffColor(5, 5, false)).toBe('text-emerald-400');
  });

  it('returns correct color for exactly equal values (higherIsBetter=true)', () => {
    // diff = 0, higherIsBetter = true → diff >= 0 is true → emerald
    expect(diffColor(5, 5, true)).toBe('text-emerald-400');
  });

  it('handles string inputs', () => {
    expect(diffColor('100', '50', true)).toBe('text-emerald-400');
    expect(diffColor('50', '100', true)).toBe('text-rose-400');
  });

  it('returns neutral for NaN value', () => {
    expect(diffColor(NaN, 5)).toBe('text-surface-400');
  });

  it('returns neutral for NaN avg', () => {
    expect(diffColor(5, NaN)).toBe('text-surface-400');
  });

  it('handles negative values correctly with higherIsBetter=true', () => {
    // -5 vs -10: diff = 5, positive → emerald
    expect(diffColor(-5, -10, true)).toBe('text-emerald-400');
  });

  it('handles negative values correctly with higherIsBetter=false', () => {
    // -10 vs -5: diff = -5, negative → for lowerIsBetter, diff <= 0 → emerald
    expect(diffColor(-10, -5, false)).toBe('text-emerald-400');
  });
});
