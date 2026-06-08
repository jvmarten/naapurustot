import { describe, it, expect, afterEach } from 'vitest';
import { loadHomeReference, saveHomeReference } from '../utils/homeReference';

const STORAGE_KEY = 'naapurustot-home-reference';

describe('homeReference persistence (QW-2)', () => {
  afterEach(() => localStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(loadHomeReference()).toBeNull();
  });

  it('round-trips a valid 5-digit postal code', () => {
    saveHomeReference('00100');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('00100');
    expect(loadHomeReference()).toBe('00100');
  });

  it('clears the stored home when saving null', () => {
    saveHomeReference('00100');
    saveHomeReference(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadHomeReference()).toBeNull();
  });

  it('rejects malformed / non-postal-code values on save', () => {
    saveHomeReference('not-a-pno');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    saveHomeReference('123');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores a malformed stored value on load', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    expect(loadHomeReference()).toBeNull();
  });
});
