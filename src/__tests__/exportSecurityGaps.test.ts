import { describe, it, expect, vi } from 'vitest';
import { exportCsv, exportPdf } from '../utils/export';
import { escapeHtml } from '../utils/formatting';

// ─── CSV Injection Prevention ───

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('a<b')).toBe('a&lt;b');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("a'b")).toBe('a&#39;b');
  });

  it('escapes multiple special characters in sequence', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('does not double-escape already escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('handles all five entities in one string', () => {
    expect(escapeHtml(`<div class="x" data-v='y'>&</div>`)).toBe(
      '&lt;div class=&quot;x&quot; data-v=&#39;y&#39;&gt;&amp;&lt;/div&gt;',
    );
  });
});

describe('exportCsv — CSV injection prevention and file safety', () => {
  it('sanitizes filename and creates download link', () => {
    const mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const props = {
      pno: '00100', nimi: 'Test/Bad:Name', namn: 'Test',
      he_vakiy: null, hr_mtu: null, hr_ktu: null,
      unemployment_rate: null, higher_education_rate: null,
      foreign_language_pct: null, quality_index: null,
      ownership_rate: null, rental_rate: null, ra_as_kpa: null,
      detached_house_share: null, ra_asunn: null, te_taly: null,
      population_density: null, child_ratio: null, student_share: null,
      property_price_sqm: null, transit_stop_density: null,
      air_quality_index: null, pt_tyoll: null, pt_tyott: null,
      pt_opisk: null, pt_elakel: null,
    };

    exportCsv(props as any, {});

    // Should replace / and : with _
    expect(mockAnchor.download).toMatch(/Test_Bad_Name/);
    expect(mockAnchor.download).not.toMatch(/[/:*?"<>|]/);
    expect(mockAnchor.download).toMatch(/\.csv$/);
    expect(mockAnchor.click).toHaveBeenCalled();
  });

  it('uses pno as fallback filename when nimi is empty', () => {
    const mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const props = {
      pno: '00100', nimi: '', namn: 'Test',
      he_vakiy: null, hr_mtu: null, hr_ktu: null,
      unemployment_rate: null, higher_education_rate: null,
      foreign_language_pct: null, quality_index: null,
      ownership_rate: null, rental_rate: null, ra_as_kpa: null,
      detached_house_share: null, ra_asunn: null, te_taly: null,
      population_density: null, child_ratio: null, student_share: null,
      property_price_sqm: null, transit_stop_density: null,
      air_quality_index: null, pt_tyoll: null, pt_tyott: null,
      pt_opisk: null, pt_elakel: null,
    };

    exportCsv(props as any, {});
    // When nimi is empty, nimi || pno → pno
    expect(mockAnchor.download).toContain('00100');
  });
});

describe('exportPdf — HTML safety', () => {
  it('generates safe HTML without XSS in neighborhood name', () => {
    const mockWindow = {
      document: { write: vi.fn(), close: vi.fn() },
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = {
      pno: '00100',
      nimi: '<script>alert("xss")</script>',
      namn: 'Test"onclick="alert(1)',
      he_vakiy: 1000,
      hr_mtu: 30000,
      hr_ktu: null,
      unemployment_rate: null,
      higher_education_rate: null,
      foreign_language_pct: null,
      quality_index: 75,
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
    };

    exportPdf(props as any, {});

    const html = mockWindow.document.write.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('handles popup blocked gracefully', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const props = {
      pno: '00100', nimi: 'Test', namn: 'Test',
      he_vakiy: null, hr_mtu: null, hr_ktu: null,
      unemployment_rate: null, higher_education_rate: null,
      foreign_language_pct: null, quality_index: null,
      ownership_rate: null, rental_rate: null, ra_as_kpa: null,
      detached_house_share: null, ra_asunn: null, te_taly: null,
      population_density: null, child_ratio: null, student_share: null,
      property_price_sqm: null, transit_stop_density: null,
      air_quality_index: null, pt_tyoll: null, pt_tyott: null,
      pt_opisk: null, pt_elakel: null,
    };

    exportPdf(props as any, {});
    expect(alertSpy).toHaveBeenCalled();
  });

  it('includes quality category badge when quality_index is set', () => {
    const mockWindow = {
      document: { write: vi.fn(), close: vi.fn() },
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    const props = {
      pno: '00100', nimi: 'Test', namn: 'Test',
      he_vakiy: 1000, hr_mtu: 30000, hr_ktu: null,
      unemployment_rate: null, higher_education_rate: null,
      foreign_language_pct: null, quality_index: 85,
      ownership_rate: null, rental_rate: null, ra_as_kpa: null,
      detached_house_share: null, ra_asunn: null, te_taly: null,
      population_density: null, child_ratio: null, student_share: null,
      property_price_sqm: null, transit_stop_density: null,
      air_quality_index: null, pt_tyoll: null, pt_tyott: null,
      pt_opisk: null, pt_elakel: null,
    };

    exportPdf(props as any, {});

    const html = mockWindow.document.write.mock.calls[0][0] as string;
    expect(html).toContain('85');
    // Should contain the quality category label
    expect(html).toMatch(/Excellent|Erinomainen/);
  });
});
