import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';

/**
 * O3: the dismissible "click an area" hint. Positioned by its caller — App centres it
 * over the map on desktop, Legend stacks it above the legend card on phones (centred,
 * it overprinted the legend there).
 */
export const AreaHintPill: React.FC<{ onDismiss: () => void; className?: string }> = React.memo(({ onDismiss, className = '' }) => {
  useI18nVersion();
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm
                     bg-surface-900/90 dark:bg-white/90 text-white dark:text-surface-900 text-xs font-medium ${className}`}>
      <span aria-hidden="true">👆</span>
      <span>{t('map.click_hint_pill')}</span>
      <button
        onClick={onDismiss}
        aria-label={t('aria.close')}
        className="-mr-1 shrink-0 text-white/70 dark:text-surface-900/70 hover:text-white dark:hover:text-surface-900"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
});
