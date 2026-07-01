import React from 'react';
import { getMetricSource } from '../../utils/metrics';
import { diffColor } from '../../utils/formatting';
import { t } from '../../utils/i18n';

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
  // #1 trust: resolve the full registry entry (source, vintage, proxy flag, caveat
  // note) so cold Google traffic sees the same data-honesty signals the in-app panel
  // shows — not just a bare number. `isProxy` earns an "Estimate" badge; a `note`
  // (e.g. property price's "largest municipalities only") renders as a caveat line.
  const source = getMetricSource(propertyKey);
  const colorClass = diffColor(rawValue, average, higherIsBetter);
  // The sub-region fallback already carries its own amber badge + note, so don't
  // stack the generic proxy/note signals on top of it.
  const showProxy = !subregionEstimate && !!source?.isProxy;
  const showNote = !subregionEstimate && !!source?.note;

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
        {showProxy && (
          <span
            className="inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide
                       bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30"
            title={t('layer_signal.proxy')}
          >
            {t('data.estimate')}
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
      {showNote && source?.note && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug mt-1">
          {t(source.note)}
        </div>
      )}
      {source && (
        <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-2">
          {source.source} ({source.year})
        </div>
      )}
    </div>
  );
};
