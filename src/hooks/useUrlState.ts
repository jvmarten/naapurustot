import { useEffect, useRef } from 'react';
import type { LayerId, ColorblindType } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';
import { REGION_IDS } from '../utils/regions';
import type { Lang } from '../utils/i18n';
import type { FilterCriterion } from '../utils/filterUtils';
import { serializeFilters, deserializeFilters } from '../utils/filterUtils';
import type { IsochroneMode } from '../utils/isochrone';
import type { QualityWeights } from '../utils/qualityIndex';
import {
  getDefaultWeights, getPersonaWeights, detectPersona, isCustomWeights,
  QUALITY_FACTORS, QUALITY_PERSONAS,
} from '../utils/qualityIndex';

/** CF-1: comparison scope carried in the URL ('all' = whole Finland, 'region' = within region). */
export type UrlScope = 'all' | 'region';

/** CF-1: a saved travel-time isochrone (re-fetched for the selected pno on restore). */
export interface UrlIsochrone {
  mode: IsochroneMode;
  budget: number;
}

/** CF-1: a map camera, carried only via the explicit "copy link to this view" affordance. */
export interface UrlViewport {
  center: [number, number];
  zoom: number;
}

interface UrlState {
  pno: string | null;
  layer: LayerId | null;
  compare: string[];
  city: string | null;
  // CF-1: extended analytical state (null when absent from the URL).
  scope: UrlScope | null;
  year: number | null;
  colorblind: ColorblindType | null;
  lang: Lang | null;
  // CF-5: postal code of the custom reference-baseline neighbourhood.
  ref: string | null;
  // CF-1b: active filter range criteria (empty when absent from the URL).
  filters: FilterCriterion[];
  // CF-1: custom quality weights (from a persona id or a diff), null when default.
  weights: QualityWeights | null;
  // CF-1: a saved isochrone overlay, null when absent.
  isochrone: UrlIsochrone | null;
  // CF-1: map camera, only present when shared via "copy link to this view".
  viewport: UrlViewport | null;
  // QW-2: shared shortlist (postal codes), empty when absent.
  shortlist: string[];
}

/** CF-1: the extra analytical state the URL can carry beyond pno/layer/compare/city. */
export interface ExtraUrlState {
  scope?: UrlScope;
  year?: number | null;
  colorblind?: ColorblindType;
  lang?: Lang;
  /** CF-5: custom reference-baseline pno */
  ref?: string | null;
  /** CF-1b: active filter criteria */
  filters?: FilterCriterion[];
  /** CF-1: current quality weights (serialized as a persona id or a diff). */
  weights?: QualityWeights | null;
  /** CF-1: active isochrone overlay. */
  isochrone?: UrlIsochrone | null;
  /** QW-2: current shortlist (postal codes). */
  shortlist?: string[];
}

const VALID_CITIES = new Set<string>(['all', ...REGION_IDS]);

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));
const VALID_CB = new Set<string>(['off', 'protanopia', 'deuteranopia', 'tritanopia']);
const VALID_LANG = new Set<string>(['fi', 'en', 'sv']);
const VALID_FACTOR_IDS = new Set<string>(QUALITY_FACTORS.map((f) => f.id));
const VALID_PERSONA = new Set<string>(QUALITY_PERSONAS.map((p) => p.id));
const VALID_ISO_MODE = new Set<string>(['walk', 'bike', 'transit']);

// ─── CF-1: quality-weight URL codec ─────────────────────────────────────────
// Custom weights are encoded compactly: a recognised persona collapses to its id
// (`qp=family`), otherwise only the factors that differ from the documented
// default are listed (`qw=safety:40,income:0`). Defaults are omitted entirely.

function serializeWeightDiff(w: QualityWeights): string {
  const def = getDefaultWeights();
  const parts: string[] = [];
  for (const f of QUALITY_FACTORS) {
    const v = Math.round(w[f.id] ?? 0);
    if (v !== (def[f.id] ?? 0)) parts.push(`${f.id}:${v}`);
  }
  return parts.join(',');
}

function deserializeWeightDiff(encoded: string): QualityWeights {
  const w = getDefaultWeights();
  for (const part of encoded.split(',')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const id = part.slice(0, idx);
    const val = Number(part.slice(idx + 1));
    if (VALID_FACTOR_IDS.has(id) && Number.isFinite(val) && val >= -100 && val <= 100) {
      w[id] = Math.round(val);
    }
  }
  return w;
}

/** The persona/diff key a weight set serializes to, or '' when it's the default. */
function weightsParamKey(w: QualityWeights | null | undefined): string {
  if (!w || !isCustomWeights(w)) return '';
  const persona = detectPersona(w);
  return persona && persona !== 'default' ? `p:${persona}` : `w:${serializeWeightDiff(w)}`;
}

function serializeViewport(v: UrlViewport): string {
  const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };
  return `${round(v.center[0], 5)}~${round(v.center[1], 5)}~${round(v.zoom, 2)}`;
}

function deserializeViewport(s: string): UrlViewport | null {
  const parts = s.split('~');
  if (parts.length !== 3) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  const zoom = Number(parts[2]);
  if (![lng, lat, zoom].every((n) => Number.isFinite(n))) return null;
  // Clamp to a generous Finland bounding box + valid zoom so a hand-edited link
  // can never fling the camera off-world.
  if (lng < 18 || lng > 33 || lat < 58 || lat > 71 || zoom < 0 || zoom > 22) return null;
  return { center: [lng, lat], zoom };
}

function deserializeIsochrone(s: string): UrlIsochrone | null {
  const [mode, budgetStr] = s.split('~');
  const budget = Number(budgetStr);
  if (VALID_ISO_MODE.has(mode) && Number.isFinite(budget) && budget > 0 && budget <= 120) {
    return { mode: mode as IsochroneMode, budget: Math.round(budget) };
  }
  return null;
}

function parseUrl(): UrlState {
  // Support both query params (?pno=) and legacy hash (#pno=) for backwards compat
  const searchParams = new URLSearchParams(window.location.search);
  let pno = searchParams.get('pno');
  let layer = searchParams.get('layer');
  let compare = searchParams.get('compare');
  let city = searchParams.get('city');

  // Fallback: read from hash for old bookmarks/links
  if (!pno && !layer && !compare && window.location.hash) {
    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    pno = hashParams.get('pno');
    layer = hashParams.get('layer');
    compare = hashParams.get('compare');
    city = hashParams.get('city');

    // Migrate hash to query params silently
    if (pno || layer || compare || city) {
      const newParams = new URLSearchParams();
      if (pno) newParams.set('pno', pno);
      if (layer) newParams.set('layer', layer);
      if (compare) newParams.set('compare', compare);
      if (city) newParams.set('city', city);
      const newUrl = `${window.location.pathname}?${newParams.toString()}`;
      window.history.replaceState(null, '', newUrl);
    }
  }

  // CF-1: extended analytical state (query params only — legacy hash links never had these).
  const scopeRaw = searchParams.get('scope');
  const yearRaw = searchParams.get('year');
  const cbRaw = searchParams.get('cb');
  const langRaw = searchParams.get('lang');
  const refRaw = searchParams.get('ref');
  const filterRaw = searchParams.get('filter');
  const qpRaw = searchParams.get('qp');
  const qwRaw = searchParams.get('qw');
  const isoRaw = searchParams.get('iso');
  const viewRaw = searchParams.get('v');
  const slRaw = searchParams.get('sl');

  let weights: QualityWeights | null = null;
  if (qpRaw && VALID_PERSONA.has(qpRaw) && qpRaw !== 'default') weights = getPersonaWeights(qpRaw);
  else if (qwRaw) weights = deserializeWeightDiff(qwRaw);

  return {
    pno: pno && (VALID_CITIES.has(pno) || /^\d{5}$/.test(pno)) ? pno : null,
    layer: layer && VALID_LAYER_IDS.has(layer) ? (layer as LayerId) : null,
    compare: compare
      ? compare.split(',').filter((p) => /^\d{5}$/.test(p) || VALID_CITIES.has(p))
      : [],
    city: city && VALID_CITIES.has(city) ? city : null,
    scope: scopeRaw === 'all' || scopeRaw === 'region' ? scopeRaw : null,
    year: yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null,
    colorblind: cbRaw && VALID_CB.has(cbRaw) ? (cbRaw as ColorblindType) : null,
    lang: langRaw && VALID_LANG.has(langRaw) ? (langRaw as Lang) : null,
    ref: refRaw && /^\d{5}$/.test(refRaw) ? refRaw : null,
    filters: filterRaw ? deserializeFilters(filterRaw) : [],
    weights,
    isochrone: isoRaw ? deserializeIsochrone(isoRaw) : null,
    viewport: viewRaw ? deserializeViewport(viewRaw) : null,
    shortlist: slRaw ? slRaw.split('.').filter((p) => /^\d{5}$/.test(p)) : [],
  };
}

/** Write current app state to URL query params. Default values are omitted to keep URLs short. */
function writeUrl(pno: string | null, layer: LayerId, comparePnos: string[], city: string = 'helsinki_metro', extras: ExtraUrlState = {}) {
  const params = new URLSearchParams();
  if (pno) params.set('pno', pno);
  if (layer !== 'quality_index') params.set('layer', layer);
  if (comparePnos.length > 0) params.set('compare', comparePnos.join(','));
  if (city && city !== 'helsinki_metro') params.set('city', city);
  // CF-1: extended analytical state — omit defaults to keep shared URLs short.
  if (extras.scope && extras.scope !== 'all') params.set('scope', extras.scope);
  if (extras.year != null) params.set('year', String(extras.year));
  if (extras.colorblind && extras.colorblind !== 'off') params.set('cb', extras.colorblind);
  if (extras.lang && extras.lang !== 'fi') params.set('lang', extras.lang);
  if (extras.ref) params.set('ref', extras.ref);
  if (extras.filters && extras.filters.length > 0) params.set('filter', serializeFilters(extras.filters));
  // CF-1: custom quality weights — persona id when recognised, else a compact diff.
  if (extras.weights && isCustomWeights(extras.weights)) {
    const persona = detectPersona(extras.weights);
    if (persona && persona !== 'default') params.set('qp', persona);
    else params.set('qw', serializeWeightDiff(extras.weights));
  }
  // CF-1: active isochrone overlay (the pno it belongs to is already in `pno`).
  if (extras.isochrone) params.set('iso', `${extras.isochrone.mode}~${extras.isochrone.budget}`);
  // QW-2: shared shortlist.
  if (extras.shortlist && extras.shortlist.length > 0) params.set('sl', extras.shortlist.join('.'));
  // NB: viewport (`v`) is intentionally never written here — continuous panning
  // would churn replaceState. It is appended only by buildViewportShareUrl().
  const str = params.toString();
  const newUrl = str
    ? `${window.location.pathname}?${str}`
    : window.location.pathname;
  if (window.location.search !== (str ? `?${str}` : '')) {
    window.history.replaceState(null, '', newUrl);
  }
}

/** Read URL state once at app startup. Handles both query params and legacy hash format. */
export function readInitialUrlState(): UrlState {
  return parseUrl();
}

/** CF-1: build a shareable URL for the current view with the given camera appended.
 *  Used by the explicit "copy link to this view" affordance so ordinary panning
 *  never writes the viewport to the address bar. */
export function buildViewportShareUrl(viewport: UrlViewport | null): string {
  const base = window.location.href;
  if (!viewport) return base;
  try {
    const u = new URL(base);
    u.searchParams.set('v', serializeViewport(viewport));
    return u.toString();
  } catch {
    return base;
  }
}

/** Keep the browser URL in sync with the current selection, layer, pinned comparisons, and city.
 *  Debounced to avoid redundant replaceState calls when multiple values change in the same tick.
 *  When `ready` is false, URL writes are suppressed to avoid clearing params from the initial
 *  URL before the restoration effect has consumed them (e.g., pinned neighborhoods). */
export function useSyncUrlState(pno: string | null, layer: LayerId, comparePnos: string[] = [], city: string = 'helsinki_metro', ready = true, extras: ExtraUrlState = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { scope, year, colorblind, lang, ref, filters, weights, isochrone, shortlist } = extras;
  // Depend on serialized keys, not object/array references, so an unchanged value
  // never re-triggers the URL write.
  const filterKey = filters && filters.length > 0 ? serializeFilters(filters) : '';
  const weightsKey = weightsParamKey(weights);
  const isoKey = isochrone ? `${isochrone.mode}~${isochrone.budget}` : '';
  const shortlistKey = shortlist && shortlist.length > 0 ? shortlist.join('.') : '';
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!ready) return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    timerRef.current = setTimeout(() => writeUrl(pno, layer, comparePnos, city, { scope, year, colorblind, lang, ref, filters, weights, isochrone, shortlist }), 100);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- object/array extras are tracked via their serialized *Key deps
  }, [pno, layer, comparePnos, city, ready, scope, year, colorblind, lang, ref, filterKey, weightsKey, isoKey, shortlistKey]);
}
