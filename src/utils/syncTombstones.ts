/**
 * CF-6: client-side deletion tombstones for the cloud-synced stores.
 *
 * The login-merge for favorites/shortlist (plain set-union) and notes
 * (longer-text-wins) cannot tell "the other device added this" from "this device
 * deleted it and the other device still has the stale copy". So an item deleted
 * on device A reappears after device B's next push-back. A tombstone records what
 * the user explicitly removed on this device; the merge then skips a server item
 * that is tombstoned and absent locally.
 *
 * Safe by construction — never drops an item the user kept:
 *   • a tombstone is only honoured for items NOT present in the local set
 *     (re-adding an item clears its tombstone, so a kept item is never tombstoned);
 *   • it only suppresses re-adding something the user already deleted here.
 * It does not force-delete on other devices (they never asked to delete it), so no
 * data is lost anywhere — only the local deletion stops being undone.
 */

const CAP = 500; // bound the tombstone set; oldest entries fall off first

export function readTombstones(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === 'string'));
    }
  } catch {
    /* localStorage unavailable or malformed */
  }
  return new Set();
}

function writeTombstones(key: string, set: Set<string>): void {
  try {
    // Set iterates in insertion order, so slice(-CAP) keeps the most recent.
    localStorage.setItem(key, JSON.stringify([...set].slice(-CAP)));
  } catch {
    /* quota exceeded or unavailable */
  }
}

/** Record that the user removed `id` on this device. */
export function addTombstone(key: string, id: string): void {
  const set = readTombstones(key);
  // Re-insert at the end so it counts as most-recent for the CAP window.
  set.delete(id);
  set.add(id);
  writeTombstones(key, set);
}

/** Record that the user removed several items at once (e.g. "clear all"). */
export function addTombstones(key: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const set = readTombstones(key);
  for (const id of ids) {
    set.delete(id);
    set.add(id);
  }
  writeTombstones(key, set);
}

/** Forget the tombstone for `id` — call when the user re-adds it. */
export function clearTombstone(key: string, id: string): void {
  const set = readTombstones(key);
  if (set.delete(id)) writeTombstones(key, set);
}

/**
 * Union of `base` and `other`, preserving `base` order and appending new items
 * from `other` — except items tombstoned under `key` and absent from `base`.
 */
export function mergeRespectingTombstones(base: string[], other: string[], key: string): string[] {
  const tomb = readTombstones(key);
  const seen = new Set(base);
  const merged = [...base];
  for (const id of other) {
    if (!seen.has(id) && !tomb.has(id)) {
      merged.push(id);
      seen.add(id);
    }
  }
  return merged;
}
