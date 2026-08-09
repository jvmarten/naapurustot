import { describe, it, expect } from 'vitest';
import cardSrc from '../../scripts/social-card.mjs?raw';
import { getLayerById } from '../utils/colorScales';

/**
 * scripts/social-card.mjs carries its own copy of the quality ramp, deliberately: it
 * renders both the build-time og cards and the runtime shortlist card, and importing
 * colorScales.ts there would pull the whole 76-layer registry into that path.
 *
 * A duplicate is fine; a duplicate that can drift silently is not. The share card would
 * simply start colouring scores differently from the map with nothing to catch it.
 */
describe('quality ramp parity', () => {
  const src = cardSrc as string;

  it('social-card.mjs matches the quality_index layer ramp', () => {
    const colors = /const QI_COLORS = \[([^\]]+)\]/.exec(src);
    const stops = /const QI_STOPS = \[([^\]]+)\]/.exec(src);
    expect(colors, 'QI_COLORS not found — did the card renderer change shape?').toBeTruthy();
    expect(stops, 'QI_STOPS not found').toBeTruthy();

    const parsed = colors![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    const parsedStops = stops![1].split(',').map((s) => Number(s.trim()));
    const layer = getLayerById('quality_index');

    expect(parsed).toEqual(layer.colors);
    expect(parsedStops).toEqual(layer.stops);
  });

  it('is a red-to-green ramp: it starts red-side and ends green-side', () => {
    const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const { colors } = getLayerById('quality_index');
    const [r0, g0] = rgb(colors[0]);
    const [rN, gN] = rgb(colors[colors.length - 1]);
    expect(r0, 'lowest score must read red, not purple/blue').toBeGreaterThan(g0);
    expect(gN, 'highest score must read green').toBeGreaterThan(rN);
  });
});
