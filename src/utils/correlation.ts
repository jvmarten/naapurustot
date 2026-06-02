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
  const dx = Math.sqrt(n * sxx - sx * sx);
  const dy = Math.sqrt(n * syy - sy * sy);
  if (dx === 0 || dy === 0) return null;
  const r = cov / (dx * dy);
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
