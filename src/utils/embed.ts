/**
 * Embed mode (QW-7) — when the app is loaded with `?embed=1`, hides the header,
 * tools dropdown, settings, user menu, and search bar so the map renders edge-to-edge
 * inside an iframe. A small attribution watermark links back to naapurustot.fi.
 *
 * Read once at module load so all components see a consistent value. The flag
 * is intentionally not reactive — entering/leaving embed mode requires a reload.
 */
import { DEFAULT_CITY } from './regions';

function detectEmbed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === '1';
  } catch {
    return false;
  }
}

export const IS_EMBED = detectEmbed();

/** The shared map state an embed iframe / deep link can reproduce (QW-3). */
export interface EmbedState {
  pno: string | null;
  layer: string | null;
  city: string | null;
  compare?: string[];
  scope?: string;
  year?: number | null;
  colorblind?: string;
  lang?: string;
}

/**
 * QW-3: serialize the shared map state into URL params using the same keys (and
 * omit-default rules) as useUrlState, so an embed and an "open full view" link
 * reproduce the exact configured view.
 */
function stateParams(s: EmbedState): URLSearchParams {
  const params = new URLSearchParams();
  if (s.pno) params.set('pno', s.pno);
  if (s.layer && s.layer !== 'quality_index') params.set('layer', s.layer);
  if (s.city && s.city !== DEFAULT_CITY) params.set('city', s.city);
  if (s.compare && s.compare.length > 0) params.set('compare', s.compare.join(','));
  if (s.scope && s.scope !== 'all') params.set('scope', s.scope);
  if (s.year != null) params.set('year', String(s.year));
  if (s.colorblind && s.colorblind !== 'off') params.set('cb', s.colorblind);
  if (s.lang && s.lang !== 'fi') params.set('lang', s.lang);
  return params;
}

function originBase(origin?: string): string {
  return origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://naapurustot.fi');
}

/** QW-3: full-app deep link reproducing the current state (for the embed "open full view" overlay). */
export function buildFullViewUrl(state: EmbedState, origin?: string): string {
  const qs = stateParams(state).toString();
  return `${originBase(origin)}/${qs ? `?${qs}` : ''}`;
}

/**
 * Build an iframe embed snippet carrying the full current map state, plus a tiny
 * resize listener so a host page can auto-size the iframe to the height the
 * embedded app posts via postMessage (`naapurustot:height`).
 */
export function buildEmbedSnippet(state: EmbedState & { origin?: string }): string {
  const params = stateParams(state);
  params.set('embed', '1');
  const url = `${originBase(state.origin)}/?${params.toString()}`;
  const id = 'naapurustot-embed';
  const script =
    `<script>window.addEventListener("message",function(e){` +
    `if(e.data&&e.data.type==="naapurustot:height"){` +
    `var f=document.getElementById("${id}");if(f&&e.data.height){f.style.height=e.data.height+"px";}}});</script>`;
  return (
    `<iframe id="${id}" src="${url}" width="640" height="480" ` +
    `style="border:0;border-radius:12px;max-width:100%;width:100%" loading="lazy" title="naapurustot.fi"></iframe>\n${script}`
  );
}

/**
 * QW-3: from inside an embedded iframe, post the content height to the host so it
 * can auto-size the iframe. No-op outside an iframe or when the parent is same-origin
 * unreachable.
 */
export function postEmbedHeight(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const height = Math.ceil(
    Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      window.innerHeight || 0,
    ),
  );
  try {
    window.parent.postMessage({ type: 'naapurustot:height', height }, '*');
  } catch {
    /* cross-origin parent — ignore */
  }
}
