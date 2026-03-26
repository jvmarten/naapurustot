import { useEffect, useRef } from 'react';
import type { LayerId } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';

interface UrlState {
  pno: string | null;
  layer: LayerId | null;
  compare: string[];
  city: string | null;
}

const VALID_CITIES = new Set(['all', 'helsinki_metro', 'turku', 'tampere']);

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));

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

  return {
    pno: pno && /^\d{5}$/.test(pno) ? pno : null,
    layer: layer && VALID_LAYER_IDS.has(layer) ? (layer as LayerId) : null,
    compare: compare
      ? compare.split(',').filter((p) => /^\d{5}$/.test(p))
      : [],
    city: city && VALID_CITIES.has(city) ? city : null,
  };
}

function writeUrl(pno: string | null, layer: LayerId, comparePnos: string[], city: string = 'helsinki_metro') {
  const params = new URLSearchParams();
  if (pno) params.set('pno', pno);
  if (layer !== 'quality_index') params.set('layer', layer);
  if (comparePnos.length > 0) params.set('compare', comparePnos.join(','));
  if (city && city !== 'helsinki_metro') params.set('city', city);
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
 *  Debounced to avoid redundant replaceState calls when multiple values change in the same tick. */
export function useSyncUrlState(pno: string | null, layer: LayerId, comparePnos: string[] = [], city: string = 'helsinki_metro') {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => writeUrl(pno, layer, comparePnos, city), 100);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pno, layer, comparePnos, city]);
}
