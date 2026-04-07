import React, { useState } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDensity, formatEuroSqm } from '../utils/formatting';
import { t } from '../utils/i18n';
import { CompareIllustration } from './EmptyStateIllustrations';

interface ComparisonPanelProps {
  pinned: NeighborhoodProperties[];
  onUnpin: (pno: string) => void;
  onClear: () => void;
}

interface StatDef {
  label: string;
  key: string;
  format: (v: number | null | undefined) => string;
  higherIsBetter: boolean;
}

const STAT_SECTIONS: { title: string; stats: StatDef[] }[] = [
  {
    title: '',
    stats: [
      { label: 'panel.population', key: 'he_vakiy', format: formatNumber, higherIsBetter: true },
      { label: 'panel.median_income', key: 'hr_mtu', format: formatEuro, higherIsBetter: true },
      { label: 'panel.unemployment', key: 'unemployment_rate', format: (v) => formatPct(v as number | null), higherIsBetter: false },
      { label: 'panel.foreign_lang', key: 'foreign_language_pct', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.housing',
    stats: [
      { label: 'panel.ownership_rate', key: 'ownership_rate', format: (v) => formatPct(v as number | null), higherIsBetter: true },
      { label: 'panel.rental_rate', key: 'rental_rate', format: (v) => formatPct(v as number | null), higherIsBetter: true },
      { label: 'panel.avg_apt_size', key: 'ra_as_kpa', format: (v) => v != null ? `${(v as number).toFixed(1)} m²` : '—', higherIsBetter: true },
      { label: 'panel.detached_houses', key: 'detached_house_share', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.demographics',
    stats: [
      { label: 'panel.population_density', key: 'population_density', format: formatDensity, higherIsBetter: true },
      { label: 'panel.child_ratio', key: 'child_ratio', format: (v) => formatPct(v as number | null), higherIsBetter: true },
      { label: 'panel.student_share', key: 'student_share', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.quality_of_life',
    stats: [
      { label: 'panel.property_price', key: 'property_price_sqm', format: formatEuroSqm, higherIsBetter: true },
      { label: 'panel.transit_access', key: 'transit_stop_density', format: (v) => v != null ? `${(v as number).toFixed(1)} /km²` : '—', higherIsBetter: true },
      { label: 'panel.air_quality', key: 'air_quality_index', format: (v) => v != null ? (v as number).toFixed(1) : '—', higherIsBetter: false },
    ],
  },
];

const COLUMN_COLORS = [
  'text-brand-500 dark:text-brand-400',
  'text-emerald-500 dark:text-emerald-400',
  'text-amber-500 dark:text-amber-400',
];

function findBest(pinned: NeighborhoodProperties[], key: string, higherIsBetter: boolean): string | null {
  let bestPno: string | null = null;
  let bestVal: number | null = null;
  for (const p of pinned) {
    const v = p[key] as number | null;
    if (v == null) continue;
    if (bestVal == null || (higherIsBetter ? v > bestVal : v < bestVal)) {
      bestVal = v;
      bestPno = p.pno;
    }
  }
  return bestPno;
}

/** Mobile card for a single neighborhood in stacked comparison */
const MobileCard: React.FC<{
  n: NeighborhoodProperties;
  color: string;
  onUnpin: (pno: string) => void;
  allPinned: NeighborhoodProperties[];
  bestByKey: Record<string, string | null>;
}> = ({ n, color, onUnpin, allPinned, bestByKey }) => (
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
      {STAT_SECTIONS.flatMap((section) =>
        section.stats.map((stat) => {
          const val = n[stat.key] as number | null;
          const isBest = allPinned.length > 1 && n.pno === bestByKey[stat.key];
          return (
            <div key={stat.key} className="flex justify-between text-xs">
              <span className="text-surface-500 dark:text-surface-400">{t(stat.label)}</span>
              <span className={isBest ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-surface-900 dark:text-white font-medium'}>
                {stat.format(val)}
                {isBest && <span className="ml-1 text-[9px] uppercase text-emerald-500">{t('compare.best')}</span>}
              </span>
            </div>
          );
        }),
      )}
    </div>
  </div>
);

// PO-4: Chart metrics for bar chart comparison
const CHART_METRICS: { label: string; key: string; higherIsBetter: boolean; max?: number }[] = [
  { label: 'panel.median_income', key: 'hr_mtu', higherIsBetter: true },
  { label: 'panel.unemployment', key: 'unemployment_rate', higherIsBetter: false, max: 30 },
  { label: 'panel.property_price', key: 'property_price_sqm', higherIsBetter: true },
  { label: 'panel.transit_access', key: 'transit_stop_density', higherIsBetter: true },
  { label: 'panel.crime_rate', key: 'crime_index', higherIsBetter: false },
];

const BAR_COLORS = ['#6366f1', '#10b981', '#f59e0b'];

const ComparisonChart: React.FC<{ pinned: NeighborhoodProperties[] }> = React.memo(({ pinned }) => {
  return (
    <div className="px-5 py-4 space-y-5">
      {CHART_METRICS.map((metric) => {
        const values = pinned.map((n) => (n[metric.key] as number) ?? 0);
        const maxVal = metric.max ?? Math.max(...values, 1);
        return (
          <div key={metric.key}>
            <div className="text-xs text-surface-500 dark:text-surface-400 mb-1.5">{t(metric.label)}</div>
            <div className="space-y-1">
              {pinned.map((n, i) => {
                const val = (n[metric.key] as number) ?? 0;
                const pct = Math.min((val / maxVal) * 100, 100);
                return (
                  <div key={n.pno} className="flex items-center gap-2">
                    <span className="w-16 text-[10px] text-surface-500 dark:text-surface-400 truncate">{n.nimi}</span>
                    <div className="flex-1 h-4 bg-surface-100 dark:bg-surface-800 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-300"
                        style={{ width: `${pct}%`, backgroundColor: BAR_COLORS[i] }}
                      />
                    </div>
                    <span className="w-16 text-[10px] text-surface-700 dark:text-surface-300 text-right tabular-nums">
                      {formatNumber(val)}
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

export const ComparisonPanel: React.FC<ComparisonPanelProps> = React.memo(({ pinned, onUnpin, onClear }) => {
  // PO-4: Tab state for chart vs table view
  const [view, setView] = useState<'table' | 'chart'>('table');

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
    return (
      <div className="hidden md:flex absolute bottom-4 left-1/2 -translate-x-1/2 z-20
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl rounded-2xl
                      border border-surface-200 dark:border-surface-800/50 shadow-2xl
                      px-6 py-4 items-center gap-4">
        <CompareIllustration className="w-12 h-12 opacity-60 flex-shrink-0" />
        <div className="text-sm text-surface-400 dark:text-surface-500">
          {t('empty.compare_hint')}
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
              {t('compare.title')}
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
          <button
            onClick={onClear}
            className="text-xs text-surface-500 hover:text-rose-500 dark:text-surface-400 dark:hover:text-rose-400 transition-colors"
          >
            {t('compare.clear')}
          </button>
        </div>

        {/* PO-4: Chart view */}
        {view === 'chart' && <ComparisonChart pinned={pinned} />}

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
                        title="Remove"
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

      {/* Mobile: stacked cards in bottom sheet */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 max-h-[60vh]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                      border-t border-surface-200 dark:border-surface-800/50
                      shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-800/50">
          <h2 className="text-sm font-display font-bold text-surface-900 dark:text-white">
            {t('compare.title')}
          </h2>
          <button
            onClick={onClear}
            className="text-xs text-surface-500 hover:text-rose-500 dark:text-surface-400 dark:hover:text-rose-400 transition-colors"
          >
            {t('compare.clear')}
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3" style={{ maxHeight: 'calc(60vh - 52px)' }}>
          {pinned.map((n, i) => (
            <MobileCard key={n.pno} n={n} color={COLUMN_COLORS[i]} onUnpin={onUnpin} allPinned={pinned} bestByKey={bestByKey} />
          ))}
        </div>
      </div>
    </>
  );
});

ComparisonPanel.displayName = 'ComparisonPanel';
