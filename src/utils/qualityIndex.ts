import type { NeighborhoodProperties } from './metrics';

/**
 * Computes a composite Quality Index (0–100) for each neighborhood.
 *
 * The index reflects what makes a neighborhood genuinely good to live in,
 * grounded in subjective-wellbeing research rather than an institutional
 * resource inventory. Default factors are grouped into four evaluative
 * dimensions (see QUALITY_DIMENSIONS):
 *
 *   - Safety & peace of mind  — 30  (crime 26, traffic safety 4)
 *   - Health, nature & calm   — 28  (air 9, tree canopy 8, quiet 7, water 4)
 *   - Livelihood & purpose    — 26  (employment 12, income 10, education 4)
 *   - Everyday freedom & ease — 16  (walkability 7, cycling 3, transit 3, services 3)
 *
 * Money is deliberately mid-weight with employment > income, since losing work
 * harms wellbeing more than the lost euros, and education is kept small because
 * it is ~76% redundant with income. Amenity/service density is demoted. Social
 * connection — the strongest real-world driver — is not measurable from open
 * data and is intentionally left out (see docs/QUALITY_INDEX.md).
 *
 * Every other available metric (housing, demographics, sectoral employment,
 * civic, trends) is available via "Show more" with defaultWeight 0, so users
 * can fully customize the index. They have no effect unless activated.
 *
 * Each metric is min-max normalized across all neighborhoods, then combined
 * using the (custom) weights.
 */

export interface MinMax {
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
  label: { fi: string; en: string; sv: string };
  defaultWeight: number; // 0–100 (or -100–100 if bipolar) slider default
  /** Property key(s) on NeighborhoodProperties to read */
  properties: (keyof NeighborhoodProperties)[];
  /** If true, lower raw values = higher quality score. Ignored when `bipolar` is true. */
  invert: boolean;
  /** If true, shown by default in the panel. Factors with defaultWeight > 0 are always primary. */
  primary: boolean;
  /**
   * If true, the slider ranges from -100 to +100 and the user picks direction via sign:
   *   positive weight → higher raw values score higher;
   *   negative weight → lower raw values score higher.
   * Used for metrics with no objective "better" direction (demographics, housing
   * composition, sectoral employment, etc.).
   */
  bipolar?: boolean;
}

export const QUALITY_FACTORS: QualityFactor[] = [
  // --- Default factors: shown by default, weights sum to 100 ---
  // The default is a "good life" index, not an affluence map. Factors are
  // grouped into four evaluative DIMENSIONS (see QUALITY_DIMENSIONS) whose
  // default factor-weights sum to each dimension's target, so every concept is
  // counted once:
  //   Safety 30 · Health & nature 28 · Livelihood 26 · Everyday ease 16.
  // Money is mid-weight (employment 12 > income 10 > education 4) because
  // unemployment harms wellbeing far more than the lost income alone, and
  // education is ~76% redundant with income. Service density is demoted to a
  // token 3. Every factor used has ~97–100% coverage in all regions except
  // transit (patchy outside Helsinki) and traffic safety (~70%), both small.
  // See docs/QUALITY_INDEX.md.
  {
    id: 'safety',
    label: { fi: 'Turvallisuus', en: 'Safety', sv: 'Säkerhet' },
    defaultWeight: 26,
    properties: ['crime_index'],
    invert: true,
    primary: true,
  },
  {
    id: 'income',
    label: { fi: 'Tulotaso', en: 'Income', sv: 'Inkomst' },
    defaultWeight: 10,
    properties: ['hr_mtu'],
    invert: false,
    primary: true,
  },
  {
    id: 'employment',
    label: { fi: 'Työllisyys', en: 'Employment', sv: 'Sysselsättning' },
    defaultWeight: 12,
    properties: ['unemployment_rate'],
    invert: true,
    primary: true,
  },
  {
    id: 'education',
    label: { fi: 'Koulutus', en: 'Education', sv: 'Utbildning' },
    defaultWeight: 4,
    properties: ['higher_education_rate'],
    invert: false,
    primary: true,
  },
  {
    id: 'transit',
    label: { fi: 'Joukkoliikenne', en: 'Transit', sv: 'Kollektivtrafik' },
    defaultWeight: 3,
    properties: ['transit_stop_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'services',
    label: { fi: 'Palvelut', en: 'Services', sv: 'Tjänster' },
    defaultWeight: 3,
    properties: ['healthcare_density', 'school_density', 'daycare_density', 'grocery_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'air_quality',
    label: { fi: 'Ilmanlaatu', en: 'Air Quality', sv: 'Luftkvalitet' },
    defaultWeight: 9,
    properties: ['air_quality_index'],
    invert: true,
    primary: true,
  },
  // --- Secondary factors: hidden by default, available via "Show more" ---
  // All defaultWeight: 0 so they don't affect the index unless the user activates them.
  // `invert: true` means lower raw values score higher (e.g., pollution, accidents).
  {
    id: 'cycling',
    label: { fi: 'Pyöräilyinfra', en: 'Cycling Infrastructure', sv: 'Cykelinfrastruktur' },
    defaultWeight: 3,
    properties: ['cycling_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'grocery_access',
    label: { fi: 'Ruokakaupat', en: 'Grocery Access', sv: 'Mataffärer' },
    defaultWeight: 0,
    properties: ['grocery_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'restaurants',
    label: { fi: 'Ravintolat', en: 'Restaurants', sv: 'Restauranger' },
    defaultWeight: 0,
    properties: ['restaurant_density'],
    invert: false,
    primary: false,
  },
  // Demographics — bipolar (no objective "better" direction)
  {
    id: 'avg_age',
    label: { fi: 'Keski-ikä', en: 'Average Age', sv: 'Medelålder' },
    defaultWeight: 0,
    properties: ['he_kika'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'youth_ratio',
    label: { fi: 'Nuorten osuus', en: 'Youth Ratio', sv: 'Andel unga' },
    defaultWeight: 0,
    properties: ['youth_ratio_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'elderly_ratio',
    label: { fi: 'Ikääntyneiden osuus', en: 'Elderly Ratio', sv: 'Andel äldre' },
    defaultWeight: 0,
    properties: ['elderly_ratio_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'child_ratio',
    label: { fi: 'Lasten osuus', en: 'Child Ratio', sv: 'Andel barn' },
    defaultWeight: 0,
    properties: ['child_ratio'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'pensioner_share',
    label: { fi: 'Eläkeläisten osuus', en: 'Pensioner Share', sv: 'Andel pensionärer' },
    defaultWeight: 0,
    properties: ['pensioner_share'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'student_share',
    label: { fi: 'Opiskelijoiden osuus', en: 'Student Share', sv: 'Andel studerande' },
    defaultWeight: 0,
    properties: ['student_share'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'gender_ratio',
    label: { fi: 'Sukupuolijakauma', en: 'Gender Ratio', sv: 'Könsfördelning' },
    defaultWeight: 0,
    properties: ['gender_ratio'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'foreign_language',
    label: { fi: 'Vieraskielisten osuus', en: 'Foreign Language %', sv: 'Andel främmande språk' },
    defaultWeight: 0,
    properties: ['foreign_language_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'single_parent_hh',
    label: { fi: 'Yksinhuoltajataloudet', en: 'Single-Parent Households', sv: 'Ensamförsörjarhushåll' },
    defaultWeight: 0,
    properties: ['single_parent_hh_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'families_with_children',
    label: { fi: 'Lapsiperheet', en: 'Families with Children', sv: 'Barnfamiljer' },
    defaultWeight: 0,
    properties: ['families_with_children_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'single_person_hh',
    label: { fi: 'Yhden hengen taloudet', en: 'Single-Person Households', sv: 'Enpersonshushåll' },
    defaultWeight: 0,
    properties: ['single_person_hh_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'household_size',
    label: { fi: 'Kotitalouden koko', en: 'Average Household Size', sv: 'Hushållsstorlek' },
    defaultWeight: 0,
    properties: ['avg_household_size'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'population_density',
    label: { fi: 'Asukastiheys', en: 'Population Density', sv: 'Befolkningstäthet' },
    defaultWeight: 0,
    properties: ['population_density'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  // Housing — bipolar (composition/preference, not quality)
  {
    id: 'ownership_rate',
    label: { fi: 'Omistusasuminen', en: 'Ownership Rate', sv: 'Ägarboende' },
    defaultWeight: 0,
    properties: ['ownership_rate'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'rental_rate',
    label: { fi: 'Vuokra-asuminen', en: 'Rental Rate', sv: 'Hyresboende' },
    defaultWeight: 0,
    properties: ['rental_rate'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'apartment_size',
    label: { fi: 'Asuntojen keskikoko', en: 'Average Apartment Size', sv: 'Genomsnittlig bostadsstorlek' },
    defaultWeight: 0,
    properties: ['ra_as_kpa'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'detached_house_share',
    label: { fi: 'Omakotitalojen osuus', en: 'Detached House Share', sv: 'Andel egnahemshus' },
    defaultWeight: 0,
    properties: ['detached_house_share'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'property_price',
    label: { fi: 'Asuntojen neliöhinta', en: 'Property Price (€/m²)', sv: 'Bostadspris (€/m²)' },
    defaultWeight: 0,
    properties: ['property_price_sqm'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'rental_price',
    label: { fi: 'Vuokrien neliöhinta', en: 'Rental Price (€/m²)', sv: 'Hyrespris (€/m²)' },
    defaultWeight: 0,
    properties: ['rental_price_sqm'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'price_to_rent',
    label: { fi: 'Hinta/vuokra-suhde', en: 'Price-to-Rent Ratio', sv: 'Pris/hyra-förhållande' },
    defaultWeight: 0,
    properties: ['price_to_rent_ratio'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'construction_year',
    label: { fi: 'Rakennusten keski-ikä', en: 'Average Construction Year', sv: 'Genomsnittligt byggår' },
    defaultWeight: 0,
    properties: ['avg_construction_year'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'new_construction',
    label: { fi: 'Uudisrakentaminen', en: 'New Construction', sv: 'Nybyggnation' },
    defaultWeight: 0,
    properties: ['new_construction_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  // Employment — employment_rate is directional, sectoral mix is bipolar
  {
    id: 'employment_rate',
    label: { fi: 'Työllisyysaste', en: 'Employment Rate', sv: 'Sysselsättningsgrad' },
    defaultWeight: 0,
    properties: ['employment_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'tech_sector',
    label: { fi: 'Tekniikan ala', en: 'Tech Sector', sv: 'IT-bransch' },
    defaultWeight: 0,
    properties: ['tech_sector_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'healthcare_sector',
    label: { fi: 'Terveydenhuoltoala', en: 'Healthcare Sector', sv: 'Vårdbransch' },
    defaultWeight: 0,
    properties: ['healthcare_workers_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'manufacturing_sector',
    label: { fi: 'Teollisuus', en: 'Manufacturing Sector', sv: 'Industri' },
    defaultWeight: 0,
    properties: ['manufacturing_jobs_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'public_sector',
    label: { fi: 'Julkinen sektori', en: 'Public Sector', sv: 'Offentlig sektor' },
    defaultWeight: 0,
    properties: ['public_sector_jobs_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'service_sector',
    label: { fi: 'Palvelusektori', en: 'Service Sector', sv: 'Servicesektor' },
    defaultWeight: 0,
    properties: ['service_sector_jobs_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  // Environment & mobility
  {
    id: 'walkability',
    label: { fi: 'Kävelyindeksi', en: 'Walkability', sv: 'Gångvänlighet' },
    defaultWeight: 7,
    properties: ['walkability_index'],
    invert: false,
    primary: true,
  },
  {
    id: 'sports_facilities',
    label: { fi: 'Liikuntapaikat', en: 'Sports Facilities', sv: 'Idrottsanläggningar' },
    defaultWeight: 0,
    properties: ['sports_facility_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'traffic_accidents',
    label: { fi: 'Liikenneonnettomuudet', en: 'Traffic Accidents', sv: 'Trafikolyckor' },
    defaultWeight: 4,
    properties: ['traffic_accident_rate'],
    invert: true,
    primary: true,
  },
  {
    id: 'transit_reachability',
    label: { fi: 'Joukkoliikenteen saavutettavuus', en: 'Transit Reachability', sv: 'Kollektivtrafikens tillgänglighet' },
    defaultWeight: 0,
    properties: ['transit_reachability_score'],
    invert: false,
    primary: false,
  },
  {
    id: 'ev_charging',
    label: { fi: 'Sähköautojen latauspisteet', en: 'EV Charging', sv: 'Elbilsladdning' },
    defaultWeight: 0,
    properties: ['ev_charging_density'],
    invert: false,
    primary: false,
  },
  {
    id: 'tree_canopy',
    label: { fi: 'Puuston peittävyys', en: 'Tree Canopy', sv: 'Trädtäckning' },
    defaultWeight: 8,
    properties: ['tree_canopy_pct'],
    invert: false,
    primary: true,
  },
  {
    id: 'light_pollution',
    label: { fi: 'Valosaaste', en: 'Light Pollution', sv: 'Ljusförorening' },
    defaultWeight: 0,
    properties: ['light_pollution'],
    invert: true,
    primary: false,
  },
  {
    id: 'noise_pollution',
    label: { fi: 'Melu', en: 'Noise Pollution', sv: 'Buller' },
    defaultWeight: 7,
    properties: ['noise_pollution'],
    invert: true,
    primary: true,
  },
  {
    id: 'water_proximity',
    label: { fi: 'Veden läheisyys', en: 'Water Proximity', sv: 'Närhet till vatten' },
    defaultWeight: 4,
    properties: ['water_proximity_m'],
    invert: true,
    primary: true,
  },
  // Connectivity & politics
  {
    id: 'broadband',
    label: { fi: 'Laajakaistan kattavuus', en: 'Broadband Coverage', sv: 'Bredbandstäckning' },
    defaultWeight: 0,
    properties: ['broadband_coverage_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'voter_turnout',
    label: { fi: 'Äänestysaktiivisuus', en: 'Voter Turnout', sv: 'Valdeltagande' },
    defaultWeight: 0,
    properties: ['voter_turnout_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'party_diversity',
    label: { fi: 'Puoluekirjon monimuotoisuus', en: 'Party Diversity', sv: 'Politisk mångfald' },
    defaultWeight: 0,
    properties: ['party_diversity_index'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  // Education
  {
    id: 'school_quality',
    label: { fi: 'Koulujen laatu', en: 'School Quality', sv: 'Skolornas kvalitet' },
    defaultWeight: 0,
    properties: ['school_quality_score'],
    invert: false,
    primary: false,
  },
  // Trends
  {
    id: 'income_change',
    label: { fi: 'Tulokehitys', en: 'Income Change', sv: 'Inkomstutveckling' },
    defaultWeight: 0,
    properties: ['income_change_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'population_change',
    label: { fi: 'Väestönkehitys', en: 'Population Change', sv: 'Befolkningsutveckling' },
    defaultWeight: 0,
    properties: ['population_change_pct'],
    invert: false,
    primary: false,
    bipolar: true,
  },
  {
    id: 'unemployment_change',
    label: { fi: 'Työttömyyden muutos', en: 'Unemployment Change', sv: 'Arbetslöshetsförändring' },
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

/** Neutral midpoint imputed for a missing metric under national scope: an absent
 *  value carries no information, so it must neither reward nor penalize.
 *  (Invert-stable: 100 - 50 === 50.) */
const NEUTRAL_SCORE = 50;

function getFactorScore(
  p: NeighborhoodProperties,
  factor: QualityFactor,
  ranges: Map<string, MinMax>,
  neutralizeMissing: boolean,
): number | null {
  const scores: number[] = [];
  for (const prop of factor.properties) {
    const raw = p[prop];
    const range = ranges.get(prop as string);
    if (!range) continue;
    const isMissing =
      typeof raw !== 'number' || !isFinite(raw) || (prop === 'hr_mtu' && raw <= 0);
    if (isMissing) {
      // National scope: impute the neutral midpoint. A metric that is simply
      // absent (e.g. transit_stop_density has zero coverage in most regions)
      // must not drag a whole region up or down — and the raw national mean is
      // NOT neutral for skewed/zero-inflated metrics (it normalizes well off 50).
      // Region scope keeps the historical mean-imputation, and still drops the
      // factor entirely when the loaded region carries no signal for it (NaN avg).
      if (neutralizeMissing) { scores.push(NEUTRAL_SCORE); continue; }
      if (!isFinite(range.avg)) continue;
      scores.push(normalize(range.avg, range));
    } else {
      scores.push(normalize(raw, range));
    }
  }
  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return factor.invert ? 100 - avg : avg;
}

export function computeQualityIndices(
  features: GeoJSON.Feature[],
  weights?: QualityWeights,
  nationalRanges?: Map<string, MinMax> | null,
): void {
  const w = weights ?? getDefaultWeights();
  // National scope neutralizes missing metrics (see getFactorScore); region
  // scope keeps the historical loaded-set mean-imputation.
  const neutralizeMissing = nationalRanges != null;

  // Collect all needed ranges (includes metro averages for missing data fallback).
  // Bipolar factors with negative weight are still active, so use abs.
  //
  // When `nationalRanges` is supplied (the default "Whole of Finland" scope),
  // normalize each metric against the pre-computed national distribution so a
  // score is comparable across regions — the lazy per-region loader never holds
  // all ~3018 postal codes, so the range must come from the build-time artifact.
  // A property absent from the artifact (e.g. a derived field not in
  // region_properties.json) falls back to the loaded-feature range. When
  // `nationalRanges` is null/undefined the metric is normalized over `features`
  // only — the explicit "within region" scope.
  const ranges = new Map<string, MinMax>();
  for (const factor of QUALITY_FACTORS) {
    if (Math.abs(w[factor.id] ?? 0) <= 0) continue;
    for (const prop of factor.properties) {
      const key = prop as string;
      if (ranges.has(key)) continue;
      const national = nationalRanges?.get(key);
      ranges.set(key, national ?? collectRange(features, prop));
    }
  }

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;

    const scores: { value: number; weight: number }[] = [];
    for (const factor of QUALITY_FACTORS) {
      const factorWeight = w[factor.id] ?? 0;
      const absWeight = Math.abs(factorWeight);
      if (absWeight <= 0) continue;
      let score = getFactorScore(p, factor, ranges, neutralizeMissing);
      if (score == null) continue;
      // Bipolar factor with negative weight: user prefers lower values, so flip score.
      if (factor.bipolar && factorWeight < 0) score = 100 - score;
      scores.push({ value: score, weight: absWeight });
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
  label: { fi: string; en: string; sv: string };
  min: number;
  max: number;
  color: string;
}

export const QUALITY_CATEGORIES: QualityCategory[] = [
  { label: { fi: 'Vältä', en: 'Avoid', sv: 'Undvik' }, min: 0, max: 20, color: '#a855f7' },
  { label: { fi: 'Huono', en: 'Bad', sv: 'Dåligt' }, min: 20, max: 40, color: '#ef4444' },
  { label: { fi: 'OK', en: 'Okay', sv: 'Okej' }, min: 40, max: 60, color: '#f97316' },
  { label: { fi: 'Hyvä', en: 'Good', sv: 'Bra' }, min: 60, max: 80, color: '#eab308' },
  { label: { fi: 'Erinomainen', en: 'Excellent', sv: 'Utmärkt' }, min: 80, max: 100, color: '#22c55e' },
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

// ─── Dimensions, personas & methodology ────────────────────────────────────
//
// The headline Quality Index is framed as four evaluative DIMENSIONS rather
// than ~50 flat factors, each scored once and then weighted:
//   Safety & peace of mind 30 · Health, nature & calm 28 ·
//   Livelihood & purpose 26 · Everyday freedom & ease 16.
// This is a "good life" lens grounded in subjective-wellbeing research: safety
// and a healthy, calm environment lead; money is mid-weight (and work counts
// for more than wealth); amenity density is demoted; and social connection —
// the strongest real-world driver — is left out because it is not measurable
// from open data. Housing and demographics are descriptive only (no default
// weight). See docs/QUALITY_INDEX.md.

export type DimensionId =
  | 'safety' | 'health' | 'livelihood' | 'everyday' | 'housing' | 'demographics';

export interface QualityDimension {
  id: DimensionId;
  label: { fi: string; en: string; sv: string };
  description: { fi: string; en: string; sv: string };
  /** Default share of the index (0–100). Sums to 100 across evaluative dimensions. */
  defaultWeight: number;
}

/** The conceptual dimensions of the index. `demographics` is descriptive only
 *  (no objective "better" direction) and carries no default weight. */
export const QUALITY_DIMENSIONS: QualityDimension[] = [
  {
    id: 'safety', defaultWeight: 30,
    label: { fi: 'Turvallisuus ja mielenrauha', en: 'Safety & peace of mind', sv: 'Trygghet och sinnesro' },
    description: {
      fi: 'Vähäinen rikollisuus ja liikenneturvallisuus — perusta levolliselle arjelle.',
      en: 'Low crime and traffic safety — the foundation of feeling at ease where you live.',
      sv: 'Låg brottslighet och trafiksäkerhet — grunden för en trygg vardag.',
    },
  },
  {
    id: 'health', defaultWeight: 28,
    label: { fi: 'Terveys, luonto ja rauha', en: 'Health, nature & calm', sv: 'Hälsa, natur och lugn' },
    description: {
      fi: 'Puhdas ilma, viheralueet, hiljaisuus ja veden läheisyys.',
      en: 'Clean air, green space, quiet and nearby water — what keeps body and mind well.',
      sv: 'Ren luft, grönytor, tystnad och närhet till vatten.',
    },
  },
  {
    id: 'livelihood', defaultWeight: 26,
    label: { fi: 'Toimeentulo ja työ', en: 'Livelihood & purpose', sv: 'Försörjning och arbete' },
    description: {
      fi: 'Työllisyys ja tulot — työ painaa enemmän kuin pelkkä varallisuus.',
      en: 'Employment and income — work counts for more than wealth alone.',
      sv: 'Sysselsättning och inkomst — arbete väger tyngre än enbart förmögenhet.',
    },
  },
  {
    id: 'everyday', defaultWeight: 16,
    label: { fi: 'Arjen sujuvuus', en: 'Everyday freedom & ease', sv: 'Vardagens smidighet' },
    description: {
      fi: 'Liikkuminen kävellen, pyörällä tai joukkoliikenteellä, palvelut lähellä.',
      en: 'Getting around on foot, by bike or transit, with everyday essentials within reach.',
      sv: 'Att röra sig till fots, på cykel eller med kollektivtrafik, med service nära.',
    },
  },
  {
    id: 'housing', defaultWeight: 0,
    label: { fi: 'Asuminen', en: 'Housing context', sv: 'Boende' },
    description: {
      fi: 'Asuntotyypit, hinnat ja rakennuskanta — kuvaileva, ei oletuspainoa.',
      en: 'Housing types, prices and building stock — descriptive, no default weight.',
      sv: 'Bostadstyper, priser och byggnadsbestånd — beskrivande, ingen standardvikt.',
    },
  },
  {
    id: 'demographics', defaultWeight: 0,
    label: { fi: 'Väestö ja muut', en: 'Demographics & other', sv: 'Demografi m.m.' },
    description: {
      fi: 'Väestörakenne, työn toimialat ja äänestäminen — kuvailevia, ei oletuspainoa.',
      en: 'Population mix, employment sectors and voting — descriptive, no default weight.',
      sv: 'Befolkningssammansättning, branscher och röstning — beskrivande.',
    },
  },
];

/** Map each quality factor id to its conceptual dimension. */
export const FACTOR_DIMENSION: Record<string, DimensionId> = {
  // Livelihood & purpose
  income: 'livelihood', employment: 'livelihood', education: 'livelihood',
  employment_rate: 'livelihood', income_change: 'livelihood', unemployment_change: 'livelihood',
  tech_sector: 'livelihood', healthcare_sector: 'livelihood', manufacturing_sector: 'livelihood',
  public_sector: 'livelihood', service_sector: 'livelihood',
  // Safety & peace of mind
  safety: 'safety', traffic_accidents: 'safety',
  // Health, nature & calm
  air_quality: 'health', tree_canopy: 'health', light_pollution: 'health',
  noise_pollution: 'health', water_proximity: 'health',
  // Everyday freedom & ease (mobility + everyday services)
  transit: 'everyday', cycling: 'everyday', walkability: 'everyday',
  transit_reachability: 'everyday', ev_charging: 'everyday', broadband: 'everyday',
  services: 'everyday', grocery_access: 'everyday', restaurants: 'everyday',
  sports_facilities: 'everyday', school_quality: 'everyday',
  // Housing context
  ownership_rate: 'housing', rental_rate: 'housing', apartment_size: 'housing',
  detached_house_share: 'housing', property_price: 'housing', rental_price: 'housing',
  price_to_rent: 'housing', construction_year: 'housing', new_construction: 'housing',
  population_density: 'housing', population_change: 'housing',
  // Demographics & other (descriptive)
  avg_age: 'demographics', youth_ratio: 'demographics', elderly_ratio: 'demographics',
  child_ratio: 'demographics', pensioner_share: 'demographics', student_share: 'demographics',
  gender_ratio: 'demographics', foreign_language: 'demographics', single_parent_hh: 'demographics',
  families_with_children: 'demographics', single_person_hh: 'demographics', household_size: 'demographics',
  voter_turnout: 'demographics', party_diversity: 'demographics',
};

export function getFactorDimension(factorId: string): DimensionId {
  return FACTOR_DIMENSION[factorId] ?? 'demographics';
}

/** A named quality-index lens (preset weights). Cloud-synced via the existing
 *  per-factor preferences sync — a persona is just a set of factor weights. */
export interface QualityPersona {
  id: string;
  label: { fi: string; en: string; sv: string };
  description: { fi: string; en: string; sv: string };
  /** When true this preset equals the documented default. */
  isDefault?: boolean;
}

// Build a full weight map (every factor present) from a sparse emphasis map,
// so a persona's emphasis isn't diluted by leftover default weights.
function personaWeights(emphasis: Record<string, number>): QualityWeights {
  const w: QualityWeights = {};
  for (const f of QUALITY_FACTORS) w[f.id] = 0;
  return { ...w, ...emphasis };
}

const PERSONA_WEIGHTS: Record<string, QualityWeights> = {
  // The documented, OECD-anchored default (Prosperity emphasized at 30). This is
  // the out-of-the-box index — distinct from "Balanced".
  default: getDefaultWeights(),
  // Balanced = every evaluative dimension weighted equally (20 each), unlike the
  // Default which leans into Prosperity. Prosperity's 20 is split across its
  // three factors (7/7/6).
  balanced: personaWeights({
    income: 7, employment: 7, education: 6,
    safety: 20, services: 20, transit: 20, air_quality: 20,
  }),
  family: personaWeights({
    income: 6, employment: 6, education: 12, safety: 20,
    services: 24, school_quality: 8, transit: 12, air_quality: 12,
  }),
  professional: personaWeights({
    income: 14, employment: 10, education: 8, safety: 10,
    services: 16, transit: 20, walkability: 10, cycling: 8, air_quality: 4,
  }),
  student: personaWeights({
    income: 4, employment: 6, education: 8, safety: 12,
    services: 16, transit: 20, walkability: 10, restaurants: 8, air_quality: 10, noise_pollution: 6,
  }),
  retiree: personaWeights({
    income: 6, safety: 24, services: 24, transit: 10,
    walkability: 10, air_quality: 14, tree_canopy: 6, noise_pollution: 6,
  }),
  nature: personaWeights({
    income: 8, education: 6, safety: 14, services: 8, transit: 6,
    air_quality: 18, tree_canopy: 14, water_proximity: 10, noise_pollution: 10, light_pollution: 6,
  }),
};

export const QUALITY_PERSONAS: QualityPersona[] = [
  { id: 'default', isDefault: true,
    label: { fi: 'Oletus', en: 'Default', sv: 'Standard' },
    description: { fi: 'Suositeltu painotus (hyvinvointi painottuu hieman).', en: 'Recommended weighting (Prosperity leans a little heavier).', sv: 'Rekommenderad viktning (välstånd väger något tyngre).' } },
  { id: 'balanced',
    label: { fi: 'Tasapainoinen', en: 'Balanced', sv: 'Balanserad' },
    description: { fi: 'Kaikki ulottuvuudet täysin yhtä painavia.', en: 'Every dimension weighted exactly equally.', sv: 'Alla dimensioner exakt lika viktade.' } },
  { id: 'family',
    label: { fi: 'Lapsiperhe', en: 'Family with children', sv: 'Barnfamilj' },
    description: { fi: 'Painottaa palveluja, turvallisuutta ja koulutusta.', en: 'Emphasizes services, safety and education.', sv: 'Betonar tjänster, säkerhet och utbildning.' } },
  { id: 'professional',
    label: { fi: 'Autoton kaupunkilainen', en: 'Young professional (car-free)', sv: 'Bilfri stadsbo' },
    description: { fi: 'Painottaa joukkoliikennettä, palveluja ja tuloja.', en: 'Emphasizes transit, amenities and prosperity.', sv: 'Betonar kollektivtrafik, service och inkomst.' } },
  { id: 'student',
    label: { fi: 'Opiskelija', en: 'Student', sv: 'Studerande' },
    description: { fi: 'Painottaa liikkumista, palveluja ja rauhaa.', en: 'Emphasizes mobility, amenities and quiet.', sv: 'Betonar rörlighet, service och lugn.' } },
  { id: 'retiree',
    label: { fi: 'Eläkeläinen', en: 'Retiree', sv: 'Pensionär' },
    description: { fi: 'Painottaa turvallisuutta, terveyspalveluja ja ympäristöä.', en: 'Emphasizes safety, healthcare and environment.', sv: 'Betonar säkerhet, vård och miljö.' } },
  { id: 'nature',
    label: { fi: 'Luonto ja rauha', en: 'Nature & quiet', sv: 'Natur och lugn' },
    description: { fi: 'Painottaa ympäristöä, viheralueita ja hiljaisuutta.', en: 'Emphasizes environment, green space and quiet.', sv: 'Betonar miljö, grönska och tystnad.' } },
];

/** Weights for a persona id (falls back to the default/balanced preset). */
export function getPersonaWeights(personaId: string): QualityWeights {
  return { ...(PERSONA_WEIGHTS[personaId] ?? PERSONA_WEIGHTS.balanced) };
}

/** Identify which persona a weight set matches exactly, if any. */
export function detectPersona(weights: QualityWeights): string | null {
  for (const persona of QUALITY_PERSONAS) {
    const pw = PERSONA_WEIGHTS[persona.id];
    let match = true;
    for (const f of QUALITY_FACTORS) {
      if ((weights[f.id] ?? 0) !== (pw[f.id] ?? 0)) { match = false; break; }
    }
    if (match) return persona.id;
  }
  return null;
}
