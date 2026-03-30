import { describe, it, expect, beforeEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — input validation and security', () => {
  beforeEach(() => {
    // Reset to clean URL
    window.history.replaceState(null, '', '/');
  });

  it('rejects non-numeric PNO', () => {
    window.history.replaceState(null, '', '/?pno=abcde');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects PNO with fewer than 5 digits', () => {
    window.history.replaceState(null, '', '/?pno=1234');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects PNO with more than 5 digits', () => {
    window.history.replaceState(null, '', '/?pno=123456');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('accepts valid 5-digit PNO', () => {
    window.history.replaceState(null, '', '/?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('rejects HTML injection in PNO', () => {
    window.history.replaceState(null, '', '/?pno=<script>');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects invalid layer ID', () => {
    window.history.replaceState(null, '', '/?layer=invalid_layer');
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('accepts valid layer ID', () => {
    window.history.replaceState(null, '', '/?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('filters invalid PNOs from compare param', () => {
    window.history.replaceState(null, '', '/?compare=00100,abcde,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('returns empty compare for all-invalid PNOs', () => {
    window.history.replaceState(null, '', '/?compare=abc,xyz');
    const state = readInitialUrlState();
    expect(state.compare).toEqual([]);
  });

  it('rejects invalid city values', () => {
    window.history.replaceState(null, '', '/?city=invalid');
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('accepts valid city values', () => {
    window.history.replaceState(null, '', '/?city=turku');
    const state = readInitialUrlState();
    expect(state.city).toBe('turku');
  });

  it('accepts "all" as city', () => {
    window.history.replaceState(null, '', '/?city=all');
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('handles empty query params gracefully', () => {
    window.history.replaceState(null, '', '/?pno=&layer=&compare=');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
  });

  it('reads from hash for backwards compatibility', () => {
    window.history.replaceState(null, '', '/#pno=00100&layer=median_income');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
    expect(state.layer).toBe('median_income');
  });

  it('prefers query params over hash', () => {
    window.history.replaceState(null, '', '/?pno=00200#pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00200');
  });

  it('handles special characters in params without crashing', () => {
    window.history.replaceState(null, '', '/?pno=%3Cscript%3E&layer=%22test%22');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
  });

  it('handles params with no query string', () => {
    window.history.replaceState(null, '', '/');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });
});
