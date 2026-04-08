/**
 * Deep tests for useSelectedNeighborhood hook — pinning limits, dedup, and refresh.
 *
 * The pinning system controls the comparison panel. Bugs here show stale data,
 * allow > 3 pins (breaking layout), or lose selections on quality index recomputation.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectedNeighborhood } from '../hooks/useSelectedNeighborhood';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeProps(pno: string, extra?: Partial<NeighborhoodProperties>): NeighborhoodProperties {
  return {
    pno,
    nimi: `Area ${pno}`,
    namn: `Area ${pno}`,
    kunta: '091',
    city: 'helsinki_metro',
    he_vakiy: 1000,
    he_kika: 35,
    ko_ika18y: 800,
    ko_yl_kork: 200,
    ko_al_kork: 100,
    ko_ammat: 200,
    ko_perus: 100,
    hr_mtu: 30000,
    hr_ktu: 35000,
    pt_tyoll: 500,
    pt_tyott: 50,
    pt_opisk: 100,
    pt_vakiy: 800,
    pt_elakel: 100,
    ra_asunn: 500,
    ra_as_kpa: 65,
    ra_pt_as: 50,
    te_takk: 100,
    te_taly: 400,
    te_omis_as: 200,
    te_vuok_as: 150,
    pinta_ala: 500000,
    he_0_2: 30,
    he_3_6: 40,
    unemployment_rate: 6.3,
    higher_education_rate: 37.5,
    pensioner_share: 10,
    foreign_language_pct: 8,
    quality_index: 65,
    ownership_rate: 50,
    rental_rate: 37.5,
    population_density: 2000,
    child_ratio: 7,
    student_share: 12.5,
    detached_house_share: 10,
    property_price_sqm: 4000,
    transit_stop_density: 15,
    air_quality_index: 3.5,
    crime_index: 12,
    daycare_density: 2,
    school_density: 1.5,
    healthcare_density: 1,
    single_person_hh_pct: 40,
    cycling_density: 5,
    restaurant_density: 3,
    grocery_density: 2,
    sports_facility_density: 1,
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
    ...extra,
  } as NeighborhoodProperties;
}

describe('useSelectedNeighborhood', () => {
  it('starts with no selection and no pins', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    expect(result.current.selected).toBeNull();
    expect(result.current.pinned).toEqual([]);
  });

  it('selects and deselects a neighborhood', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    const props = makeProps('00100');
    act(() => result.current.select(props));
    expect(result.current.selected?.pno).toBe('00100');

    act(() => result.current.deselect());
    expect(result.current.selected).toBeNull();
  });

  it('pins up to 3 neighborhoods', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.pin(makeProps('00300')));
    expect(result.current.pinned).toHaveLength(3);
  });

  it('rejects 4th pin (MAX_PINNED = 3)', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.pin(makeProps('00300')));
    act(() => result.current.pin(makeProps('00400')));
    expect(result.current.pinned).toHaveLength(3);
    expect(result.current.pinned.map((p) => p.pno)).toEqual(['00100', '00200', '00300']);
  });

  it('does not duplicate an already-pinned neighborhood', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00100')));
    expect(result.current.pinned).toHaveLength(1);
  });

  it('unpins by PNO', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.unpin('00100'));
    expect(result.current.pinned).toHaveLength(1);
    expect(result.current.pinned[0].pno).toBe('00200');
  });

  it('unpinning a non-existent PNO is a no-op', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.unpin('99999'));
    expect(result.current.pinned).toHaveLength(1);
  });

  it('clearPinned removes all pins', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100')));
    act(() => result.current.pin(makeProps('00200')));
    act(() => result.current.clearPinned());
    expect(result.current.pinned).toEqual([]);
  });

  it('refreshPinned replaces all pinned entries with fresh data', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.pin(makeProps('00100', { quality_index: 50 })));
    act(() => result.current.pin(makeProps('00200', { quality_index: 60 })));

    // Simulate quality index recomputation
    const refreshed = [
      makeProps('00100', { quality_index: 75 }),
      makeProps('00200', { quality_index: 85 }),
    ];
    act(() => result.current.refreshPinned(refreshed));
    expect(result.current.pinned[0].quality_index).toBe(75);
    expect(result.current.pinned[1].quality_index).toBe(85);
  });

  it('select(null) clears selection', () => {
    const { result } = renderHook(() => useSelectedNeighborhood());
    act(() => result.current.select(makeProps('00100')));
    act(() => result.current.select(null));
    expect(result.current.selected).toBeNull();
  });
});
