/**
 * QW-3: comparison-table stat definitions + best/delta helpers.
 *
 * Extracted from ComparisonPanel.tsx so they can be unit-tested directly (the .tsx
 * can't export non-components without tripping react-refresh/only-export-components).
 */
import type { NeighborhoodProperties } from './metrics';
import { formatNumber, formatEuro, formatPct, formatDensity, formatEuroSqm } from './formatting';

export interface StatDef {
  label: string;
  key: string;
  format: (v: number | null | undefined) => string;
  // QW-3: null = no objective better direction (price, foreign-language share, the
  // ownership/rental complement) — neither highlighted "Best" nor red/green-coloured.
  higherIsBetter: boolean | null;
}

export const STAT_SECTIONS: { title: string; stats: StatDef[] }[] = [
  {
    title: '',
    stats: [
      // QW-3: the flagship quality index leads the CSV/PDF/PNG card but was absent
      // from the on-screen table — surface it first.
      { label: 'panel.quality_index', key: 'quality_index', format: (v) => v != null ? String(Math.round(v as number)) : '—', higherIsBetter: true },
      { label: 'panel.population', key: 'he_vakiy', format: formatNumber, higherIsBetter: true },
      { label: 'panel.median_income', key: 'hr_mtu', format: formatEuro, higherIsBetter: true },
      { label: 'panel.unemployment', key: 'unemployment_rate', format: (v) => formatPct(v as number | null), higherIsBetter: false },
      // QW-3: foreign-language share has no objective better direction — neutral.
      { label: 'panel.foreign_lang', key: 'foreign_language_pct', format: (v) => formatPct(v as number | null), higherIsBetter: null },
    ],
  },
  {
    title: 'panel.housing',
    stats: [
      // QW-3: ownership and rental are complements (own% + rent% ≈ 100%) — neither is
      // objectively better, so both are neutral (previously both higher-is-better, which
      // crowned the same finalist "Best" on both rows).
      { label: 'panel.ownership_rate', key: 'ownership_rate', format: (v) => formatPct(v as number | null), higherIsBetter: null },
      { label: 'panel.rental_rate', key: 'rental_rate', format: (v) => formatPct(v as number | null), higherIsBetter: null },
      { label: 'panel.avg_apt_size', key: 'ra_as_kpa', format: (v) => v != null ? `${(v as number).toFixed(1)} m²` : '—', higherIsBetter: true },
      { label: 'panel.detached_houses', key: 'detached_house_share', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.demographics',
    stats: [
      { label: 'panel.population_density', key: 'population_density', format: formatDensity, higherIsBetter: true },
      { label: 'panel.child_ratio', key: 'child_ratio', format: (v) => formatPct(v as number | null), higherIsBetter: true },
      { label: 'panel.student_share', key: 'student_share', format: (v) => formatPct(v as number | null), higherIsBetter: true },
    ],
  },
  {
    title: 'panel.quality_of_life',
    stats: [
      // QW-3: price has no objective better direction (cheaper isn't "better" for a
      // seller, pricier isn't "better" for a buyer) — neutral, so the priciest finalist
      // is no longer highlighted green as "Best".
      { label: 'panel.property_price', key: 'property_price_sqm', format: formatEuroSqm, higherIsBetter: null },
      { label: 'panel.crime_rate', key: 'crime_index', format: (v) => v != null ? (v as number).toFixed(1) : '—', higherIsBetter: false },
      { label: 'panel.walkability', key: 'walkability_index', format: (v) => v != null ? String(Math.round(v as number)) : '—', higherIsBetter: true },
      { label: 'panel.transit_access', key: 'transit_stop_density', format: (v) => v != null ? `${(v as number).toFixed(1)} /km²` : '—', higherIsBetter: true },
      { label: 'panel.air_quality', key: 'air_quality_index', format: (v) => v != null ? (v as number).toFixed(1) : '—', higherIsBetter: false },
    ],
  },
];

export const ALL_STATS = STAT_SECTIONS.flatMap((s) => s.stats);

/**
 * CF-5: percentage delta of a value vs the reference baseline, coloured by whether the
 * direction is favourable. Returns null when either side is missing. QW-3: a null
 * direction shows the magnitude but stays neutral-coloured (no implied judgment).
 */
export function refDeltaOf(
  val: number | null | undefined,
  refVal: number | null | undefined,
  higherIsBetter: boolean | null,
): { text: string; cls: string } | null {
  if (val == null || refVal == null || refVal === 0) return null;
  const pct = ((val - refVal) / Math.abs(refVal)) * 100;
  const neutral = 'text-surface-400 dark:text-surface-500';
  if (Math.abs(pct) < 0.5) return { text: '≈', cls: neutral };
  const text = `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
  if (higherIsBetter == null) return { text, cls: neutral };
  const better = higherIsBetter ? pct > 0 : pct < 0;
  return {
    text,
    cls: better ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400',
  };
}

/** The "Best" pno for a stat across the pinned set. QW-3: a null direction has no
 *  objective winner, so it returns null (don't crown the priciest area). */
export function findBest(pinned: NeighborhoodProperties[], key: string, higherIsBetter: boolean | null): string | null {
  if (higherIsBetter == null) return null;
  let bestPno: string | null = null;
  let bestVal: number | null = null;
  for (const p of pinned) {
    const v = p[key] as number | null;
    if (v == null) continue;
    if (bestVal == null || (higherIsBetter ? v > bestVal : v < bestVal)) {
      bestVal = v;
      bestPno = p.pno;
    }
  }
  return bestPno;
}
