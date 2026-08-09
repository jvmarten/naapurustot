import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import type { NeighborhoodProperties } from '../utils/metrics';
import { parseTrendSeries, getMetricSource, vintageFreshness, METRIC_EXPLANATIONS, formatCoveragePct } from '../utils/metrics';
import { formatNumber, formatEuro, formatPct, formatDiff, diffColor, formatYtlGradeFull, parseSchools, formatDensity, formatEuroSqm } from '../utils/formatting';
import { t, getLang, useI18nVersion } from '../utils/i18n';
import { getQualityCategory, getQualityCategories, getQualityBandPosition, QUALITY_DIMENSIONS, computeQualityCoverage, type QualityWeights } from '../utils/qualityIndex';
import { usePlanningArea, planningInfo } from '../hooks/usePlanningData';
import { computeAreaSummary, fillTemplate } from '../utils/areaSummary';
import { loadNationalPercentiles, type NationalLadder } from '../utils/nationalRanges';
import { exportCsv, exportPdf, exportGeoJson, exportJson } from '../utils/export';
import { TrendSection } from './TrendChart';
import Sparkline from './Sparkline';
import RadarChart from './RadarChart';
import { IsochroneControls } from './IsochroneControls';
import type { IsochroneMode } from '../utils/isochrone';
import { findSimilarNeighborhoods, AVAILABLE_SIMILARITY_METRICS, SIMILARITY_WEIGHT_MIN, SIMILARITY_WEIGHT_MAX, SIMILARITY_WEIGHT_DEFAULT } from '../utils/similarity';
import { resolveNeighborPnos } from '../utils/adjacency';
import { getFeatureCenter } from '../utils/geometryFilter';
import { getLayerById, getInterpolatedColor, rampGradientCss, readableTextColor, type LayerId } from '../utils/colorScales';
import { histogram, percentileRank, binIndexOf } from '../utils/correlation';
import { toSlug } from '../utils/slug';
import { useNavigate } from 'react-router-dom';
import { loadAllData } from '../utils/dataLoader';
import { useAnimatedValue } from '../hooks/useAnimatedValue';
import { useBottomSheet } from '../hooks/useBottomSheet';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { trackEvent } from '../utils/analytics';
import { generateScoreCard } from '../utils/scoreCard';
import { useNotes } from '../hooks/useNotes';
import { FitForYouBadge } from './FitForYouBadge';
import type { WizardAnswers } from '../hooks/useWizardProfile';

/** QW-5: per-language profile-page path so EN/SV users reach the localized URL
 *  (/en/area/, /sv/omrade/) instead of the Finnish /alue/ one. Shared by the panel's
 *  "view full profile" link and the national-result navigation. */
function profileHref(pno: string, name: string): string {
  const lang = getLang();
  const base = lang === 'en' ? '/en/area/' : lang === 'sv' ? '/sv/omrade/' : '/alue/';
  return `${base}${toSlug(pno, name)}/`;
}

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
  /** CF-1: the live Quality-Index weights, so the auditability chip enumerates the
   *  factors actually contributing to the displayed (possibly custom-weighted) score. */
  qualityWeights?: QualityWeights;
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
  /** E1: true when the last isochrone fetch failed (network/HTTP) — drives an error + retry row */
  isochroneError?: boolean;
  isochroneActive?: boolean;
  onIsochroneChange?: (mode: IsochroneMode, budget: number) => void;
  onIsochroneClear?: () => void;
  /** CF-5: per-metric similarity weights (0–3) + controls, owned by App for URL sync. */
  similarityWeights?: Record<string, number>;
  onSimilarityWeightChange?: (key: string, value: number) => void;
  onSimilarityToggle?: (key: string) => void;
  /** T1: the selected area's seutukunta (sub-region) averages — used as a display-only
   *  fallback for housing/rent price when the area has no own value. */
  regionPriceAverages?: Record<string, number> | null;
  /** T1: the selected area's seutukunta display name, shown in the fallback disclaimer. */
  regionName?: string;
  /** "Fit for you": the user's saved priority profile, so the header can show a
   *  match score for this area (or a CTA to set priorities when none is saved). */
  wizardProfile?: WizardAnswers | null;
  /** Open the Neighborhood Finder (from the Fit-for-you badge/CTA). */
  onOpenWizard?: () => void;
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
  /** T1: the displayed value is the seutukunta (sub-region) average because this area
   *  has no own value — render a "Seutuarvio" badge + disclaimer. */
  subregionEstimate?: boolean;
  /** T1: the sub-region's display name, interpolated into the disclaimer. */
  subregionName?: string;
}> = React.memo(({ label, value, diff, diffClass, property, sparkline, subregionEstimate, subregionName }) => {
  useI18nVersion();
  // CF-5: "vs <reference>" when a custom reference baseline is active, else "vs metro".
  const baselineLabel = React.useContext(BaselineLabelContext);
  const source = property ? getMetricSource(property) : undefined;
  const hasExplanation = !!property && METRIC_EXPLANATIONS.has(property);
  // PO-2: surface regression/derived estimates honestly rather than giving them
  // the same visual weight as a direct measurement.
  const isEstimate = !!source?.isProxy;
  // PO-3: how old this metric's vintage is, so the popover can flag stale layers.
  const fresh = source ? vintageFreshness(source.year) : null;
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
                            : 'text-surface-500 dark:text-surface-400 border-surface-300 dark:border-surface-600 hover:text-surface-600 dark:hover:text-surface-300 hover:border-surface-400 dark:hover:border-surface-500'
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
                {subregionEstimate && (
                  <span className="block mb-1.5 text-amber-300">
                    {t('data.subregion_estimate_desc').replace('{region}', subregionName ?? '')}
                  </span>
                )}
                {/* PO-4: registry caveat note (i18n key) — derivation/coverage/mixed-vintage details */}
                {source.note && (
                  <span className="block mb-1.5 text-surface-200 dark:text-surface-300">
                    {t(source.note)}
                  </span>
                )}
                <span className="block text-[10px] italic text-surface-300 dark:text-surface-400">
                  {source.source} ({source.year})
                  {fresh && fresh.yearsAgo > 0 && (
                    <span className={fresh.isStale ? ' text-amber-400 not-italic font-medium' : ''}>
                      {' · '}
                      {t('source.years_ago').replace('{n}', String(fresh.yearsAgo))}
                    </span>
                  )}
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
        {subregionEstimate && (
          <span className="inline-flex items-center rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide
                           bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30"
                title={t('data.subregion_estimate_desc').replace('{region}', subregionName ?? '')}>
            {t('data.subregion_estimate')}
          </span>
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

// PO-6: small inline caveat for a retired/frozen upstream source (the postal-code
// rent table StatFin asvu 13eb), rendered once below the rows it backs. Reads the
// last-published year from the data-source registry so it stays in sync with it.
const DiscontinuedCaveat: React.FC<{ property: string }> = React.memo(({ property }) => {
  useI18nVersion();
  const year = getMetricSource(property)?.discontinued;
  if (year == null) return null;
  return (
    <p className="py-1.5 flex items-start gap-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
      <span aria-hidden="true">⚠</span>
      <span>{t('source.discontinued').replace('{year}', String(year))}</span>
    </p>
  );
});
DiscontinuedCaveat.displayName = 'DiscontinuedCaveat';

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

// QW-4: density and €/m² formatting now uses the shared, sv-aware formatters in
// utils/formatting.ts (formatDensity, formatEuroSqm). The previous panel-local
// duplicates and their Intl.NumberFormat cache hard-coded fi-FI for Swedish.

const formatSqm = (v: number | string | null | undefined): string => {
  const n = toNum(v);
  if (n == null) return '—';
  return `${n.toFixed(1)} m²`;
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
          className={`w-3.5 h-3.5 text-surface-500 dark:text-surface-400 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
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
      selfFmt: layer.format(selfVal),
      n: values.length,
    };
  }, [props, allFeatures, layer]);

  if (!result) return null;
  const { hist, pct, selfBin, selfFmt, n } = result;
  const maxCount = Math.max(...hist.bins.map((b) => b.count), 1);
  // For lower-is-better metrics a high raw percentile is actually worse, so invert
  // to a consistent "better than X% of areas" reading.
  const higherIsBetter = layer.higherIsBetter !== false;
  const betterPct = pct == null ? null : Math.round(higherIsBetter ? pct : 100 - pct);

  // A8: data-bearing aria for the mini-chart — names the metric, this area's own
  // value and its direction-aware standing. Falls back to the static label when
  // the percentile is unavailable (so the chart never loses its accessible name).
  const distAria = betterPct == null
    ? t('panel.distribution')
    : t('panel.dist_aria')
        .replace('{metric}', t(layer.labelKey))
        .replace('{value}', selfFmt)
        .replace('{pct}', String(betterPct));

  return (
    // C5: remount + fade on each active-layer change so the swapped distribution
    // is perceptible (the animation is reduced-motion-safe via index.css).
    <div key={activeLayer} className="px-4 md:px-5 pt-3 animate-fade-in">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
        {t('panel.distribution')} · {t(layer.labelKey)}
      </h3>
      <div className="flex items-end gap-px h-14" role="img" aria-label={distAria}>
        {hist.bins.map((b, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${i === selfBin ? 'bg-brand-500 dark:bg-brand-400' : 'bg-surface-200 dark:bg-surface-700'}`}
            style={{ height: `${(b.count / maxCount) * 100}%` }}
            title={`${layer.format(b.x0)} – ${layer.format(b.x1)}: ${b.count}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-surface-500 dark:text-surface-400 mt-1">
        <span>{layer.format(hist.min)}</span>
        <span>{layer.format(hist.max)}</span>
      </div>
      {betterPct != null && (
        <p className="text-sm text-surface-700 dark:text-surface-200 mt-2">
          <span className="font-semibold text-brand-600 dark:text-brand-400">
            {t('panel.dist_better_than').replace('{pct}', String(betterPct))}
          </span>{' '}
          <span className="text-surface-500 dark:text-surface-400">
            {t('panel.dist_sample').replace('{n}', String(n))}
          </span>
        </p>
      )}
    </div>
  );
});
DistributionSection.displayName = 'DistributionSection';

// CF-2: auto-composed strengths & weaknesses, derived from this area's REAL
// direction-aware percentiles across the loaded comparison cohort, surfaced as
// compact color-coded chips. The same pure machinery still feeds the prerendered
// profile meta/noscript (SEO) via composeSummarySentences. Renders nothing when
// the area has no notable standing (or the cohort is too small).
const AreaSummarySection: React.FC<{
  props: NeighborhoodProperties;
  allFeatures: GeoJSON.Feature[];
  scope?: 'national' | 'region';
  region?: string;
  /** True when the displayed quality_index came from the user's own weights. */
  isCustomWeights?: boolean;
}> = React.memo(({ props, allFeatures, scope, region, isCustomWeights = false }) => {
  useI18nVersion();
  // CF-2: for a real postal area, lazily fetch the national percentile ladders (a ?url asset,
  // zero bundle) so the standing is a TRUE national "top X%", not a rank against the loaded
  // region cohort. Metro aggregates (?city=all) rank against the 69 regions, so skip the ladder.
  const isAggregate = !!props._isMetroArea;
  const [ladders, setLadders] = useState<Record<string, NationalLadder> | null>(null);
  useEffect(() => {
    if (isAggregate) return;
    let alive = true;
    loadNationalPercentiles().then((l) => { if (alive) setLadders(l); }).catch(() => {});
    return () => { alive = false; };
  }, [isAggregate]);

  const useNational = !!ladders && !isAggregate;
  // The national quality_index ladder is built once with the DEFAULT weights, but the
  // value on `props` is recomputed in place from the live weights and is renormalized
  // within-region under the 'region' scope. Either makes the two incommensurable, so
  // drop the metric instead of publishing a rank that inverts for most areas. The
  // aggregate branch keeps it: there the cohort is the 69 region aggregates, re-averaged
  // from the same mutated features, so that comparison is already apples-to-apples.
  const skipProps = useMemo(
    () => (isCustomWeights || scope === 'region' ? ['quality_index'] : []),
    [isCustomWeights, scope],
  );
  const summary = useMemo(
    () =>
      useNational
        ? computeAreaSummary(props as Record<string, unknown>, [], {
            nationalLadders: ladders!,
            population: (props.he_vakiy as number | null | undefined) ?? null,
            skipProps,
          })
        : computeAreaSummary(props as Record<string, unknown>, allFeatures),
    [props, allFeatures, ladders, useNational, skipProps],
  );

  if (summary.strong.length === 0 && summary.weak.length === 0) return null;

  // CF-2: label the cohort the standing is measured against. National ladder → "nationally";
  // otherwise the loaded region cohort → "within {region}" when a region is selected, else the
  // plain chip (e.g. the ?city=all aggregate view, where the cohort is the 69 regions).
  const useRegionLabel = !useNational && scope === 'region' && !!region;
  const topKey = useNational ? 'summary.chip_top_national' : useRegionLabel ? 'summary.chip_top_region' : 'summary.chip_top';
  const bottomKey = useNational ? 'summary.chip_bottom_national' : useRegionLabel ? 'summary.chip_bottom_region' : 'summary.chip_bottom';
  const topChip = (pct: number) => fillTemplate(t(topKey), useRegionLabel ? { pct: String(pct), region: region! } : { pct: String(pct) });
  const bottomChip = (pct: number) => fillTemplate(t(bottomKey), useRegionLabel ? { pct: String(pct), region: region! } : { pct: String(pct) });

  return (
    <div className="rounded-xl bg-surface-100 dark:bg-surface-900/60 p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400">
        {t('summary.title')}
      </h3>
      {summary.strong.length > 0 && (
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
            {t('summary.strong')}
          </span>
          <div className="flex flex-wrap gap-1">
            {summary.strong.map((e) => (
              <span
                key={e.prop}
                className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium
                           bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25"
                title={topChip(e.topPct)}
              >
                {t(e.labelKey)}
                <span className="tabular-nums text-emerald-700 dark:text-emerald-400/70">
                  {topChip(e.topPct)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      {summary.weak.length > 0 && (
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
            {t('summary.weak')}
          </span>
          <div className="flex flex-wrap gap-1">
            {summary.weak.map((e) => (
              <span
                key={e.prop}
                className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium
                           bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25"
                title={bottomChip(e.bottomPct)}
              >
                {t(e.labelKey)}
                <span className="tabular-nums text-rose-700 dark:text-rose-400/70">
                  {bottomChip(e.bottomPct)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
AreaSummarySection.displayName = 'AreaSummarySection';

/**
 * Self-contained quality index badge with animated count-up.
 * Isolates ~18 animation re-renders (300ms × 60Hz) from the rest of
 * NeighborhoodPanel. Without this, each animation frame re-evaluates
 * ~1000 lines of JSX just to update a single number.
 */

const QualityBadge: React.FC<{
  qualityIndex: number;
  isCustomWeights: boolean;
  onCustomize?: () => void;
}> = React.memo(({ qualityIndex, isCustomWeights, onCustomize }) => {
  useI18nVersion();
  const animatedQi = useAnimatedValue(qualityIndex);
  const qi = animatedQi != null ? Math.round(animatedQi) : qualityIndex;
  const cat = getQualityCategory(qi);
  // The ramp is applied to the score's RELATIVE position, not to its raw value.
  //
  // Getting this wrong in either direction is visible to users, and both were shipped:
  //
  //  - Ramp over the raw value. The verdict word is cohort-relative ("Excellent" = the
  //    top fifth of the areas on screen) but the colour was absolute, so re-weighting
  //    moved the word without moving the colour: 80 read "Excellent (78–100)" on green
  //    while 58 read "Excellent (46–100)" on yellow. Same word, two colours.
  //  - One flat colour per band. The word and colour agreed, but the scale became a
  //    step function: 58 was a yellow "Good" and 59 a green "Excellent", a full hue
  //    jump for one point, and every score inside a band looked identical.
  //
  // Colouring by getQualityBandPosition — the piecewise-linear map from score to place
  // in the cohort — gives both. It is continuous and monotone, so neighbouring scores
  // get neighbouring colours and there is no cliff at a band edge; and because each band
  // owns a fixed fifth of that axis, each verdict owns a fixed fifth of the ramp.
  // "Excellent" is always drawn from the ramp's green end and "Bad" from its red one,
  // whatever the weighting, without the colour ever pretending the bands are absolute.
  //
  // Using the layer's ramp also keeps the colourblind substitution getLayerById applies,
  // and makes the strip the same gradient the choropleth and legend show.
  const qiLayer = getLayerById('quality_index');
  const bandCats = getQualityCategories();
  const bandPos = getQualityBandPosition(qi);
  const rampLo = qiLayer.stops[0];
  const rampHi = qiLayer.stops[qiLayer.stops.length - 1];
  const bandColor = bandPos == null
    ? '#94a3b8'
    : getInterpolatedColor(qiLayer, rampLo + (bandPos / 100) * (rampHi - rampLo));
  const lang = getLang();
  // CF-1: "How is this calculated?" explainer popover.
  const [showHow, setShowHow] = useState(false);
  // AY-3: dialog-role behaviors the popover declared but never honored. It's a
  // non-modal informational popover (focus stays on the toggle), so it's really a
  // tooltip — but it must still dismiss on Escape / outside-click, restoring focus.
  const howBtnRef = useRef<HTMLButtonElement>(null);
  const howRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showHow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setShowHow(false); howBtnRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (!howRef.current?.contains(node) && !howBtnRef.current?.contains(node)) setShowHow(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [showHow]);
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
              ref={howBtnRef}
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
                ref={howRef}
                role="tooltip"
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
                      <span className="tabular-nums text-surface-500 dark:text-surface-400">{d.defaultWeight}%</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] font-normal text-surface-500 dark:text-surface-400">
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
          style={{ backgroundColor: bandColor, color: readableTextColor(bandColor) }}
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
        {/* The choropleth's own ramp, drawn end to end across the band axis — so the
            strip is the same gradient the map and its legend show, and the pointer's
            colour is exactly the strip colour beneath it. The five labels below sit
            under equal fifths because the bands are quintiles of the cohort: equal width
            is equal share of areas, which is what the labels claim, and it keeps all five
            readable (in value space the middle bands are often only a few points wide). */}
        <div className="h-2 rounded-full" style={{ background: rampGradientCss(qiLayer, rampLo, rampHi) }} />
        <div className="flex mt-1">
          {bandCats.map((c) => (
            <span key={c.label.en} className="flex-1 text-center text-[9px] text-surface-600 dark:text-surface-400">
              {c.label[lang]}
            </span>
          ))}
        </div>
        {/* Positioned on the band axis, not the raw 0–100 value axis — see
            getQualityBandPosition. At `left: ${qi}%` a 62 sat over "Good" while the
            label beside it read "Excellent". */}
        <div
          className="absolute top-0 w-4 h-4 -mt-1 rounded-full border-2 border-white dark:border-surface-300 shadow-md"
          style={{
            left: `${bandPos ?? qi}%`,
            transform: 'translateX(-50%)',
            backgroundColor: bandColor,
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
const QualityCoverageSection: React.FC<{ props: NeighborhoodProperties; scope?: 'national' | 'region'; qualityWeights?: QualityWeights }> = React.memo(({ props, scope = 'national', qualityWeights }) => {
  useI18nVersion();
  const [open, setOpen] = useState(false);
  const lang = getLang();
  // CF-1: audit the live-weighted factors (so the chip matches the displayed score
  // under a custom/persona lens), not the default-weighted set.
  const coverage = useMemo(() => computeQualityCoverage(props, qualityWeights), [props, qualityWeights]);
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
                ? 'bg-amber-400/15 text-amber-800 dark:text-amber-400 border-amber-400/30'
                : 'bg-emerald-400/10 text-emerald-700 dark:text-emerald-400 border-emerald-400/30'
            }`}
          >
            {coverage.present}/{coverage.total}
          </span>
        </span>
        <svg
          className={`w-3.5 h-3.5 text-surface-500 dark:text-surface-400 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-2 space-y-2.5">
          <p className="text-[11px] leading-snug text-surface-500 dark:text-surface-400">{t('panel.quality_coverage_help')}</p>
          {/* PO-11: separate "thin everywhere" gaps from genuine local holes. */}
          {coverage.missingThinNationally > 0 && (
            <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
              {t('panel.quality_coverage_thin_note')}
            </p>
          )}
          {/* CF-8: which national-vs-region range the score was normalized against */}
          <p className="text-[11px] leading-snug text-surface-500 dark:text-surface-400">
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
                <span className="text-surface-500 dark:text-surface-400">{dim.present}/{dim.total}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {dim.factors.map((f) => {
                  // PO-11: a missing factor that is also sparse nationwide is a
                  // gap the index can't fill anywhere, not a local data hole — so
                  // label it with its real national coverage and a clearer title.
                  const thinMissing = !f.present && f.nationallyThin;
                  return (
                  <span
                    key={f.id}
                    className={`inline-flex items-center rounded px-1.5 py-px text-[10px] ${
                      f.present
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400'
                        : 'bg-transparent text-surface-300 dark:text-surface-600 line-through border border-dashed border-surface-200 dark:border-surface-700/60'
                    }`}
                    title={
                      f.present
                        ? undefined
                        : thinMissing && f.nationalCoveragePct != null
                          ? `${t('panel.quality_factor_thin')} (${formatCoveragePct(f.nationalCoveragePct)}%)`
                          : t('panel.quality_factor_missing')
                    }
                  >
                    {f.label[lang]}
                    {thinMissing && f.nationalCoveragePct != null && (
                      <span className="ml-1 no-underline tabular-nums text-amber-600 dark:text-amber-400">
                        {formatCoveragePct(f.nationalCoveragePct)}%
                      </span>
                    )}
                  </span>
                  );
                })}
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
  // X6: a debounced "Saving…/Saved" acknowledgment so the user knows their note
  // was captured (it autosaves on every keystroke, previously with no feedback).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => { clearTimeout(savingTimerRef.current); clearTimeout(savedTimerRef.current); }, []);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
          {t('notes.title')}
        </h3>
        {saveState !== 'idle' && (
          <span className="text-[10px] text-surface-500 dark:text-surface-400" aria-live="polite">
            {saveState === 'saving' ? t('notes.saving') : t('notes.saved')}
          </span>
        )}
      </div>
      <textarea
        value={note}
        onChange={(e) => {
          if (!trackedRef.current) { trackEvent('add-note'); trackedRef.current = true; }
          setNote(pno, e.target.value);
          setSaveState('saving');
          clearTimeout(savingTimerRef.current);
          clearTimeout(savedTimerRef.current);
          savingTimerRef.current = setTimeout(() => {
            setSaveState('saved');
            savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
          }, 500);
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

export const NeighborhoodPanel: React.FC<PanelProps> = React.memo(({ data: d, metroAverages: avg, onClose, onPin, onUnpin, isPinned, pinCount = 0, onCustomize, isCustomWeights = false, qualityWeights, allFeatures, activeLayer, onFlyTo, isFavorite = false, onToggleFavorite, isInShortlist = false, onToggleShortlist, referencePno, referenceName, onSetReference, qualityScope = 'national', onExploreCity, userId, isochroneEnabled = false, isochroneMode = 'walk', isochroneBudget = 20, isochroneLoading = false, isochroneError = false, isochroneActive = false, onIsochroneChange, onIsochroneClear, similarityWeights, onSimilarityWeightChange, onSimilarityToggle, regionPriceAverages, regionName, wizardProfile, onOpenWizard }) => {
  // QW-4: capture the i18n version so memos that build translated strings (the
  // MOBILE_SECTIONS tab labels) recompute on a language switch / lazy-dict arrival.
  const i18nVersion = useI18nVersion();
  // "Fit for you": a match score for this area vs the saved priority profile (or a
  // CTA to set one). Hidden for the all-Finland region aggregates, where a per-area
  // fit is meaningless, and only when an open-Finder handler is wired in.
  const fitBadge = (!d._isMetroArea && onOpenWizard)
    ? <FitForYouBadge data={d} profile={wizardProfile} onSetPriorities={onOpenWizard} />
    : null;
  // M5: honor "Reduce Motion" on the two most frequent mobile interactions (sheet
  // open/drag, tab-carousel snap), matching the map's reduced-motion fast paths.
  const reducedMotion = useReducedMotion();
  const eduTotal = useMemo(() =>
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]
      .filter((v): v is number => v != null && v > 0)
      .reduce((a, b) => a + b, 0) || 1,
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]);
  // EM5: when every education field is null/zero, eduTotal falls back to 1 and all
  // four bars render below the 1% threshold — leaving an orphan heading with no
  // bars (looks broken). Track presence so we can show a "no data" line instead.
  const hasEduData = useMemo(() =>
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus].some((v) => v != null && v > 0),
    [d.ko_yl_kork, d.ko_al_kork, d.ko_ammat, d.ko_perus]);

  // T1: housing-sale / rent price fall back to the seutukunta (sub-region) average when
  // this area has no own value. Display-only — the choropleth/JSON-LD stay real per-area
  // data. `null` fallback means even the region has no value, so the row keeps showing '—'.
  const propertyPriceFallback = d.property_price_sqm == null ? (regionPriceAverages?.property_price_sqm ?? null) : null;
  const rentalPriceFallback = d.rental_price_sqm == null ? (regionPriceAverages?.rental_price_sqm ?? null) : null;

  // CF-3: nearby kaavat & hankkeet for the selected area, lazy-fetched from a free
  // per-region shard (out of the first-paint payload). Skipped for metro aggregates.
  const { entries: planningEntries } = usePlanningArea(
    d._isMetroArea ? undefined : (d.city as string | undefined),
    d._isMetroArea ? null : d.pno,
  );
  const planningSnapshot = planningInfo().snapshot;

  // Copy link / share state
  const [copied, setCopied] = useState(false);
  // E3: URL revealed for manual copy when the clipboard API is blocked/unavailable.
  const [copyFallbackUrl, setCopyFallbackUrl] = useState<string | null>(null);
  // E5: transient "couldn't generate image" notice when the share-card export fails.
  const [imgError, setImgError] = useState(false);
  const imgErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(imgErrorTimerRef.current), []);
  // L2: per-button busy state + re-entry guard for the share-as-image card.
  const [sharingImage, setSharingImage] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Clean up the "copied" feedback timer on unmount to prevent state updates after unmount
  React.useEffect(() => () => clearTimeout(copiedTimerRef.current), []);
  // C9: transient toast shown when the pin button is tapped at the 3-area cap.
  // On touch the button can't be disabled (a tap would be a silent no-op), so a
  // tap-while-full surfaces this instead of pinning. Same machinery as `copied`.
  const [pinToast, setPinToast] = useState(false);
  const pinToastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(pinToastTimerRef.current), []);
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

    // Fallback: copy URL to clipboard. E3: in an iframe embed, an insecure
    // context, or with clipboard permission denied, writeText is missing or
    // rejects — instead of silently doing nothing, reveal the URL for a manual
    // select-all copy (mirroring SettingsDropdown's share-link fallback).
    if (!navigator.clipboard?.writeText) {
      setCopyFallbackUrl(url);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFallbackUrl(url);
    }
  }, [d.nimi, d.pno]);

  // QW-3: Bottom sheet state (mobile only) — uses shared useBottomSheet hook
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sheetHeight, isDragging, snap, cycleSnap, handlers: sheetHandlers } = useBottomSheet({
    initialSnap: 'half',
    onClose,
  });
  // A5: at the full snap the sheet declares aria-modal=true (the rest of the page
  // is announced inert), so it must actually contain Tab focus. Activate the trap
  // only at full snap — at peek/half the sheet is non-modal and focus stays free.
  // (On desktop the sheet is display:none and never reaches 'full', so this is a no-op.)
  useFocusTrap(sheetRef, snap === 'full');

  // PO-8: A11y — on open, move keyboard focus into whichever panel container is
  // visible (desktop side panel or mobile sheet), and restore it to the element
  // that triggered the open on close. Neither container traps focus: the desktop
  // panel coexists with the map, and the mobile sheet relies on the global
  // Escape-to-close handler. Runs once per open (the component instance is reused
  // across neighborhood changes, so this fires on mount/unmount only).
  const desktopPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    // offsetParent is null for the display:none container at the current breakpoint.
    const visible = [desktopPanelRef.current, sheetRef.current].find(
      (el) => el && el.offsetParent !== null,
    );
    (visible ?? desktopPanelRef.current)?.focus();
    return () => trigger?.focus?.();
  }, []);

  // PO-3: Swipe navigation for mobile sections
  const MOBILE_SECTIONS = useMemo(() => [
    t('panel.tab.overview'),
    t('panel.tab.stats'),
    t('panel.tab.trends'),
    t('panel.tab.similar'),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- QW-4: i18nVersion is the dependency (t() reads the active language).
  ] as const, [i18nVersion]);
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

  // CF-7: WAI-ARIA Tabs keyboard support for the mobile section tablist. Arrow/Home/
  // End move the active tab and follow focus to it (roving tabindex: only the active
  // tab is in the tab order). Wraps at both ends, per the APG automatic-activation
  // pattern. Scales to any number of sections — it reads MOBILE_SECTIONS.length.
  const tablistRef = useRef<HTMLDivElement>(null);
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = MOBILE_SECTIONS.length;
    let next: number;
    switch (e.key) {
      case 'ArrowRight': next = (activeSection + 1) % count; break;
      case 'ArrowLeft': next = (activeSection - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    e.preventDefault();
    setActiveSection(next);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#section-tab-${next}`)?.focus();
  }, [activeSection, setActiveSection, MOBILE_SECTIONS.length]);

  const favoriteButton = onToggleFavorite && (
    <button
      onClick={() => { trackEvent(isFavorite ? 'unfavorite' : 'favorite'); onToggleFavorite(); }}
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950 ${
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
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950 ${
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
      className={`p-1.5 rounded-lg transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950 ${
        isInShortlist ? 'text-brand-600 hover:text-brand-600' : 'text-surface-400 hover:text-brand-600'
      }`}
      title={isInShortlist ? t('shortlist.remove') : t('shortlist.add')}
    >
      <svg className="w-5 h-5" fill={isInShortlist ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    </button>
  );

  // C9: at the cap, keep the greyed/not-allowed look but DON'T set `disabled` — a
  // disabled button swallows the tap on touch, making a full-cap tap a silent
  // no-op. Instead handle the capped tap in onClick and surface a brief toast.
  const pinCapped = !isPinned && pinCount >= 3;
  const pinButton = onPin && (
    <button
      onClick={() => {
        if (pinCapped) {
          setPinToast(true);
          clearTimeout(pinToastTimerRef.current);
          pinToastTimerRef.current = setTimeout(() => setPinToast(false), 2000);
          return;
        }
        trackEvent(isPinned ? 'unpin-compare' : 'pin-compare');
        if (isPinned && onUnpin) { onUnpin(d.pno); } else { onPin(d); }
      }}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[44px] md:min-h-0
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950 ${
        isPinned
          ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400'
          : pinCapped
            ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
            : 'bg-brand-600 hover:bg-brand-700 text-white'
      }`}
      title={isPinned ? t('compare.pinned') : pinCapped ? t('compare.max') : t('compare.pin')}
    >
      {isPinned ? t('compare.pinned') : t('compare.pin')}
    </button>
  );

  // CF-10: the selected area's GeoJSON feature (geometry + raw props) for the
  // machine-readable export. Look it up from the loaded features so geometry is
  // included; fall back to a geometry-less feature if the cohort isn't loaded.
  const selectedFeature = useMemo<GeoJSON.Feature<GeoJSON.Geometry | null>>(() => {
    const f = allFeatures?.find((ft) => (ft.properties as { pno?: string } | null)?.pno === d.pno);
    return f ?? { type: 'Feature', geometry: null, properties: d as unknown as GeoJSON.GeoJsonProperties };
  }, [allFeatures, d]);

  const exportButtons = (
    <div className="flex flex-wrap items-center justify-center gap-3 px-6 py-4 border-t border-surface-200 dark:border-surface-800/50">
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
      {/* CF-10: machine-readable GeoJSON (geometry + raw values) for QGIS/pandas */}
      <button
        onClick={() => { trackEvent('export-geojson'); exportGeoJson([selectedFeature]); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-surface-500 dark:text-surface-400
                   hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        title={t('export.geojson')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        {t('export.geojson')}
      </button>
      {/* PO-2: raw-numeric JSON (unit-free values) for analysis/spreadsheets */}
      <button
        onClick={() => { trackEvent('export-json'); exportJson([selectedFeature]); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-surface-500 dark:text-surface-400
                   hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
        title={t('export.json')}
      >
        {t('export.json')}
      </button>
      {/* CF-2: Share as image */}
      <button
        onClick={() => {
          if (sharingImage) return;
          trackEvent('export-image');
          setSharingImage(true);
          generateScoreCard(d, avg).catch(() => {
            // E5: html-to-image chunk failed to load (offline / stale chunk after a
            // deploy) or rendering threw — tell the user instead of silently reverting.
            setImgError(true);
            clearTimeout(imgErrorTimerRef.current);
            imgErrorTimerRef.current = setTimeout(() => setImgError(false), 3000);
          }).finally(() => setSharingImage(false));
        }}
        disabled={sharingImage}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium min-h-[44px] md:min-h-0
                   text-brand-700 dark:text-brand-300
                   hover:bg-brand-500/10 dark:hover:bg-brand-600/15 transition-colors disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {sharingImage ? t('share.generating') : t('share.image')}
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
  // CF-5/CF-6: per-metric weights (0–3, 0 = off) for "similar neighbourhoods". The
  // weight map and its controls are owned by App (for URL/localStorage sync); fall
  // back to all-default when the props are absent (e.g. the standalone profile page).
  const simWeights = similarityWeights;
  const metricWeight = useCallback(
    (key: string) => (simWeights ? (simWeights[key] ?? SIMILARITY_WEIGHT_DEFAULT) : SIMILARITY_WEIGHT_DEFAULT),
    [simWeights],
  );
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
      .catch(() => {
        // PO-1: the promised fallback was never written, so on an offline failure
        // nationalFeatures stayed null and this effect refetched the 10.6 MB national
        // file in a tight loop. Toggle back to region scope (the guard above then
        // short-circuits) — the same recovery NeighborhoodWizard/CorrelationExplorer use.
        setScope('region');
      })
      .finally(() => setNationalLoading(false));
  }, [similarExpanded, similarityScope, nationalFeatures, nationalLoading, setScope]);

  const scopeFeatures = similarityScope === 'national' ? nationalFeatures : allFeatures;
  // CF-5: only metrics with a positive weight participate; their weights scale the
  // contribution inside findSimilarNeighborhoods. Memo key on a stable serialization
  // of the weight map so a slider nudge re-runs but unrelated re-renders don't.
  const simWeightsKey = useMemo(
    () => AVAILABLE_SIMILARITY_METRICS.map((m) => metricWeight(m.key as string)).join(','),
    [metricWeight],
  );
  const similar = useMemo(() => {
    if (!similarExpanded || !scopeFeatures) return [];
    const metrics = AVAILABLE_SIMILARITY_METRICS
      .map((m) => m.key)
      .filter((k) => metricWeight(k as string) > 0);
    return findSimilarNeighborhoods(d, scopeFeatures, 5, metrics, simWeights);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- simWeights tracked via simWeightsKey
  }, [similarExpanded, d, scopeFeatures, simWeightsKey]);

  // EM3: with every metric chip toggled off, `metrics` is empty and `similar`
  // resolves to [] — indistinguishable from "no similar areas". Detect that state
  // so we can prompt the user to re-enable a metric instead of showing a blank.
  const noSimMetrics = !AVAILABLE_SIMILARITY_METRICS.some((m) => metricWeight(m.key as string) > 0);

  // CF-6b: open a national result. Its centre is unavailable (region_properties is
  // geometry-stripped), so navigate to its profile page rather than fly the map.
  const openNationalResult = useCallback((props: NeighborhoodProperties) => {
    navigate(profileHref(props.pno, props.nimi || props.namn || props.pno));
  }, [navigate]);

  // CF-12: spatial-neighbour (adjacency) lens — "the cheaper area next door".
  // The precomputed pno->neighbours graph is fetched lazily; the result is mapped
  // to the loaded features so each chip carries a real name, centre and price.
  // Neighbours are ordered by €/m² ascending when available (cheapest first),
  // surfacing the value the lens is named for, then by name.
  const [neighborPnos, setNeighborPnos] = useState<string[] | null>(null);
  useEffect(() => {
    // Metro-area aggregates have no postal-code adjacency; reset when switching areas.
    setNeighborPnos(null);
    if (!allFeatures || allFeatures.length === 0 || d._isMetroArea) return;
    let cancelled = false;
    resolveNeighborPnos(d, allFeatures)
      .then((pnos) => { if (!cancelled) setNeighborPnos(pnos); })
      .catch(() => { if (!cancelled) setNeighborPnos([]); });
    return () => { cancelled = true; };
  }, [d, allFeatures]);

  const neighbors = useMemo(() => {
    if (!neighborPnos || neighborPnos.length === 0 || !allFeatures) return [];
    const byPno = new Map<string, GeoJSON.Feature>();
    for (const f of allFeatures) {
      const pno = (f.properties as NeighborhoodProperties | null)?.pno;
      if (pno) byPno.set(pno, f);
    }
    const list = neighborPnos
      .map((pno) => byPno.get(pno))
      .filter((f): f is GeoJSON.Feature => !!f)
      .map((f) => {
        const props = f.properties as NeighborhoodProperties;
        const price = toNum(props.property_price_sqm);
        return { props, price, center: getFeatureCenter(f) };
      });
    list.sort((a, b) => {
      // Cheapest €/m² first; areas without a price sink below those with one.
      if (a.price != null && b.price != null) return a.price - b.price;
      if (a.price != null) return -1;
      if (b.price != null) return 1;
      return (a.props.nimi ?? a.props.pno).localeCompare(b.props.nimi ?? b.props.pno);
    });
    return list;
  }, [neighborPnos, allFeatures]);

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
          qualityIndex={d.quality_display ?? d.quality_index}
          isCustomWeights={isCustomWeights}
          onCustomize={onCustomize}
        />
      )}

      {/* CF-8: Quality Index auditability — factor coverage for this area */}
      {d.quality_index != null && <QualityCoverageSection props={d} scope={qualityScope} qualityWeights={qualityWeights} />}

      {/* CF-2: auto-composed plain-language strengths & weaknesses from real percentiles */}
      {allFeatures && allFeatures.length > 1 && (
        <AreaSummarySection props={d} allFeatures={allFeatures} scope={qualityScope} region={regionName} isCustomWeights={isCustomWeights} />
      )}

      {/* CF-5: travel-time isochrone controls (real neighborhoods only; needs a Digitransit key) */}
      {isochroneEnabled && !d._isMetroArea && onIsochroneChange && onIsochroneClear && (
        <IsochroneControls
          mode={isochroneMode}
          budget={isochroneBudget}
          loading={isochroneLoading}
          error={isochroneError}
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
        {hasEduData ? (
          <>
            <BarSegment label={t('panel.higher_edu')} value={d.ko_yl_kork ?? 0} total={eduTotal} color="#a78bfa" />
            <BarSegment label={t('panel.bachelor')} value={d.ko_al_kork ?? 0} total={eduTotal} color="#818cf8" />
            <BarSegment label={t('panel.vocational')} value={d.ko_ammat ?? 0} total={eduTotal} color="#6366f1" />
            <BarSegment label={t('panel.basic')} value={d.ko_perus ?? 0} total={eduTotal} color="#4f46e5" />
          </>
        ) : (
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('panel.radar_no_data')}</p>
        )}
      </div>

      {/* Activity status */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-3">
          {t('panel.age_distribution')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'employed', label: t('panel.employed'), value: d.pt_tyoll, color: 'bg-emerald-500' },
            { key: 'unemployed', label: t('panel.unemployed'), value: d.pt_tyott, color: 'bg-rose-500' },
            { key: 'students', label: t('panel.students'), value: d.pt_opisk, color: 'bg-amber-500' },
            { key: 'pensioners', label: t('panel.pensioners'), value: d.pt_elakel, color: 'bg-blue-500' },
          ].map((item) => (
            <div key={item.key} className="bg-surface-100 dark:bg-surface-900/60 rounded-lg p-3">
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

      {/* CF-3: Kaavat & hankkeet lähistöllä — nearby zoning plans + Väylä projects.
          Non-color-only status badge; honest partial-coverage caption. Returns
          nothing when the area has no entries. */}
      {!d._isMetroArea && planningEntries && planningEntries.length > 0 && (
        <div className="rounded-xl border border-surface-200 dark:border-surface-800/60 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-2">
            {t('panel.planning_heading')}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {planningEntries.map((e) => {
              const meta = [t(`panel.plan_type_${e.ptype}`), t(`panel.plan_status_${e.status}`), e.date]
                .filter(Boolean)
                .join(' · ');
              const aria = `${e.name}. ${meta}. ${e.source}`;
              const body = (
                <>
                  <span className="block text-sm text-surface-700 dark:text-surface-200">{e.name}</span>
                  <span className="block text-[11px] text-surface-500 dark:text-surface-400">{meta} — {e.source}</span>
                </>
              );
              return (
                <li key={`${e.ptype}-${e.kind}-${e.name}-${e.date ?? ''}`}>
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={aria}
                      onClick={() => trackEvent(`planning-${e.kind}`)}
                      className="block min-h-[44px] px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-900/60
                                 hover:bg-surface-200 dark:hover:bg-surface-800 transition-colors"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-900/60" aria-label={aria}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-2 leading-snug">
            {t('panel.planning_coverage').replace('{date}', planningSnapshot)}
          </p>
        </div>
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
            value={d.rental_price_sqm != null
              ? `${Number(d.rental_price_sqm).toFixed(2)} €/m²/kk`
              : (rentalPriceFallback != null ? `${Number(rentalPriceFallback).toFixed(2)} €/m²/kk` : '—')}
            diff={d.rental_price_sqm != null ? formatDiff(d.rental_price_sqm, avg.rental_price_sqm) : undefined}
            diffClass={diffColor(d.rental_price_sqm, avg.rental_price_sqm, false)}
            property="rental_price_sqm"
            subregionEstimate={d.rental_price_sqm == null && rentalPriceFallback != null}
            subregionName={regionName}
          />
          <StatRow
            label={t('panel.price_to_rent')}
            value={d.price_to_rent_ratio != null ? `${Number(d.price_to_rent_ratio).toFixed(1)} v` : '—'}
            diff={formatDiff(d.price_to_rent_ratio, avg.price_to_rent_ratio)}
            diffClass={diffColor(d.price_to_rent_ratio, avg.price_to_rent_ratio, false)}
            property="price_to_rent_ratio"
          />
          {/* PO-6: rent source (StatFin asvu 13eb) is retired — flag the frozen snapshot */}
          <DiscontinuedCaveat property="rental_price_sqm" />
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
            value={d.property_price_sqm != null ? formatEuroSqm(d.property_price_sqm) : (propertyPriceFallback != null ? formatEuroSqm(propertyPriceFallback) : '—')}
            diff={d.property_price_sqm != null ? formatDiff(d.property_price_sqm, avg.property_price_sqm) : undefined}
            diffClass={diffColor(d.property_price_sqm, avg.property_price_sqm, null)}
            property="property_price_sqm"
            subregionEstimate={d.property_price_sqm == null && propertyPriceFallback != null}
            subregionName={regionName}
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
            value={d.water_proximity_m != null ? `${formatNumber(d.water_proximity_m)} m` : '—'}
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

      {/* CF-12: Neighboring areas — geographic adjacency chips, cheapest €/m² first.
          A real spatial lens distinct from the metric-similarity list below. */}
      {!d._isMetroArea && neighbors.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
            {t('panel.neighbors')}
          </h3>
          <p className="text-[11px] leading-snug text-surface-500 dark:text-surface-400 mb-2">
            {t('panel.neighbors_help')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {neighbors.map((n) => (
              <button
                key={n.props.pno}
                onClick={() => { trackEvent('neighbor-chip'); onFlyTo?.(n.center); }}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]
                           bg-surface-100 dark:bg-surface-900/60 hover:bg-surface-200 dark:hover:bg-surface-800
                           border border-surface-200 dark:border-surface-700/50 transition-colors"
                title={t('panel.neighbors_chip_title').replace('{name}', n.props.nimi ?? n.props.pno)}
              >
                <span className="font-medium text-surface-900 dark:text-white">{n.props.nimi ?? n.props.pno}</span>
                {n.price != null && (
                  <span className="tabular-nums text-surface-500 dark:text-surface-400">{formatEuroSqm(n.price)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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
              className={`w-3.5 h-3.5 text-surface-500 dark:text-surface-400 transition-transform duration-200 ${similarExpanded ? '' : '-rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {similarExpanded && (
            <div className="space-y-2">
              {/* CF-5/CF-6: choose which metrics define "similar" and how heavily each weighs */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
                  {t('panel.similar_by')}
                </div>
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_SIMILARITY_METRICS.map((m) => {
                    const key = m.key as string;
                    const weight = metricWeight(key);
                    const on = weight > 0;
                    const label = t(m.labelKey);
                    return (
                      <span
                        key={key}
                        className={`inline-flex items-center rounded-full text-[11px] border transition-colors ${
                          on
                            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 border-brand-500/40'
                            : 'bg-surface-100 dark:bg-surface-900/60 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-700/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSimilarityToggle?.(key)}
                          aria-pressed={on}
                          className="pl-2 pr-1.5 py-0.5 rounded-l-full hover:opacity-80"
                          title={on ? t('panel.similar_weight_off').replace('{metric}', label) : t('panel.similar_weight_on').replace('{metric}', label)}
                        >
                          {label}
                        </button>
                        {on && (
                          <span className="flex items-center pr-1 gap-0.5" role="group" aria-label={t('panel.similar_weight_label').replace('{metric}', label)}>
                            <button
                              type="button"
                              onClick={() => onSimilarityWeightChange?.(key, weight - 1)}
                              disabled={weight <= SIMILARITY_WEIGHT_MIN}
                              aria-label={t('panel.similar_weight_decrease').replace('{metric}', label)}
                              className="w-4 h-4 flex items-center justify-center rounded leading-none disabled:opacity-30 hover:bg-brand-500/20"
                            >
                              −
                            </button>
                            <span className="tabular-nums min-w-[1.1rem] text-center font-semibold" aria-live="polite">{weight}×</span>
                            <button
                              type="button"
                              onClick={() => onSimilarityWeightChange?.(key, weight + 1)}
                              disabled={weight >= SIMILARITY_WEIGHT_MAX}
                              aria-label={t('panel.similar_weight_increase').replace('{metric}', label)}
                              className="w-4 h-4 flex items-center justify-center rounded leading-none disabled:opacity-30 hover:bg-brand-500/20"
                            >
                              +
                            </button>
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
              {/* CF-6b: rank within this region or across all of Finland */}
              {!d._isMetroArea && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">
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
                            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 border-brand-500/40'
                            : 'bg-surface-100 dark:bg-surface-900/60 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-700/50 hover:border-surface-300 dark:hover:border-surface-600'
                        }`}
                      >
                        {t(sc === 'region' ? 'panel.similar_scope_region' : 'panel.similar_scope_national')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {noSimMetrics ? (
                <div className="px-3 py-2.5 text-xs text-surface-500 dark:text-surface-400">{t('panel.similar_no_metrics')}</div>
              ) : similarityScope === 'national' && nationalLoading && !nationalFeatures ? (
                <div className="px-3 py-2.5 text-xs text-surface-500 dark:text-surface-400">{t('loading')}</div>
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

  // PO-2: extract the no-data empty state and the profile CTA so the MOBILE bottom sheet can
  // reuse them — they previously lived only inside the desktop-only panelContent, so mobile
  // had no honest no-data state and no route from a selected area to its /alue/ profile. These
  // are a verbatim hoist (no rendered change on desktop).
  const noDataContent = (
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
  );
  const profileLink = !d._isMetroArea ? (
    <a
      href={profileHref(d.pno, d.nimi)}
      onClick={(e) => {
        // QW-5: client-side nav preserves the map session; let modified/middle
        // clicks (new tab) fall through to the real localized href.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(profileHref(d.pno, d.nimi));
      }}
      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl
                 bg-surface-100 dark:bg-surface-900/60 hover:bg-surface-200 dark:hover:bg-surface-800
                 text-sm font-medium text-surface-600 dark:text-surface-300 transition-colors"
    >
      {t('profile.view_full')}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </a>
  ) : null;

  const panelContent = d._noData ? noDataContent : (
    <div className="px-6 py-4 space-y-6">
      {exploreButton}
      {sectionOverview}
      {profileLink}
      {sectionTrends}
      {sectionStats}
      {sectionSimilar}
    </div>
  );

  return (
    <BaselineLabelContext.Provider value={vsLabel}>
    <>
      {/* Desktop: side panel — role=complementary (NOT dialog): it is non-modal and
          coexists with the map, so it must not trap focus. tabIndex=-1 lets PO-8's
          focus effect move focus here on open without adding it to the tab order. */}
      <div
        ref={desktopPanelRef}
        tabIndex={-1}
        role="complementary"
        aria-label={t('aria.panel_label').replace('{name}', d.nimi ?? d.pno)}
        className="hidden md:block absolute top-0 left-0 z-20 h-full w-[380px] max-w-[90vw] overflow-y-auto outline-none
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
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 flex-shrink-0
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950"
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
              className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white flex-shrink-0
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950"
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
          {fitBadge && <div className="mt-3">{fitBadge}</div>}
        </div>
        {panelContent}
        {exportButtons}
      </div>

      {/* Mobile: bottom sheet — role=dialog with aria-modal flipped on only at the
          full snap, where the sheet covers the screen and reads as modal. Escape-to-
          close is handled globally (do not re-add here). It still does not trap focus. */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={snap === 'full'}
        aria-label={
          snap === 'full'
            ? t('aria.panel_label_full').replace('{name}', d.nimi ?? d.pno)
            : t('aria.panel_label').replace('{name}', d.nimi ?? d.pno)
        }
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 outline-none
                   bg-white/95 dark:bg-surface-950/95 backdrop-blur-xl
                   border-t border-surface-200 dark:border-surface-800/50
                   shadow-[0_-4px_30px_rgba(0,0,0,0.15)] rounded-t-2xl flex flex-col overflow-hidden"
        style={{
          height: sheetHeight,
          transition: (isDragging || reducedMotion) ? 'none' : 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
      >
        {/* Drag handle */}
        <button
          type="button"
          onClick={cycleSnap}
          aria-expanded={snap !== 'peek'}
          aria-label={t('aria.expand_sheet')}
          className="flex w-full items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-t-2xl"
          onTouchStart={sheetHandlers.onTouchStart}
          onTouchMove={sheetHandlers.onTouchMove}
          onTouchEnd={sheetHandlers.onTouchEnd}
          onTouchCancel={sheetHandlers.onTouchCancel}
        >
          <div className="w-10 h-1.5 rounded-full bg-surface-300 dark:bg-surface-600" />
        </button>

        {/* Header */}
        <div className="px-5 pb-3 border-b border-surface-200 dark:border-surface-800/50">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h2 className="text-lg font-display font-bold text-surface-900 dark:text-white break-words min-w-0">{d.nimi}</h2>
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 flex-shrink-0
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950"
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
              className="p-2.5 -mr-1 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-400 hover:text-surface-900 dark:hover:text-white flex-shrink-0
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-950"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* CF-3: the mobile sheet header previously omitted the shortlist + reference
              buttons, so phone users had NO way to add an area to the shortlist (a flagship
              synced feature). Render them alongside favorite/pin like the desktop panel. */}
          {(favoriteButton || pinButton || shortlistButton || referenceButton) && (
            <div className="flex items-center gap-1 mt-2">
              {favoriteButton}
              {pinButton}
              {shortlistButton}
              {referenceButton}
            </div>
          )}
          {/* MO-3: on mobile the comparison sheet and this area sheet both anchor
              bottom-0 z-20, so the comparison hard-hides itself whenever an area is
              selected — and the 1-pin nudge pill is suppressed too. Tapping "add to
              comparison" therefore looked like nothing happened, with no count and
              no hint that *closing this sheet* is what reveals the comparison. This
              row is that missing confirmation; at 2+ it doubles as the way through. */}
          {isPinned && pinCount >= 2 && (
            <button
              onClick={onClose}
              className="mt-2 w-full flex items-center justify-between gap-2 px-3 py-2.5 min-h-[44px] rounded-lg
                         bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300
                         text-xs font-semibold transition-colors hover:bg-brand-100 dark:hover:bg-brand-900/40"
            >
              <span>{t('compare.pinned_reveal').replace('{n}', String(pinCount))}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
          {isPinned && pinCount === 1 && (
            <p className="mt-2 text-[11px] text-surface-500 dark:text-surface-400" role="status">
              {t('compare.pinned_need_more')}
            </p>
          )}
          {fitBadge && <div className="mt-2">{fitBadge}</div>}
        </div>
        {/* PO-3: Section tabs. CF-7: full WAI-ARIA Tabs pattern — roving tabindex
            (only the active tab is tabbable), arrow/Home/End keyboard nav, and each
            tab wired to its panel via stable ids (aria-controls ↔ aria-labelledby). */}
        {/* PO-2: a no-data region shows the written empty state on mobile too, instead of a
            blank 4-tab carousel (the header + action buttons above still render for parity). */}
        {d._noData ? noDataContent : (<>
        <div
          ref={tablistRef}
          role="tablist"
          aria-label={t('panel.sections')}
          className="flex px-5 pt-3 pb-1 gap-1"
          onKeyDown={handleTabKeyDown}
        >
          {MOBILE_SECTIONS.map((label, i) => (
            <button
              key={i}
              id={`section-tab-${i}`}
              role="tab"
              aria-selected={activeSection === i}
              aria-controls={`section-panel-${i}`}
              tabIndex={activeSection === i ? 0 : -1}
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
              transition: (isSnapping && !reducedMotion) ? 'transform 400ms cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
              willChange: 'transform',
            }}
            onTransitionEnd={onTransitionEnd}
          >
            {mobileSections.map((section, i) => (
              // CF-7: each pane is a tabpanel labelled by its tab and focusable for
              // SR users (tabIndex=0). Inactive panes are rendered off-screen (the
              // translateX carousel), so they're marked `inert` — keeping Tab focus
              // out of their hidden export buttons / explore links and out of the SR
              // tree, while leaving swipe/touch behavior untouched.
              <div
                key={i}
                id={`section-panel-${i}`}
                role="tabpanel"
                aria-labelledby={`section-tab-${i}`}
                tabIndex={0}
                inert={i !== activeSection}
                className={`w-full flex-shrink-0 ${isSwiping ? 'overflow-hidden' : 'overflow-y-auto'}`}
                style={{ minWidth: '100%' }}
              >
                <div className="px-6 py-4 pb-safe space-y-6">
                  {i === 0 && exploreButton}
                  {section}
                  {i === 0 && profileLink}
                  {section && exportButtons}
                </div>
              </div>
            ))}
          </div>
        </div>
        </>)}
      </div>

      {/* QW-2: Toast notification for clipboard copy. PO-3: role=status so screen
          readers announce the otherwise-silent confirmation. */}
      {copied && (
        <div role="status" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-50
                       px-4 py-2 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900
                       text-sm font-medium shadow-lg animate-fade-in">
          {t('panel.copied')}
        </div>
      )}

      {/* C9: transient toast when the compare cap is reached on a touch tap.
          PO-3: role=status so screen readers hear "limit reached". */}
      {pinToast && (
        <div role="status" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-50
                       px-4 py-2 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900
                       text-sm font-medium shadow-lg animate-fade-in">
          {t('compare.max_toast')}
        </div>
      )}

      {/* E5: transient share-image failure notice. */}
      {imgError && (
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-50
                       px-4 py-2 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900
                       text-sm font-medium shadow-lg animate-fade-in" role="status">
          {t('share.image_failed')}
        </div>
      )}

      {/* E3: clipboard blocked — reveal the link for a manual select-all copy. */}
      {copyFallbackUrl !== null && (
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 z-50
                       w-[min(92vw,360px)] px-4 py-3 rounded-xl bg-surface-900 dark:bg-surface-800 text-white
                       shadow-2xl border border-white/10 animate-fade-in" role="status">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-amber-300">{t('share.copy_failed')}</p>
            <button
              onClick={() => setCopyFallbackUrl(null)}
              aria-label={t('aria.close')}
              className="shrink-0 -mt-0.5 text-white/60 hover:text-white"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <textarea
            readOnly
            value={copyFallbackUrl}
            onFocus={(e) => e.currentTarget.select()}
            rows={2}
            className="w-full text-[11px] font-mono text-surface-100 bg-surface-950/60
                       border border-white/10 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
      )}
    </>
    </BaselineLabelContext.Provider>
  );
});

NeighborhoodPanel.displayName = 'NeighborhoodPanel';
