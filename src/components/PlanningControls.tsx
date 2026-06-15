import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import { planningInfo, regionHasPlans } from '../hooks/usePlanningData';

interface Props {
  enabled: boolean;
  /** Active region id — gates whether the plan-status legend is meaningful. */
  region: string | undefined;
  onToggle: () => void;
}

// Representative swatches (the full status palette lives in Map.tsx PLAN_STATUS_COLOR).
const STATUS_SWATCHES = [
  { code: 'vireilla', color: '#f59e0b' },
  { code: 'ehdotus', color: '#6366f1' },
  { code: 'hyvaksytty', color: '#10b981' },
];
const TYPE_SWATCHES = [
  { code: 'road', color: '#f97316' },
  { code: 'rail', color: '#a855f7' },
  { code: 'waterway', color: '#06b6d4' },
];

/**
 * CF-2: toggle + legend + honest coverage caption for the kaavat & hankkeet map
 * overlay. The overlay is additive (coexists with any active choropleth); the
 * caption keeps the partial municipal coverage honest.
 */
export const PlanningControls: React.FC<Props> = ({ enabled, region, onToggle }) => {
  useI18nVersion();
  const info = planningInfo();
  const showPlans = regionHasPlans(region);
  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
          {t('planning.title')}
        </h3>
        <button
          onClick={onToggle}
          aria-pressed={enabled}
          className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
            enabled
              ? 'bg-brand-600 text-white'
              : 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60'
          }`}
        >
          {enabled ? t('planning.on') : t('planning.off')}
        </button>
      </div>

      {enabled && (
        <>
          <div className="space-y-1.5 mb-2">
            {showPlans && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {STATUS_SWATCHES.map((s) => (
                  <span key={s.code} className="inline-flex items-center gap-1 text-[11px] text-surface-600 dark:text-surface-300">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                    {t(`panel.plan_status_${s.code}`)}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {TYPE_SWATCHES.map((s) => (
                <span key={s.code} className="inline-flex items-center gap-1 text-[11px] text-surface-600 dark:text-surface-300">
                  <span className="w-3 h-[3px] rounded flex-shrink-0" style={{ backgroundColor: s.color }} />
                  {t(`panel.plan_type_${s.code}`)}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-surface-400 dark:text-surface-500 leading-snug" role="note">
            {t('planning.coverage').replace('{date}', info.snapshot)}
          </p>
        </>
      )}
    </div>
  );
};
