import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQualityWeights } from '../hooks/useQualityWeights';
import { useWizardProfile, defaultWizardAnswers } from '../hooks/useWizardProfile';
import { useSimilarityMetrics } from '../hooks/useSimilarityMetrics';
import { getDefaultWeights } from '../utils/qualityIndex';
import { SIMILARITY_METRIC_KEYS } from '../utils/similarity';

/**
 * CF-6 part 2: shared-link analytical state (quality weights, wizard profile,
 * similarity weights) is applied for the session only — never written to the
 * recipient's localStorage (or pushed to their account) until they edit it.
 */
describe('CF-6 shared-link seeds are session-only', () => {
  beforeEach(() => localStorage.clear());

  it('seedWeights does not persist, setWeights does', () => {
    const QKEY = 'naapurustot-quality-weights';
    const { result } = renderHook(() => useQualityWeights(null));

    act(() => result.current.seedWeights({ ...getDefaultWeights(), transit: 50 }));
    // In memory the seed is live…
    expect(result.current.weights.transit).toBe(50);
    // …but localStorage must NOT reflect it (still the default written on mount).
    expect(JSON.parse(localStorage.getItem(QKEY)!).transit).not.toBe(50);

    act(() => result.current.setWeights({ ...getDefaultWeights(), transit: 77 }));
    expect(JSON.parse(localStorage.getItem(QKEY)!).transit).toBe(77);
  });

  it('seedProfile does not persist, setProfile does', () => {
    const WKEY = 'naapurustot-wizard-profile';
    const { result } = renderHook(() => useWizardProfile(null));

    act(() => result.current.seedProfile({ ...defaultWizardAnswers, transitImportance: 5, hasChildren: true }));
    expect(result.current.profile.transitImportance).toBe(5);
    const afterSeed = localStorage.getItem(WKEY);
    expect(afterSeed && JSON.parse(afterSeed).transitImportance).not.toBe(5);

    act(() => result.current.setProfile({ ...defaultWizardAnswers, transitImportance: 1 }));
    expect(JSON.parse(localStorage.getItem(WKEY)!).transitImportance).toBe(1);
  });

  it('similarity URL seed is not persisted until a weight is edited', () => {
    const SKEY = 'naapurustot-similarity-weights';
    const aKey = [...SIMILARITY_METRIC_KEYS][0];
    const { result } = renderHook(() => useSimilarityMetrics({ [aKey]: 0 }));

    // Seed is live in memory but not written to localStorage.
    expect(result.current.weights[aKey]).toBe(0);
    expect(localStorage.getItem(SKEY)).toBeNull();

    // An explicit edit persists.
    const other = [...SIMILARITY_METRIC_KEYS][1];
    act(() => result.current.setWeight(other, 3));
    expect(localStorage.getItem(SKEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(SKEY)!)[other]).toBe(3);
  });
});
