/**
 * Country borders on the basemap: strong where a border touches a country whose data is
 * on the map, faint elsewhere, and drawn from our own Natural Earth lines below zoom 5
 * (OpenFreeMap's low-zoom tiles carry no country codes). Split from basemap.ts because
 * it reads the country registry, and basemap.ts is shared with /live/, which has none.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MaplibreMap } from 'maplibre-gl';
import type { CountryId } from './areaId';
import countryBordersUrl from '../data/country_borders.geojson?url';
import { countryDef } from './countries.ts';
import { firstOverlayLayerId } from './basemap';

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

/** Paint for the base's country-border layers: strong where the border touches a country
 *  whose data is on the map, faint everywhere else (Norway–Russia, the Baltics). */
function countryBorderPaint(theme: 'dark' | 'light', countries: readonly CountryId[]): Record<string, unknown> {
  const codes = countries.map((c) => countryDef(c).iso3);
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
