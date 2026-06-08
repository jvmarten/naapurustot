import { useState, useCallback, useMemo } from 'react';
import type { AffordabilityMode } from '../utils/affordability';
import { AFFORDABILITY_LIMITS, inRange } from '../utils/affordability';
import type { UrlAffordability } from './useUrlState';

const STORAGE_KEY = 'naapurustot-affordability';

/** The user's affordability-calculator inputs (separate income/budget so toggling
 *  mode preserves both fields). All amounts are €/month; sizeM2 is m². */
export interface AffordabilityState {
  mode: AffordabilityMode;
  /** Monthly net income (€/month), or null when not yet entered. */
  income: number | null;
  /** Monthly housing budget (€/month), or null when not yet entered. */
  budget: number | null;
  /** Apartment size in m², or null when not yet entered. */
  sizeM2: number | null;
}

const DEFAULT_STATE: AffordabilityState = { mode: 'income', income: null, budget: null, sizeM2: null };

function clampOrNull(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return inRange(n, min, max) ? Math.round(n) : null;
}

function loadState(): AffordabilityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AffordabilityState>;
      return {
        mode: p.mode === 'budget' ? 'budget' : 'income',
        income: clampOrNull(p.income, AFFORDABILITY_LIMITS.income.min, AFFORDABILITY_LIMITS.income.max),
        budget: clampOrNull(p.budget, AFFORDABILITY_LIMITS.budget.min, AFFORDABILITY_LIMITS.budget.max),
        sizeM2: clampOrNull(p.sizeM2, AFFORDABILITY_LIMITS.size.min, AFFORDABILITY_LIMITS.size.max),
      };
    }
  } catch { /* localStorage unavailable or malformed — fall through to default */ }
  return DEFAULT_STATE;
}

function saveState(s: AffordabilityState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* unavailable */ }
}

/** Collapse the calculator state to the compact URL/serialized form, or null when
 *  the active mode has no usable amount or no size yet (nothing worth sharing). */
export function toUrlAffordability(s: AffordabilityState): UrlAffordability | null {
  const amount = s.mode === 'budget' ? s.budget : s.income;
  if (amount == null || s.sizeM2 == null) return null;
  return { mode: s.mode, amount, sizeM2: s.sizeM2 };
}

/**
 * CF-1: the affordability calculator inputs, persisted in localStorage and
 * hydratable from a shared URL. Mirrors useFilterPresets/useQualityWeights:
 * localStorage-only (no server sync), validated on read.
 */
export function useAffordability(initial?: UrlAffordability | null) {
  const [state, setState] = useState<AffordabilityState>(() => {
    const stored = loadState();
    // A shared link's inputs win over locally-stored ones on first load.
    if (initial) {
      return {
        mode: initial.mode,
        income: initial.mode === 'income' ? initial.amount : stored.income,
        budget: initial.mode === 'budget' ? initial.amount : stored.budget,
        sizeM2: initial.sizeM2,
      };
    }
    return stored;
  });

  const update = useCallback((patch: Partial<AffordabilityState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const urlValue = useMemo(() => toUrlAffordability(state), [state]);

  return { state, update, urlValue };
}
