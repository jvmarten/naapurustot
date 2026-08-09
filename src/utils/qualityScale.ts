/**
 * Selectable display scales for the composite Quality Index.
 *
 * The composite is an absolute 0–100 weighted average that, measured over all 3,018
 * postal areas on the shipped weights, actually spans **38–67 with 30 distinct
 * values**. Nothing scores near either end. Every difficulty the score has had on
 * screen traces back to that one fact:
 *
 *   - fixed 0–20/…/80–100 bands put **94.9 %** of the country in "Okay";
 *   - a 0–100 colour ramp paints the whole map in its middle third;
 *   - moving the bands to cohort quantiles fixes both, but then the number is on an
 *     absolute scale while its verdict is on a relative one, and they disagree in
 *     public ("Excellent (58–100)" on a mediocre-looking colour);
 *   - replacing the number with its rank makes all of it consistent, but detaches the
 *     number from the score it came from — 61 displayed as 97.
 *
 * Rather than argue the trade-off further, this module makes it switchable so the
 * options can be compared on the real map. Each mode maps a composite to the 0–100
 * number that is displayed and coloured by; `RAW` is the historical behaviour, so the
 * default changes nothing.
 *
 * Measured national band occupancy (Avoid → Excellent), for choosing between them:
 *
 *   raw         0.0 / 0.1 / 94.9 / 5.1 / 0.0   (bands are cohort-relative here)
 *   stretch     0.7 / 14.2 / 58.0 / 25.1 / 2.0
 *   winsorized 10.3 / 20.9 / 31.9 / 23.7 / 13.1
 *   percentile 22.2 / 19.5 / 21.4 / 17.7 / 19.1
 *
 * The trade runs: `raw` keeps the number honest and needs relative bands to say
 * anything; `stretch` and `winsorized` keep magnitude and spacing but coarsen the
 * scale (a composite has only 30 attainable values, so stretching leaves visible
 * holes — 30 of 101 reachable under `stretch`, 17 under `winsorized`); `percentile`
 * is perfectly uniform but discards magnitude entirely.
 *
 * None of them adds information. The composite's 30 distinct values are the ceiling
 * on what any of these can express, and only changing how the composite is built
 * raises it.
 */

export type QualityScaleMode = 'raw' | 'stretch' | 'winsorized' | 'percentile';

export const QUALITY_SCALE_MODES: QualityScaleMode[] = ['raw', 'stretch', 'winsorized', 'percentile'];

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
 * The transform derived by the last applyQualityScale call, kept so values computed
 * OUTSIDE that pass can be put on the same scale.
 *
 * The all-Finland view is the case that needs it: its features are per-region
 * aggregates built in metroAreas.ts from a population-weighted mean of the postal
 * areas' composites, long after applyQualityScale ran over those areas. Those regions
 * must be read against the POSTAL cohort — deriving a fresh transform from the 69
 * regional means would put the two views on different scales, and a region would change
 * colour depending on how you navigated to it.
 */
let scaleFn: (v: number) => number = (v) => v;

/** Put a composite on the active display scale, using the cohort last passed to
 *  applyQualityScale. Returns null for a missing value. */
export function scaleComposite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(scaleFn(v)) : null;
}

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * Derive `quality_display` on every feature from its `quality_index`, under the active
 * mode. Separate from computeQualityIndices so switching modes does not re-run the
 * ~50-factor weighting — the composite has not changed, only how it is presented.
 *
 * Degenerate cohorts are left alone rather than stretched: if every area holds the same
 * composite there is no range to map onto 0–100, and inventing one would turn a tie into
 * a spread the data does not support.
 */
export function applyQualityScale(features: HasQuality[]): void {
  const composites: number[] = [];
  for (const f of features) {
    const v = f.properties?.quality_index;
    if (typeof v === 'number' && Number.isFinite(v)) composites.push(v);
  }

  const write = (fn: (v: number) => number) => {
    scaleFn = fn;
    for (const f of features) {
      if (!f.properties) continue;
      const v = f.properties.quality_index;
      f.properties.quality_display =
        typeof v === 'number' && Number.isFinite(v) ? Math.round(fn(v)) : null;
    }
  };

  if (mode === 'raw' || composites.length === 0) {
    write((v) => v);
    return;
  }

  const sorted = [...composites].sort((a, b) => a - b);

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
    write((v) => {
      const below = bound(v, true);
      const atOrBelow = bound(v, false);
      return ((below + (atOrBelow - below) / 2) / n) * 100;
    });
    return;
  }

  const lo = mode === 'winsorized' ? quantile(sorted, WINSOR_LO) : sorted[0];
  const hi = mode === 'winsorized' ? quantile(sorted, WINSOR_HI) : sorted[sorted.length - 1];
  if (hi <= lo) { write((v) => v); return; } // no range to stretch — see docstring
  write((v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)));
}
