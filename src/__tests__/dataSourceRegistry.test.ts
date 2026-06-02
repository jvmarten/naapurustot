/**
 * IN-2: Data-source registry drift checks.
 *
 * src/data/data_sources.json is the single source of truth for every map layer's
 * attribution. These tests fail CI if a layer loses its registry row, a publisher
 * reference dangles, or the generated METRIC_SOURCES map drifts from the registry —
 * so every number shown on the map always traces to a citable, dated, licensed source.
 */
import { describe, it, expect } from 'vitest';
import { LAYERS } from '../utils/colorScales';
import {
  METRIC_SOURCES,
  DATA_SOURCE_PUBLISHERS,
  DATA_SOURCE_METRICS,
  getMetricSource,
  latestVintageYear,
} from '../utils/metrics';

const VALID_GRANULARITY = new Set(['postal', '250m grid', 'derived']);

describe('Data-source registry (IN-2)', () => {
  it('every map layer has a registry entry for its property', () => {
    for (const layer of LAYERS) {
      expect(
        DATA_SOURCE_METRICS[layer.property],
        `Layer "${layer.id}" (property "${layer.property}") has no row in data_sources.json`,
      ).toBeDefined();
    }
  });

  it('every metric references a publisher that exists', () => {
    for (const [prop, entry] of Object.entries(DATA_SOURCE_METRICS)) {
      expect(
        DATA_SOURCE_PUBLISHERS[entry.publisher],
        `Metric "${prop}" references unknown publisher "${entry.publisher}"`,
      ).toBeDefined();
    }
  });

  it('every metric row has valid required fields', () => {
    for (const [prop, entry] of Object.entries(DATA_SOURCE_METRICS)) {
      expect(typeof entry.source, `${prop}.source`).toBe('string');
      expect(entry.source.length, `${prop}.source empty`).toBeGreaterThan(0);
      expect(['string', 'number'], `${prop}.vintage type`).toContain(typeof entry.vintage);
      expect(String(entry.vintage).length, `${prop}.vintage empty`).toBeGreaterThan(0);
      expect(
        VALID_GRANULARITY.has(entry.granularity),
        `${prop}.granularity "${entry.granularity}" not one of ${[...VALID_GRANULARITY].join(', ')}`,
      ).toBe(true);
      expect(typeof entry.is_proxy, `${prop}.is_proxy`).toBe('boolean');
    }
  });

  it('every publisher has a name, an https URL, and a license', () => {
    for (const [id, pub] of Object.entries(DATA_SOURCE_PUBLISHERS)) {
      expect(pub.name?.length, `${id}.name empty`).toBeGreaterThan(0);
      expect(pub.license?.length, `${id}.license empty`).toBeGreaterThan(0);
      expect(pub.url, `${id}.url not https`).toMatch(/^https:\/\//);
    }
  });

  it('METRIC_SOURCES is generated from the registry with matching source/year', () => {
    for (const [prop, entry] of Object.entries(DATA_SOURCE_METRICS)) {
      if (entry.panel === false) {
        expect(
          METRIC_SOURCES[prop],
          `panel:false metric "${prop}" should not be in METRIC_SOURCES`,
        ).toBeUndefined();
      } else {
        expect(METRIC_SOURCES[prop], `metric "${prop}" missing from METRIC_SOURCES`).toBeDefined();
        expect(METRIC_SOURCES[prop].source).toBe(entry.source);
        expect(METRIC_SOURCES[prop].year).toBe(entry.vintage);
      }
    }
  });

  it('every METRIC_SOURCES key traces back to a registry row', () => {
    for (const prop of Object.keys(METRIC_SOURCES)) {
      expect(DATA_SOURCE_METRICS[prop], `METRIC_SOURCES key "${prop}" not in registry`).toBeDefined();
    }
  });

  it('getMetricSource resolves URL + license for every registry metric', () => {
    for (const prop of Object.keys(DATA_SOURCE_METRICS)) {
      const resolved = getMetricSource(prop);
      expect(resolved, `getMetricSource("${prop}")`).toBeDefined();
      expect(resolved!.url, `${prop} url`).toMatch(/^https:\/\//);
      expect(resolved!.license.length, `${prop} license`).toBeGreaterThan(0);
      expect(resolved!.publisherName.length, `${prop} publisherName`).toBeGreaterThan(0);
    }
  });

  it('getMetricSource returns undefined for an unknown property', () => {
    expect(getMetricSource('totally_made_up_property')).toBeUndefined();
  });

  it('preserves attribution for a sample of pre-existing layers (no display regression)', () => {
    expect(METRIC_SOURCES.hr_mtu).toEqual({ source: 'Tilastokeskus (Paavo)', year: 2024 });
    expect(METRIC_SOURCES.crime_index).toEqual({ source: 'Poliisi', year: 2023 });
    expect(METRIC_SOURCES.noise_pollution.year).toBe('2012–2022');
  });

  it('flags transit_reachability and light_pollution as proxy/estimate (PO-2)', () => {
    expect(getMetricSource('transit_reachability_score')?.isProxy).toBe(true);
    expect(getMetricSource('light_pollution')?.isProxy).toBe(true);
    expect(getMetricSource('hr_mtu')?.isProxy).toBe(false);
  });
});

describe('latestVintageYear (PO-3)', () => {
  it('returns a numeric year as-is', () => {
    expect(latestVintageYear(2024)).toBe(2024);
  });
  it('extracts the most recent year from a range string', () => {
    expect(latestVintageYear('2012–2022')).toBe(2022);
    expect(latestVintageYear('2020–2025')).toBe(2025);
  });
  it('returns null for missing/yearless input', () => {
    expect(latestVintageYear(null)).toBeNull();
    expect(latestVintageYear(undefined)).toBeNull();
    expect(latestVintageYear('n/a')).toBeNull();
  });
});
