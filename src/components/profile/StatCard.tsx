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
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  rawValue,
  average,
  avgLabel,
  propertyKey,
  higherIsBetter = true,
}) => {
  const source = METRIC_SOURCES[propertyKey];
  const colorClass = diffColor(rawValue, average, higherIsBetter);

  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold text-surface-900 dark:text-white mb-1">
        {value}
      </div>
      {average != null && (
        <div className={`text-sm ${colorClass}`}>
          {avgLabel}
        </div>
      )}
      {source && (
        <div className="text-[10px] text-surface-400 dark:text-surface-500 mt-2">
          {source.source} ({source.year})
        </div>
      )}
    </div>
  );
};
