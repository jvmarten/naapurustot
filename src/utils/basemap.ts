/**
 * Basemap tile-URL resolution.
 *
 * CARTO serves every basemap tile at two resolutions behind the same
 * `{z}/{x}/{y}` path: `@2x.png` is a 512 px image, plain `.png` is 256 px. Our
 * raster sources declare `tileSize: 256`, so on a device-pixel-ratio-1 screen
 * the 512 px texture is downscaled by half in each axis — four times the pixels
 * for no visible difference.
 *
 * Measured against `vite preview` at 1440x900, deviceScaleFactor 1:
 *   landing (?city=all)      118 tiles  1,328,508 B -> 552,237 B  (-58.4 %)
 *   region  (?city=…metro)   144 tiles  2,530,540 B -> 981,528 B  (-61.2 %)
 *
 * The URLs come from `.env` (tracked, and it hardcodes `@2x`), so Vite bakes the
 * `@2x` string into the bundle at build time and the `||` default in each
 * component never runs. Rewriting has to happen on the *resolved* value — which
 * is what this helper is for. Call it wherever a basemap URL reaches MapLibre.
 */

/** Matches the CARTO retina marker immediately before the file extension. */
const RETINA_MARKER = /@2x(?=\.[a-z]+$|\.[a-z]+\?|$)/i;

/**
 * Return the basemap URL appropriate for this screen.
 *
 * Defaults to the retina URL whenever `window` is unavailable (prerender, tests,
 * SSR) or the ratio is unknown, so the only behaviour change is on screens we
 * can positively identify as non-retina. The threshold is `> 1` rather than
 * `>= 1.5`: a Windows desktop at 100 % scaling reports exactly 1 and is the
 * whole point of the optimisation, while anything fractional above 1 still
 * benefits from the sharper texture.
 */
export function basemapTileUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  const dpr = window.devicePixelRatio;
  if (typeof dpr !== 'number' || !isFinite(dpr) || dpr > 1) return url;
  return url.replace(RETINA_MARKER, '');
}
