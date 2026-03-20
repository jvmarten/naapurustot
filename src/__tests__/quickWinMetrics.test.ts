import { describe, it, expect, vi } from 'vitest';
import { computeQuickWinMetrics } from '../utils/metrics';
import type { Feature } from 'geojson';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', ...props },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('computeQuickWinMetrics', () => {
  describe('youth_ratio_pct', () => {
    it('computes youth ratio from 18-29 age groups', () => {
      const f = makeFeature({
        he_vakiy: 1000,
        he_18_19: 50,
        he_20_24: 100,
        he_25_29: 150,
      });
      computeQuickWinMetrics([f]);
      // (50 + 100 + 150) / 1000 * 100 = 30.0%
      expect(f.properties!.youth_ratio_pct).toBe(30.0);
    });

    it('skips when population is null', () => {
      const f = makeFeature({
        he_vakiy: null,
        he_18_19: 50,
        he_20_24: 100,
        he_25_29: 150,
      });
      computeQuickWinMetrics([f]);
      expect(f.properties!.youth_ratio_pct).toBeUndefined();
    });

    it('skips when any age group is null', () => {
      const f = makeFeature({
        he_vakiy: 1000,
        he_18_19: 50,
        he_20_24: null,
        he_25_29: 150,
      });
      computeQuickWinMetrics([f]);
      expect(f.properties!.youth_ratio_pct).toBeUndefined();
    });
  });

  describe('gender_ratio', () => {
    it('computes women/men ratio', () => {
      const f = makeFeature({
        he_naiset: 520,
        he_miehet: 480,
      });
      computeQuickWinMetrics([f]);
      // 520 / 480 ≈ 1.08
      expect(f.properties!.gender_ratio).toBe(1.08);
    });

    it('skips when men count is zero (division guard)', () => {
      const f = makeFeature({
        he_naiset: 520,
        he_miehet: 0,
      });
      computeQuickWinMetrics([f]);
      expect(f.properties!.gender_ratio).toBeUndefined();
    });
  });

  describe('single_parent_hh_pct', () => {
    it('computes single-parent household percentage', () => {
      const f = makeFeature({
        te_eil_np: 100,
        te_taly: 500,
      });
      computeQuickWinMetrics([f]);
      // 100 / 500 * 100 = 20.0%
      expect(f.properties!.single_parent_hh_pct).toBe(20.0);
    });
  });

  describe('families_with_children_pct', () => {
    it('computes families with children percentage', () => {
      const f = makeFeature({
        te_laps: 200,
        te_taly: 500,
      });
      computeQuickWinMetrics([f]);
      // 200 / 500 * 100 = 40.0%
      expect(f.properties!.families_with_children_pct).toBe(40.0);
    });
  });

  describe('tech_sector_pct', () => {
    it('computes tech sector job percentage', () => {
      const f = makeFeature({
        tp_jk_info: 30,
        tp_tyopy: 300,
      });
      computeQuickWinMetrics([f]);
      // 30 / 300 * 100 = 10.0%
      expect(f.properties!.tech_sector_pct).toBe(10.0);
    });

    it('skips when total jobs is zero', () => {
      const f = makeFeature({
        tp_jk_info: 30,
        tp_tyopy: 0,
      });
      computeQuickWinMetrics([f]);
      expect(f.properties!.tech_sector_pct).toBeUndefined();
    });
  });

  describe('healthcare_workers_pct', () => {
    it('computes healthcare worker percentage', () => {
      const f = makeFeature({
        tp_qr_terv: 50,
        tp_tyopy: 500,
      });
      computeQuickWinMetrics([f]);
      // 50 / 500 * 100 = 10.0%
      expect(f.properties!.healthcare_workers_pct).toBe(10.0);
    });
  });

  describe('employment_rate', () => {
    it('computes employment rate from employed / working-age pop', () => {
      const f = makeFeature({
        pt_tyoll: 400,
        pt_vakiy: 500,
      });
      computeQuickWinMetrics([f]);
      // 400 / 500 * 100 = 80.0%
      expect(f.properties!.employment_rate).toBe(80.0);
    });
  });

  describe('elderly_ratio_pct', () => {
    it('computes elderly ratio from 65+ age groups', () => {
      const f = makeFeature({
        he_vakiy: 1000,
        he_65_69: 40,
        he_70_74: 30,
        he_75_79: 20,
        he_80_84: 15,
        he_85_: 10,
      });
      computeQuickWinMetrics([f]);
      // (40 + 30 + 20 + 15 + 10) / 1000 * 100 = 11.5%
      expect(f.properties!.elderly_ratio_pct).toBe(11.5);
    });

    it('skips when any elderly age group is null', () => {
      const f = makeFeature({
        he_vakiy: 1000,
        he_65_69: 40,
        he_70_74: null,
        he_75_79: 20,
        he_80_84: 15,
        he_85_: 10,
      });
      computeQuickWinMetrics([f]);
      expect(f.properties!.elderly_ratio_pct).toBeUndefined();
    });
  });

  describe('avg_household_size', () => {
    it('computes average household size', () => {
      const f = makeFeature({
        he_vakiy: 2000,
        te_taly: 1000,
      });
      computeQuickWinMetrics([f]);
      // 2000 / 1000 = 2.00
      expect(f.properties!.avg_household_size).toBe(2.0);
    });
  });

  describe('job sector percentages', () => {
    it('computes manufacturing jobs pct', () => {
      const f = makeFeature({ tp_jalo_bf: 50, tp_tyopy: 500 });
      computeQuickWinMetrics([f]);
      expect(f.properties!.manufacturing_jobs_pct).toBe(10.0);
    });

    it('computes public sector jobs pct', () => {
      const f = makeFeature({ tp_o_julk: 75, tp_tyopy: 500 });
      computeQuickWinMetrics([f]);
      expect(f.properties!.public_sector_jobs_pct).toBe(15.0);
    });

    it('computes service sector jobs pct', () => {
      const f = makeFeature({ tp_palv_gu: 350, tp_tyopy: 500 });
      computeQuickWinMetrics([f]);
      expect(f.properties!.service_sector_jobs_pct).toBe(70.0);
    });
  });

  describe('new_construction_pct', () => {
    it('computes new construction percentage', () => {
      const f = makeFeature({ ra_raky: 10, ra_asunn: 200 });
      computeQuickWinMetrics([f]);
      // 10 / 200 * 100 = 5.0%
      expect(f.properties!.new_construction_pct).toBe(5.0);
    });
  });

  describe('rounding', () => {
    it('rounds youth_ratio_pct to 1 decimal place', () => {
      const f = makeFeature({
        he_vakiy: 3000,
        he_18_19: 100,
        he_20_24: 200,
        he_25_29: 333,
      });
      computeQuickWinMetrics([f]);
      // (633 / 3000) * 100 = 21.1%
      expect(f.properties!.youth_ratio_pct).toBe(21.1);
    });

    it('rounds gender_ratio to 2 decimal places', () => {
      const f = makeFeature({
        he_naiset: 1000,
        he_miehet: 3000,
      });
      computeQuickWinMetrics([f]);
      // 1000 / 3000 = 0.33
      expect(f.properties!.gender_ratio).toBe(0.33);
    });
  });

  it('processes multiple features independently', () => {
    const f1 = makeFeature({
      pno: '00100',
      he_vakiy: 1000,
      he_18_19: 100,
      he_20_24: 100,
      he_25_29: 100,
    });
    const f2 = makeFeature({
      pno: '00200',
      he_vakiy: 2000,
      he_18_19: 50,
      he_20_24: 50,
      he_25_29: 50,
    });
    computeQuickWinMetrics([f1, f2]);
    expect(f1.properties!.youth_ratio_pct).toBe(30.0);
    expect(f2.properties!.youth_ratio_pct).toBe(7.5);
  });
});
