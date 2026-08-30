/**
 * Basemap style resolution.
 *
 * The map renders on OpenFreeMap's public vector tiles (https://openfreemap.org):
 * a keyless, no-limit OpenStreetMap / OpenMapTiles vector basemap. MapLibre renders
 * the vector style natively, so there is no API key, no per-request metering, and no
 * "API KEY REQUIRED" watermark (the reason we moved off CARTO's raster endpoint).
 *
 * Two styles are used — `positron` (light) and `dark` — and both draw from the same
 * `openmaptiles` vector source, so a light/dark swap only repaints the base layers
 * rather than refetching tiles.
 *
 * The URLs are overridable via env so the whole basemap can later be repointed at a
 * self-hosted mirror without touching component code.
 */
import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';

export const BASEMAP_STYLE_LIGHT =
  (import.meta.env.VITE_BASEMAP_STYLE_LIGHT_URL as string) ||
  'https://tiles.openfreemap.org/styles/positron';
export const BASEMAP_STYLE_DARK =
  (import.meta.env.VITE_BASEMAP_STYLE_DARK_URL as string) ||
  'https://tiles.openfreemap.org/styles/dark';

/**
 * Attribution for the OpenFreeMap / OpenMapTiles / OpenStreetMap basemap. OpenFreeMap's
 * hosted styles ship without a visible attribution string, so we supply it ourselves via
 * `AttributionControl({ customAttribution })`.
 */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** Resolve the basemap style URL for the active theme. */
export function basemapStyleUrl(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? BASEMAP_STYLE_DARK : BASEMAP_STYLE_LIGHT;
}

/**
 * OpenFreeMap / OpenMapTiles base styles reference exactly these source ids. Any layer
 * whose source is not one of these is an app data layer we added on top, which is how
 * we tell our layers apart from the base style's when carrying them across a theme swap.
 */
const BASE_SOURCE_IDS = new Set(['openmaptiles', 'ne2_shaded']);

/**
 * Id of the base-style layer the choropleth (and its borders/highlights) should be
 * inserted *below*, so the base map's roads and place labels stay crisp on top of the
 * coloured fills. That is the first road/label layer: the first layer drawing the
 * OpenMapTiles `transportation` source-layer, falling back to the first `symbol`
 * (label) layer, and finally to `undefined` (append on top) if the style has neither.
 *
 * Pure over a layers array so it is unit-testable without a live map. Kept style-agnostic
 * (matches on `source-layer`/`type`, not hardcoded layer ids) so it survives OpenFreeMap
 * renaming or reordering its layers.
 */
export function firstOverlayLayerId(layers: readonly LayerSpecification[]): string | undefined {
  const road = layers.find((l) => (l as { 'source-layer'?: string })['source-layer'] === 'transportation');
  if (road) return road.id;
  const symbol = layers.find((l) => l.type === 'symbol');
  return symbol?.id;
}

/** Resolve {@link firstOverlayLayerId} against a live map's current style. */
export function baseInsertBeforeId(map: MaplibreMap): string | undefined {
  try {
    return firstOverlayLayerId(map.getStyle().layers);
  } catch {
    return undefined;
  }
}

/**
 * `setStyle` `transformStyle` that carries the app's data sources and layers across a
 * base-style (theme) swap. OpenFreeMap's positron/dark share the `openmaptiles` vector
 * source, so switching only repaints the base — but MapLibre would otherwise drop every
 * layer/source not present in the incoming style. This re-attaches our neighbourhood /
 * grid / overlay sources and layers (everything whose source is not a base source) and
 * re-inserts the layers just below the new base's first road/label layer, preserving the
 * stacking order the map was built with.
 */
export function carryDataLayers(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  if (!previous) return next;

  const baseSourceIds = new Set(Object.keys(next.sources));
  const customLayers = previous.layers.filter(
    (l) => l.type !== 'background' && 'source' in l && l.source && !baseSourceIds.has(l.source),
  );

  const sources: StyleSpecification['sources'] = { ...next.sources };
  for (const [id, src] of Object.entries(previous.sources)) {
    if (!baseSourceIds.has(id)) sources[id] = src;
  }

  const insertBefore = firstOverlayLayerId(next.layers);
  const idx = insertBefore ? next.layers.findIndex((l) => l.id === insertBefore) : -1;
  const at = idx < 0 ? next.layers.length : idx;
  const layers = [...next.layers.slice(0, at), ...customLayers, ...next.layers.slice(at)];

  return { ...next, sources, layers };
}

/** Exposed for tests: the base source ids used to distinguish base vs app layers. */
export const __BASE_SOURCE_IDS = BASE_SOURCE_IDS;
