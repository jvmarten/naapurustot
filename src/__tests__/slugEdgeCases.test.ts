/**
 * Slug — URL slug generation and parsing edge cases.
 *
 * Priority 3: Routing logic. Wrong slugs cause 404s or wrong
 * neighborhoods shown on profile pages.
 *
 * Targets untested paths:
 * - parseSlug rejects slugs without separator (5 digits + text, no dash)
 * - parseSlug rejects consecutive dashes
 * - parseSlug rejects trailing dashes in name part
 * - parseSlug accepts PNO-only and PNO-with-empty-name
 * - toSlug handles multi-word names with various separators
 * - Round-trip: toSlug → parseSlug always recovers PNO
 */
import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';

describe('parseSlug — strict validation', () => {
  it('rejects 5 digits without separator before text', () => {
    expect(parseSlug('12345abcde')).toBeNull();
  });

  it('rejects consecutive dashes in name', () => {
    expect(parseSlug('00100--test')).toBeNull();
  });

  it('rejects trailing dash in name', () => {
    expect(parseSlug('00100-test-')).toBeNull();
  });

  it('accepts PNO with trailing dash (empty name)', () => {
    expect(parseSlug('00100-')).toBe('00100');
  });

  it('accepts PNO only (no dash, no name)', () => {
    expect(parseSlug('00100')).toBe('00100');
  });

  it('accepts well-formed slug with multi-segment name', () => {
    expect(parseSlug('00100-etu-toolo')).toBe('00100');
  });

  it('accepts slug with numbers in name', () => {
    expect(parseSlug('00100-alue-3')).toBe('00100');
  });

  it('rejects slug with uppercase in name', () => {
    expect(parseSlug('00100-Helsinki')).toBeNull();
  });

  it('rejects slug with special characters', () => {
    expect(parseSlug('00100-etu_töölö')).toBeNull();
  });

  it('rejects 6-digit codes', () => {
    expect(parseSlug('001001-test')).toBeNull();
  });

  it('rejects 4-digit codes', () => {
    expect(parseSlug('0010-test')).toBeNull();
  });
});

describe('toSlug — character handling', () => {
  it('converts ä to a', () => {
    expect(toSlug('00100', 'Käpylä')).toBe('00100-kapyla');
  });

  it('converts ö to o', () => {
    expect(toSlug('00100', 'Töölö')).toBe('00100-toolo');
  });

  it('converts å to a', () => {
    expect(toSlug('00100', 'Åggelby')).toBe('00100-aggelby');
  });

  it('handles mixed Finnish and regular characters', () => {
    expect(toSlug('00100', 'Etu-Töölö')).toBe('00100-etu-toolo');
  });

  it('handles parentheses and special punctuation', () => {
    expect(toSlug('00100', 'Area (central)')).toBe('00100-area-central');
  });

  it('handles slash separators', () => {
    expect(toSlug('00100', 'Kallio / Sörnäinen')).toBe('00100-kallio-sornainen');
  });

  it('handles all-uppercase input', () => {
    expect(toSlug('00100', 'KALLIO')).toBe('00100-kallio');
  });
});

describe('toSlug → parseSlug round-trip', () => {
  const testCases: [string, string][] = [
    ['00100', 'Helsinki keskusta'],
    ['00250', 'Käpylä'],
    ['00100', 'Etu-Töölö'],
    ['20100', 'Turku'],
    ['33100', 'Tampere keskusta'],
    ['00100', 'Alue 3'],
  ];

  for (const [pno, nimi] of testCases) {
    it(`recovers PNO ${pno} from slug of "${nimi}"`, () => {
      const slug = toSlug(pno, nimi);
      expect(parseSlug(slug)).toBe(pno);
    });
  }

  it('round-trips empty name', () => {
    const slug = toSlug('00100', '');
    // toSlug('00100', '') → '00100-'
    expect(parseSlug(slug)).toBe('00100');
  });
});
