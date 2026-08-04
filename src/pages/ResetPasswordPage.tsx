import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { t, getLang, setLang, useI18nVersion, type Lang } from '../utils/i18n';
import { api } from '../utils/api';

/**
 * Landing page for the link in a password-reset email
 * (`/uusi-salasana/?token=…&lang=…`).
 *
 * Why one path for all three languages, and why a real directory route:
 * `public/404.html` is the GitHub Pages SPA fallback, and it redirects any
 * unknown path to `/` while KEEPING ONLY the query string — so a client-only
 * route would drop `/uusi-salasana` and strand the user on the map with a
 * dangling `?token=`. The path therefore has to exist as prerendered HTML (see
 * scripts/prerender.mjs), and the cheapest way to keep that to a single file is
 * to carry the language in a query param rather than minting three routes.
 *
 * Deliberately NOT signed in on success: redeeming the token proves control of
 * the mailbox, not knowledge of the account, so the server issues no cookie and
 * this page sends the user to the normal login form.
 */

const INPUT_CLASS =
  'w-full px-3 py-2.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow';

const MIN_PASSWORD_LENGTH = 12;

function readParam(name: string): string {
  try {
    return new URLSearchParams(window.location.search).get(name) ?? '';
  } catch {
    return '';
  }
}

export const ResetPasswordPage: React.FC = () => {
  // Read once on mount: the token never changes while the page is open, and
  // re-reading on each render would fight the history.replaceState below.
  const token = useMemo(() => readParam('token'), []);
  const langParam = useMemo(() => {
    const value = readParam('lang');
    return value === 'en' || value === 'sv' || value === 'fi' ? (value as Lang) : null;
  }, []);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // The email carries the language the request was made in; honour it so the
  // page doesn't switch to Finnish for someone who asked in English.
  useEffect(() => {
    if (langParam && getLang() !== langParam) void setLang(langParam);
  }, [langParam]);
  useI18nVersion();

  useEffect(() => {
    document.title = `${t('reset.title')} | naapurustot.fi`;
  }, []);

  // Strip the token from the address bar once it has been captured. It stays
  // usable (it lives in component state), but it no longer sits in the visible
  // URL to be shoulder-surfed, copied into a bug report, or pushed to history —
  // and any Referer leak to a third party now carries no token.
  useEffect(() => {
    if (!token) return;
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch { /* history unavailable */ }
  }, [token]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (password !== confirmPassword) {
      setError(t('auth.passwords_no_match'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.error.password_too_short'));
      return;
    }

    setSubmitting(true);
    const { error: err } = await api.resetPassword(token, password);
    setSubmitting(false);

    if (err) setError(err);
    else setDone(true);
  }, [token, password, confirmPassword, submitting]);

  return (
    <main className="min-h-screen bg-surface-50 dark:bg-surface-950 text-surface-800 dark:text-surface-200">
      <div className="mx-auto max-w-md px-5 py-12">
        <Link to="/" className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
          {t('sources.back_to_map')}
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-surface-900 dark:text-white">
          {t('reset.title')}
        </h1>

        {/* A missing token means the link was truncated by a mail client or the
            page was opened directly — say so instead of showing a form that is
            guaranteed to fail on submit. */}
        {!token ? (
          <div className="mt-6 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
            <p className="text-sm leading-relaxed">{t('reset.no_token')}</p>
            <Link to="/" className="mt-2 inline-block text-sm text-brand-600 dark:text-brand-400 hover:underline">
              {t('reset.back_to_login')}
            </Link>
          </div>
        ) : done ? (
          <div className="mt-6">
            <div role="status" className="rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-4 py-3">
              <p className="text-sm leading-relaxed">{t('reset.success')}</p>
            </div>
            {/* The reset revoked every existing session for this account, so
                other devices need a fresh sign-in with the new password. */}
            <p className="mt-3 text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
              {t('reset.success_sessions')}
            </p>
            <Link
              to="/"
              className="mt-5 block w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('reset.back_to_login')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
              {t('reset.intro')}
            </p>

            <div>
              <label htmlFor="reset-password" className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                {t('reset.new_password')}
              </label>
              <div className="relative">
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={`${INPUT_CLASS} pr-10`}
                  autoComplete="new-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'reset-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={t('auth.show_password')}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-r-lg"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {showPassword ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              <p className="mt-1 text-[11px] text-surface-500 dark:text-surface-400">
                {t('reset.password_hint')}
              </p>
            </div>

            <div>
              <label htmlFor="reset-confirm" className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                {t('auth.confirm_password')}
              </label>
              <input
                id="reset-confirm"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={INPUT_CLASS}
                autoComplete="new-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'reset-error' : undefined}
              />
            </div>

            <div role="alert" aria-live="assertive">
              {error && (
                <p id="reset-error" className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {submitting ? t('auth.submitting') : t('reset.submit')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
};

export default ResetPasswordPage;
