/**
 * Cohort statistics for the composite Quality Index.
 *
 * This module used to cut the five verdict bands at the cohort's own quantiles, because
 * the bands were binning the RAW composite and that number cannot carry an absolute
 * reading: measured over all 3,018 postal areas on the shipped weights it spans 38–67
 * with 30 distinct values, so fixed 0–20/…/80–100 cuts labelled 94.9 % of the country
 * "Okay" and nothing at either end. Moving the cuts fixed that symptom and created a
 * worse one — the number was then on an absolute scale while its verdict was on a
 * relative one, so they disagreed in public: an area could read "Excellent (58–100)" in
 * the colour of a mediocre score, and one point could flip a whole band.
 *
 * CF-15 fixes it at the source instead. `computeQualityIndices` now also derives
 * `quality_percentile`, the area's rank within the cohort, and that is what the map,
 * legend, panel, profile and cards display and colour by. A percentile is uniform on
 * 0–100 by construction, so the bands are plain fixed fifths again (see
 * QUALITY_CATEGORIES) and "top fifth" is literally the top fifth.
 *
 * The original guarantee survives and is now structural rather than engineered: whatever
 * the user weights, areas cannot all be excellent at once, because a rank cannot put a
 * majority at the top.
 *
 * What remains here is the diagnostic the quantiles could never fix — ties. If a
 * weighting collapses the composite onto a handful of values, no monotone transform
 * separates those areas: they share a rank, share a band, and the scale carries almost no
 * signal. `bandsAreDegenerate` reports that state.
 */

export interface QualityCohort {
  /** Cohort size the statistics were derived from. */
  n: number;
  /** Distinct composite values in the cohort — 1 means the scale carries no signal. */
  distinct: number;
}

let active: QualityCohort | null = null;

/**
 * Record the composite scores of the cohort just computed. Called by
 * computeQualityIndices, so the statistics always describe the scores on screen.
 */
export function setQualityCohort(values: number[]): void {
  const finite = values.filter((v) => Number.isFinite(v));
  active = finite.length === 0 ? null : { n: finite.length, distinct: new Set(finite).size };
}

/** Statistics for the current cohort, or null before any index has been computed. */
export function getQualityCohort(): QualityCohort | null {
  return active;
}

/**
 * True when the active weighting has collapsed the composite so far that the scale
 * carries almost no information — a handful of distinct scores across the whole cohort.
 * Surfacing this is more honest than silently spreading a tie: the user has weighted a
 * metric that cannot tell their areas apart.
 */
export function bandsAreDegenerate(): boolean {
  return active != null && active.n > 50 && active.distinct < 5;
}

/** Reset — used by tests and when a dataset is swapped. */
export function clearQualityCohort(): void {
  active = null;
}
