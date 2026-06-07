import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { parseTrendSeries, getMetricSource, METRIC_EXPLANATIONS } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor, formatYtlGradeFull, parseSchools } from '../utils/formatting';
import { t, getLang, useI18nVersion } from '../utils/i18n';
import { getQualityCategory, QUALITY_CATEGORIES, QUALITY_DIMENSIONS, computeQualityCoverage } from '../utils/qualityIndex';
import { exportCsv, exportPdf } from '../utils/export';
import { TrendSection } from './TrendChart';
import Sparkline from './Sparkline';
import RadarChart from './RadarChart';
import { IsochroneControls } from './IsochroneControls';
import type { IsochroneMode } from '../utils/isochrone';
import { findSimilarNeighborhoods, AVAILABLE_SIMILARITY_METRICS } from '../utils/similarity';
import { useSimilarityMetrics } from '../hooks/useSimilarityMetrics';
import { getLayerById, type LayerId } from '../utils/colorScales';
import { histogram, percentileRank, binIndexOf } from '../utils/correlation';
import { toSlug } from '../utils/slug';
import { useNavigate } from 'react-router-dom';
import { loadAllData } from '../utils/dataLoader';
import { useAnimatedValue } from '../hooks/useAnimatedValue';
import { useBottomSheet } from '../hooks/useBottomSheet';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { trackEvent } from '../utils/analytics';
import { generateScoreCard } from '../utils/scoreCard';
import { useNotes } from '../hooks/useNotes';

interface PanelProps {
  data: NeighborhoodProperties;
  metroAverages: Record<string, number>;
  onClose: () => void;
  onPin?: (props: NeighborhoodProperties) => void;
  onUnpin?: (pno: string) => void;
  isPinned?: boolean;
  pinCount?: number;
  onCustomize?: () => void;
  isCustomWeights?: boolean;
  allFeatures?: GeoJSON.Feature[];
  /** QW-1: the active map layer, so the panel can show that metric's distribution + percentile */
  activeLayer?: LayerId;
  onFlyTo?: (center: [number, number]) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  /** QW-2: whether this area is in the user's shortlist, and a toggle */
  isInShortlist?: boolean;
  onToggleShortlist?: () => void;
  /** CF-5: custom reference-baseline pno + its name, and a setter (null clears) */
  referencePno?: string | null;
  referenceName?: string | null;
  onSetReference?: (pno: string | null) => void;
  /** CF-8: which range the Quality Index was normalized against. */
  qualityScope?: 'national' | 'region';
  /** Callback to navigate to postal code view for a metro area */
  onExploreCity?: (cityId: string) => void;
  /** Authenticated user id — enables cloud-synced notes when set */
  userId?: string | null;
  /** CF-5: travel-time isochrone controls (only when a Digitransit key is configured) */
  isochroneEnabled?: boolean;
  isochroneMode?: IsochroneMode;
  isochroneBudget?: number;
  isochroneLoading?: boolean;
  isochroneActive?: boolean;
  onIsochroneChange?: (mode: IsochroneMode, budget: number) => void;
  onIsochroneClear?: () => void;
}

/** CF-5: the per-row diff baseline label — the custom reference's name when one is
 *  active, else null so StatRow falls back to the "vs metro/region" default. */
const BaselineLabelContext = React.createContext<string | null>(null);

const StatRow: React.FC<{
  label: string;
  value: string;
  diff?: string;
  diffClass?: string;
  /** GeoJSON property name — used to look up data source attribution and explanation */
  property?: string;
  /** Optional trend data to render an inline sparkline */
  sparkline?: { data: import('../utils/metrics').TrendDataPoint[]; color?: string } | null;
}> = React.memo(({ label, value, diff, diffClass, property, sparkline }) => {
  useI18nVersion();
  // CF-5: "vs <reference>" when a custom reference baseline is active, else "vs metro".
  const baselineLabel = React.useContext(BaselineLabelContext);
  const source = property ? getMetricSource(property) : undefined;
  const hasExplanation = !!property && METRIC_EXPLANATIONS.has(property);
  // PO-2: surface regression/derived estimates honestly rather than giving them
  // the same visual weight as a direct measurement.
  const isEstimate = !!source?.isProxy;
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [tooltipPos, setTooltipPos] = useState({ shiftX: 0, flipBelow: false });
  // Per-instance id so the trigger's aria-controls can reference its popover
  // (StatRow renders many times — a hardcoded id would collide).
  const popoverId = React.useId();

  // QW-5: Close click-popover when clicking outside, or on Escape (keyboard users
  // otherwise can't dismiss it without moving focus and clicking away).
  useEffect(() => {
    if (!infoOpen) return;
    const handler = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInfoOpen(false);
        infoRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [infoOpen]);

  // Keep tooltip inside the viewport: shift horizontally if it would overflow,
  // and flip below the icon if there's no room above. Measured from the icon's
  // position so the shift is independent of the tooltip's current transform.
  useLayoutEffect(() => {
    if (!infoOpen) return;
    const icon = infoRef.current;
    const tip = tooltipRef.current;
    if (!icon || !tip) return;

    const iconRect = icon.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const padding = 8;
    const gap = 8;
    const vw = window.innerWidth;

    const iconCenterX = iconRect.left + iconRect.width / 2;
    const idealLeft = iconCenterX - tipRect.width / 2;
    const idealRight = idealLeft + tipRect.width;
    let shiftX = 0;
    if (idealLeft < padding) shiftX = padding - idealLeft;
    else if (idealRight > vw - padding) shiftX = vw - padding - idealRight;

    const flipBelow = iconRect.top - tipRect.height - gap < padding;

    setTooltipPos((prev) =>
      prev.shiftX === shiftX && prev.flipBelow === flipBelow ? prev : { shiftX, flipBelow }
    );
  }, [infoOpen]);

  return (
    <div className="flex items-center justify-between py-2.5 md:py-2">
      <span className="text-surface-500 dark:text-surface-400 text-sm flex items-center gap-1">
        {label}
        {source && (
          <span ref={infoRef} className="relative inline-flex items-center flex-shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setInfoOpen((v) => !v); }}
              aria-label={`${source.source} (${source.year})`}
              aria-expanded={infoOpen}
              aria-controls={infoOpen ? popoverId : undefined}
              className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold
                          border transition-colors flex-shrink-0 cursor-pointer
                          ${infoOpen
                            ? 'text-brand-600 border-brand-500 bg-brand-500/10'
                            : 'text-surface-400 dark:text-surface-500 border-surface-300 dark:border-surface-600 hover:text-surface-600 dark:hover:text-surface-300 hover:border-surface-400 dark:hover:border-surface-500'
                          }`}
            >
              i
            </button>
            {isEstimate && (
              <span className="ml-1 inline-flex items-center rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide
                               bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30">
                {t('data.estimate')}
              </span>
            )}
            {infoOpen && (
              <span
                ref={tooltipRef}
                id={popoverId}
                role="tooltip"
                className={`absolute left-1/2 w-64 max-w-[calc(100vw-2rem)] z-50
                           rounded-lg bg-surface-900 dark:bg-surface-800 border border-surface-700/60
                           px-3 py-2 text-left text-[11px] font-normal text-white shadow-xl leading-snug
                           whitespace-normal ${tooltipPos.flipBelow ? 'top-full mt-2' : 'bottom-full mb-2'}`}
                style={{ transform: `translateX(calc(-50% + ${tooltipPos.shiftX}px))` }}
              >
                {hasExplanation && (
                  <span className="block mb-1.5 text-white">
                    {t(`metric_explanation.${property}`)}
                  </span>
                )}
                {isEstimate && (
                  <span className="block mb-1.5 text-amber-300">
                    {t('data.estimate_desc')}
                  </span>
                )}
                <span className="block text-[10px] italic text-surface-300 dark:text-surface-400">
                  {source.source} ({source.year})
                </span>
              </span>
            )}
          </span>
        )}
      </span>
      <div className="flex items-center gap-2 text-right">
        {sparkline?.data && sparkline.data.length >= 2 && (
          <Sparkline data={sparkline.data} color={sparkline.color} />
        )}
        <span className="text-surface-900 dark:text-white font-medium">{value}</span>
        {diff && (
          <span className={`ml-0 text-xs ${diffClass}`}>
            {diff} {baselineLabel ?? t('panel.vs_metro')}
          </span>
        )}
      </div>
    </div>
  );
});
StatRow.displayName = 'StatRow';

const BarSegment: React.FC<{ label: string; value: number; total: number; color: string }> = React.memo(({
  label,
  value,
  total,
  color,
}) => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  if (pct < 1) return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-24 text-xs text-surface-500 dark:text-surface-400 flex-shrink-0">{label}</div>
      <div className="flex-1 h-4 bg-surface-200 dark:bg-surface-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-12 text-xs text-surface-600 dark:text-surface-300 text-right">{pct.toFixed(0)}%</div>
    </div>
  );
});
BarSegment.displayName = 'BarSegment';

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

// Cache Intl.NumberFormat per locale — avoids creating a new formatter on every
// stat row render (~30+ calls per panel open). Invalidated on language change.
let _panelFmtLocale = '';
let _panelFmt: Intl.NumberFormat | null = null;
function panelNumFmt(): Intl.NumberFormat {
  const loc = getLang() === 'en' ? 'en-US' : 'fi-FI';
  if (_panelFmt && _panelFmtLocale === loc) return _panelFmt;
  _panelFmtLocale = loc;
  _panelFmt = new Intl.NumberFormat(loc);
  return _panelFmt;
}

const formatDensity = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${panelNumFmt().format(n)} /km²`;
};

const formatSqm = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(1)} m²`;
};

const formatEuroSqm = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${panelNumFmt().format(n)} €/m²`;
};

const formatStopDensity = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(1)} /km²`;
};


// PO-2: Collapsible section component.
// React.memo prevents re-rendering collapsed sections when the parent re-renders
// (e.g., quality weight slider drag). With 6 collapsible sections in the panel,
// 5 are typically collapsed — skipping their subtree avoids ~60 StatRow evaluations.
const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = React.memo(({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2 cursor-pointer group"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 group-hover:text-surface-700 dark:group-hover:text-surface-200 transition-colors">
          {title}
        </h3>
        <svg
          className={`w-3.5 h-3.5 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && children}
    </div>
  );
});
CollapsibleSection.displayName = 'CollapsibleSection';

// QW-1: distribution of the active layer's metric across the loaded scope, with
// this neighbourhood's bin highlighted and its direction-aware percentile. Reuses
// the same value extraction as the choropleth (layer.property → number).
const DistributionSection: React.FC<{
  activeLayer: LayerId;
  props: NeighborhoodProperties;
  allFeatures: GeoJSON.Feature[];
}> = React.memo(({ activeLayer, props, allFeatures }) => {
  useI18nVersion();
  const layer = getLayerById(activeLayer);

  const result = useMemo(() => {
    const values: number[] = [];
    for (const f of allFeatures) {
      const raw = (f.properties as Record<string, unknown> | null)?.[layer.property];
      const v = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof v === 'number' && isFinite(v)) values.push(v);
    }
    const selfRaw = (props as Record<string, unknown>)[layer.property];
    const selfVal = typeof selfRaw === 'string' ? Number(selfRaw) : selfRaw;
    if (typeof selfVal !== 'number' || !isFinite(selfVal)) return null;
    const hist = histogram(values, 12);
    if (!hist) return null;
    return {
      hist,
      pct: percentileRank(values, selfVal),
      selfBin: binIndexOf(selfVal, hist.min, hist.max, hist.bins.length),
      n: values.length,
    };
  }, [props, allFeatures, layer.property]);

  if (!result) return null;
  const { hist, pct, selfBin, n } = result;
  const maxCount = Math.max(...hist.bins.map((b) => b.count), 1);
  // For lower-is-better metrics a high raw percentile is actually worse, so invert
  // to a consistent "better than X% of areas" reading.
  const higherIsBetter = layer.higherIsBetter !== false;
  const betterPct = pct == null ? null : Math.round(higherIsBetter ? pct : 100 - pct);

  return (
    <div className="px-4 md:px-5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
        {t('panel.distribution')} · {t(layer.labelKey)}
      </h3>
      <div className="flex items-end gap-px h-14" role="img" aria-label={t('panel.distribution')}>
        {hist.bins.map((b, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${i === selfBin ? 'bg-brand-500 dark:bg-brand-400' : 'bg-surface-200 dark:bg-surface-700'}`}
            style={{ height: `${(b.count / maxCount) * 100}%` }}
            title={`${layer.format(b.x0)} – ${layer.format(b.x1)}: ${b.count}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-surface-400 dark:text-surface-500 mt-1">
        <span>{layer.format(hist.min)}</span>
        <span>{layer.format(hist.max)}</span>
      </div>
      {betterPct != null && (
        <p className="text-sm text-surface-700 dark:text-surface-200 mt-2">
          <span className="font-semibold text-brand-600 dark:text-brand-400">
            {t('panel.dist_better_than').replace('{pct}', String(betterPct))}
          </span>{' '}
          <span className="text-surface-400 dark:text-surface-500">
            {t('panel.dist_sample').replace('{n}', String(n))}
          </span>
        </p>
      )}
    </div>
  );
});
DistributionSection.displayName = 'DistributionSection';

/**
 * Self-contained quality index badge with animated count-up.
 * Isolates ~18 animation re-renders (300ms × 60Hz) from the rest of
 * NeighborhoodPanel. Without this, each animation frame re-evaluates
 * ~1000 lines of JSX just to update a single number.
 */
/**
 * PO-1b: pick black or white text for a colored chip so it always meets WCAG AA.
 * The Quality Index badge colour ranges red→green; white text fails on the light
 * (orange/yellow) mid-scale values, so choose whichever foreground has the higher
 * contrast against the given background.
 */
function readableTextColor(bgHex: string): string {
  const c = bgHex.replace('#', '');
  if (c.length < 6) return '#ffffff';
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * lin(parseInt(c.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(c.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(c.slice(4, 6), 16));
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastDark = (L + 0.05) / 0.05;
  return contrastDark >= contrastWhite ? '#0f172a' : '#ffffff';
}

const QualityBadge: React.FC<{
  qualityIndex: number;
  isCustomWeights: boolean;
  onCustomize?: () => void;
}> = React.memo(({ qualityIndex, isCustomWeights, onCustomize }) => {
  useI18nVersion();
  const animatedQi = useAnimatedValue(qualityIndex);
  const qi = animatedQi != null ? Math.round(animatedQi) : qualityIndex;
  const cat = getQualityCategory(qi);
  const lang = getLang();
  // CF-1: "How is this calculated?" explainer popover.
  const [showHow, setShowHow] = useState(false);
  const evaluativeDims = QUALITY_DIMENSIONS.filter((d) => d.defaultWeight > 0);
  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400">
          {t('panel.quality_index')}
          {isCustomWeights && (
            <span className="ml-1 text-brand-600 dark:text-brand-400">
              ({t('custom_quality.custom_label')})
            </span>
          )}
          {/* CF-1: explainer popover */}
          <span className="relative inline-flex">
            <button
              type="button"
              onClick={() => setShowHow((v) => !v)}
              aria-label={t('quality.how_calculated')}
              aria-expanded={showHow}
              className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-surface-400 hover:text-brand-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showHow && (
              <span
                role="dialog"
                aria-label={t('quality.how_calculated')}
                className="absolute left-0 top-6 z-30 w-64 normal-case tracking-normal rounded-xl bg-white dark:bg-surface-800
                           border border-surface-200 dark:border-surface-700/50 shadow-2xl p-3 text-left"
              >
                <p className="text-[11px] font-normal text-surface-600 dark:text-surface-300 mb-2">
                  {t('quality.explainer')}
                </p>
                <ul className="space-y-0.5">
                  {evaluativeDims.map((d) => (
                    <li key={d.id} className="flex items-center justify-between text-[11px] font-normal text-surface-700 dark:text-surface-200">
                      <span>{d.label[lang]}</span>
                      <span className="tabular-nums text-surface-400 dark:text-surface-500">{d.defaultWeight}%</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] font-normal text-surface-400 dark:text-surface-500">
                  {t('quality.methodology_note')}
                </p>
              </span>
            )}
          </span>
        </h3>
        {onCustomize && (
          <button
            onClick={onCustomize}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors
              ${isCustomWeights
                ? 'bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25'
                : 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
              }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            {t('custom_quality.button')}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
          style={{ backgroundColor: cat?.color ?? '#6b7280', color: readableTextColor(cat?.color ?? '#6b7280') }}
        >
          {qi}
        </div>
        <span className="text-surface-900 dark:text-white font-semibold text-lg">
          {cat?.label[lang] ?? '—'}
        </span>
        <span className="text-surface-600 dark:text-surface-400 text-sm">
          ({cat?.min}–{cat?.max})
        </span>
      </div>
      <div className="relative">
        <div className="flex gap-0.5">
          {QUALITY_CATEGORIES.map((c) => (
            <div key={c.min} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full h-2 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="text-[9px] text-surface-600 dark:text-surface-400">{c.label[lang]}</span>
            </div>
          ))}
        </div>
        <div
          className="absolute top-0 w-4 h-4 -mt-1 rounded-full border-2 border-white dark:border-surface-300 shadow-md"
          style={{
            left: `${qi}%`,
            transform: 'translateX(-50%)',
            backgroundColor: cat?.color ?? '#6b7280',
          }}
        />
      </div>
    </div>
  );
});
QualityBadge.displayName = 'QualityBadge';

// CF-8: on-demand factor-coverage breakdown for the Quality Index — makes the
// flagship number auditable by showing how many of the evaluative factors had
// data for this specific area, grouped by dimension, with missing factors struck
// through. A low "X/Y" chip flags a confident-looking score built on few inputs.
const QualityCoverageSection: React.FC<{ props: NeighborhoodProperties; scope?: 'national' | 'region' }> = React.memo(({ props, scope = 'national' }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const lang = getLang();
  const coverage = useMemo(() => computeQualityCoverage(props), [props]);
  const dimScores = props.quality_dimension_scores ?? {};
  if (coverage.total === 0) return null;
  const pct = Math.round((coverage.present / coverage.total) * 100);
  const lowCoverage = pct < 70;

  return (
    <div className="px-4 md:px-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-1.5 group"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400 group-hover:text-surface-700 dark:group-hover:text-surface-200">
          {t('panel.quality_coverage')}
          <span
            className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold border ${
              lowCoverage
                ? 'bg-amber-400/15 text-amber-600 dark:text-amber-400 border-amber-400/30'
                : 'bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30'
            }`}
          >
            {coverage.present}/{coverage.total}
          </span>
        </span>
        <svg
          className={`w-3.5 h-3.5 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-2 space-y-2.5">
          <p className="text-[11px] leading-snug text-surface-400 dark:text-surface-500">{t('panel.quality_coverage_help')}</p>
          {/* CF-8: which national-vs-region range the score was normalized against */}
          <p className="text-[11px] leading-snug text-surface-400 dark:text-surface-500">
            <span className="text-surface-500 dark:text-surface-400">{t('panel.quality_scope_label')}:</span>{' '}
            {t(scope === 'region' ? 'panel.quality_scope_region' : 'panel.quality_scope_national')}
          </p>
          {coverage.dimensions.map((dim) => {
            const score = dimScores[dim.id];
            return (
            <div key={dim.id}>
              <div className="flex items-center justify-between text-[11px] font-medium text-surface-600 dark:text-surface-300">
                <span>
                  {dim.label[lang]}
                  {typeof score === 'number' && (
                    <span className="ml-1.5 tabular-nums text-surface-500 dark:text-surface-400">{score}/100</span>
                  )}
                </span>
                <span className="text-surface-400 dark:text-surface-500">{dim.present}/{dim.total}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {dim.factors.map((f) => (
                  <span
                    key={f.id}
                    className={`inline-flex items-center rounded px-1.5 py-px text-[10px] ${
                      f.present
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400'
                        : 'bg-transparent text-surface-300 dark:text-surface-600 line-through border border-dashed border-surface-200 dark:border-surface-700/60'
                    }`}
                    title={f.present ? undefined : t('panel.quality_factor_missing')}
                  >
                    {f.label[lang]}
                  </span>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
QualityCoverageSection.displayName = 'QualityCoverageSection';

/**
 * Self-contained notes editor that owns its own useNotes subscription.
 * Isolates typing-induced re-renders from the rest of NeighborhoodPanel.
 * Without this, every keystroke re-renders ~1000 lines of JSX (30+ StatRow
 * components, RadarChart, TrendCharts) just to update a single textarea.
 */
const NotesEditor: React.FC<{ pno: string; userId?: string | null }> = React.memo(({ pno, userId }) => {
  useI18nVersion();
  const { getNote, setNote } = useNotes(userId);
  const note = getNote(pno);
  // Track once per focus session, not on every keystroke — avoids
  // flooding the analytics endpoint during typing.
  const trackedRef = useRef(false);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
        {t('notes.title')}
      </h3>
      <textarea
        value={note}
        onChange={(e) => {
          if (!trackedRef.current) { trackEvent('add-note'); trackedRef.current = true; }
          setNote(pno, e.target.value);
        }}
        onBlur={() => { trackedRef.current = false; }}
        placeholder={t('notes.placeholder')}
        className="w-full rounded-lg bg-surface-100 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-800/50
                   p-3 text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500
                   focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 resize-y min-h-[80px]"
      />
    </div>
  );
});
NotesEditor.displayName = 'NotesEditor';

export const NeighborhoodPanel: React.FC<PanelProps> = React.memo(({ data: d, metroAverages: avg, onClose, onPin, onUnpin, isPinned, pinCount = 0, onCustomize, isCustomWeights = false, allFeatures, activeLayer, onFlyTo, isFavorite = false, onToggleFavorite, isInShortlist = false, onToggleShortlist, referencePno, referenceName, onSetReference, qualityScope = 'national', onExploreCity, userId, isochroneEnabled = false, isochroneMode = 'walk', isochroneBudget = 20, isochroneLoading = false, isochroneActive = false, onIsochroneChange, onIsochroneClear }) => {
  useI18nVersion();
  const eduTotal = useMemo(() =>
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]
      .filter((v): v is number => v != null && v > 0)
      .reduce((a, b) => a + b, 0) || 1,
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]);

  // Copy link / share state
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Clean up the "copied" feedback timer on unmount to prevent state updates after unmount
  React.useEffect(() => () => clearTimeout(copiedTimerRef.current), []);
  const handleCopyLink = useCallback(async () => {
    trackEvent('share-link');
    const url = window.location.href;

    // On mobile, prefer the native Web Share API when available
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: t('share.title'),
          text: t('share.text').replace('{name}', d.nimi ?? d.pno),
          url,
        });
        return; // Native share sheet handled it
      } catch (e) {
        // User cancelled or share failed — fall through to clipboard copy
        if (e instanceof Error && e.name === 'AbortError') return;
      }
    }

    // Fallback: copy URL to clipboard
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard access denied or unavailable */ }
  }, [d.nimi, d.pno]);

  // QW-3: Bottom sheet state (mobile only) — uses shared useBottomSheet hook
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sheetHeight, isDragging, handlers: sheetHandlers } = useBottomSheet({
    initialSnap: 'half',
    onClose,
  });

  // PO-3: Swipe navigation for mobile sections
  const MOBILE_SECTIONS = useMemo(() => [
    t('panel.tab.overview'),
    t('panel.tab.stats'),
    t('panel.tab.trends'),
    t('panel.tab.similar'),
  ] as const, []);
  const { activeSection, setActiveSection, dragOffset, isSnapping, isSwiping, handlers: swipeHandlers, onTransitionEnd } = useSwipeNavigation({
    sectionCount: MOBILE_SECTIONS.length,
  });

  // React 19 delegates touchmove as a PASSIVE listener, so swipeHandlers.onTouchMove's
  // e.preventDefault() can't actually lock vertical scroll during a horizontal swipe.
  // Attach a non-passive native listener that blocks the page scroll only once the
  // hook has committed to a horizontal swipe (isSwiping).
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => { if (isSwiping) e.preventDefault(); };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, [isSwiping]);

  const favoriteButton = onToggleFavorite && (
    <button
      onClick={() => { trackEvent(isFavorite ? 'unfavorite' : 'favorite'); onToggleFavorite(); }}
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 ${
        isFavorite
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-surface-400 hover:text-amber-500'
      }`}
      title={isFavorite ? t('favorites.remove') : t('favorites.add')}
    >
      <svg className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  );

  // CF-5: custom reference baseline state for this panel.
  const isReference = !!referencePno && referencePno === d.pno;
  const refActive = !!referencePno && !!referenceName && referencePno !== d.pno;
  const vsLabel = refActive ? t('panel.vs_reference').replace('{ref}', referenceName as string) : null;

  const referenceButton = onSetReference && !d._isMetroArea && (
    <button
      onClick={() => onSetReference(isReference ? null : d.pno)}
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 ${
        isReference ? 'text-brand-600 hover:text-brand-600' : 'text-surface-400 hover:text-brand-600'
      }`}
      title={isReference ? t('panel.clear_reference') : t('panel.set_reference')}
    >
      <svg className="w-5 h-5" fill={isReference ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    </button>
  );

  const shortlistButton = onToggleShortlist && (
    <button
      onClick={() => { trackEvent(isInShortlist ? 'shortlist-remove' : 'shortlist-add'); onToggleShortlist(); }}
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] md:min-h-0 ${
        isInShortlist ? 'text-brand-600 hover:text-brand-600' : 'text-surface-400 hover:text-brand-600'
      }`}
      title={isInShortlist ? t('shortlist.remove') : t('shortlist.add')}
    >
      <svg className="w-5 h-5" fill={isInShortlist ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    </button>
  );

  const pinButton = onPin && (
    <button
      onClick={() => { trackEvent(isPinned ? 'unpin-compare' : 'pin-compare'); if (isPinned && onUnpin) { onUnpin(d.pno); } else { onPin(d); } }}
      disabled={!isPinned && pinCount >= 3}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[44px] md:min-h-0 ${
        isPinned
          ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400'
          : pinCount >= 3
            ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
            : 'bg-brand-600 hover:bg-brand-700 text-white'
      }`}
      title={isPinned ? t('compare.pinned') : pinCount >= 3 ? t('compare.max') : t('compare.pin')}
    >
      {isPinned ? t('compare.pinned') : t('compare.pin')}
    </button>
  );

  const exportButtons = (
    <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-surface-200 dark:border-surface-800/50">
      <button
        onClick={() => { trackEvent('export-csv'); exportCsv(d, avg); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-surface-500 dark:text-surface-400
                   hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {t('export.csv')}
      </button>
      <button
        onClick={() => { trackEvent('export-pdf'); exportPdf(d, avg); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-surface-500 dark:text-surface-400
                   hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        {t('export.pdf')}
      </button>
      {/* CF-2: Share as image */}
      <button
        onClick={() => { trackEvent('export-image'); generateScoreCard(d, avg).catch(() => { /* html-to-image load failed */ }); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-brand-600 dark:text-brand-300
                   hover:bg-brand-500/10 dark:hover:bg-brand-600/15 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {t('share.image')}
      </button>
    </div>
  );

  const incomeHistory = useMemo(() => parseTrendSeries(d.income_history), [d.income_history]);
  const populationHistory = useMemo(() => parseTrendSeries(d.population_history), [d.population_history]);
  const unemploymentHistory = useMemo(() => parseTrendSeries(d.unemployment_history), [d.unemployment_history]);
  // CF-7: property-price and crime time-series.
  const propertyPriceHistory = useMemo(() => parseTrendSeries(d.property_price_history), [d.property_price_history]);
  const crimeHistory = useMemo(() => parseTrendSeries(d.crime_index_history), [d.crime_index_history]);

  // Memoize sparkline prop objects so StatRow (React.memo) doesn't re-render
  // on every panel re-render. Without this, `{ data: ..., color: '#...' }`
  // creates a new object literal each render, defeating the memo.
  const populationSparkline = useMemo(
    () => (populationHistory ? { data: populationHistory, color: '#6366f1' } : null),
    [populationHistory],
  );
  const incomeSparkline = useMemo(
    () => (incomeHistory ? { data: incomeHistory, color: '#10b981' } : null),
    [incomeHistory],
  );
  const unemploymentSparkline = useMemo(
    () => (unemploymentHistory ? { data: unemploymentHistory, color: '#f43f5e' } : null),
    [unemploymentHistory],
  );

  // CF-1: Similar neighborhoods — computed on demand when section is expanded.
  // Before: ran O(n×m) similarity (200 features × 10 metrics + sort) on every
  // neighborhood selection. The Similar section is collapsed by default, so most
  // users never see it. Now the computation only runs when the user expands it.
  const [similarExpanded, setSimilarExpanded] = useState(false);
  // CF-6: user-configurable metric set for "similar neighbourhoods".
  const { selected: similarityMetrics, toggle: toggleSimilarityMetric } = useSimilarityMetrics();
  const navigate = useNavigate();
  // CF-6b: rank similarity within the current region (default) or across all of
  // Finland. The choice is persisted like the metric set; the national dataset
  // (geometry-stripped region_properties.json) is lazy-loaded on first use.
  const [similarityScope, setSimilarityScope] = useState<'region' | 'national'>(() => {
    try { return localStorage.getItem('naapurustot-similarity-scope') === 'national' ? 'national' : 'region'; }
    catch { return 'region'; }
  });
  const setScope = useCallback((s: 'region' | 'national') => {
    setSimilarityScope(s);
    try { localStorage.setItem('naapurustot-similarity-scope', s); } catch { /* ignore */ }
  }, []);
  const [nationalFeatures, setNationalFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [nationalLoading, setNationalLoading] = useState(false);
  useEffect(() => {
    if (!similarExpanded || similarityScope !== 'national' || nationalFeatures || nationalLoading) return;
    setNationalLoading(true);
    loadAllData()
      .then((res) => setNationalFeatures(res.data.features))
      .catch(() => { /* national similarity unavailable — toggle back to region */ })
      .finally(() => setNationalLoading(false));
  }, [similarExpanded, similarityScope, nationalFeatures, nationalLoading]);

  const scopeFeatures = similarityScope === 'national' ? nationalFeatures : allFeatures;
  const similar = useMemo(() => {
    if (!similarExpanded || !scopeFeatures) return [];
    const metrics = AVAILABLE_SIMILARITY_METRICS
      .map((m) => m.key)
      .filter((k) => similarityMetrics.has(k as string));
    return findSimilarNeighborhoods(d, scopeFeatures, 5, metrics);
  }, [similarExpanded, d, scopeFeatures, similarityMetrics]);

  // CF-6b: open a national result. Its centre is unavailable (region_properties is
  // geometry-stripped), so navigate to its profile page rather than fly the map.
  const openNationalResult = useCallback((props: NeighborhoodProperties) => {
    const slug = toSlug(props.pno, props.nimi || props.namn || props.pno);
    const lang = getLang();
    const base = lang === 'en' ? '/en/area/' : lang === 'sv' ? '/sv/omrade/' : '/alue/';
    navigate(`${base}${slug}/`);
  }, [navigate]);

  // PO-3: Shared section content — used by both desktop and mobile
  const sectionOverview = (
    <>
      {/* CF-5: active reference baseline banner */}
      {refActive && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-3 py-2 text-xs">
          <span className="text-brand-700 dark:text-brand-300">{t('panel.compared_to').replace('{ref}', referenceName as string)}</span>
          <button onClick={() => onSetReference?.(null)} className="shrink-0 text-brand-600 dark:text-brand-400 font-semibold hover:underline">
            {t('panel.clear_reference')}
          </button>
        </div>
      )}
      {/* Quality Index — extracted into QualityBadge to isolate animation re-renders */}
      {d.quality_index != null && (
        <QualityBadge
          qualityIndex={d.quality_index}
          isCustomWeights={isCustomWeights}
          onCustomize={onCustomize}
        />
      )}

      {/* CF-8: Quality Index auditability — factor coverage for this area */}
      {d.quality_index != null && <QualityCoverageSection props={d} scope={qualityScope} />}

      {/* CF-5: travel-time isochrone controls (real neighborhoods only; needs a Digitransit key) */}
      {isochroneEnabled && !d._isMetroArea && onIsochroneChange && onIsochroneClear && (
        <IsochroneControls
          mode={isochroneMode}
          budget={isochroneBudget}
          loading={isochroneLoading}
          active={isochroneActive}
          onChange={onIsochroneChange}
          onClear={onIsochroneClear}
        />
      )}

      {/* Key stats */}
      <div>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.population')}
            value={formatNumber(d.he_vakiy)}
            property="he_vakiy"
            sparkline={populationSparkline}
          />
          <StatRow
            label={t('panel.median_income')}
            value={formatEuro(d.hr_mtu)}
            diff={formatDiff(d.hr_mtu, avg.hr_mtu)}
            diffClass={diffColor(d.hr_mtu, avg.hr_mtu)}
            property="hr_mtu"
            sparkline={incomeSparkline}
          />
          <StatRow
            label={t('panel.unemployment')}
            value={formatPct(d.unemployment_rate)}
            diff={formatDiff(d.unemployment_rate, avg.unemployment_rate)}
            diffClass={diffColor(d.unemployment_rate, avg.unemployment_rate, false)}
            property="unemployment_rate"
            sparkline={unemploymentSparkline}
          />
          <StatRow
            label={t('panel.foreign_lang')}
            value={formatPct(d.foreign_language_pct)}
            property="foreign_language_pct"
          />
        </div>
      </div>

      {/* Education breakdown */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.education')}
        </h3>
        <BarSegment label={t('panel.higher_edu')} value={d.ko_yl_kork ?? 0} total={eduTotal} color="#a78bfa" />
        <BarSegment label={t('panel.bachelor')} value={d.ko_al_kork ?? 0} total={eduTotal} color="#818cf8" />
        <BarSegment label={t('panel.vocational')} value={d.ko_ammat ?? 0} total={eduTotal} color="#6366f1" />
        <BarSegment label={t('panel.basic')} value={d.ko_perus ?? 0} total={eduTotal} color="#4f46e5" />
      </div>

      {/* Activity status */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.age_distribution')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t('panel.employed'), value: d.pt_tyoll, color: 'bg-emerald-500' },
            { label: t('panel.unemployed'), value: d.pt_tyott, color: 'bg-rose-500' },
            { label: t('panel.students'), value: d.pt_opisk, color: 'bg-amber-500' },
            { label: t('panel.pensioners'), value: d.pt_elakel, color: 'bg-blue-500' },
          ].map((item) => (
            <div key={item.label} className="bg-surface-100 dark:bg-surface-900/60 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${item.color}`} />
                <span className="text-xs text-surface-500 dark:text-surface-400">{item.label}</span>
              </div>
              <span className="text-lg font-semibold text-surface-900 dark:text-white">{formatNumber(item.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CF-4: Radar chart */}
      <RadarChart data={d} metroAverages={avg} />

      {/* QW-1: distribution + percentile of the active layer's metric across the loaded scope */}
      {activeLayer && allFeatures && allFeatures.length > 1 && (
        <DistributionSection activeLayer={activeLayer} props={d} allFeatures={allFeatures} />
      )}
    </>
  );

  const sectionStats = (
    <>
      {/* Housing section — PO-2: collapsible, default open */}
      <CollapsibleSection title={t('panel.housing')} defaultOpen>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.ownership_rate')}
            value={formatPct(d.ownership_rate)}
            diff={formatDiff(d.ownership_rate, avg.ownership_rate)}
            diffClass={diffColor(d.ownership_rate, avg.ownership_rate)}
            property="ownership_rate"
          />
          <StatRow
            label={t('panel.rental_rate')}
            value={formatPct(d.rental_rate)}
            property="rental_rate"
          />
          <StatRow
            label={t('panel.avg_apt_size')}
            value={formatSqm(d.ra_as_kpa)}
            diff={formatDiff(d.ra_as_kpa, avg.ra_as_kpa)}
            diffClass={diffColor(d.ra_as_kpa, avg.ra_as_kpa)}
            property="ra_as_kpa"
          />
          <StatRow
            label={t('panel.detached_houses')}
            value={formatPct(d.detached_house_share)}
            property="detached_house_share"
          />
          <StatRow
            label={t('panel.rental_price')}
            value={d.rental_price_sqm != null ? `${Number(d.rental_price_sqm).toFixed(2)} €/m²/kk` : '—'}
            diff={formatDiff(d.rental_price_sqm, avg.rental_price_sqm)}
            diffClass={diffColor(d.rental_price_sqm, avg.rental_price_sqm, false)}
            property="rental_price_sqm"
          />
          <StatRow
            label={t('panel.price_to_rent')}
            value={d.price_to_rent_ratio != null ? `${Number(d.price_to_rent_ratio).toFixed(1)} v` : '—'}
            diff={formatDiff(d.price_to_rent_ratio, avg.price_to_rent_ratio)}
            diffClass={diffColor(d.price_to_rent_ratio, avg.price_to_rent_ratio, false)}
            property="price_to_rent_ratio"
          />
          <StatRow
            label={t('panel.building_age')}
            value={d.avg_construction_year != null ? `${Math.round(Number(d.avg_construction_year))}` : '—'}
            diff={formatDiff(d.avg_construction_year, avg.avg_construction_year)}
            diffClass={diffColor(d.avg_construction_year, avg.avg_construction_year)}
            property="avg_construction_year"
          />
          <StatRow label={t('panel.dwellings')} value={formatNumber(d.ra_asunn)} />
          <StatRow label={t('panel.households')} value={formatNumber(d.te_taly)} />
        </div>
      </CollapsibleSection>

      {/* Demographics section — PO-2: collapsible */}
      <CollapsibleSection title={t('panel.demographics')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.population_density')}
            value={formatDensity(d.population_density)}
            diff={formatDiff(d.population_density, avg.population_density)}
            diffClass={diffColor(d.population_density, avg.population_density)}
            property="population_density"
          />
          <StatRow
            label={t('panel.child_ratio')}
            value={formatPct(d.child_ratio)}
            diff={formatDiff(d.child_ratio, avg.child_ratio)}
            diffClass={diffColor(d.child_ratio, avg.child_ratio)}
            property="child_ratio"
          />
          <StatRow
            label={t('panel.student_share')}
            value={formatPct(d.student_share)}
            diff={formatDiff(d.student_share, avg.student_share)}
            diffClass={diffColor(d.student_share, avg.student_share)}
            property="student_share"
          />
          <StatRow
            label={t('panel.elderly_ratio')}
            value={formatPct(d.elderly_ratio_pct)}
            diff={formatDiff(d.elderly_ratio_pct, avg.elderly_ratio_pct)}
            diffClass={diffColor(d.elderly_ratio_pct, avg.elderly_ratio_pct)}
            property="elderly_ratio_pct"
          />
          <StatRow
            label={t('panel.employment_rate')}
            value={formatPct(d.employment_rate)}
            diff={formatDiff(d.employment_rate, avg.employment_rate)}
            diffClass={diffColor(d.employment_rate, avg.employment_rate)}
            property="employment_rate"
          />
          <StatRow
            label={t('panel.avg_household_size')}
            value={d.avg_household_size != null ? `${Number(d.avg_household_size).toFixed(2)}` : '—'}
            diff={formatDiff(d.avg_household_size, avg.avg_household_size)}
            diffClass={diffColor(d.avg_household_size, avg.avg_household_size)}
            property="avg_household_size"
          />
        </div>
      </CollapsibleSection>

      {/* Quality of Life section — PO-2: collapsible */}
      <CollapsibleSection title={t('panel.quality_of_life')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.property_price')}
            value={formatEuroSqm(d.property_price_sqm)}
            diff={formatDiff(d.property_price_sqm, avg.property_price_sqm)}
            diffClass={diffColor(d.property_price_sqm, avg.property_price_sqm)}
            property="property_price_sqm"
          />
          <StatRow
            label={t('panel.property_price_change')}
            value={d.property_price_change_pct != null ? `${Number(d.property_price_change_pct) >= 0 ? '+' : ''}${Number(d.property_price_change_pct).toFixed(1)} %` : '—'}
            diff={formatDiff(d.property_price_change_pct, avg.property_price_change_pct)}
            diffClass={diffColor(d.property_price_change_pct, avg.property_price_change_pct)}
            property="property_price_change_pct"
          />
          <StatRow
            label={t('panel.transit_access')}
            value={formatStopDensity(d.transit_stop_density)}
            diff={formatDiff(d.transit_stop_density, avg.transit_stop_density)}
            diffClass={diffColor(d.transit_stop_density, avg.transit_stop_density)}
            property="transit_stop_density"
          />
          <StatRow
            label={t('panel.air_quality')}
            value={d.air_quality_index != null ? Number(d.air_quality_index).toFixed(1) : '—'}
            diff={formatDiff(d.air_quality_index, avg.air_quality_index)}
            diffClass={diffColor(d.air_quality_index, avg.air_quality_index, false)}
            property="air_quality_index"
          />
          <StatRow
            label={t('panel.crime_rate')}
            value={d.crime_index != null ? `${Number(d.crime_index).toFixed(1)} /1000` : '—'}
            diff={formatDiff(d.crime_index, avg.crime_index)}
            diffClass={diffColor(d.crime_index, avg.crime_index, false)}
            property="crime_index"
          />
          <StatRow
            label={t('panel.walkability')}
            value={d.walkability_index != null ? `${Number(d.walkability_index).toFixed(0)}/100` : '—'}
            diff={formatDiff(d.walkability_index, avg.walkability_index)}
            diffClass={diffColor(d.walkability_index, avg.walkability_index)}
            property="walkability_index"
          />
          <StatRow
            label={t('panel.traffic_accidents')}
            value={d.traffic_accident_rate != null ? `${Number(d.traffic_accident_rate).toFixed(1)} /1000` : '—'}
            diff={formatDiff(d.traffic_accident_rate, avg.traffic_accident_rate)}
            diffClass={diffColor(d.traffic_accident_rate, avg.traffic_accident_rate, false)}
            property="traffic_accident_rate"
          />
          <StatRow
            label={t('panel.light_pollution')}
            value={d.light_pollution != null ? `${Number(d.light_pollution).toFixed(1)} nW/cm²/sr` : '—'}
            diff={formatDiff(d.light_pollution, avg.light_pollution)}
            diffClass={diffColor(d.light_pollution, avg.light_pollution, false)}
            property="light_pollution"
          />
          <StatRow
            label={t('panel.noise_pollution')}
            value={d.noise_pollution != null ? `${Number(d.noise_pollution).toFixed(1)} dB` : '—'}
            diff={formatDiff(d.noise_pollution, avg.noise_pollution)}
            diffClass={diffColor(d.noise_pollution, avg.noise_pollution, false)}
            property="noise_pollution"
          />
          <StatRow
            label={t('panel.water_proximity')}
            value={d.water_proximity_m != null ? `${panelNumFmt().format(Number(d.water_proximity_m))} m` : '—'}
            diff={formatDiff(d.water_proximity_m, avg.water_proximity_m)}
            diffClass={diffColor(d.water_proximity_m, avg.water_proximity_m, false)}
            property="water_proximity_m"
          />
          <StatRow
            label={t('panel.tree_canopy')}
            value={d.tree_canopy_pct != null ? `${Number(d.tree_canopy_pct).toFixed(1)} %` : '—'}
            diff={formatDiff(d.tree_canopy_pct, avg.tree_canopy_pct)}
            diffClass={diffColor(d.tree_canopy_pct, avg.tree_canopy_pct)}
            property="tree_canopy_pct"
          />
        </div>
      </CollapsibleSection>

      {/* Services section — PO-2: collapsible */}
      <CollapsibleSection title={t('layers.services')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.restaurant_density')}
            value={formatStopDensity(d.restaurant_density)}
            diff={formatDiff(d.restaurant_density, avg.restaurant_density)}
            diffClass={diffColor(d.restaurant_density, avg.restaurant_density)}
            property="restaurant_density"
          />
          <StatRow
            label={t('panel.grocery_access')}
            value={formatStopDensity(d.grocery_density)}
            diff={formatDiff(d.grocery_density, avg.grocery_density)}
            diffClass={diffColor(d.grocery_density, avg.grocery_density)}
            property="grocery_density"
          />
          <StatRow
            label={t('panel.daycare_density')}
            value={formatStopDensity(d.daycare_density)}
            diff={formatDiff(d.daycare_density, avg.daycare_density)}
            diffClass={diffColor(d.daycare_density, avg.daycare_density)}
            property="daycare_density"
          />
          <StatRow
            label={t('panel.school_density')}
            value={formatStopDensity(d.school_density)}
            diff={formatDiff(d.school_density, avg.school_density)}
            diffClass={diffColor(d.school_density, avg.school_density)}
            property="school_density"
          />
          <StatRow
            label={t('panel.school_quality')}
            value={formatYtlGradeFull(d.school_quality_score)}
            diff={formatDiff(d.school_quality_score, avg.school_quality_score)}
            diffClass={diffColor(d.school_quality_score, avg.school_quality_score)}
            property="school_quality_score"
          />
          {(() => {
            const schools = parseSchools(d.schools);
            if (!schools || schools.length === 0) return null;
            return (
              <ul className="pl-4 pb-2.5 md:pb-2 space-y-1 text-xs text-surface-500 dark:text-surface-400">
                {schools.map((s) => (
                  <li key={s.name} className="flex justify-between gap-3">
                    <span className="truncate">{s.name}</span>
                    <span className="font-medium tabular-nums text-surface-700 dark:text-surface-300">
                      {formatYtlGradeFull(s.score)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
          <StatRow
            label={t('panel.sports_facilities')}
            value={d.sports_facility_density != null ? `${Number(d.sports_facility_density).toFixed(1)} /km²` : '—'}
            diff={formatDiff(d.sports_facility_density, avg.sports_facility_density)}
            diffClass={diffColor(d.sports_facility_density, avg.sports_facility_density)}
            property="sports_facility_density"
          />
          <StatRow
            label={t('panel.healthcare_access')}
            value={formatStopDensity(d.healthcare_density)}
            diff={formatDiff(d.healthcare_density, avg.healthcare_density)}
            diffClass={diffColor(d.healthcare_density, avg.healthcare_density)}
            property="healthcare_density"
          />
        </div>
      </CollapsibleSection>

      {/* Mobility section — PO-2: collapsible */}
      <CollapsibleSection title={t('layers.mobility')}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.cycling_infra')}
            value={formatStopDensity(d.cycling_density)}
            diff={formatDiff(d.cycling_density, avg.cycling_density)}
            diffClass={diffColor(d.cycling_density, avg.cycling_density)}
            property="cycling_density"
          />
        </div>
      </CollapsibleSection>

      {/* Additional demographics — PO-2: collapsible */}
      <CollapsibleSection title={`${t('layers.demographics')} +`}>
        <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
          <StatRow
            label={t('panel.single_person_hh')}
            value={formatPct(d.single_person_hh_pct)}
            property="single_person_hh_pct"
          />
          <StatRow
            label={t('panel.new_construction')}
            value={formatPct(d.new_construction_pct)}
            diff={formatDiff(d.new_construction_pct, avg.new_construction_pct)}
            diffClass={diffColor(d.new_construction_pct, avg.new_construction_pct)}
            property="new_construction_pct"
          />
          <StatRow
            label={t('panel.manufacturing_jobs')}
            value={formatPct(d.manufacturing_jobs_pct)}
            diff={formatDiff(d.manufacturing_jobs_pct, avg.manufacturing_jobs_pct)}
            diffClass={diffColor(d.manufacturing_jobs_pct, avg.manufacturing_jobs_pct)}
            property="manufacturing_jobs_pct"
          />
          <StatRow
            label={t('panel.public_sector_jobs')}
            value={formatPct(d.public_sector_jobs_pct)}
            diff={formatDiff(d.public_sector_jobs_pct, avg.public_sector_jobs_pct)}
            diffClass={diffColor(d.public_sector_jobs_pct, avg.public_sector_jobs_pct)}
            property="public_sector_jobs_pct"
          />
          <StatRow
            label={t('panel.service_sector_jobs')}
            value={formatPct(d.service_sector_jobs_pct)}
            diff={formatDiff(d.service_sector_jobs_pct, avg.service_sector_jobs_pct)}
            diffClass={diffColor(d.service_sector_jobs_pct, avg.service_sector_jobs_pct)}
            property="service_sector_jobs_pct"
          />
        </div>
      </CollapsibleSection>

      {/* Extra stats */}
      <div className="divide-y divide-surface-200 dark:divide-surface-800/50">
        <StatRow label={t('panel.avg_income')} value={formatEuro(d.hr_ktu)} property="hr_ktu" />
      </div>
    </>
  );

  const sectionTrends = (
    <TrendSection
      incomeData={incomeHistory}
      populationData={populationHistory}
      unemploymentData={unemploymentHistory}
      propertyPriceData={propertyPriceHistory}
      crimeData={crimeHistory}
    />
  );

  const sectionSimilar = (
    <>
      {/* CF-4: Neighborhood Notes — self-contained to isolate keystroke re-renders */}
      <NotesEditor pno={d.pno} userId={userId} />

      {/* CF-1: Similar neighborhoods — on-demand computation */}
      {allFeatures && allFeatures.length > 0 && (
        <div>
          <button
            onClick={() => { setSimilarExpanded((v) => { if (!v) trackEvent('similar-neighborhoods'); return !v; }); }}
            className="w-full flex items-center justify-between py-2 cursor-pointer group"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 group-hover:text-surface-700 dark:group-hover:text-surface-200 transition-colors">
              {t('panel.similar')}
            </h3>
            <svg
              className={`w-3.5 h-3.5 text-surface-400 dark:text-surface-500 transition-transform duration-200 ${similarExpanded ? '' : '-rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {similarExpanded && (
            <div className="space-y-2">
              {/* CF-6: choose which metrics define "similar" */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">
                  {t('panel.similar_by')}
                </div>
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_SIMILARITY_METRICS.map((m) => {
                    const on = similarityMetrics.has(m.key as string);
                    return (
                      <button
                        key={m.key as string}
                        onClick={() => toggleSimilarityMetric(m.key as string)}
                        aria-pressed={on}
                        className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                          on
                            ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300 border-brand-500/40'
                            : 'bg-surface-100 dark:bg-surface-900/60 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-700/50 hover:border-surface-300 dark:hover:border-surface-600'
                        }`}
                      >
                        {t(m.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* CF-6b: rank within this region or across all of Finland */}
              {!d._isMetroArea && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">
                    {t('panel.similar_scope_label')}
                  </div>
                  <div className="flex gap-1">
                    {(['region', 'national'] as const).map((sc) => (
                      <button
                        key={sc}
                        onClick={() => setScope(sc)}
                        aria-pressed={similarityScope === sc}
                        className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                          similarityScope === sc
                            ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300 border-brand-500/40'
                            : 'bg-surface-100 dark:bg-surface-900/60 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-700/50 hover:border-surface-300 dark:hover:border-surface-600'
                        }`}
                      >
                        {t(sc === 'region' ? 'panel.similar_scope_region' : 'panel.similar_scope_national')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {similarityScope === 'national' && nationalLoading && !nationalFeatures ? (
                <div className="px-3 py-2.5 text-xs text-surface-400 dark:text-surface-500">{t('loading')}</div>
              ) : (
                similar.map((s) => {
                  const national = similarityScope === 'national';
                  return (
                    <button
                      key={s.properties.pno}
                      onClick={() => (national ? openNationalResult(s.properties) : onFlyTo?.(s.center))}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg
                                 bg-surface-100 dark:bg-surface-900/60 hover:bg-surface-200 dark:hover:bg-surface-800
                                 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-surface-900 dark:text-white">{s.properties.nimi}</span>
                        <span className="text-xs text-surface-400 ml-1.5">{s.properties.pno}</span>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-surface-500 shrink-0">
                        {((1 - s.distance) * 100).toFixed(0)}%
                        {national && (
                          <svg className="w-3 h-3 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  // PO-3: Array of mobile section content fragments.
  // Only mount sections that have been visited (active or previously swiped to).
  // This defers rendering ~60+ DOM elements for hidden tabs until the user actually
  // swipes to them, cutting panel open time significantly on mobile.
  const [visitedSections, setVisitedSections] = useState<Set<number>>(() => new Set([0]));
  // biome-ignore lint: activeSection tracked via effect
  React.useEffect(() => {
    setVisitedSections((prev) => {
      if (prev.has(activeSection)) return prev;
      const next = new Set(prev);
      next.add(activeSection);
      return next;
    });
  }, [activeSection]);
  const mobileSectionDefs = [sectionOverview, sectionStats, sectionTrends, sectionSimilar];
  const mobileSections = mobileSectionDefs.map((section, i) =>
    visitedSections.has(i) ? section : null
  );

  const exploreButton = d._isMetroArea && onExploreCity ? (
    <button
      onClick={() => onExploreCity(d.city as string)}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                 bg-brand-500/10 hover:bg-brand-500/20 text-brand-600 dark:text-brand-400
                 font-medium text-sm transition-colors border border-brand-500/20"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
      {t('panel.explore_postal_codes')}
    </button>
  ) : null;

  const panelContent = d._noData ? (
    // CF-5 Phase D: a seutukunta with no ingested data — the panel still opens
    // (consistent with data regions), it just shows a clean empty state.
    <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
      <svg className="w-10 h-10 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-surface-500 dark:text-surface-400 text-sm max-w-[260px]">
        {t('panel.no_data_region')}
      </p>
    </div>
  ) : (
    <div className="px-6 py-4 space-y-6">
      {exploreButton}
      {sectionOverview}
      {/* Profile page link */}
      {!d._isMetroArea && (
        <a
          href={`/alue/${toSlug(d.pno, d.nimi)}/`}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl
                     bg-surface-100 dark:bg-surface-900/60 hover:bg-surface-200 dark:hover:bg-surface-800
                     text-sm font-medium text-surface-600 dark:text-surface-300 transition-colors"
        >
          {t('profile.view_full')}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </a>
      )}
      {sectionTrends}
      {sectionStats}
      {sectionSimilar}
    </div>
  );

  return (
    <BaselineLabelContext.Provider value={vsLabel}>
    <>
      {/* Desktop: side panel */}
      <div className="hidden md:block absolute top-0 left-0 z-20 h-full w-[380px] max-w-[90vw] overflow-y-auto
                      bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl border-r border-surface-200 dark:border-surface-800/50 shadow-2xl">
        {/* Header — backdrop-blur-sm (not -xl): this sticky bar re-rasterizes its
            backdrop on every scroll frame as opaque panel content scrolls under it.
            The 95%-opaque bg already reads as solid, so a smaller blur radius keeps
            the frosted look while cutting per-scroll-frame GPU work. */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-950/95 backdrop-blur-sm border-b border-surface-200 dark:border-surface-800/50 px-6 py-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h2 className="text-xl font-display font-bold text-surface-900 dark:text-white break-words min-w-0">{d.nimi}</h2>
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 flex-shrink-0"
                  title={t('panel.copy_link')}
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  )}
                </button>
                {copied && (
                  <span className="text-xs text-emerald-500 font-medium animate-fade-in">{t('panel.copied')}</span>
                )}
              </div>
              {!d._isMetroArea && <p className="text-surface-500 dark:text-surface-400 text-sm mt-0.5">{d.pno}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label={t('aria.close')}
              title={t('aria.close')}
              className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {(favoriteButton || shortlistButton || referenceButton || pinButton) && (
            <div className="flex items-center gap-1 mt-3">
              {favoriteButton}
              {shortlistButton}
              {referenceButton}
              {pinButton}
            </div>
          )}
        </div>
        {panelContent}
        {exportButtons}
      </div>

      {/* Mobile: bottom sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed bottom-0 left-0 right-0 z-20
                   bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                   border-t border-surface-200 dark:border-surface-800/50
                   shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl flex flex-col overflow-hidden"
        style={{
          height: sheetHeight,
          transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={sheetHandlers.onTouchStart}
          onTouchMove={sheetHandlers.onTouchMove}
          onTouchEnd={sheetHandlers.onTouchEnd}
          onTouchCancel={sheetHandlers.onTouchCancel}
        >
          <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h2 className="text-lg font-display font-bold text-surface-900 dark:text-white break-words min-w-0">{d.nimi}</h2>
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 flex-shrink-0"
                  title={t('panel.copy_link')}
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  )}
                </button>
                {copied && (
                  <span className="text-xs text-emerald-500 font-medium">{t('panel.copied')}</span>
                )}
              </div>
              {!d._isMetroArea && <p className="text-surface-500 dark:text-surface-400 text-xs">{d.pno}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label={t('aria.close')}
              title={t('aria.close')}
              className="p-2.5 -mr-1 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {(favoriteButton || pinButton) && (
            <div className="flex items-center gap-1 mt-2">
              {favoriteButton}
              {pinButton}
            </div>
          )}
        </div>
        {/* PO-3: Section tabs */}
        <div className="flex px-5 pt-3 pb-1 gap-1">
          {MOBILE_SECTIONS.map((label, i) => (
            <button
              key={i}
              onClick={() => setActiveSection(i)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeSection === i
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Dot indicators */}
        <div className="flex justify-center gap-1.5 py-1.5">
          {MOBILE_SECTIONS.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                activeSection === i
                  ? 'bg-brand-500'
                  : 'bg-surface-300 dark:bg-surface-600'
              }`}
            />
          ))}
        </div>

        {/* PO-3: Swipeable section content — horizontal carousel */}
        <div
          ref={swipeContainerRef}
          className="overflow-hidden flex-1 min-h-0"
          onTouchStart={swipeHandlers.onTouchStart}
          onTouchMove={swipeHandlers.onTouchMove}
          onTouchEnd={swipeHandlers.onTouchEnd}
          onTouchCancel={swipeHandlers.onTouchCancel}
        >
          <div
            className="flex h-full"
            style={{
              transform: `translateX(calc(-${activeSection * 100}% + ${dragOffset}px))`,
              transition: isSnapping ? 'transform 400ms cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
              willChange: 'transform',
            }}
            onTransitionEnd={onTransitionEnd}
          >
            {mobileSections.map((section, i) => (
              <div
                key={i}
                className={`w-full flex-shrink-0 ${isSwiping ? 'overflow-hidden' : 'overflow-y-auto'}`}
                style={{ minWidth: '100%' }}
              >
                <div className="px-6 py-4 space-y-6">
                  {i === 0 && exploreButton}
                  {section}
                  {section && exportButtons}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* QW-2: Toast notification for clipboard copy */}
      {copied && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50
                       px-4 py-2 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900
                       text-sm font-medium shadow-lg animate-fade-in">
          {t('panel.copied')}
        </div>
      )}
    </>
    </BaselineLabelContext.Provider>
  );
});

NeighborhoodPanel.displayName = 'NeighborhoodPanel';
