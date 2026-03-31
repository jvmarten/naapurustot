import { describe, it, expect, afterEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('reads pno from query params', () => {
    window.history.replaceState(null, '', '/?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('reads layer from query params', () => {
    window.history.replaceState(null, '', '/?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('reads compare array from query params', () => {
    window.history.replaceState(null, '', '/?compare=00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('reads city from query params', () => {
    window.history.replaceState(null, '', '/?city=turku');
    const state = readInitialUrlState();
    expect(state.city).toBe('turku');
  });

  it('returns null/empty for no params', () => {
    window.history.replaceState(null, '', '/');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });

  it('validates pno format (5 digits only)', () => {
    window.history.replaceState(null, '', '/?pno=abc');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=1234');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=123456');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('validates layer against known LayerIds', () => {
    window.history.replaceState(null, '', '/?layer=nonexistent');
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('validates city against allowed set', () => {
    window.history.replaceState(null, '', '/?city=invalid_city');
    expect(readInitialUrlState().city).toBeNull();
  });

  it('filters invalid PNOs from compare list', () => {
    window.history.replaceState(null, '', '/?compare=00200,abc,00300,12');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('reads from legacy hash format', () => {
    window.history.replaceState(null, '', '/#pno=00100&layer=unemployment');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('unemployment');
  });

  it('migrates hash params to query params', () => {
    window.history.replaceState(null, '', '/#pno=00100');
    readInitialUrlState();
    // After reading, the hash should be migrated to query params
    expect(window.location.search).toContain('pno=00100');
  });

  it('handles combined params', () => {
    window.history.replaceState(null, '', '/?pno=00100&layer=median_income&city=helsinki_metro&compare=00200');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
    expect(state.city).toBe('helsinki_metro');
    expect(state.compare).toEqual(['00200']);
  });

  it('prefers query params over hash when both present', () => {
    window.history.replaceState(null, '', '/?pno=00100#pno=00200');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });
});
