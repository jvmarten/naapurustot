import React, { useCallback, useState, useRef, useMemo } from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import { exportGeoJson } from '../utils/export';
import { readNote } from '../hooks/useNotes';
import { trackEvent } from '../utils/analytics';
import type { NeighborhoodProperties } from '../utils/metrics';

export interface ShortlistEntry {
  pno: string;
  name: string;
}

interface ShortlistTrayProps {
  entries: ShortlistEntry[];
  onSelect: (pno: string) => void;
  onRemove: (pno: string) => void;
  onCompare: () => void;
  onClear: () => void;
  /** CF-10: resolve a pno's full map feature (geometry + raw props) so the
   *  shortlist can be exported as GeoJSON. App threads this from pnoFeatureMap. */
  featureFor?: (pno: string) => GeoJSON.Feature | null;
  /** CF-11: a MINIMAL deep link carrying ONLY the shortlist (`sl`) + `city` — none
   *  of the author's layer/filter/weight state — built by App via buildShortlistShareUrl. */
  shareUrl?: string;
  /** CF-3: when set, the tray is showing over an open panel (expanded from the
   *  compact chip) — the title becomes a button that collapses it back to the chip. */
  onCollapse?: () => void;
}

/**
 * QW-2: floating tray on the home view showing the user's shortlist as chips —
 * click a chip to view that area, remove it, compare the set (pins up to 3), or
 * clear all. Renders nothing when the shortlist is empty.
 *
 * CF-11: also exposes a "Share shortlist" affordance (clipboard / Web Share of the
 * minimal `sl`+`city` link), a branded shortlist summary image card, and CSV/PDF
 * export. The card + exports lazy-load their heavy modules on click.
 */
export const ShortlistTray: React.FC<ShortlistTrayProps> = React.memo(({ entries, onSelect, onRemove, onCompare, onClear, featureFor, shareUrl, onCollapse }) => {
  useI18nVersion();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // E3: URL revealed for manual copy when the clipboard is blocked.
  const [copyFallbackUrl, setCopyFallbackUrl] = useState<string | null>(null);
  // E5: transient "couldn't generate image" message when the card export fails.
  const [imgError, setImgError] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const imgErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => { clearTimeout(copiedTimerRef.current); clearTimeout(imgErrorTimerRef.current); }, []);

  // Resolve the shortlisted areas' full properties (name + quality + metrics) for
  // the image card and CSV/PDF export. Entries whose feature isn't loaded are skipped.
  const resolveProps = useCallback((): NeighborhoodProperties[] => {
    if (!featureFor) return [];
    return entries
      .map((e) => featureFor(e.pno)?.properties as NeighborhoodProperties | undefined)
      .filter((p): p is NeighborhoodProperties => p != null);
  }, [entries, featureFor]);

  // CF-10: export the whole shortlist as GeoJSON. Geometry is threaded from
  // App's pnoFeatureMap via featureFor; entries missing a feature are skipped.
  const handleExportGeoJson = useCallback(() => {
    if (!featureFor) return;
    const features = entries
      .map((e) => featureFor(e.pno))
      .filter((f): f is GeoJSON.Feature => f != null);
    if (features.length === 0) return;
    trackEvent('export-shortlist-geojson', { count: features.length });
    exportGeoJson(features);
  }, [entries, featureFor]);

  // CF-11: share the minimal shortlist link via Web Share, falling back to clipboard.
  const handleShareLink = useCallback(async () => {
    if (!shareUrl) return;
    trackEvent('share-shortlist-link', { count: entries.length });
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('shortlist.title'), url: shareUrl });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
      }
    }
    // E3: clipboard blocked/unavailable — reveal the link for a manual copy
    // rather than failing silently.
    if (!navigator.clipboard?.writeText) {
      setCopyFallbackUrl(shareUrl);
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFallbackUrl(shareUrl);
    }
  }, [shareUrl, entries.length]);

  // CF-11: branded shortlist summary image card (lazy html-to-image).
  const handleShareImage = useCallback(async () => {
    const areas = resolveProps();
    if (areas.length === 0 || busy) return;
    setBusy(true);
    trackEvent('share-shortlist-card', { count: areas.length });
    try {
      const { generateShortlistCard } = await import('../utils/scoreCard');
      await generateShortlistCard(areas, shareUrl ?? 'https://naapurustot.fi');
    } catch {
      // E5: the heavy html-to-image chunk failed to load (offline, stale chunk
      // after a deploy) or the render threw — surface it instead of an unhandled
      // rejection + a silently reverted button.
      setImgError(true);
      clearTimeout(imgErrorTimerRef.current);
      imgErrorTimerRef.current = setTimeout(() => setImgError(false), 3000);
    } finally {
      setBusy(false);
    }
  }, [resolveProps, busy, shareUrl]);

  const handleExportCsv = useCallback(async () => {
    const areas = resolveProps();
    if (areas.length === 0) return;
    trackEvent('export-shortlist-csv', { count: areas.length });
    const { exportShortlistCsv } = await import('../utils/export');
    exportShortlistCsv(areas);
  }, [resolveProps]);

  const handleExportPdf = useCallback(async () => {
    const areas = resolveProps();
    if (areas.length === 0) return;
    trackEvent('export-shortlist-pdf', { count: areas.length });
    const { exportShortlistPdf } = await import('../utils/export');
    exportShortlistPdf(areas);
  }, [resolveProps]);

  // CF-3: mark chips whose area has a saved visit note, so the private notes are
  // discoverable from the shortlist. Recomputed when the set of entries changes.
  const notedPnos = useMemo(
    () => new Set(entries.filter((e) => readNote(e.pno) !== '').map((e) => e.pno)),
    [entries],
  );

  if (entries.length === 0) return null;

  const sep = <span className="text-surface-300 dark:text-surface-700" aria-hidden>·</span>;

  return (
    <div className="fixed md:absolute bottom-24 md:bottom-24 left-1/2 -translate-x-1/2 z-10 w-[min(92vw,560px)] pointer-events-none">
      <div className="pointer-events-auto rounded-2xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                      border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          {onCollapse ? (
            <button
              onClick={onCollapse}
              title={t('aria.close')}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
            >
              {t('shortlist.title')} ({entries.length})<span aria-hidden>⌄</span>
            </button>
          ) : (
            <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('shortlist.title')} ({entries.length})
            </div>
          )}
          {/* M3: wrap instead of overflowing, and give each action a 44px touch
              target on mobile (the row previously packed up to 7 bare text buttons). */}
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs
                          [&_button]:inline-flex [&_button]:items-center [&_button]:min-h-[44px] md:[&_button]:min-h-0">
            <button onClick={onCompare} className="text-brand-600 dark:text-brand-300 font-semibold hover:underline">
              {t('shortlist.compare')}
            </button>
            {shareUrl && (
              <>
                {sep}
                <button
                  onClick={handleShareLink}
                  className="text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors"
                  title={t('shortlist.share_link_hint')}
                >
                  {copied ? t('share.link_copied') : t('shortlist.share_link')}
                </button>
              </>
            )}
            {featureFor && (
              <>
                {sep}
                <button
                  onClick={handleShareImage}
                  disabled={busy}
                  className="text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors disabled:opacity-50"
                  title={t('share.image')}
                >
                  {busy ? t('share.generating') : t('share.image')}
                </button>
                {sep}
                <button
                  onClick={handleExportCsv}
                  className="text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors"
                  title={t('export.csv')}
                >
                  {t('export.csv')}
                </button>
                {sep}
                <button
                  onClick={handleExportPdf}
                  className="text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors"
                  title={t('export.pdf')}
                >
                  {t('export.pdf')}
                </button>
                {sep}
                <button
                  onClick={handleExportGeoJson}
                  className="text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors"
                  title={t('export.geojson')}
                >
                  {t('export.geojson')}
                </button>
              </>
            )}
            {sep}
            <button onClick={onClear} className="text-surface-500 hover:text-rose-500 dark:text-surface-400 transition-colors">
              {t('shortlist.clear')}
            </button>
          </div>
        </div>
        {/* E5: transient image-export failure notice. */}
        {imgError && (
          <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400" role="status">{t('share.image_failed')}</p>
        )}
        {/* E3: clipboard blocked — reveal the link for a manual select-all copy. */}
        {copyFallbackUrl !== null && (
          <div className="mb-2">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{t('share.copy_failed')}</p>
              <button onClick={() => setCopyFallbackUrl(null)} aria-label={t('aria.close')} className="shrink-0 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <textarea
              readOnly
              value={copyFallbackUrl}
              onFocus={(e) => e.currentTarget.select()}
              rows={2}
              className="w-full text-[11px] font-mono text-surface-700 dark:text-surface-200 bg-surface-50 dark:bg-surface-800
                         border border-surface-200 dark:border-surface-700/40 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/50"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {entries.map((e) => (
            <span
              key={e.pno}
              className="inline-flex items-center gap-1 max-w-[180px] pl-2.5 pr-1 py-1 rounded-full text-xs
                         bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200"
            >
              {notedPnos.has(e.pno) && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0"
                  aria-label={t('shortlist.has_note')}
                  title={t('shortlist.has_note')}
                />
              )}
              <button onClick={() => onSelect(e.pno)} className="truncate hover:text-brand-600 dark:hover:text-brand-300">
                {e.name}
              </button>
              <button
                onClick={() => onRemove(e.pno)}
                aria-label={t('shortlist.remove')}
                title={t('shortlist.remove')}
                className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-surface-400 hover:text-rose-500 hover:bg-surface-200 dark:hover:bg-surface-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
ShortlistTray.displayName = 'ShortlistTray';
