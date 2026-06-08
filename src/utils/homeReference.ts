/**
 * QW-2: persistence for the "my home" reference baseline postal code.
 *
 * The reference pno already lives in App state and the `ref` URL param; this adds a
 * localStorage mirror so a user's chosen home survives reloads and new sessions even
 * when no shared link carries it. On startup the URL `ref` wins (a shared link is an
 * explicit intent); otherwise we fall back to the stored home.
 */

const STORAGE_KEY = 'naapurustot-home-reference';

/** Read the persisted home reference pno, or null when unset/invalid/unavailable. */
export function loadHomeReference(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && /^\d{5}$/.test(raw)) return raw;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

/** Persist (or clear, when null) the home reference pno. Best-effort. */
export function saveHomeReference(pno: string | null): void {
  try {
    if (pno && /^\d{5}$/.test(pno)) localStorage.setItem(STORAGE_KEY, pno);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota exceeded or unavailable */
  }
}
