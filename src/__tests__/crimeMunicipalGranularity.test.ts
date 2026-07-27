import { describe, it, expect } from 'vitest';
import regionProperties from '../data/region_properties.json';
import { decodeColumnar } from '../utils/columnar';
import dataSources from '../data/data_sources.json';

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
