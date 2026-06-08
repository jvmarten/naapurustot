import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useWizardProfile,
  defaultWizardAnswers,
  sanitizeWizardAnswers,
  isCustomWizardAnswers,
  serializeWizardProfile,
  deserializeWizardProfile,
  wizardAnswersToQualityWeights,
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
  budgetMin: 1500,
  budgetMax: 4200,
  sizePreference: 'large',
  tenurePreference: 'own',
  hasChildren: true,
  schoolImportance: 4,
  healthcareImportance: 2,
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
    expect(serializeWizardProfile(sample)).toBe('5~q~1500~4200~g~o~1~4~2');
  });

  it('rejects structurally invalid encodings', () => {
    expect(deserializeWizardProfile('')).toBeNull();
    expect(deserializeWizardProfile('5~q~1500~4200~g~o~1~4')).toBeNull(); // too few fields
    expect(deserializeWizardProfile('5~x~1500~4200~g~o~1~4~2')).toBeNull(); // bad quiet code
    expect(deserializeWizardProfile('5~q~1500~4200~z~o~1~4~2')).toBeNull(); // bad size code
    expect(deserializeWizardProfile('5~q~1500~4200~g~o~2~4~2')).toBeNull(); // bad children flag
    expect(deserializeWizardProfile('5~q~abc~4200~g~o~1~4~2')).toBeNull(); // non-numeric budget
  });

  it('clamps out-of-range numeric fields on decode', () => {
    const decoded = deserializeWizardProfile('9~q~10~999999~g~o~1~0~7');
    expect(decoded).not.toBeNull();
    expect(decoded!.transitImportance).toBe(5); // clamped 1..5
    expect(decoded!.budgetMin).toBe(500); // clamped to BUDGET_MIN
    expect(decoded!.budgetMax).toBe(15000); // clamped to BUDGET_MAX
    expect(decoded!.schoolImportance).toBe(1);
    expect(decoded!.healthcareImportance).toBe(5);
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
