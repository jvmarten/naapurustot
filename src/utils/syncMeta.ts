/**
 * IN-6: per-store (and per-item) last-edit timestamps, kept in localStorage, used
 * to resolve a diverged cloud-sync conflict on login by last-write-wins.
 *
 * On login each user-state hook compares the server's `updatedAt` for its store
 * against the timestamp recorded here the last time the local copy was edited:
 * the newer side wins. Notes track a timestamp per postal code (`notes:00100`),
 * everything else a single per-store timestamp (`weights`, `wizardProfile`).
 *
 * Timestamps are an ordering hint only — a missing or unreadable value reads as 0
 * (treated as "older than the server"), so the worst case falls back to adopting
 * the server copy, never a crash.
 */
const STORAGE_KEY = 'naapurustot-sync-meta';

function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, number>;
      }
    }
  } catch { /* unavailable or malformed */ }
  return {};
}

/** Record that `id` (a store name, or `${store}:${item}`) was just edited locally. */
export function markEdited(id: string, at: number = Date.now()): void {
  try {
    const all = readAll();
    all[id] = at;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded or unavailable */ }
}

/** Local last-edit epoch ms for `id`, or 0 if never recorded. */
export function editedAt(id: string): number {
  const v = readAll()[id];
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
