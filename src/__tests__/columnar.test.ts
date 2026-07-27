import { describe, it, expect } from 'vitest';
import { decodeColumnar } from '../utils/columnar';
// @ts-expect-error — plain .mjs build helper with no type declarations
import { encodeColumnar, decodeColumnar as decodeNode, COLUMNAR_FORMAT } from '../../scripts/lib/columnar.mjs';
import regionProperties from '../data/region_properties.json';

/**
 * region_properties.json ships column-major: the 198 key names are stored once
 * instead of being repeated on each of 3,018 records, which was 71.4 % of the
 * file. The encoder (build-time, .mjs) and the decoder (runtime, .ts) are
 * separate implementations of the same format, so these tests pin them against
 * each other and against the committed artifact.
 */

describe('columnar codec', () => {
  it('round-trips records through encode and decode', () => {
    const records = [
      { pno: '00100', qi: 80, name: 'Alpha' },
      { pno: '00200', qi: null, name: 'Beta' },
    ];
    expect(decodeColumnar(encodeColumnar(records))).toEqual(records);
    expect(decodeNode(encodeColumnar(records))).toEqual(records);
  });

  it('fills a key absent from one record with null rather than dropping it', () => {
    const encoded = encodeColumnar([{ a: 1, b: 2 }, { a: 3 }]);
    expect(decodeColumnar(encoded)).toEqual([{ a: 1, b: 2 }, { a: 3, b: null }]);
  });

  it('keeps first-seen key order, so decoded records keep the pipeline’s ordering', () => {
    // Not sorted: consumers inherit a decoded record's key order, and sorting
    // reshuffled every entry in national_ranges.json for no functional reason.
    expect(encodeColumnar([{ b: 1, a: 2 }]).keys).toEqual(['b', 'a']);
    // Still a pure function of the input, which is what the idempotency gate needs.
    const records = [{ b: 1 }, { a: 2, b: 3 }];
    expect(encodeColumnar(records)).toEqual(encodeColumnar(records));
    expect(encodeColumnar(records).keys).toEqual(['b', 'a']);
  });

  it('passes a plain array straight through, so an older artifact still loads', () => {
    const rows = [{ pno: '00100' }];
    expect(decodeColumnar(rows)).toBe(rows);
    expect(decodeNode(rows)).toBe(rows);
  });

  it('decodes an empty payload without throwing', () => {
    expect(decodeColumnar({ keys: [], cols: [] })).toEqual([]);
    expect(decodeColumnar([])).toEqual([]);
  });

  it('returns an empty result for a malformed payload rather than crashing the map', () => {
    // The runtime decoder is on the all-Finland first-paint path; a corrupt
    // fetch must not throw past it.
    expect(decodeColumnar({ keys: null, cols: null } as never)).toEqual([]);
  });

  it('rejects a mismatched payload at build time, where a throw is useful', () => {
    expect(() => decodeNode({ keys: ['a', 'b'], cols: [[1]] })).toThrow(/2 keys but 1 column/);
    expect(() => decodeNode(null)).toThrow(TypeError);
  });

  it('the committed artifact is in the expected format and decodes to 3,018 areas', () => {
    const payload = regionProperties as unknown as { format: string; keys: string[]; cols: unknown[][] };
    expect(payload.format).toBe(COLUMNAR_FORMAT);
    expect(payload.keys).toContain('pno');
    const decoded = decodeColumnar<Record<string, unknown>>(payload);
    expect(decoded).toHaveLength(3018);
    expect(String(decoded[0].pno)).toMatch(/^\d{5}$/);
    // Every record must carry every key — that is what makes the column layout safe.
    expect(Object.keys(decoded[0])).toHaveLength(payload.keys.length);
  });
});
