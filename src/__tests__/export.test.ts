import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n before importing the module under test
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  setLang: vi.fn(),
  getLang: () => 'fi' as const,
}));

import { exportCsv } from '../utils/export';

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
      avg_taxable_income: null,
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
      rental_price_sqm: null,
      kela_benefit_pct: null,
      walkability_index: null,
      property_price_sqm: null,
      transit_stop_density: null,
      air_quality_index: null,
      obesity_rate: null,
      life_expectancy: null,
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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
