import { useEffect } from 'react';
import type { LayerId } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';

interface UrlState {
  pno: string | null;
  layer: LayerId | null;
  compare: string[];
}

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));

function parseUrl(): UrlState {
  // Support both query params (?pno=) and legacy hash (#pno=) for backwards compat
  const searchParams = new URLSearchParams(window.location.search);
  let pno = searchParams.get('pno');
  let layer = searchParams.get('layer');
  let compare = searchParams.get('compare');

  // Fallback: read from hash for old bookmarks/links
  if (!pno && !layer && !compare && window.location.hash) {
    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    pno = hashParams.get('pno');
    layer = hashParams.get('layer');
    compare = hashParams.get('compare');

    // Migrate hash to query params silently
    if (pno || layer || compare) {
      const newParams = new URLSearchParams();
      if (pno) newParams.set('pno', pno);
      if (layer) newParams.set('layer', layer);
      if (compare) newParams.set('compare', compare);
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
  };
}

function writeUrl(pno: string | null, layer: LayerId, comparePnos: string[]) {
  const params = new URLSearchParams();
  if (pno) params.set('pno', pno);
  if (layer !== 'quality_index') params.set('layer', layer);
  if (comparePnos.length > 0) params.set('compare', comparePnos.join(','));
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

const EMPTY_COMPARE: string[] = [];

/** Keep the browser URL in sync with the current selection, layer, and pinned comparisons. */
export function useSyncUrlState(pno: string | null, layer: LayerId, comparePnos: string[] = EMPTY_COMPARE) {
  // Write state changes to URL
  useEffect(() => {
    writeUrl(pno, layer, comparePnos);
  }, [pno, layer, comparePnos]);
}
