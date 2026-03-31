import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { useTheme } from '../../hooks/useTheme';

const BASEMAP_LIGHT = (import.meta.env.VITE_BASEMAP_LIGHT_URL as string) || 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
const BASEMAP_DARK = (import.meta.env.VITE_BASEMAP_DARK_URL as string) || 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

interface MiniMapProps {
  feature: Feature<Polygon | MultiPolygon>;
  allFeatures?: Feature[];
}

function computeBbox(feat: Feature<Polygon | MultiPolygon>): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const coords = feat.geometry.type === 'Polygon'
    ? [feat.geometry.coordinates]
    : feat.geometry.coordinates;
  for (const poly of coords) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

export const MiniMap: React.FC<MiniMapProps> = ({ feature, allFeatures }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;

    const tiles = theme === 'dark' ? BASEMAP_DARK : BASEMAP_LIGHT;
    const bbox = computeBbox(feature);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [tiles],
            tileSize: 256,
          },
        },
        layers: [{ id: 'carto-tiles', type: 'raster', source: 'carto', minzoom: 0, maxzoom: 20 }],
      },
      bounds: [bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number],
      fitBoundsOptions: { padding: 40 },
      interactive: false,
      attributionControl: false,
    });

    map.on('load', () => {
      // Add surrounding neighborhoods with muted fill
      if (allFeatures) {
        const fc: FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
        map.addSource('all', { type: 'geojson', data: fc });
        map.addLayer({
          id: 'all-fill',
          type: 'fill',
          source: 'all',
          paint: {
            'fill-color': theme === 'dark' ? '#374151' : '#e5e7eb',
            'fill-opacity': 0.3,
          },
        });
        map.addLayer({
          id: 'all-line',
          type: 'line',
          source: 'all',
          paint: {
            'line-color': theme === 'dark' ? '#4b5563' : '#d1d5db',
            'line-width': 0.5,
          },
        });
      }

      // Highlight the selected neighborhood
      map.addSource('highlight', { type: 'geojson', data: feature });
      map.addLayer({
        id: 'highlight-fill',
        type: 'fill',
        source: 'highlight',
        paint: {
          'fill-color': '#6366f1',
          'fill-opacity': 0.35,
        },
      });
      map.addLayer({
        id: 'highlight-line',
        type: 'line',
        source: 'highlight',
        paint: {
          'line-color': '#6366f1',
          'line-width': 2.5,
        },
      });
    });

    mapRef.current = map;
    return () => { map.remove(); };
  }, [feature, allFeatures, theme]);

  return (
    <div
      ref={containerRef}
      className="w-full h-64 md:h-80 rounded-xl overflow-hidden"
    />
  );
};
