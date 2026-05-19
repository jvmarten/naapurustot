/**
 * Embed mode (QW-7) — when the app is loaded with `?embed=1`, hides the header,
 * tools dropdown, settings, user menu, and search bar so the map renders edge-to-edge
 * inside an iframe. A small attribution watermark links back to naapurustot.fi.
 *
 * Read once at module load so all components see a consistent value. The flag
 * is intentionally not reactive — entering/leaving embed mode requires a reload.
 */
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

/** Build an iframe embed snippet from the current map state. */
export function buildEmbedSnippet({
  pno,
  layer,
  city,
  origin,
}: {
  pno: string | null;
  layer: string | null;
  city: string | null;
  origin?: string;
}): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://naapurustot.fi');
  const params = new URLSearchParams();
  params.set('embed', '1');
  if (pno) params.set('pno', pno);
  if (layer && layer !== 'quality_index') params.set('layer', layer);
  if (city && city !== 'helsinki_metro') params.set('city', city);
  const url = `${base}/?${params.toString()}`;
  return `<iframe src="${url}" width="640" height="480" style="border:0;border-radius:12px;max-width:100%" loading="lazy" title="naapurustot.fi"></iframe>`;
}
