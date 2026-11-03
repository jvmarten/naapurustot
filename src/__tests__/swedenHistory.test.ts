/**
 * Sweden's per-DeSO history (scripts/se/fetch_se_history.py): SCB's series joined across
 * the DeSO 2018 → 2025 revision, only for areas whose boundary moved by less than 1 %.
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import regionProps from '../data/region_properties.json';
import { decodeColumnar } from '../utils/columnar';
import { countryOfId } from '../utils/areaId';
import { parseTrendSeries } from '../utils/metrics';
import { aggregateTrendHistories } from '../utils/metroAggregation';
import { layerInCountry } from '../utils/colorScales';

type Row = Record<string, unknown> & { pno: string };
const se = decodeColumnar<Row>(regionProps as never).filter((r) => countryOfId(r.pno) === 'se');
const series = (r: Row, key: string) => parseTrendSeries(r[key] as never);

describe('Swedish history', () => {
  it('covers the continuous three quarters of DeSOs, and no others', () => {
    const withPop = se.filter((r) => series(r, 'population_history'));
    expect(se.length).toBe(6160);
    expect(withPop.length).toBeGreaterThan(4500);
    expect(withPop.length).toBeLessThan(5000);
  });

  it('ends every series on the value the map shows, over consecutive years', () => {
    const latest: [string, string][] = [
      ['population_history', 'he_vakiy'],
      ['economic_standard_history', 'economic_standard_median'],
      ['unemployment_history', 'unemployment_rate'],
    ];
    for (const r of se) {
      for (const [key, prop] of latest) {
        const s = series(r, key);
        if (!s) continue;
        expect(s.length, `${r.pno} ${key}`).toBeLessThanOrEqual(6);
        expect(s[s.length - 1][0] - s[0][0], `${r.pno} ${key}`).toBe(s.length - 1);
        if (r[prop] != null) expect(s[s.length - 1][1], `${r.pno} ${key}`).toBe(r[prop]);
      }
    }
  });

  it('offers population change in Sweden', () => {
    expect(layerInCountry('population_change', 'se')).toBe(true);
  });
});

describe('aggregateTrendHistories', () => {
  const f = (pno: string, pop: number, history?: [number, number][]): Feature => ({
    type: 'Feature', geometry: null as never,
    properties: { pno, he_vakiy: pop, population_history: history ? JSON.stringify(history) : null, unemployment_history: history ? JSON.stringify(history.map(([y]) => [y, 5])) : null },
  });

  it('sums a series only when the areas carrying it hold the region\'s residents', () => {
    const full = aggregateTrendHistories([f('a', 100, [[2020, 90], [2025, 100]]), f('b', 100, [[2020, 95], [2025, 100]])]);
    expect(full.population_history).toBe(JSON.stringify([[2020, 185], [2025, 200]]));
    // A quarter of the residents without a series: the sum would understate the region.
    const partial = aggregateTrendHistories([f('a', 300, [[2020, 290], [2025, 300]]), f('b', 100)]);
    expect(partial.population_history).toBeUndefined();
    // An average over the areas that have one is still an average.
    expect(partial.unemployment_history).toBe(JSON.stringify([[2020, 5], [2025, 5]]));
  });
});
