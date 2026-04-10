import { describe, it, expect, beforeEach } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor, formatDensity, formatEuroSqm } from '../utils/formatting';
import { setLang } from '../utils/i18n';

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

// --- NEW: formatDensity and formatEuroSqm (previously untested) ---

describe('formatDensity', () => {
  beforeEach(() => setLang('fi'));

  it('formats a number with /km² suffix', () => {
    const result = formatDensity(1234);
    expect(result).toContain('/km²');
    // Should round and include locale-formatted number
    expect(result.replace(/[\s\u00a0]/g, '')).toContain('1234');
  });

  it('rounds to nearest integer', () => {
    const result = formatDensity(1234.7);
    expect(result.replace(/[\s\u00a0]/g, '')).toContain('1235');
  });

  it('returns dash for null', () => {
    expect(formatDensity(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatDensity(undefined)).toBe('—');
  });

  it('returns dash for non-numeric string', () => {
    expect(formatDensity('abc' as unknown as number)).toBe('—');
  });

  it('handles zero', () => {
    expect(formatDensity(0)).toContain('/km²');
    expect(formatDensity(0)).toContain('0');
  });

  it('handles very large values', () => {
    const result = formatDensity(20000);
    expect(result).toContain('/km²');
    expect(result.replace(/[\s\u00a0]/g, '')).toContain('20000');
  });

  it('returns dash for NaN', () => {
    expect(formatDensity(NaN)).toBe('—');
  });

  it('returns dash for Infinity', () => {
    expect(formatDensity(Infinity)).toBe('—');
  });

  it('formats with English locale', () => {
    setLang('en');
    const result = formatDensity(1234);
    expect(result).toContain('/km²');
    // English uses comma separator
    expect(result).toMatch(/1[,]234/);
  });
});

describe('formatEuroSqm', () => {
  beforeEach(() => setLang('fi'));

  it('formats a number with €/m² suffix', () => {
    const result = formatEuroSqm(3500);
    expect(result).toContain('€/m²');
    expect(result.replace(/[\s\u00a0]/g, '')).toContain('3500');
  });

  it('returns dash for null', () => {
    expect(formatEuroSqm(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatEuroSqm(undefined)).toBe('—');
  });

  it('handles zero', () => {
    expect(formatEuroSqm(0)).toContain('€/m²');
  });

  it('returns dash for NaN string', () => {
    expect(formatEuroSqm('NaN' as unknown as number)).toBe('—');
  });

  it('returns dash for Infinity', () => {
    expect(formatEuroSqm(Infinity)).toBe('—');
  });

  it('handles decimal values', () => {
    const result = formatEuroSqm(3500.5);
    expect(result).toContain('€/m²');
  });

  it('formats with English locale', () => {
    setLang('en');
    const result = formatEuroSqm(3500);
    expect(result).toContain('€/m²');
    expect(result).toMatch(/3[,]500/);
  });
});

describe('formatting locale cache invalidation', () => {
  it('switches format when language changes from fi to en', () => {
    setLang('fi');
    const fiFmt = formatNumber(1000);
    setLang('en');
    const enFmt = formatNumber(1000);
    // fi-FI uses non-breaking space, en-US uses comma
    expect(fiFmt).toMatch(/1[\s\u00a0]000/);
    expect(enFmt).toMatch(/1[,]000/);
    expect(fiFmt).not.toBe(enFmt);
  });

  it('formatEuro uses correct locale after language switch', () => {
    setLang('fi');
    const fi = formatEuro(30000);
    setLang('en');
    const en = formatEuro(30000);
    // Both contain € but with different thousand separators
    expect(fi).toContain('€');
    expect(en).toContain('€');
    // Finnish uses space, English uses comma
    expect(fi).toMatch(/30[\s\u00a0]000/);
    expect(en).toMatch(/30[,]000/);
  });
});
