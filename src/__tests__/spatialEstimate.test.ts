import { describe, it, expect } from 'vitest';
import regionProperties from '../data/region_properties.json';
import {
  addNeighbourEstimates,
  estimateFor,
  estimateKey,
  hasEstimates,
  isEstimateKey,
  neighbourEstimates,
  ESTIMATE_PARAMS,
} from '../utils/spatialEstimate';
import { buildFillColorExpression, getLayerById } from '../utils/colorScales';
import { computeMetroAverages } from '../utils/metrics';
import { decodeColumnar } from '../utils/columnar';

// ~0.009° of latitude is 1 km.
const KM = 1 / 111.195;
const row = (pno: string, lat: number, lon: number, extra: Record<string, unknown> = {}) => ({ pno, lat, lon, ...extra });

describe('neighbourEstimates', () => {
  it('leaves measured rows alone and weights nearer measured areas more', () => {
    const rows = [
      row('00100', 60, 25, { v: 1000 }),
      row('00200', 60 + 10 * KM, 25, { v: 3000 }),
      row('00300', 60 + 2 * KM, 25), // 2 km from the 1000, 8 km from the 3000
    ];
    const est = neighbourEstimates(rows, 'v', 0);
    expect(est[0]).toBeNull();
    expect(est[1]).toBeNull();
    // weights 1/4 and 1/64 → (1000·16 + 3000) / 17
    expect(est[2]).toBeCloseTo((1000 * 16 + 3000) / 17, 0);
  });

  it('never leaves the range of the values it was made from', () => {
    const rows = [row('00100', 60, 25, { v: 10 }), row('00200', 60.05, 25.05, { v: 20 }), row('00300', 60.02, 25.3)];
    const [, , e] = neighbourEstimates(rows, 'v', 2);
    expect(e).toBeGreaterThanOrEqual(10);
    expect(e).toBeLessThanOrEqual(20);
  });

  it('makes no estimate with too few measured areas in range', () => {
    const far = ESTIMATE_PARAMS.maxDistanceKm + 5;
    const rows = [
      row('00100', 60, 25, { v: 1000 }),
      row('00200', 60 + far * KM, 25, { v: 2000 }),
      row('00300', 60 + 1 * KM, 25), // only one measured area within range
    ];
    expect(neighbourEstimates(rows, 'v', 0)[2]).toBeNull();
  });

  it('makes no estimate for an area nobody lives in', () => {
    const rows = [row('00100', 60, 25, { v: 1000 }), row('00200', 60.01, 25, { v: 2000 }), row('00230', 60.005, 25, { he_vakiy: 0 })];
    expect(neighbourEstimates(rows, 'v', 0)[2]).toBeNull();
  });

  it('never estimates from another country', () => {
    const rows = [
      row('0180C1090', 60, 25, { v: 1000 }),
      row('0180C1100', 60.01, 25, { v: 1000 }),
      row('00300', 60.005, 25),
    ];
    expect(neighbourEstimates(rows, 'v', 0)[2]).toBeNull();
  });

  it('never builds an estimate from another estimate', () => {
    const rows: Record<string, unknown>[] = [
      row('00100', 60, 25, { property_price_sqm: 1000, rental_price_sqm: 10 }),
      row('00200', 60.01, 25, { property_price_sqm: 2000, rental_price_sqm: 12 }),
      row('00300', 60.02, 25),
      row('00400', 60.03, 25),
    ];
    addNeighbourEstimates(rows);
    // 00400 must come from the two measured rows only, not from 00300's estimate.
    const direct = neighbourEstimates(rows, 'property_price_sqm', 0)[3];
    expect(rows[3][estimateKey('property_price_sqm')]).toBe(direct);
  });
});

describe('addNeighbourEstimates', () => {
  it('writes only <prop>_est and never touches a measured key', () => {
    const rows: Record<string, unknown>[] = [
      row('00100', 60, 25, { property_price_sqm: 1000, rental_price_sqm: 10, price_to_rent_ratio: 8.3 }),
      row('00200', 60.01, 25, { property_price_sqm: 2000, rental_price_sqm: 12, price_to_rent_ratio: 13.9 }),
      row('00300', 60.02, 25, { property_price_sqm: 1500 }),
    ];
    const before = JSON.stringify(rows.slice(0, 2));
    addNeighbourEstimates(rows);
    expect(JSON.stringify(rows.slice(0, 2))).toBe(before);
    expect(rows[2].property_price_sqm).toBe(1500);
    expect(rows[2][estimateKey('property_price_sqm')]).toBeUndefined();
    expect(rows[2].rental_price_sqm).toBeUndefined();
    const rent = rows[2][estimateKey('rental_price_sqm')] as number;
    expect(rent).toBeGreaterThan(10);
    // Derived exactly as the measured ratio is: price / (rent × 12).
    expect(rows[2][estimateKey('price_to_rent_ratio')]).toBeCloseTo(1500 / (rent * 12), 1);
  });

  it('estimates each year of a price series from that year\'s measured areas only', () => {
    const rows: Record<string, unknown>[] = [
      row('00100', 60, 25, { property_price_history: [[2020, 1000], [2021, 1100]] }),
      row('00200', 60.01, 25, { property_price_history: JSON.stringify([[2020, 2000], [2021, 2200]]) }),
      row('00300', 60.02, 25, { property_price_history: [[2020, 3000]] }),
      row('00400', 60.005, 25),
    ];
    addNeighbourEstimates(rows);
    // Measured that year → no estimate; suppressed that year → one from that year.
    expect(rows[2]['property_price_history__2020_est']).toBeUndefined();
    const est2021 = rows[2]['property_price_history__2021_est'] as number;
    expect(est2021).toBeGreaterThan(1100);
    expect(est2021).toBeLessThan(2200);
    const est2020 = rows[3]['property_price_history__2020_est'] as number;
    expect(est2020).toBeGreaterThan(1000);
    expect(est2020).toBeLessThan(3000);
    expect(rows[0]['property_price_history__2020_est']).toBeUndefined();
  });
});

describe('estimate helpers', () => {
  it('only reports an estimate where there is no measured value', () => {
    expect(estimateFor({ property_price_sqm: null, property_price_sqm_est: 2000 }, 'property_price_sqm')).toBe(2000);
    expect(estimateFor({ property_price_sqm: 3000, property_price_sqm_est: 2000 }, 'property_price_sqm')).toBeNull();
    expect(estimateFor({ hr_mtu: null, hr_mtu_est: 2000 }, 'hr_mtu')).toBeNull();
    expect(isEstimateKey('rental_price_sqm_est')).toBe(true);
    expect(isEstimateKey('hr_mtu_est')).toBe(false);
    expect(hasEstimates('price_to_rent_ratio')).toBe(true);
  });

  it('the map paints a no-data area from its estimate, and only for layers that have one', () => {
    const price = JSON.stringify(buildFillColorExpression(getLayerById('property_price')));
    expect(price).toContain('property_price_sqm_est');
    // A time-scrub year of the price series has its own per-year estimate…
    const year = JSON.stringify(buildFillColorExpression({ ...getLayerById('property_price'), property: 'property_price_history__2022' }));
    expect(year).toContain('property_price_history__2022_est');
    expect(isEstimateKey('property_price_history__2022_est')).toBe(true);
    // …a series without estimates has none.
    expect(hasEstimates('income_history__2022')).toBe(false);
    expect(JSON.stringify(buildFillColorExpression(getLayerById('median_income')))).not.toContain('_est');
  });

  it('estimates never move a region average', () => {
    const f = (p: Record<string, unknown>) => ({ type: 'Feature' as const, geometry: null, properties: { he_vakiy: 100, ...p } });
    const measured = [f({ property_price_sqm: 1000 }), f({ property_price_sqm: 3000 })];
    const withEst = [...measured, f({ property_price_sqm: null, property_price_sqm_est: 9000 })];
    type Fs = Parameters<typeof computeMetroAverages>[0];
    expect(computeMetroAverages(withEst as unknown as Fs).property_price_sqm).toBe(computeMetroAverages(measured as unknown as Fs).property_price_sqm);
  });
});

describe('committed artifacts', () => {
  const props = decodeColumnar(regionProperties) as Record<string, unknown>[];

  it('carry estimates only where nothing was measured', () => {
    let n = 0;
    for (const p of props) {
      for (const prop of ['property_price_sqm', 'rental_price_sqm', 'price_to_rent_ratio']) {
        const e = p[estimateKey(prop)];
        if (e == null) continue;
        n++;
        expect(p[prop], `${p.pno} ${prop}`).toBeNull();
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('carry per-year price estimates only for years the area was not measured', () => {
    let n = 0;
    for (const p of props) {
      const h = p.property_price_history;
      const series = (typeof h === 'string' ? JSON.parse(h) : h) as [number, number][] | null;
      const measured = new Set((series ?? []).map(([y]) => y));
      for (const key of Object.keys(p)) {
        const m = /^property_price_history__(\d{4})_est$/.exec(key);
        if (!m || p[key] == null) continue;
        n++;
        expect(measured.has(Number(m[1])), `${p.pno} ${key}`).toBe(false);
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  // App draws the latest year of the price series from property_price_sqm (wider
  // coverage, carries estimates). That is only honest while the two agree.
  it('the latest year of the price series equals the current price for every area', () => {
    let latest = 0;
    const hist = (p: Record<string, unknown>): [number, number][] | null => {
      const h = p.property_price_history;
      const a = typeof h === 'string' ? JSON.parse(h) : h;
      return Array.isArray(a) && a.length ? a : null;
    };
    for (const p of props) { const h = hist(p); if (h) latest = Math.max(latest, h[h.length - 1][0]); }
    let checked = 0;
    for (const p of props) {
      const h = hist(p);
      const last = h?.find(([y]) => y === latest);
      if (!last) continue;
      checked++;
      expect(last[1], String(p.pno)).toBe(p.property_price_sqm);
    }
    expect(checked).toBeGreaterThan(500);
  });
});
