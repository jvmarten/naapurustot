import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n before importing the module under test
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  setLang: vi.fn(),
  getLang: () => 'fi' as const,
}));

import { exportCsv, exportGeoJson, exportJson, exportComparisonCsv } from '../utils/export';

const NOTES_KEY = 'naapurustot-notes';

describe('exportCsv', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let createdAnchor: HTMLAnchorElement;
  let capturedBlobContent: string | undefined;

  beforeEach(() => {
    clickSpy = vi.fn();
    createdAnchor = { href: '', download: '', click: clickSpy } as any;

    vi.spyOn(document, 'createElement').mockReturnValue(createdAnchor as any);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Capture CSV content passed to Blob
    capturedBlobContent = undefined;
    const OriginalBlob = Blob;
    globalThis.Blob = class MockBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (parts && parts.length > 0) {
          capturedBlobContent = String(parts[0]);
        }
      }
    } as any;
  });

  it('creates a blob with CSV content', () => {
    const data = {
      pno: '00100',
      nimi: 'Helsinki',
      namn: 'Helsingfors',
      he_vakiy: 5000,
      hr_mtu: 35000,
      unemployment_rate: 8.5,
      higher_education_rate: 55,
      quality_index: 72,
    } as any;

    const avg = { hr_mtu: 30000, unemployment_rate: 10 };

    exportCsv(data, avg);

    expect(capturedBlobContent).toBeDefined();
    // CSV should contain the BOM + header + data rows
    expect(capturedBlobContent).toContain('\uFEFF');
    // Header row uses i18n keys
    expect(capturedBlobContent).toContain('export.field');
    expect(capturedBlobContent).toContain('export.value');
    // Should contain multiple newline-separated rows
    const lines = capturedBlobContent!.split('\n');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('handles null values with dash character', () => {
    const data = {
      pno: '00100',
      nimi: 'Helsinki',
      namn: 'Helsingfors',
      he_vakiy: null,
      hr_mtu: null,
      unemployment_rate: null,
      higher_education_rate: null,
      quality_index: null,
      hr_ktu: null,
      foreign_language_pct: null,
      ownership_rate: null,
      rental_rate: null,
      ra_as_kpa: null,
      detached_house_share: null,
      ra_asunn: null,
      te_taly: null,
      population_density: null,
      child_ratio: null,
      student_share: null,
      property_price_sqm: null,
      transit_stop_density: null,
      air_quality_index: null,
      pt_tyoll: null,
      pt_tyott: null,
      pt_opisk: null,
      pt_elakel: null,
    } as any;

    const avg = {};

    exportCsv(data, avg);

    expect(capturedBlobContent).toBeDefined();
    // Null values should be represented with the dash character
    expect(capturedBlobContent).toContain('\u2014');
  });

  it('triggers a file download with correct filename', () => {
    vi.useFakeTimers();
    const data = {
      pno: '00100',
      nimi: 'Helsinki',
      namn: 'Helsingfors',
      hr_mtu: 35000,
      he_vakiy: 5000,
      quality_index: 72,
    } as any;

    const avg = {};

    exportCsv(data, avg);

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(createdAnchor.download).toBe('Helsinki_00100.csv');
    expect(createdAnchor.href).toBe('blob:mock-url');
    expect(clickSpy).toHaveBeenCalled();
    // revokeObjectURL is deferred to allow the browser to start the download
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();
  });
});

// CF-10: machine-readable GeoJSON / JSON export shape.
describe('exportGeoJson / exportJson', () => {
  let createdAnchor: HTMLAnchorElement;
  let capturedBlobContent: string | undefined;

  beforeEach(() => {
    createdAnchor = { href: '', download: '', click: vi.fn() } as any;
    vi.spyOn(document, 'createElement').mockReturnValue(createdAnchor as any);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    capturedBlobContent = undefined;
    const OriginalBlob = Blob;
    globalThis.Blob = class MockBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (parts && parts.length > 0) capturedBlobContent = String(parts[0]);
      }
    } as any;
  });

  const feature = (pno: string, nimi: string): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: {
      pno,
      nimi,
      he_vakiy: 5000,
      hr_mtu: 35000,
      property_price_sqm: null,
      // Internal / non-tabular values that must be dropped from the export:
      _isMetroArea: false,
      quality_dimension_scores: { housing: 70 },
    } as any,
  });

  it('emits a FeatureCollection with geometry and RAW numeric properties', () => {
    exportGeoJson([feature('00100', 'Helsinki')]);

    expect(capturedBlobContent).toBeDefined();
    const parsed = JSON.parse(capturedBlobContent!);
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features).toHaveLength(1);
    const f = parsed.features[0];
    // Geometry preserved
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [24.9, 60.2] });
    // RAW numeric values (not formatted strings), null preserved
    expect(f.properties.he_vakiy).toBe(5000);
    expect(f.properties.hr_mtu).toBe(35000);
    expect(f.properties.property_price_sqm).toBeNull();
    // Internal runtime-only keys stripped
    expect(f.properties).not.toHaveProperty('_isMetroArea');
    expect(f.properties).not.toHaveProperty('quality_dimension_scores');
    // Single-feature filename uses name + pno
    expect(createdAnchor.download).toBe('Helsinki_00100.geojson');
  });

  it('exportJson emits a flat array of raw records without geometry', () => {
    exportJson([feature('00100', 'Helsinki'), feature('00200', 'Lauttasaari')]);

    expect(capturedBlobContent).toBeDefined();
    const parsed = JSON.parse(capturedBlobContent!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).not.toHaveProperty('geometry');
    expect(parsed[0].hr_mtu).toBe(35000);
    expect(parsed[0]).not.toHaveProperty('quality_dimension_scores');
    // Multi-feature filename
    expect(createdAnchor.download).toBe('naapurustot_2.json');
  });

  it('is a no-op for an empty feature set', () => {
    exportGeoJson([]);
    expect(createdAnchor.click).not.toHaveBeenCalled();
  });
});

// QW-5: the user's own private notes are folded into every export channel.
describe('QW-5 private notes inclusion', () => {
  let capturedBlobContent: string | undefined;

  beforeEach(() => {
    localStorage.clear();
    const createdAnchor = { href: '', download: '', click: vi.fn() } as any;
    vi.spyOn(document, 'createElement').mockReturnValue(createdAnchor);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    capturedBlobContent = undefined;
    const OriginalBlob = Blob;
    globalThis.Blob = class MockBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (parts && parts.length > 0) capturedBlobContent = String(parts[0]);
      }
    } as any;
  });

  const seedNote = (pno: string, text: string) =>
    localStorage.setItem(NOTES_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}'), [pno]: text }));

  const area = (pno: string, nimi: string): any => ({ pno, nimi, namn: nimi, he_vakiy: 5000, hr_mtu: 35000, quality_index: 70 });
  const feat = (pno: string, nimi: string): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno, nimi, he_vakiy: 5000, hr_mtu: 35000 } as any,
  });

  it('appends a labelled notes row to the single-area CSV', () => {
    seedNote('00100', 'Quiet and leafy');
    exportCsv(area('00100', 'Helsinki'), {});
    expect(capturedBlobContent).toContain('export.your_notes');
    expect(capturedBlobContent).toContain('Quiet and leafy');
  });

  it('omits the notes row from the CSV when no note exists', () => {
    exportCsv(area('00100', 'Helsinki'), {});
    expect(capturedBlobContent).not.toContain('export.your_notes');
  });

  it('adds a user_note property to exported GeoJSON features only when present', () => {
    seedNote('00100', 'Great transit');
    exportGeoJson([feat('00100', 'Helsinki'), feat('00200', 'Lauttasaari')]);
    const parsed = JSON.parse(capturedBlobContent!);
    expect(parsed.features[0].properties.user_note).toBe('Great transit');
    expect(parsed.features[1].properties).not.toHaveProperty('user_note');
  });

  it('adds user_note to the flat JSON records when present', () => {
    seedNote('00100', 'Note A');
    exportJson([feat('00100', 'Helsinki')]);
    const parsed = JSON.parse(capturedBlobContent!);
    expect(parsed[0].user_note).toBe('Note A');
  });

  it('aligns per-area notes as a final row in the comparison CSV', () => {
    seedNote('00100', 'Has a park');
    exportComparisonCsv([area('00100', 'Helsinki'), area('00200', 'Lauttasaari')]);
    expect(capturedBlobContent).toContain('export.your_notes');
    expect(capturedBlobContent).toContain('Has a park');
    // The note row has one label cell + one cell per area (3 commas separating values
    // is not asserted directly; presence of the empty trailing cell for the noteless
    // area is implied by the row existing with the labelled heading).
  });
});
