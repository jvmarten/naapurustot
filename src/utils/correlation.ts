/**
 * CF-3: client-side statistics for the Correlation / Scatter Explorer.
 * No external stats dependency — Pearson correlation + ordinary least-squares
 * best-fit line over the already-loaded neighborhood data.
 */

export interface XYPoint {
  x: number;
  y: number;
}

/**
 * Pearson product-moment correlation coefficient over complete (x, y) pairs.
 * Returns null when there are too few points or either axis has zero variance.
 */
export function pearson(points: XYPoint[]): number | null {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = n * sxy - sx * sy;
  // vx and vy are sums of squared deviations: non-negative in exact arithmetic,
  // but floating-point rounding can push a zero-variance value slightly below 0.
  // Taking the sqrt of that yields NaN, which slips past a `=== 0` check
  // (NaN !== 0) and would propagate out as a NaN "correlation". Reject here.
  const vx = n * sxx - sx * sx;
  const vy = n * syy - sy * sy;
  if (vx <= 0 || vy <= 0) return null;
  const r = cov / (Math.sqrt(vx) * Math.sqrt(vy));
  if (!isFinite(r)) return null;
  // Guard against tiny floating-point overshoot beyond [-1, 1].
  return Math.max(-1, Math.min(1, r));
}

/**
 * QW-1: Percentile rank of `value` within `values` — the share (0–100) of values
 * less than or equal to `value`. Returns null for an empty set.
 */
export function percentileRank(values: number[], value: number): number | null {
  if (values.length === 0) return null;
  let countLe = 0;
  for (const v of values) if (v <= value) countLe++;
  return (countLe / values.length) * 100;
}

export interface HistogramBin {
  /** Lower edge (inclusive) */
  x0: number;
  /** Upper edge */
  x1: number;
  count: number;
}

/**
 * QW-1: Equal-width histogram of `values` into `binCount` bins. The maximum value
 * falls into the last bin (not a phantom extra bin). Returns null when empty or
 * when all values are identical (no meaningful distribution to draw).
 */
export function histogram(values: number[], binCount = 12): { bins: HistogramBin[]; min: number; max: number } | null {
  if (values.length === 0 || binCount < 1) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max) || min === max) return null;
  const width = (max - min) / binCount;
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) bins.push({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 });
  for (const v of values) bins[binIndexOf(v, min, max, binCount)].count++;
  return { bins, min, max };
}

/** QW-1: Index of the bin a value falls into for a [min,max] range split into binCount bins. */
export function binIndexOf(value: number, min: number, max: number, binCount: number): number {
  if (max <= min) return 0;
  let idx = Math.floor(((value - min) / (max - min)) * binCount);
  if (idx >= binCount) idx = binCount - 1;
  if (idx < 0) idx = 0;
  return idx;
}

/** Ordinary least-squares best-fit line: y = slope·x + intercept. */
export function bestFit(points: XYPoint[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * QW-3: Best-fit lines computed independently per group (region). Groups with
 * fewer than `minPoints` points or no x-variance are skipped. Returns a map
 * keyed by the group key, in first-seen order, so callers can draw per-region
 * trend lines and spot Simpson's-paradox clustering.
 */
export function groupedBestFit<T extends XYPoint>(
  points: T[],
  groupKey: (p: T) => string,
  minPoints = 3,
): Map<string, { slope: number; intercept: number; n: number }> {
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const k = groupKey(p);
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  const out = new Map<string, { slope: number; intercept: number; n: number }>();
  for (const [k, g] of groups) {
    if (g.length < minPoints) continue;
    const fit = bestFit(g);
    if (fit) out.set(k, { ...fit, n: g.length });
  }
  return out;
}

/**
 * QW-3: Coefficient of determination R² — the share of variance in y explained
 * by a linear fit on x. For simple linear regression this is just r², so we
 * derive it from the Pearson r to reuse the guarded computation. Returns null
 * when r is undefined (too few points or zero variance).
 */
export function rSquared(points: XYPoint[]): number | null {
  const r = pearson(points);
  if (r == null) return null;
  return r * r;
}

export type Significance = 'strong' | 'moderate' | 'weak' | 'none';

/**
 * QW-3: A coarse, n-aware significance hint for a correlation. Not a formal
 * p-value — it approximates the two-sided t-test for ρ=0 by comparing |r|
 * against the critical |r| at α≈0.05 for n−2 degrees of freedom, and labels how
 * far past that threshold the observed |r| sits. With small n a large |r| can
 * still be "weak"; with large n even a modest |r| clears the bar. Returns
 * 'none' when r is undefined or below the significance threshold.
 */
export function significanceHint(points: XYPoint[]): Significance {
  const r = pearson(points);
  const n = points.length;
  if (r == null || !Number.isFinite(r) || n < 3) return 'none';
  const absR = Math.abs(r);
  if (absR >= 1) return 'strong';
  const df = n - 2;
  // t-statistic for the observed r, and the two-sided 5% critical t for df.
  const t = absR * Math.sqrt(df / (1 - absR * absR));
  const tCrit = criticalT05(df);
  if (t < tCrit) return 'none';
  // Past the 5% bar: grade by how decisively (≈1% and ≈0.1% two-sided cutoffs).
  if (t >= tCrit * 1.6) return 'strong';
  if (t >= tCrit * 1.25) return 'moderate';
  return 'weak';
}

/**
 * Approximate two-sided 5% critical t-value for `df` degrees of freedom.
 * A short lookup for small df plus a smooth large-sample approximation; exact
 * tables are unnecessary for a UI "significance hint".
 */
function criticalT05(df: number): number {
  if (df < 1) return Infinity;
  const table: Record<number, number> = {
    1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31,
    9: 2.26, 10: 2.23, 12: 2.18, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04,
    40: 2.02, 60: 2.00, 120: 1.98,
  };
  if (table[df] != null) return table[df];
  // Interpolate / extrapolate toward the normal z (1.96) for large df.
  if (df >= 120) return 1.96 + (1.98 - 1.96) * (120 / df);
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let lo = keys[0], hi = keys[keys.length - 1];
  for (const k of keys) { if (k <= df) lo = k; if (k >= df) { hi = k; break; } }
  if (lo === hi) return table[lo];
  const frac = (df - lo) / (hi - lo);
  return table[lo] + (table[hi] - table[lo]) * frac;
}
