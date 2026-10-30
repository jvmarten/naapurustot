import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics, computeMetroAverages, pop20to64 } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import { getLayerById, layerForCountry } from '../utils/colorScales';
import { ages2064 } from './ages2064';

function feature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'T', namn: 'T', ...props } as unknown as NeighborhoodProperties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

const rate = (f: GeoJSON.Feature) => (f.properties as NeighborhoodProperties).employment_rate;

// Finland's rate is employed per 100 residents aged 20–64 — SCB's definition, so it
// shares a scale with Sweden's (the map once put 41 % next to 83.5 % for one key).
describe('employment rate on a 20–64 basis', () => {
  it('divides by residents aged 20–64, not by all residents', () => {
    const f = feature({ he_vakiy: 2000, pt_vakiy: 2000, pt_tyoll: 900, ...ages2064(1200) });
    computeQuickWinMetrics([f]);
    expect(rate(f)).toBe(75);
  });

  it('gives no value when an age band is suppressed', () => {
    const f = feature({ he_vakiy: 2000, pt_tyoll: 900, ...ages2064(1200), he_55_59: null });
    expect(pop20to64(f.properties as NeighborhoodProperties)).toBeNull();
    computeQuickWinMetrics([f]);
    expect(rate(f)).toBeUndefined();
  });

  it('gives no value when the employed outnumber the 20–64 population', () => {
    // Working over-64s in a small village: the approximation has failed, so no 109 %.
    const f = feature({ he_vakiy: 31, pt_tyoll: 12, ...ages2064(11) });
    computeQuickWinMetrics([f]);
    expect(rate(f)).toBeUndefined();
  });

  it('pools Finnish and Swedish counts in a mixed selection', () => {
    const avg = computeMetroAverages([
      feature({ pno: '00100', he_vakiy: 2000, pt_tyoll: 700, ...ages2064(1000) }),
      feature({ pno: '0180C1090', he_vakiy: 1500, se_emp: 900, se_pop2064: 1000 }),
    ]);
    expect(avg.employment_rate).toBe(80);
  });

  it('draws both countries on one scale', () => {
    const l = getLayerById('employment_rate');
    expect(l.stopsSe).toBeUndefined();
    expect(layerForCountry(l, 'se')).toBe(l);
  });
});
