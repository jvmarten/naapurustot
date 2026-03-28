import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — URL parsing', () => {
  beforeEach(() => {
    // Reset URL state
    window.history.replaceState(null, '', '/');
  });

  it('returns null for all fields when URL has no params', () => {
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

  it('rejects invalid pno (not 5 digits)', () => {
    window.history.replaceState(null, '', '/?pno=123');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=abcde');
    expect(readInitialUrlState().pno).toBeNull();

    window.history.replaceState(null, '', '/?pno=123456');
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('parses valid layer from query params', () => {
    window.history.replaceState(null, '', '/?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('rejects invalid layer id', () => {
    window.history.replaceState(null, '', '/?layer=nonexistent_layer');
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('parses compare list from query params', () => {
    window.history.replaceState(null, '', '/?compare=00100,00200,00300');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('filters invalid entries from compare list', () => {
    window.history.replaceState(null, '', '/?compare=00100,abc,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('parses valid city from query params', () => {
    window.history.replaceState(null, '', '/?city=turku');
    expect(readInitialUrlState().city).toBe('turku');

    window.history.replaceState(null, '', '/?city=all');
    expect(readInitialUrlState().city).toBe('all');

    window.history.replaceState(null, '', '/?city=tampere');
    expect(readInitialUrlState().city).toBe('tampere');
  });

  it('rejects invalid city', () => {
    window.history.replaceState(null, '', '/?city=oulu');
    expect(readInitialUrlState().city).toBeNull();
  });

  it('reads from legacy hash format when no query params', () => {
    window.history.replaceState(null, '', '/#pno=00100&layer=median_income');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('prefers query params over hash when both present', () => {
    window.history.replaceState(null, '', '/?pno=00100#pno=00200');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('handles empty compare param', () => {
    window.history.replaceState(null, '', '/?compare=');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('parses all params together', () => {
    window.history.replaceState(null, '', '/?pno=00100&layer=unemployment&compare=00200,00300&city=helsinki_metro');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('unemployment');
    expect(state.compare).toEqual(['00200', '00300']);
    expect(state.city).toBe('helsinki_metro');
  });
});
