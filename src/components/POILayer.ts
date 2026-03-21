import type maplibregl from 'maplibre-gl';

const POI_SOURCE = 'pois';
const POI_CLUSTER_LAYER = 'poi-clusters';
const POI_COUNT_LAYER = 'poi-cluster-count';
const POI_UNCLUSTERED_LAYER = 'poi-unclustered';

export type POICategory = 'school' | 'daycare' | 'grocery' | 'healthcare' | 'transit';

const CATEGORY_COLORS: Record<POICategory, string> = {
  school: '#6366f1',
  daycare: '#f59e0b',
  grocery: '#10b981',
  healthcare: '#ef4444',
  transit: '#3b82f6',
};

interface POILayerOptions {
  map: maplibregl.Map;
  categories: POICategory[];
  visible: boolean;
}

export function addPOILayers({ map, categories, visible }: POILayerOptions): void {
  // Remove existing POI layers
  removePOILayers(map);

  if (!visible || categories.length === 0) return;

  // Check if POI data source exists
  if (!map.getSource(POI_SOURCE)) {
    // Attempt to load POI data
    map.addSource(POI_SOURCE, {
      type: 'geojson',
      data: '/data/pois.geojson',
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });
  }

  // Clustered circles
  map.addLayer({
    id: POI_CLUSTER_LAYER,
    type: 'circle',
    source: POI_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#6366f1', 10,
        '#3b82f6', 30,
        '#10b981',
      ],
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        15, 10,
        20, 30,
        25,
      ],
      'circle-opacity': 0.8,
    },
  });

  // Cluster count labels
  map.addLayer({
    id: POI_COUNT_LAYER,
    type: 'symbol',
    source: POI_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 11,
    },
    paint: {
      'text-color': '#ffffff',
    },
  });

  // Individual POI markers
  const categoryFilter = categories.length < 5
    ? ['in', ['get', 'category'], ['literal', categories]]
    : ['!', false]; // show all

  map.addLayer({
    id: POI_UNCLUSTERED_LAYER,
    type: 'circle',
    source: POI_SOURCE,
    filter: ['all',
      ['!', ['has', 'point_count']],
      categoryFilter,
    ] as unknown as maplibregl.ExpressionSpecification,
    paint: {
      'circle-color': [
        'match',
        ['get', 'category'],
        'school', CATEGORY_COLORS.school,
        'daycare', CATEGORY_COLORS.daycare,
        'grocery', CATEGORY_COLORS.grocery,
        'healthcare', CATEGORY_COLORS.healthcare,
        'transit', CATEGORY_COLORS.transit,
        '#6b7280',
      ],
      'circle-radius': 5,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  });
}

export function removePOILayers(map: maplibregl.Map): void {
  if (map.getLayer(POI_UNCLUSTERED_LAYER)) map.removeLayer(POI_UNCLUSTERED_LAYER);
  if (map.getLayer(POI_COUNT_LAYER)) map.removeLayer(POI_COUNT_LAYER);
  if (map.getLayer(POI_CLUSTER_LAYER)) map.removeLayer(POI_CLUSTER_LAYER);
}

export { CATEGORY_COLORS };
