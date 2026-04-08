import React, { useState, useRef, useEffect } from 'react';
import { t } from '../utils/i18n';
import type { ApiUser } from '../utils/api';

interface UserMenuProps {
  user: ApiUser;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, onLogout }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        <span className="hidden md:inline">{user.displayName || user.username}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
            {user.displayName && (
              <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{user.displayName}</p>
            )}
            <p className="text-xs text-surface-500 dark:text-surface-400 truncate">@{user.username}</p>
          </div>
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
};
