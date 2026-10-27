/**
 * Tests for areaId.ts — the one place that knows each country's area-id format.
 * A format that silently rejects a valid id drops it from URLs, favourites and notes.
 */
import { describe, it, expect } from 'vitest';
import { isAreaId, normalizeAreaId, countryOf } from '../utils/areaId';

describe('isAreaId', () => {
  it('accepts Finnish postal codes and Swedish DeSO codes', () => {
    expect(isAreaId('00100')).toBe(true);
    expect(isAreaId('99999')).toBe(true);
    expect(isAreaId('0180C1090')).toBe(true);
    expect(isAreaId('2584A0010')).toBe(true);
  });

  it('rejects near misses', () => {
    for (const s of ['0010', '001000', '0180D1090', '0180c1090', '0180C109', 'helsinki_metro', '', ' 00100']) {
      expect(isAreaId(s)).toBe(false);
    }
  });
});

describe('normalizeAreaId', () => {
  it('upper-cases a slug-cased DeSO code', () => {
    expect(normalizeAreaId('0180c1090')).toBe('0180C1090');
    expect(normalizeAreaId('00100')).toBe('00100');
    expect(normalizeAreaId('abc')).toBeNull();
  });
});

describe('countryOf', () => {
  it('derives the country from the id format', () => {
    expect(countryOf('00100')).toBe('fi');
    expect(countryOf('0180C1090')).toBe('se');
  });
});
