import { describe, it, expect, beforeEach, vi } from 'vitest';

let readInitialUrlState: typeof import('../hooks/useUrlState').readInitialUrlState;

describe('readInitialUrlState critical paths', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  function setUrl(search: string, hash = '') {
    Object.defineProperty(window, 'location', {
      value: {
        search,
        hash,
        pathname: '/',
      },
      writable: true,
      configurable: true,
    });
    window.history.replaceState = vi.fn();
  }

  it('reads pno from query params', async () => {
    setUrl('?pno=00100');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('reads layer from query params', async () => {
    setUrl('?layer=median_income');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('returns null for invalid layer id', async () => {
    setUrl('?layer=fake_layer');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('returns null for invalid pno (not 5 digits)', async () => {
    setUrl('?pno=123');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('parses compare as comma-separated postal codes', async () => {
    setUrl('?compare=00100,00200,00300');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters invalid entries from compare list', async () => {
    setUrl('?compare=00100,abc,00200');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('handles empty compare string', async () => {
    setUrl('?compare=');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('reads city from query params', async () => {
    setUrl('?city=turku');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.city).toBe('turku');
  });

  it('returns null for invalid city', async () => {
    setUrl('?city=narnia');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('accepts "all" as city', async () => {
    setUrl('?city=all');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('falls back to hash for legacy URLs', async () => {
    setUrl('', '#pno=00100&layer=median_income');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
    // Should have triggered migration
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('prefers query params over hash', async () => {
    setUrl('?pno=00200', '#pno=00100');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });

  it('returns all null/empty for empty URL', async () => {
    setUrl('');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });

  it('accepts city ids as valid pno values (for metro area selection)', async () => {
    setUrl('?pno=all');
    const mod = await import('../hooks/useUrlState');
    readInitialUrlState = mod.readInitialUrlState;
    const state = readInitialUrlState();
    expect(state.pno).toBe('all');
  });
});
