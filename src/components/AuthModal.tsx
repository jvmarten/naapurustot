import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t, getLang } from '../utils/i18n';
import { api } from '../utils/api';
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

type Mode = 'login' | 'signup' | 'forgot';

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
  const [mode, setMode] = useState<Mode>('login');
  // Set once a reset request has been sent. The confirmation it shows is
  // deliberately the same whether or not the address matched an account — the
  // server answers identically by design, and revealing the difference here would
  // give back exactly the account-enumeration oracle it refuses to be.
  const [forgotSent, setForgotSent] = useState(false);
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

    if (mode === 'forgot') {
      setSubmitting(true);
      // The response is ignored on purpose beyond transport failures: the server
      // returns 200 for a real address, an unknown one and a malformed one alike.
      const { error: err } = await api.forgotPassword(email, getLang());
      setSubmitting(false);
      // Only a network/5xx failure is worth surfacing — anything else would leak
      // whether the address is registered.
      if (err) setError(err);
      else setForgotSent(true);
      return;
    }

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

  const switchMode = useCallback((newMode: Mode) => {
    setMode(newMode);
    setError(null);
    setForgotSent(false);
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
        aria-label={mode === 'login' ? t('auth.login') : mode === 'signup' ? t('auth.signup') : t('auth.forgot_title')}
        tabIndex={-1}
        className="w-full max-w-sm mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 overflow-hidden max-h-[90vh] overflow-y-auto outline-none"
      >
        {/* Reset request replaces the login/signup tabs with its own titled header —
            it is a detour out of both, so leaving a tab highlighted would misreport
            where the user is. */}
        {mode === 'forgot' ? (
          <div className="flex items-center border-b border-surface-200 dark:border-surface-700/40">
            <button
              type="button"
              onClick={() => switchMode('login')}
              aria-label={t('auth.forgot_back')}
              className="px-3 py-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="flex-1 py-3.5 text-sm font-semibold text-surface-900 dark:text-white">
              {t('auth.forgot_title')}
            </span>
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
        ) : (
        /* Tab header */
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
        )}

        {/* X2: one-line value proposition — the form otherwise opens straight into
            a 12-char password prompt with no stated reason to create an account. */}
        <p className="px-6 pt-4 text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
          {mode === 'forgot' ? t('auth.forgot_intro') : t('auth.value_prop')}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          {mode === 'forgot' ? (
            forgotSent ? (
              <>
                {/* Worded to be true either way: it never confirms the address is
                    registered, so it cannot be used to probe for accounts. */}
                <div role="status" className="rounded-lg bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/30 px-4 py-3">
                  <p className="text-sm text-surface-800 dark:text-surface-100 leading-relaxed">
                    {t('auth.forgot_sent')}
                  </p>
                </div>
                <p className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
                  {t('auth.forgot_sent_hint')}
                </p>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {t('auth.forgot_back')}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="auth-forgot-email" className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                    {t('auth.email')}
                  </label>
                  <input
                    id="auth-forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder={t('auth.email_placeholder')}
                    autoComplete="email"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'auth-error' : undefined}
                  />
                </div>
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
                  {submitting ? t('auth.submitting') : t('auth.forgot_submit')}
                </button>
              </>
            )
          ) : (
          <>
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
            {/* ON-3 originally warned that no reset existed at all. One does now —
                but only for accounts with an address on file, so the warning moved
                to the email field below (auth.email_hint), where it is actionable
                at the moment the user decides whether to fill it in. */}
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

          {/* Reached from login only: on signup there is no password to have
              forgotten yet, and the address hasn't been registered. */}
          {mode === 'login' && (
            <p className="text-center">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-xs text-surface-500 dark:text-surface-400 underline hover:text-brand-600 dark:hover:text-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
              >
                {t('auth.forgot_link')}
              </button>
            </p>
          )}
          </>
          )}

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
