import { useEffect, useRef } from 'react';
import type { LayerId, ColorblindType } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';
import { REGION_IDS, DEFAULT_CITY } from '../utils/regions';
import type { Lang } from '../utils/i18n';
import type { FilterCriterion } from '../utils/filterUtils';
import { serializeFilters, deserializeFilters } from '../utils/filterUtils';
import type { IsochroneMode } from '../utils/isochrone';
import type { QualityWeights } from '../utils/qualityIndex';
import {
  getDefaultWeights, getPersonaWeights, detectPersona, isCustomWeights,
  QUALITY_FACTORS, QUALITY_PERSONAS,
} from '../utils/qualityIndex';
import {
  SIMILARITY_METRIC_KEYS, SIMILARITY_WEIGHT_MIN, SIMILARITY_WEIGHT_MAX, SIMILARITY_WEIGHT_DEFAULT,
} from '../utils/similarity';
import type { WizardAnswers } from './useWizardProfile';
import { serializeWizardProfile, deserializeWizardProfile, isCustomWizardAnswers } from './useWizardProfile';

/**
 * IN-3: share-URL schema version.
 *
 * Stamped onto shared links as `_v=<n>` so future schema changes can migrate or
 * safely clamp old/foreign links instead of restoring wrong-but-plausible state.
 * Bump this whenever the *encoding* of any structured param (filter/qw/iso/v/sl/…)
 * changes incompatibly, and add a migration branch in `migrateParams()`.
 *
 * History:
 *   1 — implicit legacy: any link without `_v` (every link shipped before IN-3).
 *   2 — current: `_v=2`, identical param semantics to v1 (the tag is additive).
 *
 * The key is `_v` rather than the roadmap's suggested `sv` because `sv` is the
 * Swedish language code used pervasively as a *value* (`lang=sv`); a `sv` param
 * key would be ambiguous. `_v` is unambiguous and collision-free.
 */
export const URL_SCHEMA_VERSION = 2;

/** Implicit version of any legacy link that predates the `_v` tag. */
const LEGACY_SCHEMA_VERSION = 1;

/** The URL param key carrying the schema version. */
const SCHEMA_VERSION_KEY = '_v';

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

/** CF-1: affordability-calculator inputs carried in the share URL. */
export interface UrlAffordability {
  mode: 'income' | 'budget';
  /** €/month — net income (income mode) or housing budget (budget mode). */
  amount: number;
  /** Apartment size in m². */
  sizeM2: number;
}

/**
 * CF-9: a shared drawn/selected analysis area (reopens AreaSummaryPanel on restore).
 *
 * Two shapes, distinguished by `mode`:
 *  - 'select'  — a tapped-neighbourhood multi-selection, carried as a pno list.
 *  - 'polygon' — a free-hand drawn ring, carried as a quantized vertex list.
 */
export type UrlDraw =
  | { mode: 'select'; pnos: string[] }
  | { mode: 'polygon'; vertices: [number, number][] };

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
  // CF-7: each criterion's per-criterion mode (absolute vs percentile) round-trips
  // inside the same `filter` param via serializeFilters/deserializeFilters (a trailing
  // `~p` flag), which is already gated by the IN-3 version guard (VERSIONED_PARAM_KEYS).
  filters: FilterCriterion[];
  // CF-1: custom quality weights (from a persona id or a diff), null when default.
  weights: QualityWeights | null;
  // CF-1: a saved isochrone overlay, null when absent.
  isochrone: UrlIsochrone | null;
  // CF-1: map camera, only present when shared via "copy link to this view".
  viewport: UrlViewport | null;
  // QW-2: shared shortlist (postal codes), empty when absent.
  shortlist: string[];
  // CF-1 (affordability): shared rent/buy calculator inputs, null when absent.
  affordability: UrlAffordability | null;
  // CF-5: per-metric similarity weights (only non-default entries), null when absent.
  simWeights: Record<string, number> | null;
  // CF-9: shared drawn/selected analysis area, null when absent.
  draw: UrlDraw | null;
  // CF-4: shared wizard priority profile, null when absent.
  wizardProfile: WizardAnswers | null;
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
  /** CF-1 (affordability): rent/buy calculator inputs. */
  affordability?: UrlAffordability | null;
  /** CF-5: per-metric similarity weights (only non-default entries carried). */
  simWeights?: Record<string, number> | null;
  /** CF-9: drawn/selected analysis area. */
  draw?: UrlDraw | null;
  /** CF-4: wizard priority profile. */
  wizardProfile?: WizardAnswers | null;
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

// ─── CF-1: affordability calculator URL codec ───────────────────────────────
// Encoded as `aff=i~3000~50` (income mode) or `aff=b~1200~50` (budget mode),
// i.e. `<mode>~<amount>~<sizeM2>`. Amount/size are clamped to the same generous
// bounds the input form enforces so a hand-edited link can never inject absurd
// values. Defaults are omitted entirely by the serializer (no `aff` when unset).
const AFF_AMOUNT_MAX = 1_000_000;
const AFF_SIZE_MAX = 1000;

function serializeAffordability(a: UrlAffordability): string {
  const m = a.mode === 'budget' ? 'b' : 'i';
  return `${m}~${Math.round(a.amount)}~${Math.round(a.sizeM2)}`;
}

function deserializeAffordability(s: string): UrlAffordability | null {
  const [modeRaw, amountRaw, sizeRaw] = s.split('~');
  const mode = modeRaw === 'b' ? 'budget' : modeRaw === 'i' ? 'income' : null;
  const amount = Number(amountRaw);
  const sizeM2 = Number(sizeRaw);
  if (
    mode &&
    Number.isFinite(amount) && amount >= 1 && amount <= AFF_AMOUNT_MAX &&
    Number.isFinite(sizeM2) && sizeM2 >= 1 && sizeM2 <= AFF_SIZE_MAX
  ) {
    return { mode, amount: Math.round(amount), sizeM2: Math.round(sizeM2) };
  }
  return null;
}

// ─── CF-5: similarity-weight URL codec ──────────────────────────────────────
// The per-metric similarity weights (0–3, default 1) are encoded compactly as
// `simw=hr_mtu:2,crime_index:0` — only the metrics that differ from the neutral
// default of 1 are listed, so an all-default configuration omits the param
// entirely. Unknown keys and out-of-range values are dropped on decode.

function serializeSimWeights(w: Record<string, number>): string {
  const parts: string[] = [];
  for (const key of Object.keys(w)) {
    if (!SIMILARITY_METRIC_KEYS.has(key)) continue;
    const v = Math.round(w[key]);
    if (!Number.isFinite(v) || v === SIMILARITY_WEIGHT_DEFAULT) continue;
    if (v < SIMILARITY_WEIGHT_MIN || v > SIMILARITY_WEIGHT_MAX) continue;
    parts.push(`${key}:${v}`);
  }
  return parts.join(',');
}

function deserializeSimWeights(encoded: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of encoded.split(',')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    const val = Number(part.slice(idx + 1));
    if (
      SIMILARITY_METRIC_KEYS.has(key) &&
      Number.isFinite(val) &&
      val >= SIMILARITY_WEIGHT_MIN && val <= SIMILARITY_WEIGHT_MAX &&
      val !== SIMILARITY_WEIGHT_DEFAULT
    ) {
      out[key] = Math.round(val);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ─── CF-9: drawn / selected-areas URL codec ─────────────────────────────────
// The shared analysis area is encoded in a single `draw` param, prefixed by mode:
//   - select-areas:  `draw=s:00100.00200.00300`  (dot-joined pnos, like `sl`)
//   - free polygon:  `draw=p:24.94~60.17_24.95~60.18_…`  (`lng~lat` vertices,
//     quantized to 5 decimals like the `v` viewport codec, `_`-joined).
// Polygons are capped at DRAW_MAX_VERTICES and every vertex is Finland-bbox-clamped
// on PARSE so a hand-edited link can never inject an off-world or unbounded ring.
const DRAW_MAX_VERTICES = 60;
// Finland bounding box (shared with the viewport codec): lng 18–33, lat 58–71.
const FIN_LNG_MIN = 18, FIN_LNG_MAX = 33, FIN_LAT_MIN = 58, FIN_LAT_MAX = 71;

function serializeDraw(d: UrlDraw): string {
  if (d.mode === 'select') return `s:${d.pnos.join('.')}`;
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  // Drop the redundant closing vertex (ring is re-closed on parse) and cap length.
  const verts = d.vertices.slice(0, DRAW_MAX_VERTICES);
  return `p:${verts.map(([lng, lat]) => `${round(lng)}~${round(lat)}`).join('_')}`;
}

function deserializeDraw(s: string): UrlDraw | null {
  const idx = s.indexOf(':');
  if (idx !== 1) return null;
  const tag = s[0];
  const body = s.slice(2);
  if (tag === 's') {
    const pnos = body.split('.').filter((p) => /^\d{5}$/.test(p));
    return pnos.length > 0 ? { mode: 'select', pnos } : null;
  }
  if (tag === 'p') {
    const vertices: [number, number][] = [];
    for (const pair of body.split('_')) {
      if (vertices.length >= DRAW_MAX_VERTICES) break;
      const [lngStr, latStr] = pair.split('~');
      const lng = Number(lngStr);
      const lat = Number(latStr);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      // Bbox-clamp on parse: silently drop any vertex outside Finland.
      if (lng < FIN_LNG_MIN || lng > FIN_LNG_MAX || lat < FIN_LAT_MIN || lat > FIN_LAT_MAX) continue;
      vertices.push([lng, lat]);
    }
    // A polygon needs at least 3 distinct vertices to enclose any area.
    return vertices.length >= 3 ? { mode: 'polygon', vertices } : null;
  }
  return null;
}

/**
 * IN-3: read and normalise the share-URL schema version.
 *
 * Returns a finite integer >= 1. Absent, empty, or unparseable `_v` is treated
 * as the implicit legacy version (1) — best-effort, never a throw — so old and
 * hand-mangled links still parse rather than blanking the whole state.
 */
function readSchemaVersion(searchParams: URLSearchParams): number {
  const raw = searchParams.get(SCHEMA_VERSION_KEY);
  if (raw == null) return LEGACY_SCHEMA_VERSION;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return LEGACY_SCHEMA_VERSION;
  return n;
}

/**
 * IN-3: migration / clamp guard applied to the *structured* (encoded) params.
 *
 * Simple, self-validating primitives (pno/layer/compare/city/scope/year/cb/lang/ref)
 * have a stable format across versions and are always honoured. The structured
 * params whose encoding could change between schema versions (filter, qp/qw, iso,
 * v, sl) are gated here:
 *
 *  - version <= URL_SCHEMA_VERSION (incl. legacy v1): the current decoders read
 *    every prior encoding, so the params pass through untouched.
 *  - version  > URL_SCHEMA_VERSION (a link from a *newer* build than this one):
 *    we cannot trust an encoding from the future, so the structured params are
 *    dropped (clamped to absent) rather than mis-decoded into plausible-but-wrong
 *    state. Primitives are still kept so the link is not wholly inert.
 *
 * Returns the raw string for each structured param, or null to ignore it.
 */
type StructuredParams = {
  filterRaw: string | null;
  qpRaw: string | null;
  qwRaw: string | null;
  isoRaw: string | null;
  viewRaw: string | null;
  slRaw: string | null;
  affRaw: string | null;
  simwRaw: string | null;
  drawRaw: string | null;
  wpRaw: string | null;
};

function migrateParams(searchParams: URLSearchParams, version: number): StructuredParams {
  const read = (key: string): string | null => searchParams.get(key);
  // Newer-than-current schema: discard structured params we may decode incorrectly.
  if (version > URL_SCHEMA_VERSION) {
    return { filterRaw: null, qpRaw: null, qwRaw: null, isoRaw: null, viewRaw: null, slRaw: null, affRaw: null, simwRaw: null, drawRaw: null, wpRaw: null };
  }
  // v1 (legacy) … current: every prior encoding is still readable as-is.
  return {
    filterRaw: read('filter'),
    qpRaw: read('qp'),
    qwRaw: read('qw'),
    isoRaw: read('iso'),
    viewRaw: read('v'),
    slRaw: read('sl'),
    affRaw: read('aff'),
    simwRaw: read('simw'),
    drawRaw: read('draw'),
    wpRaw: read('wp'),
  };
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

  // IN-3: resolve the schema version, then gate the structured params through the
  // migration/clamp guard. Simple primitives below are read directly (stable format).
  const schemaVersion = readSchemaVersion(searchParams);
  const { filterRaw, qpRaw, qwRaw, isoRaw, viewRaw, slRaw, affRaw, simwRaw, drawRaw, wpRaw } = migrateParams(searchParams, schemaVersion);

  // CF-1: extended analytical state (query params only — legacy hash links never had these).
  const scopeRaw = searchParams.get('scope');
  const yearRaw = searchParams.get('year');
  const cbRaw = searchParams.get('cb');
  const langRaw = searchParams.get('lang');
  const refRaw = searchParams.get('ref');

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
    affordability: affRaw ? deserializeAffordability(affRaw) : null,
    simWeights: simwRaw ? deserializeSimWeights(simwRaw) : null,
    draw: drawRaw ? deserializeDraw(drawRaw) : null,
    wizardProfile: wpRaw ? deserializeWizardProfile(wpRaw) : null,
  };
}

/**
 * IN-3: param keys whose *encoding* is structured and therefore version-sensitive.
 *
 * A link carrying any of these needs the `_v` stamp so a future build can migrate
 * or clamp it (see `migrateParams`). Simple self-validating primitives (pno, layer,
 * compare, city, scope, year, cb, lang, ref) are deliberately excluded — they keep
 * shared URLs and the existing exact-URL tests free of the version tag. Future items
 * (e.g. CF-9's `draw`) should add their encoded key here when factored through
 * `serializeUrlParams`.
 */
const VERSIONED_PARAM_KEYS = ['filter', 'qp', 'qw', 'iso', 'v', 'sl', 'aff', 'simw', 'draw', 'wp'] as const;

/** True when the built params carry at least one structured/version-sensitive key. */
function hasVersionedParams(params: URLSearchParams): boolean {
  return VERSIONED_PARAM_KEYS.some((k) => params.has(k));
}

/**
 * IN-3: stamp the current schema version onto a params set, omit-default style.
 *
 * Only emitted when the link carries a structured param that actually needs the
 * version to be decoded safely; plain primitive links (and empty URLs) stay clean.
 * Mutates and returns `params` for chaining.
 */
function stampSchemaVersion(params: URLSearchParams): URLSearchParams {
  if (hasVersionedParams(params)) params.set(SCHEMA_VERSION_KEY, String(URL_SCHEMA_VERSION));
  return params;
}

/**
 * IN-3: shared serialization of app state → URL params, reused by `writeUrl` and
 * `buildViewportShareUrl` (and intended for future items adding their own params).
 * Does NOT include the viewport (`v`) — that is appended only on explicit share —
 * and does NOT stamp the schema version; callers decide when to `stampSchemaVersion`.
 * Default values are omitted to keep URLs short.
 */
function serializeUrlParams(pno: string | null, layer: LayerId, comparePnos: string[], city: string, extras: ExtraUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (pno) params.set('pno', pno);
  if (layer !== 'quality_index') params.set('layer', layer);
  if (comparePnos.length > 0) params.set('compare', comparePnos.join(','));
  if (city && city !== DEFAULT_CITY) params.set('city', city);
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
  // CF-1: affordability calculator inputs (omitted entirely when unset).
  if (extras.affordability) params.set('aff', serializeAffordability(extras.affordability));
  // CF-5: per-metric similarity weights — only non-default entries, omitted when all default.
  if (extras.simWeights) {
    const simw = serializeSimWeights(extras.simWeights);
    if (simw) params.set('simw', simw);
  }
  // CF-9: drawn/selected analysis area (omitted entirely when no area is active).
  if (extras.draw) {
    const draw = serializeDraw(extras.draw);
    if (draw.length > 2) params.set('draw', draw); // skip an empty body (just the mode prefix)
  }
  // CF-4: wizard priority profile — only when it differs from the defaults.
  if (extras.wizardProfile && isCustomWizardAnswers(extras.wizardProfile)) {
    params.set('wp', serializeWizardProfile(extras.wizardProfile));
  }
  return params;
}

/** Write current app state to URL query params. Default values are omitted to keep URLs short. */
function writeUrl(pno: string | null, layer: LayerId, comparePnos: string[], city: string = DEFAULT_CITY, extras: ExtraUrlState = {}) {
  const params = serializeUrlParams(pno, layer, comparePnos, city, extras);
  // NB: viewport (`v`) is intentionally never written here — continuous panning
  // would churn replaceState. It is appended only by buildViewportShareUrl().
  // IN-3: stamp the schema version only for links carrying a structured param.
  stampSchemaVersion(params);
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

/**
 * CF-11: build a MINIMAL shareable URL carrying ONLY the shortlist (`sl`) and the
 * `city`, deliberately dropping the author's unrelated layer/filter/weight/selection
 * state so the recipient gets the candidate set on a clean view. Reuses the shared
 * `serializeUrlParams` serializer (no other params leak because only `shortlist` is
 * passed) and stamps the IN-3 schema version (`sl` is a structured/versioned key).
 * Returns the bare origin when the shortlist is empty.
 */
export function buildShortlistShareUrl(shortlist: string[], city: string = DEFAULT_CITY): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const pnos = shortlist.filter((p) => /^\d{5}$/.test(p));
  if (pnos.length === 0) return base;
  const params = serializeUrlParams(null, 'quality_index', [], city, { shortlist: pnos });
  stampSchemaVersion(params);
  const str = params.toString();
  return str ? `${base}?${str}` : base;
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
    // IN-3: `v` is a structured/version-sensitive param, so stamp the schema version.
    stampSchemaVersion(u.searchParams);
    return u.toString();
  } catch {
    return base;
  }
}

/** Keep the browser URL in sync with the current selection, layer, pinned comparisons, and city.
 *  Debounced to avoid redundant replaceState calls when multiple values change in the same tick.
 *  When `ready` is false, URL writes are suppressed to avoid clearing params from the initial
 *  URL before the restoration effect has consumed them (e.g., pinned neighborhoods). */
export function useSyncUrlState(pno: string | null, layer: LayerId, comparePnos: string[] = [], city: string = DEFAULT_CITY, ready = true, extras: ExtraUrlState = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { scope, year, colorblind, lang, ref, filters, weights, isochrone, shortlist, affordability, simWeights, draw, wizardProfile } = extras;
  // Depend on serialized keys, not object/array references, so an unchanged value
  // never re-triggers the URL write.
  const filterKey = filters && filters.length > 0 ? serializeFilters(filters) : '';
  const weightsKey = weightsParamKey(weights);
  const isoKey = isochrone ? `${isochrone.mode}~${isochrone.budget}` : '';
  const shortlistKey = shortlist && shortlist.length > 0 ? shortlist.join('.') : '';
  const affKey = affordability ? serializeAffordability(affordability) : '';
  const simwKey = simWeights ? serializeSimWeights(simWeights) : '';
  const drawKey = draw ? serializeDraw(draw) : '';
  const wpKey = wizardProfile && isCustomWizardAnswers(wizardProfile) ? serializeWizardProfile(wizardProfile) : '';
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!ready) return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    timerRef.current = setTimeout(() => writeUrl(pno, layer, comparePnos, city, { scope, year, colorblind, lang, ref, filters, weights, isochrone, shortlist, affordability, simWeights, draw, wizardProfile }), 100);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- object/array extras are tracked via their serialized *Key deps
  }, [pno, layer, comparePnos, city, ready, scope, year, colorblind, lang, ref, filterKey, weightsKey, isoKey, shortlistKey, affKey, simwKey, drawKey, wpKey]);
}
