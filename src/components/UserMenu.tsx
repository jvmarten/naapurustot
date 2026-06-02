import React, { useState, useRef, useEffect } from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import type { ApiUser } from '../utils/api';
import { useSyncStatus, retryAllSyncs } from '../utils/syncStatus';

export interface FavoriteEntry {
  pno: string;
  name: string;
}

interface UserMenuProps {
  user: ApiUser;
  onLogout: () => void;
  favorites?: FavoriteEntry[];
  onSelectFavorite?: (pno: string) => void;
  onToggleFavorite?: (pno: string) => void;
}

export const UserMenu: React.FC<UserMenuProps> = React.memo(({ user, onLogout, favorites = [], onSelectFavorite, onToggleFavorite }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // PO-5: surface cloud-sync health (was silently swallowed).
  const syncStatus = useSyncStatus();
  // Snapshot favorites when dropdown opens so items stay visible after unfavoriting
  const [snapshotFavorites, setSnapshotFavorites] = useState<FavoriteEntry[]>([]);

  useEffect(() => {
    if (open) {
      setSnapshotFavorites(favorites);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- snapshot only on open

  // Display items: snapshot when open (so unfavorited items stay visible), otherwise current
  const displayFavorites = open ? snapshotFavorites : favorites;
  // Track which are currently favorited (for star fill state)
  const currentPnos = new Set(favorites.map(f => f.pno));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center gap-1.5
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   ${open
                     ? 'bg-brand-500/20 text-brand-600 dark:text-brand-300 border border-brand-500/30'
                     : 'text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                   }`}
        title={user.displayName || user.username}
        aria-label={user.displayName || user.username}
      >
        {/* Mobile: filled user icon — signals logged-in state */}
        <svg className="w-4 h-4 md:hidden" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
        </svg>
        {/* Desktop: username text only */}
        <span className="hidden md:inline max-w-[120px] truncate">{user.displayName || user.username}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700/40 overflow-hidden">
          {/* PO-5: cloud-sync status — only shown when syncing or failed */}
          {syncStatus !== 'idle' && (
            <div
              className={`flex items-center justify-between gap-2 px-4 py-2 text-[11px] border-b border-surface-100 dark:border-surface-800 ${
                syncStatus === 'error' ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {syncStatus === 'syncing' ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('sync.saving')}
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                    </svg>
                    {t('sync.error')}
                  </>
                )}
              </span>
              {syncStatus === 'error' && (
                <button
                  onClick={() => retryAllSyncs()}
                  className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-300"
                >
                  {t('error.retry')}
                </button>
              )}
            </div>
          )}
          {/* Favorites section */}
          {displayFavorites.length > 0 && (
            <div className="border-b border-surface-100 dark:border-surface-800">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                {t('favorites.title')}
              </p>
              <div className="px-1.5 pb-1.5 max-h-48 overflow-y-auto">
                {displayFavorites.map(f => {
                  const isFav = currentPnos.has(f.pno);
                  return (
                    <div
                      key={f.pno}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-left"
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(f.pno); }}
                        className={`shrink-0 transition-colors ${isFav ? 'text-amber-500 hover:text-amber-600' : 'text-surface-300 dark:text-surface-600 hover:text-amber-500'}`}
                        title={isFav ? t('favorites.remove') : t('favorites.add')}
                        aria-label={isFav ? t('favorites.remove') : t('favorites.add')}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isFav ? 0 : 2}>
                          <path strokeLinecap="round" strokeLinejoin="round" fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setOpen(false); onSelectFavorite?.(f.pno); }}
                        className="flex-1 flex items-center gap-2.5 min-w-0"
                      >
                        <span className="truncate">{f.name}</span>
                        <span className="text-xs text-surface-400 dark:text-surface-500 shrink-0">{f.pno}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {displayFavorites.length === 0 && (
            <div className="border-b border-surface-100 dark:border-surface-800">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                {t('favorites.title')}
              </p>
              <p className="px-4 pb-3 text-xs text-surface-400 dark:text-surface-500">
                {t('favorites.empty')}
              </p>
            </div>
          )}

          {/* Logout */}
          <div className="p-1.5">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('auth.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
UserMenu.displayName = 'UserMenu';
