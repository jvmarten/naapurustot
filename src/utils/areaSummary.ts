/**
 * CF-2: Auto-generated plain-language area summary (strengths & weaknesses).
 *
 * Turns an area's already-computed direction-aware percentile ranks into a short,
 * readable "Strong / Weak" chip list plus 2–4 composed sentences (e.g. "Top 10%
 * nationally for transit and services; among the most expensive 15%; below-average
 * air quality"). Everything is templated from REAL per-area values only — the
 * percentile is the share of loaded areas this one beats, computed by the canonical
 * percentileRanks machinery — so the copy never asserts anything the data doesn't.
 *
 * Design:
 *  - Pure and dependency-light, so the build-time prerenderer (scripts/prerender.mjs,
 *    an .mjs that cannot import the bundled app) reuses the exact same logic for the
 *    SEO meta description / noscript text. It only depends on percentileRanks.ts,
 *    which the prerenderer already imports.
 *  - `computeAreaSummary` returns STRUCTURED data (label i18n keys + integer
 *    percentiles), never resolved strings — i18n resolution is the caller's job.
 *  - `composeSummarySentences` turns that structure into 1–3 sentence specs, each a
 *    template i18n key + a flat token bag, so the same composition drives the client
 *    panel (via `t()`) and the prerenderer (via LOCALES lookups) identically.
 */

import {
  distributionFor,
  percentileRankSorted,
  topPercentileFromRank,
  type HasProperties,
} from './percentileRanks.ts';

/** One metric eligible for the summary, with its "better" direction. */
export interface SummaryMetric {
  /** GeoJSON property key. */
  prop: string;
  /** i18n key for this metric's short label (reused from the layer/quality labels). */
  labelKey: string;
  /** true → a higher raw value is better (top of the distribution is the strong end). */
  higherIsBetter: boolean;
  /** Drop non-positive values from the distribution (income placeholders are 0). */
  requirePositive?: boolean;
  /**
   * Optional override sentence-phrase kind. Most metrics use the generic
   * top/bottom phrasing; a few read more naturally with a dedicated template
   * (e.g. housing cost → "among the most expensive"). null/omitted = generic.
   */
  weakKind?: 'expensive';
}

/**
 * The metrics surfaced in the summary, in priority order (strongest signal first).
 * Curated to broadly-covered, direction-clear indicators so a "top X%" / "weakest
 * X%" reads honestly. Housing cost (property_price_sqm) is direction-aware in a
 * buyer sense: a HIGHER price is the "weak" (expensive) end, hence higherIsBetter:false
 * with a dedicated `expensive` phrasing.
 */
export const SUMMARY_METRICS: SummaryMetric[] = [
  { prop: 'quality_index', labelKey: 'layer.quality_index', higherIsBetter: true },
  { prop: 'hr_mtu', labelKey: 'layer.median_income', higherIsBetter: true, requirePositive: true },
  { prop: 'transit_reachability_score', labelKey: 'layer.transit_reachability', higherIsBetter: true },
  { prop: 'walkability_index', labelKey: 'layer.walkability', higherIsBetter: true },
  { prop: 'healthcare_density', labelKey: 'layer.healthcare_access', higherIsBetter: true },
  { prop: 'tree_canopy_pct', labelKey: 'layer.tree_canopy', higherIsBetter: true },
  { prop: 'air_quality_index', labelKey: 'layer.air_quality', higherIsBetter: false },
  { prop: 'noise_pollution', labelKey: 'layer.noise_pollution', higherIsBetter: false },
  { prop: 'crime_index', labelKey: 'layer.crime_rate', higherIsBetter: false },
  { prop: 'unemployment_rate', labelKey: 'layer.unemployment', higherIsBetter: false },
  { prop: 'higher_education_rate', labelKey: 'layer.education', higherIsBetter: true },
  { prop: 'property_price_sqm', labelKey: 'layer.property_price', higherIsBetter: false, weakKind: 'expensive' },
];

/** A metric the area ranks notably well or poorly on (a "Strong"/"Weak" chip). */
export interface SummaryEntry {
  prop: string;
  labelKey: string;
  higherIsBetter: boolean;
  /** Integer "top X%" from the FAVOURABLE end (1–100). Small = strong standing. */
  topPct: number;
  /**
   * Integer "bottom X%" from the UNFAVOURABLE end (1–100). Small = poor standing.
   * Used for weak-side copy so "weakest 2%" reads correctly (vs. the favourable
   * top 98%). topPct + bottomPct ≈ 100 (both floored at 1).
   */
  bottomPct: number;
  /** Optional weak-phrase override (e.g. 'expensive' for housing cost). */
  weakKind?: 'expensive';
}

export interface AreaSummary {
  /** Metrics where the area sits at/above the strong threshold, best first. */
  strong: SummaryEntry[];
  /** Metrics where the area sits at/below the weak threshold, worst first. */
  weak: SummaryEntry[];
}

export interface AreaSummaryOptions {
  /** topPct ≤ this counts as a strength (default 25 → roughly the best quarter). */
  strongThreshold?: number;
  /** topPct ≥ this counts as a weakness (default 75 → roughly the worst quarter). */
  weakThreshold?: number;
  /** Require this many comparison areas before ranking at all (default 12). */
  minSampleSize?: number;
}

const DEFAULTS: Required<AreaSummaryOptions> = {
  strongThreshold: 25,
  weakThreshold: 75,
  minSampleSize: 12,
};

/** Read a finite numeric value from a property bag, or null. */
function readVal(props: Record<string, unknown>, prop: string, requirePositive?: boolean): number | null {
  const raw = props[prop];
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  if (requirePositive && v <= 0) return null;
  return v;
}

/**
 * Compute the structured strengths/weaknesses for one area against a cohort.
 *
 * `topPct` is the area's standing from its favourable end (top 5% = excellent,
 * regardless of the metric's raw direction), so strong vs weak is a single
 * threshold comparison. Sources are the loaded comparison cohort (national or a
 * region) — the same array the choropleth/distribution use.
 */
export function computeAreaSummary(
  props: Record<string, unknown>,
  sources: Array<HasProperties | Record<string, unknown>>,
  options: AreaSummaryOptions = {},
): AreaSummary {
  const { strongThreshold, weakThreshold, minSampleSize } = { ...DEFAULTS, ...options };
  const strong: SummaryEntry[] = [];
  const weak: SummaryEntry[] = [];

  for (const m of SUMMARY_METRICS) {
    const value = readVal(props, m.prop, m.requirePositive);
    if (value == null) continue;
    const sorted = distributionFor(sources, m.prop, { requirePositive: m.requirePositive });
    if (sorted.length < minSampleSize) continue;
    const rank = percentileRankSorted(sorted, value);
    const topPct = topPercentileFromRank(rank, m.higherIsBetter);
    const bottomPct = topPercentileFromRank(rank, !m.higherIsBetter);
    if (topPct == null || bottomPct == null) continue;
    const entry: SummaryEntry = {
      prop: m.prop,
      labelKey: m.labelKey,
      higherIsBetter: m.higherIsBetter,
      topPct,
      bottomPct,
      weakKind: m.weakKind,
    };
    if (topPct <= strongThreshold) strong.push(entry);
    else if (topPct >= weakThreshold) weak.push(entry);
  }

  // Best standing first for strengths; worst (highest topPct) first for weaknesses.
  strong.sort((a, b) => a.topPct - b.topPct);
  weak.sort((a, b) => b.topPct - a.topPct);
  return { strong, weak };
}

/** A composed sentence: a template i18n key plus its placeholder token values. */
export interface SummarySentenceSpec {
  /** i18n template key, e.g. 'summary.sentence.top'. */
  key: string;
  /** Placeholder tokens (already-stringified) substituted into the template. */
  tokens: Record<string, string>;
}

export interface ComposeOptions {
  /** Resolve a metric label i18n key → display string. */
  label: (labelKey: string) => string;
  /** The localized "and" word used to join the last item in a list. */
  and: string;
  /** The localized list separator (e.g. ", "). Defaults to ", ". */
  separator?: string;
  /** Max metrics named per sentence (default 3 — keeps copy terse). */
  maxPerSentence?: number;
  /** Max sentences emitted overall (default 3). */
  maxSentences?: number;
  /**
   * PO-1: cohort scope. 'national' (default) keeps the "nationally" phrasing; 'region'
   * (with a `region` name) switches to the "within {region}" templates — because the
   * ranking is against the LOADED cohort, which is a single region when a city is
   * selected. Asserting "nationally" for a region cohort is a factual error.
   */
  scope?: 'national' | 'region';
  /** The loaded region's display name, for the 'region'-scope templates. */
  region?: string;
}

/** Join localized labels into "a, b and c" using the provided connectors. */
function joinLabels(labels: string[], and: string, separator: string): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(separator)} ${and} ${labels[labels.length - 1]}`;
}

/** Representative top-percentile for a strong group: the leading entry's topPct. */
function groupTopPct(entries: SummaryEntry[]): number {
  return entries[0].topPct;
}

/** Representative bottom-percentile for a weak group: the leading entry's bottomPct. */
function groupBottomPct(entries: SummaryEntry[]): number {
  return entries[0].bottomPct;
}

/**
 * Turn a structured AreaSummary into 1–3 sentence specs (template key + tokens),
 * ready for i18n resolution by either the client panel or the prerenderer.
 *
 * The first strong/weak entries lead because the inputs are pre-sorted by standing.
 * Housing cost is split into its own "most expensive" clause so it never reads as a
 * generic weakness. When the area has no notable strength or weakness, returns an
 * empty array (the caller suppresses the block).
 */
export function composeSummarySentences(
  summary: AreaSummary,
  opts: ComposeOptions,
): SummarySentenceSpec[] {
  const separator = opts.separator ?? ', ';
  const maxPerSentence = opts.maxPerSentence ?? 3;
  const maxSentences = opts.maxSentences ?? 3;
  const specs: SummarySentenceSpec[] = [];
  // PO-1: region scope only kicks in when a region name is supplied.
  const region = opts.region ?? '';
  const useRegion = opts.scope === 'region' && region !== '';
  const k = (base: string) => (useRegion ? `${base}_region` : base);
  const withRegion = (tokens: Record<string, string>) => (useRegion ? { ...tokens, region } : tokens);

  const strong = summary.strong.slice(0, maxPerSentence);
  if (strong.length > 0) {
    const metrics = joinLabels(strong.map((e) => opts.label(e.labelKey)), opts.and, separator);
    specs.push({
      key: k('summary.sentence.top'),
      tokens: withRegion({ pct: String(groupTopPct(strong)), metrics }),
    });
  }

  // Housing cost reads better as its own "most expensive X%" clause.
  const expensive = summary.weak.filter((e) => e.weakKind === 'expensive');
  const otherWeak = summary.weak.filter((e) => e.weakKind !== 'expensive').slice(0, maxPerSentence);

  if (otherWeak.length > 0) {
    const metrics = joinLabels(otherWeak.map((e) => opts.label(e.labelKey)), opts.and, separator);
    specs.push({
      key: k('summary.sentence.bottom'),
      tokens: withRegion({ pct: String(groupBottomPct(otherWeak)), metrics }),
    });
  }

  if (expensive.length > 0) {
    specs.push({
      key: k('summary.sentence.expensive'),
      tokens: withRegion({ pct: String(expensive[0].bottomPct) }),
    });
  }

  return specs.slice(0, maxSentences);
}

/** Substitute `{token}` placeholders in a template with the spec's token values. */
export function fillTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => tokens[name] ?? `{${name}}`);
}

/**
 * Convenience end-to-end helper: resolve every sentence spec to a finished string.
 * `tpl` resolves a template i18n key → its template string (e.g. `t` or a LOCALES
 * lookup). Empty when the summary has nothing notable.
 */
export function renderSummarySentences(
  summary: AreaSummary,
  opts: ComposeOptions & { tpl: (key: string) => string },
): string[] {
  return composeSummarySentences(summary, opts).map((s) => fillTemplate(opts.tpl(s.key), s.tokens));
}
