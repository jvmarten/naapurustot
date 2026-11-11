/**
 * The quality-index ranges the APP scores with, for build scripts.
 *
 * Mirrors `getCountryRanges()` in src/utils/nationalRanges.ts (which cannot be imported under
 * Node: it reads the JSON through a bundler import and a Vite `import.meta.glob`): every
 * country's own national ranges from src/data/national_ranges.json, plus the calibration
 * curves that put other countries' composites on Finland's scale. Pass the result as the
 * third argument of computeQualityIndices and a prerendered score is the one the map shows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadCountryRanges(root) {
  const file = JSON.parse(readFileSync(join(root, 'src', 'data', 'national_ranges.json'), 'utf-8'));
  const toMap = (raw) => new Map(Object.entries(raw ?? {}).map(([k, r]) => [k, { min: r.min, max: r.max, avg: r.avg }]));
  const ranges = { fi: toMap(file.ranges) };
  for (const [country, entry] of Object.entries(file.countries ?? {})) ranges[country] = toMap(entry.ranges);
  return Object.assign(ranges, { calibration: file.calibration });
}
