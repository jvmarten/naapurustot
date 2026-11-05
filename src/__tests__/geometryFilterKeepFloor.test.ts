import { describe, it, expect } from 'vitest';
import type { Feature, MultiPolygon } from 'geojson';
import { filterSmallIslands, MIN_KEEP_KM2 } from '../utils/geometryFilter';

/** A square of `km` kilometres a side at 60°N, near Ekenäs. */
function square(km: number, lng0 = 23.3, lat0 = 60): number[][][] {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat0 * Math.PI) / 180));
  return [[[lng0, lat0], [lng0 + dLng, lat0], [lng0 + dLng, lat0 + dLat], [lng0, lat0 + dLat], [lng0, lat0]]];
}

function multi(parts: number[][][][]): Feature<MultiPolygon> {
  return { type: 'Feature', properties: { pno: '10600' }, geometry: { type: 'MultiPolygon', coordinates: parts } };
}

describe('filterSmallIslands — absolute keep floor', () => {
  it('keeps a part of real land however small a share of the largest part it is', () => {
    // 10600 Tammisaari keskus: a ~11 km² mainland piece beside a ~120 km² main part
    // (9 %) was dropped by the relative rule and the map showed bare basemap there.
    const [out] = filterSmallIslands([multi([square(11), square(3.3, 23.5)])]);
    expect((out.geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  it('still drops skerries under the floor that are also under 15 % of the largest', () => {
    const skerry = square(Math.sqrt(MIN_KEEP_KM2) * 0.5, 23.6); // 0.025 km²
    const [out] = filterSmallIslands([multi([square(11), square(1.2, 23.5), skerry])]);
    expect((out.geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  it('keeps a small part that is a large share of an all-small area', () => {
    const [out] = filterSmallIslands([multi([square(0.2), square(0.15, 23.31)])]);
    expect((out.geometry as MultiPolygon).coordinates).toHaveLength(2);
  });
});
