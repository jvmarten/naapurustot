/**
 * Zoom-fade expressions shared between the main map (Map.tsx) and the split
 * comparison view (SplitMapView.tsx) for fine-grained grid layers (e.g. the
 * 250 m VIIRS / air-quality cells).
 *
 * Extracted here (IN-1) so both views fade the postal choropleth out and the
 * grid in over the EXACT same zoom range — keeping them in a component file
 * would force a cross-component import that trips react-refresh, and duplicating
 * the constants risks the two views drifting apart.
 */

// Zoom range over which the grid takes over from the postal choropleth for
// grid-capable layers. Below GRID_ZOOM_FADE_IN only the smooth choropleth
// shows; above GRID_ZOOM_FADE_OUT only the grid shows. Centered around zoom
// 7.75 — between the all-Finland viewport (~4.8) and city defaults (~9), so
// country views stay smooth and city/postal views show the detailed grid at
// full opacity.
export const GRID_ZOOM_FADE_IN = 7;
export const GRID_ZOOM_FADE_OUT = 8.5;

/**
 * Like buildFillOpacity but the values fade linearly to 0 between
 * GRID_ZOOM_FADE_IN and GRID_ZOOM_FADE_OUT. Use for the postal choropleth when
 * a grid layer is active — at low zoom the choropleth stays visible, at high
 * zoom it hands off to the grid.
 */
export function buildFillOpacityFadeOut(o: number): unknown[] {
  const fadeAt = (val: number): unknown[] => [
    'interpolate', ['linear'], ['zoom'],
    GRID_ZOOM_FADE_IN, val,
    GRID_ZOOM_FADE_OUT, 0,
  ];
  return [
    'case',
    ['boolean', ['feature-state', 'hover'], false], fadeAt(0.85 * o),
    ['boolean', ['feature-state', 'selected'], false], fadeAt(0.85 * o),
    fadeAt(0.65 * o),
  ];
}

/** Grid opacity that fades in over the same zoom range buildFillOpacityFadeOut
 *  fades out. */
export function buildGridFillOpacity(o: number): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    GRID_ZOOM_FADE_IN, 0,
    GRID_ZOOM_FADE_OUT, 0.8 * o,
  ];
}
