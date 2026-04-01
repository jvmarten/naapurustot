import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('useUrlState - readInitialUrlState', () => {
  beforeEach(() => {
    // Reset URL state
    window.history.replaceState(null, '', '/');
  });

  it('returns null pno when no params', () => {
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });

  it('parses valid pno from query params', () => {
    window.history.replaceState(null, '', '/?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects invalid pno (non-5-digit)', () => {
    window.history.replaceState(null, '', '/?pno=123');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=abcde');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=001001');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('parses valid layer from query params', () => {
    window.history.replaceState(null, '', '/?layer=median_income');
    expect(readInitialUrlState().layer).toBe('median_income');
  });

  it('rejects invalid layer id', () => {
    window.history.replaceState(null, '', '/?layer=nonexistent_layer');
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('parses compare list', () => {
    window.history.replaceState(null, '', '/?compare=00100,00200,33100');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '33100']);
  });

  it('filters invalid pnos from compare list', () => {
    window.history.replaceState(null, '', '/?compare=00100,abc,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('parses valid city', () => {
    window.history.replaceState(null, '', '/?city=helsinki_metro');
    expect(readInitialUrlState().city).toBe('helsinki_metro');

    window.history.replaceState(null, '', '/?city=all');
    expect(readInitialUrlState().city).toBe('all');

    window.history.replaceState(null, '', '/?city=turku');
    expect(readInitialUrlState().city).toBe('turku');
  });

  it('rejects invalid city', () => {
    window.history.replaceState(null, '', '/?city=unknown_city');
    expect(readInitialUrlState().city).toBeNull();
  });

  it('reads from hash for legacy URLs', () => {
    window.history.replaceState(null, '', '/#pno=00100&layer=unemployment');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('unemployment');
  });

  it('migrates hash params to query params', () => {
    window.history.replaceState(null, '', '/#pno=00100&city=turku');
    readInitialUrlState();
    // After migration, URL should have query params
    expect(window.location.search).toContain('pno=00100');
    expect(window.location.search).toContain('city=turku');
    expect(window.location.hash).toBe(''); // hash should be cleared (by replaceState)
  });

  it('prefers query params over hash when both present', () => {
    window.history.replaceState(null, '', '/?pno=00200#pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });

  it('parses all params together', () => {
    window.history.replaceState(null, '', '/?pno=00100&layer=median_income&compare=00200,00300&city=helsinki_metro');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
    expect(state.compare).toEqual(['00200', '00300']);
    expect(state.city).toBe('helsinki_metro');
  });

  it('handles empty compare param', () => {
    window.history.replaceState(null, '', '/?compare=');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });
});
