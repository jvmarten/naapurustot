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
import type { AttributionControl, ControlPosition, ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import type { CountryId } from './areaId';
import countryBordersUrl from '../data/country_borders.geojson?url';

export const BASEMAP_STYLE_LIGHT =
  (import.meta.env.VITE_BASEMAP_STYLE_LIGHT_URL as string) ||
  'https://tiles.openfreemap.org/styles/positron';
export const BASEMAP_STYLE_DARK =
  (import.meta.env.VITE_BASEMAP_STYLE_DARK_URL as string) ||
  'https://tiles.openfreemap.org/styles/dark';

/**
 * Attribution for the OpenFreeMap / OpenMapTiles / OpenStreetMap basemap — byte for byte
 * the `attribution` OpenFreeMap's TileJSON (tiles.openfreemap.org/planet) carries. The
 * style JSON has none, but MapLibre also shows the tile source's own once its TileJSON
 * loads, and it drops only an EXACT duplicate: our copy with `rel` attributes added
 * rendered the credit twice. We still pass it ourselves so the credit never depends on
 * the tile source — if OpenFreeMap's string changes, the worst case is two copies, not none.
 */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/** How long the credit stays expanded before folding to its (i) button. */
export const ATTRIBUTION_FOLD_MS = 5000;

/**
 * Adds the basemap attribution as a compact control that folds to its (i) after
 * ATTRIBUTION_FOLD_MS. MapLibre's compact mode starts expanded and folds only on the
 * first drag, so a visitor who never pans keeps a full credit line across the bottom
 * of the map. It cannot start folded: OSMF's attribution guidelines require the credit
 * to be visible without interacting with the map, and allow collapsing it after five
 * seconds or on map interaction, provided an (i) brings it back. A tap on the control
 * before the fold cancels it, so it never closes under someone who just opened it.
 */
export function addBasemapAttribution(map: MaplibreMap, Control: typeof AttributionControl, position: ControlPosition): void {
  const ctrl = new Control({ compact: true, customAttribution: BASEMAP_ATTRIBUTION });
  map.addControl(ctrl, position);
  const el = ctrl._container;
  const fold = setTimeout(() => el.classList.remove('maplibregl-compact-show'), ATTRIBUTION_FOLD_MS);
  el.addEventListener('click', () => clearTimeout(fold), { once: true });
}

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
 * inserted *below*: the first place-name label layer (the OpenMapTiles `place`
 * source-layer). Everything before it — land, water, buildings AND roads — therefore
 * sits under the semi-transparent choropleth (~0.65 fill), so roads ghost through the
 * data rather than forming a bold web on top of it, while city / neighbourhood names
 * stay crisp above the fills. Falls back to the first `symbol` layer, and finally to
 * `undefined` (append on top) if the style has no labels at all.
 *
 * Pure over a layers array so it is unit-testable without a live map. Kept style-agnostic
 * (matches on `source-layer`/`type`, not hardcoded layer ids) so it survives OpenFreeMap
 * renaming or reordering its layers.
 */
export function firstOverlayLayerId(layers: readonly LayerSpecification[]): string | undefined {
  const placeLabel = layers.find(
    (l) => l.type === 'symbol' && (l as { 'source-layer'?: string })['source-layer'] === 'place',
  );
  if (placeLabel) return placeLabel.id;
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

const NOT_MARITIME: ExpressionSpecification = ['!=', ['get', 'maritime'], 1];

/** A country border layer: its filter pins admin_level to 2 somewhere. */
function isCountryBoundary(l: LayerSpecification): boolean {
  return 'filter' in l && /\["get","admin_level"\],2\]/.test(JSON.stringify(l.filter));
}

/**
 * Country borders, drawn so a change of country reads differently from a region
 * boundary: lighter and thicker than the region outlines (~1 px, ~0.5 opacity) in the
 * dark theme, darker in the light one, and never dashed or blurred.
 */
const COUNTRY_BORDER_PAINT: Record<'dark' | 'light', { color: string; opacity: number }> = {
  dark: { color: '#cbd5e1', opacity: 0.8 },
  light: { color: '#334155', opacity: 0.75 },
};
/** Every other country border: as faint as the base style drew it. */
const OTHER_BORDER_PAINT: Record<'dark' | 'light', { color: string; opacity: number }> = {
  dark: { color: '#3b3b3b', opacity: 1 },
  light: { color: '#b3b3b3', opacity: 1 },
};
/** Width by zoom of a strong border; faint ones stay 1 px. */
const COUNTRY_BORDER_WIDTH: readonly [number, number][] = [[3, 1.2], [6, 1.8], [10, 2.6]];
/** The boundary tiles name the country on each side by ISO 3166-1 alpha-3 (`adm0_l`/`adm0_r`). */
const ISO3: Record<CountryId, string> = { fi: 'FIN', se: 'SWE' };

/** Paint for the base's country-border layers: strong where the border touches a country
 *  whose data is on the map, faint everywhere else (Norway–Russia, the Baltics). */
function countryBorderPaint(theme: 'dark' | 'light', countries: readonly CountryId[]): Record<string, unknown> {
  const codes = countries.map((c) => ISO3[c]);
  const touches: ExpressionSpecification = ['any',
    ['in', ['coalesce', ['get', 'adm0_l'], ''], ['literal', codes]],
    ['in', ['coalesce', ['get', 'adm0_r'], ''], ['literal', codes]]];
  const on = COUNTRY_BORDER_PAINT[theme];
  const off = OTHER_BORDER_PAINT[theme];
  return {
    'line-color': ['case', touches, on.color, off.color],
    'line-opacity': ['case', touches, on.opacity, off.opacity],
    // Zoom must stay the top-level input: a zoom interpolate nested inside the `case` fails
    // validation, which silently kept the width at first load and broke the whole style on
    // a theme swap (the base stayed light under a dark UI).
    'line-width': ['interpolate', ['linear'], ['zoom'],
      ...COUNTRY_BORDER_WIDTH.flatMap(([z, w]) => [z, ['case', touches, w, 1]])],
  };
}

/**
 * The base style's own border lines, cut down to what the map needs and lifted above it.
 *
 * Kept: country borders on land, restyled (countryBorderPaint: strong only where they
 * touch a country whose data is on the map) and moved to just above the first place-name
 * label — so above our choropleth, which is inserted below that label, where the base had
 * them hidden under the fill. Our own low-zoom border layer (COUNTRY_BORDER_LAYER) joins
 * them, since below zoom 5 the base's tiles say nothing about which countries a border
 * separates. Hidden: the base's province and
 * municipal lines (positron's levels 3–6, dark's level 4), which only cross-hatched our
 * own region outlines, and sea borders (the dark style drew them, as loops around
 * Gotland and lines across the Baltic). Idempotent, so it can run on every style load.
 */
export function styleBaseBorders(
  layers: readonly LayerSpecification[],
  theme: 'dark' | 'light',
  countries: readonly CountryId[],
): LayerSpecification[] {
  const borders: LayerSpecification[] = [];
  const rest: LayerSpecification[] = [];
  for (const l of layers) {
    if (l.id === COUNTRY_BORDER_LAYER) borders.push({ ...l, paint: countryBorderPaint(theme, countries) } as LayerSpecification);
    else if (!isBaseBoundary(l)) rest.push(l);
    else if (isCountryBoundary(l)) borders.push(countryBorder(l, theme, countries));
  }
  const anchor = firstOverlayLayerId(rest);
  const at = anchor ? rest.findIndex((l) => l.id === anchor) + 1 : rest.length;
  return [...rest.slice(0, at), ...borders, ...rest.slice(at)];
}

function countryBorder(l: LayerSpecification, theme: 'dark' | 'light', countries: readonly CountryId[]): LayerSpecification {
  const filter = (l as { filter?: ExpressionSpecification }).filter;
  const landOnly = !filter || JSON.stringify(filter).includes('"maritime"') ? filter : ['all', filter, NOT_MARITIME];
  return {
    ...l,
    filter: landOnly,
    paint: countryBorderPaint(theme, countries),
  } as LayerSpecification;
}

/** Apply styleBaseBorders to a live map's style (call on every `style.load`). */
export function applyBaseBorders(map: MaplibreMap, theme: 'dark' | 'light', countries: readonly CountryId[]): void {
  const current = map.getStyle()?.layers ?? [];
  const target = styleBaseBorders(current, theme, countries);
  const kept = new Set(target.map((l) => l.id));
  for (const l of current) {
    if (!isBorderLayer(l)) continue;
    if (!kept.has(l.id)) {
      map.setLayoutProperty(l.id, 'visibility', 'none');
      continue;
    }
    const t = target.find((x) => x.id === l.id) as LayerSpecification & { filter?: FilterSpecification; paint: Record<string, unknown> };
    map.setFilter(l.id, t.filter ?? null);
    for (const key of Object.keys((l as { paint?: object }).paint ?? {})) {
      if (!(key in t.paint)) map.setPaintProperty(l.id, key, undefined);
    }
    for (const [key, value] of Object.entries(t.paint)) map.setPaintProperty(l.id, key, value);
  }
  // Restack: each border goes just below whatever follows it in the target order.
  for (let i = target.length - 1; i >= 0; i--) {
    const l = target[i];
    if (isBorderLayer(l)) map.moveLayer(l.id, target[i + 1]?.id);
  }
}

const isBaseBoundary = (l: LayerSpecification) => 'source-layer' in l && l['source-layer'] === 'boundary';
const isBorderLayer = (l: LayerSpecification) => l.id === COUNTRY_BORDER_LAYER || isBaseBoundary(l);

/** Our own country-border lines for zooms below 5 (scripts/fetch_country_borders.py). */
export const COUNTRY_BORDER_LAYER = 'country-borders-low';
const COUNTRY_BORDER_SOURCE = 'country-borders-low';

/** Add the low-zoom country-border layer if this style lacks it; applyBaseBorders then
 *  places and paints it. MapLibre fetches the small GeoJSON asset itself. */
export function addCountryBorderLayer(map: MaplibreMap): void {
  if (!map.getSource(COUNTRY_BORDER_SOURCE)) map.addSource(COUNTRY_BORDER_SOURCE, { type: 'geojson', data: countryBordersUrl });
  if (!map.getLayer(COUNTRY_BORDER_LAYER)) {
    map.addLayer({ id: COUNTRY_BORDER_LAYER, type: 'line', source: COUNTRY_BORDER_SOURCE, maxzoom: 5 });
  }
}

/**
 * `setStyle` `transformStyle` that carries the app's data sources and layers across a
 * base-style (theme) swap. OpenFreeMap's positron/dark share the `openmaptiles` vector
 * source, so switching only repaints the base — but MapLibre would otherwise drop every
 * layer/source not present in the incoming style. This re-attaches our neighbourhood /
 * grid / overlay sources and layers (everything whose source is not a base source) and
 * re-inserts the layers just below the new base's first place-name label layer, preserving the
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
