import type { NeighborhoodProperties } from './metrics';

/**
 * Computes a composite Quality Index (0–100) for each neighborhood.
 *
 * Default primary factors (7):
 *   - Safety (crime rate, inverted) — 25%
 *   - Income (median income) — 20%
 *   - Employment (unemployment, inverted) — 20%
 *   - Education (higher education rate) — 15%
 *   - Transit access — 7%
 *   - Services (healthcare, school, daycare, grocery) — 5%
 *   - Air quality (inverted) — 3%
 *
 * Additional factors available via "Show more" (defaultWeight: 0):
 * every other available metric — demographics, housing, sectoral employment,
 * environment, mobility, connectivity, politics, and trends — so users can
 * fully customize the index. They have no effect unless the user activates them.
 *
 * Each metric is min-max normalized across all neighborhoods,
 * then combined using the (custom) weights.
 */

interface MinMax {
  min: number;
  max: number;
  avg: number;
}

function normalize(value: number, { min, max }: MinMax): number {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** Definition of a single quality factor */
export interface QualityFactor {
  id: string;
  label: { fi: string; en: string };
  defaultWeight: number; // 0–100 slider default
  /** Property key(s) on NeighborhoodProperties to read */
  properties: (keyof NeighborhoodProperties)[];
  /** If true, lower raw values = higher quality score */
  invert: boolean;
  /** If true, shown by default in the panel. Factors with defaultWeight > 0 are always primary. */
  primary: boolean;
}

export const QUALITY_FACTORS: QualityFactor[] = [
  // --- Primary factors (7): shown by default ---
  // Socioeconomic factors (80%) correlate and drive score differentiation.
  // Environmental factors (20%) add nuance without flattening the spread.
  {
    id: 'safety',
    label: { fi: 'Turvallisuus', en: 'Safety' },
    defaultWeight: 25,
    properties: ['crime_index'],
    invert: true,
    primary: true,
  },
  {
    id: 'income',
    label: { fi: 'Tulotaso', en: 'Income' },
    defaultWeight: 20,
    properties: ['hr_mtu'],
    invert: false,
    primary: true,
  },
  {
    id: 'employment',
    label: { fi: 'Työllisyys', en: 'Employment' },
    defaultWeight: 20,
    properties: ['unemployment_rate'],
    invert: true,
    primary: true,
  },
  {
    id: 'education',
    label: { fi: 'Koulutus', en: 'Education' },
    defaultWeight: 15,
    properties: ['higher_education_rate'],
    invert: false,
    primary: true,
  },
  {
    id: 'transit',
    label: { fi: 'Joukkoliikenne', en: 'Transit' },
    defaultWeight: 7,
    properties: ['transit_stop_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'services',
    label: { fi: 'Palvelut', en: 'Services' },
    defaultWeight: 5,
    properties: ['healthcare_density', 'school_density', 'daycare_density', 'grocery_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'air_quality',
    label: { fi: 'Ilmanlaatu', en: 'Air Quality' },
    defaultWeight: 3,
    properties: ['air_quality_index'],
    invert: true,
    primary: true,
  },
  // --- Secondary factors: hidden by default, available via "Show more" ---
  // All defaultWeight: 0 so they don't affect the index unless the user activates them.
  // `invert: true` means lower raw values score higher (e.g., pollution, accidents).
  {
    id: 'cycling',
    label: { fi: 'Pyöräilyinfra', en: 'Cycling Infrastructure' },
    defaultWeight: 0,
    properties: ['cycling_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'grocery_access',
    label: { fi: 'Ruokakaupat', en: 'Grocery Access' },
    defaultWeight: 0,
    properties: ['grocery_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'restaurants',
    label: { fi: 'Ravintolat', en: 'Restaurants' },
    defaultWeight: 0,
    properties: ['restaurant_density'],
    invert: false,
    primary: false,
  },
  // Demographics
  {
    id: 'avg_age',
    label: { fi: 'Keski-ikä', en: 'Average Age' },
    defaultWeight: 0,
    properties: ['he_kika'],
    invert: false,
    primary: false,
  },
  {
    id: 'youth_ratio',
    label: { fi: 'Nuorten osuus', en: 'Youth Ratio' },
    defaultWeight: 0,
    properties: ['youth_ratio_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'elderly_ratio',
    label: { fi: 'Ikääntyneiden osuus', en: 'Elderly Ratio' },
    defaultWeight: 0,
    properties: ['elderly_ratio_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'child_ratio',
    label: { fi: 'Lasten osuus', en: 'Child Ratio' },
    defaultWeight: 0,
    properties: ['child_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'pensioner_share',
    label: { fi: 'Eläkeläisten osuus', en: 'Pensioner Share' },
    defaultWeight: 0,
    properties: ['pensioner_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'student_share',
    label: { fi: 'Opiskelijoiden osuus', en: 'Student Share' },
    defaultWeight: 0,
    properties: ['student_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'gender_ratio',
    label: { fi: 'Sukupuolijakauma', en: 'Gender Ratio' },
    defaultWeight: 0,
    properties: ['gender_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'foreign_language',
    label: { fi: 'Vieraskielisten osuus', en: 'Foreign Language %' },
    defaultWeight: 0,
    properties: ['foreign_language_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'single_parent_hh',
    label: { fi: 'Yksinhuoltajataloudet', en: 'Single-Parent Households' },
    defaultWeight: 0,
    properties: ['single_parent_hh_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'families_with_children',
    label: { fi: 'Lapsiperheet', en: 'Families with Children' },
    defaultWeight: 0,
    properties: ['families_with_children_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'single_person_hh',
    label: { fi: 'Yhden hengen taloudet', en: 'Single-Person Households' },
    defaultWeight: 0,
    properties: ['single_person_hh_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'household_size',
    label: { fi: 'Kotitalouden koko', en: 'Average Household Size' },
    defaultWeight: 0,
    properties: ['avg_household_size'],
    invert: false,
    primary: false,
  },
  {
    id: 'population_density',
    label: { fi: 'Asukastiheys', en: 'Population Density' },
    defaultWeight: 0,
    properties: ['population_density'],
    invert: false,
    primary: false,
  },
  // Housing
  {
    id: 'ownership_rate',
    label: { fi: 'Omistusasuminen', en: 'Ownership Rate' },
    defaultWeight: 0,
    properties: ['ownership_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'rental_rate',
    label: { fi: 'Vuokra-asuminen', en: 'Rental Rate' },
    defaultWeight: 0,
    properties: ['rental_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'apartment_size',
    label: { fi: 'Asuntojen keskikoko', en: 'Average Apartment Size' },
    defaultWeight: 0,
    properties: ['ra_as_kpa'],
    invert: false,
    primary: false,
  },
  {
    id: 'detached_house_share',
    label: { fi: 'Omakotitalojen osuus', en: 'Detached House Share' },
    defaultWeight: 0,
    properties: ['detached_house_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'property_price',
    label: { fi: 'Asuntojen neliöhinta', en: 'Property Price (€/m²)' },
    defaultWeight: 0,
    properties: ['property_price_sqm'],
    invert: false,
    primary: false,
  },
  {
    id: 'rental_price',
    label: { fi: 'Vuokrien neliöhinta', en: 'Rental Price (€/m²)' },
    defaultWeight: 0,
    properties: ['rental_price_sqm'],
    invert: false,
    primary: false,
  },
  {
    id: 'price_to_rent',
    label: { fi: 'Hinta/vuokra-suhde', en: 'Price-to-Rent Ratio' },
    defaultWeight: 0,
    properties: ['price_to_rent_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'construction_year',
    label: { fi: 'Rakennusten keski-ikä', en: 'Average Construction Year' },
    defaultWeight: 0,
    properties: ['avg_construction_year'],
    invert: false,
    primary: false,
  },
  {
    id: 'new_construction',
    label: { fi: 'Uudisrakentaminen', en: 'New Construction' },
    defaultWeight: 0,
    properties: ['new_construction_pct'],
    invert: false,
    primary: false,
  },
  // Employment (sectoral)
  {
    id: 'employment_rate',
    label: { fi: 'Työllisyysaste', en: 'Employment Rate' },
    defaultWeight: 0,
    properties: ['employment_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'tech_sector',
    label: { fi: 'Tekniikan ala', en: 'Tech Sector' },
    defaultWeight: 0,
    properties: ['tech_sector_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'healthcare_sector',
    label: { fi: 'Terveydenhuoltoala', en: 'Healthcare Sector' },
    defaultWeight: 0,
    properties: ['healthcare_workers_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'manufacturing_sector',
    label: { fi: 'Teollisuus', en: 'Manufacturing Sector' },
    defaultWeight: 0,
    properties: ['manufacturing_jobs_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'public_sector',
    label: { fi: 'Julkinen sektori', en: 'Public Sector' },
    defaultWeight: 0,
    properties: ['public_sector_jobs_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'service_sector',
    label: { fi: 'Palvelusektori', en: 'Service Sector' },
    defaultWeight: 0,
    properties: ['service_sector_jobs_pct'],
    invert: false,
    primary: false,
  },
  // Environment & mobility
  {
    id: 'walkability',
    label: { fi: 'Kävelyindeksi', en: 'Walkability' },
    defaultWeight: 0,
    properties: ['walkability_index'],
    invert: false,
    primary: false,
  },
  {
    id: 'sports_facilities',
    label: { fi: 'Liikuntapaikat', en: 'Sports Facilities' },
    defaultWeight: 0,
    properties: ['sports_facility_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'traffic_accidents',
    label: { fi: 'Liikenneonnettomuudet', en: 'Traffic Accidents' },
    defaultWeight: 0,
    properties: ['traffic_accident_rate'],
    invert: true,
    primary: false,
  },
  {
    id: 'transit_reachability',
    label: { fi: 'Joukkoliikenteen saavutettavuus', en: 'Transit Reachability' },
    defaultWeight: 0,
    properties: ['transit_reachability_score'],
    invert: false,
    primary: false,
  },
  {
    id: 'ev_charging',
    label: { fi: 'Sähköautojen latauspisteet', en: 'EV Charging' },
    defaultWeight: 0,
    properties: ['ev_charging_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'tree_canopy',
    label: { fi: 'Puuston peittävyys', en: 'Tree Canopy' },
    defaultWeight: 0,
    properties: ['tree_canopy_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'light_pollution',
    label: { fi: 'Valosaaste', en: 'Light Pollution' },
    defaultWeight: 0,
    properties: ['light_pollution'],
    invert: true,
    primary: false,
  },
  {
    id: 'noise_pollution',
    label: { fi: 'Melu', en: 'Noise Pollution' },
    defaultWeight: 0,
    properties: ['noise_pollution'],
    invert: true,
    primary: false,
  },
  {
    id: 'water_proximity',
    label: { fi: 'Veden läheisyys', en: 'Water Proximity' },
    defaultWeight: 0,
    properties: ['water_proximity_m'],
    invert: true,
    primary: false,
  },
  // Connectivity & politics
  {
    id: 'broadband',
    label: { fi: 'Laajakaistan kattavuus', en: 'Broadband Coverage' },
    defaultWeight: 0,
    properties: ['broadband_coverage_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'voter_turnout',
    label: { fi: 'Äänestysaktiivisuus', en: 'Voter Turnout' },
    defaultWeight: 0,
    properties: ['voter_turnout_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_diversity',
    label: { fi: 'Puoluekirjon monimuotoisuus', en: 'Party Diversity' },
    defaultWeight: 0,
    properties: ['party_diversity_index'],
    invert: false,
    primary: false,
  },
  // Education
  {
    id: 'school_quality',
    label: { fi: 'Koulujen laatu', en: 'School Quality' },
    defaultWeight: 0,
    properties: ['school_quality_score'],
    invert: false,
    primary: false,
  },
  // Trends
  {
    id: 'income_change',
    label: { fi: 'Tulokehitys', en: 'Income Change' },
    defaultWeight: 0,
    properties: ['income_change_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'population_change',
    label: { fi: 'Väestönkehitys', en: 'Population Change' },
    defaultWeight: 0,
    properties: ['population_change_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'unemployment_change',
    label: { fi: 'Työttömyyden muutos', en: 'Unemployment Change' },
    defaultWeight: 0,
    properties: ['unemployment_change_pct'],
    invert: true,
    primary: false,
  },
];

/** Weight map: factor id → weight (0–100) */
export type QualityWeights = Record<string, number>;

export function getDefaultWeights(): QualityWeights {
  const w: QualityWeights = {};
  for (const f of QUALITY_FACTORS) {
    w[f.id] = f.defaultWeight;
  }
  return w;
}

/** Check if weights differ from defaults */
export function isCustomWeights(weights: QualityWeights): boolean {
  for (const f of QUALITY_FACTORS) {
    if ((weights[f.id] ?? f.defaultWeight) !== f.defaultWeight) return true;
  }
  return false;
}

// Cache ranges per dataset identity. When custom weights change,
// computeQualityIndices is called again with the same features array.
// Without caching, every property range is re-scanned (~200 features × ~12 properties).
let rangeCache: Map<string, MinMax> | null = null;
let rangeCacheFeatures: GeoJSON.Feature[] | null = null;

function collectRange(features: GeoJSON.Feature[], prop: keyof NeighborhoodProperties): MinMax {
  // Check cache first
  if (rangeCacheFeatures === features && rangeCache) {
    const cached = rangeCache.get(prop as string);
    if (cached) return cached;
  } else {
    // Dataset changed, invalidate cache
    rangeCache = new Map();
    rangeCacheFeatures = features;
  }

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const f of features) {
    const v = (f.properties as NeighborhoodProperties)[prop];
    if (typeof v === 'number' && v != null && isFinite(v)) {
      if (prop === 'hr_mtu' && v <= 0) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
  }
  const avg = count > 0 ? sum / count : NaN;
  const result = count > 0 ? { min, max, avg } : { min: 0, max: 0, avg: NaN };
  rangeCache!.set(prop as string, result);
  return result;
}

function getFactorScore(
  p: NeighborhoodProperties,
  factor: QualityFactor,
  ranges: Map<string, MinMax>,
): number | null {
  const scores: number[] = [];
  for (const prop of factor.properties) {
    const raw = p[prop];
    const range = ranges.get(prop as string);
    if (!range) continue;
    const isMissing =
      typeof raw !== 'number' || !isFinite(raw) || (prop === 'hr_mtu' && raw <= 0);
    if (isMissing && !isFinite(range.avg)) continue;
    scores.push(normalize(isMissing ? range.avg : raw, range));
  }
  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return factor.invert ? 100 - avg : avg;
}

export function computeQualityIndices(
  features: GeoJSON.Feature[],
  weights?: QualityWeights,
): void {
  const w = weights ?? getDefaultWeights();

  // Collect all needed ranges (includes metro averages for missing data fallback)
  const ranges = new Map<string, MinMax>();
  for (const factor of QUALITY_FACTORS) {
    if ((w[factor.id] ?? 0) <= 0) continue;
    for (const prop of factor.properties) {
      if (!ranges.has(prop as string)) {
        ranges.set(prop as string, collectRange(features, prop));
      }
    }
  }

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;

    const scores: { value: number; weight: number }[] = [];
    for (const factor of QUALITY_FACTORS) {
      const factorWeight = w[factor.id] ?? 0;
      if (factorWeight <= 0) continue;
      const score = getFactorScore(p, factor, ranges);
      if (score != null) {
        scores.push({ value: score, weight: factorWeight });
      }
    }

    if (scores.length === 0) {
      (f.properties as NeighborhoodProperties).quality_index = null;
    } else {
      const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
      const weighted = scores.reduce((sum, s) => sum + s.value * s.weight, 0);
      (f.properties as NeighborhoodProperties).quality_index = Math.round(weighted / totalWeight);
    }
  }
}

export interface QualityCategory {
  label: { fi: string; en: string };
  min: number;
  max: number;
  color: string;
}

export const QUALITY_CATEGORIES: QualityCategory[] = [
  { label: { fi: 'Vältä', en: 'Avoid' }, min: 0, max: 20, color: '#a855f7' },
  { label: { fi: 'Huono', en: 'Bad' }, min: 20, max: 40, color: '#ef4444' },
  { label: { fi: 'OK', en: 'Okay' }, min: 40, max: 60, color: '#f97316' },
  { label: { fi: 'Hyvä', en: 'Good' }, min: 60, max: 80, color: '#eab308' },
  { label: { fi: 'Erinomainen', en: 'Excellent' }, min: 80, max: 100, color: '#22c55e' },
];

export function getQualityCategory(index: number | null): QualityCategory | null {
  if (index == null) return null;
  // Categories use half-open intervals: first category is [min, max],
  // subsequent categories are (min, max]. This eliminates gaps between
  // categories (e.g., 20.5 was previously unmapped).
  for (let i = QUALITY_CATEGORIES.length - 1; i >= 0; i--) {
    const c = QUALITY_CATEGORIES[i];
    if (index > c.min || (i === 0 && index >= c.min)) {
      if (index <= c.max) return c;
    }
  }
  return null;
}
