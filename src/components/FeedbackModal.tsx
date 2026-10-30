import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t, getLang } from '../utils/i18n';
import { api } from '../utils/api';
import { Turnstile } from './Turnstile';
import { useFocusTrap } from '../hooks/useFocusTrap';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const CONTACT_EMAIL = 'info@naapurustot.fi';
/** Mirrors the server's MAX_MESSAGE_LENGTH (server/api/src/feedback.ts). */
const MAX_MESSAGE = 4000;

const INPUT = `w-full px-3 py-2 rounded-lg text-sm bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700
  text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500`;

/**
 * "Send feedback" form: one message (and an optional reply address) emailed to the
 * site inbox by POST /feedback. Nothing is stored. When the backend can't deliver,
 * the error names the address to write to instead, so feedback is never lost to a
 * dead form.
 */
export const FeedbackModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [includePage, setIncludePage] = useState(true);
  const [token, setToken] = useState('');
  const [tokenKey, setTokenKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    (panelRef.current?.querySelector<HTMLElement>('textarea') ?? panelRef.current)?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Keep App's window-level Escape from also closing what is under the modal.
      e.stopImmediatePropagation();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !message.trim()) return;
    if (TURNSTILE_SITE_KEY && !token) {
      setError(t('auth.error.bot_check_loading'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await api.sendFeedback({
      message,
      email: email.trim() || undefined,
      page: includePage ? window.location.href : undefined,
      lang: getLang(),
      turnstileToken: token,
    });
    setSubmitting(false);
    if (res.error) {
      // A token is single-use: mint a fresh one for the retry.
      setToken('');
      setTokenKey((k) => k + 1);
      setError(res.error);
    } else {
      setSent(true);
    }
  }, [submitting, message, email, includePage, token]);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        tabIndex={-1}
        className="w-full max-w-sm mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="flex items-center border-b border-surface-200 dark:border-surface-700/40">
          <h2 id="feedback-title" className="flex-1 px-4 py-3.5 text-sm font-semibold text-surface-900 dark:text-white">
            {t('feedback.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('aria.close')}
            className="px-3 py-3.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="p-4 space-y-3" role="status">
            <p className="text-sm text-surface-700 dark:text-surface-200">{t('feedback.sent')}</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white"
            >
              {t('aria.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">{t('feedback.message')}</span>
              <textarea
                required
                rows={5}
                maxLength={MAX_MESSAGE}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={`${INPUT} resize-y`}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">{t('feedback.email')}</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300">
              <input type="checkbox" checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} />
              {t('feedback.include_page')}
            </label>
            <Turnstile key={tokenKey} onToken={setToken} />
            {error && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error} {t('feedback.fallback').replace('{email}', CONTACT_EMAIL)}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !message.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            >
              {submitting ? t('feedback.sending') : t('feedback.send')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
