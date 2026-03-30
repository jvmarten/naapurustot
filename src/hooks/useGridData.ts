import { useState, useEffect, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { LayerId } from '../utils/colorScales';

/**
 * Registry of fine-grained grid data files keyed by LayerId.
 *
 * Each entry maps a layer to the path of its grid data file under
 * public/data/. Supports both .topojson and .geojson formats.
 * Files are fetched lazily the first time the user switches to a
 * grid layer. If the file doesn't exist (grid data not yet built),
 * the fetch silently fails and the map falls back to the postal choropleth.
 */
const GRID_PATHS: Partial<Record<LayerId, string>> = {
  transit_reachability: '/data/transit_reachability_grid.topojson',
  light_pollution: '/data/light_pollution_grid.geojson',
};

/** Returns true if the layer has a registered grid data source. */
export function hasGridData(layerId: LayerId): boolean {
  return layerId in GRID_PATHS;
}

interface GridDataState {
  gridData: FeatureCollection | null;
  loading: boolean;
}

function parseGridResponse(path: string, json: unknown): FeatureCollection {
  if (path.endsWith('.topojson')) {
    const topo = json as Topology;
    const objectName = Object.keys(topo.objects ?? {})[0];
    if (!objectName) throw new Error('Invalid grid TopoJSON: no objects');
    return feature(topo, topo.objects[objectName]) as FeatureCollection;
  }
  return json as FeatureCollection;
}

/**
 * Lazily loads fine-grained grid data for a given layer.
 *
 * Returns null gridData when the active layer has no grid source,
 * while data is still loading, or if the grid file doesn't exist.
 * Once loaded, the FeatureCollection is cached in memory.
 */
export function useGridData(activeLayer: LayerId): GridDataState {
  const [cache, setCache] = useState<Record<string, FeatureCollection>>({});
  const [loading, setLoading] = useState(false);
  // Track which layers have been fetched (or are being fetched) to avoid
  // re-triggering the effect when cache state updates.
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const path = GRID_PATHS[activeLayer];
    if (!path) return;
    const fetched = fetchedRef.current;
    if (fetched.has(activeLayer)) return;
    fetched.add(activeLayer);

    let cancelled = false;
    let completed = false;
    setLoading(true);

    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`Grid data fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const geojson = parseGridResponse(path, json);
        setCache((prev) => ({ ...prev, [activeLayer]: geojson }));
        setLoading(false);
        completed = true;
      })
      .catch((err) => {
        if (cancelled) return;
        // Grid data is optional — silently fall back to postal choropleth.
        // Remove from fetched set so a retry is possible on next layer switch.
        fetched.delete(activeLayer);
        console.warn(`Grid data not available for ${activeLayer}:`, err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      // Allow retry on re-visit only if the fetch didn't complete successfully
      if (!completed) fetched.delete(activeLayer);
    };
  }, [activeLayer]);

  const path = GRID_PATHS[activeLayer];
  if (!path) return { gridData: null, loading: false };

  return { gridData: cache[activeLayer] ?? null, loading };
}
