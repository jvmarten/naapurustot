import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';

interface MapDataState {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  metroAverages: Record<string, number>;
}

export function useMapData(): MapDataState {
  const [state, setState] = useState<MapDataState>({
    data: null,
    loading: true,
    error: null,
    metroAverages: {},
  });

  useEffect(() => {
    fetch('/data/metro_neighborhoods.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
        return res.json();
      })
      .then((geojson: FeatureCollection) => {
        computeQualityIndices(geojson.features);
        const metroAverages = computeMetroAverages(geojson.features);
        setState({ data: geojson, loading: false, error: null, metroAverages });
      })
      .catch((err) => {
        setState({ data: null, loading: false, error: err.message, metroAverages: {} });
      });
  }, []);

  return state;
}
