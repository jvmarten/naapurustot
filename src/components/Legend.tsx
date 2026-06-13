import React from 'react';
import { getLayerById, type LayerId, type LayerConfig } from '../utils/colorScales';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { getGridInfo } from '../hooks/useGridData';
import { getMetricSource, getCoveragePct, isPartialCoverage, isLowCoverage, formatCoveragePct } from '../utils/metrics';

interface LegendProps {
  layerId: LayerId;
  colorblind?: string;
  /** When provided, overrides the static layer config (used for region-scoped color scales) */
  layerConfig?: LayerConfig;
  /** Pass current language to trigger re-render on language change */
  lang?: Lang;
  /** L1: true while the active layer's fine-grained grid dataset is still fetching */
  gridLoading?: boolean;
  /** E2: true when the grid dataset failed to load — drop the grid-detail badge
   *  and show a "showing postal estimate" note rather than asserting fine resolution. */
  gridError?: boolean;
  /** MO2: on mobile, suppress the legend when a full-width panel covers it (desktop is md:absolute and unaffected). */
  hidden?: boolean;
  /** T1: true when the map is tinting no-data price areas with the seutukunta average
   *  (hatched) — show a note explaining the hatched "sub-region estimate" fills. */
  subregionEstimate?: boolean;
}

// colorblind prop triggers re-render when mode changes (getLayerById reads global state)
export const Legend: React.FC<LegendProps> = React.memo(({ layerId, colorblind: _colorblind, layerConfig, lang: _lang, gridLoading, gridError, hidden, subregionEstimate }) => {
  useI18nVersion();
  const layer = layerConfig ?? getLayerById(layerId);

  // Show only first and last tick values
  const n = layer.stops.length;
  const tickIndices = [0, n - 1];

  // A5: the color ramp is otherwise bare swatch divs with no accessible text.
  // Give the swatch container role="img" + a data-bearing label (mirrors the
  // role="img" pattern on CorrelationExplorer/NeighborhoodPanel charts).
  const rampAria = t('legend.ramp_aria')
    .replace('{label}', t(layer.labelKey))
    .replace('{min}', layer.format(layer.stops[0]))
    .replace('{max}', layer.format(layer.stops[layer.stops.length - 1]));

  // IN-1: when the active layer has a fine-grained grid dataset, surface its
  // coverage scope so a "regional" (e.g. Helsinki-only) grid is visibly limited
  // rather than silently masquerading as full-map resolution.
  const grid = getGridInfo(layerId);

  // PO-2: badge layers whose value is a proxy/derived model rather than a direct
  // measurement. Data freshness (vintage) is intentionally NOT shown here — it
  // lives in the settings menu ("data last updated") and the data-sources page,
  // so the on-map legend stays clean and uncluttered.
  const src = getMetricSource(layer.property);

  // PO-2: surface real per-layer coverage. Partial layers (<95% of postal codes)
  // get a subtle caption; genuinely sparse ones (<50%) get a warning banner instead,
  // since the gray no-data polygons (PO-1 hatch) then dominate the choropleth.
  const coverage = getCoveragePct(layer.property);
  const partial = isPartialCoverage(layer.property);
  const lowCoverage = isLowCoverage(layer.property);
  const coverageLabel = coverage != null ? formatCoveragePct(coverage) : null;

  return (
    <div className={`fixed md:absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom))] md:bottom-8 left-3 md:left-4 z-10 ${hidden ? 'hidden md:block' : ''}`}>
      <div className="rounded-xl bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">
          {t(layer.labelKey)}
        </div>
        <div className="flex items-center gap-0" role="img" aria-label={rampAria}>
          {layer.colors.map((color, i) => (
            <div key={i} aria-hidden="true" className="w-6 h-3 first:rounded-l last:rounded-r" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex justify-between mt-1.5" style={{ width: `${layer.colors.length * 24}px` }}>
          {tickIndices.map((idx) => (
            <span
              key={idx}
              className="text-[10px] text-surface-500"
            >
              {layer.format(layer.stops[idx])}
            </span>
          ))}
        </div>
        {grid && !gridError && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-surface-400 dark:text-surface-500">
            <span aria-hidden="true">▦</span>
            <span>{t(grid.scope === 'national' ? 'grid.scope_national' : 'grid.scope_regional')}</span>
          </div>
        )}
        {/* E2: grid file failed — say so instead of leaving the ▦ badge asserting
            detail that never loaded. */}
        {grid && gridError && (
          <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 max-w-[160px] leading-snug">
            <span aria-hidden="true">⚠</span>
            <span>{t('grid.unavailable')}</span>
          </div>
        )}
        {/* L1: feedback while the fine-grained grid dataset is still loading. */}
        {gridLoading && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-surface-400 dark:text-surface-500" role="status">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>{t('grid.loading')}</span>
          </div>
        )}
        {src?.isProxy && (
          <div className="mt-2 flex items-center text-[10px]">
            {/* X4: explain the modeled value on hover, matching the panel's badge
                (which pairs the same badge with an estimate explanation). */}
            <span
              title={t('data.estimate_desc')}
              className="inline-flex items-center rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide cursor-help
                             bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30">
              {t('data.estimate')}
            </span>
          </div>
        )}
        {/* PO-6: frozen/retired upstream source — postal rents can never refresh */}
        {src?.discontinued != null && (
          <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 max-w-[160px] leading-snug">
            <span aria-hidden="true">⚠</span>
            <span>{t('source.discontinued').replace('{year}', String(src.discontinued))}</span>
          </div>
        )}
        {/* PO-2: low-coverage banner for sparse layers (<50%) — explains the gray
            (PO-1 no-data hatch) polygons that dominate the choropleth. */}
        {lowCoverage && coverageLabel != null && (
          <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 max-w-[160px] leading-snug">
            <span aria-hidden="true">▦</span>
            <span>{t('coverage.low_banner').replace('{pct}', coverageLabel)}</span>
          </div>
        )}
        {/* PO-2: subtle caption for partial-but-not-sparse layers (50–95%). */}
        {partial && !lowCoverage && coverageLabel != null && (
          <div className="mt-2 text-[10px] text-surface-400 dark:text-surface-500 max-w-[160px] leading-snug">
            {t('coverage.caption').replace('{pct}', coverageLabel)}
          </div>
        )}
        {/* T1: explain the hatched fills that carry the seutukunta price estimate. */}
        {subregionEstimate && (
          <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400 max-w-[170px] leading-snug">
            <span aria-hidden="true">▦</span>
            <span>{t('legend.subregion_estimate')}</span>
          </div>
        )}
      </div>
    </div>
  );
});
