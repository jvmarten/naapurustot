import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t, getLang } from '../utils/i18n';
import { Turnstile } from './Turnstile';
import { useFocusTrap } from '../hooks/useFocusTrap';

// PO-14: lang-aware path to the prerendered privacy & data-handling notice.
const PRIVACY_PATH: Record<string, string> = {
  fi: '/tietosuoja',
  en: '/en/privacy',
  sv: '/sv/integritet',
};

interface AuthModalProps {
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<string | null>;
  onSignup: (username: string, password: string, turnstileToken: string, email?: string, displayName?: string) => Promise<string | null>;
}

const INPUT_CLASS = 'w-full px-3 py-2.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow';

// AC-4: eye / eye-off glyphs for the reveal toggle, so users entering a 12-char
// minimum password (twice, on signup, with no recovery flow) can verify what they typed.
const EyeIcon: React.FC<{ off: boolean }> = ({ off }) => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    {off ? (
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </>
    )}
  </svg>
);

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onLogin, onSignup }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // AC-4: reveal both password fields together (no blind double-entry).
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  // Bumped to remount the Turnstile widget (and thus mint a fresh, unredeemed
  // token) after a failed signup, since tokens are single-use.
  const [turnstileKey, setTurnstileKey] = useState(0);
  // AC-3: widget lifecycle so the token-missing submit copy can distinguish
  // "still loading" from "blocked and will never issue a token".
  const [turnstileStatus, setTurnstileStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  // AC-3: count token-less submit attempts — repeated ones mean the challenge is
  // silently never resolving (blocked script/frame), so stop saying "try again".
  const emptyTokenAttemptsRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // PO-3: contain Tab focus within the modal (it declares aria-modal).
  useFocusTrap(panelRef);

  // A11y: move focus into the dialog on open and restore it to the triggering
  // element on close, so keyboard/screen-reader users aren't left behind the modal.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const firstInput = panelRef.current?.querySelector<HTMLInputElement>('input[type="text"]');
    (firstInput ?? panelRef.current)?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        // Also stop propagation to prevent the App-level Escape handler
        // (registered on window) from closing the selected neighborhood
        // panel or other UI underneath the modal.
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setError(t('auth.passwords_no_match'));
      return;
    }

    // Block submit until the Turnstile challenge has produced a token. The server
    // verifies the token AFTER the rate-limit middleware, so an empty-token submit
    // still burns one of the 3 daily signup attempts for a guaranteed 403.
    // AC-3: say what is actually happening instead of an infinite generic "try
    // again" — the widget may still be loading, or it may be blocked and will
    // never issue a token (the app is fully usable without an account).
    if (mode === 'signup' && TURNSTILE_SITE_KEY && !turnstileToken) {
      emptyTokenAttemptsRef.current += 1;
      if (turnstileStatus === 'loading') {
        setError(t('auth.error.bot_check_loading'));
      } else if (turnstileStatus === 'failed' || emptyTokenAttemptsRef.current >= 3) {
        setError(t('auth.error.bot_check_stuck'));
      } else {
        setError(t('auth.error.bot_check_failed'));
      }
      return;
    }

    setSubmitting(true);

    const err = mode === 'login'
      ? await onLogin(username, password)
      : await onSignup(username, password, turnstileToken, email || undefined);

    setSubmitting(false);
    if (err) {
      setError(err);
      // The server redeems the (single-use) Turnstile token even on a failed
      // signup, so force a fresh widget before the user can resubmit — otherwise
      // the next attempt re-sends a consumed token and always fails bot check.
      if (mode === 'signup') {
        setTurnstileToken('');
        setTurnstileKey((k) => k + 1);
      }
    } else {
      onClose();
    }
  }, [mode, username, password, confirmPassword, email, turnstileToken, turnstileStatus, submitting, onLogin, onSignup, onClose]);

  const switchMode = useCallback((newMode: 'login' | 'signup') => {
    setMode(newMode);
    setError(null);
  }, []);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? t('auth.login') : t('auth.signup')}
        tabIndex={-1}
        className="w-full max-w-sm mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 overflow-hidden max-h-[90vh] overflow-y-auto outline-none"
      >
        {/* Tab header */}
        <div className="flex items-center border-b border-surface-200 dark:border-surface-700/40">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-3.5 text-sm font-semibold text-center transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
              ${mode === 'login'
                ? 'text-surface-900 dark:text-white'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'}`}
          >
            {t('auth.login')}
            {mode === 'login' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-3.5 text-sm font-semibold text-center transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
              ${mode === 'signup'
                ? 'text-surface-900 dark:text-white'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'}`}
          >
            {t('auth.signup')}
            {mode === 'signup' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            onClick={onClose}
            aria-label={t('aria.close')}
            className="px-3 py-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* X2: one-line value proposition — the form otherwise opens straight into
            a 12-char password prompt with no stated reason to create an account. */}
        <p className="px-6 pt-4 text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
          {t('auth.value_prop')}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
              {t('auth.username')}
            </label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_\-]+"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={INPUT_CLASS}
              placeholder={t('auth.username_placeholder')}
              autoComplete="username"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
              {t('auth.password')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={12}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={`${INPUT_CLASS} pr-10`}
                placeholder={t('auth.password_placeholder')}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'auth-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={t('auth.show_password')}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-r-lg"
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
          </div>

          {/* Signup-only fields */}
          {mode === 'signup' && (
            <>
              {/* Confirm password */}
              <div>
                <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                  {t('auth.confirm_password')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={12}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className={`${INPUT_CLASS} pr-10`}
                    placeholder={t('auth.confirm_password_placeholder')}
                    autoComplete="new-password"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'auth-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={t('auth.show_password')}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-r-lg"
                  >
                    <EyeIcon off={showPassword} />
                  </button>
                </div>
              </div>

              {/* Optional email */}
              <div>
                <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                  {t('auth.email')} <span className="font-normal text-surface-500 dark:text-surface-400">({t('auth.optional')})</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder={t('auth.email_placeholder')}
                />
                <p className="mt-1 text-[11px] text-surface-500 dark:text-surface-400">{t('auth.email_hint')}</p>
              </div>

              {/* Turnstile */}
              <Turnstile key={turnstileKey} onToken={setTurnstileToken} onStatus={setTurnstileStatus} />
            </>
          )}

          {/* AY-1: always-mounted assertive live region so every auth failure
              (wrong password, mismatch, bot check, rate limit) is announced to
              screen readers — a conditionally-mounted plain <p> was silent. */}
          <div role="alert" aria-live="assertive">
            {error && (
              <p id="auth-error" className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {submitting
              ? t('auth.submitting')
              : mode === 'login' ? t('auth.login') : t('auth.signup')}
          </button>

          {/* PO-14: link the privacy & data-handling notice so users see what an
              account stores before creating one. */}
          <p className="text-center text-[11px] text-surface-500 dark:text-surface-400">
            <a
              href={PRIVACY_PATH[getLang()] ?? PRIVACY_PATH.fi}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-brand-600 dark:hover:text-brand-400"
            >
              {t('privacy.link')}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
};
