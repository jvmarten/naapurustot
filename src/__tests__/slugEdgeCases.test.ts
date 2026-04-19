import { describe, it, expect } from 'vitest';
import { toSlug, parseSlug } from '../utils/slug';

describe('toSlug', () => {
  it('converts Finnish characters to ASCII', () => {
    expect(toSlug('00100', 'Äänekoski')).toBe('00100-aanekoski');
  });

  it('handles multiple special characters', () => {
    expect(toSlug('00100', 'Töölö-Kämppä')).toBe('00100-toolo-kamppa');
  });

  it('handles spaces and punctuation', () => {
    expect(toSlug('00100', 'Helsinki Keskusta (Etu-Töölö)')).toBe('00100-helsinki-keskusta-etu-toolo');
  });

  it('handles empty name', () => {
    expect(toSlug('00100', '')).toBe('00100-');
  });

  it('handles name with only special characters', () => {
    const result = toSlug('00100', '!!!');
    expect(result).toBe('00100-');
  });

  it('handles å character', () => {
    expect(toSlug('00100', 'Ångermanland')).toBe('00100-angermanland');
  });

  it('normalizes to lowercase', () => {
    expect(toSlug('00100', 'KALLIO')).toBe('00100-kallio');
  });
});

describe('parseSlug — strict validation', () => {
  it('extracts PNO from valid slug', () => {
    expect(parseSlug('00100-helsinki-keskusta')).toBe('00100');
  });

  it('accepts bare 5-digit postal code', () => {
    expect(parseSlug('00100')).toBe('00100');
  });

  it('accepts slug with trailing dash (empty name)', () => {
    expect(parseSlug('00100-')).toBe('00100');
  });

  it('rejects slug with non-digit prefix', () => {
    expect(parseSlug('abcde-name')).toBeNull();
  });

  it('rejects slug with fewer than 5 digits', () => {
    expect(parseSlug('0010-name')).toBeNull();
  });

  it('rejects slug with more than 5 leading digits without separator', () => {
    expect(parseSlug('001001-name')).toBeNull();
  });

  it('rejects consecutive dashes in name part', () => {
    expect(parseSlug('00100--name')).toBeNull();
  });

  it('rejects trailing dash after name segment', () => {
    expect(parseSlug('00100-name-')).toBeNull();
  });

  it('rejects uppercase characters in name', () => {
    expect(parseSlug('00100-Helsinki')).toBeNull();
  });

  it('accepts numeric segments in name', () => {
    expect(parseSlug('00100-area-42')).toBe('00100');
  });

  it('rejects special characters in name', () => {
    expect(parseSlug('00100-hel.sinki')).toBeNull();
    expect(parseSlug('00100-hel_sinki')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseSlug('')).toBeNull();
  });
});
