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
  pno: string;
  nimi: string;
  namn: string;
  he_vakiy: number | null;
  he_kika: number | null;
  ko_ika18y: number | null;
  ko_yl_kork: number | null;
  ko_al_kork: number | null;
  ko_ammat: number | null;
  ko_perus: number | null;
  hr_mtu: number | null;
  hr_ktu: number | null;
  pt_tyoll: number | null;
  pt_tyott: number | null;
  pt_opisk: number | null;
  pt_vakiy: number | null;
  pt_elakel: number | null;
  ra_asunn: number | null;
  ra_as_kpa: number | null;
  ra_pt_as: number | null;
  te_takk: number | null;
  te_taly: number | null;
  te_omis_as: number | null;
  te_vuok_as: number | null;
  pinta_ala: number | null;
  he_0_2: number | null;
  he_3_6: number | null;
  unemployment_rate: number | null;
  higher_education_rate: number | null;
  pensioner_share: number | null;
  foreign_language_pct: number | null;
  quality_index: number | null;
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
  // Historical time-series data (JSON-encoded arrays of [year, value] pairs)
  income_history: string | null;
  population_history: string | null;
  unemployment_history: string | null;
  // CF-4: Computed change metrics (derived from history arrays)
  income_change_pct: number | null;
  population_change_pct: number | null;
  unemployment_change_pct: number | null;
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
  // Raw Paavo fields used for quick win computations
  he_naiset: number | null;
  he_miehet: number | null;
  he_18_19: number | null;
  he_20_24: number | null;
  he_25_29: number | null;
  he_65_69: number | null;
  he_70_74: number | null;
  he_75_79: number | null;
  he_80_84: number | null;
  he_85_: number | null;
  te_eil_np: number | null;
  te_laps: number | null;
  tp_tyopy: number | null;
  tp_jk_info: number | null;
  tp_qr_terv: number | null;
  tp_jalo_bf: number | null;
  tp_o_julk: number | null;
  tp_palv_gu: number | null;
  ra_raky: number | null;
  // Phase 9: Real open data layers
  rental_price_sqm: number | null;
  price_to_rent_ratio: number | null;
  walkability_index: number | null;
  traffic_accident_rate: number | null;
  property_price_change_pct: number | null;
  school_quality_score: number | null;
  light_pollution: number | null;
  noise_pollution: number | null;
  [key: string]: string | number | null;
}

/** A single data point in a time series: [year, value] */
export type TrendDataPoint = [number, number];

/** Parse a JSON-encoded trend series from GeoJSON properties */
export function parseTrendSeries(raw: string | null | undefined): TrendDataPoint[] | null {
  if (!raw) return null;
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
          typeof p[1] === 'number',
      )
    ) {
      return parsed as TrendDataPoint[];
    }
  } catch {
    // invalid JSON
  }
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
    const tp_jk_info = p.tp_jk_info as number | null;
    if (tp_jk_info != null && tp_tyopy != null && tp_tyopy > 0) {
      p.tech_sector_pct = Math.round((tp_jk_info / tp_tyopy) * 1000) / 10;
    }

    // Healthcare workers (health/social sector / total jobs %)
    const tp_qr_terv = p.tp_qr_terv as number | null;
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
    const ra_asunn = (p as Record<string, unknown>).ra_asunn as number | null;
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
  }
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
}

/** Data source attribution for metrics shown in the neighborhood panel. */
export interface MetricSource {
  source: string;
  year: number | string;
}

/**
 * Maps GeoJSON property names (or panel label keys) to their data source and year.
 * Used by NeighborhoodPanel to show attribution per stat row.
 */
export const METRIC_SOURCES: Record<string, MetricSource> = {
  // Economy
  hr_mtu: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  hr_ktu: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  unemployment_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  higher_education_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  property_price_sqm: { source: 'Tilastokeskus (PxWeb)', year: 2024 },

  // Demographics
  he_vakiy: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  foreign_language_pct: { source: 'Tilastokeskus', year: 2020 },
  population_density: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  child_ratio: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  student_share: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  single_person_hh_pct: { source: 'Tilastokeskus', year: 2023 },

  // Housing
  ownership_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  rental_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  ra_as_kpa: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  detached_house_share: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  // Quality of life
  transit_stop_density: { source: 'HSL (Digitransit)', year: 2024 },
  air_quality_index: { source: 'HSY', year: 2024 },
  crime_index: { source: 'Poliisi', year: 2023 },

  // Services
  restaurant_density: { source: 'OpenStreetMap', year: 2024 },
  grocery_density: { source: 'OpenStreetMap', year: 2024 },
  daycare_density: { source: 'OpenStreetMap', year: 2024 },
  school_density: { source: 'OpenStreetMap', year: 2024 },
  healthcare_density: { source: 'OpenStreetMap', year: 2024 },
  // Mobility
  cycling_density: { source: 'OpenStreetMap', year: 2024 },

  // Phase 7: Voting & Political
  voter_turnout_pct: { source: 'Tilastokeskus (kuntavaalit)', year: 2025 },
  party_diversity_index: { source: 'Tilastokeskus (kuntavaalit)', year: 2025 },


  // Internet & Connectivity
  broadband_coverage_pct: { source: 'Traficom', year: 2024 },
  ev_charging_density: { source: 'OpenStreetMap', year: 2025 },

  // Tree Canopy / Urban Heat Island
  tree_canopy_pct: { source: 'HSY (LiDAR maanpeite)', year: 2024 },

  // Accessibility
  transit_reachability_score: { source: 'HSL / johdettu', year: 2025 },

  // Phase 8: More demographic detail + trends
  employment_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  elderly_ratio_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  avg_household_size: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  manufacturing_jobs_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  public_sector_jobs_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  service_sector_jobs_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  new_construction_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },

  // Phase 9: Real open data layers
  rental_price_sqm: { source: 'Tilastokeskus (PxWeb)', year: 2024 },
  price_to_rent_ratio: { source: 'Tilastokeskus (PxWeb)', year: 2024 },
  walkability_index: { source: 'OpenStreetMap (composite)', year: 2024 },
  traffic_accident_rate: { source: 'Väylävirasto', year: 2023 },
  property_price_change_pct: { source: 'Tilastokeskus (PxWeb)', year: '2020–2025' },
  school_quality_score: { source: 'YTL (ylioppilastutkinto)', year: 2024 },
  light_pollution: { source: 'NASA VIIRS Black Marble (VNP46A4)', year: 2024 },
  noise_pollution: { source: 'Helsinki meluselvitys 2022 / HRI pks liikennemelu 2012', year: '2012–2022' },

  // Quick wins (from existing Paavo data)
  youth_ratio_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  gender_ratio: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  single_parent_hh_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  families_with_children_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  tech_sector_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  healthcare_workers_pct: { source: 'Tilastokeskus (Paavo)', year: 2024 },
};

const METRIC_DEFS: MetricDef[] = [
  // Economy
  { property: 'hr_mtu', weight: 'population', precision: 0, requirePositive: true },
  { property: 'property_price_sqm', weight: 'population', precision: 0, requirePositive: true },
  { property: 'ra_as_kpa', weight: 'population', precision: 1, requirePositive: true },

  // Quality of life
  { property: 'transit_stop_density', weight: 'population', precision: 1 },
  { property: 'air_quality_index', weight: 'population', precision: 1 },
  { property: 'crime_index', weight: 'population', precision: 1 },

  // Services
  { property: 'daycare_density', weight: 'population', precision: 1 },
  { property: 'school_density', weight: 'population', precision: 1 },
  { property: 'healthcare_density', weight: 'population', precision: 1 },
  { property: 'restaurant_density', weight: 'population', precision: 1 },
  { property: 'grocery_density', weight: 'population', precision: 1 },

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
  { property: 'tech_sector_pct', weight: 'population', precision: 1 },
  { property: 'healthcare_workers_pct', weight: 'population', precision: 1 },
  // Phase 8: More demographic detail + trends
  { property: 'employment_rate', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'elderly_ratio_pct', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'avg_household_size', weight: 'population', precision: 2 },
  { property: 'manufacturing_jobs_pct', weight: 'population', precision: 1 },
  { property: 'public_sector_jobs_pct', weight: 'population', precision: 1 },
  { property: 'service_sector_jobs_pct', weight: 'population', precision: 1 },
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
  let totalHigherEd = 0;
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

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    const pop = p.he_vakiy;
    if (pop == null || pop <= 0) continue;

    totalPop += pop;

    // Count-based special metrics
    if (p.pt_tyott != null) totalUnemployed += p.pt_tyott;
    if (p.ko_yl_kork != null) totalHigherEd += p.ko_yl_kork;
    if (p.ko_al_kork != null) totalHigherEd += p.ko_al_kork;
    if (p.ko_ika18y != null) totalAdultPop += p.ko_ika18y;
    if (p.te_omis_as != null) totalOwnerOcc += p.te_omis_as;
    if (p.te_taly != null) totalHouseholds += p.te_taly;
    if (p.te_vuok_as != null) totalRental += p.te_vuok_as;
    if (p.pt_opisk != null) totalStudents += p.pt_opisk;
    if (p.pt_vakiy != null) totalActPop += p.pt_vakiy;
    else totalActPop += pop;
    if (p.he_0_2 != null) totalChildren += p.he_0_2;
    if (p.he_3_6 != null) totalChildren += p.he_3_6;
    if (p.pinta_ala != null) totalArea += p.pinta_ala;
    if (p.ra_pt_as != null) totalDetached += p.ra_pt_as;
    if (p.ra_asunn != null) totalDwellings += p.ra_asunn;
    if (p.pt_elakel != null) totalPensioners += p.pt_elakel;

    // Data-driven weighted metrics
    for (const def of METRIC_DEFS) {
      const value = p[def.property] as number | null;
      if (value == null) continue;
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
      } else {
        totals[def.property] += value * w;
        weights[def.property] += w;
      }
    }
  }

  // Build result from data-driven metrics
  const result: Record<string, number> = {};

  for (const def of METRIC_DEFS) {
    const w = weights[def.property];
    const precision = def.precision ?? 1;
    if (w > 0) {
      if (def.pctOfPop || def.pctOfHh) {
        // Convert back to percentage
        result[def.property] = roundTo((totals[def.property] / w) * 100, precision);
      } else {
        result[def.property] = roundTo(totals[def.property] / w, precision);
      }
    } else {
      result[def.property] = 0;
    }
  }

  // Add special ratio-based metrics
  result.he_vakiy = totalPop;
  result.unemployment_rate = totalActPop > 0 ? roundTo((totalUnemployed / totalActPop) * 100, 1) : 0;
  result.higher_education_rate = totalAdultPop > 0 ? roundTo((totalHigherEd / totalAdultPop) * 100, 1) : 0;
  result.ownership_rate = totalHouseholds > 0 ? roundTo((totalOwnerOcc / totalHouseholds) * 100, 1) : 0;
  result.rental_rate = totalHouseholds > 0 ? roundTo((totalRental / totalHouseholds) * 100, 1) : 0;
  result.student_share = totalActPop > 0 ? roundTo((totalStudents / totalActPop) * 100, 1) : 0;
  result.population_density = totalArea > 0 ? Math.round(totalPop / (totalArea / 1_000_000)) : 0;
  result.child_ratio = totalPop > 0 ? roundTo((totalChildren / totalPop) * 100, 1) : 0;
  result.detached_house_share = totalDwellings > 0 ? roundTo((totalDetached / totalDwellings) * 100, 1) : 0;
  result.pensioner_share = totalActPop > 0 ? roundTo((totalPensioners / totalActPop) * 100, 1) : 0;

  return result;
}
