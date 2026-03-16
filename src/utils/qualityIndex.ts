import type { NeighborhoodProperties } from './metrics';

/**
 * Computes a composite Quality Index (0–100) for each neighborhood.
 *
 * Default factors (3):
 *   - Median income (35%)
 *   - Low unemployment (35%)
 *   - Higher education rate (30%)
 *
 * Custom mode adds additional factors that users can weight via sliders:
 *   - Safety (crime rate, inverted)
 *   - Green spaces
 *   - Transit access
 *   - Services (healthcare, school, daycare, grocery average)
 *   - Quietness (noise level, inverted)
 *
 * Each metric is min-max normalized across all neighborhoods,
 * then combined using the (custom) weights.
 */

interface MinMax {
  min: number;
  max: number;
}

function normalize(value: number, { min, max }: MinMax): number {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
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
}

export const QUALITY_FACTORS: QualityFactor[] = [
  {
    id: 'income',
    label: { fi: 'Tulotaso', en: 'Income' },
    defaultWeight: 35,
    properties: ['hr_mtu'],
    invert: false,
  },
  {
    id: 'employment',
    label: { fi: 'Työllisyys', en: 'Employment' },
    defaultWeight: 35,
    properties: ['unemployment_rate'],
    invert: true,
  },
  {
    id: 'education',
    label: { fi: 'Koulutus', en: 'Education' },
    defaultWeight: 30,
    properties: ['higher_education_rate'],
    invert: false,
  },
  {
    id: 'safety',
    label: { fi: 'Turvallisuus', en: 'Safety' },
    defaultWeight: 0,
    properties: ['crime_index'],
    invert: true,
  },
  {
    id: 'green_space',
    label: { fi: 'Viheralueet', en: 'Green Spaces' },
    defaultWeight: 0,
    properties: ['green_space_pct'],
    invert: false,
  },
  {
    id: 'transit',
    label: { fi: 'Joukkoliikenne', en: 'Transit' },
    defaultWeight: 0,
    properties: ['transit_stop_density'],
    invert: false,
  },
  {
    id: 'services',
    label: { fi: 'Palvelut', en: 'Services' },
    defaultWeight: 0,
    properties: ['healthcare_density', 'school_density', 'daycare_density', 'grocery_density'],
    invert: false,
  },
  {
    id: 'quietness',
    label: { fi: 'Rauhallisuus', en: 'Quietness' },
    defaultWeight: 0,
    properties: ['noise_level'],
    invert: true,
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

function collectRange(features: GeoJSON.Feature[], prop: keyof NeighborhoodProperties): MinMax {
  const vals: number[] = [];
  for (const f of features) {
    const v = (f.properties as NeighborhoodProperties)[prop];
    if (typeof v === 'number' && v != null && isFinite(v)) {
      // For income, skip zeros
      if (prop === 'hr_mtu' && v <= 0) continue;
      vals.push(v);
    }
  }
  if (vals.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function getFactorScore(
  p: NeighborhoodProperties,
  factor: QualityFactor,
  ranges: Map<string, MinMax>,
): number | null {
  const scores: number[] = [];
  for (const prop of factor.properties) {
    const v = p[prop];
    if (typeof v !== 'number' || v == null || !isFinite(v)) continue;
    if (prop === 'hr_mtu' && v <= 0) continue;
    const range = ranges.get(prop as string);
    if (!range) continue;
    scores.push(normalize(v, range));
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

  // Collect all needed ranges
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
  { label: { fi: 'Huono', en: 'Bad' }, min: 21, max: 40, color: '#ef4444' },
  { label: { fi: 'OK', en: 'Okay' }, min: 41, max: 60, color: '#f97316' },
  { label: { fi: 'Hyvä', en: 'Good' }, min: 61, max: 80, color: '#eab308' },
  { label: { fi: 'Rauhallinen', en: 'Peaceful' }, min: 81, max: 100, color: '#22c55e' },
];

export function getQualityCategory(index: number | null): QualityCategory | null {
  if (index == null) return null;
  return QUALITY_CATEGORIES.find((c) => index >= c.min && index <= c.max) ?? null;
}
