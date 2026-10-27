/**
 * The national_ranges.json properties client code normalizes against, outside the radar
 * and fit-score components so scripts/build_national_ranges.mjs can import them: the
 * bundled ranges file carries only these plus the quality index's factors.
 */

/** Each radar axis's metrics; a composite axis averages its constituents' bounds. */
export const RADAR_METRICS = {
  'radar.income': ['hr_mtu'],
  'radar.safety': ['crime_index'],
  'radar.transit': ['transit_stop_density'],
  'radar.education': ['higher_education_rate'],
  'radar.services': ['grocery_density', 'healthcare_density', 'school_density'],
  'radar.housing': ['property_price_sqm'],
} as const satisfies Record<string, readonly string[]>;

/** The metrics the fit scorer normalizes against. */
export const FIT_RANGE_KEYS = [
  'transit_stop_density', 'restaurant_density', 'ra_as_kpa', 'child_ratio',
  'daycare_density', 'school_density', 'healthcare_density', 'ownership_rate', 'rental_rate',
  // All three foreign-language variants: the scorer normalizes against whichever one
  // it actually read (latest estimate → 2020 postal → municipal proxy), and their
  // national spreads differ enough that the ranges are not interchangeable.
  'foreign_language_est_pct', 'foreign_language_pct', 'foreign_language_municipal_pct',
] as const;
