import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import { getLayerById, layerForCountry, layerInCountry } from '../utils/colorScales';

function feature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { nimi: 'T', namn: 'T', ...props } as unknown as NeighborhoodProperties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

// Sweden keeps no language statistics, so the foreign-language layer shows SCB's
// foreign background there — on Finland's scale, with a note saying they differ.
describe('foreign_lang across both countries', () => {
  it("reads Finland's language estimate and Sweden's foreign background into one property", () => {
    const fi = feature({ pno: '00100', foreign_language_est_pct: 12.5, foreign_background_pct: null });
    const se = feature({ pno: '0180C1090', foreign_background_pct: 31.2 });
    computeQuickWinMetrics([fi, se]);
    expect((fi.properties as NeighborhoodProperties).foreign_share_pct).toBe(12.5);
    expect((se.properties as NeighborhoodProperties).foreign_share_pct).toBe(31.2);
  });

  it('leaves the property absent where the source has no value', () => {
    const se = feature({ pno: '0180C1090', foreign_background_pct: null });
    computeQuickWinMetrics([se]);
    expect((se.properties as NeighborhoodProperties).foreign_share_pct).toBeUndefined();
  });

  it("is offered in Sweden on Finland's scale, under Sweden's own label, with a note", () => {
    const l = getLayerById('foreign_lang');
    expect(l.property).toBe('foreign_share_pct');
    expect(layerInCountry('foreign_lang', 'se')).toBe(true);
    const se = layerForCountry(l, 'se');
    expect(se.stops).toEqual(l.stops);
    expect(se.labelKey).toBe('layer.foreign_background');
    expect(l.crossCountryNoteKey).toBeTruthy();
    expect(layerForCountry(l, 'fi')).toBe(l);
  });
});
