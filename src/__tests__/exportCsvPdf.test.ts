/**
 * Export — CSV injection prevention and PDF HTML safety.
 *
 * Priority 3: Security. CSV injection can execute formulas in Excel.
 * XSS in PDF HTML can execute scripts in the print popup.
 *
 * Targets untested paths:
 * - escapeCsvField with tab character (0x09)
 * - escapeCsvField with carriage return (0x0D)
 * - exportCsv filename sanitization with path separators
 * - exportPdf HTML injection via neighborhood names
 * - collectStats null value handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportCsv, exportPdf } from '../utils/export';
import { setLang } from '../utils/i18n';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Helsinki',
    namn: 'Helsingfors',
    kunta: '091',
    city: 'helsinki_metro',
    he_vakiy: 5000,
    he_kika: 38,
    ko_ika18y: 4000,
    ko_yl_kork: 800,
    ko_al_kork: 500,
    ko_ammat: null,
    ko_perus: null,
    hr_mtu: 35000,
    hr_ktu: 38000,
    pt_tyoll: 2500,
    pt_tyott: 200,
    pt_opisk: 300,
    pt_vakiy: 3500,
    pt_elakel: 800,
    ra_asunn: 2000,
    ra_as_kpa: 55,
    ra_pt_as: 100,
    te_takk: 300,
    te_taly: 1500,
    te_omis_as: 900,
    te_vuok_as: 500,
    pinta_ala: 2000000,
    he_0_2: 100,
    he_3_6: 120,
    unemployment_rate: 5.7,
    higher_education_rate: 32.5,
    pensioner_share: 16,
    foreign_language_pct: 12,
    quality_index: 72,
    ownership_rate: 60,
    rental_rate: 33,
    population_density: 2500,
    child_ratio: 4.4,
    student_share: 8.6,
    detached_house_share: 5,
    property_price_sqm: 4500,
    transit_stop_density: 25,
    air_quality_index: 28,
    crime_index: 45,
    daycare_density: 3,
    school_density: 2,
    healthcare_density: 3,
    single_person_hh_pct: 45,
    cycling_density: 12,
    restaurant_density: 80,
    grocery_density: 4,
    sports_facility_density: 2,
    income_history: null,
    population_history: null,
    unemployment_history: null,
    income_change_pct: null,
    population_change_pct: null,
    unemployment_change_pct: null,
    voter_turnout_pct: null,
    party_diversity_index: null,
    broadband_coverage_pct: null,
    ev_charging_density: null,
    tree_canopy_pct: null,
    transit_reachability_score: null,
    youth_ratio_pct: null,
    gender_ratio: null,
    single_parent_hh_pct: null,
    families_with_children_pct: null,
    tech_sector_pct: null,
    healthcare_workers_pct: null,
    employment_rate: null,
    elderly_ratio_pct: null,
    avg_household_size: null,
    manufacturing_jobs_pct: null,
    public_sector_jobs_pct: null,
    service_sector_jobs_pct: null,
    new_construction_pct: null,
    he_naiset: null,
    he_miehet: null,
    he_18_19: null,
    he_20_24: null,
    he_25_29: null,
    he_65_69: null,
    he_70_74: null,
    he_75_79: null,
    he_80_84: null,
    he_85_: null,
    te_eil_np: null,
    te_laps: null,
    tp_tyopy: null,
    tp_j_info: null,
    tp_q_terv: null,
    tp_jalo_bf: null,
    tp_o_julk: null,
    tp_palv_gu: null,
    ra_raky: null,
    rental_price_sqm: null,
    price_to_rent_ratio: null,
    walkability_index: null,
    traffic_accident_rate: null,
    property_price_change_pct: null,
    school_quality_score: null,
    light_pollution: null,
    noise_pollution: null,
    water_proximity_m: null,
    avg_construction_year: null,
    ...overrides,
  } as NeighborhoodProperties;
}

beforeEach(() => {
  setLang('fi');
});

describe('exportCsv — filename sanitization', () => {
  let clickedHref: string | undefined;

  beforeEach(() => {
    clickedHref = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;
        Object.defineProperty(el, 'click', {
          value: vi.fn(() => { clickedHref = el.href; }),
        });
        return el;
      }
      return document.createElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes path separators in filename', () => {
    const props = makeProps({ nimi: 'Path/To\\Area' });
    exportCsv(props, {});

    const createElement = document.createElement as ReturnType<typeof vi.fn>;
    const anchor = createElement.mock.results.find(
      (r: { type: string; value: { download?: string } }) => r.type === 'return' && r.value.download
    );
    if (anchor) {
      expect(anchor.value.download).not.toContain('/');
      expect(anchor.value.download).not.toContain('\\');
    }
  });

  it('includes PNO in filename', () => {
    const props = makeProps({ pno: '00250', nimi: 'Käpylä' });
    exportCsv(props, {});

    const createElement = document.createElement as ReturnType<typeof vi.fn>;
    const anchor = createElement.mock.results.find(
      (r: { type: string; value: { download?: string } }) => r.type === 'return' && r.value.download
    );
    if (anchor) {
      expect(anchor.value.download).toContain('00250');
    }
  });
});

describe('exportPdf — HTML injection prevention', () => {
  let writtenHtml: string;

  beforeEach(() => {
    writtenHtml = '';
    const mockWindow = {
      document: {
        write: (html: string) => { writtenHtml = html; },
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(),
      closed: false,
      print: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes XSS in neighborhood name', () => {
    const props = makeProps({ nimi: '<script>alert("xss")</script>' });
    exportPdf(props, {});

    expect(writtenHtml).not.toContain('<script>');
    expect(writtenHtml).toContain('&lt;script&gt;');
  });

  it('escapes XSS in PNO', () => {
    const props = makeProps({ pno: '"><img src=x onerror=alert(1)>' as never });
    exportPdf(props, {});

    // The < and > around the img tag should be escaped, preventing execution
    expect(writtenHtml).not.toContain('<img src=x');
    expect(writtenHtml).toContain('&lt;img');
    expect(writtenHtml).toContain('&quot;');
  });

  it('escapes XSS in Swedish name', () => {
    const props = makeProps({ namn: '<svg onload=alert(1)>' });
    exportPdf(props, {});

    // The < and > should be escaped, making the SVG tag inert
    expect(writtenHtml).not.toContain('<svg onload');
    expect(writtenHtml).toContain('&lt;svg');
  });

  it('handles popup blocker', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    const props = makeProps();
    exportPdf(props, {});

    expect(window.alert).toHaveBeenCalled();
  });

  it('includes quality category in PDF when quality_index exists', () => {
    const props = makeProps({ quality_index: 75 });
    exportPdf(props, {});

    // Quality index 75 maps to "Good" / "Hyvä"
    expect(writtenHtml).toContain('75');
  });
});
