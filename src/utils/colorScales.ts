import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { formatYtlGrade, formatYtlGradeFull } from './formatting';
import { getQualityBands } from './qualityBands';

/**
 * Identifier for each data layer available on the map.
 * Maps 1:1 to entries in the LAYERS array and to GeoJSON feature properties.
 */
export type LayerId =
  | 'quality_index'
  | 'median_income'
  | 'disposable_income'
  | 'low_income'
  | 'job_self_sufficiency'
  | 'unemployment'
  | 'education'
  | 'foreign_lang'
  | 'foreign_lang_municipal'
  | 'avg_age'
  | 'pensioners'
  | 'ownership'
  | 'rental'
  | 'apt_size'
  | 'living_space'
  | 'detached_houses'
  | 'student_share'
  | 'population_density'
  | 'child_ratio'
  | 'property_price'
  | 'transit_access'
  | 'air_quality'
  | 'crime_rate'
  | 'daycare_density'
  | 'school_density'
  | 'healthcare_access'
  | 'single_person_hh'
  | 'cycling_infra'
  | 'restaurant_density'
  | 'grocery_access'
  | 'sports_facilities'
  | 'income_change'
  | 'population_change'
  | 'population_projection'
  | 'unemployment_change'
  | 'crime_index_change'
  // Crime sub-groups. Siblings under the total, so they never double-count it.
  | 'violent_crime'
  | 'property_crime'
  // Phase 7: New data layers
  | 'voter_turnout'
  | 'party_diversity'
  // Voting preferences — 2023 parliamentary election (eduskuntavaalit)
  | 'political_lean'
  | 'party_kok'
  | 'party_sdp'
  | 'party_ps'
  | 'party_kesk'
  | 'party_vihr'
  | 'party_vas'
  | 'party_rkp'
  | 'broadband_coverage'
  | 'ev_charging_density'
  | 'tree_canopy'
  | 'transit_reachability'
  // Quick wins from existing GeoJSON data
  | 'youth_ratio'
  | 'gender_ratio'
  | 'single_parent_hh'
  | 'families_with_children'
  | 'tech_sector_jobs'
  | 'healthcare_workers'
  // Phase 8: More demographic detail + trends
  | 'employment_rate'
  | 'elderly_ratio'
  | 'avg_household_size'
  | 'manufacturing_jobs'
  | 'public_sector_jobs'
  | 'service_sector_jobs'
  | 'new_construction'
  // Phase 9: Real open data layers
  | 'rental_price'
  | 'price_to_rent'
  | 'walkability'
  | 'traffic_accidents'
  | 'property_price_change'
  | 'school_quality'
  | 'light_pollution'
  | 'noise_pollution'
  // Phase 10: Water proximity & building age
  | 'water_proximity'
  | 'building_age'
  // Roadmap CF-19/CF-21: environment & health
  | 'radon'
  | 'health_index'
  // CF-20: flood-risk exposure
  | 'flood_risk'
  // CF-11: construction activity (municipal new-dwelling flow, per 1,000 res.)
  | 'construction_activity'
  // CF-5: planning & development activity (real geometry-derived per-postal count)
  | 'active_plan_count';

// PO-2: layers that carry a 5-year history array and can be scrubbed with the
// time slider. Maps the active LayerId to the history property whose per-year
// values share the layer's color scale (so the animation shows real change).
export const TIME_SERIES_LAYERS: Partial<Record<LayerId, string>> = {
  median_income: 'income_history',
  unemployment: 'unemployment_history',
  // CF-7: property prices (€/m²) and crime (per 1,000) now carry a real year series.
  property_price: 'property_price_history',
  crime_rate: 'crime_index_history',
  // Foreign-language postal layer is a time series: 2020 is real postal data,
  // 2021- is an is_proxy estimate (2020 distribution scaled by the municipal share
  // change). Scrub the slider to compare years; foreign_lang_municipal shows the
  // separate flat real current municipal share.
  foreign_lang: 'foreign_language_history',
};

/**
 * Configuration for a single data layer displayed on the map.
 *
 * Each layer defines how a GeoJSON property is visualized as a choropleth:
 * - `id` is a unique LayerId used in URL state and layer switching
 * - `property` is the key on NeighborhoodProperties to read
 * - `colors` and `stops` define the interpolated color scale (must be same length)
 * - `format` converts raw values to display strings (e.g., "25 000 €")
 * - `labelKey` is a translation key resolved via `t()` from i18n
 * - `gridProperty` (optional) maps to a sub-postal-code grid data layer
 *
 * Grouping in the LayerSelector UI is not configured here — it lives in
 * LAYER_GROUPS in src/components/LayerSelector.tsx.
 */
export interface LayerConfig {
  id: LayerId;
  labelKey: string;
  /** GeoJSON feature property name to read the value from */
  property: string;
  unit: string;
  /** Hex color values for the interpolated scale, aligned with `stops` */
  colors: string[];
  /** Breakpoint values for the color scale, aligned with `colors` */
  stops: number[];
  /** Format a raw value for display in tooltips, legends, and panels */
  format: (v: number) => string;
  /**
   * Optional verbose formatter used by the hover tooltip's aggregate value.
   * Falls back to `format` when omitted. Used to surface extra detail
   * (e.g. the 0-7 mean grade alongside the YTL letter) without bloating
   * legend tick labels.
   */
  tooltipFormat?: (v: number) => string;
  /**
   * Whether higher values are "better" for this metric.
   * Used by Tooltip and comparison displays to color differences correctly.
   * Defaults to true if not specified.
   */
  higherIsBetter?: boolean;
  /**
   * When true, this layer has a fine-grained grid dataset (e.g. 250m cells)
   * that can be rendered instead of the postal-code choropleth.
   * The grid data property name used for coloring the cells.
   */
  gridProperty?: string;
  /**
   * For diverging color scales, the data value the palette's neutral midpoint
   * must stay pinned to when rescaling to a region's data range (e.g. 0 for
   * change-over-time layers, 1.0 for gender_ratio). Omit for sequential scales —
   * those are simply spread evenly across [min, max]. Without this, rescaling a
   * diverging layer moves the neutral color off-center and inverts its meaning.
   */
  divergingCenter?: number;
}

import { getLang } from './i18n';

// Cache Intl.NumberFormat per locale to avoid recreating on every format call.
// These format functions run on the tooltip hot path (~60Hz mousemove).
let _fmtLocale = '';
let _fmtNum: Intl.NumberFormat | null = null;

function numFmt(opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  // PO-7: Swedish maps to sv-SE (was silently falling through to fi-FI).
  const lang = getLang();
  const loc = lang === 'en' ? 'en-US' : lang === 'sv' ? 'sv-SE' : 'fi-FI';
  // Only the default (option-less) formatter is cached — it is the hot one, hit
  // on every tooltip repaint. Callers passing options are rare (legend rows).
  if (opts) return new Intl.NumberFormat(loc, opts);
  if (_fmtNum && _fmtLocale === loc) return _fmtNum;
  _fmtLocale = loc;
  _fmtNum = new Intl.NumberFormat(loc);
  return _fmtNum;
}

const euro = (v: number) => `${numFmt().format(v)} €`;
const pct = (v: number) => `${v.toFixed(1)} %`;
// QW-1: whole-number percent — job_self_sufficiency can reach tens of thousands in a tiny
// residential postal code hosting a large employer, where a one-decimal format is unusable.
const wholePct = (v: number) => `${numFmt().format(Math.round(v))} %`;
const age = (v: number) => `${v.toFixed(1)}`;
// Service densities in Finland are genuinely long-tailed: the median non-zero
// grocery density is 0.04/km² and the max is 14.5. Intl's default 3-decimal cap
// renders the small end as "0,004" — technically right, but three near-identical
// legend rows. Two significant figures below 1 keeps them distinguishable
// without inventing precision.
const density = (v: number) => {
  const abs = Math.abs(v);
  const opts: Intl.NumberFormatOptions =
    abs > 0 && abs < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 };
  return `${numFmt(opts).format(v)} /km²`;
};
const sqm = (v: number) => `${v.toFixed(1)} m²`;
const euroSqm = (v: number) => `${numFmt().format(v)} €/m²`;
const euroSqmMonth = (v: number) => `${v.toFixed(2)} €/m²/kk`;
const stops = (v: number) => `${v.toFixed(1)} /km²`;
const perThousand = (v: number) => `${v.toFixed(1)} /1000`;
const gini = (v: number) => `${v.toFixed(2)}`;
const score = (v: number) => `${v.toFixed(0)}/100`;
const radiance = (v: number) => `${v.toFixed(1)} nW/cm²/sr`;
const decibel = (v: number) => `${v.toFixed(1)} dB`;
// CF-19: radon median concentration (whole Bq/m³); CF-21: morbidity index (100 = avg).
const bq = (v: number) => `${numFmt().format(Math.round(v))} Bq/m³`;
const years = (v: number) => `${v.toFixed(1)} v`;
const meters = (v: number) => `${numFmt().format(v)} m`;
const yearFmt = (v: number) => `${v.toFixed(0)}`;
// CF-5: a whole-number count of nearby kaavat & hankkeet (planning entries).
const count = (v: number) => numFmt().format(Math.round(v));

export const LAYERS: LayerConfig[] = [
  {
    id: 'quality_index',
    labelKey: 'layer.quality_index',
    property: 'quality_index',
    unit: '',
    colors: ['#7c3aed', '#a855f7', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e', '#14b8a6'],
    stops: [0, 14, 28, 43, 57, 71, 86, 100],
    format: (v: number) => v.toFixed(0),
  },
  {
    id: 'median_income',
    labelKey: 'layer.median_income',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#1a1a2e', '#16213e', '#0f3460', '#1a759f', '#34a0a4', '#76c893', '#b5e48c', '#d9ed92'],
    stops: [15000, 20000, 25000, 30000, 35000, 40000, 45000, 55000],
    format: euro,
  },
  {
    // QW-1: median household DISPOSABLE income (tr_mtu, after tax+transfers) —
    // distinct from median_income (hr_mtu, residents' taxable income).
    id: 'disposable_income',
    labelKey: 'layer.disposable_income',
    property: 'tr_mtu',
    unit: '€',
    colors: ['#1a1a2e', '#16213e', '#0f3460', '#1a759f', '#34a0a4', '#76c893', '#b5e48c', '#d9ed92'],
    stops: [25000, 30000, 35000, 40000, 45000, 50000, 60000, 75000],
    format: euro,
  },
  {
    // QW-1: share of households in the lowest national income decile (hr_pi_tul / hr_tuy).
    // A new income axis beyond central tendency — two areas with the same €31k median can be
    // a stable middle-income suburb or a polarised one. Higher share = worse (deep red).
    id: 'low_income',
    labelKey: 'layer.low_income',
    property: 'low_income_pct',
    unit: '%',
    colors: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d'],
    stops: [8, 12, 16, 20, 24, 28, 34, 45],
    format: pct,
    higherIsBetter: false,
  },
  {
    // QW-1: jobs located in the area per 100 employed residents (tp_tyopy / pt_tyoll) — the
    // closest thing to a commute signal at postal granularity. Diverging around 100: blue =
    // residential/commuter (<100), red = employment hub (>100); city centres exceed 300.
    id: 'job_self_sufficiency',
    labelKey: 'layer.job_self_sufficiency',
    property: 'job_self_sufficiency',
    unit: '%',
    colors: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
    stops: [40, 60, 80, 100, 140, 200, 300, 500],
    format: wholePct,
    divergingCenter: 100,
  },
  {
    id: 'unemployment',
    labelKey: 'layer.unemployment',
    property: 'unemployment_rate',
    unit: '%',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#ffffbf', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    stops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
    format: pct,
    higherIsBetter: false,
  },
  {
    id: 'education',
    labelKey: 'layer.education',
    property: 'higher_education_rate',
    unit: '%',
    colors: ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#7b2d8e', '#e94560', '#f38375', '#f8c291'],
    stops: [10, 20, 30, 40, 50, 60, 70, 80],
    format: pct,
  },
  // Foreign-language postal layer = a time series. The scalar property is the latest
  // year's ESTIMATE (is_proxy); foreign_language_history carries [[2020, real],
  // [2021, est], ...] for the year slider. 2020 is real postal data; later years scale
  // the 2020 within-city distribution per municipality by the StatFin vaerak 159t share
  // change — open postal-code language data exists only for 2020. The estimate disclaimer
  // and method are in metric_explanation.foreign_language_est_pct + note.foreign_language_estimate.
  {
    id: 'foreign_lang',
    labelKey: 'layer.foreign_lang',
    property: 'foreign_language_est_pct',
    unit: '%',
    colors: ['#f0f0f0', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#980043', '#67001f'],
    stops: [2, 5, 10, 15, 20, 25, 35, 50],
    format: pct,
  },
  // Real LATEST-year municipal foreign-language share (StatFin vaerak 159t) assigned
  // flat to every postal code of the municipality (is_proxy — a real municipal figure
  // shown at a finer granularity). Uniform within each city; same palette/stops as
  // foreign_lang. A current companion to the 2020 postal layer.
  {
    id: 'foreign_lang_municipal',
    labelKey: 'layer.foreign_lang_municipal',
    property: 'foreign_language_municipal_pct',
    unit: '%',
    colors: ['#f0f0f0', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#980043', '#67001f'],
    stops: [2, 5, 10, 15, 20, 25, 35, 50],
    format: pct,
  },
  {
    id: 'avg_age',
    labelKey: 'layer.avg_age',
    property: 'he_kika',
    unit: '',
    colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'],
    stops: [28, 32, 36, 38, 40, 42, 45, 50],
    format: age,
  },
  {
    id: 'pensioners',
    labelKey: 'layer.pensioners',
    property: 'pensioner_share',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
  // --- Phase 1: Housing & Demographics ---
  {
    id: 'ownership',
    labelKey: 'layer.ownership',
    property: 'ownership_rate',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  {
    id: 'rental',
    labelKey: 'layer.rental',
    property: 'rental_rate',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  {
    id: 'apt_size',
    labelKey: 'layer.apt_size',
    property: 'ra_as_kpa',
    unit: 'm²',
    colors: ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
    stops: [30, 40, 50, 60, 70, 80, 90, 110],
    format: sqm,
  },
  {
    // QW-1: living space per person (te_as_valj, m²/person) — the most concrete
    // crowding signal, distinct from apt_size (ra_as_kpa, dwelling m²).
    id: 'living_space',
    labelKey: 'layer.living_space',
    property: 'te_as_valj',
    unit: 'm²',
    colors: ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
    stops: [32, 38, 42, 46, 50, 54, 58, 64],
    format: sqm,
  },
  {
    id: 'detached_houses',
    labelKey: 'layer.detached_houses',
    property: 'detached_house_share',
    unit: '%',
    colors: ['#f7fcfd', '#e5f5f9', '#ccece6', '#99d8c9', '#66c2a4', '#41ae76', '#238b45', '#005824'],
    stops: [0, 5, 10, 20, 30, 40, 55, 75],
    format: pct,
  },
  {
    id: 'student_share',
    labelKey: 'layer.student_share',
    property: 'student_share',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  {
    id: 'population_density',
    labelKey: 'layer.population_density',
    property: 'population_density',
    unit: '/km²',
    colors: ['#fff7ec', '#fee8c8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#d7301f', '#990000'],
    stops: [500, 1000, 2000, 4000, 6000, 8000, 12000, 20000],
    format: density,
  },
  {
    id: 'child_ratio',
    labelKey: 'layer.child_ratio',
    property: 'child_ratio',
    unit: '%',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [2, 4, 6, 8, 10, 12, 15, 20],
    format: pct,
  },
  // --- Phase 2: External data ---
  {
    id: 'property_price',
    labelKey: 'layer.property_price',
    property: 'property_price_sqm',
    unit: '€/m²',
    colors: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    stops: [1000, 2000, 3000, 4000, 5000, 6000, 8000, 12000],
    format: euroSqm,
  },
  {
    id: 'transit_access',
    labelKey: 'layer.transit_access',
    property: 'transit_stop_density',
    unit: '/km²',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [5, 10, 20, 40, 60, 80, 120, 200],
    format: stops,
  },
  {
    id: 'air_quality',
    labelKey: 'layer.air_quality',
    property: 'air_quality_index',
    unit: '',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [18, 22, 26, 30, 34, 38, 42, 48],
    format: age,
    higherIsBetter: false,
    gridProperty: 'air_quality',
  },
  {
    id: 'crime_rate',
    labelKey: 'layer.crime_rate',
    property: 'crime_index',
    unit: '/1000',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#f9d057', '#fd8d3c', '#e5533d', '#b00026'],
    stops: [20, 35, 50, 65, 80, 100, 130, 170],
    format: perThousand,
    higherIsBetter: false,
  },
  // Crimes against life and health — what "safety" actually means to a resident,
  // and only 8 % of the total-offences figure above (which is 47 % property and
  // 22 % traffic infractions). Five-year mean, withheld under 2,000 residents:
  // at ~8.5 per 1,000 a small municipality sees single digits a year.
  {
    id: 'violent_crime',
    labelKey: 'layer.violent_crime',
    property: 'violent_crime_rate',
    unit: '/1000',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#f9d057', '#fd8d3c', '#e5533d', '#b00026'],
    stops: [3, 4.5, 5.5, 6.5, 7.5, 9, 11, 13],
    format: perThousand,
    higherIsBetter: false,
  },
  // Offences against property — theft, break-ins, damage. The largest single
  // component of the total and the one most people can act on.
  {
    id: 'property_crime',
    labelKey: 'layer.property_crime',
    property: 'property_crime_rate',
    unit: '/1000',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#f9d057', '#fd8d3c', '#e5533d', '#b00026'],
    stops: [14, 19, 24, 30, 36, 44, 55, 70],
    format: perThousand,
    higherIsBetter: false,
  },
  // --- Phase 3: Services & Amenities ---
  // Stops for the service layers are the 12/26/40/54/68/80/90/97th percentiles of
  // the NON-ZERO values, rounded for legibility. The previous round numbers
  // (0.5, 1, 2, ... ) predated the rounding fix and assumed urban-scale
  // densities: only 3-8 % of postal areas reached even the first stop, so
  // 92-97 % of the country shared one flat colour and the top two stops were
  // unreachable nationally. See scripts/services_honesty_2026_08.py.
  {
    id: 'daycare_density',
    labelKey: 'layer.daycare_density',
    property: 'daycare_density',
    unit: '/km²',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [0.007, 0.02, 0.05, 0.15, 0.4, 0.8, 1.5, 4],
    format: density,
  },
  {
    id: 'school_density',
    labelKey: 'layer.school_density',
    property: 'school_density',
    unit: '/km²',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [0.006, 0.01, 0.02, 0.035, 0.09, 0.25, 0.75, 2],
    format: density,
  },
  {
    id: 'healthcare_access',
    labelKey: 'layer.healthcare_access',
    property: 'healthcare_density',
    unit: '/km²',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [0.006, 0.01, 0.025, 0.06, 0.2, 0.6, 1.5, 7.5],
    format: density,
  },
  {
    id: 'restaurant_density',
    labelKey: 'layer.restaurant_density',
    property: 'restaurant_density',
    unit: '/km²',
    colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'],
    stops: [0.007, 0.015, 0.03, 0.065, 0.2, 0.7, 2.5, 14],
    format: density,
  },
  {
    id: 'grocery_access',
    labelKey: 'layer.grocery_access',
    property: 'grocery_density',
    unit: '/km²',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [0.005, 0.01, 0.02, 0.055, 0.2, 0.5, 1, 3],
    format: density,
  },
  {
    // LIPAS is still stored at one decimal — its upstream API 500s reproducibly
    // at page 271 of the 489-page walk, so it could not be refetched at the new
    // precision. These stops therefore sit on the 0.1 quantisation grid rather
    // than on percentiles; revisit once fetch_lipas.py can complete a run.
    id: 'sports_facilities',
    labelKey: 'layer.sports_facilities',
    property: 'sports_facility_density',
    unit: '/km²',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
    stops: [0.1, 0.2, 0.3, 0.5, 1, 2, 4, 10],
    format: density,
  },
  {
    // NOTE: this counts OSM way *records*, not length, so it partly measures how
    // finely contributors split ways. Replacing it with real km/km² from
    // Digiroad (dr_tielinkki, linkkityyp=8) is tracked separately.
    id: 'cycling_infra',
    labelKey: 'layer.cycling_infra',
    property: 'cycling_density',
    unit: '/km²',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [0.045, 0.15, 0.35, 1, 5, 19, 47, 100],
    format: density,
  },
  {
    id: 'single_person_hh',
    labelKey: 'layer.single_person_hh',
    property: 'single_person_hh_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: pct,
  },
  // CF-4: Change over time layers
  {
    id: 'income_change',
    labelKey: 'layer.income_change',
    property: 'income_change_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-15, -10, -5, 0, 5, 10, 15, 25],
    format: pct,
    divergingCenter: 0,
  },
  {
    id: 'population_change',
    labelKey: 'layer.population_change',
    property: 'population_change_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-15, -10, -5, 0, 5, 10, 15, 25],
    format: pct,
    divergingCenter: 0,
  },
  // CF-6: forward-looking projected population change 2024→2040 (StatFin
  // Väestöennuste 2024, municipal base projection assigned to postal codes —
  // is_proxy). Same diverging ramp/center as population_change (growth good,
  // decline bad). Distinct from the backward-looking, real-postal
  // population_change layer.
  {
    id: 'population_projection',
    labelKey: 'layer.population_projection',
    property: 'population_projection_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-15, -10, -5, 0, 5, 10, 15, 25],
    format: pct,
    divergingCenter: 0,
  },
  {
    id: 'unemployment_change',
    labelKey: 'layer.unemployment_change',
    property: 'unemployment_change_pct',
    unit: '%',
    colors: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
    stops: [-30, -20, -10, 0, 10, 20, 30, 50],
    format: pct,
    higherIsBetter: false,
    divergingCenter: 0,
  },
  // CF-7: crime change over time (rising crime is worse → reversed ramp like unemployment_change)
  {
    id: 'crime_index_change',
    labelKey: 'layer.crime_index_change',
    property: 'crime_index_change_pct',
    unit: '%',
    colors: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
    stops: [-30, -20, -10, 0, 10, 20, 30, 50],
    format: pct,
    higherIsBetter: false,
    divergingCenter: 0,
  },
  // --- Phase 7: New data layers ---
  // #1 Voting & Political
  {
    id: 'voter_turnout',
    labelKey: 'layer.voter_turnout',
    property: 'voter_turnout_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [40, 50, 55, 60, 65, 70, 75, 85],
    format: pct,
  },
  {
    id: 'party_diversity',
    labelKey: 'layer.party_diversity',
    property: 'party_diversity_index',
    unit: '',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.85],
    format: gini,
  },
  // Political lean — vote-weighted left–right position (0 = left … 100 = right),
  // weighted by 2023 party vote shares using Chapel Hill Expert Survey (CHES 2019)
  // left–right placements. Diverging palette pinned to the ideological midpoint 50
  // (Finnish convention: red = left, blue = right). Neutral metric, no better/worse.
  {
    id: 'political_lean',
    labelKey: 'layer.political_lean',
    property: 'political_lean_index',
    unit: '',
    colors: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac', '#053061'],
    stops: [44, 48, 50, 52, 56, 60, 64, 70],
    format: score,
    divergingCenter: 50,
  },
  // Per-party vote shares (% of valid votes, 2023 parliamentary). Each rendered
  // alone, so a single-hue ramp per party reads cleanly. Higher ≠ better.
  {
    id: 'party_kok',
    labelKey: 'layer.party_kok',
    property: 'party_vote_kok_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [4, 8, 14, 20, 26, 32, 38, 44],
    format: pct,
  },
  {
    id: 'party_sdp',
    labelKey: 'layer.party_sdp',
    property: 'party_vote_sdp_pct',
    unit: '%',
    colors: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d'],
    stops: [5, 10, 15, 20, 25, 30, 35, 40],
    format: pct,
  },
  {
    id: 'party_ps',
    labelKey: 'layer.party_ps',
    property: 'party_vote_ps_pct',
    unit: '%',
    colors: ['#f7f7ff', '#e0e0f0', '#c0c0e0', '#9090c8', '#6060b0', '#404098', '#2a2a80', '#16165a'],
    stops: [5, 12, 20, 28, 35, 42, 48, 55],
    format: pct,
  },
  {
    id: 'party_kesk',
    labelKey: 'layer.party_kesk',
    property: 'party_vote_kesk_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [3, 8, 16, 24, 32, 40, 48, 56],
    format: pct,
  },
  {
    id: 'party_vihr',
    labelKey: 'layer.party_vihr',
    property: 'party_vote_vihr_pct',
    unit: '%',
    colors: ['#ffffe5', '#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#005a32'],
    stops: [1, 2, 4, 6, 8, 10, 12, 15],
    format: pct,
  },
  {
    id: 'party_vas',
    labelKey: 'layer.party_vas',
    property: 'party_vote_vas_pct',
    unit: '%',
    colors: ['#fff7f3', '#fde0dd', '#fcc5c0', '#fa9fb5', '#f768a1', '#dd3497', '#ae017e', '#7a0177'],
    stops: [1, 3, 6, 9, 12, 16, 20, 28],
    format: pct,
  },
  {
    id: 'party_rkp',
    labelKey: 'layer.party_rkp',
    property: 'party_vote_rkp_pct',
    unit: '%',
    colors: ['#ffffe5', '#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04'],
    stops: [1, 3, 6, 12, 25, 45, 65, 88],
    format: pct,
  },
  // #8 Internet & Connectivity
  {
    id: 'broadband_coverage',
    labelKey: 'layer.broadband_coverage',
    property: 'broadband_coverage_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [30, 50, 60, 70, 80, 85, 90, 98],
    format: pct,
  },
  {
    id: 'ev_charging_density',
    labelKey: 'layer.ev_charging_density',
    property: 'ev_charging_density',
    unit: '/km²',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [0.5, 1, 2, 4, 6, 10, 15, 25],
    format: density,
  },
  // #10 Tree Canopy / Urban Heat Island
  {
    id: 'tree_canopy',
    labelKey: 'layer.tree_canopy',
    property: 'tree_canopy_pct',
    unit: '%',
    colors: ['#ffffcc', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#006837', '#004529'],
    stops: [5, 10, 15, 20, 30, 40, 55, 75],
    format: pct,
  },
  // #12 Accessibility
  {
    id: 'transit_reachability',
    labelKey: 'layer.transit_reachability',
    property: 'transit_reachability_score',
    unit: '/100',
    colors: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: score,
    gridProperty: 'reachability',
  },
  // #11 Quick wins — derived from existing GeoJSON fields
  {
    id: 'youth_ratio',
    labelKey: 'layer.youth_ratio',
    property: 'youth_ratio_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [3, 5, 7, 9, 11, 13, 16, 20],
    format: pct,
  },
  {
    id: 'gender_ratio',
    labelKey: 'layer.gender_ratio',
    property: 'gender_ratio',
    unit: '',
    colors: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
    stops: [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2],
    format: (v: number) => `${v.toFixed(2)}`,
    divergingCenter: 1.0,
  },
  {
    id: 'single_parent_hh',
    labelKey: 'layer.single_parent_hh',
    property: 'single_parent_hh_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  {
    id: 'families_with_children',
    labelKey: 'layer.families_with_children',
    property: 'families_with_children_pct',
    unit: '%',
    colors: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
  {
    id: 'tech_sector_jobs',
    labelKey: 'layer.tech_sector_jobs',
    property: 'tech_sector_pct',
    unit: '%',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [2, 4, 6, 8, 12, 16, 22, 30],
    format: pct,
  },
  {
    id: 'healthcare_workers',
    labelKey: 'layer.healthcare_workers',
    property: 'healthcare_workers_pct',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [2, 4, 6, 8, 10, 14, 18, 25],
    format: pct,
  },
  // #12 Phase 8: More demographic detail + trends
  {
    id: 'employment_rate',
    labelKey: 'layer.employment_rate',
    property: 'employment_rate',
    unit: '%',
    colors: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
    stops: [30, 40, 50, 55, 60, 65, 70, 80],
    format: pct,
  },
  {
    id: 'elderly_ratio',
    labelKey: 'layer.elderly_ratio',
    property: 'elderly_ratio_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [5, 10, 15, 20, 25, 30, 35, 45],
    format: pct,
  },
  {
    id: 'avg_household_size',
    labelKey: 'layer.avg_household_size',
    property: 'avg_household_size',
    unit: '',
    colors: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'],
    stops: [1.0, 1.3, 1.5, 1.7, 1.9, 2.2, 2.5, 3.0],
    format: (v: number) => `${v.toFixed(2)}`,
  },
  {
    id: 'manufacturing_jobs',
    labelKey: 'layer.manufacturing_jobs',
    property: 'manufacturing_jobs_pct',
    unit: '%',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
    stops: [1, 3, 5, 8, 12, 18, 25, 35],
    format: pct,
  },
  {
    id: 'public_sector_jobs',
    labelKey: 'layer.public_sector_jobs',
    property: 'public_sector_jobs_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [1, 3, 5, 8, 12, 16, 22, 30],
    format: pct,
  },
  {
    id: 'service_sector_jobs',
    labelKey: 'layer.service_sector_jobs',
    property: 'service_sector_jobs_pct',
    unit: '%',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#8c2d04'],
    stops: [30, 45, 55, 65, 70, 80, 85, 95],
    format: pct,
  },
  {
    id: 'new_construction',
    labelKey: 'layer.new_construction',
    property: 'new_construction_pct',
    unit: '%',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#005a32'],
    stops: [0, 2, 5, 8, 12, 18, 25, 40],
    format: pct,
  },
  // --- Phase 9: Real open data layers ---
  {
    id: 'rental_price',
    labelKey: 'layer.rental_price',
    property: 'rental_price_sqm',
    unit: '€/m²/kk',
    colors: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    stops: [8, 12, 15, 18, 21, 25, 30, 40],
    format: euroSqmMonth,
  },
  {
    id: 'price_to_rent',
    labelKey: 'layer.price_to_rent',
    property: 'price_to_rent_ratio',
    unit: '',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [10, 15, 18, 20, 23, 26, 30, 40],
    format: years,
    higherIsBetter: false,
  },
  {
    id: 'walkability',
    labelKey: 'layer.walkability',
    property: 'walkability_index',
    unit: '/100',
    colors: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [10, 20, 30, 40, 50, 60, 70, 85],
    format: score,
  },
  {
    id: 'traffic_accidents',
    labelKey: 'layer.traffic_accidents',
    property: 'traffic_accident_rate',
    unit: '/1000',
    colors: ['#f7fcf5', '#d5efcf', '#a1d99b', '#74c476', '#f9d057', '#fd8d3c', '#e5533d', '#b00026'],
    stops: [0.5, 1, 2, 3, 5, 8, 12, 20],
    format: perThousand,
    higherIsBetter: false,
  },
  {
    id: 'property_price_change',
    labelKey: 'layer.property_price_change',
    property: 'property_price_change_pct',
    unit: '%',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [-30, -20, -10, 0, 5, 10, 20, 40],
    format: pct,
    divergingCenter: 0,
  },
  {
    id: 'school_quality',
    labelKey: 'layer.school_quality',
    property: 'school_quality_score',
    unit: '',
    colors: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
    stops: [30, 40, 50, 55, 60, 65, 70, 80],
    format: formatYtlGrade,
    tooltipFormat: formatYtlGradeFull,
  },
  {
    id: 'light_pollution',
    labelKey: 'layer.light_pollution',
    property: 'light_pollution',
    unit: 'nW/cm²/sr',
    colors: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fcffa4'],
    stops: [2, 5, 10, 25, 50, 100, 200, 400],
    format: radiance,
    higherIsBetter: false,
    gridProperty: 'radiance',
  },
  {
    id: 'noise_pollution',
    labelKey: 'layer.noise_pollution',
    property: 'noise_pollution',
    unit: 'dB',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [40, 43, 46, 49, 52, 55, 58, 62],
    format: decibel,
    higherIsBetter: false,
  },
  // CF-19: indoor radon (STUK, postal-code median Bq/m³). 300 = Finnish action level.
  {
    id: 'radon',
    labelKey: 'layer.radon',
    property: 'radon',
    unit: 'Bq/m³',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [50, 100, 150, 200, 300, 400, 600, 900],
    format: bq,
    higherIsBetter: false,
  },
  // CF-21: THL/Kela morbidity index (Sotkanet 5641; 100 = national average).
  {
    id: 'health_index',
    labelKey: 'layer.health_index',
    property: 'health_index',
    unit: '',
    colors: ['#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027'],
    stops: [85, 92, 97, 100, 104, 108, 115, 130],
    format: age,
    higherIsBetter: false,
  },
  // CF-20: SYKE 1/100a flood hazard exposure (% of postal land in the flood zone).
  {
    id: 'flood_risk',
    labelKey: 'layer.flood_risk',
    property: 'flood_risk_pct',
    unit: '%',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'],
    stops: [0, 0.5, 2, 5, 10, 20, 40, 70],
    format: pct,
    higherIsBetter: false,
  },
  // Phase 10: Water proximity & building age
  {
    id: 'water_proximity',
    labelKey: 'layer.water_proximity',
    property: 'water_proximity_m',
    unit: 'm',
    colors: ['#08519c', '#3182bd', '#6baed6', '#9ecae1', '#c6dbef', '#fee0d2', '#fc9272', '#de2d26'],
    stops: [0, 50, 150, 350, 600, 1000, 1500, 2500],
    format: meters,
    higherIsBetter: false,
  },
  {
    id: 'building_age',
    labelKey: 'layer.building_age',
    property: 'avg_construction_year',
    unit: '',
    colors: ['#67000d', '#a50f15', '#cb181d', '#ef3b2c', '#fb6a4a', '#fc9272', '#fcbba1', '#fee0d2'],
    stops: [1940, 1955, 1965, 1975, 1985, 1995, 2005, 2015],
    format: yearFmt,
  },
  // CF-11: construction activity — new dwellings completed 2020- per 1,000
  // residents, a municipal new-dwelling FLOW (StatFin raku 15f6) assigned to each
  // postal code (is_proxy). Sequential, neutral (count/density-like, no
  // higherIsBetter): the national counterpart to the city-only planning data.
  {
    id: 'construction_activity',
    labelKey: 'layer.construction_activity',
    property: 'construction_activity',
    unit: '/1000',
    colors: ['#f7fcfd', '#e0ecf4', '#bfd3e6', '#9ebcda', '#8c96c6', '#8c6bb1', '#88419d', '#6e016b'],
    stops: [2, 5, 10, 18, 28, 40, 55, 75],
    format: perThousand,
  },
  // CF-5: planning & development activity — the number of distinct kaavat &
  // hankkeet (municipal vireillä asemakaavat + Väylävirasto state projects) that
  // geometrically intersect each postal polygon (build_planning_data.mjs →
  // area_planning.json, REAL sub-postal geometry, is_proxy:false). Sequential and
  // NEUTRAL (a count, no higherIsBetter — active development is a preference, not
  // good/bad, like property_price/foreign_lang). Full national coverage, most
  // areas honestly 0; the lightest stop reads as "no nearby planning". Distinct
  // palette (YlGnBu) from construction_activity's BuPu in the same housing group.
  {
    id: 'active_plan_count',
    labelKey: 'layer.active_plan_count',
    property: 'active_plan_count',
    unit: '',
    colors: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'],
    stops: [0, 1, 2, 3, 4, 6, 8, 12],
    format: count,
  },
];

// Colorblind-safe palettes (8 stops each)
export type ColorblindType = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

const CB_PALETTES: Record<Exclude<ColorblindType, 'off'>, string[]> = {
  // Viridis — safe for protanopia (red-blind)
  protanopia: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#9fda3a', '#fde725'],
  // Cividis — optimized for deuteranopia (green-blind)
  deuteranopia: ['#00204d', '#1a3a5c', '#40546a', '#696e78', '#918985', '#bba58e', '#e6c28f', '#ffe945'],
  // Inferno-like — safe for tritanopia (blue-blind)
  tritanopia: ['#000004', '#2c115f', '#711f81', '#b63679', '#ee605e', '#fb9d3a', '#f7e54a', '#fcffa4'],
};

// Single CVD-safe diverging ramp (blue → near-neutral grey → orange), defined low→high.
// Shared by all three colorblind modes: blue/orange poles stay distinguishable under
// protan/deutan/tritan vision while the grey center preserves a diverging layer's
// neutral midpoint (which the sequential CB_PALETTES would destroy).
const CB_DIVERGING: string[] = ['#2c7bb6', '#5ca9d6', '#a6cee3', '#dcdcdc', '#fdd49e', '#fdae61', '#e8722a', '#b8531a'];

let colorblindMode: ColorblindType = 'off';

/**
 * Switch the colorblind-safe palette mode. Invalidates the substituted-layer
 * cache so getLayerById rebuilds configs, and persists the choice to
 * localStorage key 'naapurustot-colorblind' (restored at module load).
 */
export function setColorblindMode(mode: ColorblindType) {
  if (colorblindMode !== mode) cbLayerCache.clear();
  colorblindMode = mode;
  try { localStorage.setItem('naapurustot-colorblind', mode); } catch { /* localStorage unavailable */ }
}

export function getColorblindMode(): ColorblindType {
  return colorblindMode;
}

// Initialize from localStorage
const VALID_CB_MODES = new Set<string>(['protanopia', 'deuteranopia', 'tritanopia']);
try {
  const stored = localStorage.getItem('naapurustot-colorblind');
  if (stored === '1') colorblindMode = 'protanopia'; // migrate old boolean
  else if (stored && VALID_CB_MODES.has(stored)) colorblindMode = stored as ColorblindType;
} catch { /* localStorage unavailable */ }

/**
 * Linearly resample a colorblind-safe palette to match the number of stops a layer needs.
 * When count > palette length, intermediate colors are interpolated via RGB lerp.
 */
function resamplePalette(palette: string[], count: number): string[] {
  if (count === palette.length) return palette;
  if (count <= 1) return [palette[0]];
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    // Map output index to a fractional position in the source palette
    const t = (i / (count - 1)) * (palette.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, palette.length - 1);
    const frac = t - lo;
    if (frac === 0 || lo === hi) {
      result.push(palette[lo]);
    } else {
      // Lerp between two adjacent palette colors
      const c1 = parseInt(palette[lo].slice(1), 16);
      const c2 = parseInt(palette[hi].slice(1), 16);
      const r = Math.round(((c1 >> 16) & 0xff) * (1 - frac) + ((c2 >> 16) & 0xff) * frac);
      const g = Math.round(((c1 >> 8) & 0xff) * (1 - frac) + ((c2 >> 8) & 0xff) * frac);
      const b = Math.round((c1 & 0xff) * (1 - frac) + (c2 & 0xff) * frac);
      result.push(`#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`);
    }
  }
  return result;
}

// Warmth of a #rrggbb color: red minus blue. Positive = warm, negative = cool.
function warmth(hex: string): number {
  const c = parseInt(hex.slice(1), 16);
  return ((c >> 16) & 0xff) - (c & 0xff);
}

// True when the original ramp runs warm→cool (low end warmer than high end), so the
// cool→warm CB_DIVERGING palette must be reversed to preserve the layer's polarity.
function runsWarmToCool(colors: string[]): boolean {
  return warmth(colors[0]) > warmth(colors[colors.length - 1]);
}

// O(1) layer lookup instead of O(n) Array.find() on every call.
// getLayerById is called on every hover (tooltip), layer switch, and map paint update.
export const LAYER_MAP = new Map<LayerId, LayerConfig>();
for (const layer of LAYERS) {
  LAYER_MAP.set(layer.id, layer);
}

// Cache resampled colorblind palettes to avoid recomputing on every getLayerById call.
// Key: "mode:family:colorCount", e.g. "protanopia:s:8" (s=sequential, d=diverging) so the
// shared sequential and diverging palette families never collide in the cache.
const cbPaletteCache = new Map<string, string[]>();

// Cache colorblind-substituted LayerConfig objects to return stable references.
// Without this, every getLayerById call in colorblind mode created a new object,
// defeating React.memo in Legend, TooltipOverlay, and the effectiveLayer comparison in App.
const cbLayerCache = new Map<string, LayerConfig>();

/** Look up a layer config by ID, applying colorblind palette substitution if active. */
export function getLayerById(id: LayerId): LayerConfig {
  const layer = LAYER_MAP.get(id) ?? LAYERS[0];
  if (colorblindMode === 'off') return layer;
  const layerKey = `${colorblindMode}:${id}`;
  const cached = cbLayerCache.get(layerKey);
  if (cached) return cached;
  // Diverging layers use the shared CVD-safe diverging ramp (preserving their neutral
  // midpoint); sequential layers use the per-mode sequential CB palette.
  const isDiverging = layer.divergingCenter != null;
  // For diverging layers the polarity ('w'arm→cool reversed vs 'c'ool→warm) is part of
  // the cache identity so two same-length diverging layers of opposite polarity don't collide.
  const reverse = isDiverging && runsWarmToCool(layer.colors);
  const family = isDiverging ? (reverse ? 'dw' : 'dc') : 's';
  const paletteKey = `${colorblindMode}:${family}:${layer.colors.length}`;
  let cbColors = cbPaletteCache.get(paletteKey);
  if (!cbColors) {
    if (isDiverging) {
      cbColors = resamplePalette(CB_DIVERGING, layer.colors.length);
      // Match the layer's polarity: reverse the cool→warm CB ramp for warm→cool layers.
      if (reverse) cbColors = [...cbColors].reverse();
    } else {
      cbColors = resamplePalette(CB_PALETTES[colorblindMode], layer.colors.length);
    }
    cbPaletteCache.set(paletteKey, cbColors);
  }
  const result = { ...layer, colors: cbColors };
  cbLayerCache.set(layerKey, result);
  return result;
}

/** Map a numeric value to a color from the layer's scale. Returns gray for null/undefined. */
export function getColorForValue(layer: LayerConfig, value: number | null | undefined): string {
  if (value == null) return '#d1d5db';
  for (let i = layer.stops.length - 1; i >= 0; i--) {
    if (value >= layer.stops[i]) return layer.colors[i];
  }
  return layer.colors[0];
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function lerpHex(a: string, b: string, tt: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bl = Math.round(ab + (bb - ab) * tt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * T3: JS equivalent of buildFillColorExpression's `interpolate ['linear']` — linear
 * RGB interpolation between the two bracketing stops. Use this (not getColorForValue,
 * which snaps to the nearest stop) when a UI swatch/badge must match the continuous
 * on-map fill color exactly for the same value. Returns gray for null/undefined.
 */
export function getInterpolatedColor(layer: LayerConfig, value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '#d1d5db';
  const { stops, colors } = layer;
  const last = stops.length - 1;
  if (value <= stops[0]) return colors[0];
  if (value >= stops[last]) return colors[last];
  for (let i = 0; i < last; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (value >= lo && value <= hi) {
      const tt = hi === lo ? 0 : (value - lo) / (hi - lo);
      return lerpHex(colors[i], colors[i + 1], tt);
    }
  }
  return colors[last];
}

/**
 * CSS `linear-gradient` for a strip of N equal-width bands, one colour each.
 *
 * Each band holds its colour flat across the middle of its slice and blends into the
 * next over a short seam, so the strip reads as a single ramp while every band stays
 * unmistakably one hue. That matters when the colour carries a verdict: a band whose
 * colour shaded continuously into its neighbour's would leave "Excellent" looking
 * yellow at one end and green at the other.
 */
export function bandStripGradient(colors: string[]): string {
  const n = colors.length;
  if (n === 0) return 'none';
  const width = 100 / n;
  const seam = width * 0.2;
  const parts: string[] = [];
  colors.forEach((color, i) => {
    parts.push(`${color} ${(i === 0 ? 0 : i * width + seam).toFixed(2)}%`);
    parts.push(`${color} ${(i === n - 1 ? 100 : (i + 1) * width - seam).toFixed(2)}%`);
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/**
 * The active colourblind palette resampled to `count` colours, or null when colourblind
 * mode is off. Lets a fixed qualitative scale (the quality bands) keep the CVD-safe
 * substitution it used to inherit from getLayerById — red "Bad" against green
 * "Excellent" is exactly the pair deuteranopia collapses.
 */
export function colorblindSequential(count: number): string[] | null {
  if (colorblindMode === 'off') return null;
  return resamplePalette(CB_PALETTES[colorblindMode], count);
}

/**
 * Pick the foreground (#0f172a near-black vs #ffffff white) with the higher WCAG
 * contrast against a hex background. Shared so every quality-index swatch (panel,
 * profile, score card) stays legible on light ramp colors (gold/lime) — white text
 * would fail contrast there.
 */
export function readableTextColor(bgHex: string): string {
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

let _rescaleCache: { layerId: string; features: GeoJSON.Feature[]; result: LayerConfig } | null = null;

/**
 * Drop the rescale cache. Call after mutating feature property values in place
 * (e.g. recomputing quality_index): the cache keys on the features array's
 * identity, so in-place edits would otherwise return stale rescaled stops.
 */
export function clearRescaleCache(): void {
  _rescaleCache = null;
}

/**
 * Rescale a layer's color stops to the actual min/max range found in the given features.
 * Colors stay the same; only stop breakpoints shift to span the data range.
 * Returns the original layer unchanged if no valid values are found or min === max.
 *
 * Caches the result per (layerId, features identity) so repeated calls during React
 * re-renders skip the O(n) min/max scan. The cache is invalidated when a different
 * layer or dataset is passed.
 */
export function rescaleLayerToData(
  layer: LayerConfig,
  features: GeoJSON.Feature[],
): LayerConfig {
  if (_rescaleCache && _rescaleCache.layerId === layer.id && _rescaleCache.features === features) {
    return _rescaleCache.result;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const f of features) {
    const raw = f.properties?.[layer.property];
    const v = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof v === 'number' && isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!isFinite(min) || !isFinite(max) || min === max) {
    _rescaleCache = { layerId: layer.id, features, result: layer };
    return layer;
  }
  const n = layer.stops.length;
  if (n <= 1) {
    _rescaleCache = { layerId: layer.id, features, result: layer };
    return layer;
  }
  const center = layer.divergingCenter;
  let newStops: number[];
  if (typeof center === 'number') {
    // Diverging scale: keep the neutral midpoint pinned to `center` and scale each
    // half by the data's actual deviation on that side. A side with no data keeps
    // its original breakpoints (so it never collapses to zero width), and the
    // closest-to-center stop is pinned exactly so the neutral color stays at center.
    let ci = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(layer.stops[i] - center) < Math.abs(layer.stops[ci] - center)) ci = i;
    }
    const negSpanData = center - min; // > 0 when data extends below center
    const posSpanData = max - center; // > 0 when data extends above center
    const origNeg = center - layer.stops[0];
    const origPos = layer.stops[n - 1] - center;
    const negScale = negSpanData > 0 ? negSpanData / (origNeg || 1) : null;
    const posScale = posSpanData > 0 ? posSpanData / (origPos || 1) : null;
    newStops = layer.stops.map((s, i) => {
      if (i === ci) return center;
      if (s < center) return negScale != null ? center - (center - s) * negScale : s;
      return posScale != null ? center + (s - center) * posScale : s;
    });
  } else if (layer.id === 'quality_index') {
    // The composite's shape is user-controlled, so a LINEAR stretch is not enough:
    // it gives contrast when the scores are merely narrow (the shipped defaults span
    // 23-74) but none at all when they bunch at one end (weighting water proximity
    // alone pins 92 % of areas at the same value). Cutting at the cohort's own
    // quantiles keeps roughly a seventh of the areas in every colour band whatever
    // the weighting. qualityBands derives these from the scores computeQualityIndices
    // just wrote, so they always describe what is on screen.
    const bands = getQualityBands();
    newStops = bands && bands.stops.length === n
      ? bands.stops
      : layer.stops.map((_, i) => min + (i / (n - 1)) * (max - min));
  } else {
    newStops = layer.stops.map((_, i) => min + (i / (n - 1)) * (max - min));
  }
  const result = { ...layer, stops: newStops };
  _rescaleCache = { layerId: layer.id, features, result };
  return result;
}

/**
 * Build a MapLibre style expression for interpolated fill color.
 * Returns gray (#d1d5db) for features where the property is null/missing.
 */
export function buildFillColorExpression(layer: LayerConfig, propertyOverride?: string, fallbackColor?: string): ExpressionSpecification {
  const prop = propertyOverride ?? layer.property;
  // The typeof guard below ensures we only reach the interpolation for actual numbers,
  // so no coercion fallback is needed. String-encoded numeric properties are converted
  // to real numbers by useMapData at load time.
  const numericValue = ['get', prop];
  const interpolation: unknown[] = ['interpolate', ['linear'], numericValue];
  for (let i = 0; i < layer.stops.length; i++) {
    interpolation.push(layer.stops[i], layer.colors[i]);
  }
  // Show gray for features where the property is null/missing/non-numeric.
  // The typeof check prevents non-numeric strings (e.g. "N/A") from being
  // silently coerced to 0 by the to-number fallback. T1: when a `fallbackColor`
  // is given (a region-estimate fill for a price layer), null areas paint that
  // constant color instead of gray — they're then hatched by NO_DATA_LAYER, so
  // they read as "sub-region estimate" rather than measured data.
  return [
    'case',
    ['all',
      ['has', prop],
      ['!=', ['get', prop], null],
      ['==', ['typeof', ['get', prop]], 'number'],
    ],
    interpolation,
    fallbackColor ?? '#d1d5db',
  ] as unknown as ExpressionSpecification;
}
