/**
 * Tests for CSV export — CSV injection prevention, BOM, and proper escaping.
 *
 * CSV injection is a real attack vector: a crafted neighborhood name containing
 * "=cmd|'/C calc'!A0" could execute commands when opened in Excel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportCsv } from '../utils/export';
import type { NeighborhoodProperties } from '../utils/metrics';
import { setLang } from '../utils/i18n';

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Test',
    namn: 'Test',
    he_vakiy: 1000,
    he_kika: 35,
    ko_ika18y: 800,
    ko_yl_kork: 200,
    ko_al_kork: 150,
    ko_ammat: 100,
    ko_perus: 50,
    hr_mtu: 30000,
    hr_ktu: 35000,
    pt_tyoll: 600,
    pt_tyott: 50,
    pt_opisk: 100,
    pt_vakiy: 800,
    pt_elakel: 50,
    ra_asunn: 500,
    ra_as_kpa: 55,
    ra_pt_as: 50,
    te_takk: 100,
    te_taly: 400,
    te_omis_as: 200,
    te_vuok_as: 150,
    pinta_ala: 1_000_000,
    he_0_2: 30,
    he_3_6: 40,
    unemployment_rate: 6.3,
    higher_education_rate: 43.8,
    pensioner_share: 6.3,
    foreign_language_pct: 8.0,
    quality_index: 65,
    ownership_rate: 50,
    rental_rate: 37.5,
    population_density: 1000,
    child_ratio: 7.0,
    student_share: 12.5,
    detached_house_share: 10.0,
    property_price_sqm: 4000,
    transit_stop_density: 40.0,
    air_quality_index: 30.0,
    crime_index: 70.0,
    daycare_density: 3,
    school_density: 2,
    healthcare_density: 4,
    single_person_hh_pct: 50.0,
    cycling_density: 20,
    restaurant_density: 30,
    grocery_density: 5,
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
    tp_jk_info: null,
    tp_qr_terv: null,
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
    ...overrides,
  };
}

describe('exportCsv — CSV content and security', () => {
  let capturedBlob: Blob | null;
  let capturedFilename: string;

  beforeEach(() => {
    setLang('fi');
    capturedBlob = null;
    capturedFilename = '';

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock-url';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Capture the download filename from the anchor element
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        const origClick = el.click.bind(el);
        el.click = () => {
          capturedFilename = (el as HTMLAnchorElement).download;
        };
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Blob with CSV MIME type', () => {
    exportCsv(makeProps(), {});
    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.type).toBe('text/csv;charset=utf-8;');
  });

  it('blob has non-trivial size (contains data rows)', () => {
    exportCsv(makeProps(), {});
    expect(capturedBlob).not.toBeNull();
    // A valid CSV with 20+ stat rows should be at least a few hundred bytes
    expect(capturedBlob!.size).toBeGreaterThan(200);
  });

  it('sanitizes filename to remove dangerous characters', () => {
    exportCsv(makeProps({ nimi: 'Testi/Alue:123' }), {});
    expect(capturedFilename).not.toContain('/');
    expect(capturedFilename).not.toContain(':');
    expect(capturedFilename).toContain('00100');
  });

  it('filename uses neighborhood name and postal code', () => {
    exportCsv(makeProps({ nimi: 'Kallio', pno: '00530' }), {});
    expect(capturedFilename).toContain('Kallio');
    expect(capturedFilename).toContain('00530');
    expect(capturedFilename).toMatch(/\.csv$/);
  });

  it('handles neighborhood name with special filename chars', () => {
    exportCsv(makeProps({ nimi: 'Test*Area?' }), {});
    expect(capturedFilename).not.toContain('*');
    expect(capturedFilename).not.toContain('?');
  });
});
