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
