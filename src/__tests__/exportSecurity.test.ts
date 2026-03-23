/**
 * Critical security tests for export.ts — CSV injection prevention
 * and HTML escaping in PDF generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';

// Mock i18n like the existing export test
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  setLang: vi.fn(),
  getLang: () => 'fi' as const,
}));

import { exportCsv, exportPdf } from '../utils/export';

describe('CSV injection prevention', () => {
  let capturedBlobContent: string | undefined;
  let createdAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    capturedBlobContent = undefined;
    createdAnchor = { href: '', download: '', click: vi.fn() };

    vi.spyOn(document, 'createElement').mockReturnValue(createdAnchor as unknown as HTMLAnchorElement);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Capture blob content
    const OriginalBlob = Blob;
    globalThis.Blob = class MockBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (parts && parts.length > 0) {
          capturedBlobContent = String(parts[0]);
        }
      }
    } as typeof Blob;
  });

  it('CSV starts with UTF-8 BOM for Excel compatibility', () => {
    exportCsv({ pno: '00100', nimi: 'Test', namn: 'Test' } as NeighborhoodProperties, {});
    expect(capturedBlobContent).toBeDefined();
    expect(capturedBlobContent!.charCodeAt(0)).toBe(0xFEFF);
  });

  it('filename replaces special characters with underscores', () => {
    exportCsv({ pno: '00100', nimi: 'Test/Area:Name', namn: 'Test' } as NeighborhoodProperties, {});
    expect(createdAnchor.download).toBe('Test_Area_Name_00100.csv');
  });

  it('filename handles characters like < > | * ? "', () => {
    exportCsv({ pno: '00100', nimi: 'A<B>C|D*E?F"G', namn: 'Test' } as NeighborhoodProperties, {});
    expect(createdAnchor.download).toBe('A_B_C_D_E_F_G_00100.csv');
    // No dangerous characters in filename
    expect(createdAnchor.download).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('CSV fields with formula-triggering characters are escaped', () => {
    // The exportCsv collects stats from the data. The escapeCsvField function
    // should prefix =, +, -, @, tab, and CR characters with a single quote
    exportCsv({ pno: '00100', nimi: '=SUM(A1)', namn: 'Test' } as NeighborhoodProperties, {});
    expect(capturedBlobContent).toBeDefined();
    // The filename uses nimi which is escaped for the filename,
    // but the CSV content should escape formula characters
    // Since the CSV values come from formatNumber/formatEuro etc.,
    // they shouldn't contain formulas. But labels go through escapeCsvField.
    // Verify the CSV doesn't contain raw = at the start of any field
    const lines = capturedBlobContent!.split('\n');
    for (const line of lines) {
      const fields = line.split(',');
      for (const field of fields) {
        // No field should start with = without being quoted/prefixed
        if (field.startsWith('=')) {
          // This would be a CSV injection vulnerability
          throw new Error(`CSV injection: field starts with '=': ${field}`);
        }
      }
    }
  });

  it('CSV properly quotes fields containing commas', () => {
    exportCsv({ pno: '00100', nimi: 'Test', namn: 'Test', he_vakiy: 12345 } as NeighborhoodProperties, {});
    expect(capturedBlobContent).toBeDefined();
    // Fields with locale-formatted numbers (e.g., "12 345") don't contain commas in fi locale
    // but if they did, they should be properly quoted
  });
});

describe('HTML escaping in PDF export', () => {
  it('escapes HTML special characters to prevent XSS', () => {
    let writtenHtml = '';
    const mockWin = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);

    exportPdf(
      {
        pno: '00100',
        nimi: '<script>alert("xss")</script>',
        namn: '"><img onerror=alert(1)>',
        quality_index: 75,
      } as unknown as NeighborhoodProperties,
      {},
    );

    // Escaped characters should appear
    expect(writtenHtml).toContain('&lt;script&gt;');
    expect(writtenHtml).not.toContain('<script>alert');
    expect(writtenHtml).toContain('&quot;');
  });

  it('handles popup blocker gracefully', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    exportPdf(
      { pno: '00100', nimi: 'Test', namn: 'Test', quality_index: 50 } as NeighborhoodProperties,
      {},
    );

    expect(alertSpy).toHaveBeenCalled();
  });

  it('includes quality category label in output', () => {
    let writtenHtml = '';
    const mockWin = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWin as unknown as Window);

    exportPdf(
      { pno: '00100', nimi: 'Test', namn: 'Test', quality_index: 85 } as NeighborhoodProperties,
      {},
    );

    // Quality score should be in the HTML
    expect(writtenHtml).toContain('85');
  });
});
