/**
 * Tests for SearchBar cross-subregion search.
 *
 * The dropdown must search the global `searchData` index (every area in
 * Finland) rather than the region-scoped `data`, so an area outside the
 * currently observed subregion is still findable. When no index is supplied
 * yet, it falls back to `data`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';
import { SearchBar } from '../components/SearchBar';

// Avoid hitting the geocoding network path during these tests.
vi.mock('../utils/geocode', () => ({
  geocodeAddress: vi.fn().mockResolvedValue([]),
}));

function fc(...areas: Array<{ pno: string; nimi: string; city: string }>): FeatureCollection {
  // Index features carry geometry: null (properties-only); cast bridges that to
  // the non-null default FeatureCollection type, mirroring processProperties.
  return {
    type: 'FeatureCollection',
    features: areas.map((a) => ({
      type: 'Feature',
      geometry: null,
      properties: a,
    })),
  } as unknown as FeatureCollection;
}

const regionData = fc({ pno: '00100', nimi: 'Helsinki keskusta', city: 'helsinki_metro' });
const globalIndex = fc(
  { pno: '00100', nimi: 'Helsinki keskusta', city: 'helsinki_metro' },
  { pno: '33100', nimi: 'Tampere Keskus', city: 'tampere' },
);

afterEach(() => cleanup());

describe('SearchBar cross-subregion search', () => {
  it('finds areas from the global index that are absent from region data', async () => {
    render(<SearchBar data={regionData} searchData={globalIndex} onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Tampere' } });

    await waitFor(() => {
      expect(screen.getByText('Tampere Keskus')).toBeTruthy();
    });
  });

  it('passes the matched postal code to onSelect', async () => {
    const onSelect = vi.fn();
    render(<SearchBar data={regionData} searchData={globalIndex} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Tampere' } });

    const option = await screen.findByText('Tampere Keskus');
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith('33100', expect.any(Array));
  });

  it('falls back to region data when no global index is provided', async () => {
    render(<SearchBar data={regionData} onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Tampere' } });

    // Tampere is not in the region-scoped data, so nothing should match.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText('Tampere Keskus')).toBeNull();
    // Helsinki (present in region data) still matches.
    fireEvent.change(input, { target: { value: 'Helsinki' } });
    await waitFor(() => {
      expect(screen.getByText('Helsinki keskusta')).toBeTruthy();
    });
  });
});
