import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', threshold: 1024, filter: /\.(js|css|html|json|topojson|svg)$/ }),
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br', filter: /\.(js|css|html|json|topojson|svg)$/ }),
    // IN-6: Service Worker & Offline Support
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
        // Exclude HTML from precache — navigation requests use NetworkFirst
        // so users always get the latest index.html after deployment.
        // Exclude data files (.topojson, .geojson) from precache.
        // These are lazy-loaded per region/layer — precaching all of them
        // wastes ~10MB of bandwidth on first visit when the user only needs
        // one region (~200KB). Data files are runtime-cached on first fetch.
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            // Always fetch fresh HTML from the network; fall back to cache
            // only when offline. This prevents stale index.html after deploys.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-navigation',
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Cache map tiles
            urlPattern: /^https:\/\/basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // Cache data files (TopoJSON, GeoJSON) on first fetch.
            // Region files, grid files, and the combined dataset are all
            // lazy-loaded — cache them when accessed so they're available offline.
            urlPattern: /\.(topojson|geojson)(\?|$)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'geodata',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
      manifest: {
        name: 'naapurustot.fi',
        short_name: 'naapurustot',
        description: 'Finnish neighborhoods on a map',
        theme_color: '#6366f1',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
    // IN-3: Bundle analysis (only in build mode)
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  build: {
    assetsInlineLimit: 0, // Never inline data files — always emit as hashed assets
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor';
          // Turf.js: do NOT group all @turf/* into one chunk.
          // Each module is dynamically imported by different features (union for
          // "all cities", bbox for search, boolean-intersects for draw, etc.).
          // Grouping them forces the entire turf bundle (~50-70KB) to load when
          // ANY single module is needed, defeating the lazy-loading pattern.
          // Rollup's natural code splitting creates per-module chunks instead.
        },
      },
    },
  },
})
