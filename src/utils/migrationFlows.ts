/**
 * Top origins and destinations of moves between municipalities (StatFin muutl 11a1,
 * summed over the net-migration window), written by scripts/fetch_migration_flows.py.
 * A static asset fetched once, the first time a panel shows a Finnish area — never
 * bundled. Municipal data: every postal code of a municipality shares its lists.
 */
import flowsUrl from '../data/migration_flows.json?url';

/** [kunta code, moves over the window] */
export type Flow = [string, number];

export interface MigrationFlows {
  years: [number, number];
  /** Finnish names by kunta code. */
  names: Record<string, string>;
  /** Swedish names, only where they differ from the Finnish. */
  sv: Record<string, string>;
  /** kunta code → [top origins (moved here from), top destinations (moved there)] */
  flows: Record<string, [Flow[], Flow[]]>;
}

let pending: Promise<MigrationFlows | null> | null = null;

export function loadMigrationFlows(): Promise<MigrationFlows | null> {
  // A failed fetch is not cached, so the next panel open asks again.
  pending ??= fetch(flowsUrl)
    .then((r) => (r.ok ? (r.json() as Promise<MigrationFlows>) : null))
    .catch(() => null)
    .then((v) => {
      if (!v) pending = null;
      return v;
    });
  return pending;
}
