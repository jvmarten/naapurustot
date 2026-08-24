import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t, getLang, useI18nVersion } from '../utils/i18n';
import { api, type ApiUser, type LightningPlan } from '../utils/api';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface SupporterModalProps {
  user: ApiUser | null;
  onClose: () => void;
  /** Re-pull GET /auth/me (the entitlement is written by an async Stripe webhook). */
  onRefresh: () => void;
  /** Close this and open the sign-in modal — a subscription needs an account. */
  onNeedLogin: () => void;
  /** True when opened via the `?supporter=success` return from Checkout. */
  justSubscribed?: boolean;
}

/**
 * Supporter (paid tier) upgrade + management modal. Lazy-loaded from App, so its code
 * lands off the first paint — though, like every non-/live/ chunk, it still counts
 * against the map bundle budget.
 *
 * The heavy lifting is server-side and Stripe-side: this only redirects the browser to
 * a Stripe-hosted Checkout Session (new subscription) or the customer portal (manage an
 * existing one). Card data, 3DS/SCA and the payment UI never touch this static site.
 *
 * Copy is deliberately honest — a supporter subscription funds the free, open project
 * and grants a badge; it does not gate the map, its data, or any existing feature.
 */
export const SupporterModal: React.FC<SupporterModalProps> = ({ user, onClose, onRefresh, onNeedLogin, justSubscribed }) => {
  useI18nVersion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lnPlans, setLnPlans] = useState<LightningPlan[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const isSupporter = Boolean(user?.supporter);

  // Fetch the Bitcoin/Lightning plans (empty unless a provider + prices are configured
  // server-side). Only when signed in — an anonymous visitor gets the sign-in prompt first.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getLightningPlans().then(({ data }) => {
      if (!cancelled && data?.configured) setLnPlans(data.plans ?? []);
    });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  // Redirect to a Stripe-hosted URL (Checkout or the customer portal).
  const go = useCallback(async (kind: 'checkout' | 'portal') => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = kind === 'checkout' ? await api.startCheckout() : await api.openBillingPortal();
      if (data?.url) { window.location.href = data.url; return; } // full-page redirect to Stripe
      setError(err ?? t('supporter.error.checkout_failed'));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Redirect to the provider's hosted Bitcoin/Lightning invoice for a prepaid plan.
  const goLightning = useCallback(async (plan: 'month' | 'year') => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await api.startLightningCheckout(plan);
      if (data?.url) { window.location.href = data.url; return; }
      setError(err ?? t('supporter.error.checkout_failed'));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // The Bitcoin/Lightning plan buttons — one per configured plan, each showing its price
  // and window. A prepaid one-off (no auto-renew), so it is offered as an alternative to the
  // Stripe subscription and as a way for an existing Lightning supporter to top up.
  const lightningBlock = lnPlans.length > 0 && (
    <div className="pt-1">
      <p className="text-xs font-medium text-surface-500 dark:text-surface-400 text-center mb-2">{t('supporter.cta.lightning')}</p>
      <div className="flex gap-2">
        {lnPlans.map((p) => (
          <button
            key={p.id}
            onClick={() => goLightning(p.id)}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-500/40 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition active:scale-[.99] disabled:opacity-50"
          >
            {(p.amountEurCents / 100).toLocaleString(getLang(), { style: 'currency', currency: 'EUR' })}
            {' · '}{t(`supporter.plan.${p.id}`)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-surface-400 dark:text-surface-500 text-center">{t('supporter.lightning.note')}</p>
    </div>
  );

  // The supporter-until line from the ISO date, formatted in the active locale. A Stripe
  // subscription auto-renews ("Renews …"); a prepaid Lightning window does not, so it reads
  // "PRO until …" — the honest distinction the server's supporterRenews flag carries.
  let renews: string | null = null;
  if (isSupporter && user?.supporterUntil) {
    const d = new Date(user.supporterUntil);
    if (!Number.isNaN(d.getTime())) {
      const label = user?.supporterRenews === false ? t('supporter.status.until') : t('supporter.status.renews');
      renews = `${label} ${d.toLocaleDateString(getLang(), { year: 'numeric', month: 'long', day: 'numeric' })}`;
    }
  }

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
        aria-label={t('supporter.title')}
        tabIndex={-1}
        className="w-full max-w-sm mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700/40 overflow-hidden max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="h-1 bg-gradient-to-r from-brand-500 to-brand-400" aria-hidden="true" />
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200 dark:border-surface-700/40">
          <span className="text-base font-semibold tracking-tight text-surface-900 dark:text-white">{t('supporter.title')}</span>
          <button
            onClick={onClose}
            aria-label={t('aria.close')}
            className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Already a supporter → thank-you + manage. */}
          {isSupporter ? (
            <>
              <div className="text-center">
                <p className="text-base font-semibold text-brand-700 dark:text-brand-300">{t('supporter.status.active')}</p>
                {renews && <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">{renews}</p>}
              </div>
              {/* A Stripe subscriber manages/cancels via the portal; a prepaid Lightning
                  supporter has nothing to manage but can top up their window instead. */}
              {user?.supporterRenews ? (
                <button
                  onClick={() => go('portal')}
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-sm hover:shadow transition active:scale-[.99] disabled:opacity-50"
                >
                  {busy ? t('supporter.redirecting') : t('supporter.cta.manage')}
                </button>
              ) : lightningBlock}
            </>
          ) : justSubscribed ? (
            // Returned from a successful Checkout, but the webhook may not have landed
            // yet — say so honestly and offer a refresh rather than showing the pitch.
            <>
              <p className="text-sm text-surface-700 dark:text-surface-300">{t('supporter.status.activating')}</p>
              <button
                onClick={onRefresh}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-sm hover:shadow transition active:scale-[.99]"
              >
                {t('supporter.status.refresh')}
              </button>
            </>
          ) : (
            <>
              <ul className="space-y-2">
                {['supporter.benefit.fund', 'supporter.benefit.badge', 'supporter.benefit.early'].map((k) => (
                  <li key={k} className="flex items-start gap-2.5 text-sm text-surface-700 dark:text-surface-300">
                    <span className="flex items-center justify-center w-5 h-5 shrink-0 mt-px rounded-full bg-brand-50 dark:bg-brand-500/15">
                      <svg className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </span>
                    <span>{t(k)}</span>
                  </li>
                ))}
              </ul>
              <div className="text-center">
                <p className="text-2xl font-bold tracking-tight text-surface-900 dark:text-white">{t('supporter.price')}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">{t('supporter.price_note')}</p>
              </div>
              {user ? (
                <button
                  onClick={() => go('checkout')}
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-sm hover:shadow transition active:scale-[.99] disabled:opacity-50"
                >
                  {busy ? t('supporter.redirecting') : t('supporter.cta.subscribe')}
                </button>
              ) : (
                <>
                  <p className="text-xs text-surface-500 dark:text-surface-400 text-center">{t('supporter.need_account')}</p>
                  <button
                    onClick={onNeedLogin}
                    className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-sm hover:shadow transition active:scale-[.99]"
                  >
                    {t('supporter.cta.login')}
                  </button>
                </>
              )}
              {/* Prepaid Bitcoin/Lightning alternative to the Stripe subscription (shown only
                  when signed in and a provider is configured server-side). */}
              {user && lightningBlock}
            </>
          )}

          <div role="alert" aria-live="assertive">
            {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
