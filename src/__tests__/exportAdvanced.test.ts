import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportCsv, exportPdf } from '../utils/export';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Kallio',
    namn: 'Berghäll',
    kunta: '091',
    city: 'helsinki_metro',
    he_vakiy: 5000,
    hr_mtu: 35000,
    hr_ktu: 30000,
    unemployment_rate: 7.5,
    foreign_language_pct: 15,
    ownership_rate: 40,
    rental_rate: 55,
    ra_as_kpa: 52.3,
    detached_house_share: 5,
    ra_asunn: 3000,
    te_taly: 2500,
    population_density: 15000,
    child_ratio: 12,
    student_share: 8,
    property_price_sqm: 5500,
    transit_stop_density: 42.5,
    air_quality_index: 22,
    pt_tyoll: 3000,
    pt_tyott: 300,
    pt_opisk: 500,
    pt_elakel: 600,
    quality_index: 72,
    ...overrides,
  } as NeighborhoodProperties;
}

const mockAvg: Record<string, number> = {
  hr_mtu: 32000,
  unemployment_rate: 9.0,
  property_price_sqm: 4500,
  transit_stop_density: 30,
};

describe('exportCsv — CSV injection prevention', () => {
  let lastBlob: Blob | null = null;
  let lastFilename: string | null = null;

  beforeEach(() => {
    lastBlob = null;
    lastFilename = null;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return {
          set href(v: string) { /* noop */ },
          set download(v: string) { lastFilename = v; },
          click: () => {},
        } as unknown as HTMLAnchorElement;
      }
      return document.createElement(tag);
    });
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[], options?: BlobPropertyBag) {
      lastBlob = { size: 0, type: options?.type ?? '' } as Blob;
      (lastBlob as unknown as { _text: string })._text = parts?.join('') ?? '';
      return lastBlob;
    });
  });

  it('sanitizes filename with special characters', () => {
    const props = makeProps({ nimi: 'Test/Path:Name*"<>|' });
    exportCsv(props, mockAvg);
    expect(lastFilename).not.toContain('/');
    expect(lastFilename).not.toContain(':');
    expect(lastFilename).not.toContain('*');
    expect(lastFilename).not.toContain('"');
    expect(lastFilename).not.toContain('<');
    expect(lastFilename).not.toContain('>');
    expect(lastFilename).not.toContain('|');
  });

  it('uses pno as fallback when nimi is empty', () => {
    const props = makeProps({ nimi: '' as unknown as string });
    exportCsv(props, mockAvg);
    expect(lastFilename).toContain('00100');
  });

  it('includes UTF-8 BOM in CSV content', () => {
    exportCsv(makeProps(), mockAvg);
    const text = (lastBlob as unknown as { _text: string })._text;
    expect(text.startsWith('\uFEFF')).toBe(true);
  });
});

describe('exportPdf — popup handling', () => {
  it('shows alert when popup is blocked', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'open').mockReturnValue(null);

    exportPdf(makeProps(), mockAvg);
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('creates popup with correct HTML structure', () => {
    let writtenHtml = '';
    const mockWindow = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
      closed: false,
      requestAnimationFrame: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps(), mockAvg);

    expect(writtenHtml).toContain('<!DOCTYPE html>');
    expect(writtenHtml).toContain('Kallio');
    expect(writtenHtml).toContain('00100');
    expect(writtenHtml).toContain('72');
  });

  it('escapes HTML in neighborhood name to prevent XSS', () => {
    let writtenHtml = '';
    const mockWindow = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
      closed: false,
      requestAnimationFrame: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = makeProps({ nimi: '<script>alert("xss")</script>' as unknown as string });
    exportPdf(props, mockAvg);

    expect(writtenHtml).not.toContain('<script>');
    expect(writtenHtml).toContain('&lt;script&gt;');
  });

  it('handles null quality_index', () => {
    let writtenHtml = '';
    const mockWindow = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
      closed: false,
      requestAnimationFrame: vi.fn(),
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = makeProps({ quality_index: null });
    exportPdf(props, mockAvg);

    expect(writtenHtml).toContain('<!DOCTYPE html>');
  });
});
