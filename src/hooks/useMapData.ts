import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';

interface MapDataState {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  metroAverages: Record<string, number>;
  retry: () => void;
}

export function useMapData(): MapDataState {
  const [state, setState] = useState<Omit<MapDataState, 'retry'>>({
    data: null,
    loading: true,
    error: null,
    metroAverages: {},
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState({ data: null, loading: true, error: null, metroAverages: {} });
    fetch(import.meta.env.VITE_DATA_PATH as string)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
        return res.json();
      })
      .then((geojson: FeatureCollection) => {
        geojson.features = filterSmallIslands(geojson.features);
        computeQualityIndices(geojson.features);
        const metroAverages = computeMetroAverages(geojson.features);
        setState({ data: geojson, loading: false, error: null, metroAverages });
      })
      .catch((err) => {
        setState({ data: null, loading: false, error: err.message, metroAverages: {} });
      });
  }, [attempt]);

  const retry = () => setAttempt((a) => a + 1);

  return { ...state, retry };
}
