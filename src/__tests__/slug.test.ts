/**
 * Tests for slug.ts — URL slug generation and parsing.
 *
 * Bugs here break neighborhood profile page routing (broken links,
 * wrong neighborhoods shown, 404s on valid URLs).
 */
import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';

describe('toSlug', () => {
  it('creates slug from postal code and Finnish name', () => {
    expect(toSlug('00100', 'Helsinki keskusta')).toBe('00100-helsinki-keskusta');
  });

  it('handles Finnish special characters (ä, ö, å)', () => {
    expect(toSlug('00100', 'Töölö')).toBe('00100-toolo');
    expect(toSlug('00250', 'Käpylä')).toBe('00250-kapyla');
    expect(toSlug('65100', 'Vöyrinkaupunki')).toBe('65100-voyrinkaupunki');
  });

  it('handles å character', () => {
    const slug = toSlug('00100', 'Åggelby');
    expect(slug).toBe('00100-aggelby');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(toSlug('00100', 'Etu-Töölö (keskusta)')).toBe('00100-etu-toolo-keskusta');
  });

  it('strips leading and trailing hyphens', () => {
    expect(toSlug('00100', '-Test-')).toBe('00100-test');
  });

  it('collapses consecutive special characters into single hyphen', () => {
    expect(toSlug('00100', 'Kallio / Sörnäinen')).toBe('00100-kallio-sornainen');
  });

  it('handles names with numbers', () => {
    expect(toSlug('00100', 'Alue 3')).toBe('00100-alue-3');
  });

  it('lowercases everything', () => {
    expect(toSlug('00100', 'KALLIO')).toBe('00100-kallio');
  });

  it('handles empty name', () => {
    expect(toSlug('00100', '')).toBe('00100-');
  });
});

describe('parseSlug', () => {
  it('extracts 5-digit postal code from valid slug', () => {
    expect(parseSlug('00100-helsinki-keskusta')).toBe('00100');
  });

  it('extracts postal code from minimal slug (just PNO)', () => {
    expect(parseSlug('00100')).toBe('00100');
  });

  it('returns null for slug shorter than 5 characters', () => {
    expect(parseSlug('0010')).toBeNull();
  });

  it('returns null for non-numeric prefix', () => {
    expect(parseSlug('abcde-test')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSlug('')).toBeNull();
  });

  it('returns null for slug with mixed letters and digits in PNO position', () => {
    expect(parseSlug('001a0-test')).toBeNull();
  });

  it('handles leading zeros correctly', () => {
    expect(parseSlug('00001-area')).toBe('00001');
  });

  it('handles 5-digit codes starting with 9', () => {
    expect(parseSlug('99999-test')).toBe('99999');
  });
});
