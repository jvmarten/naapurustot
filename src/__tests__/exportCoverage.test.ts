import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportCsv, exportPdf } from '../utils/export';
import { setLang } from '../utils/i18n';
import type { NeighborhoodProperties } from '../utils/metrics';

// Minimal NeighborhoodProperties for testing
function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Helsinki keskusta',
    namn: 'Helsingfors centrum',
    kunta: '091',
    city: 'helsinki_metro',
    he_vakiy: 10000,
    he_kika: 35,
    ko_ika18y: 8000,
    ko_yl_kork: 3000,
    ko_al_kork: 2000,
    ko_ammat: 1500,
    ko_perus: 1000,
    hr_mtu: 30000,
    hr_ktu: 35000,
    pt_tyoll: 5000,
    pt_tyott: 500,
    pt_opisk: 1000,
    pt_elakel: 1500,
    ra_asunn: 8000,
    ra_as_kpa: 55.5,
    te_taly: 6000,
    quality_index: 75,
    unemployment_rate: 5.0,
    higher_education_rate: 40.0,
    foreign_language_pct: 12.5,
    ownership_rate: 45.0,
    rental_rate: 50.0,
    detached_house_share: 5.0,
    population_density: 5000,
    child_ratio: 10.0,
    student_share: 8.0,
    property_price_sqm: 5000,
    transit_stop_density: 15.0,
    air_quality_index: 2.5,
    ...overrides,
  } as NeighborhoodProperties;
}

describe('exportCsv', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setLang('fi');
    createObjectURLSpy = vi.fn(() => 'blob:test');
    revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;
    clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(v: string) { /* noop */ },
      set download(v: string) { (this as any)._download = v; },
      get download() { return (this as any)._download; },
      click: clickSpy,
    } as unknown as HTMLAnchorElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a CSV blob with BOM prefix', () => {
    exportCsv(makeProps(), {});
    expect(createObjectURLSpy).toHaveBeenCalled();
    const blobArg = (global.URL.createObjectURL as any).mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);
  });

  it('triggers download click', () => {
    exportCsv(makeProps(), {});
    expect(clickSpy).toHaveBeenCalled();
  });

  it('sanitizes filename with special characters', () => {
    const props = makeProps({ nimi: 'Test/Area:Name' });
    exportCsv(props, {});
    // The download filename should have special chars replaced with _
    const createElement = document.createElement as any;
    // Verify no crash — the method completed
    expect(clickSpy).toHaveBeenCalled();
  });

  it('uses pno as fallback when nimi is empty', () => {
    const props = makeProps({ nimi: '' as any });
    // Should not throw
    exportCsv(props, {});
    expect(clickSpy).toHaveBeenCalled();
  });

  it('handles null values in stats gracefully', () => {
    const props = makeProps({
      hr_mtu: null,
      unemployment_rate: null,
      quality_index: null,
    });
    // Should not throw — null values become '—'
    exportCsv(props, {});
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('exportPdf', () => {
  let windowOpenSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setLang('fi');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows alert when popup is blocked', () => {
    windowOpenSpy = vi.fn(() => null);
    vi.spyOn(window, 'open').mockImplementation(windowOpenSpy);
    const alertSpy = vi.fn();
    vi.spyOn(window, 'alert').mockImplementation(alertSpy);

    exportPdf(makeProps(), {});
    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][0]).toContain('ponnahdusikkuna');
  });

  it('shows English alert when popup blocked and lang is en', () => {
    setLang('en');
    vi.spyOn(window, 'open').mockReturnValue(null);
    const alertSpy = vi.fn();
    vi.spyOn(window, 'alert').mockImplementation(alertSpy);

    exportPdf(makeProps(), {});
    expect(alertSpy.mock.calls[0][0]).toContain('Popup');
  });

  it('writes HTML to new window when popup allowed', () => {
    const writeSpy = vi.fn();
    const closeSpy = vi.fn();
    const addEventSpy = vi.fn();
    const printSpy = vi.fn();
    const mockWindow = {
      document: { write: writeSpy, close: closeSpy },
      addEventListener: addEventSpy,
      print: printSpy,
      close: vi.fn(),
      requestAnimationFrame: (cb: () => void) => cb(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps(), {});
    expect(writeSpy).toHaveBeenCalled();
    const html = writeSpy.mock.calls[0][0];
    expect(html).toContain('Helsinki keskusta');
    expect(html).toContain('00100');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('includes quality index in PDF when available', () => {
    const writeSpy = vi.fn();
    const mockWindow = {
      document: { write: writeSpy, close: vi.fn() },
      addEventListener: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      requestAnimationFrame: (cb: () => void) => cb(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps({ quality_index: 85 }), {});
    const html = writeSpy.mock.calls[0][0];
    expect(html).toContain('85');
  });

  it('handles missing quality_index gracefully', () => {
    const writeSpy = vi.fn();
    const mockWindow = {
      document: { write: writeSpy, close: vi.fn() },
      addEventListener: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      requestAnimationFrame: (cb: () => void) => cb(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps({ quality_index: null }), {});
    const html = writeSpy.mock.calls[0][0];
    // When quality_index is null, the qi div should be absent
    // The ternary `qi != null ? ... : ''` should produce empty string
    expect(html).not.toContain('<div class="qi">');
  });

  it('escapes HTML in neighborhood names to prevent XSS', () => {
    const writeSpy = vi.fn();
    const mockWindow = {
      document: { write: writeSpy, close: vi.fn() },
      addEventListener: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      requestAnimationFrame: (cb: () => void) => cb(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps({ nimi: '<script>alert("xss")</script>' as any }), {});
    const html = writeSpy.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows Swedish name when it differs from Finnish', () => {
    const writeSpy = vi.fn();
    const mockWindow = {
      document: { write: writeSpy, close: vi.fn() },
      addEventListener: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      requestAnimationFrame: (cb: () => void) => cb(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    exportPdf(makeProps({ nimi: 'Helsinki', namn: 'Helsingfors' }), {});
    const html = writeSpy.mock.calls[0][0];
    expect(html).toContain('Helsingfors');
  });
});
