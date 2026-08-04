import React, { useState, useRef, useEffect } from 'react';
import { t, useI18nVersion } from '../utils/i18n';
import type { ApiUser } from '../utils/api';
import { useSyncStatus, useSessionExpired, retryAllSyncs } from '../utils/syncStatus';
import { FavoritesEmptyIllustration } from './EmptyStateIllustrations';
import { readNote } from '../hooks/useNotes';

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
  /** CF-13: GDPR export — resolves to the stored record or an error string. */
  onExportData?: () => Promise<{ data?: Record<string, unknown>; error?: string }>;
  /** CF-13: GDPR account deletion — resolves to null on success or an error string. */
  onDeleteAccount?: () => Promise<string | null>;
  /** AC-1: recovery for the terminal "session expired" (401) state — clears the
   *  dead session's local auth state and reopens the login modal. */
  onReLogin?: () => void;
  /** Set/change the recovery email. Takes the current password because the email
   *  is the password-reset channel — a stolen session must not be able to
   *  repoint it. Resolves to null on success or an error string. */
  onUpdateEmail?: (email: string | null, password: string) => Promise<string | null>;
  /** Rotate the password from this session. Resolves to null on success or an
   *  error string. The server keeps this session alive and kills the others. */
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<string | null>;
}

export const UserMenu: React.FC<UserMenuProps> = React.memo(({ user, onLogout, favorites = [], onSelectFavorite, onToggleFavorite, onExportData, onDeleteAccount, onReLogin, onUpdateEmail, onChangePassword }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // PO-5: surface cloud-sync health (was silently swallowed).
  const syncStatus = useSyncStatus();
  const sessionExpired = useSessionExpired();
  // Snapshot favorites when dropdown opens so items stay visible after unfavoriting
  const [snapshotFavorites, setSnapshotFavorites] = useState<FavoriteEntry[]>([]);
  // CF-13: GDPR export/delete state.
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [gdprError, setGdprError] = useState<string | null>(null);
  // CF-3: brief "account deleted" acknowledgement before the menu closes.
  const [deleted, setDeleted] = useState(false);
  // Recovery-email editing. Signup makes the address optional, and until this
  // existed there was no way to add one later — so an account created without one
  // could never be recovered, no matter how the reset flow behaved.
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);
  // Password rotation. Separate from the reset-by-email flow: this one requires
  // the current password and keeps the session alive.
  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Reset transient GDPR UI whenever the menu closes.
  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setGdprError(null);
      setDeleted(false);
      setEditingEmail(false);
      setEmailError(null);
      setEmailSaved(false);
      setEditingPassword(false);
      setPasswordError(null);
      setPasswordSaved(false);
      // Never leave a password sitting in component state after the menu closes.
      setEmailPassword('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [open]);

  const handleChangePassword = async () => {
    if (!onChangePassword || passwordSaving) return;
    setPasswordError(null);
    // Checked here as well as server-side: a typo in the confirmation should not
    // cost one of the 10 attempts/hour the credential limiter allows.
    if (newPassword !== confirmPassword) {
      setPasswordError(t('auth.passwords_no_match'));
      return;
    }
    setPasswordSaving(true);
    try {
      const err = await onChangePassword(currentPassword, newPassword);
      if (err) {
        setPasswordError(err);
        return;
      }
      setEditingPassword(false);
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!onUpdateEmail || emailSaving) return;
    setEmailError(null);
    setEmailSaving(true);
    try {
      const err = await onUpdateEmail(emailValue.trim(), emailPassword);
      if (err) {
        setEmailError(err);
        return;
      }
      setEditingEmail(false);
      setEmailSaved(true);
      setEmailPassword('');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleExport = async () => {
    if (!onExportData || exporting) return;
    setGdprError(null);
    setExporting(true);
    try {
      const { data, error } = await onExportData();
      if (error || !data) {
        setGdprError(error ?? t('auth.error.server_error'));
        return;
      }
      // Trigger a client-side download of the JSON payload.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'naapurustot-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteAccount || deleting) return;
    setGdprError(null);
    setDeleting(true);
    try {
      const error = await onDeleteAccount();
      if (error) {
        setGdprError(error);
        return;
      }
      // CF-3: the menu used to just vanish, which — with every favorite, note and
      // shortlist entry still on screen — read as "nothing happened". Confirm the
      // deletion, then close.
      setDeleted(true);
      setTimeout(() => setOpen(false), 1600);
    } finally {
      setDeleting(false);
    }
  };

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
    // AY-3: this menu holds sign-out, the GDPR export and account deletion, and was
    // dismissable by outside-click alone — a keyboard or screen-reader user who
    // opened it was stuck. Mirrors ToolsDropdown: the document listener runs ahead
    // of App's window-level Escape cascade, and stopPropagation prevents that
    // cascade from also acting on the same keypress.
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex px-2.5 py-2 rounded-lg text-xs font-semibold transition-all items-center justify-center gap-1.5
                   min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0
                   ${open
                     ? 'bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-500/30'
                     : 'text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-surface-100 dark:hover:bg-white/10 border border-transparent'
                   }`}
        title={syncStatus === 'error' ? `${user.displayName || user.username} — ${t('sync.error')}` : (user.displayName || user.username)}
        aria-label={syncStatus === 'error' ? `${user.displayName || user.username} — ${t('sync.error')}` : (user.displayName || user.username)}
      >
        {/* Mobile: filled user icon — signals logged-in state */}
        <svg className="w-4 h-4 md:hidden" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
        </svg>
        {/* Desktop: username text only */}
        <span className="hidden md:inline max-w-[120px] truncate">{user.displayName || user.username}</span>
        {/* E7: persistent cloud-sync error indicator — visible even when the dropdown is closed */}
        {syncStatus === 'error' && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" aria-hidden />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700/40 overflow-hidden">
          {/* PO-5: cloud-sync status — only shown when syncing or failed */}
          {syncStatus !== 'idle' && (
            <div
              className={`flex items-center justify-between gap-2 px-4 py-2 text-[11px] border-b border-surface-100 dark:border-surface-800 ${
                syncStatus === 'error' ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400'
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
                    {/* IN-3: a 401 is terminal (no retry loop) — tell the user to log in again. */}
                    {sessionExpired ? t('sync.session_expired') : t('sync.error')}
                  </>
                )}
              </span>
              {/* Retry only helps for transient (5xx/network) errors; a 401 needs a re-login. */}
              {syncStatus === 'error' && !sessionExpired && (
                <button
                  onClick={() => retryAllSyncs()}
                  className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-300"
                >
                  {t('error.retry')}
                </button>
              )}
              {/* AC-1: give the "log in again" instruction an actual control. */}
              {syncStatus === 'error' && sessionExpired && onReLogin && (
                <button
                  onClick={() => { setOpen(false); onReLogin(); }}
                  className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-300"
                >
                  {t('auth.login')}
                </button>
              )}
            </div>
          )}
          {/* Favorites section */}
          {displayFavorites.length > 0 && (
            <div className="border-b border-surface-100 dark:border-surface-800">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
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
                        {/* AC-3: surface a saved note on the favorite, so notes are
                            retrievable without re-finding the exact area on the map. */}
                        {readNote(f.pno) !== '' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" aria-label={t('shortlist.has_note')} title={t('shortlist.has_note')} />
                        )}
                        <span className="truncate">{f.name}</span>
                        <span className="text-xs text-surface-500 dark:text-surface-400 shrink-0">{f.pno}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {displayFavorites.length === 0 && (
            <div className="border-b border-surface-100 dark:border-surface-800">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                {t('favorites.title')}
              </p>
              <div className="flex flex-col items-center gap-2 px-4 pt-3 pb-4 text-center">
                <FavoritesEmptyIllustration className="mx-auto opacity-70" />
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {t('favorites.empty')}
                </p>
              </div>
            </div>
          )}

          {/* Recovery email. Shown first and, when absent, as a warning rather
              than a neutral row: without an address the account is genuinely
              unrecoverable, and that is invisible until the day it matters. */}
          {onUpdateEmail && (
            <div className="p-1.5 border-b border-surface-100 dark:border-surface-800">
              {!editingEmail ? (
                <div className="px-3 py-2">
                  {user.email ? (
                    <>
                      <p className="text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
                        {t('account.email_label')}
                      </p>
                      <p className="mt-0.5 text-sm text-surface-700 dark:text-surface-300 break-all">{user.email}</p>
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
                        {t('account.email_missing')}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setEmailValue(user.email ?? '');
                      setEmailPassword('');
                      setEmailError(null);
                      setEmailSaved(false);
                      setEditingEmail(true);
                    }}
                    className="mt-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                  >
                    {user.email ? t('account.email_change') : t('account.email_add')}
                  </button>
                  {emailSaved && (
                    <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400" role="status">
                      {t('account.email_saved')}
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 space-y-2">
                  <label className="block text-[11px] font-semibold text-surface-500 dark:text-surface-400" htmlFor="account-email-input">
                    {t('account.email_label')}
                  </label>
                  <input
                    id="account-email-input"
                    type="email"
                    value={emailValue}
                    onChange={e => setEmailValue(e.target.value)}
                    placeholder={t('auth.email_placeholder')}
                    autoComplete="email"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {/* Re-authentication, not a formality: the address being edited
                      is where reset links go. */}
                  <label className="block text-[11px] font-semibold text-surface-500 dark:text-surface-400" htmlFor="account-email-password">
                    {t('account.email_password')}
                  </label>
                  <input
                    id="account-email-password"
                    type="password"
                    value={emailPassword}
                    onChange={e => setEmailPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div role="alert" aria-live="assertive">
                    {emailError && <p className="text-xs text-red-600 dark:text-red-400">{emailError}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveEmail}
                      disabled={emailSaving || !emailValue.trim() || !emailPassword}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {emailSaving ? t('auth.submitting') : t('account.email_save')}
                    </button>
                    <button
                      onClick={() => { setEditingEmail(false); setEmailPassword(''); setEmailError(null); }}
                      disabled={emailSaving}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors disabled:opacity-50"
                    >
                      {t('account.delete_cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Password rotation. Before this the only way to change a password was
              to sign out and use the forgot-password mail — making the emergency
              channel the routine one, and leaving anyone without inbox access
              unable to change it at all despite being signed in. */}
          {onChangePassword && (
            <div className="p-1.5 border-b border-surface-100 dark:border-surface-800">
              {!editingPassword ? (
                <div className="px-3 py-2">
                  <button
                    onClick={() => {
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setPasswordError(null);
                      setPasswordSaved(false);
                      setEditingPassword(true);
                    }}
                    className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                  >
                    {t('account.password_change')}
                  </button>
                  {passwordSaved && (
                    <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400" role="status">
                      {t('account.password_saved')}
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 space-y-2">
                  <label className="block text-[11px] font-semibold text-surface-500 dark:text-surface-400" htmlFor="account-current-password">
                    {t('account.email_password')}
                  </label>
                  <input
                    id="account-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <label className="block text-[11px] font-semibold text-surface-500 dark:text-surface-400" htmlFor="account-new-password">
                    {/* NOT reset.new_password: the reset.* fi strings live in
                        fi-extra.json, which only the lazy page chunks await —
                        this menu is in the App chunk and would render the raw key. */}
                    {t('account.password_new')}
                  </label>
                  <input
                    id="account-new-password"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    minLength={12}
                    autoComplete="new-password"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <label className="block text-[11px] font-semibold text-surface-500 dark:text-surface-400" htmlFor="account-confirm-password">
                    {t('auth.confirm_password')}
                  </label>
                  <input
                    id="account-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    minLength={12}
                    autoComplete="new-password"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {/* Say up front that other devices will be signed out — it is a
                      deliberate consequence, and discovering it afterwards on a
                      phone reads as the account being broken. */}
                  <p className="text-[11px] text-surface-500 dark:text-surface-400 leading-snug">
                    {t('account.password_sessions_hint')}
                  </p>
                  <div role="alert" aria-live="assertive">
                    {passwordError && <p className="text-xs text-red-600 dark:text-red-400">{passwordError}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleChangePassword}
                      disabled={passwordSaving || !currentPassword || newPassword.length < 12 || !confirmPassword}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {passwordSaving ? t('auth.submitting') : t('account.email_save')}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPassword(false);
                        setCurrentPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError(null);
                      }}
                      disabled={passwordSaving}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors disabled:opacity-50"
                    >
                      {t('account.delete_cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CF-13: GDPR data controls — only when the auth backend is wired in */}
          {(onExportData || onDeleteAccount) && (
            <div className="p-1.5 border-b border-surface-100 dark:border-surface-800">
              {onExportData && (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  {exporting ? t('auth.submitting') : t('account.export')}
                </button>
              )}

              {onDeleteAccount && !confirmingDelete && (
                <button
                  onClick={() => { setGdprError(null); setConfirmingDelete(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  {t('account.delete')}
                </button>
              )}

              {onDeleteAccount && confirmingDelete && (
                <div className="px-3 py-2">
                  <p className="text-xs text-surface-600 dark:text-surface-400 mb-2">{t('account.delete_confirm')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {deleting ? t('auth.submitting') : t('account.delete_yes')}
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors disabled:opacity-50"
                    >
                      {t('account.delete_cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* CF-3: acknowledge the deletion — including the local wipe the
                  confirmation copy promises — before the menu closes. */}
              {deleted && (
                <p className="px-3 py-1.5 text-xs text-emerald-600 dark:text-emerald-400" role="status">
                  {t('account.deleted')}
                </p>
              )}

              {gdprError && (
                <p className="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">{gdprError}</p>
              )}
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
