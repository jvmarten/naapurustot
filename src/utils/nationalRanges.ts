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
 * true national mean used as the missing-data fallback.
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
