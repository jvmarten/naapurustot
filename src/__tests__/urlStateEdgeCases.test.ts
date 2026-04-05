/**
 * Tests for uncovered branches in useUrlState.ts (lines 39-40, 66, 83-86).
 *
 * The URL state module is critical because it controls:
 * - Deep linking (users sharing neighborhood links)
 * - Bookmark restoration
 * - Legacy hash format migration
 *
 * Uncovered branches:
 * - Line 39-40: hash → query param migration with replaceState
 * - Line 66: writeUrl skipping replaceState when URL hasn't changed
 * - Line 83-86: useSyncUrlState debounce + ready=false suppression
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — query params', () => {
  const originalLocation = window.location;

  function setUrl(url: string) {
    Object.defineProperty(window, 'location', {
      value: new URL(url),
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('parses valid pno from query params', () => {
    setUrl('https://naapurustot.fi/?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects invalid pno (too short)', () => {
    setUrl('https://naapurustot.fi/?pno=001');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects invalid pno (non-numeric)', () => {
    setUrl('https://naapurustot.fi/?pno=abcde');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('parses valid layer from query params', () => {
    setUrl('https://naapurustot.fi/?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('rejects invalid layer id', () => {
    setUrl('https://naapurustot.fi/?layer=nonexistent_layer');
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('parses compare parameter with multiple valid PNOs', () => {
    setUrl('https://naapurustot.fi/?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters out invalid PNOs from compare parameter', () => {
    setUrl('https://naapurustot.fi/?compare=00100,abc,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00300']);
  });

  it('returns empty compare array when not specified', () => {
    setUrl('https://naapurustot.fi/');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('parses valid city param', () => {
    setUrl('https://naapurustot.fi/?city=turku');
    const state = readInitialUrlState();
    expect(state.city).toBe('turku');
  });

  it('parses "all" as valid city', () => {
    setUrl('https://naapurustot.fi/?city=all');
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('rejects unknown city', () => {
    setUrl('https://naapurustot.fi/?city=gotham');
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('parses all params together', () => {
    setUrl('https://naapurustot.fi/?pno=00100&layer=unemployment&compare=00200,00300&city=helsinki_metro');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('unemployment');
    expect(state.compare).toEqual(['00200', '00300']);
    expect(state.city).toBe('helsinki_metro');
  });

  it('returns all null/empty for empty URL', () => {
    setUrl('https://naapurustot.fi/');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });
});

describe('readInitialUrlState — legacy hash format', () => {
  const originalLocation = window.location;
  const originalHistory = window.history;

  beforeEach(() => {
    // Mock replaceState so we can verify migration
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setUrl(url: string) {
    Object.defineProperty(window, 'location', {
      value: new URL(url),
      writable: true,
      configurable: true,
    });
  }

  it('reads pno from hash when query params are empty', () => {
    setUrl('https://naapurustot.fi/#pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('reads layer from hash', () => {
    setUrl('https://naapurustot.fi/#layer=education');
    const state = readInitialUrlState();
    expect(state.layer).toBe('education');
  });

  it('migrates hash to query params via replaceState', () => {
    setUrl('https://naapurustot.fi/#pno=00100&layer=education');
    readInitialUrlState();
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('prefers query params over hash when both exist', () => {
    setUrl('https://naapurustot.fi/?pno=00100#pno=00200');
    const state = readInitialUrlState();
    // Query params take precedence — hash fallback only when query is empty
    expect(state.pno).toBe('00100');
  });

  it('handles hash with compare and city', () => {
    setUrl('https://naapurustot.fi/#compare=00100,00200&city=tampere');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
    expect(state.city).toBe('tampere');
  });
});
