/**
 * Selectable display scales for the composite Quality Index.
 *
 * The composite is an absolute 0–100 weighted average that, measured over all 3,018
 * postal areas on the shipped weights, actually spans **23–74 with 46 distinct
 * values**. Nothing scores near either end. Every difficulty the score has had on
 * screen traces back to that one fact:
 *
 *   - fixed 0–20/…/80–100 bands put the overwhelming majority of the country in
 *     "Okay" and leave "Avoid" and "Excellent" empty;
 *   - a 0–100 colour ramp paints the whole map in its middle third;
 *   - moving the bands to cohort quantiles fixes both, but then the number is on an
 *     absolute scale while its verdict is on a relative one, and they disagree in
 *     public ("Excellent (54–100)" on a mediocre-looking colour);
 *   - replacing the number with its rank makes all of it consistent, but detaches the
 *     number from the score it came from — 61 displayed as 97.
 *
 * Rather than argue the trade-off further, this module makes it switchable so the
 * options can be compared on the real map. Each mode maps a composite to the 0–100
 * number that is displayed and coloured by; `raw` is the historical behaviour, so the
 * default changes nothing.
 *
 * National band occupancy (Avoid → Excellent) as the app actually assigns it — i.e.
 * through getQualityCategories(), which is cohort quantiles under `raw` and the fixed
 * fifths otherwise. Measured over the shipped cohort in region_aggregates.json:
 *
 *   raw        23.7 / 17.0 / 25.0 / 14.5 / 19.7   (bands are cohort-relative here)
 *   stretch     1.0 / 18.7 / 56.7 / 22.7 /  1.0
 *   winsorized 10.0 / 19.0 / 36.8 / 21.8 / 12.5
 *   percentile 19.7 / 21.0 / 18.2 / 21.4 / 19.7
 *
 * The trade runs: `raw` keeps the number honest and needs relative bands to say
 * anything; `stretch` and `winsorized` keep magnitude and spacing but coarsen the
 * scale (a composite has only 46 attainable values, so stretching leaves visible
 * holes — 46 of 101 reachable under `stretch`, 28 under `winsorized`); `percentile`
 * is perfectly uniform but discards magnitude entirely.
 *
 * None of them adds information. The composite's 46 distinct values are the ceiling
 * on what any of these can express, and only changing how the composite is built
 * raises it.
 *
 * The numbers above are reproducible without a browser: expand `qualityCohort` from
 * src/data/region_aggregates.json, feed it to setQualityScaleCohort, and classify
 * scaleComposite() of every value with getQualityCategories().
 */

import { setQualityCohort } from './qualityBands.ts';

export type QualityScaleMode = 'raw' | 'stretch' | 'winsorized' | 'percentile';

export const QUALITY_SCALE_MODES: QualityScaleMode[] = ['raw', 'stretch', 'winsorized', 'percentile'];

/**
 * A cohort of composites shipped as ascending `[composite, count]` pairs.
 *
 * The composite is an integer, so all 3,018 postal areas compress to ~30 pairs —
 * small enough to ride along with `region_aggregates.json` and let the all-Finland
 * landing derive the same transform the full postal set would, without fetching it.
 */
export type QualityCohortHistogram = [number, number][];

const STORAGE_KEY = 'naapurustot-quality-scale';

/** Winsorization bounds for the `winsorized` mode, matching national_ranges.json's p2/p98. */
const WINSOR_LO = 0.02;
const WINSOR_HI = 0.98;

let mode: QualityScaleMode = 'raw';

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (QUALITY_SCALE_MODES as string[]).includes(stored)) mode = stored as QualityScaleMode;
} catch { /* localStorage unavailable */ }

export function getQualityScaleMode(): QualityScaleMode {
  return mode;
}

export function setQualityScaleMode(next: QualityScaleMode): void {
  mode = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* localStorage unavailable */ }
  // Re-derive from the retained cohort rather than waiting for the next pass over
  // features: the all-Finland view has no postal features to pass (it paints 69
  // aggregates), so without this a mode switch there would leave `scaleFn` on the
  // previous mode and the map would keep painting the old numbers.
  deriveScaleFn();
  refreshBands();
}

/**
 * True when the active mode produces a number that already spans 0–100, so the verdict
 * bands can be the plain fixed fifths. Only `raw` cannot: its number lives in 38–67, so
 * fixed cuts would collapse into one band and the bands must follow the cohort instead.
 */
export function scaleUsesFixedBands(): boolean {
  return mode !== 'raw';
}

interface HasQuality { properties?: Record<string, unknown> | null }

/**
 * The composites of the cohort the active transform was derived from, ascending.
 *
 * The cohort is retained rather than only the function it produces, because both of
 * the things that invalidate the transform can happen with no features to hand: a mode
 * switch (Settings), and the all-Finland view, whose 69 features are per-region
 * aggregates and carry no composite cohort of their own.
 */
let cohort: number[] | null = null;

/**
 * The transform derived from `cohort` under the active mode, kept so values computed
 * OUTSIDE an applyQualityScale pass can be put on the same scale.
 *
 * The all-Finland view is the case that needs it: its features are per-region
 * aggregates built in metroAreas.ts from a population-weighted mean of the postal
 * areas' composites, long after applyQualityScale ran over those areas. Those regions
 * must be read against the POSTAL cohort — deriving a fresh transform from the 69
 * regional means would put the two views on different scales, and a region would change
 * colour depending on how you navigated to it.
 */
let scaleFn: (v: number) => number = (v) => v;

/** Put a composite on the active display scale, using the current cohort.
 *  Returns null for a missing value. */
export function scaleComposite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(scaleFn(v)) : null;
}

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * Rebuild `scaleFn` from `cohort` under the active mode.
 *
 * Degenerate cohorts are left alone rather than stretched: if every area holds the same
 * composite there is no range to map onto 0–100, and inventing one would turn a tie into
 * a spread the data does not support.
 */
function deriveScaleFn(): void {
  const sorted = cohort;
  if (mode === 'raw' || !sorted || sorted.length === 0) {
    scaleFn = (v) => v;
    return;
  }

  if (mode === 'percentile') {
    // Midrank: ties centred, so a tied block sits where it actually is in the field
    // rather than being credited with the whole block (which skews the top band).
    const n = sorted.length;
    const bound = (value: number, strict: boolean) => {
      let lo = 0; let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (strict ? sorted[mid] < value : sorted[mid] <= value) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    scaleFn = (v) => {
      const below = bound(v, true);
      const atOrBelow = bound(v, false);
      return ((below + (atOrBelow - below) / 2) / n) * 100;
    };
    return;
  }

  const lo = mode === 'winsorized' ? quantile(sorted, WINSOR_LO) : sorted[0];
  const hi = mode === 'winsorized' ? quantile(sorted, WINSOR_HI) : sorted[sorted.length - 1];
  if (hi <= lo) { scaleFn = (v) => v; return; } // no range to stretch — see docstring
  scaleFn = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/**
 * Put the cohort-relative bands on the SAME axis the choropleth paints.
 *
 * qualityBands cuts the colour ramp and the five verdict labels at the cohort's own
 * quantiles, and rescaleLayerToData feeds those cuts straight to the quality_index
 * layer — which paints `quality_display`. Handing it composite-space cuts (23–74
 * nationally) while the layer carries stretched 0–100 values would clamp almost every
 * area to an end of the ramp. Because every mode is monotone, quantiles of the display
 * values colour each area exactly as the raw quantiles did; only the numbers move.
 *
 * A missing cohort leaves the existing bands alone — clearing them here would drop the
 * caller into the fixed 0/20/40/60/80 fallback on a mode switch alone.
 */
function refreshBands(): void {
  if (!cohort || cohort.length === 0) return;
  setQualityCohort(cohort.map((v) => Math.round(scaleFn(v))));
}

/**
 * Adopt a cohort supplied as a `[composite, count]` histogram, without a pass over any
 * features.
 *
 * This is how the all-Finland landing gets a transform at all. It paints 69 per-region
 * aggregates from `region_aggregates.json` and never downloads the 3,018 postal areas,
 * so applyQualityScale never runs — and every non-raw mode silently degraded to the raw
 * composite, which is the bug this exists to close. The histogram ships alongside those
 * aggregates and is the same postal cohort applyQualityScale would have derived, so a
 * region keeps its number whether you reach it from the landing or from the full set.
 */
export function setQualityScaleCohort(histogram: QualityCohortHistogram): void {
  const expanded: number[] = [];
  for (const pair of histogram) {
    const [value, count] = pair;
    if (!Number.isFinite(value) || !Number.isFinite(count) || count <= 0) continue;
    for (let i = 0; i < count; i++) expanded.push(value);
  }
  if (expanded.length === 0) return;
  cohort = expanded.sort((a, b) => a - b);
  deriveScaleFn();
  refreshBands();
}

/**
 * Derive `quality_display` on every feature from its `quality_index`, under the active
 * mode. Separate from computeQualityIndices so switching modes does not re-run the
 * ~50-factor weighting — the composite has not changed, only how it is presented.
 *
 * The features passed here become the cohort: whatever is on screen is what the scale
 * and the bands describe. Pass POSTAL areas only — the 69 regional means are aggregates
 * of this cohort, not a cohort of their own (see `scaleFn`).
 */
export function applyQualityScale(features: HasQuality[]): void {
  const composites: number[] = [];
  for (const f of features) {
    const v = f.properties?.quality_index;
    if (typeof v === 'number' && Number.isFinite(v)) composites.push(v);
  }

  cohort = composites.sort((a, b) => a - b);
  deriveScaleFn();

  const display: number[] = [];
  for (const f of features) {
    if (!f.properties) continue;
    const v = f.properties.quality_index;
    const d = typeof v === 'number' && Number.isFinite(v) ? Math.round(scaleFn(v)) : null;
    f.properties.quality_display = d;
    if (d != null) display.push(d);
  }

  // Unlike refreshBands, this clears the bands when the pass found no composites —
  // an empty cohort genuinely has no quantiles, and that is the pre-existing contract
  // computeQualityIndices had when it called setQualityCohort itself.
  setQualityCohort(display);
}
