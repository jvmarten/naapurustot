import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import { ISOCHRONE_MODES, ISOCHRONE_BUDGETS, type IsochroneMode } from '../utils/isochrone';

interface Props {
  mode: IsochroneMode;
  budget: number;
  loading?: boolean;
  /** E1: the last fetch failed (network/HTTP) — show an error row with a retry. */
  error?: boolean;
  active?: boolean;
  onChange: (mode: IsochroneMode, budget: number) => void;
  onClear: () => void;
}

const MODE_LABEL: Record<IsochroneMode, string> = {
  walk: 'isochrone.walk',
  bike: 'isochrone.bike',
  transit: 'isochrone.transit',
};

/**
 * CF-5: mode + time-budget picker for the travel-time isochrone overlay.
 * Rendered only when a Digitransit key is configured (ISOCHRONE_ENABLED).
 */
export const IsochroneControls: React.FC<Props> = ({ mode, budget, loading, error, active, onChange, onClear }) => {
  useI18nVersion();
  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
          {t('isochrone.title')}
        </h3>
        {active && (
          <button
            onClick={onClear}
            className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
          >
            {t('draw.clear')}
          </button>
        )}
      </div>

      {/* Mode */}
      <div className="flex rounded-lg border border-surface-200 dark:border-surface-700/40 overflow-hidden mb-2">
        {ISOCHRONE_MODES.map((m) => (
          <button
            key={m}
            onClick={() => onChange(m, budget)}
            aria-pressed={active && mode === m}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${active && mode === m
              ? 'bg-brand-500/15 dark:bg-brand-600/20 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'}`}
          >
            {t(MODE_LABEL[m])}
          </button>
        ))}
      </div>

      {/* Budget */}
      <div className="flex items-center gap-1.5">
        {ISOCHRONE_BUDGETS.map((b) => (
          <button
            key={b}
            onClick={() => onChange(mode, b)}
            aria-pressed={active && budget === b}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-colors ${active && budget === b
              ? 'bg-brand-600 text-white'
              : 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60'}`}
          >
            {b} {t('isochrone.minutes')}
          </button>
        ))}
      </div>

      {loading && (
        <p className="mt-2 text-[11px] text-surface-500 dark:text-surface-400">{t('isochrone.loading')}</p>
      )}

      {/* E1: surface a genuine fetch failure (vs. a silently empty area) with a retry. */}
      {error && !loading && (
        <div className="mt-2 flex items-center justify-between gap-2" role="alert">
          <span className="text-[11px] text-amber-600 dark:text-amber-400">{t('isochrone.error')}</span>
          <button
            onClick={() => onChange(mode, budget)}
            className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline flex-shrink-0"
          >
            {t('error.retry')}
          </button>
        </div>
      )}
    </div>
  );
};
