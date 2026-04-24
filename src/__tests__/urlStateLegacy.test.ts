/**
 * Tests for URL state parsing — legacy hash format and validation.
 *
 * The app supports both ?pno=00100 (current) and #pno=00100 (legacy).
 * Legacy URLs must be silently migrated to query params. Invalid values
 * must be sanitized to prevent broken selections and XSS via URL params.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readInitialUrlState } from '../hooks/useUrlState';

describe('readInitialUrlState — query params', () => {
  const originalLocation = window.location;

  function setUrl(url: string) {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(url, 'http://localhost'),
    });
    window.history.replaceState = () => {};
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('parses valid pno from query params', () => {
    setUrl('http://localhost/?pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('parses valid layer from query params', () => {
    setUrl('http://localhost/?layer=median_income');
    const state = readInitialUrlState();
    expect(state.layer).toBe('median_income');
  });

  it('rejects invalid pno (not 5 digits)', () => {
    setUrl('http://localhost/?pno=abc');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects invalid pno (6 digits)', () => {
    setUrl('http://localhost/?pno=001001');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });

  it('rejects invalid layer ID', () => {
    setUrl('http://localhost/?layer=nonexistent_layer');
    const state = readInitialUrlState();
    expect(state.layer).toBeNull();
  });

  it('parses compare list and filters invalid entries', () => {
    setUrl('http://localhost/?compare=00100,invalid,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('accepts "all" as a valid city', () => {
    setUrl('http://localhost/?city=all');
    const state = readInitialUrlState();
    expect(state.city).toBe('all');
  });

  it('accepts region ID as valid city', () => {
    setUrl('http://localhost/?city=helsinki_metro');
    const state = readInitialUrlState();
    expect(state.city).toBe('helsinki_metro');
  });

  it('rejects unknown city', () => {
    setUrl('http://localhost/?city=unknown_place');
    const state = readInitialUrlState();
    expect(state.city).toBeNull();
  });

  it('returns all nulls for empty URL', () => {
    setUrl('http://localhost/');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
    expect(state.layer).toBeNull();
    expect(state.compare).toEqual([]);
    expect(state.city).toBeNull();
  });

  it('rejects script injection in pno', () => {
    setUrl('http://localhost/?pno=<script>alert(1)</script>');
    const state = readInitialUrlState();
    expect(state.pno).toBeNull();
  });
});

describe('readInitialUrlState — legacy hash format', () => {
  function setUrl(url: string) {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(url, 'http://localhost'),
    });
    window.history.replaceState = () => {};
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL('http://localhost/'),
    });
  });

  it('reads pno from hash when query params are absent', () => {
    setUrl('http://localhost/#pno=00100');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });

  it('reads layer from hash', () => {
    setUrl('http://localhost/#layer=unemployment');
    const state = readInitialUrlState();
    expect(state.layer).toBe('unemployment');
  });

  it('reads compare from hash', () => {
    setUrl('http://localhost/#compare=00100,00200');
    const state = readInitialUrlState();
    expect(state.compare).toEqual(['00100', '00200']);
  });

  it('query params take precedence over hash', () => {
    setUrl('http://localhost/?pno=00100#pno=00200');
    const state = readInitialUrlState();
    expect(state.pno).toBe('00100');
  });
});
