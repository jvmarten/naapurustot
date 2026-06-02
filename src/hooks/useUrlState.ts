import { useEffect, useRef } from 'react';
import type { LayerId, ColorblindType } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';
import { REGION_IDS } from '../utils/regions';
import type { Lang } from '../utils/i18n';

/** CF-1: comparison scope carried in the URL ('all' = whole Finland, 'region' = within region). */
export type UrlScope = 'all' | 'region';

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
}

/** CF-1: the extra analytical state the URL can carry beyond pno/layer/compare/city. */
export interface ExtraUrlState {
  scope?: UrlScope;
  year?: number | null;
  colorblind?: ColorblindType;
  lang?: Lang;
}

const VALID_CITIES = new Set<string>(['all', ...REGION_IDS]);

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));
const VALID_CB = new Set<string>(['off', 'protanopia', 'deuteranopia', 'tritanopia']);
const VALID_LANG = new Set<string>(['fi', 'en', 'sv']);

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

/** Keep the browser URL in sync with the current selection, layer, pinned comparisons, and city.
 *  Debounced to avoid redundant replaceState calls when multiple values change in the same tick.
 *  When `ready` is false, URL writes are suppressed to avoid clearing params from the initial
 *  URL before the restoration effect has consumed them (e.g., pinned neighborhoods). */
export function useSyncUrlState(pno: string | null, layer: LayerId, comparePnos: string[] = [], city: string = 'helsinki_metro', ready = true, extras: ExtraUrlState = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { scope, year, colorblind, lang } = extras;
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!ready) return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    timerRef.current = setTimeout(() => writeUrl(pno, layer, comparePnos, city, { scope, year, colorblind, lang }), 100);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pno, layer, comparePnos, city, ready, scope, year, colorblind, lang]);
}
