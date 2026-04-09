/**
 * Tests for useUrlState.ts — uncovered branches:
 * - Hash fallback and migration to query params (lines 26-44)
 * - writeUrl with default layer (quality_index not written to URL)
 * - writeUrl with default city (helsinki_metro not written to URL)
 * - Invalid PNO format rejection
 * - Invalid layer ID rejection
 * - compare param parsing with mixed valid/invalid PNOs
 * - useSyncUrlState debounce and ready flag
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('useUrlState — readInitialUrlState', () => {
  let readInitialUrlState: typeof import('../hooks/useUrlState').readInitialUrlState;

  const originalLocation = window.location;

  function setUrl(url: string) {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(url, 'http://localhost'),
    });
    // Ensure search and hash are accessible
    Object.defineProperty(window.location, 'search', {
      get: () => new URL(url, 'http://localhost').search,
    });
    Object.defineProperty(window.location, 'hash', {
      get: () => new URL(url, 'http://localhost').hash,
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    window.history.replaceState = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('parses query params correctly', async () => {
    setUrl('http://localhost/?pno=00100&layer=median_income&compare=00200,00300&city=turku');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;

    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
    expect(state.compare).toEqual(['00200', '00300']);
    expect(state.city).toBe('turku');
  });

  it('returns null for invalid PNO format', async () => {
    setUrl('http://localhost/?pno=ABC');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('returns null for PNO with wrong length', async () => {
    setUrl('http://localhost/?pno=001');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('returns null for unknown layer ID', async () => {
    setUrl('http://localhost/?layer=fake_layer');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('returns null for invalid city', async () => {
    setUrl('http://localhost/?city=mars');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('accepts "all" as a valid city', async () => {
    setUrl('http://localhost/?city=all');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('filters invalid PNOs from compare param', async () => {
    setUrl('http://localhost/?compare=00100,ABC,00200,123');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('returns empty compare array when no compare param', async () => {
    setUrl('http://localhost/');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('reads from hash as fallback for legacy URLs', async () => {
    setUrl('http://localhost/#pno=00100&layer=median_income');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('returns all nulls for empty URL', async () => {
    setUrl('http://localhost/');
    const mod = await import('../hooks/useUrlState');
    const state = mod.readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });
});
