import React, { useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { type LayerId, getLayerById, getColorForValue } from '../utils/colorScales';
import type { NeighborhoodProperties } from '../utils/metrics';
import { t } from '../utils/i18n';

interface RankingTableProps {
  data: FeatureCollection | null;
  activeLayer: LayerId;
  onSelect: (pno: string, center: [number, number]) => void;
  onClose: () => void;
}

interface RankedItem {
  rank: number;
  name: string;
  pno: string;
  value: number;
  center: [number, number];
}

function getCenter(feature: GeoJSON.Feature): [number, number] {
  const geom = feature.geometry;
  if (geom.type === 'Point') return geom.coordinates as [number, number];
  const coords: GeoJSON.Position[] = [];
  function extract(c: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][]) {
    if (typeof c[0] === 'number') coords.push(c as GeoJSON.Position);
    else (c as GeoJSON.Position[][]).forEach(extract);
  }
  if ('coordinates' in geom) {
    extract(geom.coordinates as GeoJSON.Position[]);
  }
  if (coords.length === 0) return [0, 0];
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lng, lat];
}

// Layers where lower values are better
const LOWER_IS_BETTER: Set<LayerId> = new Set([
  'unemployment', 'air_quality', 'crime_rate', 'noise_level',
  'commute_time', 'light_pollution', 'mental_health', 'traffic_accidents',
  'obesity_rate', 'kela_benefits',
]);

export const RankingTable: React.FC<RankingTableProps> = ({ data, activeLayer, onSelect, onClose }) => {
  const layer = getLayerById(activeLayer);
  const [reversed, setReversed] = useState(false);

  const { items, minVal, maxVal } = useMemo(() => {
    if (!data) return { items: [], minVal: 0, maxVal: 1 };

    const property = layer.property;
    const bestFirst = !LOWER_IS_BETTER.has(activeLayer);

    const entries: { feature: GeoJSON.Feature; value: number }[] = [];
    for (const f of data.features) {
      const p = f.properties as NeighborhoodProperties;
      const v = p[property];
      if (typeof v === 'number' && v != null && p.he_vakiy != null && p.he_vakiy > 0) {
        entries.push({ feature: f, value: v });
      }
    }

    // Always sort "best first" to assign stable ranks
    entries.sort((a, b) => bestFirst ? b.value - a.value : a.value - b.value);

    let mn = Infinity;
    let mx = -Infinity;
    for (const e of entries) {
      if (e.value < mn) mn = e.value;
      if (e.value > mx) mx = e.value;
    }

    const ranked: RankedItem[] = entries.map((e, i) => ({
      rank: i + 1,
      name: (e.feature.properties as NeighborhoodProperties).nimi || (e.feature.properties as NeighborhoodProperties).pno,
      pno: (e.feature.properties as NeighborhoodProperties).pno,
      value: e.value,
      center: getCenter(e.feature),
    }));

    // Reverse display order if toggled, but keep rank numbers stable
    if (reversed) ranked.reverse();

    return { items: ranked, minVal: mn === Infinity ? 0 : mn, maxVal: mx === -Infinity ? 1 : mx };
  }, [data, activeLayer, layer.property, reversed]);

  const range = maxVal - minVal || 1;

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
          aria-label="Close ranking"
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
          const barWidth = ((item.value - minVal) / range) * 100;
          const color = getColorForValue(layer, item.value);

          return (
            <button
              key={item.pno}
              onClick={() => onSelect(item.pno, item.center)}
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

        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-surface-400 dark:text-surface-500">
            {t('ranking.no_data')}
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
};
