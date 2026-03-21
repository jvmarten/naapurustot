import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import type { LayerId } from '../utils/colorScales';

const GRID_URL = new URL('/data/light_pollution_grid.geojson', import.meta.url).href;

/**
 * Lazily loads the VIIRS light pollution grid GeoJSON when the light_pollution
 * layer is active. Returns null if the layer is not active or the grid data
 * is not available (graceful fallback to postal code choropleth).
 */
export function useLightPollutionGrid(activeLayer: LayerId): FeatureCollection | null {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (activeLayer !== 'light_pollution') return;
    if (attempted) return; // Only try once

    let cancelled = false;
    setAttempted(true);

    fetch(GRID_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((geojson: FeatureCollection) => {
        if (!cancelled) {
          setData(geojson);
        }
      })
      .catch(() => {
        // Grid data not available — fall back to postal code level
        if (!cancelled) setData(null);
      });

    return () => { cancelled = true; };
  }, [activeLayer, attempted]);

  // Only return data when light_pollution is active
  if (activeLayer !== 'light_pollution') return null;
  return data;
}
