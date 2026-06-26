import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useWizardProfile,
  defaultWizardAnswers,
  sanitizeWizardAnswers,
  isCustomWizardAnswers,
  hasSkippedQuestions,
  serializeWizardProfile,
  deserializeWizardProfile,
  wizardAnswersToQualityWeights,
  budgetForPriceLevel,
  priceLevelFromBudget,
  PRICE_TIERS,
  type WizardAnswers,
} from '../hooks/useWizardProfile';
import { getDefaultWeights } from '../utils/qualityIndex';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

// No userId is passed in these tests, so the API is never hit; mock it defensively.
vi.mock('../utils/api', () => ({
  api: {
    getPreferences: vi.fn(() => Promise.resolve({ data: null })),
    savePreferences: vi.fn(() => Promise.resolve({})),
  },
}));

const STORAGE_KEY = 'naapurustot-wizard-profile';

const sample: WizardAnswers = {
  transitImportance: 5,
  quietPreference: 'quiet',
  budgetAdvanced: false,
  budgetMin: 1500,
  budgetMax: 4200,
  sizePreference: 'large',
  tenurePreference: 'own',
  hasChildren: true,
  schoolImportance: 4,
  healthcareImportance: 2,
  foreignersPreference: 'neutral',
  skipped: {},
};

describe('useWizardProfile serialization', () => {
  it('round-trips a full profile through the URL codec', () => {
    const encoded = serializeWizardProfile(sample);
    const decoded = deserializeWizardProfile(encoded);
    expect(decoded).toEqual(sample);
  });

  it('round-trips every enum variant', () => {
    const variants: WizardAnswers[] = [
      { ...defaultWizardAnswers, quietPreference: 'lively', sizePreference: 'small', tenurePreference: 'rent', hasChildren: false },
      { ...defaultWizardAnswers, quietPreference: 'neutral', sizePreference: 'medium', tenurePreference: 'either', hasChildren: true },
    ];
    for (const v of variants) {
      expect(deserializeWizardProfile(serializeWizardProfile(v))).toEqual(v);
    }
  });

  it('produces a compact tilde-delimited form', () => {
    expect(serializeWizardProfile(sample)).toBe('5~q~1500~4200~g~o~1~4~2~0~e~0');
  });

  it('round-trips the new advanced/foreigners/skip fields', () => {
    const v: WizardAnswers = {
      ...sample,
      budgetAdvanced: true,
      foreignersPreference: 'near',
      skipped: { transit: true, budget: true, healthcare: true },
    };
    const decoded = deserializeWizardProfile(serializeWizardProfile(v));
    expect(decoded).toEqual(v);
  });

  it('round-trips every foreigners variant', () => {
    for (const pref of ['near', 'away', 'neutral'] as const) {
      const v = { ...defaultWizardAnswers, foreignersPreference: pref };
      expect(deserializeWizardProfile(serializeWizardProfile(v))).toEqual(v);
    }
  });

  it('decodes a legacy 9-field link with new fields defaulted', () => {
    const decoded = deserializeWizardProfile('5~q~1500~4200~g~o~1~4~2');
    expect(decoded).toEqual(sample); // sample's new fields are all at their defaults
  });

  it('rejects structurally invalid encodings', () => {
    expect(deserializeWizardProfile('')).toBeNull();
    expect(deserializeWizardProfile('5~q~1500~4200~g~o~1')).toBeNull(); // too few fields
    expect(deserializeWizardProfile('5~q~1500~4200~g~o~1~4~2~0~e')).toBeNull(); // 11 fields (neither 9 nor 12)
    expect(deserializeWizardProfile('5~x~1500~4200~g~o~1~4~2~0~e~0')).toBeNull(); // bad quiet code
    expect(deserializeWizardProfile('5~q~1500~4200~z~o~1~4~2~0~e~0')).toBeNull(); // bad size code
    expect(deserializeWizardProfile('5~q~1500~4200~g~o~2~4~2~0~e~0')).toBeNull(); // bad children flag
    expect(deserializeWizardProfile('5~q~abc~4200~g~o~1~4~2~0~e~0')).toBeNull(); // non-numeric budget
  });

  it('clamps out-of-range numeric fields on decode', () => {
    const decoded = deserializeWizardProfile('9~q~10~999999~g~o~1~0~7~0~e~0');
    expect(decoded).not.toBeNull();
    expect(decoded!.transitImportance).toBe(5); // clamped 1..5
    expect(decoded!.budgetMin).toBe(500); // clamped to BUDGET_MIN
    expect(decoded!.budgetMax).toBe(15000); // clamped to BUDGET_MAX
    expect(decoded!.schoolImportance).toBe(1);
    expect(decoded!.healthcareImportance).toBe(5);
  });

  it('falls back to neutral for an unknown foreigners code', () => {
    const decoded = deserializeWizardProfile('3~n~1000~6000~m~e~0~3~3~0~z~0');
    expect(decoded!.foreignersPreference).toBe('neutral');
  });
});

describe('price tier helpers', () => {
  it('maps each 1–5 level to a tier band (clamping out-of-range)', () => {
    expect(budgetForPriceLevel(1)).toEqual(PRICE_TIERS[0]);
    expect(budgetForPriceLevel(5)).toEqual(PRICE_TIERS[4]);
    expect(budgetForPriceLevel(0)).toEqual(PRICE_TIERS[0]); // clamps up to 1
    expect(budgetForPriceLevel(99)).toEqual(PRICE_TIERS[4]); // clamps down to 5
  });

  it('round-trips an exact tier band back to its level', () => {
    PRICE_TIERS.forEach((tier, i) => {
      expect(priceLevelFromBudget(tier.min, tier.max)).toBe(i + 1);
    });
  });

  it('snaps an arbitrary advanced range to the nearest tier by midpoint', () => {
    // Default 1000–6000 is exactly tier 3.
    expect(priceLevelFromBudget(1000, 6000)).toBe(3);
    // A very high band lands on the premium tier.
    expect(priceLevelFromBudget(9000, 14000)).toBe(5);
  });
});

describe('skip semantics', () => {
  it('treats a skipped question as custom (so it persists/syncs)', () => {
    expect(hasSkippedQuestions(defaultWizardAnswers)).toBe(false);
    const skippedBudget = { ...defaultWizardAnswers, skipped: { budget: true } };
    expect(hasSkippedQuestions(skippedBudget)).toBe(true);
    expect(isCustomWizardAnswers(skippedBudget)).toBe(true);
  });

  it('keeps only known keys with true values when sanitizing', () => {
    const s = sanitizeWizardAnswers({
      ...defaultWizardAnswers,
      skipped: { transit: true, bogus: true, quiet: false },
    });
    expect(s.skipped).toEqual({ transit: true });
  });

  it('does not treat the presentational budgetAdvanced toggle as custom', () => {
    expect(isCustomWizardAnswers({ ...defaultWizardAnswers, budgetAdvanced: true })).toBe(false);
  });
});

describe('sanitize / isCustom', () => {
  it('falls back to defaults for garbage input', () => {
    expect(sanitizeWizardAnswers(null)).toEqual(defaultWizardAnswers);
    expect(sanitizeWizardAnswers('nope')).toEqual(defaultWizardAnswers);
    expect(sanitizeWizardAnswers({ transitImportance: 'x' })).toEqual(defaultWizardAnswers);
  });

  it('detects custom vs default profiles', () => {
    expect(isCustomWizardAnswers(defaultWizardAnswers)).toBe(false);
    expect(isCustomWizardAnswers(sample)).toBe(true);
  });
});

describe('wizardAnswersToQualityWeights', () => {
  it('returns the documented defaults for a default profile (transit/services unchanged)', () => {
    const def = getDefaultWeights();
    const w = wizardAnswersToQualityWeights(defaultWizardAnswers);
    // transit and services use the 3/3 ratio = 1.0, so they stay at default.
    expect(w.transit).toBe(def.transit);
    expect(w.services).toBe(def.services);
  });

  it('boosts transit weight for a high transit-importance answer', () => {
    const def = getDefaultWeights();
    const w = wizardAnswersToQualityWeights({ ...defaultWizardAnswers, transitImportance: 5 });
    expect(w.transit).toBeGreaterThan(def.transit);
  });

  it('adds school/services weight when the user has children', () => {
    const def = getDefaultWeights();
    const w = wizardAnswersToQualityWeights({ ...defaultWizardAnswers, hasChildren: true, schoolImportance: 5 });
    expect(w.school_quality).toBeGreaterThan(def.school_quality ?? 0);
    expect(w.services).toBeGreaterThan(def.services);
  });

  it('raises noise weight for a quiet preference', () => {
    const def = getDefaultWeights();
    const w = wizardAnswersToQualityWeights({ ...defaultWizardAnswers, quietPreference: 'quiet' });
    expect(w.noise_pollution).toBeGreaterThan(def.noise_pollution);
  });
});

describe('useWizardProfile persistence', () => {
  beforeEach(() => localStorage.clear());

  it('starts from defaults with empty storage', () => {
    const { result } = renderHook(() => useWizardProfile());
    expect(result.current.profile).toEqual(defaultWizardAnswers);
  });

  it('persists and reloads a saved profile via localStorage', () => {
    const { result } = renderHook(() => useWizardProfile());
    act(() => result.current.setProfile(sample));
    expect(result.current.profile).toEqual(sample);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(sample);

    const reopened = renderHook(() => useWizardProfile());
    expect(reopened.result.current.profile).toEqual(sample);
  });

  it('sanitizes corrupt localStorage on load', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useWizardProfile());
    expect(result.current.profile).toEqual(defaultWizardAnswers);
  });
});
