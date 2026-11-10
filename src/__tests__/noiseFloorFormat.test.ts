import { describe, it, expect } from 'vitest';
import { NOISE_FLOOR_DB, formatNoise, getLayerById } from '../utils/colorScales';
import fi from '../locales/fi.json';

const FI = fi as Record<string, string>;

// The noise pipeline writes NOISE_FLOOR_DB for an area no mapped noise zone reaches, and
// noise_floor_db for the survey's lowest zone. The area is quiet, below that zone — so it
// must read as quiet with its real bound, never as a measured "40.0 dB".
describe('noise floor formatting', () => {
  const layer = getLayerById('noise_pollution');

  it('prints an area outside every zone as quiet, under its survey\'s lowest zone', () => {
    expect(formatNoise(NOISE_FLOOR_DB, 45)).toBe(FI['noise.quiet_below'].replace('{db}', '45'));
    expect(formatNoise(NOISE_FLOOR_DB, 55)).toContain('55 dB');
  });

  it('prints the background value as quiet where no bound is at hand (legend, rankings)', () => {
    expect(layer.format(NOISE_FLOOR_DB)).toBe(FI['noise.quiet']);
    expect(formatNoise(NOISE_FLOOR_DB, null)).toBe(FI['noise.quiet']);
  });

  it('prints any measured value in decibels', () => {
    expect(layer.format(45.3)).toBe('45.3 dB');
    expect(formatNoise(62, undefined)).toBe('62.0 dB');
  });
});
