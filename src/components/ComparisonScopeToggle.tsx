import React from 'react';
import { t } from '../utils/i18n';

export type ComparisonScope = 'all' | 'region';

interface ComparisonScopeToggleProps {
  scope: ComparisonScope;
  onChange: (scope: ComparisonScope) => void;
  disabled: boolean;
}

export const ComparisonScopeToggle: React.FC<ComparisonScopeToggleProps> = React.memo(({ scope, onChange, disabled }) => {
  const isRegion = scope === 'region';

  return (
    <button
      onClick={() => onChange(isRegion ? 'all' : 'region')}
      disabled={disabled}
      className={`text-sm font-medium rounded-lg md:rounded-xl px-2.5 py-1.5 md:px-3 md:py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400
        ${disabled
          ? 'bg-surface-300/60 text-surface-400 cursor-not-allowed dark:bg-surface-700/40 dark:text-surface-500'
          : isRegion
            ? 'bg-amber-500/90 hover:bg-amber-600/90 text-white'
            : 'md:bg-transparent md:hover:bg-surface-100/50 md:dark:hover:bg-surface-800/30 bg-surface-200/80 hover:bg-surface-300/80 text-surface-600 dark:bg-surface-700/60 dark:hover:bg-surface-600/60 dark:text-surface-300 md:dark:bg-transparent'
        }`}
      title={disabled ? t('scope.all') : isRegion ? t('scope.active_hint') : t('scope.label')}
      aria-label={t('scope.label')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" clipRule="evenodd" />
      </svg>
    </button>
  );
});
ComparisonScopeToggle.displayName = 'ComparisonScopeToggle';
