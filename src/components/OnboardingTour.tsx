import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { t } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';

interface OnboardingTourProps {
  onComplete: () => void;
  /** When true, omit the sign-in step (user is already authenticated). */
  skipAuthStep?: boolean;
}

interface Step {
  /** Anchor's data-tour-id, or null for a centered welcome step. */
  anchor: string | null;
  titleKey: string;
  bodyKey: string;
  /** Optional extra body line (e.g. the click-hint on the welcome step). */
  hintKey?: string;
}

const ALL_STEPS: Step[] = [
  { anchor: null, titleKey: 'onboarding.welcome.title', bodyKey: 'onboarding.welcome.body', hintKey: 'onboarding.click_hint' },
  { anchor: 'layers', titleKey: 'onboarding.layers.title', bodyKey: 'onboarding.layers.body' },
  { anchor: 'search', titleKey: 'onboarding.search.title', bodyKey: 'onboarding.search.body' },
  { anchor: 'tools', titleKey: 'onboarding.tools.title', bodyKey: 'onboarding.tools.body' },
  { anchor: 'auth', titleKey: 'onboarding.auth.title', bodyKey: 'onboarding.auth.body' },
];

const POPOVER_W = 320;
const POPOVER_PAD = 16;
const SPOTLIGHT_PAD = 6;

/** Picks the first visible element matching the tour-id (the chrome has duplicate
 *  anchors for desktop vs mobile breakpoints; one is hidden via CSS). */
function findVisibleAnchor(id: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-id="${id}"]`);
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete, skipAuthStep = false }) => {
  const steps = useMemo(
    () => (skipAuthStep ? ALL_STEPS.filter((s) => s.anchor !== 'auth') : ALL_STEPS),
    [skipAuthStep],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const completedRef = useRef(false);

  // Track tour start once on mount
  useEffect(() => {
    trackEvent('onboarding', { action: 'start' });
  }, []);

  const finish = useCallback((reason: 'completed' | 'skipped') => {
    if (completedRef.current) return;
    completedRef.current = true;
    trackEvent('onboarding', { action: reason, step: stepIndex });
    onComplete();
  }, [onComplete, stepIndex]);

  // Resolve target rect when step or viewport changes. The chrome may not be
  // mounted on the first paint of step 1, so retry briefly via rAF.
  useEffect(() => {
    if (!step.anchor) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const tryFind = () => {
      if (cancelled) return;
      const el = findVisibleAnchor(step.anchor!);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else if (attempts++ < 30) {
        raf = requestAnimationFrame(tryFind);
      } else {
        // Anchor never appeared — fall through with no spotlight rather than blocking the tour.
        setTargetRect(null);
      }
    };
    tryFind();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [step.anchor, viewport.w, viewport.h]);

  // Track viewport changes (resize, orientation) so the spotlight + popover follow.
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Keyboard nav: Escape skips, ArrowRight/Enter next, ArrowLeft back.
  // Stop propagation so the App-level Escape handler doesn't also fire and close
  // unrelated panels behind the tour.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish('skipped');
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLast) finish('completed');
        else setStepIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isFirst) setStepIndex((i) => i - 1);
      }
    };
    // Capture phase so we beat the App-level Escape handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [finish, isFirst, isLast]);

  const popoverWidth = Math.min(POPOVER_W, viewport.w - POPOVER_PAD * 2);

  // Position the popover near the target, or center it when there's no anchor.
  // Vertical placement: prefer below the target, flip above when there isn't room.
  const popoverPos = useMemo(() => {
    if (!targetRect) {
      return {
        top: viewport.h / 2,
        left: viewport.w / 2 - popoverWidth / 2,
        translateY: '-50%',
      };
    }
    const centerX = targetRect.left + targetRect.width / 2;
    const left = clamp(centerX - popoverWidth / 2, POPOVER_PAD, viewport.w - popoverWidth - POPOVER_PAD);
    const spaceBelow = viewport.h - targetRect.bottom;
    const spaceAbove = targetRect.top;
    // Need ~220px for the card. If below has room, prefer it; else flip.
    if (spaceBelow >= 240 || spaceBelow > spaceAbove) {
      return { top: targetRect.bottom + POPOVER_PAD, left, translateY: '0' };
    }
    return { top: targetRect.top - POPOVER_PAD, left, translateY: '-100%' };
  }, [targetRect, viewport.w, viewport.h, popoverWidth]);

  const stepCounter = t('onboarding.step_of')
    .replace('{n}', String(stepIndex + 1))
    .replace('{total}', String(steps.length));

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {/* Spotlight: a positioned element whose huge outset box-shadow dims everything outside the target.
          When there is no target (welcome step), fall back to a uniform backdrop. */}
      {targetRect ? (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: targetRect.top - SPOTLIGHT_PAD,
            left: targetRect.left - SPOTLIGHT_PAD,
            width: targetRect.width + SPOTLIGHT_PAD * 2,
            height: targetRect.height + SPOTLIGHT_PAD * 2,
            borderRadius: 14,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
            transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease',
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/65" />
      )}

      {/* Click-blocker — catches clicks outside the popover so users use Next/Back/Skip.
          Sits below the popover but above the spotlight. */}
      <button
        type="button"
        aria-label={t('onboarding.skip')}
        onClick={() => finish('skipped')}
        className="absolute inset-0 w-full h-full cursor-default"
        style={{ background: 'transparent' }}
      />

      {/* Popover card */}
      <div
        className="absolute rounded-2xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-700/40 p-5"
        style={{
          top: popoverPos.top,
          left: popoverPos.left,
          width: popoverWidth,
          transform: `translateY(${popoverPos.translateY})`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
            {stepCounter}
          </span>
          <button
            onClick={() => finish('skipped')}
            className="text-[11px] font-medium text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
          >
            {t('onboarding.skip')}
          </button>
        </div>
        <h3 id="onboarding-title" className="text-base font-display font-bold text-surface-900 dark:text-white mb-2">
          {t(step.titleKey)}
        </h3>
        <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
          {t(step.bodyKey)}
        </p>
        {step.hintKey && (
          <p className="mt-3 text-xs text-surface-500 dark:text-surface-400 italic">
            {t(step.hintKey)}
          </p>
        )}

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? 'w-6 bg-brand-500' : 'w-1.5 bg-surface-300 dark:bg-surface-600'
              }`}
            />
          ))}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between mt-4 gap-2">
          <button
            onClick={() => setStepIndex((i) => i - 1)}
            disabled={isFirst}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-surface-500 dark:text-surface-400
                       hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800
                       disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          >
            {t('onboarding.back')}
          </button>
          <button
            onClick={() => {
              if (isLast) finish('completed');
              else setStepIndex((i) => i + 1);
            }}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-colors"
          >
            {isLast ? t('onboarding.finish') : t('onboarding.next')}
          </button>
        </div>
      </div>
    </div>
  );
};

OnboardingTour.displayName = 'OnboardingTour';
