import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RadarChart from '../components/RadarChart';
import type { NeighborhoodProperties } from '../utils/metrics';
import { setLang } from '../utils/i18n';

const label = (data: Record<string, unknown>, avg: Record<string, number> = {}) => {
  const { container } = render(<RadarChart data={data as unknown as NeighborhoodProperties} metroAverages={avg} />);
  return container.querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
};

describe('RadarChart per country', () => {
  it('reads a Swedish area\'s income as economic standard, on Sweden\'s range', async () => {
    await setLang('en');
    const se = label({
      pno: '0180C1090', nimi: 'Farsta 5', economic_standard_median: 305000, crime_index: 140,
      transit_stop_density: 10, higher_education_rate: 40, grocery_density: 2, healthcare_density: 2, school_density: 1,
    });
    // Income has a value; only housing (Finland's €/m², which Sweden lacks) is missing.
    expect(se).toMatch(/Income \d+/);
    expect(se).toMatch(/Housing No data/i);
    expect(se.match(/No data/gi)).toHaveLength(1);
  });

  it('leaves a Finnish area on hr_mtu', async () => {
    await setLang('en');
    const fi = label({ pno: '00100', nimi: 'Helsinki', hr_mtu: 30000, economic_standard_median: 999999 });
    expect(fi).toMatch(/Income \d+/);
    expect(fi).not.toMatch(/Income No data/i);
  });
});
