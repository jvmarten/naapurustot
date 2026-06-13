import React from 'react';
import { METRIC_SOURCES } from '../../utils/metrics';
import { diffColor } from '../../utils/formatting';

interface StatCardProps {
  label: string;
  value: string;
  rawValue: number | null;
  average: number | null;
  avgLabel: string;
  propertyKey: string;
  higherIsBetter?: boolean;
  /** T1: the value is the seutukunta (sub-region) average (this area has none of its
   *  own) — show a "Seutuarvio" badge + disclaimer instead of the vs-average diff. */
  subregionEstimate?: boolean;
  /** Short estimate badge label (e.g. "Seutuarvio"). */
  subregionBadge?: string;
  /** Localized disclaimer line shown in place of the average comparison. */
  subregionNote?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  rawValue,
  average,
  avgLabel,
  propertyKey,
  higherIsBetter = true,
  subregionEstimate = false,
  subregionBadge,
  subregionNote,
}) => {
  const source = METRIC_SOURCES[propertyKey];
  const colorClass = diffColor(rawValue, average, higherIsBetter);

  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold text-surface-900 dark:text-white mb-1 flex items-center gap-2 flex-wrap">
        {value}
        {subregionEstimate && subregionBadge && (
          <span className="inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide
                           bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30">
            {subregionBadge}
          </span>
        )}
      </div>
      {subregionEstimate ? (
        subregionNote && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
            {subregionNote}
          </div>
        )
      ) : (
        average != null && (
          <div className={`text-sm ${colorClass}`}>
            {avgLabel}
          </div>
        )
      )}
      {source && (
        <div className="text-[10px] text-surface-400 dark:text-surface-500 mt-2">
          {source.source} ({source.year})
        </div>
      )}
    </div>
  );
};
