import React from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct } from '../utils/formatting';
import { t } from '../utils/i18n';

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
      { label: 'panel.population_density', key: 'population_density', format: (v) => v != null ? `${(v as number).toLocaleString('fi-FI')} /km²` : '—', higherIsBetter: true },
      { label: 'panel.child_ratio', key: 'child_ratio', format: (v) => formatPct(v as number | null), higherIsBetter: true },
      { label: 'panel.student_share', key: 'student_share', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.quality_of_life',
    stats: [
      { label: 'panel.property_price', key: 'property_price_sqm', format: (v) => v != null ? `${(v as number).toLocaleString('fi-FI')} €/m²` : '—', higherIsBetter: true },
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

export const ComparisonPanel: React.FC<ComparisonPanelProps> = ({ pinned, onUnpin, onClear }) => {
  if (pinned.length < 2) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[95vw] max-w-[800px]
                    bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl rounded-2xl
                    border border-surface-200 dark:border-surface-800/50 shadow-2xl
                    overflow-hidden">
      {/* Header */}
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

      {/* Table */}
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table className="w-full text-sm">
          {/* Column headers — neighborhood names */}
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
                  const bestPno = findBest(pinned, stat.key, stat.higherIsBetter);
                  return (
                    <tr key={stat.key} className="border-t border-surface-100 dark:border-surface-800/30">
                      <td className="px-4 py-2 text-surface-500 dark:text-surface-400 text-xs">
                        {t(stat.label)}
                      </td>
                      {pinned.map((n) => {
                        const val = n[stat.key] as number | null;
                        const isBest = pinned.length > 1 && n.pno === bestPno;
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
    </div>
  );
};
