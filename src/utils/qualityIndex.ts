import { getCoveragePct, type NeighborhoodProperties } from './metrics.ts';
import { setQualityCohort, getQualityBands } from './qualityBands.ts';

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
 *
 * DIRECTION. Two independent things decide which end of a metric is "good", and
 * conflating them is how the sign of a weight stops meaning one thing:
 *
 *   `invert` — a DATA fact. The raw column runs opposite to the factor's label
 *              (`water_proximity_m` is a distance, the label is proximity;
 *              `unemployment_rate` is the inverse of the label "Työllisyys").
 *   the SIGN of the weight — the user's preferred direction. Positive prefers more
 *              of the labelled quantity, negative prefers less. `invert` never
 *              consults it, so the two compose instead of cancelling.
 *
 * EVERY factor is signed (−100…+100, zero-centred). Because `invert` is applied
 * first, the score it hands on always means "how much of the LABELLED quantity this
 * area has", so "+" means the same thing on every slider — more of what the slider
 * is named after — whether that is "Asukastiheys", "Veden läheisyys" or "Melu".
 *
 * The corollary is that factors whose label names a hazard carry NEGATIVE default
 * weights: the default index counts traffic accidents at −8 and noise at −7, which
 * is simply "we want less of these, weighted 8 and 7". Reading a weight map now
 * tells you both what is counted and which way. Magnitude alone sets a factor's
 * share of the index; the sign only chooses a direction.
 */

/** Per-metric normalization range: `min`/`max` bound the 0–100 min-max scaling;
 *  `avg` is the metric's mean, used as the missing-data imputation in region scope. */
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
  /** Slider default, −100…+100. Negative means the default weighting prefers LESS
   *  of the labelled quantity (traffic accidents, noise). */
  defaultWeight: number;
  /** Property key(s) on NeighborhoodProperties to read */
  properties: (keyof NeighborhoodProperties)[];
  /**
   * DATA fact, not a preference: true when the raw column runs OPPOSITE to the
   * factor's own label — `water_proximity_m` is a distance while the label is
   * "proximity", `unemployment_rate` is the inverse of the label "Employment".
   * Applying it yields a score meaning "how much of the LABELLED quantity this
   * area has", regardless of whether more of it is desirable. Desirability is
   * carried entirely by the SIGN of the weight, which `invert` never consults —
   * so the two compose instead of silently cancelling each other out.
   *
   * A factor whose label already names the raw quantity (`noise_pollution` →
   * "Melu") is invert:false with a NEGATIVE default weight, NOT invert:true.
   */
  invert: boolean;
  /** If true, shown by default in the panel. Factors with a non-zero defaultWeight are always primary. */
  primary: boolean;
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
  // token 3. As of CF-17 every default factor has ~97–100% national coverage
  // (transit_stop_density is now nationwide via the Digiroad stop register, up
  // from ~10.9% Helsinki-region only); thin coverage now only affects optional
  // factors like school_quality (~10%). computeQualityCoverage exposes
  // each factor's national coverage so the panel can tell "no data anywhere" from
  // a genuine local gap. See docs/QUALITY_INDEX.md.
  // Safety is measured by CRIMES AGAINST LIFE AND HEALTH, not total offences.
  // Measured nationally for 2025, the total-offences figure this used to read is
  // 47 % property crime and 22 % traffic infractions; violence is 8 % of it. So
  // the factor labelled "Turvallisuus" was mostly reporting shoplifting and
  // speeding tickets.
  //
  // Weight cut 26 -> 15. Not because safety matters less, but because the metric
  // is MUNICIPAL: Finland publishes no crime statistic below municipality level
  // (StatFin 13h4's area variable is 1 country + 19 maakunta + 308
  // municipalities, no postal codes). Every postal code in a city therefore
  // carries the same value, so at 26 a quarter of a *neighbourhood* score could
  // not move when comparing neighbourhoods — the most common use of this app.
  // 15 keeps a real between-municipality signal without letting a constant
  // dominate. Revisit only if a sub-municipal source ever appears.
  // The 11 points freed by the safety cut (26 -> 15) were redistributed here, to
  // bring the primary weights back to a readable 100. They all went to factors
  // that are POSTAL-resolution and directly measured, because that is the exact
  // deficiency the safety cut exposed: crime is municipal, so weight spent on it
  // cannot distinguish two neighbourhoods in one city. Moving weight onto
  // measurements that DO vary per postal code increases what the index can
  // actually tell apart.
  //
  // They deliberately did NOT go to: income/employment/education (already 26 and
  // mutually correlated — education is capped at 4 for being ~76 % redundant with
  // income), water_proximity (2,789 of 3,018 areas read exactly 0), walkability
  // (37 distinct values nationally, 1,412 areas sharing one), noise (74 % carry a
  // modelled baseline) or air quality (coarse ~5-10 km SILAM grid, is_proxy).
  // Weighting a degenerate or coarse metric harder buys nothing.
  {
    id: 'safety',
    label: { fi: 'Turvallisuus', en: 'Safety', sv: 'Säkerhet' },
    defaultWeight: 15,
    properties: ['violent_crime_rate'],
    invert: true,
    primary: true,
  },
  // Property crime and total offences are opt-in (defaultWeight 0), the same
  // pattern as low_income. Two reasons: giving property a default weight would
  // push the combined municipal-resolution weight back toward 26, reinstating
  // exactly the problem the cut above addresses; and crime_index is the PARENT
  // of both sub-groups, so weighting it alongside either would count the same
  // offences twice.
  {
    id: 'property_crime',
    label: { fi: 'Omaisuusrikokset', en: 'Property crime', sv: 'Egendomsbrott' },
    defaultWeight: 0,
    properties: ['property_crime_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'total_crime',
    label: { fi: 'Rikollisuus yhteensä', en: 'All recorded offences', sv: 'Brottslighet totalt' },
    defaultWeight: 0,
    properties: ['crime_index'],
    invert: false,
    primary: false,
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
    defaultWeight: 7,
    properties: ['transit_stop_density'],
    invert: false,
    primary: true,
  },
  {
    id: 'services',
    label: { fi: 'Palvelut', en: 'Services', sv: 'Tjänster' },
    defaultWeight: 6,
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
    // QW-1: opt-in low-income-share factor. defaultWeight:0 keeps the published quality_index
    // byte-identical (a 0-weight factor never moves the score), so build:data stays idempotent.
    // invert:true — a lower low-income share scores higher.
    id: 'low_income',
    label: { fi: 'Pienituloisuus', en: 'Low-income share', sv: 'Låginkomstandel' },
    defaultWeight: 0,
    properties: ['low_income_pct'],
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
  // Demographics — descriptive, no objective "better" direction
  {
    id: 'avg_age',
    label: { fi: 'Keski-ikä', en: 'Average Age', sv: 'Medelålder' },
    defaultWeight: 0,
    properties: ['he_kika'],
    invert: false,
    primary: false,
  },
  {
    id: 'youth_ratio',
    label: { fi: 'Nuorten osuus', en: 'Youth Ratio', sv: 'Andel unga' },
    defaultWeight: 0,
    properties: ['youth_ratio_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'elderly_ratio',
    label: { fi: 'Ikääntyneiden osuus', en: 'Elderly Ratio', sv: 'Andel äldre' },
    defaultWeight: 0,
    properties: ['elderly_ratio_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'child_ratio',
    label: { fi: 'Lasten osuus', en: 'Child Ratio', sv: 'Andel barn' },
    defaultWeight: 0,
    properties: ['child_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'pensioner_share',
    label: { fi: 'Eläkeläisten osuus', en: 'Pensioner Share', sv: 'Andel pensionärer' },
    defaultWeight: 0,
    properties: ['pensioner_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'student_share',
    label: { fi: 'Opiskelijoiden osuus', en: 'Student Share', sv: 'Andel studerande' },
    defaultWeight: 0,
    properties: ['student_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'gender_ratio',
    label: { fi: 'Sukupuolijakauma', en: 'Gender Ratio', sv: 'Könsfördelning' },
    defaultWeight: 0,
    properties: ['gender_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'foreign_language',
    label: { fi: 'Vieraskielisten osuus', en: 'Foreign Language %', sv: 'Andel främmande språk' },
    defaultWeight: 0,
    properties: ['foreign_language_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'single_parent_hh',
    label: { fi: 'Yksinhuoltajataloudet', en: 'Single-Parent Households', sv: 'Ensamförsörjarhushåll' },
    defaultWeight: 0,
    properties: ['single_parent_hh_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'families_with_children',
    label: { fi: 'Lapsiperheet', en: 'Families with Children', sv: 'Barnfamiljer' },
    defaultWeight: 0,
    properties: ['families_with_children_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'single_person_hh',
    label: { fi: 'Yhden hengen taloudet', en: 'Single-Person Households', sv: 'Enpersonshushåll' },
    defaultWeight: 0,
    properties: ['single_person_hh_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'household_size',
    label: { fi: 'Kotitalouden koko', en: 'Average Household Size', sv: 'Hushållsstorlek' },
    defaultWeight: 0,
    properties: ['avg_household_size'],
    invert: false,
    primary: false,
  },
  {
    id: 'population_density',
    label: { fi: 'Asukastiheys', en: 'Population Density', sv: 'Befolkningstäthet' },
    defaultWeight: 0,
    properties: ['population_density'],
    invert: false,
    primary: false,
  },
  // Housing — composition and taste, not quality
  {
    id: 'ownership_rate',
    label: { fi: 'Omistusasuminen', en: 'Ownership Rate', sv: 'Ägarboende' },
    defaultWeight: 0,
    properties: ['ownership_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'rental_rate',
    label: { fi: 'Vuokra-asuminen', en: 'Rental Rate', sv: 'Hyresboende' },
    defaultWeight: 0,
    properties: ['rental_rate'],
    invert: false,
    primary: false,
  },
  {
    id: 'apartment_size',
    label: { fi: 'Asuntojen keskikoko', en: 'Average Apartment Size', sv: 'Genomsnittlig bostadsstorlek' },
    defaultWeight: 0,
    properties: ['ra_as_kpa'],
    invert: false,
    primary: false,
  },
  {
    id: 'detached_house_share',
    label: { fi: 'Omakotitalojen osuus', en: 'Detached House Share', sv: 'Andel egnahemshus' },
    defaultWeight: 0,
    properties: ['detached_house_share'],
    invert: false,
    primary: false,
  },
  {
    id: 'property_price',
    label: { fi: 'Asuntojen neliöhinta', en: 'Property Price (€/m²)', sv: 'Bostadspris (€/m²)' },
    defaultWeight: 0,
    properties: ['property_price_sqm'],
    invert: false,
    primary: false,
  },
  {
    id: 'rental_price',
    label: { fi: 'Vuokrien neliöhinta', en: 'Rental Price (€/m²)', sv: 'Hyrespris (€/m²)' },
    defaultWeight: 0,
    properties: ['rental_price_sqm'],
    invert: false,
    primary: false,
  },
  {
    id: 'price_to_rent',
    label: { fi: 'Hinta/vuokra-suhde', en: 'Price-to-Rent Ratio', sv: 'Pris/hyra-förhållande' },
    defaultWeight: 0,
    properties: ['price_to_rent_ratio'],
    invert: false,
    primary: false,
  },
  {
    id: 'construction_year',
    label: { fi: 'Rakennusten keski-ikä', en: 'Average Construction Year', sv: 'Genomsnittligt byggår' },
    defaultWeight: 0,
    properties: ['avg_construction_year'],
    invert: false,
    primary: false,
  },
  {
    id: 'new_construction',
    label: { fi: 'Uudisrakentaminen', en: 'New Construction', sv: 'Nybyggnation' },
    defaultWeight: 0,
    properties: ['new_construction_pct'],
    invert: false,
    primary: false,
  },
  // CF-5: planning & development activity — count of nearby kaavat & hankkeet.
  // defaultWeight:0 so it never moves the published score: an opt-in
  // "I value an up-and-coming area" weight (positive) — or "I want a settled,
  // low-churn area" (negative). No objective better direction, hence 'preference'.
  {
    id: 'planning_activity',
    label: { fi: 'Kaavoitus- ja hankeaktiivisuus', en: 'Planning & Development Activity', sv: 'Planerings- och projektaktivitet' },
    defaultWeight: 0,
    properties: ['active_plan_count'],
    invert: false,
    primary: false,
  },
  // Employment — employment_rate reads one way; the sectoral mix is pure preference
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
  },
  {
    id: 'healthcare_sector',
    label: { fi: 'Terveydenhuoltoala', en: 'Healthcare Sector', sv: 'Vårdbransch' },
    defaultWeight: 0,
    properties: ['healthcare_workers_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'manufacturing_sector',
    label: { fi: 'Teollisuus', en: 'Manufacturing Sector', sv: 'Industri' },
    defaultWeight: 0,
    properties: ['manufacturing_jobs_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'public_sector',
    label: { fi: 'Julkinen sektori', en: 'Public Sector', sv: 'Offentlig sektor' },
    defaultWeight: 0,
    properties: ['public_sector_jobs_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'service_sector',
    label: { fi: 'Palvelusektori', en: 'Service Sector', sv: 'Servicesektor' },
    defaultWeight: 0,
    properties: ['service_sector_jobs_pct'],
    invert: false,
    primary: false,
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
    // Negative: the label names the hazard, so the default weighting wants LESS of it.
    defaultWeight: -8,
    properties: ['traffic_accident_rate'],
    invert: false,
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
    invert: false,
    primary: false,
  },
  {
    id: 'noise_pollution',
    label: { fi: 'Melu', en: 'Noise Pollution', sv: 'Buller' },
    // Negative: the label names the hazard, so the default weighting wants LESS of it.
    defaultWeight: -7,
    properties: ['noise_pollution'],
    invert: false,
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
  // QW-2: opt-in (defaultWeight:0) real population-health + climate factors.
  // computeQualityIndices skips weight-0 factors, so published headline/persona
  // scores stay byte-for-byte identical; users activate these via "Show more".
  // health_index is the Health dimension's first real morbidity OUTCOME (THL/Kela
  // Sotkanet, 100 = national average → invert); flood_risk is an explicit climate
  // counterweight to water_proximity's unconditional waterfront reward.
  {
    id: 'health_index',
    label: { fi: 'Sairastavuus', en: 'Morbidity Index', sv: 'Sjukfrekvens' },
    defaultWeight: 0,
    properties: ['health_index'],
    invert: false,
    primary: false,
  },
  {
    id: 'radon',
    label: { fi: 'Radon', en: 'Radon', sv: 'Radon' },
    defaultWeight: 0,
    properties: ['radon'],
    invert: false,
    primary: false,
  },
  {
    id: 'flood_risk',
    label: { fi: 'Tulvariski', en: 'Flood Risk', sv: 'Översvämningsrisk' },
    defaultWeight: 0,
    properties: ['flood_risk_pct'],
    invert: false,
    primary: false,
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
  },
  {
    id: 'party_diversity',
    label: { fi: 'Puoluekirjon monimuotoisuus', en: 'Party Diversity', sv: 'Politisk mångfald' },
    defaultWeight: 0,
    properties: ['party_diversity_index'],
    invert: false,
    primary: false,
  },
  // Per-party vote share from the 2023 parliamentary election, already shipped as map
  // layers and registered in data_sources.json. Purely descriptive — there is no better
  // direction, which is exactly what a signed slider is for: + seeks areas where the
  // party polls higher, − where it polls lower. defaultWeight 0, so the published index
  // is untouched. Coverage is 98.9% (RKP 93.4%); the underlying figures are municipal
  // outside the capital region, where they are precinct-level.
  {
    id: 'party_kok',
    label: { fi: 'Kokoomus', en: 'National Coalition', sv: 'Samlingspartiet' },
    defaultWeight: 0,
    properties: ['party_vote_kok_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_sdp',
    label: { fi: 'SDP', en: 'Social Democrats', sv: 'SDP' },
    defaultWeight: 0,
    properties: ['party_vote_sdp_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_ps',
    label: { fi: 'Perussuomalaiset', en: 'Finns Party', sv: 'Sannfinländarna' },
    defaultWeight: 0,
    properties: ['party_vote_ps_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_kesk',
    label: { fi: 'Keskusta', en: 'Centre Party', sv: 'Centern' },
    defaultWeight: 0,
    properties: ['party_vote_kesk_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_vihr',
    label: { fi: 'Vihreät', en: 'Green League', sv: 'De Gröna' },
    defaultWeight: 0,
    properties: ['party_vote_vihr_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_vas',
    label: { fi: 'Vasemmistoliitto', en: 'Left Alliance', sv: 'Vänsterförbundet' },
    defaultWeight: 0,
    properties: ['party_vote_vas_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'party_rkp',
    label: { fi: 'RKP', en: 'Swedish People\'s Party', sv: 'SFP' },
    defaultWeight: 0,
    properties: ['party_vote_rkp_pct'],
    invert: false,
    primary: false,
  },
  {
    id: 'political_lean',
    label: { fi: 'Poliittinen suuntaus', en: 'Political lean', sv: 'Politisk inriktning' },
    defaultWeight: 0,
    properties: ['political_lean_index'],
    invert: false,
    primary: false,
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
  },
  {
    id: 'unemployment_change',
    label: { fi: 'Työttömyyden muutos', en: 'Unemployment Change', sv: 'Arbetslöshetsförändring' },
    defaultWeight: 0,
    properties: ['unemployment_change_pct'],
    invert: false,
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
    if (typeof v === 'number' && isFinite(v)) {
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
  // `invert` only reconciles the raw column with the factor's LABEL, so the return
  // value always means "how much of the labelled quantity this area has" (0–100).
  // Desirability comes from the weight's SIGN, applied in computeQualityIndices.
  return factor.invert ? 100 - avg : avg;
}

/**
 * Turn "how much of the labelled quantity this area has" into "how well that matches
 * the user". Every factor is signed, so direction comes from the weight's sign alone:
 * positive prefers more of the labelled quantity, negative prefers less. Magnitude is
 * handled separately (|weight| sets the factor's share), so this only ever mirrors.
 */
function applyDirection(labelScore: number, weight: number): number {
  return weight < 0 ? 100 - labelScore : labelScore;
}

/**
 * Computes and writes `quality_index` (0–100 integer, or null when no factor has
 * data) and `quality_dimension_scores` onto each feature's properties, in place.
 * Pass `nationalRanges` for cross-region-comparable scores (missing metrics score
 * a neutral 50); pass null/undefined to normalize within the loaded features only.
 */
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
  // A negative preference weight is still an active factor, so gate on abs.
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

  // Composites of this cohort, handed to qualityBands so the category labels and the
  // map ramp are cut at the distribution's own quantiles rather than at fixed 20/40/
  // 60/80. Without it the band an area lands in depends on how the user weighted the
  // factors: the shipped defaults put 86 % of Finland in "OK" with nothing at either
  // extreme, while weighting water proximity alone makes 94 % "Erinomainen" at once.
  const composites: number[] = [];

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;

    const scores: { value: number; weight: number }[] = [];
    // CF-8: accumulate the same weighted scores bucketed by conceptual dimension,
    // so the panel can show a defensible per-dimension breakdown of the headline.
    const dimAcc = new Map<DimensionId, { weighted: number; weight: number }>();
    for (const factor of QUALITY_FACTORS) {
      const factorWeight = w[factor.id] ?? 0;
      const absWeight = Math.abs(factorWeight);
      if (absWeight <= 0) continue;
      const labelScore = getFactorScore(p, factor, ranges, neutralizeMissing);
      if (labelScore == null) continue;
      const score = applyDirection(labelScore, factorWeight);
      scores.push({ value: score, weight: absWeight });
      const dim = getFactorDimension(factor.id);
      const acc = dimAcc.get(dim) ?? { weighted: 0, weight: 0 };
      acc.weighted += score * absWeight;
      acc.weight += absWeight;
      dimAcc.set(dim, acc);
    }

    if (scores.length === 0) {
      (f.properties as NeighborhoodProperties).quality_index = null;
      (f.properties as NeighborhoodProperties).quality_dimension_scores = null;
    } else {
      const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
      const weighted = scores.reduce((sum, s) => sum + s.value * s.weight, 0);
      const composite = Math.round(weighted / totalWeight);
      (f.properties as NeighborhoodProperties).quality_index = composite;
      composites.push(composite);
      const dimScores: Record<string, number> = {};
      for (const [dim, acc] of dimAcc) {
        if (acc.weight > 0) dimScores[dim] = Math.round(acc.weighted / acc.weight);
      }
      (f.properties as NeighborhoodProperties).quality_dimension_scores = dimScores;
    }
  }

  setQualityCohort(composites);
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

/**
 * The five categories cut at the ACTIVE COHORT's quantiles, so each band holds
 * roughly a fifth of the areas being looked at and "Erinomainen" cannot describe
 * everything at once. Falls back to the fixed 0/20/40/60/80 breakpoints before any
 * index has been computed (or when the cohort is too small to quantile sensibly).
 *
 * The `min`/`max` on each returned category are rewritten to the cohort's own edges,
 * because callers render them as the band's range — showing "80–100" for a band that
 * actually starts at 56 would be worse than showing nothing.
 */
export function getQualityCategories(): QualityCategory[] {
  const bands = getQualityBands();
  if (!bands || bands.n < 25) return QUALITY_CATEGORIES;
  const cuts = bands.thresholds;
  return QUALITY_CATEGORIES.map((c, i) => ({
    ...c,
    min: i === 0 ? 0 : cuts[i - 1],
    max: i === QUALITY_CATEGORIES.length - 1 ? 100 : cuts[i],
  }));
}

export function getQualityCategory(index: number | null): QualityCategory | null {
  if (index == null) return null;
  // Categories use half-open intervals: first category is [min, max],
  // subsequent categories are (min, max]. This eliminates gaps between
  // categories (e.g., 20.5 was previously unmapped).
  const cats = getQualityCategories();
  for (let i = cats.length - 1; i >= 0; i--) {
    const c = cats[i];
    if (index > c.min || (i === 0 && index >= c.min)) {
      if (index <= c.max) return c;
    }
  }
  return null;
}

/**
 * Where a score sits on the band strip, as a 0–100 percentage of its width.
 *
 * The strip gives every band the SAME width because the bands are quintiles of the
 * cohort — equal width means equal share of areas, which is what "top fifth" means,
 * and it keeps the five labels readable. In VALUE space those bands are nowhere near
 * equal: under the shipped weights the composite spans roughly 23–74, so the cuts land
 * at about 44/48/52/58 and the two outer bands cover ~40 points each while the middle
 * three cover ~4 points each.
 *
 * So position cannot be the raw score. Placing the pointer at `left: ${score}%` mixed
 * the two axes and put it in the wrong band: a 62 is in "Excellent" (58–100) but 62 %
 * along an equal-fifths strip is the fourth band, "Good" — the pointer contradicted the
 * label right next to it.
 *
 * This maps the score piecewise-linearly instead: find its band, then place it inside
 * that band's fifth in proportion to how far through the band's own value range it is.
 * The pointer therefore always lands in the band whose label is displayed, and its
 * colour (sampled from the ramp at the score) matches the strip underneath it, because
 * the strip paints each band with the same ramp across the same range.
 */
export function getQualityBandPosition(index: number | null): number | null {
  if (index == null || !Number.isFinite(index)) return null;
  const cats = getQualityCategories();
  const cat = getQualityCategory(index);
  if (!cat) return null;
  // Located by label, not by object identity: getQualityCategories() rebuilds the array
  // on every call (it rewrites min/max onto copies), so the category getQualityCategory
  // returned is never `indexOf`-equal to the one in a separately-fetched array. Keying
  // off the same lookup the label uses is also what makes "the pointer is in the band
  // whose label is shown" true by construction rather than by coincidence.
  const i = cats.findIndex((c) => c.label.en === cat.label.en);
  if (i < 0) return null;
  const span = cat.max - cat.min;
  // A degenerate band (every area tied on this score) has nowhere meaningful to sit
  // within itself — centre it rather than divide by zero.
  const frac = span > 0 ? Math.min(1, Math.max(0, (index - cat.min) / span)) : 0.5;
  return ((i + frac) / cats.length) * 100;
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
  // QW-2: opt-in health/climate factors (defaultWeight:0) under the Health dimension.
  health_index: 'health', radon: 'health', flood_risk: 'health',
  // Everyday freedom & ease (mobility + everyday services)
  transit: 'everyday', cycling: 'everyday', walkability: 'everyday',
  transit_reachability: 'everyday', ev_charging: 'everyday', broadband: 'everyday',
  services: 'everyday', grocery_access: 'everyday', restaurants: 'everyday',
  sports_facilities: 'everyday', school_quality: 'everyday',
  // Housing context
  ownership_rate: 'housing', rental_rate: 'housing', apartment_size: 'housing',
  detached_house_share: 'housing', property_price: 'housing', rental_price: 'housing',
  price_to_rent: 'housing', construction_year: 'housing', new_construction: 'housing',
  population_density: 'housing', population_change: 'housing', planning_activity: 'housing',
  // Demographics & other (descriptive)
  avg_age: 'demographics', youth_ratio: 'demographics', elderly_ratio: 'demographics',
  child_ratio: 'demographics', pensioner_share: 'demographics', student_share: 'demographics',
  gender_ratio: 'demographics', foreign_language: 'demographics', single_parent_hh: 'demographics',
  families_with_children: 'demographics', single_person_hh: 'demographics', household_size: 'demographics',
  voter_turnout: 'demographics', party_diversity: 'demographics',
  party_kok: 'demographics', party_sdp: 'demographics', party_ps: 'demographics',
  party_kesk: 'demographics', party_vihr: 'demographics', party_vas: 'demographics',
  party_rkp: 'demographics', political_lean: 'demographics',
};

/** Dimension for a factor id; unknown ids fall back to 'demographics' (descriptive). */
export function getFactorDimension(factorId: string): DimensionId {
  return FACTOR_DIMENSION[factorId] ?? 'demographics';
}

// ─── CF-8: Quality Index auditability ──────────────────────────────────────

export interface FactorCoverage {
  id: string;
  label: { fi: string; en: string; sv: string };
  /** True when this area has data for the factor (so it contributed to the score). */
  present: boolean;
  /**
   * PO-11: national coverage (% of all 3,018 postal codes with a real value) for
   * this factor's best-covered source property, from build_metadata.json. Lets the
   * panel distinguish a missing factor that is simply thin everywhere (e.g. transit
   * ~11%) from a genuine local gap in an otherwise near-complete metric. null when
   * no measured figure exists for any source property.
   */
  nationalCoveragePct: number | null;
  /** PO-11: true when this factor is sparse nationwide (so a local miss is expected, not a data hole). */
  nationallyThin: boolean;
}

/**
 * PO-11: a default-weighted factor counts as "thin nationally" when even its
 * best-covered source property reaches under this share of postal codes. Matches
 * metrics.PARTIAL_COVERAGE_THRESHOLD intent (~95%) so the near-complete Paavo/HSY
 * layers stay unflagged while transit (~11%) is surfaced.
 */
export const FACTOR_THIN_COVERAGE_THRESHOLD = 95;

/** PO-11: best (max) national coverage across a factor's source properties, or null. */
function factorNationalCoverage(factor: QualityFactor): number | null {
  let best: number | null = null;
  for (const prop of factor.properties) {
    const c = getCoveragePct(prop as string);
    if (c != null && (best == null || c > best)) best = c;
  }
  return best;
}

export interface DimensionCoverage {
  id: DimensionId;
  label: { fi: string; en: string; sv: string };
  factors: FactorCoverage[];
  present: number;
  total: number;
}

export interface QualityCoverage {
  dimensions: DimensionCoverage[];
  /** Number of default-weighted factors with data for this area. */
  present: number;
  /** Total default-weighted factors that make up the headline index. */
  total: number;
  /**
   * PO-11: of the factors MISSING here, how many are also sparse nationwide
   * (best source property under FACTOR_THIN_COVERAGE_THRESHOLD). These are gaps
   * the index can never fill anywhere — distinct from a genuine local hole in an
   * otherwise complete metric — so the panel can phrase the chip honestly.
   */
  missingThinNationally: number;
}

/** A factor "has data" when at least one source property is finite (income also
 *  requires > 0, matching the index's own missing-data rule in getFactorScore). */
function factorHasData(p: NeighborhoodProperties, factor: QualityFactor): boolean {
  return factor.properties.some((prop) => {
    const raw = p[prop];
    return typeof raw === 'number' && isFinite(raw) && !(prop === 'hr_mtu' && raw <= 0);
  });
}

/**
 * CF-8: per-neighbourhood factor-coverage breakdown for the Quality Index. Reports
 * which of the evaluative (default-weighted) factors actually have data for this
 * area, grouped by dimension, so a low-coverage rural postal code is visibly less
 * certain than a fully-covered urban one. Descriptive (zero-weight) dimensions are
 * excluded — they don't move the headline score.
 */
export function computeQualityCoverage(p: NeighborhoodProperties, weights?: QualityWeights): QualityCoverage {
  // CF-1: audit the factors that actually contribute to the *displayed* score —
  // i.e. those with a non-zero live weight — not the default-weighted set. Under a
  // custom/persona lens this surfaces factors the default zeroes (e.g. the Nature
  // persona's light_pollution) and hides ones it zeroes. Defaults to the documented
  // weights so callers that don't pass a lens keep the original behaviour.
  const w = weights ?? getDefaultWeights();
  const active = QUALITY_FACTORS.filter((f) => (w[f.id] ?? 0) !== 0);
  const byDim = new Map<DimensionId, FactorCoverage[]>();
  for (const f of active) {
    const dim = getFactorDimension(f.id);
    if (!byDim.has(dim)) byDim.set(dim, []);
    const nationalCoveragePct = factorNationalCoverage(f);
    const nationallyThin =
      nationalCoveragePct != null && nationalCoveragePct < FACTOR_THIN_COVERAGE_THRESHOLD;
    byDim.get(dim)!.push({
      id: f.id,
      label: f.label,
      present: factorHasData(p, f),
      nationalCoveragePct,
      nationallyThin,
    });
  }

  const dimensions: DimensionCoverage[] = [];
  let present = 0;
  let total = 0;
  let missingThinNationally = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    const factors = byDim.get(dim.id);
    if (!factors || factors.length === 0) continue;
    const dimPresent = factors.filter((f) => f.present).length;
    present += dimPresent;
    total += factors.length;
    missingThinNationally += factors.filter((f) => !f.present && f.nationallyThin).length;
    dimensions.push({ id: dim.id, label: dim.label, factors, present: dimPresent, total: factors.length });
  }
  return { dimensions, present, total, missingThinNationally };
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

// CF-1: weights that give each of the four EVALUATIVE dimensions an equal share
// (25 each), by scaling every factor's default weight so its dimension re-totals
// to 25 while keeping the within-dimension factor proportions. Derived from the
// live QUALITY_DIMENSIONS/FACTOR_DIMENSION so it can never drift from the model
// (the previous hand-coded "Balanced" preset was stuck on a retired six-dimension
// shape and contradicted its own "every dimension weighted equally" description).
function equalDimensionWeights(): QualityWeights {
  // PO-5: distribute each evaluative dimension's equal target (100 / #evaluative
  // dimensions) across its factors in proportion to their defaultWeight, using
  // LARGEST-REMAINDER rounding so each dimension totals EXACTLY the target and
  // the evaluative dimensions sum to exactly 100. Naive per-factor Math.round let
  // a dimension re-total to 24/26 and the four to ≠100 — this makes
  // QUALITY_INDEX.md's "weighted exactly equally" claim literally true.
  // Descriptive dimensions (housing/demographics, target 0) stay at 0.
  const evaluativeDims = QUALITY_DIMENSIONS.filter((d) => d.defaultWeight !== 0).length;
  const target = Math.round(100 / evaluativeDims); // 4 evaluative dimensions → 25 each
  const evaluative = new Set<string>(
    QUALITY_DIMENSIONS.filter((d) => d.defaultWeight !== 0).map((d) => d.id),
  );
  const byDim: Record<string, QualityFactor[]> = {};
  for (const f of QUALITY_FACTORS) (byDim[getFactorDimension(f.id)] ??= []).push(f);

  const w: QualityWeights = {};
  for (const f of QUALITY_FACTORS) w[f.id] = 0;
  for (const [dim, factors] of Object.entries(byDim)) {
    // Proportions run on |defaultWeight| and the sign is reapplied afterwards.
    // Hazard-labelled factors carry NEGATIVE defaults (traffic accidents -8, noise
    // -7), so summing them signed would shrink a dimension's total — the Safety
    // dimension would read 15 - 8 = 7 and hand safety triple its real share.
    const dimTotal = factors.reduce((s, f) => s + Math.abs(f.defaultWeight ?? 0), 0);
    if (!evaluative.has(dim) || dimTotal <= 0) continue;
    const parts = factors.map((f) => {
      const exact = (Math.abs(f.defaultWeight ?? 0) / dimTotal) * target;
      return {
        id: f.id,
        sign: (f.defaultWeight ?? 0) < 0 ? -1 : 1,
        base: Math.floor(exact),
        rem: exact - Math.floor(exact),
      };
    });
    const magnitude: Record<string, number> = {};
    for (const p of parts) magnitude[p.id] = p.base;
    let assigned = parts.reduce((s, p) => s + p.base, 0);
    // Hand the leftover units (target − Σfloors) to the largest remainders.
    const order = [...parts].sort((a, b) => b.rem - a.rem);
    for (let i = 0; assigned < target && order.length; i++, assigned++) {
      magnitude[order[i % order.length].id] += 1;
    }
    for (const p of parts) w[p.id] = p.sign * magnitude[p.id];
  }
  return w;
}

const PERSONA_WEIGHTS: Record<string, QualityWeights> = {
  // The documented default (Safety 30 · Health 28 · Livelihood 26 · Everyday 16).
  // This is the out-of-the-box index — distinct from "Balanced".
  default: getDefaultWeights(),
  // Balanced = each of the four evaluative dimensions contributes an equal ~25,
  // unlike the Default which leans into Safety/Health. Derived from the model so
  // it stays honest to the persona's "every dimension weighted equally" claim.
  balanced: equalDimensionWeights(),
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
    services: 16, transit: 20, walkability: 10, restaurants: 8, air_quality: 10, noise_pollution: -6,
  }),
  retiree: personaWeights({
    income: 6, safety: 24, services: 24, transit: 10,
    walkability: 10, air_quality: 14, tree_canopy: 6, noise_pollution: -6,
  }),
  nature: personaWeights({
    income: 8, education: 6, safety: 14, services: 8, transit: 6,
    air_quality: 18, tree_canopy: 14, water_proximity: 10, noise_pollution: -10, light_pollution: -6,
  }),
};

/** The selectable preset lenses (labels/descriptions only) — the actual factor
 *  weights live in the non-exported PERSONA_WEIGHTS, read via getPersonaWeights(). */
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
