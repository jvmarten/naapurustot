import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t } from '../utils/i18n';
import { Turnstile } from './Turnstile';

interface AuthModalProps {
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<string | null>;
  onSignup: (username: string, password: string, turnstileToken: string, email?: string, displayName?: string) => Promise<string | null>;
}

const INPUT_CLASS = 'w-full px-3 py-2.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow';

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onLogin, onSignup }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setError(t('auth.passwords_no_match'));
      return;
    }

    setSubmitting(true);

    const err = mode === 'login'
      ? await onLogin(username, password)
      : await onSignup(username, password, turnstileToken, email || undefined);

    setSubmitting(false);
    if (err) {
      setError(err);
    } else {
      onClose();
    }
  }, [mode, username, password, confirmPassword, email, turnstileToken, onLogin, onSignup, onClose]);

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
      <div className="w-full max-w-sm mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Tab header */}
        <div className="flex items-center border-b border-surface-200 dark:border-surface-700/40">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-3.5 text-sm font-semibold text-center transition-colors relative
              ${mode === 'login'
                ? 'text-surface-900 dark:text-white'
                : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300'}`}
          >
            {t('auth.login')}
            {mode === 'login' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-3.5 text-sm font-semibold text-center transition-colors relative
              ${mode === 'signup'
                ? 'text-surface-900 dark:text-white'
                : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300'}`}
          >
            {t('auth.signup')}
            {mode === 'signup' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-5 space-y-4">
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
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={INPUT_CLASS}
              placeholder={t('auth.password_placeholder')}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {/* Signup-only fields */}
          {mode === 'signup' && (
            <>
              {/* Confirm password */}
              <div>
                <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                  {t('auth.confirm_password')}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder={t('auth.confirm_password_placeholder')}
                  autoComplete="new-password"
                />
              </div>

              {/* Optional email */}
              <div>
                <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1.5">
                  {t('auth.email')} <span className="font-normal text-surface-400 dark:text-surface-500">({t('auth.optional')})</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder={t('auth.email_placeholder')}
                />
                <p className="mt-1 text-[11px] text-surface-400 dark:text-surface-500">{t('auth.email_hint')}</p>
              </div>

              {/* Turnstile */}
              <Turnstile onToken={setTurnstileToken} />
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? t('auth.submitting')
              : mode === 'login' ? t('auth.login') : t('auth.signup')}
          </button>
        </form>
      </div>
    </div>
  );
};
