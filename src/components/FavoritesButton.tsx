import React, { useState, useRef, useEffect } from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import type { FavoriteEntry } from './UserMenu';
import { readNote } from '../hooks/useNotes';

// Shared filled-star path (used for the trigger icon and each list item's remove control).
const STAR_PATH = 'M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z';

interface FavoritesButtonProps {
  favorites: FavoriteEntry[];
  onSelectFavorite: (pno: string) => void;
  onToggleFavorite: (pno: string) => void;
  /** Upsell: open the auth modal so the user can sync favorites across devices. */
  onSignIn: () => void;
}

/**
 * EM1: a signed-out surface for favorites. The panel's star toggle works while
 * logged out and persists to localStorage, but the only list lived inside the
 * login-gated UserMenu — so anonymous users starred areas into a void. This
 * header dropdown gives them the same list (view / unfavorite) plus a sign-in
 * upsell, keeping cloud-sync an upsell rather than a gate. Rendered only when
 * signed out and at least one favorite exists, so it never adds first-run chrome.
 */
export const FavoritesButton: React.FC<FavoritesButtonProps> = React.memo(({ favorites, onSelectFavorite, onToggleFavorite, onSignIn }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('favorites.title')}
        title={t('favorites.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-semibold transition-all
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 justify-center
                   text-amber-500 hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" d={STAR_PATH} clipRule="evenodd" />
        </svg>
        <span className="tabular-nums">{favorites.length}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-white dark:bg-surface-900
                     border border-surface-200 dark:border-surface-700/40 shadow-2xl backdrop-blur-md py-1 z-50"
        >
          <p className="px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
            {t('favorites.title')}
          </p>
          <div className="px-1.5 pb-1.5 max-h-60 overflow-y-auto">
            {favorites.map((f) => (
              <div
                key={f.pno}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-left"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(f.pno); }}
                  className="shrink-0 text-amber-500 hover:text-amber-600 transition-colors"
                  title={t('favorites.remove')}
                  aria-label={t('favorites.remove')}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d={STAR_PATH} clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  onClick={() => { setOpen(false); onSelectFavorite(f.pno); }}
                  className="flex-1 flex items-center gap-2.5 min-w-0"
                >
                  {/* AC-3: note indicator — mirrors the UserMenu + ShortlistTray dot. */}
                  {readNote(f.pno) !== '' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" aria-label={t('shortlist.has_note')} title={t('shortlist.has_note')} />
                  )}
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-surface-500 dark:text-surface-400 shrink-0">{f.pno}</span>
                </button>
              </div>
            ))}
          </div>
          {/* Cloud-sync upsell — never a gate. */}
          <div className="border-t border-surface-100 dark:border-surface-800 px-4 py-2.5">
            <button
              onClick={() => { setOpen(false); onSignIn(); }}
              className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline text-left"
            >
              {t('favorites.sync_upsell')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

FavoritesButton.displayName = 'FavoritesButton';
