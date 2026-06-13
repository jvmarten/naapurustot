import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { t, useI18nVersion, type Lang } from '../utils/i18n';
import { trackEvent } from '../utils/analytics';
import { LanguagePicker } from './LanguagePicker';

interface OnboardingTourProps {
  onComplete: () => void;
  /** When true, omit the sign-in step (user is already authenticated). */
  skipAuthStep?: boolean;
  /** T5: current UI language + setter, so a first-time visitor can switch from the
   *  Finnish default to EN/SV from the welcome step without exiting the tour. */
  lang?: Lang;
  onLangChange?: (lang: Lang) => void | Promise<void>;
}

interface Step {
  /** data-tour-ids to spotlight. Empty array = centered welcome step.
   *  Popover positions relative to the union bounding box of all anchors,
   *  so two anchors on opposite sides of the header get a popover centered
   *  between them rather than skewed to one side. */
  anchors: string[];
  titleKey: string;
  bodyKey: string;
  /** Optional extra body line (e.g. the click-hint on the welcome step). */
  hintKey?: string;
}

const ALL_STEPS: Step[] = [
  { anchors: [], titleKey: 'onboarding.welcome.title', bodyKey: 'onboarding.welcome.body', hintKey: 'onboarding.click_hint' },
  { anchors: ['layers'], titleKey: 'onboarding.layers.title', bodyKey: 'onboarding.layers.body' },
  { anchors: ['search', 'cities'], titleKey: 'onboarding.search.title', bodyKey: 'onboarding.search.body' },
  { anchors: ['tools'], titleKey: 'onboarding.tools.title', bodyKey: 'onboarding.tools.body' },
  { anchors: ['auth'], titleKey: 'onboarding.auth.title', bodyKey: 'onboarding.auth.body' },
];

const POPOVER_W = 320;
const POPOVER_PAD = 16;
const SPOTLIGHT_PAD = 6;
const SPOTLIGHT_RADIUS = 14;

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

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onComplete, skipAuthStep = false, lang, onLangChange }) => {
  // T5: re-render the tour when the language switches (and when the lazy en/sv
  // dictionary arrives, replacing the Finnish fallback) — the tour is the contract-
  // correct subscriber rather than relying on App's re-render.
  useI18nVersion();
  const steps = useMemo(
    () => (skipAuthStep ? ALL_STEPS.filter((s) => !s.anchors.includes('auth')) : ALL_STEPS),
    [skipAuthStep],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<DOMRect[]>([]);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const completedRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Track tour start once on mount
  useEffect(() => {
    trackEvent('onboarding', { action: 'start' });
  }, []);

  // A11y: move focus into the popover on open and restore it to the triggering
  // element on close, so keyboard/screen-reader users aren't left behind the modal.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    popoverRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  const finish = useCallback((reason: 'completed' | 'skipped') => {
    if (completedRef.current) return;
    completedRef.current = true;
    trackEvent('onboarding', { action: reason, step: stepIndex });
    onComplete();
  }, [onComplete, stepIndex]);

  // Resolve target rects for all anchors. The chrome may not be mounted on
  // the first paint of step 1, so retry briefly via rAF. Bail after 30 frames
  // with whatever resolved — better than blocking the tour entirely if one
  // anchor is missing (e.g. a future viewport-conditional anchor).
  useEffect(() => {
    if (step.anchors.length === 0) {
      setTargetRects([]);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const tryFind = () => {
      if (cancelled) return;
      const rects: DOMRect[] = [];
      for (const id of step.anchors) {
        const el = findVisibleAnchor(id);
        if (el) rects.push(el.getBoundingClientRect());
      }
      if (rects.length === step.anchors.length || attempts++ >= 30) {
        setTargetRects(rects);
      } else {
        raf = requestAnimationFrame(tryFind);
      }
    };
    tryFind();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [step.anchors, viewport.w, viewport.h]);

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
      } else if (e.key === 'Tab') {
        // Trap Tab within the popover (Skip/Back/Next + top-right skip buttons).
        const root = popoverRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Capture phase so we beat the App-level Escape handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [finish, isFirst, isLast]);

  const popoverWidth = Math.min(POPOVER_W, viewport.w - POPOVER_PAD * 2);

  // Union bbox of all anchors — popover positions relative to this so that
  // multi-anchor steps (search + cities) get a popover centered between the
  // highlights rather than skewed to one side.
  const unionRect = useMemo(() => {
    if (targetRects.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of targetRects) {
      if (r.left < minX) minX = r.left;
      if (r.top < minY) minY = r.top;
      if (r.right > maxX) maxX = r.right;
      if (r.bottom > maxY) maxY = r.bottom;
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY };
  }, [targetRects]);

  // Position the popover near the target union, or center it when there's no anchor.
  // Vertical placement: prefer below the target, flip above when there isn't room.
  const popoverPos = useMemo(() => {
    if (!unionRect) {
      return {
        top: viewport.h / 2,
        left: viewport.w / 2 - popoverWidth / 2,
        translateY: '-50%',
      };
    }
    const centerX = unionRect.left + unionRect.width / 2;
    const left = clamp(centerX - popoverWidth / 2, POPOVER_PAD, viewport.w - popoverWidth - POPOVER_PAD);
    const spaceBelow = viewport.h - unionRect.bottom;
    const spaceAbove = unionRect.top;
    // Need ~220px for the card. If below has room, prefer it; else flip.
    if (spaceBelow >= 240 || spaceBelow > spaceAbove) {
      return { top: unionRect.bottom + POPOVER_PAD, left, translateY: '0' };
    }
    return { top: unionRect.top - POPOVER_PAD, left, translateY: '-100%' };
  }, [unionRect, viewport.w, viewport.h, popoverWidth]);

  const stepCounter = t('onboarding.step_of')
    .replace('{n}', String(stepIndex + 1))
    .replace('{total}', String(steps.length));

  // SVG mask id needs to change per step so multiple steps don't share state
  // across remounts. Using stepIndex is sufficient since only one mask is live.
  const maskId = `onboarding-mask-${stepIndex}`;

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {/* SVG mask cuts rounded holes through the dark backdrop for every anchor.
          Stacked box-shadow spotlights would overlap-dim each other's holes; an
          SVG mask is the only clean way to support N cutouts in one backdrop. */}
      {targetRects.length > 0 ? (
        <svg
          aria-hidden="true"
          className="absolute top-0 left-0 pointer-events-none"
          width={viewport.w}
          height={viewport.h}
        >
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {targetRects.map((r, i) => (
                <rect
                  key={i}
                  x={r.left - SPOTLIGHT_PAD}
                  y={r.top - SPOTLIGHT_PAD}
                  width={r.width + SPOTLIGHT_PAD * 2}
                  height={r.height + SPOTLIGHT_PAD * 2}
                  rx={SPOTLIGHT_RADIUS}
                  ry={SPOTLIGHT_RADIUS}
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.65)" mask={`url(#${maskId})`} />
        </svg>
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/65" />
      )}

      {/* Click-blocker — catches clicks outside the popover. O1: a click here
          (the natural reaction to a bright spotlight) ADVANCES the tour rather
          than permanently skipping it; only the explicit Skip/Finish buttons end
          it for good. Sits below the popover but above the spotlight. */}
      <button
        type="button"
        aria-label={t('onboarding.next')}
        onClick={() => {
          if (isLast) finish('completed');
          else setStepIndex((i) => i + 1);
        }}
        className="absolute inset-0 w-full h-full cursor-default"
        style={{ background: 'transparent' }}
      />

      {/* Popover card */}
      <div
        ref={popoverRef}
        tabIndex={-1}
        className="absolute rounded-2xl bg-white dark:bg-surface-900 shadow-2xl border border-surface-200 dark:border-surface-700/40 p-5 outline-none"
        style={{
          top: popoverPos.top,
          left: popoverPos.left,
          width: popoverWidth,
          transform: `translateY(${popoverPos.translateY})`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
            {stepCounter}
          </span>
          <button
            onClick={() => finish('skipped')}
            className="text-[11px] font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 transition-colors"
          >
            {t('onboarding.skip')}
          </button>
        </div>
        <h2 id="onboarding-title" className="text-base font-display font-bold text-surface-900 dark:text-white mb-2">
          {t(step.titleKey)}
        </h2>
        <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
          {t(step.bodyKey)}
        </p>
        {step.hintKey && (
          <p className="mt-3 text-xs text-surface-500 dark:text-surface-400 italic">
            {t(step.hintKey)}
          </p>
        )}

        {/* T5: language choice on the welcome step. Buttons render inside popoverRef,
            so the existing Tab focus-trap includes them and the outside-click-advance
            won't fire on them. Switching keeps the current step — translations swap in
            place. */}
        {isFirst && lang && onLangChange && (
          <div className="mt-4">
            <LanguagePicker lang={lang} onLangChange={onLangChange} />
          </div>
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
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand-700 hover:bg-brand-800 text-white transition-colors"
          >
            {isLast ? t('onboarding.finish') : t('onboarding.next')}
          </button>
        </div>

        {/* Reassure users they can reopen the tour later — last step only. */}
        {isLast && (
          <p className="mt-3 text-xs text-surface-500 dark:text-surface-400 italic">
            {t('onboarding.reopen_note')}
          </p>
        )}
      </div>
    </div>
  );
};

OnboardingTour.displayName = 'OnboardingTour';
