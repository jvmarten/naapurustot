/**
 * Tests for dataLoader string-to-number coercion edge cases.
 *
 * The processTopology function coerces string-typed numeric properties
 * to actual numbers (dataLoader.ts:48-52). Edge cases include:
 * - Scientific notation ("1e5")
 * - Plus-prefixed numbers ("+35000")
 * - Whitespace-only strings ("   ")
 * - Infinity/NaN strings
 * - ID fields that should NOT be coerced (pno, kunta)
 * - Empty strings
 *
 * We test the coercion logic directly by simulating the same loop.
 */
import { describe, it, expect } from 'vitest';

// Replicate the coercion logic from dataLoader.ts since processTopology
// is coupled to TopoJSON parsing. We test the exact same algorithm.
const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);

function coerceProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const result = { ...properties };
  for (const key of Object.keys(result)) {
    if (ID_FIELDS.has(key)) continue;
    const v = result[key];
    if (typeof v === 'string' && v.trim() !== '') {
      const num = Number(v);
      if (isFinite(num)) result[key] = num;
    }
  }
  return result;
}

describe('dataLoader coercion — standard numeric strings', () => {
  it('converts integer strings to numbers', () => {
    const result = coerceProperties({ hr_mtu: '30000' });
    expect(result.hr_mtu).toBe(30000);
    expect(typeof result.hr_mtu).toBe('number');
  });

  it('converts decimal strings to numbers', () => {
    const result = coerceProperties({ unemployment_rate: '5.7' });
    expect(result.unemployment_rate).toBe(5.7);
  });

  it('converts negative numbers', () => {
    const result = coerceProperties({ income_change_pct: '-12.3' });
    expect(result.income_change_pct).toBe(-12.3);
  });

  it('converts zero', () => {
    const result = coerceProperties({ crime_index: '0' });
    expect(result.crime_index).toBe(0);
    expect(typeof result.crime_index).toBe('number');
  });
});

describe('dataLoader coercion — edge case strings', () => {
  it('converts scientific notation strings', () => {
    const result = coerceProperties({ he_vakiy: '1e5' });
    expect(result.he_vakiy).toBe(100000);
  });

  it('converts plus-prefixed strings', () => {
    const result = coerceProperties({ hr_mtu: '+35000' });
    expect(result.hr_mtu).toBe(35000);
  });

  it('leaves whitespace-only strings as-is', () => {
    const result = coerceProperties({ nimi: '   ' });
    expect(result.nimi).toBe('   ');
  });

  it('leaves empty strings as-is', () => {
    const result = coerceProperties({ nimi: '' });
    expect(result.nimi).toBe('');
  });

  it('does NOT convert Infinity string (not finite)', () => {
    const result = coerceProperties({ hr_mtu: 'Infinity' });
    expect(result.hr_mtu).toBe('Infinity');
  });

  it('does NOT convert NaN string (not finite)', () => {
    const result = coerceProperties({ hr_mtu: 'NaN' });
    expect(result.hr_mtu).toBe('NaN');
  });

  it('does NOT convert -Infinity string', () => {
    const result = coerceProperties({ hr_mtu: '-Infinity' });
    expect(result.hr_mtu).toBe('-Infinity');
  });

  it('does NOT convert non-numeric strings', () => {
    const result = coerceProperties({ city: 'helsinki' });
    expect(result.city).toBe('helsinki');
  });

  it('does NOT convert mixed alphanumeric strings', () => {
    const result = coerceProperties({ nimi: '12abc' });
    expect(result.nimi).toBe('12abc');
  });

  it('handles strings with leading/trailing whitespace around numbers', () => {
    // " 30000 " — Number(" 30000 ") returns 30000, trim is not empty
    const result = coerceProperties({ hr_mtu: ' 30000 ' });
    expect(result.hr_mtu).toBe(30000);
  });
});

describe('dataLoader coercion — ID fields are preserved', () => {
  it('pno remains a string even if numeric', () => {
    const result = coerceProperties({ pno: '00100' });
    expect(result.pno).toBe('00100');
    expect(typeof result.pno).toBe('string');
  });

  it('postinumeroalue remains a string', () => {
    const result = coerceProperties({ postinumeroalue: '00200' });
    expect(result.postinumeroalue).toBe('00200');
    expect(typeof result.postinumeroalue).toBe('string');
  });

  it('kunta remains a string even if numeric-looking', () => {
    const result = coerceProperties({ kunta: '091' });
    expect(result.kunta).toBe('091');
    expect(typeof result.kunta).toBe('string');
  });

  it('kunta preserves leading zeros', () => {
    // Number('091') = 91, losing the leading zero
    const result = coerceProperties({ kunta: '091' });
    expect(result.kunta).toBe('091');
    expect(result.kunta).not.toBe(91);
  });
});

describe('dataLoader coercion — null and non-string values', () => {
  it('null values pass through unchanged', () => {
    const result = coerceProperties({ hr_mtu: null });
    expect(result.hr_mtu).toBeNull();
  });

  it('undefined values pass through unchanged', () => {
    const result = coerceProperties({ hr_mtu: undefined });
    expect(result.hr_mtu).toBeUndefined();
  });

  it('already-numeric values pass through unchanged', () => {
    const result = coerceProperties({ hr_mtu: 30000 });
    expect(result.hr_mtu).toBe(30000);
  });

  it('boolean values pass through unchanged', () => {
    const result = coerceProperties({ _isMetroArea: true });
    expect(result._isMetroArea).toBe(true);
  });
});

describe('dataLoader coercion — large numbers and precision', () => {
  it('very large numbers maintain reasonable precision', () => {
    const result = coerceProperties({ he_vakiy: '99999999' });
    expect(result.he_vakiy).toBe(99999999);
  });

  it('very small decimals maintain precision', () => {
    const result = coerceProperties({ air_quality_index: '0.001' });
    expect(result.air_quality_index).toBe(0.001);
  });

  it('handles negative zero', () => {
    const result = coerceProperties({ hr_mtu: '-0' });
    expect(result.hr_mtu).toBe(-0);
    expect(typeof result.hr_mtu).toBe('number');
  });
});
