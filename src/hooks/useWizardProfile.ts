import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { runSync } from '../utils/syncStatus';
import { editedAt, markEdited } from '../utils/syncMeta';
import { getDefaultWeights, type QualityWeights } from '../utils/qualityIndex';

/**
 * CF-4: the answers the Neighborhood Finder wizard collects. A persistent,
 * shareable "priority profile" — saved to localStorage (and cloud-synced when
 * signed in), reopened pre-filled, and serializable into a compact share URL.
 */
export interface WizardAnswers {
  transitImportance: number;
  quietPreference: 'quiet' | 'lively' | 'neutral';
  budgetMin: number;
  budgetMax: number;
  sizePreference: 'small' | 'medium' | 'large';
  tenurePreference: 'own' | 'rent' | 'either';
  hasChildren: boolean;
  schoolImportance: number;
  healthcareImportance: number;
}

/** Baseline answers: the per-field fallback for sanitizeWizardAnswers, and the
 *  reference isCustomWizardAnswers compares against to gate sync/URL emission. */
export const defaultWizardAnswers: WizardAnswers = {
  transitImportance: 3,
  quietPreference: 'neutral',
  budgetMin: 1000,
  budgetMax: 6000,
  sizePreference: 'medium',
  tenurePreference: 'either',
  hasChildren: false,
  schoolImportance: 3,
  healthcareImportance: 3,
};

const STORAGE_KEY = 'naapurustot-wizard-profile';

// Budget bounds match the wizard's housing-step number inputs (500–15000 €/m²).
const BUDGET_MIN = 500;
const BUDGET_MAX = 15000;

const QUIET_VALUES = new Set<WizardAnswers['quietPreference']>(['quiet', 'lively', 'neutral']);
const SIZE_VALUES = new Set<WizardAnswers['sizePreference']>(['small', 'medium', 'large']);
const TENURE_VALUES = new Set<WizardAnswers['tenurePreference']>(['own', 'rent', 'either']);

function clampImportance(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function clampBudget(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.round(n)));
}

/** Coerce arbitrary input into a valid WizardAnswers, filling defaults for bad fields. */
export function sanitizeWizardAnswers(v: unknown): WizardAnswers {
  const d = defaultWizardAnswers;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...d };
  const r = v as Record<string, unknown>;
  return {
    transitImportance: clampImportance(r.transitImportance),
    quietPreference: QUIET_VALUES.has(r.quietPreference as WizardAnswers['quietPreference'])
      ? (r.quietPreference as WizardAnswers['quietPreference'])
      : d.quietPreference,
    budgetMin: clampBudget(r.budgetMin, d.budgetMin),
    budgetMax: clampBudget(r.budgetMax, d.budgetMax),
    sizePreference: SIZE_VALUES.has(r.sizePreference as WizardAnswers['sizePreference'])
      ? (r.sizePreference as WizardAnswers['sizePreference'])
      : d.sizePreference,
    tenurePreference: TENURE_VALUES.has(r.tenurePreference as WizardAnswers['tenurePreference'])
      ? (r.tenurePreference as WizardAnswers['tenurePreference'])
      : d.tenurePreference,
    hasChildren: typeof r.hasChildren === 'boolean' ? r.hasChildren : d.hasChildren,
    schoolImportance: clampImportance(r.schoolImportance),
    healthcareImportance: clampImportance(r.healthcareImportance),
  };
}

/** True when answers differ from the documented defaults (so an empty profile isn't synced). */
export function isCustomWizardAnswers(a: WizardAnswers): boolean {
  const d = defaultWizardAnswers;
  return (
    a.transitImportance !== d.transitImportance ||
    a.quietPreference !== d.quietPreference ||
    a.budgetMin !== d.budgetMin ||
    a.budgetMax !== d.budgetMax ||
    a.sizePreference !== d.sizePreference ||
    a.tenurePreference !== d.tenurePreference ||
    a.hasChildren !== d.hasChildren ||
    a.schoolImportance !== d.schoolImportance ||
    a.healthcareImportance !== d.healthcareImportance
  );
}

// ─── CF-4: compact share-URL codec ──────────────────────────────────────────
// Encoded as a fixed-order, `~`-delimited tuple (single-letter enum codes) so a
// full profile stays short, e.g. `wp=3~n~1000~6000~m~e~0~3~3`. Field order:
//   transit ~ quiet ~ budgetMin ~ budgetMax ~ size ~ tenure ~ children ~ school ~ healthcare
const QUIET_CODE: Record<WizardAnswers['quietPreference'], string> = { quiet: 'q', neutral: 'n', lively: 'l' };
const QUIET_DECODE: Record<string, WizardAnswers['quietPreference']> = { q: 'quiet', n: 'neutral', l: 'lively' };
const SIZE_CODE: Record<WizardAnswers['sizePreference'], string> = { small: 's', medium: 'm', large: 'g' };
const SIZE_DECODE: Record<string, WizardAnswers['sizePreference']> = { s: 'small', m: 'medium', g: 'large' };
const TENURE_CODE: Record<WizardAnswers['tenurePreference'], string> = { own: 'o', rent: 'r', either: 'e' };
const TENURE_DECODE: Record<string, WizardAnswers['tenurePreference']> = { o: 'own', r: 'rent', e: 'either' };

/** Encode answers as the fixed-order `~`-tuple for the `wp` URL param (see codec
 *  note above), clamping out-of-range numeric fields on the way out. */
export function serializeWizardProfile(a: WizardAnswers): string {
  return [
    clampImportance(a.transitImportance),
    QUIET_CODE[a.quietPreference] ?? 'n',
    clampBudget(a.budgetMin, defaultWizardAnswers.budgetMin),
    clampBudget(a.budgetMax, defaultWizardAnswers.budgetMax),
    SIZE_CODE[a.sizePreference] ?? 'm',
    TENURE_CODE[a.tenurePreference] ?? 'e',
    a.hasChildren ? 1 : 0,
    clampImportance(a.schoolImportance),
    clampImportance(a.healthcareImportance),
  ].join('~');
}

/** Parse a `wp=` tuple back into answers, or null when it is structurally invalid. */
export function deserializeWizardProfile(s: string): WizardAnswers | null {
  const parts = s.split('~');
  if (parts.length !== 9) return null;
  const [t, q, bMin, bMax, size, tenure, kids, school, health] = parts;
  const quiet = QUIET_DECODE[q];
  const sizePref = SIZE_DECODE[size];
  const tenurePref = TENURE_DECODE[tenure];
  if (!quiet || !sizePref || !tenurePref) return null;
  if (kids !== '0' && kids !== '1') return null;
  const budgetMin = Number(bMin);
  const budgetMax = Number(bMax);
  if (!Number.isFinite(budgetMin) || !Number.isFinite(budgetMax)) return null;
  return sanitizeWizardAnswers({
    transitImportance: Number(t),
    quietPreference: quiet,
    budgetMin,
    budgetMax,
    sizePreference: sizePref,
    tenurePreference: tenurePref,
    hasChildren: kids === '1',
    schoolImportance: Number(school),
    healthcareImportance: Number(health),
  });
}

// ─── CF-4: map a priority profile onto Quality Index weights ─────────────────
// So the live map score can reflect stated priorities continuously, not just the
// one-shot results list. We start from the documented defaults and nudge the
// factors the wizard actually asks about, keyed off each answer's strength.

/**
 * Translate wizard answers into a full QualityWeights map. Lifestyle (transit,
 * quiet), family (children, schools) and the budget tenure/healthcare answers are
 * mapped onto the corresponding quality factors so the headline index tracks the
 * user's stated priorities. Returns a fresh map every call.
 */
export function wizardAnswersToQualityWeights(a: WizardAnswers): QualityWeights {
  const w = getDefaultWeights();

  // Transit importance (1–5) scales the transit factor around its default (3): a
  // top answer roughly doubles it, the lowest answer nearly mutes it.
  w.transit = Math.round((w.transit ?? 3) * (a.transitImportance / 3));

  // Quiet vs lively maps onto noise (lower noise = quieter) and restaurant density.
  if (a.quietPreference === 'quiet') {
    w.noise_pollution = (w.noise_pollution ?? 0) + 8;
    w.tree_canopy = (w.tree_canopy ?? 0) + 4;
  } else if (a.quietPreference === 'lively') {
    w.restaurants = (w.restaurants ?? 0) + 10;
    w.transit = (w.transit ?? 0) + 4;
  }

  // Healthcare importance (1–5) lifts the services factor (healthcare is part of it).
  w.services = Math.round((w.services ?? 3) * (a.healthcareImportance / 3));

  // Children: weight schools and services; school importance scales school_quality.
  if (a.hasChildren) {
    w.school_quality = (w.school_quality ?? 0) + a.schoolImportance * 3;
    w.services = (w.services ?? 0) + 6;
    w.safety = (w.safety ?? 0) + 4;
  }

  // Tenure preference is descriptive (no objective "better" direction), so it is
  // intentionally NOT mapped onto a weight — surfacing it as a score would be
  // misleading. Budget is applied as a filter in the results list, not a weight.

  return w;
}

function loadProfile(): WizardAnswers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return sanitizeWizardAnswers(parsed);
    }
  } catch { /* localStorage unavailable or malformed data */ }
  return { ...defaultWizardAnswers };
}

function saveProfile(a: WizardAnswers): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); } catch { /* unavailable */ }
}

/**
 * CF-4: manage the persistent, cloud-synced wizard priority profile.
 * Persists to localStorage always; syncs to the server when `userId` is provided
 * (logged in). Mirrors useQualityWeights/useFilterPresets exactly.
 */
export function useWizardProfile(userId?: string | null) {
  const [profile, setProfileState] = useState<WizardAnswers>(loadProfile);
  const profileRef = useRef(profile);
  const fromServerRef = useRef(false);
  // CF-6: true while the profile is a transient seed from a shared link — used for
  // this session but never persisted or pushed to the account until the recipient
  // edits it. Cleared on a real edit or when the user's own server profile is adopted.
  const seededRef = useRef(false);

  // Cross-tab sync — adopt a profile changed in another tab, suppressing the
  // server-save echo via fromServerRef.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      fromServerRef.current = true;
      setProfileState(loadProfile());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IN-6: set on the userId null→id login transition, cleared once the on-login merge
  // resolves; while set the debounced save is skipped so local never pre-empts the merge.
  const loginMergePendingRef = useRef(false);

  useEffect(() => {
    profileRef.current = profile;
    // CF-6: a shared-link seed is held in memory only — not written until the user edits.
    if (!seededRef.current) saveProfile(profile);
  }, [profile]);

  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Debounced server save
  useEffect(() => {
    // IN-6: on the null→id login transition, defer saving until the on-login merge
    // (below) picks the winner (prevUserIdRef still holds the previous userId here —
    // the effect that updates it runs later in the same commit).
    if (userId && userId !== prevUserIdRef.current) loginMergePendingRef.current = true;

    if (!userId || fromServerRef.current) {
      fromServerRef.current = false;
      return;
    }
    // CF-6: never push a shared-link seed to the account.
    if (seededRef.current) return;
    if (loginMergePendingRef.current) return;
    // IN-3: never sync an untouched default profile — it would write an empty blob
    // for every signed-in user who never opened the wizard (the line-24 gate). Since
    // this also gates the timer, the unmount flush below (guarded on saveTimerRef)
    // won't fire for defaults either.
    if (!isCustomWizardAnswers(profile)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      runSync('wizardProfile', () => api.savePreferences({ wizardProfile: profileRef.current }));
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [profile, userId]);

  // Flush pending save on unmount to prevent data loss
  useEffect(() => () => {
    if (saveTimerRef.current && userIdRef.current) {
      clearTimeout(saveTimerRef.current);
      api.savePreferences({ wizardProfile: profileRef.current });
    }
  }, []);

  // On login: fetch server profile — if local is default and server has a custom
  // profile, adopt the server copy; if local is custom and server is empty, push up.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (!userId || (prev !== undefined && prev === userId)) return;

    let cancelled = false;
    api.getPreferences().then(({ data }) => {
      if (cancelled || !data) return;
      const serverProfile = data.wizardProfile;
      if (!serverProfile || typeof serverProfile !== 'object') {
        // CF-6: don't push a shared-link seed up when the account has no profile.
        if (!seededRef.current && isCustomWizardAnswers(profileRef.current)) {
          api.savePreferences({ wizardProfile: profileRef.current });
        }
        return;
      }
      const server = sanitizeWizardAnswers(serverProfile);
      const serverCustom = isCustomWizardAnswers(server);
      // CF-6: a seed isn't local customisation — the user's own server profile wins.
      const localCustom = !seededRef.current && isCustomWizardAnswers(profileRef.current);
      const adoptServer = () => {
        seededRef.current = false; // adopted profile is owned and must persist
        fromServerRef.current = true;
        setProfileState(server);
      };
      if (serverCustom && !localCustom) {
        adoptServer();
      } else if (localCustom && !serverCustom) {
        api.savePreferences({ wizardProfile: profileRef.current });
      } else if (serverCustom && localCustom) {
        // IN-6: both sides diverged — last write wins, comparing the server row's
        // timestamp against this device's last local edit of the profile. No
        // reliable server timestamp → leave local as-is (prior rule).
        const serverMs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
        if (Number.isFinite(serverMs)) {
          if (editedAt('wizardProfile') > serverMs) {
            api.savePreferences({ wizardProfile: profileRef.current });
          } else {
            adoptServer();
          }
        }
      }
      // Both default: leave local as-is.
    }).finally(() => { loginMergePendingRef.current = false; });
    return () => { cancelled = true; loginMergePendingRef.current = false; };
  }, [userId]);

  const setProfile = useCallback((next: WizardAnswers) => {
    seededRef.current = false; // an explicit edit makes the profile owned + persisted
    markEdited('wizardProfile'); // IN-6: record local edit time for LWW conflict merges
    setProfileState(sanitizeWizardAnswers(next));
  }, []);

  // CF-6: apply a profile from a shared link for this session only (no persistence
  // until the user edits it via setProfile).
  const seedProfile = useCallback((next: WizardAnswers) => {
    seededRef.current = true;
    setProfileState(sanitizeWizardAnswers(next));
  }, []);

  return { profile, setProfile, seedProfile };
}
