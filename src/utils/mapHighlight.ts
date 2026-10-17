/**
 * The postal area a list row is pointing at (ranking-table hover), for the map to
 * light up with its own hover ring + fill.
 *
 * An external store rather than App state for the same reason as tooltipStore.ts:
 * sweeping the cursor down the ranking list changes this on every row, and routing
 * it through App state would re-render the whole tree per row. The map subscribes and
 * sets feature-state directly, so a row hover re-renders nothing.
 *
 * App hands `setMapHighlight` to RankingTable as a prop rather than the table
 * importing it: imported from App this module lands in the entry chunk, while a
 * direct import from the two lazy chunks splits it into its own (~300 bytes against
 * the bundle budget for a ~140-byte module).
 */

type Listener = (pno: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();

/** Point the map at `pno`, or clear the highlight with null. */
export function setMapHighlight(pno: string | null): void {
  if (current === pno) return;
  current = pno;
  listeners.forEach(l => l(pno));
}

/** Subscribe to highlight changes. Returns an unsubscribe function. */
export function subscribeMapHighlight(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
