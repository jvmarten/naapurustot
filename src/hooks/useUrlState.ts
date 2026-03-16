import { useEffect, useRef } from 'react';
import type { LayerId } from '../utils/colorScales';
import { LAYERS } from '../utils/colorScales';

interface UrlState {
  pno: string | null;
  layer: LayerId | null;
}

const VALID_LAYER_IDS = new Set<string>(LAYERS.map((l) => l.id));

function parseHash(): UrlState {
  const hash = window.location.hash.slice(1); // remove '#'
  const params = new URLSearchParams(hash);
  const pno = params.get('pno');
  const layer = params.get('layer');
  return {
    pno: pno && /^\d{5}$/.test(pno) ? pno : null,
    layer: layer && VALID_LAYER_IDS.has(layer) ? (layer as LayerId) : null,
  };
}

function writeHash(pno: string | null, layer: LayerId) {
  const params = new URLSearchParams();
  if (pno) params.set('pno', pno);
  if (layer !== 'quality_index') params.set('layer', layer);
  const str = params.toString();
  const newHash = str ? `#${str}` : '';
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, '', newHash || window.location.pathname);
  }
}

export function readInitialUrlState(): UrlState {
  return parseHash();
}

export function useSyncUrlState(pno: string | null, layer: LayerId) {
  const skipNextHashChange = useRef(false);

  // Write state changes to URL
  useEffect(() => {
    skipNextHashChange.current = true;
    writeHash(pno, layer);
  }, [pno, layer]);
}
