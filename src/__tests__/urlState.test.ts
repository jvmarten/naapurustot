import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

// Helper to set query params in jsdom
function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('readInitialUrlState (query params)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('extracts pno from query params', () => {
    setSearch('?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('extracts layer from query params', () => {
    setSearch('?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('extracts compare param as comma-separated PNOs', () => {
    setSearch('?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('extracts all params together', () => {
    setSearch('?pno=00100&layer=quality_index&compare=00200,00300');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('quality_index');
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('validates 5-digit PNO format and rejects invalid values', () => {
    setSearch('?pno=1234');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=123456');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=abcde');
    expect(readInitialUrlState().pno).toBeNull();

    setSearch('?pno=0010a');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('validates layer IDs and rejects invalid values', () => {
    setSearch('?layer=invalid_layer');
    expect(readInitialUrlState().layer).toBeNull();

    setSearch('?layer=');
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('filters invalid PNOs from compare param', () => {
    setSearch('?compare=00100,abc,00200,1234,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('returns empty compare array when param is absent', () => {
    setSearch('?pno=00100');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('returns all nulls/empty for empty URL', () => {
    setSearch('');
    window.location.hash = '';
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
  });
});

describe('readInitialUrlState (legacy hash fallback)', () => {
  beforeEach(() => {
    window.location.hash = '';
    setSearch('');
  });

  it('falls back to hash params for backwards compatibility', () => {
    window.location.hash = '#pno=00100&layer=median_income';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('prefers query params over hash params', () => {
    setSearch('?pno=00200');
    window.location.hash = '#pno=00100';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });
});
