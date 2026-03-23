import React from 'react';
import { t } from '../utils/i18n';

interface DrawToolProps {
  active: boolean;
  hasPolygon: boolean;
  onToggle: () => void;
  onClear: () => void;
}

export const DrawTool: React.FC<DrawToolProps> = React.memo(({ active, hasPolygon, onToggle, onClear }) => {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-md
                   border shadow-lg text-xs font-semibold transition-all
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   ${active
                     ? 'bg-violet-500/15 dark:bg-violet-600/20 border-violet-500/30 dark:border-violet-500/30 text-violet-600 dark:text-violet-300'
                     : 'bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-white dark:hover:bg-surface-800/80'
                   }`}
        aria-label={t('draw.toggle')}
        title={t('draw.toggle')}
      >
        {/* Polygon draw icon */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-1a1 1 0 01-1-1v-4zM5 10v4a1 1 0 001 1h4M15 14v-4a1 1 0 00-1-1h-4" />
        </svg>
        <span className="hidden md:inline">{active ? t('draw.drawing') : t('draw.toggle')}</span>
      </button>

      {hasPolygon && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl backdrop-blur-md
                     border shadow-lg text-xs font-semibold transition-all
                     min-h-[44px] md:min-h-0
                     bg-white/90 dark:bg-surface-900/90 border-surface-200 dark:border-surface-700/40
                     text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          aria-label={t('draw.clear')}
          title={t('draw.clear')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="hidden md:inline">{t('draw.clear')}</span>
        </button>
      )}
    </div>
  );
});
