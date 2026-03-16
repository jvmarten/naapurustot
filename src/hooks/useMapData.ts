import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';

import topoUrl from '../data/metro_neighborhoods.topojson?url';

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
    fetch(topoUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
        return res.json();
      })
      .then((topo: Topology) => {
        const objectName = Object.keys(topo.objects)[0];
        const geojson = feature(topo, topo.objects[objectName]) as FeatureCollection;
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
