/**
 * Tests for slug.ts edge cases not covered by existing tests:
 * - Unicode combining characters
 * - Multiple consecutive hyphens from special chars
 * - Very long names
 * - Numeric-only names
 * - Names with only special characters
 */
import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';

describe('toSlug — unicode edge cases', () => {
  it('handles pre-composed vs decomposed ä', () => {
    // ä can be represented as U+00E4 (precomposed) or U+0061 U+0308 (decomposed)
    const precomposed = toSlug('00100', 'K\u00e4pyl\u00e4');
    const decomposed = toSlug('00100', 'Ka\u0308pyla\u0308');
    expect(precomposed).toBe('00100-kapyla');
    expect(decomposed).toBe('00100-kapyla');
  });

  it('handles pre-composed vs decomposed ö', () => {
    const precomposed = toSlug('00100', 'T\u00f6\u00f6l\u00f6');
    const decomposed = toSlug('00100', 'To\u0308o\u0308lo\u0308');
    expect(precomposed).toBe('00100-toolo');
    expect(decomposed).toBe('00100-toolo');
  });

  it('strips other diacritical marks (accents, tildes, etc.)', () => {
    expect(toSlug('00100', 'café')).toBe('00100-cafe');
    expect(toSlug('00100', 'naïve')).toBe('00100-naive');
    expect(toSlug('00100', 'résumé')).toBe('00100-resume');
  });
});

describe('toSlug — degenerate inputs', () => {
  it('handles name with only special characters', () => {
    const result = toSlug('00100', '!@#$%');
    // All chars replaced with hyphens, then leading/trailing stripped
    expect(result).toBe('00100-');
  });

  it('handles name with only spaces', () => {
    const result = toSlug('00100', '   ');
    expect(result).toBe('00100-');
  });

  it('handles very long names without truncation', () => {
    const longName = 'A'.repeat(200);
    const result = toSlug('00100', longName);
    // Should produce full slug without truncation
    expect(result).toBe(`00100-${'a'.repeat(200)}`);
  });

  it('handles numeric-only name', () => {
    expect(toSlug('00100', '12345')).toBe('00100-12345');
  });

  it('handles name with mixed Finnish and regular chars', () => {
    expect(toSlug('00100', 'Etelä-Haaga')).toBe('00100-etela-haaga');
  });

  it('handles consecutive special characters as single hyphen', () => {
    expect(toSlug('00100', 'Itä---Pasila')).toBe('00100-ita-pasila');
  });

  it('handles name with parentheses and slashes', () => {
    expect(toSlug('33100', 'Tampere (keskusta) / Tammela')).toBe('33100-tampere-keskusta-tammela');
  });
});

describe('parseSlug — additional edge cases', () => {
  it('extracts postal code from slug with special characters after PNO', () => {
    expect(parseSlug('00100-etu-töölö')).toBe('00100');
  });

  it('returns null for slug with spaces in PNO position', () => {
    expect(parseSlug('001 0')).toBeNull();
  });

  it('returns null for slug starting with letters then numbers', () => {
    expect(parseSlug('ab123-test')).toBeNull();
  });

  it('handles very long slug', () => {
    const long = '00100-' + 'a'.repeat(500);
    expect(parseSlug(long)).toBe('00100');
  });

  it('handles slug that is exactly 5 digits', () => {
    expect(parseSlug('12345')).toBe('12345');
  });

  it('handles slug with unicode after PNO', () => {
    expect(parseSlug('00100-käpylä')).toBe('00100');
  });
});
