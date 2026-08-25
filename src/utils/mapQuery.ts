import type { Map as MapLibreMap, MapGeoJSONFeature, PointLike } from 'maplibre-gl';
import { trackEvent } from './analytics';

/**
 * True while `map` still has a live style — i.e. `map.remove()` has not run and the
 * WebGL context has not been lost.
 *
 * MapLibre nulls the map's internal `style` in both cases, and every layer/source
 * method dereferences it (`getLayer(e){return this.style.getLayer(e)}`), so calling
 * one on a torn-down or context-lost map throws "Cannot read properties of null
 * (reading 'getLayer'|'getSource')" (Chrome) or "undefined is not an object
 * (evaluating 'this.style.getLayer')" (Safari). Two shapes of caller outlive the
 * style and must gate on this:
 *
 *  - Effect *cleanups* that remove layers/sources. React runs the map-init effect's
 *    cleanup — which calls `map.remove()` — before later effects' cleanups on the same
 *    unmount (destroy order follows mount order), so a `map.getLayer(...)` in a later
 *    cleanup runs against an already-styleless map. This is the dominant crash: a route
 *    swap off the map tears the whole subtree down in one commit.
 *  - Deferred callbacks (queued `requestAnimationFrame`, pointer handlers) that fire in
 *    the window after a WebGL context loss, while the map object and its listeners still
 *    exist but `style` is transiently null.
 *
 * Read through a cast so this stays independent of whether maplibre marks `style`
 * public — it is reading the very field maplibre's own methods dereference.
 */
export function isStyleAlive(map: MapLibreMap): boolean {
  return Boolean((map as unknown as { style?: unknown }).style);
}

/** One-shot: a poisoned tile throws on every frame, so reporting must not flood. */
let reported = false;

/**
 * Hit-test the map, degrading to "nothing here" instead of throwing.
 *
 * maplibre-gl 5.18–5.24 carries an upstream regression (maplibre-gl-js#7752,
 * introduced by #7058, fixed only in 6.0.0 by #7765): when two reloads of the
 * same GeoJSON tile overlap, the tile can end up with a fresh `featureIndex`
 * married to the *previous* generation's `rawTileData` — `Tile.loadVectorData`
 * falls back to the retained `latestRawTileData` whenever a reload response
 * carries no bytes of its own. Every later `queryRenderedFeatures` touching that
 * tile then reads new feature ordinals out of old bytes and throws
 * `feature index out of bounds`, deterministically, until the tile is re-parsed
 * (next `setData`, integer-zoom crossing, or reload).
 *
 * Unguarded that is not cosmetic: it aborts the rest of the hover handler,
 * stranding a stale tooltip and a lit highlight ring, and makes clicks/taps
 * inside the affected tile silently do nothing. Returning `[]` routes callers
 * into their existing no-feature branch, which is the correct degradation —
 * hover clears, the cursor resets, a click is a no-op.
 *
 * The query is never suppressed, only its failure: neighbouring healthy tiles
 * keep answering normally, so the dead zone stays one tile wide.
 */
export function queryFeaturesSafe(
  map: MapLibreMap,
  geometry: PointLike,
  layers: string[],
): MapGeoJSONFeature[] {
  try {
    return map.queryRenderedFeatures(geometry, { layers });
  } catch (err) {
    if (!reported) {
      reported = true;
      console.warn('[map] hit-test failed; treating as no features', err);
      trackEvent('map-query-error', { message: String((err as Error)?.message ?? err) });
    }
    return [];
  }
}
