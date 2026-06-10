import { useSyncExternalStore } from 'react';

/**
 * PO-5: a thin shared layer that turns the previously silent server-sync of
 * favorites/notes/preferences into an observable status with automatic
 * exponential-backoff retry, so a logged-in user is told when changes they
 * believe are cloud-saved actually failed — and can retry.
 *
 * Each "domain" (favorites, notes, weights, presets) tracks its own in-flight /
 * errored state; the global status the UI shows is the worst of them: `error`
 * if any domain is failing, `syncing` if any is in flight, else `idle`.
 */
export type SyncState = 'idle' | 'syncing' | 'error';

interface SaveResult {
  error?: string;
  /** HTTP status (api.* returns it). IN-3: a 4xx is terminal — see runSync. */
  status?: number;
}
type Saver = () => Promise<SaveResult>;

let state: SyncState = 'idle';
// IN-3: true once a save failed with 401 (cookie cleared / session expired). The UI
// turns this into a "log in again" prompt instead of looping a doomed retry.
let sessionExpired = false;
const subscribers = new Set<() => void>();

const inFlight = new Set<string>();
const errored = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const attempts = new Map<string, number>();
const lastSavers = new Map<string, Saver>();

// Exponential backoff (ms). The last value repeats for further attempts.
const BACKOFF_MS = [2000, 8000, 30000, 120000];

function recompute(): void {
  state = errored.size > 0 ? 'error' : inFlight.size > 0 ? 'syncing' : 'idle';
  // Always notify: sessionExpired can change while `state` stays 'error'.
  // useSyncExternalStore dedupes by snapshot value, so spurious notifies are cheap.
  for (const cb of subscribers) cb();
}

/**
 * Run a server save for `domain`, tracking status and retrying with backoff on
 * failure. `save` must resolve to an object with an optional `error` (the shape
 * `api.*` already returns); it should never reject, but a rejection is treated as
 * an error too. Re-invoking for the same domain cancels any pending retry.
 */
export function runSync(domain: string, save: Saver): void {
  lastSavers.set(domain, save);
  const pending = retryTimers.get(domain);
  if (pending) {
    clearTimeout(pending);
    retryTimers.delete(domain);
  }
  inFlight.add(domain);
  errored.delete(domain);
  recompute();

  const onFailure = (status?: number) => {
    inFlight.delete(domain);
    errored.add(domain);
    // IN-3: a 4xx is terminal — retrying the identical payload just loops (the
    // guaranteed-400 wizardProfile bug; the 401-after-logout retry storm). Mark it
    // errored but schedule NO backoff retry. A 401 means the session is gone, so
    // raise a distinct "log in again" signal the UI can act on.
    if (status !== undefined && status >= 400 && status < 500) {
      if (status === 401) sessionExpired = true;
      recompute();
      return;
    }
    // Transient (5xx / network) → exponential-backoff retry.
    const n = attempts.get(domain) ?? 0;
    attempts.set(domain, n + 1);
    const delay = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)];
    const timer = setTimeout(() => {
      retryTimers.delete(domain);
      const saver = lastSavers.get(domain);
      if (saver) runSync(domain, saver);
    }, delay);
    retryTimers.set(domain, timer);
    recompute();
  };

  save()
    .then((res) => {
      if (res && res.error) {
        onFailure(res.status);
      } else {
        inFlight.delete(domain);
        errored.delete(domain);
        attempts.delete(domain);
        sessionExpired = false; // a successful save proves the session is valid again
        recompute();
      }
    })
    .catch(() => onFailure());
}

/** Immediately retry every currently-errored domain (the "retry" affordance). */
export function retryAllSyncs(): void {
  for (const domain of [...errored]) {
    const timer = retryTimers.get(domain);
    if (timer) {
      clearTimeout(timer);
      retryTimers.delete(domain);
    }
    attempts.delete(domain);
    const saver = lastSavers.get(domain);
    if (saver) runSync(domain, saver);
  }
}

export function getSyncStatus(): SyncState {
  return state;
}

/** IN-3: true after a sync failed with 401 — the cookie is gone and retrying is
 *  futile, so the UI prompts the user to log in again. Cleared by the next success. */
export function getSessionExpired(): boolean {
  return sessionExpired;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Subscribe a component to the global sync status. */
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, getSyncStatus, () => 'idle');
}

/** Subscribe a component to the session-expired (401) signal. */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, getSessionExpired, () => false);
}

/** TEST ONLY: reset all module state between specs. */
export function __resetSyncStatus(): void {
  for (const t of retryTimers.values()) clearTimeout(t);
  state = 'idle';
  sessionExpired = false;
  inFlight.clear();
  errored.clear();
  retryTimers.clear();
  attempts.clear();
  lastSavers.clear();
}
