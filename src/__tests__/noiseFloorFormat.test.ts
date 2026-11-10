import { describe, it, expect } from 'vitest';
import { NOISE_FLOOR_DB, getLayerById } from '../utils/colorScales';
import fi from '../locales/fi.json';

// The noise pipeline writes NOISE_FLOOR_DB for an area no mapped noise zone reaches.
// That is a bound ("quieter than the lowest zone"), so it must never print as a reading.
describe('noise floor formatting', () => {
  const layer = getLayerById('noise_pollution');

  it('prints the floor as "outside noise zones", not as 40.0 dB', () => {
    const out = layer.format(NOISE_FLOOR_DB);
    expect(out).toBe((fi as Record<string, string>)['noise.outside_zones']);
    expect(out).not.toMatch(/dB/);
  });

  it('prints any other value in decibels', () => {
    expect(layer.format(45.3)).toBe('45.3 dB');
    expect(layer.format(62)).toBe('62.0 dB');
  });
});
