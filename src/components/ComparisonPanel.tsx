import React, { useState, useCallback, useMemo } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatEuro, formatPct, formatEuroSqm } from '../utils/formatting';
import { STAT_SECTIONS, ALL_STATS, findBest, refDeltaOf } from '../utils/comparisonStats';
import { t, useI18nVersion } from '../utils/i18n';
import { isCustomWizardAnswers, type WizardAnswers } from '../hooks/useWizardProfile';
import { computeNationalFit } from '../utils/fitScore';
import { CompareIllustration } from './EmptyStateIllustrations';
import { exportComparisonPdf, exportComparisonCsv, exportGeoJson } from '../utils/export';
import { generateComparisonCard } from '../utils/scoreCard';
import { trackEvent } from '../utils/analytics';

interface ComparisonPanelProps {
  pinned: NeighborhoodProperties[];
  onUnpin: (pno: string) => void;
  onClear: () => void;
  /** CF-5: a custom reference-baseline neighbourhood — pinned values show a delta vs it. */
  reference?: NeighborhoodProperties | null;
  referenceName?: string | null;
  /** CF-10: resolve a pno's map geometry so the comparison set can export as GeoJSON. */
  geometryFor?: (pno: string) => GeoJSON.Geometry | null;
  /** MO7: hide the MOBILE sheet when a NeighborhoodPanel mobile sheet is open (both anchor bottom-0 z-20). Desktop is untouched. */
  suppressMobile?: boolean;
  /** "Fit for you": the saved priority profile. When custom, each pinned area shows a
   *  match score row so the comparison ranks by personal fit. */
  wizardProfile?: WizardAnswers | null;
}

const COLUMN_COLORS = [
  'text-brand-600 dark:text-brand-400',
  'text-emerald-500 dark:text-emerald-400',
  'text-amber-500 dark:text-amber-400',
];

/** Mobile card for a single neighborhood in stacked comparison */
const MobileCard: React.FC<{
  n: NeighborhoodProperties;
  color: string;
  onUnpin: (pno: string) => void;
  allPinned: NeighborhoodProperties[];
  bestByKey: Record<string, string | null>;
  reference?: NeighborhoodProperties | null;
  fitScore?: number | null;
  isBestFit?: boolean;
}> = ({ n, color, onUnpin, allPinned, bestByKey, reference, fitScore, isBestFit }) => (
  <div className="bg-surface-50 dark:bg-surface-900/60 rounded-xl p-4 relative">
    <div className="flex items-center justify-between mb-3">
      <div>
        <span className={`font-display font-bold text-sm ${color}`}>{n.nimi}</span>
        <span className="text-[10px] text-surface-400 ml-1.5">{n.pno}</span>
      </div>
      <button
        onClick={() => onUnpin(n.pno)}
        className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-rose-500"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div className="space-y-1.5">
      {fitScore != null && (
        <div className="flex justify-between text-xs">
          <span className="text-surface-500 dark:text-surface-400">{t('fit.label')}</span>
          <span className={isBestFit ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-surface-900 dark:text-white font-medium'}>
            {fitScore}%
            {isBestFit && <span className="ml-1 text-[9px] uppercase text-emerald-500">{t('compare.best')}</span>}
          </span>
        </div>
      )}
      {ALL_STATS.map((stat) => {
        const val = n[stat.key] as number | null;
        const isBest = allPinned.length > 1 && n.pno === bestByKey[stat.key];
        const delta = reference && reference.pno !== n.pno
          ? refDeltaOf(val, reference[stat.key] as number | null, stat.higherIsBetter)
          : null;
        return (
          <div key={stat.key} className="flex justify-between text-xs">
            <span className="text-surface-500 dark:text-surface-400">{t(stat.label)}</span>
            <span className={isBest ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-surface-900 dark:text-white font-medium'}>
              {stat.format(val)}
              {delta && <span className={`ml-1 text-[9px] tabular-nums ${delta.cls}`}>{delta.text}</span>}
              {isBest && <span className="ml-1 text-[9px] uppercase text-emerald-500">{t('compare.best')}</span>}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

// PO-4: Chart metrics for bar chart comparison. Each carries a formatter so the
// value label matches the table view (units restored, missing data shown as '—'
// rather than a fabricated '0').
const CHART_METRICS: { label: string; key: string; higherIsBetter: boolean; max?: number; format: (v: number | null) => string }[] = [
  { label: 'panel.median_income', key: 'hr_mtu', higherIsBetter: true, format: formatEuro },
  { label: 'panel.unemployment', key: 'unemployment_rate', higherIsBetter: false, max: 30, format: formatPct },
  { label: 'panel.property_price', key: 'property_price_sqm', higherIsBetter: true, format: formatEuroSqm },
  { label: 'panel.transit_access', key: 'transit_stop_density', higherIsBetter: true, format: (v) => (v == null ? '—' : `${v.toFixed(1)} /km²`) },
  { label: 'panel.crime_rate', key: 'crime_index', higherIsBetter: false, format: (v) => (v == null ? '—' : v.toFixed(1)) },
];

const BAR_COLORS = ['#6366f1', '#10b981', '#f59e0b'];

const ComparisonChart: React.FC<{ pinned: NeighborhoodProperties[]; bestByKey: Record<string, string | null> }> = React.memo(({ pinned, bestByKey }) => {
  useI18nVersion();
  return (
    <div className="px-5 py-4 space-y-5">
      {CHART_METRICS.map((metric) => {
        const values = pinned.map((n) => (n[metric.key] as number | null) ?? 0); // bar geometry only
        const maxVal = metric.max ?? Math.max(...values, 1);
        // PO-1: badge the best-DIRECTION bar (longer ≠ better for inverted metrics)
        // using the table's direction-aware precompute; caption the inverted ones.
        const bestPno = pinned.length > 1 ? bestByKey[metric.key] : null;
        return (
          <div key={metric.key}>
            <div className="text-xs text-surface-500 dark:text-surface-400 mb-1.5 flex items-center gap-1.5">
              <span>{t(metric.label)}</span>
              {!metric.higherIsBetter && (
                <span className="text-[9px] uppercase tracking-wide text-surface-400 dark:text-surface-500">{t('compare.lower_better')}</span>
              )}
            </div>
            <div className="space-y-1">
              {pinned.map((n, i) => {
                const raw = n[metric.key] as number | null;
                const val = raw ?? 0; // bar width basis; missing data → empty bar
                const pct = Math.min((val / maxVal) * 100, 100);
                const isBest = bestPno != null && n.pno === bestPno;
                return (
                  <div key={n.pno} className="flex items-center gap-2">
                    <span className="w-16 text-[10px] text-surface-500 dark:text-surface-400 truncate">{n.nimi}</span>
                    <div className="flex-1 h-4 bg-surface-100 dark:bg-surface-800 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-300"
                        style={{ width: `${pct}%`, backgroundColor: isBest ? '#10b981' : BAR_COLORS[i] }}
                      />
                    </div>
                    <span className={`w-16 text-[10px] text-right tabular-nums ${isBest ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-surface-700 dark:text-surface-300'}`}>
                      {metric.format(raw)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});
ComparisonChart.displayName = 'ComparisonChart';

export const ComparisonPanel: React.FC<ComparisonPanelProps> = React.memo(({ pinned, onUnpin, onClear, reference = null, referenceName = null, geometryFor, suppressMobile, wizardProfile }) => {
  useI18nVersion();
  // "Fit for you": per-area match score vs the saved priorities (national ranges, so
  // it reads the same as the panel/profile). Only shown when a custom profile exists.
  const fitByPno = useMemo(() => {
    if (!wizardProfile || !isCustomWizardAnswers(wizardProfile)) return null;
    const m: Record<string, number> = {};
    // Skip the all-Finland region aggregates — an averaged seutukunta has no
    // meaningful per-area fit (matches NeighborhoodPanel hiding the badge for them).
    for (const n of pinned) {
      if (n._isMetroArea) continue;
      m[n.pno] = computeNationalFit(n, wizardProfile).score;
    }
    return Object.keys(m).length > 0 ? m : null;
  }, [pinned, wizardProfile]);
  const bestFitPno = useMemo(() => {
    if (!fitByPno || pinned.length < 2) return null;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const n of pinned) {
      const s = fitByPno[n.pno];
      if (s != null && s > bestScore) { bestScore = s; best = n.pno; }
    }
    return best;
  }, [fitByPno, pinned]);
  // CF-5: show per-value deltas vs the reference only when it isn't itself the sole pinned area.
  const refActive = !!reference && pinned.some((p) => p.pno !== reference.pno);
  const refCaption = refActive && referenceName
    ? <span className="text-[10px] font-normal text-surface-400 dark:text-surface-500 ml-1">{t('panel.compared_to').replace('{ref}', referenceName)}</span>
    : null;
  // PO-4: Tab state for chart vs table view
  const [view, setView] = useState<'table' | 'chart'>('table');
  // L2: per-button busy state + re-entry guard for the share-as-image card.
  const [sharingImage, setSharingImage] = useState(false);
  // CF-8: Export the entire comparison (table + per-neighborhood detail pages)
  const handleExportPdf = useCallback(() => {
    trackEvent('export-comparison-pdf', { count: pinned.length });
    exportComparisonPdf(pinned);
  }, [pinned]);
  const handleExportCsv = useCallback(() => {
    trackEvent('export-comparison-csv', { count: pinned.length });
    exportComparisonCsv(pinned);
  }, [pinned]);
  // CF-10: machine-readable GeoJSON of the whole comparison set (geometry + raw values).
  const handleExportGeoJson = useCallback(() => {
    trackEvent('export-comparison-geojson', { count: pinned.length });
    exportGeoJson(pinned.map((p) => ({
      type: 'Feature',
      geometry: geometryFor?.(p.pno) ?? null,
      properties: p as unknown as GeoJSON.GeoJsonProperties,
    })));
  }, [pinned, geometryFor]);

  // Pre-compute "best" PNO for each stat once, instead of calling findBest()
  // per stat-row inside the render loop. Before: 13 stats × 3 pinned = 39 iterations
  // inside the render path. After: single pass over stats builds a lookup map.
  const bestByKey = React.useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const section of STAT_SECTIONS) {
      for (const stat of section.stats) {
        map[stat.key] = findBest(pinned, stat.key, stat.higherIsBetter);
      }
    }
    return map;
  }, [pinned]);

  if (pinned.length === 0) return null;

  if (pinned.length === 1) {
    // C3/EM2: on mobile this hint was previously `hidden md:flex`, so pinning a
    // single area gave no feedback. Render a compact bottom-anchored pill on
    // mobile (suppressed when a NeighborhoodPanel sheet is open via suppressMobile),
    // and keep the desktop floating card unchanged at md+.
    return (
      <div
        className={`flex fixed bottom-0 inset-x-0 z-20 pb-safe
                    md:absolute md:bottom-4 md:left-1/2 md:inset-x-auto md:-translate-x-1/2 md:pb-0
                    bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                    rounded-t-2xl md:rounded-2xl
                    border-t md:border border-surface-200 dark:border-surface-800/50
                    shadow-[0_-4px_30px_rgba(0,0,0,0.15)] md:shadow-2xl
                    px-4 py-3 md:px-6 md:py-4 items-center gap-3 md:gap-4 ${suppressMobile ? '!hidden md:!flex' : ''}`}
      >
        <CompareIllustration className="w-10 h-10 md:w-12 md:h-12 opacity-60 flex-shrink-0" />
        <div className="text-sm text-surface-400 dark:text-surface-500">
          {t('empty.compare_hint')}
          <span className="ml-1.5 text-[10px] font-semibold tabular-nums text-surface-300 dark:text-surface-600">1/2</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: horizontal table */}
      <div className="hidden md:block absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[95vw] max-w-[800px]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl rounded-2xl
                      border border-surface-200 dark:border-surface-800/50 shadow-2xl
                      overflow-hidden">
        {/* Header with tab toggle */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-display font-bold text-surface-900 dark:text-white">
              {t('compare.title')}{refCaption}
            </h2>
            {/* PO-4: Tab toggle */}
            <div className="flex rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5">
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  view === 'table' ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm' : 'text-surface-500 dark:text-surface-400'
                }`}
              >
                {t('compare.table')}
              </button>
              <button
                onClick={() => setView('chart')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  view === 'chart' ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm' : 'text-surface-500 dark:text-surface-400'
                }`}
              >
                {t('compare.chart')}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* CF-8: Multi-neighborhood export */}
            {pinned.length >= 2 && (
              <>
                <button
                  onClick={handleExportCsv}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                  title={t('export.csv')}
                >
                  {t('export.csv')}
                </button>
                <button
                  onClick={handleExportPdf}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                  title={t('export.pdf')}
                >
                  {t('export.pdf')}
                </button>
                {/* CF-10: machine-readable GeoJSON (geometry + raw values) */}
                <button
                  onClick={handleExportGeoJson}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                  title={t('export.geojson')}
                >
                  {t('export.geojson')}
                </button>
                {/* CF-10: share the comparison as a branded PNG with the deep link */}
                <button
                  onClick={() => {
                    if (sharingImage) return;
                    trackEvent('share-comparison-image');
                    setSharingImage(true);
                    generateComparisonCard(pinned).catch(() => { /* html-to-image load failed */ }).finally(() => setSharingImage(false));
                  }}
                  disabled={sharingImage}
                  className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200 transition-colors px-1.5 py-0.5 disabled:opacity-50"
                  title={t('share.image')}
                >
                  {sharingImage ? t('share.generating') : t('share.image')}
                </button>
                <span className="text-surface-300 dark:text-surface-700" aria-hidden>·</span>
              </>
            )}
            <button
              onClick={onClear}
              className="text-xs text-surface-500 hover:text-rose-500 dark:text-surface-400 dark:hover:text-rose-400 transition-colors"
            >
              {t('compare.clear')}
            </button>
          </div>
        </div>

        {/* PO-4: Chart view */}
        {view === 'chart' && <ComparisonChart pinned={pinned} bestByKey={bestByKey} />}

        {/* Table view */}
        {view === 'table' && (
        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-surface-400 w-[160px] min-w-[140px]" />
                {pinned.map((n, i) => (
                  <th key={n.pno} className="px-3 py-2.5 text-center min-w-[120px]">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`font-display font-bold text-sm ${COLUMN_COLORS[i]}`}>
                        {n.nimi}
                      </span>
                      <button
                        onClick={() => onUnpin(n.pno)}
                        className="p-0.5 rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-rose-500"
                        title={t('compare.remove')}
                        aria-label={t('compare.remove')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <span className="text-[10px] text-surface-400">{n.pno}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fitByPno && (
                <tr className="border-t border-surface-100 dark:border-surface-800/30 bg-brand-500/[0.04]">
                  <td className="px-4 py-2 text-surface-500 dark:text-surface-400 text-xs font-medium">{t('fit.label')}</td>
                  {pinned.map((n) => {
                    const s = fitByPno[n.pno];
                    if (s == null) {
                      return <td key={n.pno} className="px-3 py-2 text-center text-surface-300 dark:text-surface-600">—</td>;
                    }
                    const isBest = bestFitPno === n.pno;
                    return (
                      <td
                        key={n.pno}
                        className={`px-3 py-2 text-center font-semibold ${isBest ? 'text-emerald-600 dark:text-emerald-400' : 'text-surface-900 dark:text-white'}`}
                      >
                        {s}%
                        {isBest && (
                          <span className="ml-1 text-[9px] font-semibold uppercase text-emerald-500 dark:text-emerald-400">{t('compare.best')}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
              {STAT_SECTIONS.map((section) => (
                <React.Fragment key={section.title || '_main'}>
                  {section.title && (
                    <tr>
                      <td
                        colSpan={pinned.length + 1}
                        className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400"
                      >
                        {t(section.title)}
                      </td>
                    </tr>
                  )}
                  {section.stats.map((stat) => {
                    return (
                      <tr key={stat.key} className="border-t border-surface-100 dark:border-surface-800/30">
                        <td className="px-4 py-2 text-surface-500 dark:text-surface-400 text-xs">
                          {t(stat.label)}
                        </td>
                        {pinned.map((n) => {
                          const val = n[stat.key] as number | null;
                          const isBest = pinned.length > 1 && n.pno === bestByKey[stat.key];
                          const delta = refActive && reference && reference.pno !== n.pno
                            ? refDeltaOf(val, reference[stat.key] as number | null, stat.higherIsBetter)
                            : null;
                          return (
                            <td
                              key={n.pno}
                              className={`px-3 py-2 text-center font-medium ${
                                isBest
                                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
                                  : 'text-surface-900 dark:text-white'
                              }`}
                            >
                              {stat.format(val)}
                              {delta && (
                                <span className={`ml-1 text-[9px] tabular-nums ${delta.cls}`}>{delta.text}</span>
                              )}
                              {isBest && (
                                <span className="ml-1 text-[9px] font-semibold uppercase text-emerald-500 dark:text-emerald-400">
                                  {t('compare.best')}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Mobile: stacked cards in bottom sheet — MO7: hidden when a NeighborhoodPanel mobile sheet is open */}
      <div
        role="dialog"
        aria-label={t('compare.title')}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-20 max-h-[60vh]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                      border-t border-surface-200 dark:border-surface-800/50
                      shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl ${suppressMobile ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-800/50">
          <h2 className="text-sm font-display font-bold text-surface-900 dark:text-white">
            {t('compare.title')}{refCaption}
          </h2>
          <div className="flex items-center gap-2">
            {/* CF-8: Multi-neighborhood export — mobile */}
            {pinned.length >= 2 && (
              <>
                <button
                  onClick={handleExportCsv}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                >
                  {t('export.csv')}
                </button>
                <button
                  onClick={handleExportPdf}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                >
                  {t('export.pdf')}
                </button>
                <button
                  onClick={handleExportGeoJson}
                  className="text-xs text-surface-500 hover:text-brand-600 dark:text-surface-400 dark:hover:text-brand-300 transition-colors px-1.5 py-0.5"
                >
                  {t('export.geojson')}
                </button>
                <span className="text-surface-300 dark:text-surface-700" aria-hidden>·</span>
              </>
            )}
            <button
              onClick={onClear}
              className="text-xs text-surface-500 hover:text-rose-500 dark:text-surface-400 dark:hover:text-rose-400 transition-colors"
            >
              {t('compare.clear')}
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 pb-safe space-y-3" style={{ maxHeight: 'calc(60vh - 52px)' }}>
          {pinned.map((n, i) => (
            <MobileCard key={n.pno} n={n} color={COLUMN_COLORS[i]} onUnpin={onUnpin} allPinned={pinned} bestByKey={bestByKey} reference={refActive ? reference : null} fitScore={fitByPno ? fitByPno[n.pno] : null} isBestFit={bestFitPno === n.pno} />
          ))}
        </div>
      </div>
    </>
  );
});

ComparisonPanel.displayName = 'ComparisonPanel';
