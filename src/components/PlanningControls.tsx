import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import { planningInfo, regionHasPlans } from '../hooks/usePlanningData';

interface Props {
  enabled: boolean;
  /** Active region id — gates whether the plan-status legend is meaningful. */
  region: string | undefined;
  onToggle: () => void;
  /** ER-3: true while the region's planning shards are still fetching. */
  loading?: boolean;
  /** ER-3: true when a shard failed. An empty overlay then means "we don't know",
   *  not "no plans here" — the caption must say which. */
  error?: boolean;
  /** ER-3: refetch after a failure (clears nothing else; the failed result was
   *  deliberately not cached). */
  onRetry?: () => void;
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
export const PlanningControls: React.FC<Props> = ({ enabled, region, onToggle, loading, error, onRetry }) => {
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

      {/* ER-3: the fetch was previously invisible — no spinner, and a failed shard
          rendered as a blank overlay next to a fully drawn legend, which reads as
          "nothing is planned here". Say which state we are actually in. */}
      {enabled && loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-surface-500 dark:text-surface-400 mb-2" role="status">
          <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t('planning.loading')}
        </p>
      )}
      {enabled && error && !loading && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 leading-snug" role="status" aria-live="polite">
          <span aria-hidden="true">⚠</span>
          <span>
            {t('planning.load_failed')}
            {onRetry && (
              <button onClick={onRetry} className="ml-1.5 font-semibold underline hover:no-underline">
                {t('error.retry')}
              </button>
            )}
          </span>
        </div>
      )}

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
          <p className="text-[11px] text-surface-500 dark:text-surface-400 leading-snug" role="note">
            {t('planning.coverage').replace('{date}', info.snapshot)}
          </p>
        </>
      )}
    </div>
  );
};
