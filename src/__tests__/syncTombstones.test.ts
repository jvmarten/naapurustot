import { describe, it, expect, beforeEach } from 'vitest';
import {
  readTombstones,
  addTombstone,
  addTombstones,
  clearTombstone,
  mergeRespectingTombstones,
} from '../utils/syncTombstones';

const KEY = 'test-tombstones';

describe('syncTombstones (CF-6)', () => {
  beforeEach(() => localStorage.clear());

  it('records and reads a tombstone', () => {
    expect(readTombstones(KEY).size).toBe(0);
    addTombstone(KEY, '00100');
    expect([...readTombstones(KEY)]).toEqual(['00100']);
  });

  it('clearTombstone removes a single entry', () => {
    addTombstones(KEY, ['00100', '00200']);
    clearTombstone(KEY, '00100');
    expect([...readTombstones(KEY)]).toEqual(['00200']);
  });

  it('mergeRespectingTombstones skips a tombstoned server item absent locally', () => {
    // User deleted 00200 locally; the stale server still has it.
    addTombstone(KEY, '00200');
    const merged = mergeRespectingTombstones(['00100'], ['00100', '00200', '00300'], KEY);
    expect(merged).toEqual(['00100', '00300']); // 00200 not resurrected, 00300 adopted
  });

  it('never drops an item present in base, even if tombstoned', () => {
    // Safe-by-construction: a re-added item (in base) must survive.
    addTombstone(KEY, '00100');
    const merged = mergeRespectingTombstones(['00100'], ['00100', '00200'], KEY);
    expect(merged).toContain('00100');
    expect(merged).toContain('00200');
  });

  it('preserves base order and appends new items', () => {
    const merged = mergeRespectingTombstones(['b', 'a'], ['a', 'c', 'd'], KEY);
    expect(merged).toEqual(['b', 'a', 'c', 'd']);
  });

  it('caps the tombstone set at 500 (oldest fall off)', () => {
    const ids = Array.from({ length: 550 }, (_, i) => `id${i}`);
    addTombstones(KEY, ids);
    const set = readTombstones(KEY);
    expect(set.size).toBe(500);
    expect(set.has('id0')).toBe(false); // oldest evicted
    expect(set.has('id549')).toBe(true); // newest kept
  });

  it('re-adding a tombstone moves it to most-recent (survives the cap)', () => {
    addTombstones(KEY, Array.from({ length: 500 }, (_, i) => `id${i}`));
    addTombstone(KEY, 'id0'); // touch the oldest
    addTombstones(KEY, Array.from({ length: 10 }, (_, i) => `new${i}`));
    expect(readTombstones(KEY).has('id0')).toBe(true);
  });

  it('tolerates malformed localStorage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readTombstones(KEY).size).toBe(0);
  });
});
