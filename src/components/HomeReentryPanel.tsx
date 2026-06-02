import React from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import type { RecentEntry } from '../hooks/useRecentNeighborhoods';
import type { FavoriteEntry } from './UserMenu';

interface HomeReentryPanelProps {
  recent: RecentEntry[];
  favorites: FavoriteEntry[];
  onSelect: (pno: string) => void;
}

const Chip: React.FC<{ label: string; starred?: boolean; onClick: () => void }> = ({ label, starred, onClick }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1 max-w-[180px] px-2.5 py-1 rounded-full text-xs
               bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200
               hover:bg-brand-500/15 hover:text-brand-600 dark:hover:text-brand-300 border border-transparent
               hover:border-brand-500/30 transition-colors"
  >
    {starred && <span className="text-amber-500" aria-hidden="true">★</span>}
    <span className="truncate">{label}</span>
  </button>
);

/**
 * PO-4: a "continue exploring" surface shown on the home view when nothing is
 * selected — resurfaces the user's favorites and recently-viewed neighbourhoods as
 * one-click chips that restore that area. Purely local data (sessionStorage recents
 * + localStorage favorites); renders nothing for a first-time visitor.
 */
export const HomeReentryPanel: React.FC<HomeReentryPanelProps> = React.memo(({ recent, favorites, onSelect }) => {
  useI18nVersion();
  const favPnos = new Set(favorites.map((f) => f.pno));
  const recentChips = recent.filter((r) => !favPnos.has(r.pno)).slice(0, 8);
  if (favorites.length === 0 && recentChips.length === 0) return null;

  return (
    <div className="fixed md:absolute bottom-20 md:bottom-24 left-1/2 -translate-x-1/2 z-10 w-[min(92vw,560px)] pointer-events-none">
      <div className="pointer-events-auto rounded-2xl bg-white/95 dark:bg-surface-900/95 backdrop-blur-md
                      border border-surface-200 dark:border-surface-700/40 shadow-2xl px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
          {t('reentry.title')}
        </div>
        {favorites.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">{t('favorites.title')}</div>
            <div className="flex flex-wrap gap-1.5">
              {favorites.slice(0, 8).map((f) => (
                <Chip key={f.pno} label={f.name} starred onClick={() => onSelect(f.pno)} />
              ))}
            </div>
          </div>
        )}
        {recentChips.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1">{t('reentry.recent')}</div>
            <div className="flex flex-wrap gap-1.5">
              {recentChips.map((r) => (
                <Chip key={r.pno} label={r.name} onClick={() => onSelect(r.pno)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
HomeReentryPanel.displayName = 'HomeReentryPanel';
