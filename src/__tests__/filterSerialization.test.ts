import { describe, it, expect } from 'vitest';
import { serializeFilters, deserializeFilters, type FilterCriterion } from '../utils/filterUtils';

describe('filter URL serialization (CF-1b)', () => {
  it('round-trips a set of criteria', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'property_price', min: 2000, max: 6000 },
      { layerId: 'crime_rate', min: 0, max: 80 },
    ];
    const encoded = serializeFilters(filters);
    expect(encoded).toBe('property_price~2000~6000,crime_rate~0~80');
    expect(deserializeFilters(encoded)).toEqual(filters);
  });

  it('rounds numbers to 3 decimals to keep links short', () => {
    expect(serializeFilters([{ layerId: 'air_quality', min: 18.123456, max: 30.987654 }]))
      .toBe('air_quality~18.123~30.988');
  });

  it('drops unknown layer ids', () => {
    expect(deserializeFilters('not_a_layer~1~2')).toEqual([]);
  });

  it('drops malformed, non-numeric, or inverted ranges', () => {
    expect(deserializeFilters('property_price~abc~6000')).toEqual([]);
    expect(deserializeFilters('property_price~6000~2000')).toEqual([]); // min > max
    expect(deserializeFilters('property_price~~')).toEqual([]);
    expect(deserializeFilters('')).toEqual([]);
  });

  it('keeps valid entries and drops invalid ones in a mixed string', () => {
    expect(deserializeFilters('property_price~2000~6000,bogus~1~2,crime_rate~0~80')).toEqual([
      { layerId: 'property_price', min: 2000, max: 6000 },
      { layerId: 'crime_rate', min: 0, max: 80 },
    ]);
  });

  it('serializes an empty filter set to an empty string', () => {
    expect(serializeFilters([])).toBe('');
  });
});
