import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import planningManifest from '../data/planning_manifest.json';

/**
 * CF-2 / CF-3: lazy loaders for the kaavat & hankkeet (zoning plans +
 * infrastructure projects) datasets built by scripts/build_planning_data.mjs.
 *
 * Two concerns, two hooks, one shared manifest + cache module so neither the map
 * overlay (CF-2) nor the panel list (CF-3) pulls planning data into first paint:
 *   - usePlanningOverlay(region, enabled): merged geometry FeatureCollection for
 *     the active region's projects + plans, fetched only while the overlay toggle
 *     is on. Features carry {kind, ptype, status, name, date, url, source} so the
 *     map paints plans (polygons) by status and projects (lines) by type.
 *   - usePlanningArea(region, pno): the selected area's nearby entries, from a
 *     compact per-region pno→entries shard (the same entries the prerendered
 *     profiles show — one source of truth), fetched only while a panel is open.
 *
 * All data is a free static shard fetched on demand (exactly like the grid
 * shards); a missing/failed fetch degrades to nothing, never to fabricated data.
 */
const BASE = import.meta.env.BASE_URL ?? '/';

export interface PlanningEntry {
  name: string;
  kind: 'project' | 'plan';
  ptype: 'road' | 'rail' | 'waterway' | 'zoning';
  subtype: string;
  status: string;
  date: string | null;
  url: string;
  source: string;
}

interface PlanningManifest {
  snapshot: string;
  projects: { scope: string; shardPattern: string; total: number; regions: Record<string, number> };
  plans: { scope: string; shardPattern: string; total: number; cities: string[]; regions: Record<string, number> };
  area: { shardPattern: string; regions: Record<string, number> };
}
const MANIFEST = planningManifest as PlanningManifest;

/** Honest coverage metadata for the controls/legend captions. */
export function planningInfo() {
  return {
    snapshot: MANIFEST.snapshot,
    cities: MANIFEST.plans.cities,
    projectsScope: MANIFEST.projects.scope,
    plansScope: MANIFEST.plans.scope,
  };
}

/** True when the region has any project or plan geometry to overlay. */
export function regionHasPlanningGeometry(region: string | undefined): boolean {
  if (!region) return false;
  return (
    (MANIFEST.projects.regions[region] ?? 0) > 0 || (MANIFEST.plans.regions[region] ?? 0) > 0
  );
}
/** True when the region has plan polygons (so the status legend is meaningful). */
export function regionHasPlans(region: string | undefined): boolean {
  return !!region && (MANIFEST.plans.regions[region] ?? 0) > 0;
}

const shardUrl = (pattern: string, region: string) => BASE + pattern.replace('{region}', region);

// ── module caches (survive remounts; small, region-scoped) ───────────────────
const geoCache = new Map<string, FeatureCollection>();
const areaCache = new Map<string, Record<string, PlanningEntry[]>>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`planning fetch ${res.status}`);
  return res.json();
}

/** CF-2: merged projects + plans geometry for the active region (overlay on). */
export function usePlanningOverlay(
  region: string | undefined,
  enabled: boolean,
  /** ER-3: bump to refetch after a failure (failed results are never cached). */
  retryNonce = 0,
): { features: FeatureCollection | null; loading: boolean; error: boolean } {
  const [features, setFeatures] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  // ER-3: a dropped shard used to render as "no plans here" — the exact wrong
  // answer for someone checking whether a building site is planned next door.
  const [error, setError] = useState(false);
  const active = enabled && !!region && region !== 'all' && regionHasPlanningGeometry(region);

  useEffect(() => {
    if (!active || !region) {
      setFeatures(null);
      return;
    }
    if (geoCache.has(region)) {
      setFeatures(geoCache.get(region)!);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const want = [
      MANIFEST.projects.regions[region] ? shardUrl(MANIFEST.projects.shardPattern, region) : null,
      MANIFEST.plans.regions[region] ? shardUrl(MANIFEST.plans.shardPattern, region) : null,
    ].filter(Boolean) as string[];
    // ER-3: remember whether *any* shard rejected. The per-shard `.catch(() => [])`
    // below keeps a partial result usable, but the outcome must not be mistaken for
    // a complete one.
    let anyFailed = false;
    Promise.all(
      want.map((u) =>
        fetchJson(u)
          .then((j) => (j as FeatureCollection).features ?? [])
          .catch(() => {
            anyFailed = true;
            return [];
          }),
      ),
    )
      .then((groups) => {
        if (cancelled) return;
        const merged: FeatureCollection = { type: 'FeatureCollection', features: groups.flat() };
        // ER-3: only cache a complete result. Caching a partial/empty one pinned the
        // blank overlay for the whole session — toggling off/on or switching region
        // and back kept showing "nothing here".
        if (!anyFailed) geoCache.set(region, merged);
        setFeatures(merged);
        setError(anyFailed);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFeatures({ type: 'FeatureCollection', features: [] });
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [region, active, retryNonce]);

  return { features: active ? features : null, loading, error: active && error };
}

/** CF-3: the selected area's nearby planning entries (panel list). */
export function usePlanningArea(
  region: string | undefined,
  pno: string | null,
): { entries: PlanningEntry[] | null; loading: boolean; error: boolean } {
  const [index, setIndex] = useState<Record<string, PlanningEntry[]> | null>(null);
  const [loading, setLoading] = useState(false);
  // ER-3: same honesty problem as the overlay — a failed shard rendered as
  // "no nearby plans" in the panel.
  const [error, setError] = useState(false);
  const hasShard = !!region && region !== 'all' && (MANIFEST.area.regions[region] ?? 0) > 0;

  useEffect(() => {
    if (!hasShard || !region) {
      setIndex(null);
      return;
    }
    if (areaCache.has(region)) {
      setIndex(areaCache.get(region)!);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchJson(shardUrl(MANIFEST.area.shardPattern, region))
      .then((j) => {
        if (cancelled) return;
        const map = (j as Record<string, PlanningEntry[]>) ?? {};
        areaCache.set(region, map);
        setIndex(map);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Leave `index` null (not `{}`): an empty index is indistinguishable from
        // "this area has no entries", and it must not be cached either.
        setIndex(null);
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [region, hasShard]);

  return { entries: pno && index ? (index[pno] ?? null) : null, loading, error: hasShard && error };
}
