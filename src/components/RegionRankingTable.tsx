import React, { useEffect, useMemo, useState } from 'react';
import { type LayerId, type LayerConfig, getLayerById, getColorForValue } from '../utils/colorScales';
import { t, useI18nVersion } from '../utils/i18n';
import { loadAllData } from '../utils/dataLoader';
import { computeQualityIndices, isCustomWeights, type QualityWeights } from '../utils/qualityIndex';
import { getNationalRanges } from '../utils/nationalRanges';
import { REGIONS } from '../utils/regions';
import { getCoveragePct, formatCoveragePct } from '../utils/metrics';

interface Props {
  activeLayer: LayerId;
  layerConfig?: LayerConfig;
  /** Switch the map to a region (does NOT select a neighborhood). */
  onSelectRegion: (regionId: string) => void;
  onClose: () => void;
  /** CF-1pt3: the user's live Quality-Index weights, so national scores here match
   *  the region map (the loadAllData cache is computed with default weights). */
  qualityWeights?: QualityWeights;
  /** QW-2: the selected area's region (it ranks the 69 seutukunnat, so the match
   *  is by region) — highlighted, badged and scrolled into view. */
  selectedRegion?: string | null;
}

interface RegionAgg {
  regionId: string;
  value: number | null;
  pop: number;
  count: number;
}

/**
 * CF-4: pop-weighted aggregate of the active metric for every region present in
 * the all-regions dataset. Computed directly (not via METRIC_DEFS) so it works
 * for any layer property, including quality_index and change metrics.
 */
function aggregateByRegion(features: GeoJSON.Feature[], property: string): RegionAgg[] {
  const groups = new Map<string, { wsum: number; w: number; pop: number; count: number }>();
  for (const f of features) {
    const p = f.properties as Record<string, unknown> | null;
    const region = p?.city as string | undefined;
    if (!region || region === 'unknown' || region === 'other') continue;
    let g = groups.get(region);
    if (!g) { g = { wsum: 0, w: 0, pop: 0, count: 0 }; groups.set(region, g); }
    g.count++;
    const pop = p?.he_vakiy;
    if (typeof pop === 'number' && pop > 0) {
      g.pop += pop;
      const v = p?.[property];
      if (typeof v === 'number' && isFinite(v)) { g.wsum += v * pop; g.w += pop; }
    }
  }
  return [...groups].map(([regionId, g]) => ({
    regionId,
    value: g.w > 0 ? g.wsum / g.w : null,
    pop: g.pop,
    count: g.count,
  }));
}

export const RegionRankingTable: React.FC<Props> = React.memo(({ activeLayer, layerConfig, onSelectRegion, onClose, qualityWeights, selectedRegion }) => {
  useI18nVersion();
  const layer = layerConfig ?? getLayerById(activeLayer);
  const [reversed, setReversed] = useState(false);
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [error, setError] = useState(false);
  // ES-4: bumped by the Retry button to re-attempt the lazy dataset load.
  const [retryNonce, setRetryNonce] = useState(0);

  // Lazy-load the all-regions dataset (geometry-stripped properties).
  useEffect(() => {
    let cancelled = false;
    loadAllData()
      .then((res) => {
        if (cancelled) return;
        const feats = res.data.features;
        // CF-1pt3: loadAllData computes quality_index with default weights; re-score
        // with the user's custom weights (same national ranges) so an area ranks
        // identically here and on the region map. loadAllData is cached, so re-running
        // on a weights change is instant; the shared features are mutated consistently.
        if (qualityWeights && isCustomWeights(qualityWeights)) {
          computeQualityIndices(feats, qualityWeights, getNationalRanges());
        }
        setFeatures([...feats]);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [qualityWeights, retryNonce]);

  const { items, maxVal, total } = useMemo(() => {
    if (!features) return { items: [] as RegionAgg[], maxVal: 1, total: 0 };
    // PO-3: keep the full region set so the footer can report how many regions were dropped
    // for lacking a population-weighted value, rather than presenting survivors as the total.
    const allAggs = aggregateByRegion(features, layer.property);
    const aggs = allAggs.filter((a) => a.value != null);
    const bestFirst = layer.higherIsBetter !== false;
    aggs.sort((a, b) => bestFirst ? (b.value! - a.value!) : (a.value! - b.value!));
    let mx = 0;
    for (const a of aggs) { const abs = Math.abs(a.value!); if (abs > mx) mx = abs; }
    return { items: aggs, maxVal: mx === 0 ? 1 : mx, total: allAggs.length };
  }, [features, layer.property, layer.higherIsBetter]);
  // PO-3: national coverage of the metric, for the header badge (null → omitted).
  const coverage = getCoveragePct(layer.property);

  const displayItems = useMemo(() => reversed ? [...items].reverse() : items, [items, reversed]);

  // QW-2: scroll the selected area's region row into view on open / selection /
  // re-rank (effect, not ref-callback, so it re-fires when the list changes).
  const selectedRowRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'center' });
  }, [selectedRegion, displayItems]);

  const regionName = (id: string) => {
    const cfg = (REGIONS as Record<string, { labelKey: string }>)[id];
    return cfg ? t(cfg.labelKey) : id;
  };
  const muniCount = (id: string) => (REGIONS as Record<string, { municipalityCodes: string[] }>)[id]?.municipalityCodes.length ?? 0;

  return (
    // DT-1: offset below the search bar (top-14 left-4) like FilterPanel — the
    // opaque panel otherwise draws directly on top of the search input.
    <div className="absolute top-28 left-4 z-20 w-80 max-h-[calc(100vh-9rem)] flex flex-col
                    rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md
                    border border-surface-200 dark:border-surface-700/40 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700/40 flex-shrink-0">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('region.comparison.title')}
          </h3>
          <p className="text-sm font-medium text-surface-800 dark:text-surface-200 mt-0.5">
            {t(layer.labelKey)}
            {coverage != null && (
              <span className="ml-2 text-[10px] font-semibold tabular-nums text-surface-600 dark:text-surface-400">
                {t('ranking.coverage').replace('{pct}', formatCoveragePct(coverage))}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setReversed((r) => !r)}
            className="p-1.5 rounded-lg transition-colors bg-surface-100 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60"
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

      <div className="overflow-y-auto flex-1 min-h-0">
        {!features && !error && (
          <div className="px-4 py-8 text-center text-sm text-surface-500 dark:text-surface-400">{t('loading.title')}</div>
        )}
        {/* ES-4: a load failure is distinct from a metric that genuinely has no
            regional data — say so and offer a retry instead of the ambiguous "no data". */}
        {error && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-3">{t('error.region_load_failed')}</p>
            <button
              onClick={() => { setError(false); setRetryNonce((n) => n + 1); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors"
            >
              {t('error.retry')}
            </button>
          </div>
        )}
        {displayItems.map((item, i) => {
          const barWidth = maxVal !== 0 ? (Math.abs(item.value!) / maxVal) * 100 : 0;
          const color = getColorForValue(layer, item.value!);
          const rank = reversed ? displayItems.length - i : i + 1;
          const isSelected = selectedRegion != null && item.regionId === selectedRegion;
          return (
            <button
              key={item.regionId}
              ref={isSelected ? selectedRowRef : undefined}
              onClick={() => onSelectRegion(item.regionId)}
              aria-current={isSelected || undefined}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors border-b border-surface-100 dark:border-surface-800/30 last:border-0 ${isSelected ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
            >
              <span className={`text-xs font-mono w-6 text-right flex-shrink-0 ${isSelected ? 'font-bold text-brand-700 dark:text-brand-300' : 'text-surface-500 dark:text-surface-400'}`}>{rank}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${isSelected ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-surface-800 dark:text-surface-200'}`}>{regionName(item.regionId)}</div>
                <div className="text-[10px] text-surface-500 dark:text-surface-400">
                  {muniCount(item.regionId)} {t('region.comparison.municipalities')}
                </div>
                <div className="mt-1 h-1.5 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(barWidth, 2)}%`, backgroundColor: color }} />
                </div>
              </div>
              <span className="text-xs font-medium text-surface-600 dark:text-surface-300 flex-shrink-0 tabular-nums">{layer.format(item.value!)}</span>
            </button>
          );
        })}
        {features && displayItems.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-surface-500 dark:text-surface-400">{t('region.comparison.no_data')}</div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-surface-200 dark:border-surface-700/40 flex-shrink-0">
        <p className="text-[10px] text-surface-600 dark:text-surface-400">
          {t('region.comparison.coverage_summary')
            .replace('{shown}', displayItems.length.toLocaleString())
            .replace('{total}', total.toLocaleString())}
          {total - displayItems.length > 0 && ` — ${t('ranking.excluded').replace('{excluded}', (total - displayItems.length).toLocaleString())}`}
        </p>
      </div>
    </div>
  );
});
RegionRankingTable.displayName = 'RegionRankingTable';
