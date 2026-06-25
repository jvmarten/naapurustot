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
  geocodeAddressDetailed: vi.fn().mockResolvedValue({ status: 'ok', results: [] }),
  GEOCODING_ENABLED: true,
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

// --- Accent-insensitive + municipality-aware search ---
function fcMuni(...areas: Array<{ pno: string; nimi: string; city: string; muni?: string }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas.map((a) => ({ type: 'Feature', geometry: null, properties: a })),
  } as unknown as FeatureCollection;
}

const accentIndex = fcMuni(
  { pno: '00260', nimi: 'Töölö', city: 'helsinki_metro' },
  { pno: '44100', nimi: 'Äänekoski Keskusta', city: 'aanekoski' },
);

describe('SearchBar accent-insensitive search', () => {
  it('matches a diacritic name typed without diacritics ("Toolo" → "Töölö")', async () => {
    render(<SearchBar data={null} searchData={accentIndex} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Toolo' } });
    await waitFor(() => expect(screen.getByText('Töölö')).toBeTruthy());
  });

  it('matches "Aanekoski" → "Äänekoski Keskusta"', async () => {
    render(<SearchBar data={null} searchData={accentIndex} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Aanekoski' } });
    await waitFor(() => expect(screen.getByText('Äänekoski Keskusta')).toBeTruthy());
  });
});

describe('SearchBar municipality-aware search', () => {
  const muniIndex = fcMuni(
    { pno: '02400', nimi: 'Kirkkonummi Keskus', city: 'helsinki_metro', muni: 'Kirkkonummi' },
    // Area whose own name does NOT contain its town — only reachable via `muni`.
    { pno: '02770', nimi: 'Lakisto', city: 'helsinki_metro', muni: 'Espoo' },
  );

  it("finds a municipality's areas by town name even when the area name is generic", async () => {
    render(<SearchBar data={null} searchData={muniIndex} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Espoo' } });
    await waitFor(() => expect(screen.getByText('Lakisto')).toBeTruthy());
  });

  it('is accent-insensitive on the municipality field too ("Jarvenpaa")', async () => {
    const idx = fcMuni({ pno: '04400', nimi: 'Keskusta', city: 'helsinki_metro', muni: 'Järvenpää' });
    render(<SearchBar data={null} searchData={idx} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Jarvenpaa' } });
    await waitFor(() => expect(screen.getByText('Keskusta')).toBeTruthy());
  });
});
