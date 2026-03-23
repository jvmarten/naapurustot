import React, { useMemo } from 'react';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { booleanIntersects } from '@turf/boolean-intersects';
import { area } from '@turf/area';
import type { NeighborhoodProperties } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct } from '../utils/formatting';
import { t, getLang } from '../utils/i18n';

interface AreaSummaryPanelProps {
  polygon: Feature<Polygon>;
  data: FeatureCollection;
  metroAverages: Record<string, number>;
  onClose: () => void;
}

interface StatDef {
  label: string;
  key: string;
  format: (v: number | null | undefined) => string;
  /** Weight by population (default) or household count */
  weightKey?: string;
  /** True if the stat is a raw count (sum instead of weighted avg) */
  isCount?: boolean;
}

const STAT_SECTIONS: { title: string; stats: StatDef[] }[] = [
  {
    title: '',
    stats: [
      { label: 'panel.population', key: 'he_vakiy', format: formatNumber, isCount: true },
      { label: 'panel.median_income', key: 'hr_mtu', format: formatEuro },
      { label: 'panel.unemployment', key: 'unemployment_rate', format: (v) => formatPct(v as number | null) },
      { label: 'panel.foreign_lang', key: 'foreign_language_pct', format: (v) => formatPct(v as number | null) },
    ],
  },
  {
    title: 'panel.housing',
    stats: [
      { label: 'panel.ownership_rate', key: 'ownership_rate', format: (v) => formatPct(v as number | null), weightKey: 'te_taly' },
      { label: 'panel.rental_rate', key: 'rental_rate', format: (v) => formatPct(v as number | null), weightKey: 'te_taly' },
      { label: 'panel.avg_apt_size', key: 'ra_as_kpa', format: (v) => v != null ? `${(v as number).toFixed(1)} m²` : '—', weightKey: 'ra_asunn' },
      { label: 'panel.property_price', key: 'property_price_sqm', format: (v) => v != null ? `${(v as number).toLocaleString(getLang() === 'en' ? 'en-US' : 'fi-FI')} €/m²` : '—' },
    ],
  },
  {
    title: 'panel.demographics',
    stats: [
      { label: 'panel.population_density', key: 'population_density', format: (v) => v != null ? `${Math.round(v as number).toLocaleString(getLang() === 'en' ? 'en-US' : 'fi-FI')} /km²` : '—' },
      { label: 'panel.child_ratio', key: 'child_ratio', format: (v) => formatPct(v as number | null) },
      { label: 'panel.student_share', key: 'student_share', format: (v) => formatPct(v as number | null) },
    ],
  },
  {
    title: 'panel.quality_of_life',
    stats: [
      { label: 'panel.quality_index', key: 'quality_index', format: (v) => v != null ? (v as number).toFixed(1) : '—' },
      { label: 'panel.transit_access', key: 'transit_stop_density', format: (v) => v != null ? `${(v as number).toFixed(1)} /km²` : '—' },
      { label: 'panel.air_quality', key: 'air_quality_index', format: (v) => v != null ? (v as number).toFixed(1) : '—' },
    ],
  },
];

function computeAreaStats(polygon: Feature<Polygon>, data: FeatureCollection) {
  const intersecting: NeighborhoodProperties[] = [];

  for (const feature of data.features) {
    if (!feature.geometry) continue;
    const geom = feature.geometry as Polygon | MultiPolygon;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

    try {
      if (booleanIntersects(polygon, feature as Feature<Polygon | MultiPolygon>)) {
        if (feature.properties) {
          intersecting.push(feature.properties as NeighborhoodProperties);
        }
      }
    } catch {
      // Skip features with invalid geometry
    }
  }

  // Compute population-weighted averages
  const stats: Record<string, number | null> = {};

  for (const section of STAT_SECTIONS) {
    for (const stat of section.stats) {
      if (stat.isCount) {
        // Sum raw counts
        let total = 0;
        let hasAny = false;
        for (const n of intersecting) {
          const v = n[stat.key] as number | null;
          if (v != null) {
            total += v;
            hasAny = true;
          }
        }
        stats[stat.key] = hasAny ? total : null;
      } else {
        // Population-weighted average
        const weightKey = stat.weightKey || 'he_vakiy';
        let weightedSum = 0;
        let totalWeight = 0;
        for (const n of intersecting) {
          const v = n[stat.key] as number | null;
          const w = n[weightKey] as number | null;
          if (v != null && w != null && w > 0) {
            weightedSum += v * w;
            totalWeight += w;
          }
        }
        stats[stat.key] = totalWeight > 0 ? weightedSum / totalWeight : null;
      }
    }
  }

  return { intersecting, stats };
}

export const AreaSummaryPanel: React.FC<AreaSummaryPanelProps> = ({ polygon, data, metroAverages, onClose }) => {
  const { intersecting, stats } = useMemo(() => computeAreaStats(polygon, data), [polygon, data]);

  const drawnArea = useMemo(() => {
    const a = area(polygon);
    return a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)} km²` : `${Math.round(a).toLocaleString()} m²`;
  }, [polygon]);

  return (
    <>
      {/* Desktop panel */}
      <div className="hidden md:block absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[95vw] max-w-[700px]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl rounded-2xl
                      border border-surface-200 dark:border-surface-800/50 shadow-2xl
                      overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-display font-bold text-surface-900 dark:text-white">
              {t('draw.area_summary')}
            </h2>
            <span className="text-xs text-surface-400 dark:text-surface-500">
              {intersecting.length} {t('draw.neighborhoods')} · {drawnArea}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-surface-500 hover:text-rose-500 dark:text-surface-400 dark:hover:text-rose-400 transition-colors"
          >
            {t('draw.close')}
          </button>
        </div>

        {intersecting.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-surface-400 dark:text-surface-500">
            {t('draw.no_neighborhoods')}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[45vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-surface-400 w-[180px]" />
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
                    {t('draw.selected_area')}
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-surface-400">
                    {t('panel.vs_metro')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {STAT_SECTIONS.map((section) => (
                  <React.Fragment key={section.title || '_main'}>
                    {section.title && (
                      <tr>
                        <td colSpan={3} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                          {t(section.title)}
                        </td>
                      </tr>
                    )}
                    {section.stats.map((stat) => {
                      const val = stats[stat.key];
                      const metro = metroAverages[stat.key];
                      return (
                        <tr key={stat.key} className="border-t border-surface-100 dark:border-surface-800/30">
                          <td className="px-4 py-2 text-surface-500 dark:text-surface-400 text-xs">
                            {t(stat.label)}
                          </td>
                          <td className="px-3 py-2 text-center font-medium text-surface-900 dark:text-white">
                            {stat.format(val)}
                          </td>
                          <td className="px-3 py-2 text-center text-xs text-surface-400">
                            {metro != null && !stat.isCount ? stat.format(metro) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>

            {/* Neighborhood list */}
            <div className="px-4 pt-3 pb-4 border-t border-surface-200 dark:border-surface-800/50">
              <div className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">
                {t('draw.included_areas')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {intersecting.map((n) => (
                  <span key={n.pno} className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs">
                    {n.nimi} <span className="text-violet-400 dark:text-violet-500">{n.pno}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile: bottom sheet */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 max-h-[65vh]
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                      border-t border-surface-200 dark:border-surface-800/50
                      shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800/50">
          <div>
            <h2 className="text-sm font-display font-bold text-surface-900 dark:text-white">
              {t('draw.area_summary')}
            </h2>
            <span className="text-xs text-surface-400 dark:text-surface-500">
              {intersecting.length} {t('draw.neighborhoods')} · {drawnArea}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2" style={{ maxHeight: 'calc(65vh - 56px)' }}>
          {intersecting.length === 0 ? (
            <div className="py-6 text-center text-sm text-surface-400 dark:text-surface-500">
              {t('draw.no_neighborhoods')}
            </div>
          ) : (
            <>
              {STAT_SECTIONS.flatMap((section) =>
                section.stats.map((stat) => {
                  const val = stats[stat.key];
                  return (
                    <div key={stat.key} className="flex justify-between items-center py-1.5">
                      <span className="text-xs text-surface-500 dark:text-surface-400">{t(stat.label)}</span>
                      <span className="text-xs font-medium text-surface-900 dark:text-white">{stat.format(val)}</span>
                    </div>
                  );
                }),
              )}
              <div className="pt-3 border-t border-surface-200 dark:border-surface-800/50">
                <div className="text-xs font-semibold text-surface-400 mb-2">{t('draw.included_areas')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {intersecting.map((n) => (
                    <span key={n.pno} className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs">
                      {n.nimi}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
