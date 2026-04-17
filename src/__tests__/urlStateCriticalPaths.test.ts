import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — query param parsing', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, search: '', hash: '', pathname: '/' },
    });
    window.history.replaceState = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('parses valid PNO from query params', () => {
    window.location.search = '?pno=00100';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects PNO that is not 5 digits', () => {
    window.location.search = '?pno=1234';
    expect(readInitialUrlState().pno).toBeNull();

    window.location.search = '?pno=123456';
    expect(readInitialUrlState().pno).toBeNull();

    window.location.search = '?pno=abcde';
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('parses valid layer from query params', () => {
    window.location.search = '?layer=median_income';
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('rejects invalid layer id', () => {
    window.location.search = '?layer=nonexistent_layer';
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('parses compare list correctly', () => {
    window.location.search = '?compare=00100,00200,00300';
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters invalid PNOs from compare list', () => {
    window.location.search = '?compare=00100,abc,00200';
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('parses valid city from query params', () => {
    window.location.search = '?city=all';
    expect(readInitialUrlState().city).toBe('all');

    window.location.search = '?city=helsinki_metro';
    expect(readInitialUrlState().city).toBe('helsinki_metro');
  });

  it('rejects invalid city values', () => {
    window.location.search = '?city=invalid_city';
    expect(readInitialUrlState().city).toBeNull();
  });

  it('returns all-null defaults for empty URL', () => {
    window.location.search = '';
    window.location.hash = '';
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });
});

describe('readInitialUrlState — hash migration', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, search: '', hash: '', pathname: '/' },
    });
    window.history.replaceState = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('reads from hash when query params are empty', () => {
    window.location.search = '';
    window.location.hash = '#pno=00100&layer=median_income';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('migrates hash params to query params', () => {
    window.location.search = '';
    window.location.hash = '#pno=00100';
    readInitialUrlState();
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('does not read hash when query params exist', () => {
    window.location.search = '?pno=00200';
    window.location.hash = '#pno=00100';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });

  it('reads city from hash', () => {
    window.location.search = '';
    window.location.hash = '#city=all';
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('reads compare from hash', () => {
    window.location.search = '';
    window.location.hash = '#compare=00100,00200';
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });
});
