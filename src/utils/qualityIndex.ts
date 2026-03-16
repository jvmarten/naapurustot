import type { NeighborhoodProperties } from './metrics';

/**
 * Computes a composite Quality Index (0–100) for each neighborhood
 * based on normalized socioeconomic indicators:
 *   - Median income (35%)
 *   - Low unemployment (35%)
 *   - Higher education rate (30%)
 *
 * Each metric is min-max normalized across all neighborhoods,
 * then combined using the weights above.
 */

interface MinMax {
  min: number;
  max: number;
}

function normalize(value: number, { min, max }: MinMax): number {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

export function computeQualityIndices(features: GeoJSON.Feature[]): void {
  const incomes: number[] = [];
  const unemployments: number[] = [];
  const educations: number[] = [];

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    if (p.hr_mtu != null && p.hr_mtu > 0) incomes.push(p.hr_mtu);
    if (p.unemployment_rate != null) unemployments.push(p.unemployment_rate);
    if (p.higher_education_rate != null) educations.push(p.higher_education_rate);
  }

  const incomeRange: MinMax = { min: Math.min(...incomes), max: Math.max(...incomes) };
  const unempRange: MinMax = { min: Math.min(...unemployments), max: Math.max(...unemployments) };
  const eduRange: MinMax = { min: Math.min(...educations), max: Math.max(...educations) };

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;

    const incomeScore = p.hr_mtu != null && p.hr_mtu > 0
      ? normalize(p.hr_mtu, incomeRange)
      : null;

    // Invert: lower unemployment = higher score
    const unempScore = p.unemployment_rate != null
      ? 100 - normalize(p.unemployment_rate, unempRange)
      : null;

    const eduScore = p.higher_education_rate != null
      ? normalize(p.higher_education_rate, eduRange)
      : null;

    const scores = [
      { value: incomeScore, weight: 0.35 },
      { value: unempScore, weight: 0.35 },
      { value: eduScore, weight: 0.30 },
    ].filter((s) => s.value != null) as { value: number; weight: number }[];

    if (scores.length === 0) {
      (f.properties as any).quality_index = null;
    } else {
      const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
      const weighted = scores.reduce((sum, s) => sum + s.value * s.weight, 0);
      (f.properties as any).quality_index = Math.round(weighted / totalWeight);
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
  { label: { fi: 'Vältä', en: 'Avoid' }, min: 0, max: 20, color: '#ef4444' },
  { label: { fi: 'Huono', en: 'Bad' }, min: 21, max: 40, color: '#f97316' },
  { label: { fi: 'OK', en: 'Okay' }, min: 41, max: 60, color: '#eab308' },
  { label: { fi: 'Hyvä', en: 'Good' }, min: 61, max: 80, color: '#22c55e' },
  { label: { fi: 'Rauhallinen', en: 'Peaceful' }, min: 81, max: 100, color: '#a855f7' },
];

export function getQualityCategory(index: number | null): QualityCategory | null {
  if (index == null) return null;
  return QUALITY_CATEGORIES.find((c) => index >= c.min && index <= c.max) ?? null;
}
