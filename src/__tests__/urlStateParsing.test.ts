import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — URL parsing', () => {
  const originalSearch = window.location.search;
  const originalHash = window.location.hash;

  function setUrl(search: string, hash = '') {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search, hash, pathname: '/' },
    });
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, search: originalSearch, hash: originalHash, pathname: '/' },
    });
  });

  it('parses valid pno from query params', () => {
    setUrl('?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects pno with wrong length', () => {
    setUrl('?pno=001');
    expect(readInitialUrlState().pno).toBeNull();

    setUrl('?pno=001001');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('rejects pno with non-digit characters', () => {
    setUrl('?pno=00abc');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('parses valid layer ID', () => {
    setUrl('?layer=median_income');
    expect(readInitialUrlState().layer).toBe('median_income');
  });

  it('rejects invalid layer ID', () => {
    setUrl('?layer=nonexistent_layer');
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('parses comma-separated compare PNOs', () => {
    setUrl('?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters out invalid PNOs from compare', () => {
    setUrl('?compare=00100,abc,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('returns empty compare for absent param', () => {
    setUrl('?pno=00100');
    expect(readInitialUrlState().compare).toEqual([]);
  });

  it('parses valid city/region', () => {
    setUrl('?city=turku');
    expect(readInitialUrlState().city).toBe('turku');
  });

  it('accepts "all" as city', () => {
    setUrl('?city=all');
    expect(readInitialUrlState().city).toBe('all');
  });

  it('rejects invalid city', () => {
    setUrl('?city=london');
    expect(readInitialUrlState().city).toBeNull();
  });

  it('returns all nulls for empty URL', () => {
    setUrl('');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });

  it('parses multiple params at once', () => {
    setUrl('?pno=00200&layer=unemployment&city=helsinki_metro&compare=00300,00400');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
    expect(state.layer).toBe('unemployment');
    expect(state.city).toBe('helsinki_metro');
    expect(state.compare).toEqual(['00300', '00400']);
  });
});
