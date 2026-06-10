import type { RegionId } from './regions';
// Import attribute required so this module runs under Node's type-stripping in
// scripts/prerender.mjs (which imports metrics.ts directly), not just under Vite.
import dataSources from '../data/data_sources.json' with { type: 'json' };

/** Supported city/region identifiers. */
export type CityId = RegionId;

/**
 * Properties attached to each GeoJSON feature representing a postal code area.
 *
 * Fields prefixed with `he_`, `ko_`, `hr_`, `pt_`, `ra_`, `te_`, `tp_` come directly
 * from Statistics Finland's Paavo open data. Derived fields (e.g., `unemployment_rate`,
 * `quality_index`) are computed client-side after data loading.
 *
 * The index signature allows dynamic property access by layer config `property` keys.
 */
export interface NeighborhoodProperties {
  /** 5-digit Finnish postal code (e.g., "00100") */
  pno: string;
  /** Neighborhood name in Finnish */
  nimi: string;
  /** Neighborhood name in Swedish */
  namn: string;
  /** Municipality code (e.g., "091" for Helsinki, "853" for Turku) */
  kunta: string | null;
  /** City/region this neighborhood belongs to */
  city: CityId | null;

  // --- Paavo fields (Statistics Finland) ---
  // Prefix key: he_ = population, ko_ = education, hr_ = income,
  //             pt_ = economic activity, ra_ = buildings, te_ = households, tp_ = jobs
  /** Total population (he = henkilöt) */
  he_vakiy: number | null;
  /** Average age */
  he_kika: number | null;
  /** Population aged 18+ (adult population) */
  ko_ika18y: number | null;
  /** Higher tertiary education (university degree) count */
  ko_yl_kork: number | null;
  /** Lower tertiary education (polytechnic) count */
  ko_al_kork: number | null;
  /** Vocational education count */
  ko_ammat: number | null;
  /** Basic education only count */
  ko_perus: number | null;
  /** Median income (€/year) */
  hr_mtu: number | null;
  /** Average income (€/year) */
  hr_ktu: number | null;
  /** Employed persons count */
  pt_tyoll: number | null;
  /** Unemployed persons count */
  pt_tyott: number | null;
  /** Students count */
  pt_opisk: number | null;
  /** Working-age population (15–74) */
  pt_vakiy: number | null;
  /** Pensioners count */
  pt_elakel: number | null;
  /** Total dwellings count */
  ra_asunn: number | null;
  /** Average apartment size (m²) */
  ra_as_kpa: number | null;
  /** Detached houses count */
  ra_pt_as: number | null;
  /** Households with children count */
  te_takk: number | null;
  /** Total households count */
  te_taly: number | null;
  /** Owner-occupied dwellings count */
  te_omis_as: number | null;
  /** Rental dwellings count */
  te_vuok_as: number | null;
  /** Land area (m²) */
  pinta_ala: number | null;
  /** Children aged 0–2 */
  he_0_2: number | null;
  /** Children aged 3–6 */
  he_3_6: number | null;
  unemployment_rate: number | null;
  higher_education_rate: number | null;
  pensioner_share: number | null;
  foreign_language_pct: number | null;
  quality_index: number | null;
  /** CF-8: per-dimension Quality Index sub-scores (0–100), keyed by DimensionId.
   *  Populated alongside quality_index in computeQualityIndices; absent until then. */
  quality_dimension_scores?: Record<string, number> | null;
  ownership_rate: number | null;
  rental_rate: number | null;
  population_density: number | null;
  child_ratio: number | null;
  student_share: number | null;
  detached_house_share: number | null;
  property_price_sqm: number | null;
  transit_stop_density: number | null;
  air_quality_index: number | null;
  crime_index: number | null;
  daycare_density: number | null;
  school_density: number | null;
  healthcare_density: number | null;
  single_person_hh_pct: number | null;
  cycling_density: number | null;
  restaurant_density: number | null;
  grocery_density: number | null;
  sports_facility_density: number | null;
  // Historical time-series data (JSON-encoded arrays of [year, value] pairs)
  income_history: string | null;
  population_history: string | null;
  unemployment_history: string | null;
  // CF-7: property-price (€/m²) and crime (per 1,000) time-series
  property_price_history: string | null;
  crime_index_history: string | null;
  // CF-4: Computed change metrics (derived from history arrays)
  income_change_pct: number | null;
  population_change_pct: number | null;
  unemployment_change_pct: number | null;
  // CF-7: crime change derived from crime_index_history
  crime_index_change_pct: number | null;
  // Phase 7: New data layers
  voter_turnout_pct: number | null;
  party_diversity_index: number | null;
  broadband_coverage_pct: number | null;
  ev_charging_density: number | null;
  tree_canopy_pct: number | null;
  transit_reachability_score: number | null;
  // Quick wins — derived from existing Paavo fields
  youth_ratio_pct: number | null;
  gender_ratio: number | null;
  single_parent_hh_pct: number | null;
  families_with_children_pct: number | null;
  tech_sector_pct: number | null;
  healthcare_workers_pct: number | null;
  // Phase 8: More demographic detail + trends
  employment_rate: number | null;
  elderly_ratio_pct: number | null;
  avg_household_size: number | null;
  manufacturing_jobs_pct: number | null;
  public_sector_jobs_pct: number | null;
  service_sector_jobs_pct: number | null;
  new_construction_pct: number | null;
  // --- Raw Paavo fields used for quick-win metric computations ---
  /** Female population */
  he_naiset: number | null;
  /** Male population */
  he_miehet: number | null;
  /** Population aged 18–19 */
  he_18_19: number | null;
  /** Population aged 20–24 */
  he_20_24: number | null;
  /** Population aged 25–29 */
  he_25_29: number | null;
  /** Population aged 65–69 */
  he_65_69: number | null;
  /** Population aged 70–74 */
  he_70_74: number | null;
  /** Population aged 75–79 */
  he_75_79: number | null;
  /** Population aged 80–84 */
  he_80_84: number | null;
  /** Population aged 85+ */
  he_85_: number | null;
  /** Single-parent households (ei lapsiperhe = not a two-parent family) */
  te_eil_np: number | null;
  /** Households with children */
  te_laps: number | null;
  /** Total jobs in the area */
  tp_tyopy: number | null;
  /** Information sector jobs */
  tp_j_info: number | null;
  /** Health/social sector jobs */
  tp_q_terv: number | null;
  /** Manufacturing/secondary sector jobs */
  tp_jalo_bf: number | null;
  /** Public administration jobs */
  tp_o_julk: number | null;
  /** Service sector jobs */
  tp_palv_gu: number | null;
  /** Buildings under construction */
  ra_raky: number | null;
  // Phase 9: Real open data layers
  rental_price_sqm: number | null;
  price_to_rent_ratio: number | null;
  walkability_index: number | null;
  traffic_accident_rate: number | null;
  property_price_change_pct: number | null;
  school_quality_score: number | null;
  /** Individual lukios in this postal code that contributed to the aggregate
   *  school_quality_score (sorted score-desc). Null if no lukios in the area
   *  (in which case school_quality_score is either null or interpolated from
   *  neighbors). */
  schools?: Array<{ name: string; score: number }> | null;
  light_pollution: number | null;
  noise_pollution: number | null;
  // Phase 10: Water proximity & building age
  /** Minimum distance to nearest water body (meters) */
  water_proximity_m: number | null;
  /** Estimated weighted average construction year of dwellings */
  avg_construction_year: number | null;
  /** Marker for merged metro area features (not real postal code areas) */
  _isMetroArea?: boolean;
  /** Marker for a seutukunta with no ingested data — renders gray, panel is empty (CF-5 Phase D) */
  _noData?: boolean;
  [key: string]: string | number | boolean | null | undefined | Array<{ name: string; score: number }> | Record<string, number>;
}

/** A single data point in a time series: [year, value] */
export type TrendDataPoint = [number, number];

const trendParseCache = new Map<string, TrendDataPoint[] | null>();

/** Parse a JSON-encoded trend series from GeoJSON properties.
 *  Results are cached by string value — same JSON string returns the same array reference. */
export function parseTrendSeries(raw: string | null | undefined): TrendDataPoint[] | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const cached = trendParseCache.get(raw);
    if (cached !== undefined) return cached;
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.every(
        (p: unknown) =>
          Array.isArray(p) &&
          p.length === 2 &&
          typeof p[0] === 'number' &&
          typeof p[1] === 'number' &&
          isFinite(p[0]) &&
          isFinite(p[1]),
      )
    ) {
      if (typeof raw === 'string') trendParseCache.set(raw, parsed as TrendDataPoint[]);
      return parsed as TrendDataPoint[];
    }
  } catch {
    // invalid JSON
  }
  if (typeof raw === 'string') trendParseCache.set(raw, null);
  return null;
}

/**
 * Phase 7: Compute demographic detail metrics from existing Paavo fields.
 * These layers require no new data — they derive from fields already in the GeoJSON.
 */
export function computeQuickWinMetrics(features: GeoJSON.Feature[]): void {
  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    const pop = p.he_vakiy;

    // Youth ratio (18-29 year olds as % of population)
    const he_18_19 = p.he_18_19 as number | null;
    const he_20_24 = p.he_20_24 as number | null;
    const he_25_29 = p.he_25_29 as number | null;
    if (pop != null && pop > 0 && he_18_19 != null && he_20_24 != null && he_25_29 != null) {
      p.youth_ratio_pct = Math.round(((he_18_19 + he_20_24 + he_25_29) / pop) * 1000) / 10;
    }

    // Gender ratio (women / men)
    const naiset = p.he_naiset as number | null;
    const miehet = p.he_miehet as number | null;
    if (naiset != null && miehet != null && miehet > 0) {
      p.gender_ratio = Math.round((naiset / miehet) * 100) / 100;
    }

    // Single-parent households (% of total households)
    const eil_np = p.te_eil_np as number | null;
    const taly = p.te_taly as number | null;
    if (eil_np != null && taly != null && taly > 0) {
      p.single_parent_hh_pct = Math.round((eil_np / taly) * 1000) / 10;
    }

    // Families with children (% of total households)
    const te_laps = p.te_laps as number | null;
    if (te_laps != null && taly != null && taly > 0) {
      p.families_with_children_pct = Math.round((te_laps / taly) * 1000) / 10;
    }

    // Tech sector jobs (information sector / total jobs %)
    const tp_tyopy = p.tp_tyopy as number | null;
    const tp_jk_info = p.tp_j_info as number | null;
    if (tp_jk_info != null && tp_tyopy != null && tp_tyopy > 0) {
      p.tech_sector_pct = Math.round((tp_jk_info / tp_tyopy) * 1000) / 10;
    }

    // Healthcare workers (health/social sector / total jobs %)
    const tp_qr_terv = p.tp_q_terv as number | null;
    if (tp_qr_terv != null && tp_tyopy != null && tp_tyopy > 0) {
      p.healthcare_workers_pct = Math.round((tp_qr_terv / tp_tyopy) * 1000) / 10;
    }

    // Phase 8: Employment rate (employed / working-age population)
    const pt_tyoll = p.pt_tyoll as number | null;
    const pt_vakiy = p.pt_vakiy as number | null;
    if (pt_tyoll != null && pt_vakiy != null && pt_vakiy > 0) {
      p.employment_rate = Math.round((pt_tyoll / pt_vakiy) * 1000) / 10;
    }

    // Elderly ratio (65+ as % of population)
    const he_65_69 = p.he_65_69 as number | null;
    const he_70_74 = p.he_70_74 as number | null;
    const he_75_79 = p.he_75_79 as number | null;
    const he_80_84 = p.he_80_84 as number | null;
    const he_85_ = p.he_85_ as number | null;
    if (pop != null && pop > 0 && he_65_69 != null && he_70_74 != null && he_75_79 != null && he_80_84 != null && he_85_ != null) {
      p.elderly_ratio_pct = Math.round(((he_65_69 + he_70_74 + he_75_79 + he_80_84 + he_85_) / pop) * 1000) / 10;
    }

    // Average household size (population / households)
    if (pop != null && pop > 0 && taly != null && taly > 0) {
      p.avg_household_size = Math.round((pop / taly) * 100) / 100;
    }

    // Manufacturing jobs (secondary sector / total jobs %)
    const tp_jalo_bf = p.tp_jalo_bf as number | null;
    if (tp_jalo_bf != null && tp_tyopy != null && tp_tyopy > 0) {
      p.manufacturing_jobs_pct = Math.round((tp_jalo_bf / tp_tyopy) * 1000) / 10;
    }

    // Public sector jobs (public admin / total jobs %)
    const tp_o_julk = p.tp_o_julk as number | null;
    if (tp_o_julk != null && tp_tyopy != null && tp_tyopy > 0) {
      p.public_sector_jobs_pct = Math.round((tp_o_julk / tp_tyopy) * 1000) / 10;
    }

    // Service sector jobs (services / total jobs %)
    const tp_palv_gu = p.tp_palv_gu as number | null;
    if (tp_palv_gu != null && tp_tyopy != null && tp_tyopy > 0) {
      p.service_sector_jobs_pct = Math.round((tp_palv_gu / tp_tyopy) * 1000) / 10;
    }

    // New construction (buildings under construction / total buildings %)
    const ra_raky = p.ra_raky as number | null;
    const ra_asunn = p.ra_asunn;
    if (ra_raky != null && ra_asunn != null && ra_asunn > 0) {
      p.new_construction_pct = Math.round((ra_raky / ra_asunn) * 1000) / 10;
    }
  }
}

/**
 * CF-4: Compute year-over-year change from a trend series.
 * Returns the percentage change between the first and last data points.
 */
function computeChangePct(series: TrendDataPoint[] | null): number | null {
  if (!series || series.length < 2) return null;
  const first = series[0][1];
  const last = series[series.length - 1][1];
  if (!isFinite(first) || first === 0 || !isFinite(last)) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

/**
 * CF-4: Compute change metrics for all features from their history arrays.
 * Should be called after data is loaded.
 */
export function computeChangeMetrics(features: GeoJSON.Feature[]): void {
  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    p.income_change_pct = computeChangePct(parseTrendSeries(p.income_history));
    p.population_change_pct = computeChangePct(parseTrendSeries(p.population_history));
    p.unemployment_change_pct = computeChangePct(parseTrendSeries(p.unemployment_history));
    // CF-7: crime change from its history. property_price_change_pct stays as written
    // into the GeoJSON (kept consistent with the series by the data pipeline) so codes
    // without a fresh series keep their existing value.
    const crimeSeries = parseTrendSeries(p.crime_index_history);
    if (crimeSeries) p.crime_index_change_pct = computeChangePct(crimeSeries);
  }
}

// PO-2: history arrays that back the time slider / historical playback.
export const TIME_SERIES_HISTORY_PROPS = ['income_history', 'population_history', 'unemployment_history', 'property_price_history', 'crime_index_history'] as const;

/** Property key holding a single year's materialized value, e.g. `income_history__2023`. */
export function timeSeriesYearProp(historyProp: string, year: number): string {
  return `${historyProp}__${year}`;
}

/**
 * PO-2: Materialize each history array's [year, value] points into flat numeric
 * properties (`<historyProp>__<year>`) so the MapLibre fill-color expression can
 * read a single year's value via `['get', key]` — expressions can't index a
 * JSON-encoded array stored in a string property. Derived only; no new data.
 */
export function computeTimeSeriesValues(features: GeoJSON.Feature[]): void {
  for (const f of features) {
    const p = f.properties as Record<string, unknown>;
    for (const hp of TIME_SERIES_HISTORY_PROPS) {
      const series = parseTrendSeries(p[hp] as string | null);
      if (!series) continue;
      for (const [year, value] of series) {
        p[timeSeriesYearProp(hp, year)] = value;
      }
    }
  }
}

/** PO-2: Sorted union of years present in a given history property across features. */
export function getAvailableYears(features: GeoJSON.Feature[], historyProp: string): number[] {
  const years = new Set<number>();
  for (const f of features) {
    const series = parseTrendSeries((f.properties as Record<string, unknown>)[historyProp] as string | null);
    if (series) for (const [year] of series) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * IN-1: Data-driven metro average computation.
 * Each metric is defined once with its property name, weighting type, and rounding precision.
 * Adding a new layer is a one-line config change.
 */
type WeightType = 'population' | 'household' | 'count';

interface MetricDef {
  property: string;
  weight: WeightType;
  /** Decimal places for rounding (default: 1) */
  precision?: number;
  /** Require value > 0 to include (e.g., income) */
  requirePositive?: boolean;
  /** For percentage properties that need conversion from pct to count */
  pctOfPop?: boolean;
  /** For percentage properties weighted by household count */
  pctOfHh?: boolean;
  /** For percentage properties whose denominator is total jobs (tp_tyopy), e.g.
   *  sector employment shares. Population-weighting these biases the metro
   *  average toward residential population instead of where the jobs are. */
  pctOfJobs?: boolean;
}

/** Data source attribution for metrics shown in the neighborhood panel. */
export interface MetricSource {
  source: string;
  year: number | string;
}

/**
 * QW-5: Properties with a plain-language explanation under the `metric_explanation.*`
 * i18n key. NeighborhoodPanel uses this to decide whether to show an explanation
 * in the info popover alongside the source attribution.
 */
export const METRIC_EXPLANATIONS: ReadonlySet<string> = new Set([
  'he_vakiy', 'hr_mtu', 'hr_ktu', 'unemployment_rate', 'employment_rate',
  'higher_education_rate', 'property_price_sqm', 'foreign_language_pct',
  'population_density', 'child_ratio', 'student_share', 'single_person_hh_pct',
  'youth_ratio_pct', 'elderly_ratio_pct', 'gender_ratio', 'avg_household_size',
  'single_parent_hh_pct', 'families_with_children_pct', 'ownership_rate',
  'rental_rate', 'ra_as_kpa', 'detached_house_share', 'avg_construction_year',
  'new_construction_pct', 'rental_price_sqm', 'price_to_rent_ratio',
  'transit_stop_density', 'transit_reachability_score', 'air_quality_index',
  'crime_index', 'walkability_index', 'traffic_accident_rate', 'light_pollution',
  'noise_pollution', 'water_proximity_m', 'tree_canopy_pct', 'restaurant_density',
  'grocery_density', 'daycare_density', 'school_density', 'school_quality_score',
  'healthcare_density', 'sports_facility_density', 'cycling_density',
  'ev_charging_density', 'voter_turnout_pct', 'party_diversity_index',
  'broadband_coverage_pct', 'tech_sector_pct', 'healthcare_workers_pct',
  'manufacturing_jobs_pct', 'public_sector_jobs_pct', 'service_sector_jobs_pct',
  'property_price_change_pct',
]);

/** A publisher in the data-source registry (src/data/data_sources.json): the
 *  citable organization behind one or more metrics, with a clickable URL and license. */
export interface DataSourcePublisher {
  name: string;
  url: string;
  license: string;
}

/** A metric's registry row resolved together with its publisher's URL/license. */
export interface ResolvedMetricSource extends MetricSource {
  /** Publisher id (key into DATA_SOURCE_PUBLISHERS) */
  publisher: string;
  /** Publisher display name (e.g. "Tilastokeskus") */
  publisherName: string;
  /** Clickable canonical source URL */
  url: string;
  /** Data license, e.g. "CC BY 4.0" / "ODbL 1.0" */
  license: string;
  /** Finest resolution actually shipped: "postal" | "250m grid" | "derived" */
  granularity: string;
  /** True when the value is a regression/derived estimate, not a direct measurement */
  isProxy: boolean;
  /** PO-4: optional clarifying caveat for proxy/derived/partial metrics, stored as an
   *  i18n KEY (e.g. "note.transit_reachability") — render via t(note) so only bundled
   *  fi.json carries the prose. Covers regression estimates, OSM composites, distributed
   *  municipality figures, mixed-survey vintages, and largest-municipality-only coverage. */
  note?: string;
  /** PO-6: year the upstream source was last published before being retired. Set
   *  only for frozen/discontinued sources (e.g. the postal-code rent table); the
   *  value can never refresh past this year. */
  discontinued?: number;
}

interface RegistryMetricEntry {
  source: string;
  publisher: string;
  vintage: number | string;
  granularity: string;
  is_proxy: boolean;
  /** false only for values computed purely client-side (absent from the GeoJSON) */
  stored?: boolean;
  /** false to keep a derived/composite metric out of the per-row attribution map */
  panel?: boolean;
  /** PO-4: i18n KEY for a caveat note (e.g. "note.walkability"); rendered via t(note). */
  note?: string;
  /** PO-6: last-published year for a retired/frozen upstream source */
  discontinued?: number;
}

interface DataSourceRegistry {
  publishers: Record<string, DataSourcePublisher>;
  metrics: Record<string, RegistryMetricEntry>;
}

// IN-2: single source-of-truth registry. METRIC_SOURCES below and the richer
// getMetricSource() accessor are both generated from it, so the URL-less,
// hand-maintained attribution map can no longer silently drift from the
// documented, dated, licensed sources. Parity is enforced by
// src/__tests__/dataSourceRegistry.test.ts and scripts/validate_data.py.
const REGISTRY = dataSources as unknown as DataSourceRegistry;

/** All publishers in the data-source registry, keyed by publisher id. */
export const DATA_SOURCE_PUBLISHERS: Record<string, DataSourcePublisher> = REGISTRY.publishers;

/** Raw per-metric registry rows, keyed by GeoJSON property. */
export const DATA_SOURCE_METRICS: Record<string, RegistryMetricEntry> = REGISTRY.metrics;

/**
 * Resolve a metric property to its full registry entry — source label, vintage,
 * clickable URL, license, granularity, and proxy flag. Returns undefined when the
 * property has no registry row. Backs the public sources page (CF-9), the proxy
 * badge (PO-2), and the per-layer freshness panel (PO-3).
 */
export function getMetricSource(property: string): ResolvedMetricSource | undefined {
  const entry = REGISTRY.metrics[property];
  if (!entry) return undefined;
  const pub = REGISTRY.publishers[entry.publisher];
  return {
    source: entry.source,
    year: entry.vintage,
    publisher: entry.publisher,
    publisherName: pub?.name ?? entry.publisher,
    url: pub?.url ?? '',
    license: pub?.license ?? '',
    granularity: entry.granularity,
    isProxy: entry.is_proxy,
    note: entry.note,
    discontinued: entry.discontinued,
  };
}

/**
 * PO-2: Compact per-metric coverage map ({ property: coverage_pct }) inlined at
 * build time from src/data/build_metadata.json via Vite's `__COVERAGE_PCT__`
 * define (see vite.config.ts). coverage_pct is the share of the 3,018 metro
 * postal codes that carry a real value for the metric — it is computed FROM the
 * registry by the data pipeline, so it is read here, never folded back in.
 */
const COVERAGE_PCT: Record<string, number> =
  typeof __COVERAGE_PCT__ !== 'undefined' ? __COVERAGE_PCT__ : {};

/**
 * PO-2: real coverage (% of metro postal codes with a value) for a metric, or
 * null when build_metadata.json carries no coverage_pct for it. Degrades to null
 * rather than fabricating a number, so the UI can simply omit the caption/column.
 */
export function getCoveragePct(property: string): number | null {
  const v = COVERAGE_PCT[property];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * PO-2: a layer counts as "partial coverage" (worth a subtle caption) when a real
 * coverage value exists and falls below this share of postal codes. ~95% leaves
 * the near-complete Paavo layers (97–100%) unflagged while surfacing the genuinely
 * sparse ones (transit ~11%, school quality ~10%, property price ~30%, rent ~16%).
 */
export const PARTIAL_COVERAGE_THRESHOLD = 95;

/**
 * PO-2: a layer is "low coverage" (worth a prominent warning banner, not just a
 * caption) when under half the postal codes carry a value. Below this point the
 * gray no-data polygons dominate the map and the choropleth is easy to misread.
 */
export const LOW_COVERAGE_THRESHOLD = 50;

/** PO-2: true when a metric has a real, below-threshold coverage value. */
export function isPartialCoverage(property: string): boolean {
  const c = getCoveragePct(property);
  return c != null && c < PARTIAL_COVERAGE_THRESHOLD;
}

/** PO-2: true when a metric has real coverage below the low-coverage threshold. */
export function isLowCoverage(property: string): boolean {
  const c = getCoveragePct(property);
  return c != null && c < LOW_COVERAGE_THRESHOLD;
}

/** PO-2: format a coverage fraction for display — whole-percent for clean values,
 *  one decimal otherwise (e.g. 100 → "100", 10.9 → "10.9"). */
export function formatCoveragePct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/**
 * PO-3: extract the most recent calendar year from a registry vintage, which may
 * be a number (2024) or a range string ("2012–2022", "2020–2025"). Used to flag
 * stale layers. Returns null when no 4-digit year is present.
 */
export function latestVintageYear(year: number | string | undefined | null): number | null {
  if (year == null) return null;
  if (typeof year === 'number') return Number.isFinite(year) ? year : null;
  const matches = String(year).match(/\d{4}/g);
  if (!matches) return null;
  return Math.max(...matches.map(Number));
}

/** PO-3: a layer is flagged "stale" when its newest data year is more than this many years old. */
export const STALE_VINTAGE_YEARS = 3;

/**
 * PO-3: reference "current year" for freshness math. Fixed (not `new Date()`) so
 * the staleness UI is deterministic across builds and tests — it tracks the dataset
 * build vintage, not the wall clock, and is bumped alongside the data refresh. Kept
 * in step with build_metadata.json's `generated` year.
 */
export const NOW_YEAR = 2026;

/** PO-3: per-layer freshness derived from a registry vintage. */
export interface VintageFreshness {
  /** Newest calendar year in the vintage (e.g. 2022 from "2012–2022"). */
  latest: number;
  /** Whole years between `latest` and NOW_YEAR (0 when same year or in the future). */
  yearsAgo: number;
  /** True when older than the staleness threshold (worth an amber flag). */
  isStale: boolean;
}

/**
 * PO-3: resolve a registry vintage to its freshness — newest year, whole years
 * since then, and whether that exceeds STALE_VINTAGE_YEARS. Returns null when the
 * vintage carries no usable year, so callers can simply omit the indicator.
 */
export function vintageFreshness(year: number | string | undefined | null): VintageFreshness | null {
  const latest = latestVintageYear(year);
  if (latest == null) return null;
  const yearsAgo = Math.max(0, NOW_YEAR - latest);
  return { latest, yearsAgo, isStale: yearsAgo > STALE_VINTAGE_YEARS };
}

/**
 * Maps GeoJSON property names to their data source and year, generated from the
 * single source-of-truth registry (src/data/data_sources.json). Derived/composite
 * metrics flagged `panel: false` in the registry (the quality index and the
 * *_change layers) are excluded — they are not direct measurements with a per-row
 * source. NeighborhoodPanel and the profile StatCard read this for attribution.
 */
export const METRIC_SOURCES: Record<string, MetricSource> = Object.fromEntries(
  Object.entries(REGISTRY.metrics)
    .filter(([, e]) => e.panel !== false)
    .map(([prop, e]) => [prop, { source: e.source, year: e.vintage }]),
);

const METRIC_DEFS: MetricDef[] = [
  // Economy
  { property: 'hr_mtu', weight: 'population', precision: 0, requirePositive: true },
  { property: 'hr_ktu', weight: 'population', precision: 0, requirePositive: true },
  { property: 'property_price_sqm', weight: 'population', precision: 0, requirePositive: true },
  { property: 'ra_as_kpa', weight: 'population', precision: 1, requirePositive: true },

  // Demographics
  { property: 'he_kika', weight: 'population', precision: 1 },

  // Quality of life
  { property: 'quality_index', weight: 'population', precision: 1 },
  { property: 'transit_stop_density', weight: 'population', precision: 1 },
  { property: 'air_quality_index', weight: 'population', precision: 1 },
  { property: 'crime_index', weight: 'population', precision: 1 },

  // Services
  { property: 'daycare_density', weight: 'population', precision: 1 },
  { property: 'school_density', weight: 'population', precision: 1 },
  { property: 'healthcare_density', weight: 'population', precision: 1 },
  { property: 'restaurant_density', weight: 'population', precision: 1 },
  { property: 'grocery_density', weight: 'population', precision: 1 },
  { property: 'sports_facility_density', weight: 'population', precision: 1 },

  // Demographics
  { property: 'foreign_language_pct', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'single_person_hh_pct', weight: 'household', precision: 1, pctOfHh: true },

  // Mobility
  { property: 'cycling_density', weight: 'population', precision: 1 },

  // Phase 7: New layers
  { property: 'voter_turnout_pct', weight: 'population', precision: 1 },
  { property: 'party_diversity_index', weight: 'population', precision: 2 },
  { property: 'broadband_coverage_pct', weight: 'population', precision: 1 },
  { property: 'ev_charging_density', weight: 'population', precision: 1 },
  { property: 'tree_canopy_pct', weight: 'population', precision: 1 },
  { property: 'transit_reachability_score', weight: 'population', precision: 1 },
  { property: 'youth_ratio_pct', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'single_parent_hh_pct', weight: 'household', precision: 1, pctOfHh: true },
  { property: 'families_with_children_pct', weight: 'household', precision: 1, pctOfHh: true },
  { property: 'gender_ratio', weight: 'population', precision: 2 },
  { property: 'tech_sector_pct', weight: 'count', precision: 1, pctOfJobs: true },
  { property: 'healthcare_workers_pct', weight: 'count', precision: 1, pctOfJobs: true },
  // Phase 8: More demographic detail + trends
  // employment_rate is handled as a special ratio below (totalEmployed / totalActPop)
  { property: 'elderly_ratio_pct', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'avg_household_size', weight: 'population', precision: 2 },
  { property: 'manufacturing_jobs_pct', weight: 'count', precision: 1, pctOfJobs: true },
  { property: 'public_sector_jobs_pct', weight: 'count', precision: 1, pctOfJobs: true },
  { property: 'service_sector_jobs_pct', weight: 'count', precision: 1, pctOfJobs: true },
  { property: 'new_construction_pct', weight: 'population', precision: 1 },
  // Phase 9: Real open data layers
  { property: 'rental_price_sqm', weight: 'population', precision: 2, requirePositive: true },
  { property: 'price_to_rent_ratio', weight: 'population', precision: 1, requirePositive: true },
  { property: 'walkability_index', weight: 'population', precision: 0 },
  { property: 'traffic_accident_rate', weight: 'population', precision: 1 },
  { property: 'property_price_change_pct', weight: 'population', precision: 1 },
  { property: 'school_quality_score', weight: 'population', precision: 0 },
  { property: 'light_pollution', weight: 'population', precision: 1 },
  { property: 'noise_pollution', weight: 'population', precision: 1 },
  // Phase 10: Water proximity & building age
  { property: 'water_proximity_m', weight: 'population', precision: 0 },
  { property: 'avg_construction_year', weight: 'population', precision: 0 },
];

function roundTo(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * Compute population-weighted (or household-weighted) metro-wide averages for all metrics.
 *
 * Some metrics are ratio-based (e.g., unemployment rate) and need special handling:
 * raw counts are summed and divided at the end rather than averaging percentages directly.
 * Data-driven metrics use the METRIC_DEFS config array; adding a new metric is a one-line change.
 */
export function computeMetroAverages(features: GeoJSON.Feature[]): Record<string, number> {
  // Accumulators for data-driven metrics
  const totals: Record<string, number> = {};
  const weights: Record<string, number> = {};
  for (const def of METRIC_DEFS) {
    totals[def.property] = 0;
    weights[def.property] = 0;
  }

  // Accumulators for special ratio-based metrics that can't be data-driven
  let totalPop = 0;
  let totalUnemployed = 0;
  let totalKoYlKork = 0;
  let totalKoAlKork = 0;
  let totalKoAmmat = 0;
  let totalKoPerus = 0;
  let totalAdultPop = 0;
  let totalOwnerOcc = 0;
  let totalHouseholds = 0;
  let totalRental = 0;
  let totalStudents = 0;
  let totalActPop = 0;
  let totalChildren = 0;
  let totalArea = 0;
  let totalDetached = 0;
  let totalDwellings = 0;
  let totalPensioners = 0;
  let totalEmployed = 0;

  // Per-numerator data-presence flags. Without these, a region that has
  // population but no employment/education/housing counts ingested would
  // emit a fabricated 0% (because totalActPop falls back to pop and totalX
  // stays at 0) — making the all-Finland choropleth color it as "0%" instead
  // of rendering gray for "no data".
  let hasUnemployedData = false;
  let hasEmployedData = false;
  let hasStudentData = false;
  let hasHigherEdData = false;
  let hasOwnershipData = false;
  let hasRentalData = false;
  let hasChildrenData = false;
  let hasPensionerData = false;
  let hasDetachedData = false;

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    const pop = p.he_vakiy;
    if (pop == null || pop <= 0) continue;

    totalPop += pop;

    // Count-based special metrics
    if (p.pt_tyoll != null) { totalEmployed += p.pt_tyoll; hasEmployedData = true; }
    if (p.pt_tyott != null) { totalUnemployed += p.pt_tyott; hasUnemployedData = true; }
    if (p.ko_yl_kork != null) { totalKoYlKork += p.ko_yl_kork; hasHigherEdData = true; }
    if (p.ko_al_kork != null) { totalKoAlKork += p.ko_al_kork; hasHigherEdData = true; }
    if (p.ko_ammat != null) totalKoAmmat += p.ko_ammat;
    if (p.ko_perus != null) totalKoPerus += p.ko_perus;
    if (p.ko_ika18y != null) totalAdultPop += p.ko_ika18y;
    if (p.te_omis_as != null) { totalOwnerOcc += p.te_omis_as; hasOwnershipData = true; }
    if (p.te_taly != null) totalHouseholds += p.te_taly;
    if (p.te_vuok_as != null) { totalRental += p.te_vuok_as; hasRentalData = true; }
    if (p.pt_opisk != null) { totalStudents += p.pt_opisk; hasStudentData = true; }
    if (p.pt_vakiy != null) totalActPop += p.pt_vakiy;
    else totalActPop += pop;
    if (p.he_0_2 != null) { totalChildren += p.he_0_2; hasChildrenData = true; }
    if (p.he_3_6 != null) { totalChildren += p.he_3_6; hasChildrenData = true; }
    if (p.pinta_ala != null) totalArea += p.pinta_ala;
    if (p.ra_pt_as != null) { totalDetached += p.ra_pt_as; hasDetachedData = true; }
    if (p.ra_asunn != null) totalDwellings += p.ra_asunn;
    if (p.pt_elakel != null) { totalPensioners += p.pt_elakel; hasPensionerData = true; }

    // Data-driven weighted metrics
    for (const def of METRIC_DEFS) {
      const value = p[def.property] as number | null;
      if (value == null || !isFinite(value as number)) continue;
      if (def.requirePositive && value <= 0) continue;

      const w = def.weight === 'household' ? (p.te_taly ?? 0) : pop;
      if (w <= 0) continue;

      if (def.pctOfPop) {
        // Percentage of population: accumulate count, not pct
        totals[def.property] += (value / 100) * pop;
        weights[def.property] += pop;
      } else if (def.pctOfHh) {
        // Percentage of households
        totals[def.property] += (value / 100) * (p.te_taly ?? 0);
        weights[def.property] += p.te_taly ?? 0;
      } else if (def.pctOfJobs) {
        // Percentage of total jobs: weight by jobs count so the metro average
        // equals sum(sector jobs) / sum(all jobs), not a population-weighted blend.
        const jobs = p.tp_tyopy;
        if (jobs == null || jobs <= 0) continue;
        totals[def.property] += (value / 100) * jobs;
        weights[def.property] += jobs;
      } else {
        totals[def.property] += value * w;
        weights[def.property] += w;
      }
    }
  }

  // Build result from data-driven metrics.
  // Properties with no data (weight === 0 / denominator === 0) are left absent
  // so the choropleth's `has` check fails and the region renders gray, and
  // tooltip/panel null-checks show "no data" instead of "0".
  const result: Record<string, number> = {};

  for (const def of METRIC_DEFS) {
    const w = weights[def.property];
    if (w <= 0) continue;
    const precision = def.precision ?? 1;
    if (def.pctOfPop || def.pctOfHh || def.pctOfJobs) {
      result[def.property] = roundTo((totals[def.property] / w) * 100, precision);
    } else {
      result[def.property] = roundTo(totals[def.property] / w, precision);
    }
  }

  // Add special ratio-based metrics. Each ratio is emitted only when both the
  // denominator > 0 AND at least one feature contributed numerator data —
  // otherwise the key is left absent so the all-Finland choropleth renders the
  // region gray instead of as a fabricated 0%.
  result.he_vakiy = totalPop;
  if (totalActPop > 0) {
    if (hasUnemployedData) {
      result.unemployment_rate = roundTo((totalUnemployed / totalActPop) * 100, 1);
    }
    if (hasStudentData) {
      result.student_share = roundTo((totalStudents / totalActPop) * 100, 1);
    }
    if (hasEmployedData) {
      result.employment_rate = roundTo((totalEmployed / totalActPop) * 100, 1);
    }
  }
  if (totalAdultPop > 0 && hasHigherEdData) {
    result.higher_education_rate = roundTo(((totalKoYlKork + totalKoAlKork) / totalAdultPop) * 100, 1);
  }
  if (totalHouseholds > 0) {
    if (hasOwnershipData) {
      result.ownership_rate = roundTo((totalOwnerOcc / totalHouseholds) * 100, 1);
    }
    if (hasRentalData) {
      result.rental_rate = roundTo((totalRental / totalHouseholds) * 100, 1);
    }
  }
  if (totalArea > 0) {
    result.population_density = Math.round(totalPop / (totalArea / 1_000_000));
  }
  if (totalPop > 0) {
    if (hasChildrenData) {
      result.child_ratio = roundTo((totalChildren / totalPop) * 100, 1);
    }
    if (hasPensionerData) {
      result.pensioner_share = roundTo((totalPensioners / totalPop) * 100, 1);
    }
  }
  if (totalDwellings > 0 && hasDetachedData) {
    result.detached_house_share = roundTo((totalDetached / totalDwellings) * 100, 1);
  }

  // Raw counts: the panel's Education Breakdown and Activity Status sections
  // read these directly (they show counts, not rates), so the metro-area
  // feature must carry them or those sections render blank.
  result.ko_yl_kork = totalKoYlKork;
  result.ko_al_kork = totalKoAlKork;
  result.ko_ammat = totalKoAmmat;
  result.ko_perus = totalKoPerus;
  result.pt_tyoll = totalEmployed;
  result.pt_tyott = totalUnemployed;
  result.pt_opisk = totalStudents;
  result.pt_elakel = totalPensioners;

  return result;
}
