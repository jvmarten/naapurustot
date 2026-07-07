import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'

// QW-1: inline ONLY the data-freshness timestamp from build_metadata.json via a
// `define` (below), so the full ~12.7KB per-metric metadata table never ships in
// the budget-counted index chunk. SettingsDropdown renders just this one date.
// Vite's JSON plugin stringifies files this size, defeating tree-shaking, so a
// plain `import { generated }` would still pull the whole object into the bundle.
function readBuildDate(): string {
  try {
    const raw = readFileSync(new URL('./src/data/build_metadata.json', import.meta.url), 'utf8')
    return (JSON.parse(raw) as { generated?: string }).generated ?? ''
  } catch {
    return ''
  }
}
const BUILD_DATE = readBuildDate()

// PO-2: inline ONLY the compact per-metric coverage map ({ property: coverage_pct })
// from build_metadata.json via a `define`, so the sources page, legend caption, and
// low-coverage banner can read real coverage without pulling the full ~12.7KB metadata
// table (source/vintage/granularity/row_count per metric) into the budget-counted bundle.
function readCoverageMap(): Record<string, number> {
  try {
    const raw = readFileSync(new URL('./src/data/build_metadata.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { metrics?: Record<string, { coverage_pct?: number }> }
    const out: Record<string, number> = {}
    for (const [prop, m] of Object.entries(parsed.metrics ?? {})) {
      if (typeof m?.coverage_pct === 'number') out[prop] = m.coverage_pct
    }
    return out
  } catch {
    return {}
  }
}
const COVERAGE_PCT = readCoverageMap()

// IN-3: Keep build-only pipeline inputs out of the deployed site.
//
// `public/data/` holds both runtime data the app fetches AND large GeoJSON
// inputs that only the build/prerender scripts read (metro_neighborhoods.geojson
// ~38 MB, *_grid.geojson conversion inputs). Vite copies all of public/ verbatim
// into dist/, so without this those inputs ship to GitHub Pages on every deploy —
// ~40 MB of dead weight, plus raw source data needlessly exposed at /data/.
//
// We strip them from dist/ after the public-dir copy rather than relocating them
// in the repo: the files must stay committed (prerender + build:data read them,
// and the deploy build never re-runs the data pipeline), and moving them would
// mean touching the data-integrity-sensitive Python pipeline + data-refresh
// workflow. Rule: always drop metro_neighborhoods.geojson (never fetched at
// runtime); drop a *_grid.geojson only when its *_grid.topojson sibling exists
// (the TopoJSON is the runtime form). Raw-GeoJSON grids that are served directly
// — e.g. light_pollution_grid.geojson, which useGridData fetches as-is — have no
// TopoJSON sibling and are therefore kept.
function stripBuildOnlyData(): Plugin {
  let outDir = 'dist'
  return {
    name: 'naapurustot-strip-build-only-data',
    apply: 'build',
    configResolved(config) {
      outDir = resolvePath(config.root, config.build.outDir)
    },
    closeBundle() {
      const dataDir = joinPath(outDir, 'data')
      if (!existsSync(dataDir)) return
      const files = readdirSync(dataDir)
      const removed: string[] = []
      for (const f of files) {
        const isMonolith = f === 'metro_neighborhoods.geojson'
        const isConvertedGrid =
          f.endsWith('_grid.geojson') && files.includes(f.replace(/\.geojson$/, '.topojson'))
        if (isMonolith || isConvertedGrid) {
          rmSync(joinPath(dataDir, f))
          removed.push(f)
        }
      }
      if (removed.length) {
        console.log(`[strip-build-only-data] removed build-only inputs from ${outDir}/data: ${removed.join(', ')}`)
      }
    },
  }
}

// Home-route critical-chunk preloads.
//
// src/main.tsx code-splits the whole App shell off the entry chunk (so the ~9,000
// prerendered profile pages, which clone dist/index.html, no longer download &
// parse the map app — and maplibre's modulepreload + render-blocking CSS drop out
// of the entry's static graph automatically). The cost is that the home route ('/')
// would otherwise waterfall: entry → App chunk → Map → maplibre. We restore parallel
// fetching by injecting, into dist/index.html only, a modulepreload for the App and
// maplibre chunks plus a NON-render-blocking preload for maplibre's CSS (the actual
// stylesheet link is injected at runtime by Vite's chunk loader when the Map mounts).
//
// Every tag is marked `data-home-preload` so prerender.mjs can strip them from the
// cloned profile / data-sources / privacy pages — none of those routes load the App
// shell or the full map (profiles render a lazy MiniMap that re-injects maplibre on
// demand), so preloading the ~263 KB maplibre chunk there is pure waste.
function injectHomePreloads(): Plugin {
  return {
    name: 'naapurustot-inject-home-preloads',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        let appHref: string | undefined
        let maplibreJs: string | undefined
        let maplibreCss: string | undefined
        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type === 'chunk') {
            const facade = (output.facadeModuleId ?? '').replace(/\\/g, '/')
            if (output.name === 'App' || facade.endsWith('/src/App.tsx')) appHref = '/' + fileName
            else if (output.name === 'maplibre') maplibreJs = '/' + fileName
          } else if (output.type === 'asset' && /(^|\/)maplibre-[^/]*\.css$/.test(fileName)) {
            maplibreCss = '/' + fileName
          }
        }
        const mark = { 'data-home-preload': true }
        const tags = []
        if (appHref) tags.push({ tag: 'link', injectTo: 'head' as const, attrs: { rel: 'modulepreload', crossorigin: true, href: appHref, ...mark } })
        if (maplibreJs) tags.push({ tag: 'link', injectTo: 'head' as const, attrs: { rel: 'modulepreload', crossorigin: true, href: maplibreJs, ...mark } })
        if (maplibreCss) tags.push({ tag: 'link', injectTo: 'head' as const, attrs: { rel: 'preload', as: 'style', crossorigin: true, href: maplibreCss, ...mark } })
        return { html, tags }
      },
    },
  }
}

const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN
const SENTRY_ORG = process.env.SENTRY_ORG
const SENTRY_PROJECT = process.env.SENTRY_PROJECT
const SENTRY_RELEASE = process.env.VITE_SENTRY_RELEASE

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Re-add the home-route App + maplibre preloads that code-splitting App removed
    // from the entry's static graph (stripped from cloned profile pages by prerender).
    injectHomePreloads(),
    viteCompression({ algorithm: 'gzip', threshold: 1024, filter: /\.(js|css|html|json|topojson|svg)$/ }),
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br', filter: /\.(js|css|html|json|topojson|svg)$/ }),
    // IN-6: Service Worker & Offline Support
    //
    // `prompt` (not `autoUpdate`): a freshly-deployed SW must *wait* instead of
    // taking control the instant it activates. Under `autoUpdate`, vite-plugin-pwa
    // force-reloads the page as soon as the new SW controls it — which fired tens
    // of seconds into a returning user's session and wiped their in-progress work
    // (draw polygons, notes, mid-comparison). With `prompt`, the new SW stays
    // waiting and main.tsx's onNeedRefresh decides *when* to apply it (deferred
    // until the tab is hidden). See src/main.tsx.
    VitePWA({
      registerType: 'prompt',
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
            // Cache data files (TopoJSON, GeoJSON) — stale-while-revalidate so
            // users get the cached file instantly AND we refresh from the network
            // in the background. Previously CacheFirst kept users on a stale
            // grid for up to 30 days after a data update (e.g. extending the
            // light_pollution grid nationally), with only an incognito tab
            // showing the new data.
            urlPattern: /\.(topojson|geojson)(\?|$)/,
            handler: 'StaleWhileRevalidate',
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
        // X6: The manifest is emitted statically at build time — browsers read it
        // from a fixed URL at install and do NOT localize it by Accept-Language/UA.
        // A single locale must therefore be baked in, so we use the Finnish
        // source-language one-liner (the app is Finnish-first). Runtime UI strings
        // remain localized via i18n; only this install-time blurb is static.
        description: 'Vertaile Suomen asuinalueita kartalla',
        // X6: keep in sync with index.html <meta name="theme-color"> and
        // scripts/prerender-hubs.mjs (both '#1e3a5f').
        theme_color: '#1e3a5f',
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
    // IN-3: Strip build-only pipeline inputs from the deployed dist/ (see above).
    stripBuildOnlyData(),
    // Source maps are emitted as 'hidden' (no //# sourceMappingURL=…) so they
    // get uploaded to Sentry but are deleted from dist/ before deploy — clients
    // never download them. Only active when an auth token is provided.
    SENTRY_AUTH_TOKEN ? sentryVitePlugin({
      org: SENTRY_ORG,
      project: SENTRY_PROJECT,
      authToken: SENTRY_AUTH_TOKEN,
      release: SENTRY_RELEASE ? { name: SENTRY_RELEASE } : undefined,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }) : null,
  ],
  define: {
    // QW-1: data-freshness timestamp inlined as a string literal (see readBuildDate).
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    // PO-2: compact per-metric coverage map inlined (see readCoverageMap).
    __COVERAGE_PCT__: JSON.stringify(COVERAGE_PCT),
  },
  build: {
    assetsInlineLimit: 0, // Never inline data files — always emit as hashed assets
    sourcemap: SENTRY_AUTH_TOKEN ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor';
          // Turf.js: do NOT group all @turf/* into one chunk.
          // Each module is dynamically imported by a different feature (bbox for
          // search, boolean-intersects for draw, boolean-point-in-polygon for
          // grid clipping, etc.).
          // Grouping them forces the entire turf bundle (~50-70KB) to load when
          // ANY single module is needed, defeating the lazy-loading pattern.
          // Rollup's natural code splitting creates per-module chunks instead.
        },
      },
    },
  },
})
