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
import type { MinMax, QualityCalibration } from './qualityIndex';
import type { CountryId } from './areaId';
// CF-2: the 101-point national percentile ladders are a SEPARATE ?url asset (URL string
// only — the JSON stays out of every JS chunk, exactly like adjacency.json). Do NOT static-
// import it the way national_ranges.json is imported above, or it charges the full payload.
import nationalPercentilesUrl from '../data/national_percentiles.json?url';

interface RawRange {
  min: number;
  max: number;
  avg: number;
}

// Build once per country and memoize — the artifact is static for the lifetime of the bundle.
const cached: Partial<Record<CountryId, Map<string, MinMax>>> = {};

type RangesFile = {
  ranges: Record<string, RawRange>;
  countries?: { se?: { ranges: Record<string, RawRange> } };
  calibration?: QualityCalibration;
};

/**
 * National per-metric ranges keyed by property name. Each entry is the
 * `{ min, max, avg }` shape consumed by `normalize`/`getFactorScore`, where
 * `min`/`max` are the winsorized (p2/p98) normalization bounds and `avg` is the
 * true national mean. (National-scope scoring imputes a neutral 50 for missing
 * values rather than this mean — see `neutralizeMissing` in getFactorScore.)
 */
export function getNationalRanges(country: CountryId = 'fi'): Map<string, MinMax> {
  const hit = cached[country];
  if (hit) return hit;
  const map = new Map<string, MinMax>();
  const file = rangesData as RangesFile;
  // Sweden's carry only the quality index's properties (scripts/build_national_ranges.mjs).
  const ranges = country === 'se' ? file.countries?.se?.ranges ?? {} : file.ranges;
  for (const key of Object.keys(ranges)) {
    const r = ranges[key];
    map.set(key, { min: r.min, max: r.max, avg: r.avg });
  }
  cached[country] = map;
  return map;
}

type CountryRangeSet = { fi: Map<string, MinMax>; se: Map<string, MinMax>; calibration?: QualityCalibration };
let countryRanges: CountryRangeSet | null = null;

/** Both countries' ranges, for computeQualityIndices: each area is scored against its own
 *  country, and Sweden's composite is put on Finland's scale by quantile. */
export function getCountryRanges(): CountryRangeSet {
  return countryRanges ??= {
    fi: getNationalRanges('fi'),
    se: getNationalRanges('se'),
    calibration: (rangesData as RangesFile).calibration,
  };
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
