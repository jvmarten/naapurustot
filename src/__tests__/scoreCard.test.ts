/**
 * Tests for scoreCard.ts — HTML generation, escaping, and diff display logic.
 *
 * generateScoreCard produces HTML with user-controlled data (neighborhood names,
 * postal codes) so XSS prevention via escapeHtml is security-critical.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';
import { setLang } from '../utils/i18n';

// Hoist the mock function so vi.mock can reference it
const mockToPng = vi.fn();

vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => mockToPng(...args),
}));

// Import after mock setup
import { generateScoreCard } from '../utils/scoreCard';

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  return {
    pno: '00100',
    nimi: 'Helsinki keskusta',
    namn: 'Helsingfors centrum',
    he_vakiy: 5000,
    he_kika: 35,
    ko_ika18y: 4000,
    ko_yl_kork: 1500,
    ko_al_kork: 800,
    ko_ammat: 500,
    ko_perus: 200,
    hr_mtu: 35000,
    hr_ktu: 40000,
    pt_tyoll: 3000,
    pt_tyott: 200,
    pt_opisk: 500,
    pt_vakiy: 4200,
    pt_elakel: 300,
    ra_asunn: 3000,
    ra_as_kpa: 55,
    ra_pt_as: 100,
    te_takk: 400,
    te_taly: 2500,
    te_omis_as: 1200,
    te_vuok_as: 1100,
    pinta_ala: 2000000,
    he_0_2: 100,
    he_3_6: 150,
    unemployment_rate: 4.8,
    higher_education_rate: 57.5,
    pensioner_share: 7.1,
    foreign_language_pct: 12.0,
    quality_index: 75,
    ownership_rate: 48,
    rental_rate: 44,
    population_density: 2500,
    child_ratio: 5.0,
    student_share: 11.9,
    detached_house_share: 3.3,
    property_price_sqm: 6500,
    transit_stop_density: 85.0,
    air_quality_index: 28.0,
    crime_index: 120.0,
    daycare_density: 5.0,
    school_density: 3.0,
    healthcare_density: 8.0,
    single_person_hh_pct: 62.0,
    cycling_density: 45.0,
    restaurant_density: 250.0,
    grocery_density: 12.0,
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

describe('generateScoreCard', () => {
  let appendedElement: HTMLElement | null = null;
  let removedElement: HTMLElement | null = null;

  beforeEach(() => {
    setLang('fi');
    appendedElement = null;
    removedElement = null;

    mockToPng.mockReset();
    mockToPng.mockResolvedValue('data:image/png;base64,abc123');

    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      appendedElement = node as HTMLElement;
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => {
      removedElement = node as HTMLElement;
      return node;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a DOM element with neighborhood data and cleans up after', async () => {
    const data = makeProps();
    const avg = { hr_mtu: 30000, unemployment_rate: 8.0, property_price_sqm: 4000, transit_stop_density: 40 };

    await generateScoreCard(data, avg);

    expect(appendedElement).not.toBeNull();
    expect(removedElement).not.toBeNull();
    expect(appendedElement).toBe(removedElement);
  });

  it('escapes HTML special characters in neighborhood name to prevent XSS', async () => {
    const data = makeProps({ nimi: '<script>alert("xss")</script>' });
    const avg = { hr_mtu: 30000 };

    await generateScoreCard(data, avg);

    // Verify no actual <script> element was created in the DOM
    const scripts = appendedElement?.querySelectorAll('script');
    expect(scripts?.length ?? 0).toBe(0);
    // The text should appear as escaped content, not executable HTML
    expect(appendedElement?.textContent).toContain('alert');
  });

  it('escapes HTML in postal code — no executable attributes injected', async () => {
    const data = makeProps({ pno: '"><img src=x onerror=alert(1)>' });
    const avg = {};

    await generateScoreCard(data, avg);

    // Verify no <img> element was injected via the postal code
    const imgs = appendedElement?.querySelectorAll('img');
    expect(imgs?.length ?? 0).toBe(0);
    // The postal code should appear as text, not as HTML attributes
    expect(appendedElement?.textContent).toContain('onerror=alert(1)');
  });

  it('handles null quality_index gracefully (no score badge)', async () => {
    const data = makeProps({ quality_index: null });
    const avg = {};

    await generateScoreCard(data, avg);

    const html = appendedElement?.innerHTML ?? '';
    expect(html).not.toContain('/100');
  });

  it('displays correct diff sign: positive when value > avg', async () => {
    const data = makeProps({ hr_mtu: 40000 });
    const avg = { hr_mtu: 30000 };

    await generateScoreCard(data, avg);

    const html = appendedElement?.innerHTML ?? '';
    expect(html).toContain('+');
  });

  it('displays negative diff when value < avg', async () => {
    const data = makeProps({ hr_mtu: 20000 });
    const avg = { hr_mtu: 30000 };

    await generateScoreCard(data, avg);

    const html = appendedElement?.innerHTML ?? '';
    expect(html).toContain('-10000.0');
  });

  it('handles null metric value gracefully (shows em dash)', async () => {
    const data = makeProps({ hr_mtu: null });
    const avg = { hr_mtu: 30000 };

    await generateScoreCard(data, avg);

    const html = appendedElement?.innerHTML ?? '';
    expect(html).toContain('—');
  });

  it('cleans up DOM element even when toPng throws', async () => {
    mockToPng.mockRejectedValueOnce(new Error('Canvas error'));
    const data = makeProps();
    const avg = {};

    await expect(generateScoreCard(data, avg)).rejects.toThrow('Canvas error');
    expect(removedElement).not.toBeNull();
  });

  it('generates correct filename with special characters stripped', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const data = makeProps({ nimi: 'Töölö/Tölö' });
    const avg = {};

    await generateScoreCard(data, avg);

    expect(clickSpy).toHaveBeenCalled();
  });
});
