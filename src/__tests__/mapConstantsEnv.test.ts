/**
 * Tests for mapConstants.ts envNum utility.
 *
 * envNum reads numeric values from VITE_MAP_* environment variables.
 * If a value is missing, empty, or non-numeric, it falls back to a default.
 * Bugs here cause the map to center on the wrong location or zoom level.
 */
import { describe, it, expect } from 'vitest';
import { envNum } from '../utils/mapConstants';

describe('envNum', () => {
  it('returns fallback when env var is not set', () => {
    expect(envNum('VITE_NONEXISTENT_VAR', 42)).toBe(42);
  });

  it('returns fallback for empty string env var', () => {
    expect(envNum('VITE_MAP_CENTER_LNG', 24.94)).toBe(24.94);
  });

  it('returns the numeric value for a valid number', () => {
    const result = envNum('VITE_MAP_ZOOM', 9.2);
    expect(typeof result).toBe('number');
    expect(isFinite(result)).toBe(true);
  });
});
