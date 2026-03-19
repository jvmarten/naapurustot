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
  green_space_pct: number | null;
  daycare_density: number | null;
  school_density: number | null;
  healthcare_density: number | null;
  noise_level: number | null;
  avg_building_year: number | null;
  energy_efficiency: number | null;
  population_growth_pct: number | null;
  gini_coefficient: number | null;
  single_person_hh_pct: number | null;
  seniors_alone_pct: number | null;
  cars_per_household: number | null;
  cycling_density: number | null;
  avg_commute_min: number | null;
  restaurant_density: number | null;
  grocery_density: number | null;
  walkability_index: number | null;
  kela_benefit_pct: number | null;
  rental_price_sqm: number | null;
  avg_taxable_income: number | null;
  obesity_rate: number | null;
  life_expectancy: number | null;
  school_quality_score: number | null;
  median_household_debt: number | null;
  price_to_rent_ratio: number | null;
  light_pollution: number | null;
  mental_health_pct: number | null;
  net_migration_pct: number | null;
  avg_residency_years: number | null;
  traffic_accident_density: number | null;
  // Historical time-series data (JSON-encoded arrays of [year, value] pairs)
  income_history: string | null;
  population_history: string | null;
  unemployment_history: string | null;
  // CF-4: Computed change metrics (derived from history arrays)
  income_change_pct: number | null;
  population_change_pct: number | null;
  unemployment_change_pct: number | null;
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
 * CF-4: Compute year-over-year change from a trend series.
 * Returns the percentage change between the first and last data points.
 */
function computeChangePct(series: TrendDataPoint[] | null): number | null {
  if (!series || series.length < 2) return null;
  const first = series[0][1];
  const last = series[series.length - 1][1];
  if (first === 0 || first == null) return null;
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
  avg_taxable_income: { source: 'Verohallinto', year: 2023 },
  unemployment_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  higher_education_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  property_price_sqm: { source: 'Tilastokeskus (PxWeb)', year: 2024 },
  rental_price_sqm: { source: 'Tilastokeskus / ARA', year: 2024 },
  gini_coefficient: { source: 'Tilastokeskus', year: 2023 },
  median_household_debt: { source: 'Tilastokeskus', year: 2023 },
  price_to_rent_ratio: { source: 'johdettu', year: 2024 },

  // Demographics
  he_vakiy: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  foreign_language_pct: { source: 'Tilastokeskus', year: 2020 },
  population_density: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  child_ratio: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  student_share: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  population_growth_pct: { source: 'Tilastokeskus', year: '2019–2024' },
  net_migration_pct: { source: 'Tilastokeskus', year: 2023 },
  single_person_hh_pct: { source: 'Tilastokeskus', year: 2023 },
  seniors_alone_pct: { source: 'THL (Sotkanet)', year: 2023 },
  avg_residency_years: { source: 'Tilastokeskus', year: 2023 },
  kela_benefit_pct: { source: 'Kela', year: 2023 },

  // Housing
  ownership_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  rental_rate: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  ra_as_kpa: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  detached_house_share: { source: 'Tilastokeskus (Paavo)', year: 2024 },
  avg_building_year: { source: 'Rakennusrekisteri', year: 2024 },
  energy_efficiency: { source: 'ARA', year: 2024 },

  // Quality of life
  walkability_index: { source: 'johdettu (OSM + HSL)', year: 2024 },
  transit_stop_density: { source: 'HSL (Digitransit)', year: 2024 },
  air_quality_index: { source: 'HSY', year: 2024 },
  crime_index: { source: 'Poliisi', year: 2023 },
  noise_level: { source: 'HSY', year: 2023 },
  light_pollution: { source: 'FMI / satelliitti', year: 2023 },

  // Services
  restaurant_density: { source: 'OpenStreetMap', year: 2024 },
  grocery_density: { source: 'OpenStreetMap', year: 2024 },
  daycare_density: { source: 'OpenStreetMap', year: 2024 },
  school_density: { source: 'OpenStreetMap', year: 2024 },
  school_quality_score: { source: 'YTL', year: 2023 },
  healthcare_density: { source: 'OpenStreetMap', year: 2024 },
  green_space_pct: { source: 'OpenStreetMap', year: 2024 },

  // Mobility
  avg_commute_min: { source: 'HSL', year: 2023 },
  cars_per_household: { source: 'Traficom', year: 2023 },
  cycling_density: { source: 'OpenStreetMap', year: 2024 },
  traffic_accident_density: { source: 'Traficom / Digiroad', year: 2023 },

  // Health
  obesity_rate: { source: 'THL (FinSote)', year: 2023 },
  life_expectancy: { source: 'THL / Tilastokeskus', year: 2023 },
  mental_health_pct: { source: 'THL (Sotkanet)', year: 2023 },
};

const METRIC_DEFS: MetricDef[] = [
  // Economy
  { property: 'hr_mtu', weight: 'population', precision: 0, requirePositive: true },
  { property: 'avg_taxable_income', weight: 'population', precision: 0, requirePositive: true },
  { property: 'property_price_sqm', weight: 'population', precision: 0, requirePositive: true },
  { property: 'ra_as_kpa', weight: 'population', precision: 1, requirePositive: true },
  { property: 'rental_price_sqm', weight: 'population', precision: 2 },
  { property: 'gini_coefficient', weight: 'population', precision: 2 },
  { property: 'median_household_debt', weight: 'population', precision: 0 },
  { property: 'price_to_rent_ratio', weight: 'population', precision: 1 },

  // Quality of life
  { property: 'transit_stop_density', weight: 'population', precision: 1 },
  { property: 'air_quality_index', weight: 'population', precision: 1 },
  { property: 'crime_index', weight: 'population', precision: 1 },
  { property: 'green_space_pct', weight: 'population', precision: 1 },
  { property: 'walkability_index', weight: 'population', precision: 1 },
  { property: 'noise_level', weight: 'population', precision: 1 },
  { property: 'light_pollution', weight: 'population', precision: 1 },

  // Services
  { property: 'daycare_density', weight: 'population', precision: 1 },
  { property: 'school_density', weight: 'population', precision: 1 },
  { property: 'healthcare_density', weight: 'population', precision: 1 },
  { property: 'restaurant_density', weight: 'population', precision: 1 },
  { property: 'grocery_density', weight: 'population', precision: 1 },
  { property: 'school_quality_score', weight: 'population', precision: 1 },

  // Demographics
  { property: 'population_growth_pct', weight: 'population', precision: 1 },
  { property: 'seniors_alone_pct', weight: 'population', precision: 1 },
  { property: 'kela_benefit_pct', weight: 'population', precision: 1 },
  { property: 'net_migration_pct', weight: 'population', precision: 1 },
  { property: 'avg_residency_years', weight: 'population', precision: 1 },
  { property: 'foreign_language_pct', weight: 'population', precision: 1, pctOfPop: true },
  { property: 'single_person_hh_pct', weight: 'household', precision: 1, pctOfHh: true },

  // Housing
  { property: 'avg_building_year', weight: 'population', precision: 0 },
  { property: 'energy_efficiency', weight: 'population', precision: 1 },

  // Mobility
  { property: 'cars_per_household', weight: 'population', precision: 2 },
  { property: 'cycling_density', weight: 'population', precision: 1 },
  { property: 'avg_commute_min', weight: 'population', precision: 0 },
  { property: 'traffic_accident_density', weight: 'population', precision: 1 },

  // Health
  { property: 'obesity_rate', weight: 'population', precision: 1 },
  { property: 'life_expectancy', weight: 'population', precision: 1 },
  { property: 'mental_health_pct', weight: 'population', precision: 1 },
];

function roundTo(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

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
  result.unemployment_rate = totalPop > 0 ? roundTo((totalUnemployed / totalPop) * 100, 1) : 0;
  result.higher_education_rate = totalAdultPop > 0 ? roundTo((totalHigherEd / totalAdultPop) * 100, 1) : 0;
  result.ownership_rate = totalHouseholds > 0 ? roundTo((totalOwnerOcc / totalHouseholds) * 100, 1) : 0;
  result.rental_rate = totalHouseholds > 0 ? roundTo((totalRental / totalHouseholds) * 100, 1) : 0;
  result.student_share = totalActPop > 0 ? roundTo((totalStudents / totalActPop) * 100, 1) : 0;
  result.population_density = totalArea > 0 ? Math.round(totalPop / (totalArea / 1_000_000)) : 0;
  result.child_ratio = totalPop > 0 ? roundTo((totalChildren / totalPop) * 100, 1) : 0;
  result.detached_house_share = totalDwellings > 0 ? roundTo((totalDetached / totalDwellings) * 100, 1) : 0;

  return result;
}
