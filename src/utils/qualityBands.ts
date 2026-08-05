/**
 * Cohort-relative bands for the composite Quality Index.
 *
 * The index is an ABSOLUTE 0–100 weighted average, and it stays that way — this
 * module changes nothing about the number. What it fixes is the judgement attached
 * to it. The five category labels ("Vältä" … "Erinomainen") and the map's colour
 * ramp used fixed breakpoints (20/40/60/80 and 0/14/28/43/57/71/86/100), so which
 * band an area landed in depended entirely on how the user happened to weight the
 * factors:
 *
 *   - shipped default weights → the composite spans 23…74, so 86 % of all 3,018
 *     postal codes are labelled "OK", and NOTHING is "Erinomainen" or "Vältä";
 *   - weight water proximity alone → 92.4 % of areas share the same raw value, the
 *     composite pins at 100, and 94 % are labelled "Erinomainen" at once.
 *
 * Both are the same defect: a fixed band over a distribution whose shape the user
 * controls. Averaging many uncorrelated normalized factors pulls the composite to
 * the middle, and weighting one bunched factor pushes it to an end.
 *
 * So the bands are derived from the active cohort's own distribution instead. A
 * band always holds roughly its share of areas, which makes "Erinomainen" mean
 * "top fifth of what you are looking at" rather than "above 80 on a scale nothing
 * reaches". Whatever the weighting, areas cannot all be excellent together.
 *
 * `rescaleLayerToData` already stretched the ramp LINEARLY to min/max, which gives
 * contrast when the composite is merely narrow but does nothing when it is bunched
 * at one end (the water-proximity case above). Quantiles handle both.
 *
 * The cohort is whatever `computeQualityIndices` was last given: all 3,018 postal
 * codes in the default all-Finland view and in the build scripts, or one region's
 * areas under the explicit within-region comparison scope. That matches the
 * existing scope semantics rather than introducing a second notion of "compared to
 * what".
 *
 * Ties are the one thing this cannot fix. If 2,789 areas hold an identical raw
 * value, no monotone transform separates them; they land in one band together, and
 * `bandsAreDegenerate` reports when that has collapsed the scale.
 */

/** Number of colour stops the quality_index ramp carries (see LAYERS). */
const RAMP_STOPS = 8;

/** The four cut points between the five QUALITY_CATEGORIES. */
const BAND_CUTS = 4;

export interface QualityBands {
  /** Ascending ramp breakpoints at evenly spaced quantiles of the cohort. */
  stops: number[];
  /** The four category boundaries, at the cohort's p20/p40/p60/p80. */
  thresholds: number[];
  /** Cohort size the bands were derived from. */
  n: number;
  /** Distinct composite values in the cohort — 1 means the scale carries no signal. */
  distinct: number;
}

let active: QualityBands | null = null;

/**
 * Quantile of a pre-sorted array by nearest-rank. Deliberately not interpolated:
 * the composite is an integer, so an interpolated stop would sit between two
 * attainable scores and the band edge would be unreachable.
 */
function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Record the composite scores of the cohort just computed, deriving the ramp stops
 * and band thresholds from their distribution. Called by computeQualityIndices, so
 * the bands always describe the scores actually on screen.
 *
 * Stops must be strictly ascending for a MapLibre `interpolate` expression, and
 * quantiles of a tied distribution repeat — so equal neighbours are nudged apart by
 * a hair rather than dropped, keeping stop count aligned with the colour count.
 */
export function setQualityCohort(values: number[]): void {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) { active = null; return; }

  const distinct = new Set(finite).size;
  const raw: number[] = [];
  for (let i = 0; i < RAMP_STOPS; i++) raw.push(quantileSorted(finite, i / (RAMP_STOPS - 1)));

  const stops: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const prev = i > 0 ? stops[i - 1] : -Infinity;
    stops.push(raw[i] > prev ? raw[i] : prev + 1e-6);
  }

  const thresholds: number[] = [];
  for (let i = 1; i <= BAND_CUTS; i++) {
    thresholds.push(quantileSorted(finite, i / (BAND_CUTS + 1)));
  }

  active = { stops, thresholds, n: finite.length, distinct };
}

/** Bands for the current cohort, or null before any index has been computed. */
export function getQualityBands(): QualityBands | null {
  return active;
}

/**
 * True when the active weighting has collapsed the composite so far that the bands
 * carry almost no information — a handful of distinct scores across the whole
 * cohort. Surfacing this is more honest than silently spreading a tie: the user has
 * weighted a metric that cannot tell their areas apart.
 */
export function bandsAreDegenerate(): boolean {
  return active != null && active.n > 50 && active.distinct < 5;
}

/** Reset — used by tests and when a dataset is swapped. */
export function clearQualityCohort(): void {
  active = null;
}
