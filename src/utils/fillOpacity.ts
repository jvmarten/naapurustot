/**
 * fill-opacity expressions for the data-layer colour overlay, shared by the main
 * map (Map.tsx) and the split comparison view (SplitMapView.tsx).
 *
 * Close-zoom damping: the choropleth sits above the basemap's roads (see
 * beforeLabels in Map.tsx), and at street zoom a ~0.65 fill hides the very
 * streets and blocks a user zoomed in to look at. Every opacity here eases down
 * by CLOSE_ZOOM_DAMP_FACTOR between CLOSE_ZOOM_DAMP_START and
 * CLOSE_ZOOM_DAMP_END — a small step, not a fade: the data must still read at
 * a glance. Region preset zooms are 8.5–11 (Mariehamn is the one at 11), so
 * no city opens past the ramp's start by its preset.
 *
 * MapLibre allows ONE zoom curve per expression, and only at the top level: a
 * zoom `interpolate` nested inside a `case` fails validation, setPaintProperty
 * drops it with a console warning, and the layer keeps its previous opacity.
 * So the zoom ramp is always the outer expression and the state-dependent
 * `case` is each stop's output. Stops sit on integer zooms because composite
 * (zoom + feature-state) values are stored per integer zoom and blended
 * linearly between them — a linear ramp on integer stops is exact.
 */

export const CLOSE_ZOOM_DAMP_START = 11;
export const CLOSE_ZOOM_DAMP_END = 14;
export const CLOSE_ZOOM_DAMP_FACTOR = 0.8;

/**
 * Build a zoom-ramped expression from `build(k)`, where `k` is the multiplier
 * to apply to every opacity in the stop: 1 up to CLOSE_ZOOM_DAMP_START,
 * CLOSE_ZOOM_DAMP_FACTOR from CLOSE_ZOOM_DAMP_END on.
 */
export function withCloseZoomDamping(build: (k: number) => unknown): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    CLOSE_ZOOM_DAMP_START, build(1),
    CLOSE_ZOOM_DAMP_END, build(CLOSE_ZOOM_DAMP_FACTOR),
  ];
}

/**
 * Main-map postal fill opacity:
 * 1. Highlights hovered/selected features at 85% opacity
 * 2. Optionally dims non-matching features (used by filter and wizard highlight modes)
 * 3. Scales all values by the user's opacity slider multiplier `o` (0–1)
 * 4. Eases everything down slightly at close zoom (see module docs)
 *
 * IMPORTANT: never replace this with a constant via setPaintProperty on a
 * layer whose fill-opacity was initialized state-dependent. MapLibre's
 * ProgramConfiguration.updatePaintArrays keeps the stale binder, reassigns
 * its `.expression` to the new constant value, then calls `.evaluate()` on
 * it — and constants have no `evaluate`, so the next setFeatureState during
 * a render frame throws `this.expression.evaluate is not a function`. Pass
 * `o = 0` here to "hide" the fill while keeping the expression state-dependent.
 *
 * The same trap now applies to zoom: the fill is created with this zoom curve,
 * so its buckets hold composite binders, and a bare feature-state `case` (no
 * zoom) set on it gets handed to them before the tiles reload — the next frame
 * throws on `interpolationFactor`. Every expression set on the fill must be a
 * zoom curve; route it through withCloseZoomDamping.
 */
export function buildFillOpacity(o: number, overrides?: { matchExpr?: unknown[]; matchVal?: number; dimVal?: number }): unknown[] {
  return withCloseZoomDamping((k) => {
    const s = o * k;
    const base: unknown[] = [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      0.85 * s,
      ['boolean', ['feature-state', 'selected'], false],
      0.85 * s,
    ];
    if (overrides?.matchExpr) {
      base.push(overrides.matchExpr, (overrides.matchVal ?? 0.8) * s, (overrides.dimVal ?? 0.15) * s);
    } else {
      base.push(0.65 * s);
    }
    return base;
  });
}

/**
 * Split-view postal fill opacity for the "no grid" case, scaled by the slider
 * value so the panes honour it like the main map. Kept STATE-DEPENDENT for the
 * same reason as buildFillOpacity; hover/selected bump +0.15.
 */
export function buildPaneFillOpacity(opacity: number): unknown[] {
  const bump = Math.min(1, opacity + 0.15);
  return withCloseZoomDamping((k) => [
    'case',
    ['boolean', ['feature-state', 'hover'], false], bump * k,
    ['boolean', ['feature-state', 'selected'], false], bump * k,
    opacity * k,
  ]);
}
