import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';

describe('toSlug', () => {
  it('creates slug from pno and Finnish name', () => {
    expect(toSlug('00100', 'Helsinki keskusta')).toBe('00100-helsinki-keskusta');
  });

  it('handles Finnish characters ä, ö, å', () => {
    expect(toSlug('00100', 'Töölö')).toBe('00100-toolo');
    expect(toSlug('02100', 'Espään keskus')).toBe('02100-espaan-keskus');
    expect(toSlug('00100', 'Åggelby')).toBe('00100-aggelby');
  });

  it('collapses consecutive non-alphanumeric characters', () => {
    expect(toSlug('00100', 'Helsinki - Keskusta')).toBe('00100-helsinki-keskusta');
  });

  it('strips leading and trailing hyphens from name part', () => {
    expect(toSlug('00100', '-Helsinki-')).toBe('00100-helsinki');
  });

  it('handles empty name', () => {
    expect(toSlug('00100', '')).toBe('00100-');
  });

  it('handles name with only special characters', () => {
    expect(toSlug('00100', '---')).toBe('00100-');
  });

  it('normalizes accented characters via NFD', () => {
    expect(toSlug('00100', 'Café')).toBe('00100-cafe');
  });

  it('handles mixed case', () => {
    expect(toSlug('00100', 'HELSINKI Keskusta')).toBe('00100-helsinki-keskusta');
  });

  it('handles parentheses and special punctuation', () => {
    expect(toSlug('00100', 'Helsinki (keskusta)')).toBe('00100-helsinki-keskusta');
  });
});

describe('parseSlug', () => {
  it('extracts postal code from valid slug', () => {
    expect(parseSlug('00100-helsinki-keskusta')).toBe('00100');
  });

  it('extracts postal code from bare 5-digit string', () => {
    expect(parseSlug('00100')).toBe('00100');
  });

  it('handles slug with trailing hyphen (empty name)', () => {
    expect(parseSlug('00100-')).toBe('00100');
  });

  it('returns null for less than 5 digits', () => {
    expect(parseSlug('0010')).toBeNull();
  });

  it('returns null for more than 5 digits without separator', () => {
    expect(parseSlug('001001')).toBeNull();
  });

  it('returns null for non-digit prefix', () => {
    expect(parseSlug('abcde-test')).toBeNull();
  });

  it('returns null for consecutive hyphens in name', () => {
    expect(parseSlug('00100--test')).toBeNull();
  });

  it('returns null for trailing hyphen in name', () => {
    expect(parseSlug('00100-test-')).toBeNull();
  });

  it('handles uppercase input (converts to lowercase)', () => {
    expect(parseSlug('00100-HELSINKI')).toBe('00100');
  });

  it('returns null for empty string', () => {
    expect(parseSlug('')).toBeNull();
  });

  it('returns null for slug with special characters in name', () => {
    expect(parseSlug('00100-hel$inki')).toBeNull();
  });

  it('accepts multi-segment names', () => {
    expect(parseSlug('00100-helsinki-etu-toolo')).toBe('00100');
  });
});
