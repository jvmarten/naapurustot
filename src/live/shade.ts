/**
 * The two pure numbers the shadow/twilight compositing rests on, apart from the
 * canvas that consumes them so they can be reasoned about — and tested — on their
 * own.
 *
 * Both were inline in LivePage's `twilightLayer` and its draw loop. They are
 * lifted here for one specific reason: `twilightLayer` has a daytime fast-path
 * that skips the ~21,800-sample solar lattice when the whole viewport is provably
 * in daylight, and it has a symmetric NIGHT fast-path that skips it when the whole
 * viewport is provably past civil twilight — where the wash is uniform. That
 * night path can only be byte-identical to the lattice it replaces if it computes
 * the very same alpha the lattice would have written into every cell, so the
 * formula has to be one function used by both. Keeping it here, with a test that
 * pins {@link nightAlpha}'s saturation at −6°, is what makes "uniform" a proof
 * rather than a hope.
 */

/**
 * How dark the all-over night shade is at a given solar altitude.
 *
 * Ramps linearly from the daytime shadow alpha at the horizon (0°) to the full
 * night alpha at the end of civil twilight (−6°), so the last building shadow at
 * sunset hands over to the all-over shade at the same tone instead of the layer
 * blinking off. AT OR BELOW −6° IT SATURATES to `night` exactly (the `min(1, …)`),
 * and that clean saturation is the whole basis of the twilight night fast-path:
 * a viewport whose every point is below −6° has one night alpha, not a field.
 */
export function nightAlpha(altitudeDeg: number, day: number, night: number): number {
  const t = Math.min(1, Math.max(0, -altitudeDeg / 6));
  return day + (night - day) * t;
}

/**
 * The `deepen` pass's alpha (0..255) for a given local night alpha.
 *
 * The night wash is drawn in two passes (see `twilightLayer`): the merged mask
 * lays down exactly `shade.day`, and this pass is drawn OVER it to reach the full
 * night tone. Source-over puts `day + x·(1 − day)` on ground the mask has already
 * shaded, so the remainder that lands the pair on `nightA` precisely is
 * `(nightA − day) / (1 − day)`. Returned as a 0..255 byte because it is written
 * straight into an ImageData channel (the lattice) or a fill alpha (the uniform
 * night fast-path) — one function so the two can never disagree.
 */
export function deepenAlpha255(nightA: number, day: number): number {
  return Math.round((255 * (nightA - day)) / (1 - day));
}
