/**
 * Neighbour estimates for areas a layer has no measured value for.
 *
 * A few layers are published only where enough transactions or rentals happened —
 * Statistics Finland suppresses a postal code's sale price with too few sales, and
 * rents exist only for the ~27 cities asvu 15fa reports. Painting those gaps with the
 * seutukunta average (the old fallback) gave a remote village the same price as its
 * region's city centre. Here a gap instead takes the inverse-distance-weighted mean of
 * the nearest MEASURED areas around it.
 *
 * What keeps this honest:
 * - The estimate is written to its own key (`<property>_est`), never into the measured
 *   one. Averages, rankings, filters, ranges, the quality index and every region
 *   aggregate read the measured key, so an estimate can never move a region's figure.
 * - Only measured areas are inputs — an estimate is never derived from another one.
 * - It is a weighted mean, so it always lies between the values it was made from; it
 *   cannot extrapolate past what was measured nearby.
 * - With fewer than `minNeighbours` measured areas inside `maxDistanceKm`, there is no
 *   estimate and the area stays "no data".
 * - Each country is estimated only from its own areas.
 * - An area with no residents gets none: no homes there to price.
 * - Everything that shows one labels it as an estimate (hatched on the map, badged in
 *   the panel, captioned in the tooltip).
 *
 * Leave-one-out over the measured areas (2026-11 data, these parameters): sale price
 * 27.5 % mean absolute error against 38.2 % for the seutukunta average; rent 6.8 %
 * against 7.6 %. Gaps tend to be sparser than the areas that test them, so treat these
 * as a lower bound on the error.
 *
 * Time series: a layer whose measured key has estimates may also carry a year series
 * (`property_price_history`). Each year of it is estimated the same way, from that
 * year's measured areas only (`ESTIMATED_HISTORIES`), so scrubbing the time slider back
 * keeps the gaps filled — and hatched — instead of turning them grey.
 *
 * Node-safe (imported by scripts/build_region_data.mjs) — no Vite-only imports.
 */
import { countryOfId } from './areaId.ts';

/** Measured property → decimals its estimate is rounded to (matches the published data). */
export const ESTIMATED_PROPERTIES: Readonly<Record<string, number>> = {
  property_price_sqm: 0,
  rental_price_sqm: 2,
};

/** Ratio derived from two estimated inputs exactly as the pipeline derives the measured
 *  one (`prepare_data.calculate_price_to_rent`): price / (rent × 12). */
export const DERIVED_ESTIMATES = {
  price_to_rent_ratio: { decimals: 1 },
} as const;

/** Year-series property (`TIME_SERIES_HISTORY_PROPS`) → decimals of its per-year estimate.
 *  Each year is estimated on its own, from the areas measured THAT year, into
 *  `<history>__<year>_est` — beside the `<history>__<year>` key the time slider draws. */
export const ESTIMATED_HISTORIES: Readonly<Record<string, number>> = {
  property_price_history: 0,
};

export const ESTIMATE_SUFFIX = '_est';

const YEAR_KEY = /^(.+)__(\d{4})$/;

export const ESTIMATE_PARAMS = {
  /** Nearest measured areas used. */
  k: 6,
  /** Inverse-distance power. */
  power: 2,
  /** No measured area within this many km of the centroid → no estimate. */
  maxDistanceKm: 25,
  minNeighbours: 2,
  /** Distances are floored here so a neighbour sharing a centroid can't take all the weight. */
  minDistanceKm: 1,
} as const;

/** The estimate key for a measured property. */
export function estimateKey(property: string): string {
  return property + ESTIMATE_SUFFIX;
}

/** True when `property` has neighbour estimates beside it. */
export function hasEstimates(property: string): boolean {
  if (property in ESTIMATED_PROPERTIES || property in DERIVED_ESTIMATES) return true;
  const m = YEAR_KEY.exec(property);
  return m != null && m[1] in ESTIMATED_HISTORIES;
}

export function isEstimateKey(key: string): boolean {
  return key.endsWith(ESTIMATE_SUFFIX) && hasEstimates(key.slice(0, -ESTIMATE_SUFFIX.length));
}

/**
 * The area's estimate for `property` — only when it has no measured value. Returns
 * null for a measured area, for a property without estimates, or when none was made.
 */
export function estimateFor(props: Record<string, unknown> | null | undefined, property: string): number | null {
  if (!props || !hasEstimates(property)) return null;
  const own = props[property];
  if (typeof own === 'number' && Number.isFinite(own)) return null;
  const v = props[estimateKey(property)];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const KM_PER_DEG = 6371 * Math.PI / 180;

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

type Row = Record<string, unknown>;

/**
 * Inverse-distance-weighted estimate of `property` for each row with no measured value.
 * Returns one entry per row: the estimate, or null (measured row, no centroid, or too
 * few measured neighbours in range).
 */
export function neighbourEstimates(rows: readonly Row[], property: string, decimals: number, params = ESTIMATE_PARAMS): (number | null)[] {
  const measured: { lat: number; lon: number; v: number; country: string }[] = [];
  for (const r of rows) {
    if (finite(r[property]) && finite(r.lat) && finite(r.lon)) {
      measured.push({ lat: r.lat, lon: r.lon, v: r[property], country: countryOfId(r.pno) });
    }
  }
  const latWindow = params.maxDistanceKm / KM_PER_DEG;
  // Sorted by latitude so each gap only scans the band that can be in range.
  measured.sort((a, b) => a.lat - b.lat || a.lon - b.lon || a.v - b.v);
  const lats = measured.map((m) => m.lat);
  const lowerBound = (x: number) => {
    let lo = 0, hi = lats.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lats[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };

  return rows.map((r) => {
    if (finite(r[property]) || !finite(r.lat) || !finite(r.lon)) return null;
    // Nobody lives here (a mail centre, an industrial estate): there are no homes to
    // price, so "no data" is the true answer, not an estimate.
    if (finite(r.he_vakiy) && r.he_vakiy <= 0) return null;
    const lat = r.lat, lon = r.lon;
    const country = countryOfId(r.pno);
    const cosLat = Math.cos(lat * Math.PI / 180);
    const near: { d: number; v: number }[] = [];
    for (let i = lowerBound(lat - latWindow); i < measured.length && measured[i].lat <= lat + latWindow; i++) {
      const m = measured[i];
      if (m.country !== country) continue;
      const dx = (m.lon - lon) * cosLat, dy = m.lat - lat;
      const d = Math.hypot(dx, dy) * KM_PER_DEG;
      if (d <= params.maxDistanceKm) near.push({ d, v: m.v });
    }
    if (near.length < params.minNeighbours) return null;
    near.sort((a, b) => a.d - b.d || a.v - b.v);
    let wSum = 0, vSum = 0;
    for (const { d, v } of near.slice(0, params.k)) {
      const w = 1 / Math.max(d, params.minDistanceKm) ** params.power;
      wSum += w;
      vSum += w * v;
    }
    return round(vSum / wSum, decimals);
  });
}

/**
 * Add `<property>_est` to every row that lacks a measured value and has enough measured
 * neighbours. Mutates `rows` (the build's feature properties) and returns counts per
 * key for the build log. Measured keys are never written.
 */
export function addNeighbourEstimates(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [prop, decimals] of Object.entries(ESTIMATED_PROPERTIES)) {
    const est = neighbourEstimates(rows, prop, decimals);
    let n = 0;
    rows.forEach((r, i) => { if (est[i] != null) { r[estimateKey(prop)] = est[i]; n++; } });
    counts[estimateKey(prop)] = n;
  }
  // price-to-rent where at least one input is an estimate and both are known.
  for (const [prop, { decimals }] of Object.entries(DERIVED_ESTIMATES)) {
    let n = 0;
    for (const r of rows) {
      if (finite(r[prop])) continue;
      if (finite(r.property_price_sqm) && finite(r.rental_price_sqm)) continue; // nothing estimated
      const price = finite(r.property_price_sqm) ? r.property_price_sqm : r[estimateKey('property_price_sqm')];
      const rent = finite(r.rental_price_sqm) ? r.rental_price_sqm : r[estimateKey('rental_price_sqm')];
      if (finite(price) && finite(rent) && rent > 0) {
        r[estimateKey(prop)] = round(price / (rent * 12), decimals);
        n++;
      }
    }
    counts[estimateKey(prop)] = n;
  }
  // One year of a series at a time: an area measured in 2021 but suppressed in 2023
  // gets a 2023 estimate from its 2023-measured neighbours, never a carried-forward value.
  for (const [hist, decimals] of Object.entries(ESTIMATED_HISTORIES)) {
    const byYear = new Map<number, Map<number, number>>(); // year → row index → value
    rows.forEach((r, i) => {
      const series = historyPoints(r[hist]);
      for (const [year, v] of series) {
        if (!byYear.has(year)) byYear.set(year, new Map());
        byYear.get(year)!.set(i, v);
      }
    });
    for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
      const values = byYear.get(year)!;
      const yearRows = rows.map((r, i) => ({ pno: r.pno, lat: r.lat, lon: r.lon, he_vakiy: r.he_vakiy, v: values.get(i) ?? null }));
      const est = neighbourEstimates(yearRows, 'v', decimals);
      const key = estimateKey(`${hist}__${year}`);
      let n = 0;
      rows.forEach((r, i) => { if (est[i] != null) { r[key] = est[i]; n++; } });
      counts[key] = n;
    }
  }
  return counts;
}

/** A history property's [year, value] points — the GeoJSON stores it as an array or as
 *  its JSON string. Malformed points are skipped. */
function historyPoints(raw: unknown): [number, number][] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((p): p is [number, number] =>
    Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]));
}
