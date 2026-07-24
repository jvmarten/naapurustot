/**
 * National reference ranges for Quality Index normalization (CF-1 phase C).
 *
 * The map lazy-loads one seutukunta at a time, so the client never holds all
 * ~3018 postal codes and cannot derive a nation-wide min/max at runtime. This
 * module exposes the pre-computed national distribution (built by
 * scripts/build_national_ranges.mjs from region_properties.json) as a
 * `Map<string, MinMax>` that `computeQualityIndices` can normalize against, so a
 * score means the same thing in every region by default.
 *
 * Bounds are winsorized to the 2nd/98th percentile (see the build script) so a
 * single extreme postal code can't compress the rest of the country.
 */
import rangesData from '../data/national_ranges.json';
import type { MinMax } from './qualityIndex';
// CF-2: the 101-point national percentile ladders are a SEPARATE ?url asset (URL string
// only — the JSON stays out of every JS chunk, exactly like adjacency.json). Do NOT static-
// import it the way national_ranges.json is imported above, or it charges the full payload.
import nationalPercentilesUrl from '../data/national_percentiles.json?url';

interface RawRange {
  min: number;
  max: number;
  avg: number;
}

// Build once and memoize — the artifact is static for the lifetime of the bundle.
let cached: Map<string, MinMax> | null = null;

/**
 * National per-metric ranges keyed by property name. Each entry is the
 * `{ min, max, avg }` shape consumed by `normalize`/`getFactorScore`, where
 * `min`/`max` are the winsorized (p2/p98) normalization bounds and `avg` is the
 * true national mean. (National-scope scoring imputes a neutral 50 for missing
 * values rather than this mean — see `neutralizeMissing` in getFactorScore.)
 */
export function getNationalRanges(): Map<string, MinMax> {
  if (cached) return cached;
  const map = new Map<string, MinMax>();
  const ranges = (rangesData as { ranges: Record<string, RawRange> }).ranges;
  for (const key of Object.keys(ranges)) {
    const r = ranges[key];
    map.set(key, { min: r.min, max: r.max, avg: r.avg });
  }
  cached = map;
  return map;
}

/** One metric's national quantile ladder: 101 ascending breakpoints + the finite count. */
export interface NationalLadder {
  /** 101-point p0..p100 quantile curve, ascending — a valid input to percentileRankSorted. */
  ladder: number[];
  /** National count of finite values behind this ladder (for the coverage floor). */
  n: number;
}

let laddersCache: Promise<Record<string, NationalLadder>> | null = null;

/**
 * CF-2: lazily fetch + cache the national percentile ladders (a ?url asset, so it never
 * weighs on the initial bundle). Gives the panel a true national "top X%" standing without
 * the ~12 MB national property set. Mirrors loadAdjacencyGraph: memoized promise, evicted on
 * failure so a later call retries.
 */
export function loadNationalPercentiles(): Promise<Record<string, NationalLadder>> {
  if (laddersCache) return laddersCache;
  laddersCache = fetch(nationalPercentilesUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load national percentiles: ${res.status}`);
      return res.json() as Promise<{ metrics: Record<string, NationalLadder> }>;
    })
    .then((data) => data.metrics)
    .catch((err) => {
      laddersCache = null; // evict so a later call can retry
      throw err;
    });
  return laddersCache;
}
