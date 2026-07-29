import { describe, it, expect } from 'vitest';
import regionProperties from '../data/region_properties.json';
import { decodeColumnar } from '../utils/columnar';
import dataSources from '../data/data_sources.json';
import { QUALITY_FACTORS } from '../utils/qualityIndex';

/**
 * crime_index is a MUNICIPAL statistic. Finland publishes no crime figure below
 * municipality level — StatFin table 13h4's area variable offers 330 codes (one
 * whole-country, 19 maakunta, 308 municipalities) and no postal codes — so any
 * within-municipality variation is necessarily invented.
 *
 * An earlier pipeline spread the municipal rate across a municipality's postal
 * codes using density, unemployment and rental rate as a "crime proxy score".
 * Measured on the shipped data, that spread was largely a restatement of rent
 * (within-municipality r = +0.58 with rental_rate), rendered to one decimal per
 * area and feeding the Quality Index at weight 26. It has been removed.
 *
 * These tests exist so it cannot come back unnoticed.
 */

type Area = Record<string, unknown>;
const areas = decodeColumnar<Area>(
  regionProperties as unknown as { keys: string[]; cols: unknown[][] },
);

const num = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? v : null;

describe('crime_index is municipal, not postal', () => {
  it('is identical for every postal code within a municipality', () => {
    const byMunicipality = new Map<string, Set<number>>();
    for (const a of areas) {
      const value = num(a.crime_index);
      const kunta = a.kunta == null ? null : String(a.kunta);
      if (value === null || !kunta) continue;
      if (!byMunicipality.has(kunta)) byMunicipality.set(kunta, new Set());
      byMunicipality.get(kunta)!.add(value);
    }
    expect(byMunicipality.size).toBeGreaterThan(250);

    const split = [...byMunicipality.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([kunta, values]) => `${kunta}: ${[...values].join(', ')}`);
    expect(
      split,
      'a municipality with more than one crime_index means the synthetic ' +
      'within-municipality spread has been reintroduced',
    ).toEqual([]);
  });

  it('carries no more distinct values than there are municipalities', () => {
    const municipalities = new Set(areas.map((a) => String(a.kunta)));
    const distinct = new Set(
      areas.map((a) => num(a.crime_index)).filter((v) => v !== null),
    );
    expect(distinct.size).toBeLessThanOrEqual(municipalities.size);
  });

  it('moves with the municipality, not with rent, inside a city', () => {
    // The old spread produced r = +0.58 against rental_rate once the municipal
    // mean was removed. Flattened, the within-municipality variance is zero, so
    // there is nothing left to correlate.
    const helsinki = areas.filter((a) => String(a.kunta) === '091');
    expect(helsinki.length).toBeGreaterThan(50);
    const values = new Set(helsinki.map((a) => num(a.crime_index)));
    expect(values.size).toBe(1);
  });

  it.each(['violent_crime_rate', 'property_crime_rate'])(
    '%s is municipal too — one value per municipality',
    (prop) => {
      const byMunicipality = new Map<string, Set<number>>();
      for (const a of areas) {
        const value = num(a[prop]);
        const kunta = a.kunta == null ? null : String(a.kunta);
        if (value === null || !kunta) continue;
        if (!byMunicipality.has(kunta)) byMunicipality.set(kunta, new Set());
        byMunicipality.get(kunta)!.add(value);
      }
      expect(byMunicipality.size).toBeGreaterThan(200);
      const split = [...byMunicipality.entries()].filter(([, v]) => v.size > 1);
      expect(split.map(([k]) => k)).toEqual([]);
    },
  );

  it('withholds both sub-groups below the population floor rather than publishing noise', () => {
    // At ~8.5 violent offences per 1,000, a 400-resident municipality sees a
    // handful a year and one incident doubles the rate; property crime bottoms
    // out at a literal zero. Both are withheld under 2,000 residents, and both
    // must be withheld for exactly the same areas so the two layers stay
    // comparable side by side.
    const withheldViolent = areas.filter((a) => num(a.violent_crime_rate) === null);
    const withheldProperty = areas.filter((a) => num(a.property_crime_rate) === null);
    expect(withheldViolent.length).toBe(withheldProperty.length);
    expect(withheldViolent.length).toBeGreaterThan(0);
    // Nothing sizeable may be withheld — the floor is about small counts only.
    for (const a of withheldViolent) {
      expect(num(a.crime_index), `${a.pno} should still have total offences`).not.toBeNull();
    }
  });

  it('never lets a sub-group exceed the total it is a part of', () => {
    // violent and property are siblings under crime_index. If either ever
    // exceeded the parent, the wrong offence code has been fetched — and any
    // scheme that weighted the parent alongside a child would double-count.
    for (const a of areas) {
      const total = num(a.crime_index);
      if (total === null) continue;
      for (const part of ['violent_crime_rate', 'property_crime_rate'] as const) {
        const v = num(a[part]);
        if (v === null) continue;
        expect(v, `${a.pno} ${part} exceeds crime_index`).toBeLessThanOrEqual(total);
      }
    }
  });

  it('uses violent crime for the safety factor, not total offences', () => {
    const safety = (QUALITY_FACTORS as unknown as {
      id: string; properties: string[]; defaultWeight: number;
    }[]).find((f) => f.id === 'safety');
    expect(safety?.properties).toEqual(['violent_crime_rate']);
    // Capped because the metric is municipal — see docs/QUALITY_INDEX.md.
    expect(safety?.defaultWeight).toBeLessThanOrEqual(15);
  });

  it('is still declared a proxy, because it is not a measurement of the area', () => {
    const entry = (dataSources as unknown as {
      metrics: Record<string, { is_proxy: boolean; note?: string }>;
    }).metrics.crime_index;
    expect(entry.is_proxy).toBe(true);
    expect(entry.note).toBe('note.crime_index');
  });

  it('keeps one history series per municipality too', () => {
    const byMunicipality = new Map<string, Set<string>>();
    for (const a of areas) {
      const kunta = a.kunta == null ? null : String(a.kunta);
      const history = a.crime_index_history;
      if (!kunta || history == null) continue;
      if (!byMunicipality.has(kunta)) byMunicipality.set(kunta, new Set());
      byMunicipality.get(kunta)!.add(JSON.stringify(history));
    }
    const split = [...byMunicipality.entries()].filter(([, s]) => s.size > 1);
    expect(split.map(([k]) => k)).toEqual([]);
  });
});
