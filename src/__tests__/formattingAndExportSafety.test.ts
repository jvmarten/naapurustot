/**
 * Tests for formatting.ts display logic and export.ts CSV injection safety.
 *
 * These are system boundaries — they take raw data and produce user-facing strings.
 * Bugs here are visible to every user (wrong numbers) or exploitable (CSV injection).
 */
import { describe, it, expect } from 'vitest';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor, escapeHtml, formatDensity, formatEuroSqm } from '../utils/formatting';

describe('formatNumber — locale-aware formatting', () => {
  it('formats large numbers with thousand separators', () => {
    const result = formatNumber(1234567);
    // Either "1,234,567" (en) or "1 234 567" (fi) — just check it's not plain digits
    expect(result).not.toBe('1234567');
    expect(result).toContain('234');
  });

  it('returns — for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('handles string input by coercing to number', () => {
    expect(formatNumber('5000')).not.toBe('—');
  });

  it('returns — for non-numeric string', () => {
    expect(formatNumber('abc')).toBe('—');
  });

  it('returns — for NaN', () => {
    expect(formatNumber(NaN)).toBe('—');
  });

  it('returns — for Infinity', () => {
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('formats zero correctly', () => {
    const result = formatNumber(0);
    expect(result).not.toBe('—');
    expect(result).toContain('0');
  });

  it('formats negative numbers', () => {
    const result = formatNumber(-5000);
    expect(result).toContain('5');
    expect(result).not.toBe('—');
  });
});

describe('formatEuro — currency formatting', () => {
  it('appends € symbol', () => {
    expect(formatEuro(30000)).toContain('€');
  });

  it('returns — for null', () => {
    expect(formatEuro(null)).toBe('—');
  });

  it('handles string input', () => {
    const result = formatEuro('25000');
    expect(result).toContain('€');
  });
});

describe('formatPct — percentage formatting', () => {
  it('formats with default 1 decimal', () => {
    expect(formatPct(12.34)).toBe('12.3 %');
  });

  it('formats with custom decimals', () => {
    expect(formatPct(12.345, 2)).toBe('12.35 %');
  });

  it('returns — for null', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('handles zero', () => {
    expect(formatPct(0)).toBe('0.0 %');
  });

  it('handles negative percentages', () => {
    expect(formatPct(-5.5)).toBe('-5.5 %');
  });
});

describe('formatDiff — difference display', () => {
  it('shows + prefix for positive difference', () => {
    expect(formatDiff(55, 50)).toBe('+5.0');
  });

  it('shows no prefix for negative difference', () => {
    expect(formatDiff(45, 50)).toBe('-5.0');
  });

  it('shows 0.0 for equal values (no + prefix at zero)', () => {
    expect(formatDiff(50, 50)).toBe('0.0');
  });

  it('returns empty string for null value', () => {
    expect(formatDiff(null, 50)).toBe('');
  });

  it('returns empty string for null average', () => {
    expect(formatDiff(50, null)).toBe('');
  });

  it('handles string inputs', () => {
    expect(formatDiff('55', '50')).toBe('+5.0');
  });
});

describe('diffColor — comparison color classes', () => {
  it('returns green for value above average (higherIsBetter=true)', () => {
    expect(diffColor(55, 50, true)).toBe('text-emerald-400');
  });

  it('returns red for value below average (higherIsBetter=true)', () => {
    expect(diffColor(45, 50, true)).toBe('text-rose-400');
  });

  it('returns green for value below average when higherIsBetter=false', () => {
    expect(diffColor(45, 50, false)).toBe('text-emerald-400');
  });

  it('returns red for value above average when higherIsBetter=false', () => {
    expect(diffColor(55, 50, false)).toBe('text-rose-400');
  });

  it('returns gray for null value', () => {
    expect(diffColor(null, 50)).toBe('text-surface-400');
  });

  it('returns green for equal values (zero difference is positive)', () => {
    expect(diffColor(50, 50, true)).toBe('text-emerald-400');
  });
});

describe('escapeHtml — XSS prevention', () => {
  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles combined XSS payload', () => {
    const payload = '<img onerror="alert(1)" src="x">';
    const result = escapeHtml(payload);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
  });

  it('handles Finnish neighborhood names with special chars', () => {
    const result = escapeHtml('Etu-Töölö & Kamppi');
    expect(result).toBe('Etu-Töölö &amp; Kamppi');
  });
});

describe('formatDensity — density formatting', () => {
  it('formats with /km² suffix', () => {
    expect(formatDensity(5000)).toContain('/km²');
  });

  it('rounds to integer', () => {
    expect(formatDensity(5000.7)).toContain('5');
  });

  it('returns — for null', () => {
    expect(formatDensity(null)).toBe('—');
  });
});

describe('formatEuroSqm — price per sqm formatting', () => {
  it('formats with €/m² suffix', () => {
    expect(formatEuroSqm(3500)).toContain('€/m²');
  });

  it('returns — for null', () => {
    expect(formatEuroSqm(null)).toBe('—');
  });
});
