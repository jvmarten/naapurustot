import React, { useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { type LayerId, type LayerConfig, getLayerById, getColorForValue } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t, useI18nVersion } from '../utils/i18n';
import { getFeatureCenter } from '../utils/geometryFilter';
import { exportRankingCsv } from '../utils/export';
import { buildFullViewUrl } from '../utils/embed';
import { FilterEmptyIllustration } from './EmptyStateIllustrations';

interface RankingTableProps {
  data: FeatureCollection | null;
  activeLayer: LayerId;
  /** Rescaled layer config (region-comparison mode); falls back to the base layer
   *  for the id. Using it keeps the swatch colors consistent with the map/legend. */
  layerConfig?: LayerConfig;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
  /** CF-8: active region + comparison scope, so the copy-link reproduces the view. */
  city?: string;
  scope?: 'all' | 'region';
}

interface RankedItem {
  rank: number;
  name: string;
  pno: string;
  value: number;
  feature: GeoJSON.Feature;
}

// Removed hardcoded LOWER_IS_BETTER set — now uses layer.higherIsBetter from LayerConfig

export const RankingTable: React.FC<RankingTableProps> = React.memo(({ data, activeLayer, layerConfig, onSelect, onClose, city, scope }) => {
  useI18nVersion();
  // Prefer the rescaled config (region-comparison mode) so swatch colors match the
  // map fill and Legend; fall back to the base layer when none is provided.
  const layer = layerConfig ?? getLayerById(activeLayer);
  const [reversed, setReversed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Separate the expensive ranking computation (sorting, center extraction) from
  // the cheap display-order reversal. Before this change, toggling the sort direction
  // recomputed getFeatureCenter for every feature (~200 bounding box scans).
  const { rankedItems, maxVal } = useMemo(() => {
    if (!data) return { rankedItems: [], maxVal: 1 };

    const property = layer.property;
    const bestFirst = layer.higherIsBetter !== false;

    const entries: { feature: GeoJSON.Feature; value: number }[] = [];
    for (const f of data.features) {
      const p = f.properties as NeighborhoodProperties;
      const v = p[property];
      if (typeof v === 'number' && isFinite(v) && p.he_vakiy != null && p.he_vakiy > 0) {
        entries.push({ feature: f, value: v });
      }
    }

    // Always sort "best first" to assign stable ranks
    entries.sort((a, b) => bestFirst ? b.value - a.value : a.value - b.value);

    // Use max absolute value so bar widths are meaningful for layers with
    // negative values (e.g. income_change with values from -15% to +25%).
    let mx = 0;
    for (const e of entries) {
      const abs = Math.abs(e.value);
      if (abs > mx) mx = abs;
    }

    // Defer getFeatureCenter to click-time instead of computing it for all ~200 features.
    // Before: ~200 bounding box scans on every open/layer change. After: O(1) on click.
    const ranked: RankedItem[] = entries.map((e, i) => ({
      rank: i + 1,
      name: (e.feature.properties as NeighborhoodProperties).nimi || (e.feature.properties as NeighborhoodProperties).pno,
      pno: (e.feature.properties as NeighborhoodProperties).pno,
      value: e.value,
      feature: e.feature,
    }));

    return { rankedItems: ranked, maxVal: mx === 0 ? 1 : mx };
  }, [data, layer.property, layer.higherIsBetter]);

  // Reverse display order without recomputing centers
  const items = useMemo(
    () => reversed ? [...rankedItems].reverse() : rankedItems,
    [rankedItems, reversed],
  );


  return (
    <div className="absolute top-14 left-4 z-20 w-80 max-h-[calc(100vh-7rem)] flex flex-col
                    rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                    border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700/40 flex-shrink-0">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('ranking.title')}
          </h3>
          <p className="text-sm font-medium text-surface-800 dark:text-surface-200 mt-0.5">
            {t(layer.labelKey)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* CF-8: download the ranked list as CSV (canonical best-first order). */}
          <button
            onClick={() => exportRankingCsv(rankedItems, t(layer.labelKey))}
            className="p-1.5 rounded-lg transition-colors bg-surface-100 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60"
            aria-label={t('export.csv')}
            title={t('export.csv')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          {/* CF-8: copy a deep link that reproduces this choropleth (layer + city + scope). */}
          <button
            onClick={async () => {
              const url = buildFullViewUrl({ pno: null, layer: activeLayer, city: city ?? null, scope });
              let ok = false;
              try {
                await navigator.clipboard.writeText(url);
                ok = true;
              } catch {
                // clipboard API unavailable/blocked (e.g. non-secure context) —
                // fall back to execCommand instead of silently doing nothing.
                const ta = document.createElement('textarea');
                ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta);
                try { ta.select(); ok = document.execCommand('copy'); }
                catch { ok = false; }
                finally { document.body.removeChild(ta); }
              }
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
            }}
            className="p-1.5 rounded-lg transition-colors bg-surface-100 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60"
            aria-label={t('share.link')}
            title={copied ? t('panel.copied') : t('share.link')}
          >
            {copied ? (
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setReversed(r => !r)}
            className="p-1.5 rounded-lg transition-colors
                       bg-surface-100 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300
                       hover:bg-surface-200 dark:hover:bg-surface-700/60"
            aria-label={reversed ? t('ranking.worst_first') : t('ranking.best_first')}
          >
            <svg className={`w-4 h-4 transition-transform ${reversed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
          aria-label={t('aria.close')}
        >
          <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {items.map((item) => {
          const barWidth = maxVal !== 0 ? (Math.abs(item.value) / maxVal) * 100 : 0;
          const color = getColorForValue(layer, item.value);

          return (
            <button
              key={item.pno}
              onClick={() => onSelect(item.pno, getFeatureCenter(item.feature))}
              className="w-full text-left px-4 py-2 flex items-center gap-3
                         hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors
                         border-b border-surface-100 dark:border-surface-800/30 last:border-0"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}
            >
              {/* Rank */}
              <span className="text-xs font-mono text-surface-400 dark:text-surface-500 w-6 text-right flex-shrink-0">
                {item.rank}
              </span>

              {/* Name + bar */}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-surface-800 dark:text-surface-200 truncate">
                  {item.name}
                </div>
                <div className="mt-1 h-1.5 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(barWidth, 2)}%`, backgroundColor: color }}
                  />
                </div>
              </div>

              {/* Value */}
              <span className="text-xs font-medium text-surface-600 dark:text-surface-300 flex-shrink-0 tabular-nums">
                {layer.format(item.value)}
              </span>
            </button>
          );
        })}

        {/* ES-5: guided empty state (common for sparse/grid layers) — explains WHY
            the list is empty and what to do, matching the app's other empty states. */}
        {items.length === 0 && (
          <div className="px-4 py-8 flex flex-col items-center text-center">
            <FilterEmptyIllustration className="w-16 h-16 mb-3 text-surface-300 dark:text-surface-600" />
            <p className="text-sm font-medium text-surface-600 dark:text-surface-300">{t('ranking.no_data')}</p>
            <p className="mt-1 text-xs text-surface-400 dark:text-surface-500 max-w-[14rem]">{t('ranking.no_data_hint')}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-surface-200 dark:border-surface-700/40 flex-shrink-0">
        <p className="text-[10px] text-surface-400 dark:text-surface-500">
          {items.length} {t('ranking.areas')}
        </p>
      </div>
    </div>
  );
});
RankingTable.displayName = 'RankingTable';
