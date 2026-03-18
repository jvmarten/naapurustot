import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState (parseHash)', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('extracts pno from the hash', () => {
    window.location.hash = '#pno=00100';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('extracts layer from the hash', () => {
    window.location.hash = '#layer=median_income';
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('extracts compare param as comma-separated PNOs', () => {
    window.location.hash = '#compare=00100,00200,00300';
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('extracts all params together', () => {
    window.location.hash = '#pno=00100&layer=quality_index&compare=00200,00300';
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('quality_index');
    expect(state.compare).toEqual(['00200', '00300']);
  });

  it('validates 5-digit PNO format and rejects invalid values', () => {
    window.location.hash = '#pno=1234';
    expect(readInitialUrlState().pno).toBeNull();

    window.location.hash = '#pno=123456';
    expect(readInitialUrlState().pno).toBeNull();

    window.location.hash = '#pno=abcde';
    expect(readInitialUrlState().pno).toBeNull();

    window.location.hash = '#pno=0010a';
    expect(readInitialUrlState().pno).toBeNull();
  });

  it('validates layer IDs and rejects invalid values', () => {
    window.location.hash = '#layer=invalid_layer';
    expect(readInitialUrlState().layer).toBeNull();

    window.location.hash = '#layer=';
    expect(readInitialUrlState().layer).toBeNull();
  });

  it('filters invalid PNOs from compare param', () => {
    window.location.hash = '#compare=00100,abc,00200,1234,00300';
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200', '00300']);
  });

  it('returns empty compare array when param is absent', () => {
    window.location.hash = '#pno=00100';
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('returns all nulls/empty for empty hash', () => {
    window.location.hash = '';
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
  });
});
