import React, { useMemo } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { isCustomWizardAnswers, type WizardAnswers } from '../hooks/useWizardProfile';
import { computeNationalFit, fitToneClasses } from '../utils/fitScore';
import { t, useI18nVersion } from '../utils/i18n';

interface FitForYouBadgeProps {
  data: NeighborhoodProperties;
  /** The user's saved priority profile (localStorage / cloud). */
  profile: WizardAnswers | null | undefined;
  /** Open the Neighborhood Finder to set/adjust priorities (in-app surfaces). */
  onSetPriorities?: () => void;
  /** Link target for the CTA when there is no in-app setter (profile page → /?finder=1). */
  ctaHref?: string;
  /** 'pill' is the compact inline chip (panel); 'banner' is the profile-page card. */
  variant?: 'pill' | 'banner';
  className?: string;
}

const TargetIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 0V3m0 18v-5m4-4h5M3 12h5" />
  </svg>
);

/**
 * "Fit for you" — a persistent per-area match score against the user's saved priority
 * profile, computed with the stable national ranges so the % reads the same on the
 * panel, the profile page and the comparison. When no custom profile is saved it
 * renders a CTA to set priorities instead; with a profile it shows the score and
 * (in-app) re-opens the Finder to adjust.
 */
export const FitForYouBadge: React.FC<FitForYouBadgeProps> = ({
  data, profile, onSetPriorities, ctaHref, variant = 'pill', className = '',
}) => {
  useI18nVersion();
  const hasProfile = !!profile && isCustomWizardAnswers(profile);
  const fit = useMemo(
    () => (hasProfile && profile ? computeNationalFit(data, profile) : null),
    [hasProfile, profile, data],
  );

  const reasonsTitle = fit && fit.reasons.length > 0
    ? `${t('fit.tooltip')} — ${fit.reasons.join(', ')}`
    : t('fit.tooltip');

  // ─── Banner (profile page) ───────────────────────────────────────────────
  if (variant === 'banner') {
    if (fit) {
      const tone = fitToneClasses(fit.score);
      return (
        <a
          href={ctaHref ?? '/?finder=1'}
          className={`flex items-center gap-4 rounded-xl bg-surface-100 dark:bg-surface-900/60 p-6 hover:bg-surface-200/70 dark:hover:bg-surface-800/60 transition-colors ${className}`}
          title={reasonsTitle}
        >
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-bold text-xl ${tone.bg} ${tone.text}`}>
            {fit.score}
          </div>
          <div className="min-w-0">
            <div className="text-xl font-semibold">{t('fit.label')}</div>
            <div className="text-surface-500 dark:text-surface-400 text-sm">{t('fit.adjust')} →</div>
          </div>
        </a>
      );
    }
    return (
      <a
        href={ctaHref ?? '/?finder=1'}
        className={`flex items-center gap-4 rounded-xl border border-dashed border-surface-300 dark:border-surface-700 p-6 hover:border-brand-500/60 hover:bg-surface-50 dark:hover:bg-surface-900/40 transition-colors ${className}`}
      >
        <div className="w-14 h-14 rounded-xl flex items-center justify-center bg-brand-500/10 text-brand-700 dark:text-brand-300">
          <TargetIcon className="w-7 h-7" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold">{t('fit.cta')}</div>
          <div className="text-surface-500 dark:text-surface-400 text-sm">{t('fit.tooltip')} →</div>
        </div>
      </a>
    );
  }

  // ─── Pill (panel) ────────────────────────────────────────────────────────
  if (fit) {
    const tone = fitToneClasses(fit.score);
    const content = (
      <>
        <TargetIcon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium">{t('fit.label')}</span>
        <span className="font-bold tabular-nums">{fit.score}%</span>
      </>
    );
    const base = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ${tone.bg} ${tone.text} ${tone.ring} ${className}`;
    return onSetPriorities ? (
      <button
        type="button"
        onClick={onSetPriorities}
        title={`${reasonsTitle} · ${t('fit.adjust')}`}
        aria-label={`${t('fit.label')}: ${fit.score}% — ${t('fit.adjust')}`}
        className={`${base} transition-colors hover:brightness-95 dark:hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60`}
      >
        {content}
      </button>
    ) : (
      <span className={base} title={reasonsTitle} aria-label={`${t('fit.label')}: ${fit.score}%`}>
        {content}
      </span>
    );
  }

  // Pill CTA (no saved profile) — subtle, opens the Finder.
  const ctaBase = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60';
  return onSetPriorities ? (
    <button type="button" onClick={onSetPriorities} className={`${ctaBase} ${className}`}>
      <TargetIcon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-medium">{t('fit.cta')}</span>
    </button>
  ) : (
    <a href={ctaHref ?? '/?finder=1'} className={`${ctaBase} ${className}`}>
      <TargetIcon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-medium">{t('fit.cta')}</span>
    </a>
  );
};

export default FitForYouBadge;
