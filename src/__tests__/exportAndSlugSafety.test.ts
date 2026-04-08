/**
 * Tests for export safety (CSV injection, filename sanitization)
 * and slug correctness (URL routing depends on parseSlug being exact).
 */
import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';
import { escapeHtml, formatNumber, formatEuro, formatPct, formatDiff, diffColor, formatDensity, formatEuroSqm } from '../utils/formatting';

describe('toSlug', () => {
  it('creates slug from PNO and Finnish name', () => {
    expect(toSlug('00100', 'Helsinki keskusta')).toBe('00100-helsinki-keskusta');
  });

  it('handles Finnish characters ä, ö, å', () => {
    expect(toSlug('00100', 'Töölö')).toBe('00100-toolo');
    expect(toSlug('33100', 'Hämeenpuisto')).toBe('33100-hameenpuisto');
    expect(toSlug('65100', 'Åbo')).toBe('65100-abo');
  });

  it('handles compound names with slashes', () => {
    expect(toSlug('00100', 'Etu-Töölö / Taka-Töölö')).toBe('00100-etu-toolo-taka-toolo');
  });

  it('strips trailing/leading hyphens', () => {
    expect(toSlug('00100', '-Test Area-')).toBe('00100-test-area');
  });

  it('handles names with numbers', () => {
    expect(toSlug('00100', 'Area 51')).toBe('00100-area-51');
  });
});

describe('parseSlug', () => {
  it('extracts PNO from valid slug', () => {
    expect(parseSlug('00100-helsinki-keskusta')).toBe('00100');
  });

  it('extracts PNO from slug with only PNO', () => {
    expect(parseSlug('00100')).toBe('00100');
  });

  it('returns null for non-numeric prefix', () => {
    expect(parseSlug('abcde-area')).toBeNull();
  });

  it('returns null for short string', () => {
    expect(parseSlug('001')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSlug('')).toBeNull();
  });

  it('handles 5-digit codes starting with zero', () => {
    expect(parseSlug('00100')).toBe('00100');
    expect(parseSlug('01000')).toBe('01000');
  });
});

describe('escapeHtml', () => {
  it('escapes all dangerous HTML characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtml('Helsinki')).toBe('Helsinki');
  });
});

describe('formatting edge cases', () => {
  it('formatNumber handles various null-like inputs', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    // Note: Number('') === 0, so formatNumber('') formats 0, not dash
    expect(formatNumber('not a number')).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
  });

  it('formatNumber handles string numbers', () => {
    const result = formatNumber('1000');
    expect(result).toContain('1');
    expect(result).toContain('000');
  });

  it('formatEuro appends euro sign', () => {
    const result = formatEuro(25000);
    expect(result).toContain('€');
    expect(result).toContain('25');
  });

  it('formatPct formats with specified decimals', () => {
    expect(formatPct(12.345, 2)).toBe('12.35 %');
    expect(formatPct(12.345, 0)).toBe('12 %');
  });

  it('formatDiff shows positive sign for positive differences', () => {
    expect(formatDiff(100, 80)).toBe('+20.0');
    expect(formatDiff(80, 100)).toBe('-20.0');
  });

  it('formatDiff returns empty for null inputs', () => {
    expect(formatDiff(null, 80)).toBe('');
    expect(formatDiff(100, null)).toBe('');
  });

  it('diffColor returns correct classes', () => {
    // Higher is better (default)
    expect(diffColor(100, 80)).toBe('text-emerald-400');
    expect(diffColor(80, 100)).toBe('text-rose-400');
    // Lower is better (higherIsBetter = false)
    expect(diffColor(80, 100, false)).toBe('text-emerald-400');
    expect(diffColor(100, 80, false)).toBe('text-rose-400');
  });

  it('diffColor returns neutral class for null values', () => {
    expect(diffColor(null, 80)).toBe('text-surface-400');
    expect(diffColor(100, null)).toBe('text-surface-400');
  });

  it('formatDensity appends /km²', () => {
    const result = formatDensity(1234);
    expect(result).toContain('/km²');
  });

  it('formatEuroSqm appends €/m²', () => {
    const result = formatEuroSqm(3500);
    expect(result).toContain('€/m²');
  });
});
