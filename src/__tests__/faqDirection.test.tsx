/**
 * M3: the profile-page FAQ / FAQPage structured data must be DIRECTION-AWARE.
 *
 * `topPercentileFromRank` returns a favourable-end percentile in [1, 100], and the
 * old templates poured it into "ranks in the top X%" unconditionally — so the
 * worst-crime area in Finland answered "How safe is X? — X ranks in the top 100%
 * nationally for safety", flattering the bottom decile in Google-quoted FAQPage
 * markup. These tests pin that a >50 standing now renders the honest "bottom/
 * weakest Y%" instead, in all three locales, while a genuine top standing is kept.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { JsonLd } from '../components/profile/JsonLd';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { NeighbourhoodPercentiles, MetricPercentile } from '../utils/percentileRanks';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

const NONE: MetricPercentile = { national: null, regional: null, nationalTop: null, regionalTop: null };

/** A percentiles bundle where every metric is absent except the ones overridden. */
function bundle(overrides: Partial<NeighbourhoodPercentiles>): NeighbourhoodPercentiles {
  return {
    quality: NONE, income: NONE, transit: NONE, crime: NONE,
    air: NONE, treeCanopy: NONE, education: NONE, employment: NONE,
    ...overrides,
  };
}

function makeProps(overrides: Partial<NeighborhoodProperties> = {}): NeighborhoodProperties {
  // Only the fields JsonLd reads matter; the rest satisfy the type as null.
  return {
    pno: '00100', nimi: 'Testialue', namn: 'Testområde', kunta: '091',
    city: 'helsinki_metro', he_vakiy: 5000, quality_index: 40,
    he_kika: null, ko_ika18y: null, ko_yl_kork: null, ko_al_kork: null, ko_ammat: null,
    ko_perus: null, hr_mtu: null, hr_ktu: null, pt_tyoll: null, pt_tyott: null,
    pt_opisk: null, pt_vakiy: null, pt_elakel: null, ra_asunn: null, ra_as_kpa: null,
    ra_pt_as: null, te_takk: null, te_taly: null, te_omis_as: null, te_vuok_as: null,
    pinta_ala: null, he_0_2: null, he_3_6: null, unemployment_rate: null,
    higher_education_rate: null, pensioner_share: null, foreign_language_pct: null,
    ownership_rate: null, rental_rate: null, population_density: null, child_ratio: null,
    student_share: null, detached_house_share: null, property_price_sqm: null,
    transit_stop_density: null, air_quality_index: null, crime_index: null,
    radon: null, health_index: null, flood_risk_pct: null,
    daycare_density: null, school_density: null, healthcare_density: null,
    single_person_hh_pct: null, cycling_density: null, restaurant_density: null,
    grocery_density: null, sports_facility_density: null, income_history: null,
    population_history: null, unemployment_history: null, income_change_pct: null,
    property_price_history: null, crime_index_history: null, crime_index_change_pct: null,
    population_change_pct: null, unemployment_change_pct: null, voter_turnout_pct: null,
    party_diversity_index: null, political_lean_index: null,
    party_vote_kok_pct: null, party_vote_sdp_pct: null, party_vote_ps_pct: null,
    party_vote_kesk_pct: null, party_vote_vihr_pct: null, party_vote_vas_pct: null,
    party_vote_rkp_pct: null,
    broadband_coverage_pct: null, ev_charging_density: null,
    tree_canopy_pct: null, transit_reachability_score: null, youth_ratio_pct: null,
    gender_ratio: null, single_parent_hh_pct: null, families_with_children_pct: null,
    tech_sector_pct: null, healthcare_workers_pct: null, employment_rate: null,
    elderly_ratio_pct: null, avg_household_size: null, manufacturing_jobs_pct: null,
    public_sector_jobs_pct: null, service_sector_jobs_pct: null, new_construction_pct: null,
    he_naiset: null, he_miehet: null, he_18_19: null, he_20_24: null, he_25_29: null,
    he_65_69: null, he_70_74: null, he_75_79: null, he_80_84: null, he_85_: null,
    te_eil_np: null, te_laps: null, tp_tyopy: null, tp_j_info: null, tp_q_terv: null,
    tp_jalo_bf: null, tp_o_julk: null, tp_palv_gu: null, ra_raky: null,
    rental_price_sqm: null, price_to_rent_ratio: null, walkability_index: null,
    traffic_accident_rate: null, property_price_change_pct: null, school_quality_score: null,
    light_pollution: null, noise_pollution: null, water_proximity_m: null,
    avg_construction_year: null,
    ...overrides,
  };
}

function faqText(container: HTMLElement): string {
  const scripts = container.querySelectorAll('script[type="application/ld+json"]');
  // Un-escape the < hardening so we read plain prose.
  return Array.from(scripts)
    .map((s) => JSON.parse(s.innerHTML))
    .flatMap((node) => (node['@type'] === 'FAQPage' ? node.mainEntity : []))
    .flatMap((q: { acceptedAnswer?: { text?: string } }) => q.acceptedAnswer?.text ?? [])
    .join('\n');
}

describe('JsonLd FAQ — M3 direction-aware standing', () => {
  it('renders a bottom-decile safety standing as "bottom X%", never "top 100%" (en)', () => {
    // crime nationalTop = 100 → worst end. Old copy: "top 100% for safety".
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/en/area/00100-test"
        lang="en"
        percentiles={bundle({ crime: { national: 100, regional: null, nationalTop: 100, regionalTop: null } })}
      />,
    );
    const text = faqText(container);
    expect(text).toContain('the bottom 1% nationally for safety');
    expect(text).not.toMatch(/top \d+% nationally for safety/);
  });

  it('keeps a genuine top standing as "top X%" (en)', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/en/area/00100-test"
        lang="en"
        percentiles={bundle({ quality: { national: 95, regional: null, nationalTop: 5, regionalTop: null } })}
      />,
    );
    const text = faqText(container);
    expect(text).toContain('the top 5% nationally for quality of life');
    expect(text).not.toContain('bottom');
  });

  it('flips the Finnish superlative to "heikoimpaan" for a weak standing', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/alue/00100-test"
        lang="fi"
        percentiles={bundle({ air: { national: 100, regional: null, nationalTop: 96, regionalTop: null } })}
      />,
    );
    const text = faqText(container);
    expect(text).toContain('koko maan heikoimpaan 4 %:iin'); // 100 - 96 = 4
    expect(text).not.toContain('parhaaseen 96');
  });

  it('flips the Swedish superlative to "de sämsta" for a weak standing', () => {
    const { container } = render(
      <JsonLd
        properties={makeProps()}
        center={[24.94, 60.17]}
        url="https://naapurustot.fi/sv/omrade/00100-test"
        lang="sv"
        percentiles={bundle({ treeCanopy: { national: 2, regional: null, nationalTop: 98, regionalTop: null } })}
      />,
    );
    const text = faqText(container);
    expect(text).toContain('de sämsta 2 % i landet'); // 100 - 98 = 2
    expect(text).not.toContain('de bästa 98');
  });
});
