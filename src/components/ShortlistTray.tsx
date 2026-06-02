import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';

export interface ShortlistEntry {
  pno: string;
  name: string;
}

interface ShortlistTrayProps {
  entries: ShortlistEntry[];
  onSelect: (pno: string) => void;
  onRemove: (pno: string) => void;
  onCompare: () => void;
  onClear: () => void;
}

/**
 * QW-2: floating tray on the home view showing the user's shortlist as chips —
 * click a chip to view that area, remove it, compare the set (pins up to 3), or
 * clear all. Renders nothing when the shortlist is empty.
 */
export const ShortlistTray: React.FC<ShortlistTrayProps> = React.memo(({ entries, onSelect, onRemove, onCompare, onClear }) => {
  useI18nVersion();
  if (entries.length === 0) return null;

  return (
    <div className="fixed md:absolute bottom-20 md:bottom-24 left-1/2 -translate-x-1/2 z-10 w-[min(92vw,560px)] pointer-events-none">
      <div className="pointer-events-auto rounded-2xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                      border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('shortlist.title')} ({entries.length})
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={onCompare} className="text-brand-600 dark:text-brand-300 font-semibold hover:underline">
              {t('shortlist.compare')}
            </button>
            <span className="text-surface-300 dark:text-surface-700" aria-hidden>·</span>
            <button onClick={onClear} className="text-surface-500 hover:text-rose-500 dark:text-surface-400 transition-colors">
              {t('shortlist.clear')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entries.map((e) => (
            <span
              key={e.pno}
              className="inline-flex items-center gap-1 max-w-[180px] pl-2.5 pr-1 py-1 rounded-full text-xs
                         bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200"
            >
              <button onClick={() => onSelect(e.pno)} className="truncate hover:text-brand-600 dark:hover:text-brand-300">
                {e.name}
              </button>
              <button
                onClick={() => onRemove(e.pno)}
                aria-label={t('shortlist.remove')}
                title={t('shortlist.remove')}
                className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-surface-400 hover:text-rose-500 hover:bg-surface-200 dark:hover:bg-surface-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
ShortlistTray.displayName = 'ShortlistTray';
