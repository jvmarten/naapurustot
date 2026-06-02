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
}
type Saver = () => Promise<SaveResult>;

let state: SyncState = 'idle';
const subscribers = new Set<() => void>();

const inFlight = new Set<string>();
const errored = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const attempts = new Map<string, number>();
const lastSavers = new Map<string, Saver>();

// Exponential backoff (ms). The last value repeats for further attempts.
const BACKOFF_MS = [2000, 8000, 30000, 120000];

function recompute(): void {
  const next: SyncState = errored.size > 0 ? 'error' : inFlight.size > 0 ? 'syncing' : 'idle';
  if (next !== state) {
    state = next;
    for (const cb of subscribers) cb();
  }
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

  const onFailure = () => {
    inFlight.delete(domain);
    errored.add(domain);
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
        onFailure();
      } else {
        inFlight.delete(domain);
        errored.delete(domain);
        attempts.delete(domain);
        recompute();
      }
    })
    .catch(onFailure);
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

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Subscribe a component to the global sync status. */
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, getSyncStatus, () => 'idle');
}

/** TEST ONLY: reset all module state between specs. */
export function __resetSyncStatus(): void {
  for (const t of retryTimers.values()) clearTimeout(t);
  state = 'idle';
  inFlight.clear();
  errored.clear();
  retryTimers.clear();
  attempts.clear();
  lastSavers.clear();
}
