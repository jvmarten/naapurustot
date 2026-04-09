# Architecture

## Overview

naapurustot is a React + TypeScript SPA that visualizes neighborhood statistics across 22 Finnish city regions on an interactive MapLibre GL map. The frontend is fully static — all data is bundled as TopoJSON files (one per region) and all computation happens client-side. An optional Express backend handles user accounts and favorites sync.

Data is lazy-loaded per region to keep initial page loads fast. The app also has SEO-friendly neighborhood profile pages pre-rendered at build time.

```
Browser
┌─────────────────────────────────────────────────────────────┐
│  index.html                                                 │
│  ├── main.tsx (entry: ThemeProvider → BrowserRouter → Routes)│
│  ├── / → App.tsx (main map application)                      │
│  │   ├── Map.tsx (MapLibre GL)                               │
│  │   ├── LayerSelector / Legend / SearchBar / CitySelector    │
│  │   ├── NeighborhoodPanel (lazy)                            │
│  │   ├── ComparisonPanel / RankingTable (lazy)               │
│  │   ├── FilterPanel / NeighborhoodWizard (lazy)             │
│  │   ├── DrawTool + AreaSummaryPanel / SplitMapView (lazy)   │
│  │   ├── AuthModal / UserMenu (lazy, optional)               │
│  │   └── TooltipOverlay / SettingsDropdown / ToolsDropdown   │
│  ├── /alue/:slug → NeighborhoodProfilePage (lazy)            │
│  └── per-region TopoJSON files (lazy-loaded on navigation)   │
└─────────────────────────────────────────────────────────────┘

Server (optional)
┌─────────────────────────────────────────────────────────────┐
│  Caddy (reverse proxy, auto-HTTPS)                           │
│  ├── api.naapurustot.fi → Express API (auth, favorites)      │
│  ├── analytics.naapurustot.fi → Umami                        │
│  └── PostgreSQL (shared by API + Umami)                      │
└─────────────────────────────────────────────────────────────┘
```

## Data flow

```
1. User selects a region (CitySelector) or navigates to a URL with ?city=
2. useMapData(regionId) loads the appropriate TopoJSON (via dataLoader.ts):
   - Single region: fetches src/data/regions/{regionId}.topojson (Vite glob import)
   - "All" view: fetches combined metro_neighborhoods.topojson
   - Each file is fetched once and cached (Promise-level dedup)
3. dataLoader.processTopology() runs the processing pipeline:
   a. TopoJSON → GeoJSON conversion (topojson-client)
   b. String-to-number coercion for numeric properties
   c. filterSmallIslands() removes tiny island polygons (<15% of largest)
   d. computeQualityIndices() calculates composite 0-100 scores (mutates in place)
   e. computeChangeMetrics() derives trend change % from history arrays
   f. computeQuickWinMetrics() derives demographic ratios from raw Paavo fields
   g. computeMetroAverages() produces population-weighted averages
4. GeoJSON + metroAverages flow to App.tsx via the useMapData return value
5. App passes data down to Map, panels, and tools via props
6. "All cities" view: buildMetroAreaFeatures() dissolves postal polygons into
   city outlines using @turf/union (lazy-loaded, ~17KB), with cached geometry
```

### Key design choice: mutable feature properties

Quality indices, change metrics, and quick-win metrics are computed by **mutating** GeoJSON feature properties in place after loading. This avoids copying the entire feature collection (~160 features × 100+ properties) and means the Map component's GeoJSON source always has the latest values. When custom quality weights change, `computeQualityIndices()` mutates again and a `qualityVersion` counter triggers a MapLibre source refresh.

## State management

There is no external state library. All state lives in `App.tsx` via `useState` / `useCallback` hooks:

| State | Location | Persistence |
|-------|----------|-------------|
| GeoJSON data + metro averages | `useMapData(regionId)` hook | Fetched per region, cached in memory |
| Selected neighborhood | `useSelectedNeighborhood` hook | URL query param (`?pno=`) |
| Pinned comparisons (max 3) | `useSelectedNeighborhood` hook | URL query param (`?compare=`) |
| Active layer | `useState` in App | URL query param (`?layer=`) |
| Active region/city | `useState` in App | URL query param (`?city=`) |
| Theme (dark/light/system) | `useTheme` Context | `localStorage` |
| Language (fi/en) | `useState` in App + `i18n.ts` module | `localStorage` |
| Auth (user session) | `useAuth` hook | JWT in httpOnly cookie (server-side) |
| Favorites | `useFavorites` hook | `localStorage` + optional server sync |
| Notes, filter presets | `useNotes`, `useFilterPresets` hooks | `localStorage` |
| Recent searches | `useRecentNeighborhoods` hook | `sessionStorage` |
| Colorblind mode | Module-level var in `colorScales.ts` | `localStorage` |
| Tooltip (hover) | External store (`tooltipStore.ts`) | Memory only |

URL state is read once at startup (`readInitialUrlState`) and kept in sync via `useSyncUrlState`, which writes to `history.replaceState` on every change. The debounced write (100ms) avoids redundant replaceState calls when multiple values change in the same tick.

### Tooltip performance pattern

Tooltip state uses an external store (`tooltipStore.ts`) instead of React state to avoid re-rendering the entire App tree on every mousemove (~60Hz). The `TooltipOverlay` component subscribes via `useSyncExternalStore` and is the only component that re-renders on hover.

## Map architecture (MapLibre GL)

The `Map.tsx` component manages a MapLibre GL instance through a series of independent `useEffect` hooks, each responsible for one concern:

1. **Initialization** — creates the map once, never re-runs
2. **Theme switching** — swaps CARTO raster tile URL (light ↔ dark)
3. **Data loading** — adds GeoJSON source + fill/line/highlight layers when data arrives
4. **Layer switching** — updates `fill-color` paint property with interpolated color expression
5. **Filter highlighting** — dims non-matching neighborhoods, adds green border on matches
6. **Hover/click** — uses `setFeatureState` for hover/selected visual feedback
7. **Selection** — highlights selected neighborhood border
8. **Pinned** — adds a gold border layer for comparison neighborhoods
9. **Wizard highlights** — blue border + dimming for wizard results
10. **FlyTo** — animated camera transitions on search/selection

This split avoids re-initializing the map when only one aspect changes.

### Map layers (bottom to top)

| Layer ID | Type | Purpose |
|----------|------|---------|
| `carto-tiles` | raster | Basemap tiles |
| `neighborhoods-fill` | fill | Choropleth data visualization |
| `neighborhoods-no-data-pattern` | line | Dashed border on missing-data areas |
| `neighborhoods-line` | line | Neighborhood borders |
| `neighborhoods-highlight` | line | Hover/selection highlight |
| `neighborhoods-pinned` | line | Gold border on pinned comparisons |
| `neighborhoods-filter-highlight` | line | Green border on filter matches |
| `neighborhoods-wizard-highlight` | line | Blue border on wizard results |

## Quality Index

The quality index is a weighted composite score (0–100) computed from 7 primary factors:

| Factor | Default weight | Property | Direction |
|--------|---------------|----------|-----------|
| Safety | 25% | `crime_index` | Lower = better |
| Income | 20% | `hr_mtu` | Higher = better |
| Employment | 20% | `unemployment_rate` | Lower = better |
| Education | 15% | `higher_education_rate` | Higher = better |
| Transit | 7% | `transit_stop_density` | Higher = better |
| Services | 5% | Healthcare + school + daycare + grocery density (averaged) | Higher = better |
| Air quality | 3% | `air_quality_index` | Lower = better |

Each metric is min-max normalized across the dataset. Users can customize weights via the CustomQualityPanel, which triggers recomputation of all indices.

3 additional factors (cycling, grocery access, restaurants) are available as secondary factors with 0% default weight.

## Internationalization

Translation is handled by a minimal custom system in `src/utils/i18n.ts`:

- Two JSON files: `src/locales/fi.json` and `src/locales/en.json`
- Flat key-value structure: `t('panel.median_income')` → localized string
- Language persisted in `localStorage`, toggled via a button in settings
- `document.documentElement.lang` is updated dynamically for SEO

## Hooks reference

| Hook | Purpose | Persistence |
|------|---------|-------------|
| `useMapData(regionId?)` | Fetch + process TopoJSON for a specific region or all. Returns `{ data, loading, error, metroAverages, retry }`. | Memory (per-region cache) |
| `useSelectedNeighborhood()` | Manages selected neighborhood + up to 3 pinned comparisons. | React state (synced to URL) |
| `useTheme()` | Dark/light/system theme via React Context. | `localStorage` |
| `useAuth()` | JWT-based auth state. Returns `{ user, login, signup, logout }`. | httpOnly cookie |
| `useFavorites(userId?)` | Toggle-able list of favorited PNOs. Syncs to server when logged in. | `localStorage` + server |
| `useNotes()` | Free-text notes per neighborhood (5000 char limit). | `localStorage` |
| `useFilterPresets()` | Named sets of filter criteria. | `localStorage` |
| `useRecentNeighborhoods()` | Recently searched neighborhoods (max 10). | `sessionStorage` |
| `useUrlState` | `readInitialUrlState()` reads URL once at startup; `useSyncUrlState()` writes changes via `history.replaceState`. | URL query params |
| `useGridData(layerId)` | Lazy-loads fine-grained grid data (250m cells) when a grid layer is active. Falls back silently if file doesn't exist. | Memory cache |
| `useBottomSheet(opts)` | Touch drag with velocity-based snapping between peek/half/full positions. | React state |
| `useSwipeNavigation()` | Horizontal swipe gesture for mobile panel section navigation. | React state |
| `useAnimatedValue(target)` | Animates numeric values with 300ms ease-out cubic via `requestAnimationFrame`. | React state |

## Code splitting

Heavy components that render conditionally are lazy-loaded via `React.lazy()`:

- `NeighborhoodPanel` — only when a neighborhood is selected
- `ComparisonPanel` — always loaded (comparison bar)
- `RankingTable` — only when ranking view is open
- `FilterPanel` — only when filter view is open
- `CustomQualityPanel` — only when customizing quality weights
- `NeighborhoodWizard` — only when wizard is open
- `SplitMapView` — only in split-map mode
- `AreaSummaryPanel` — only when a freeform polygon is drawn
- `AuthModal` — only when user opens login/signup
- `NeighborhoodProfilePage` — route-level split (only on `/alue/:slug`)

Vendor code is split into separate chunks: `maplibre` and `vendor` (React + React DOM + React Router).

Data is also code-split per region: each region's TopoJSON is a separate Vite asset chunk, loaded on demand via `import.meta.glob`. The combined dataset is only fetched for the "all cities" view.

Turf.js modules are intentionally **not** grouped into a single chunk — each is dynamically imported by different features (`@turf/union` for metro area dissolve, `@turf/bbox` for search, etc.) and Rollup's natural splitting keeps them lazy.

## Authentication & Server (optional)

The backend is fully optional — the app works without it. When available, it provides:

1. **User accounts** — signup/login with username + password (bcrypt, 12 rounds)
2. **Favorites sync** — server-side persistence so favorites survive device/browser changes
3. **Bot protection** — Cloudflare Turnstile on signup

### Auth flow

```
Client                          Server (api.naapurustot.fi)
  │                                  │
  ├─ POST /auth/signup ──────────────► bcrypt hash → INSERT users → JWT
  │  (username, password, turnstile)  │
  ◄── Set-Cookie: token (httpOnly) ──┤
  │                                  │
  ├─ GET /auth/me ───────────────────► Verify JWT from cookie → return user
  │                                  │
  ├─ PUT /auth/favorites ────────────► UPSERT user_favorites
  │  (array of PNOs)                 │
```

- JWT tokens expire after 7 days, stored in httpOnly secure cookies (SameSite=none for cross-origin)
- Rate limiting: 3 signups/IP/day, 10 logins/IP/15min (in-memory buckets)
- The client (`useAuth` hook) checks `/auth/me` on mount to restore sessions
- `useFavorites` merges local and server favorites on login, then debounce-syncs changes

### Database schema

```sql
users (id UUID PK, username UNIQUE, email UNIQUE, password, display_name, trust_level, timestamps)
user_favorites (user_id UUID PK FK→users, favorites JSONB, updated_at)
```

## Build pipeline

```
Vite build
├── TypeScript check (tsc -b)
├── Rollup bundle
│   ├── Manual chunks: maplibre, vendor
│   ├── Assets: never inlined (assetsInlineLimit: 0)
│   └── TopoJSON imported via ?url (emitted as hashed asset)
├── Compression: gzip + Brotli for JS/CSS/HTML/JSON/TopoJSON/SVG
├── PWA manifest + service worker generation
└── Bundle analysis → dist/stats.html
```

## Data pipeline

The Python data pipeline (`scripts/prepare_data.py`) aggregates data from multiple sources:

1. Fetches postal code geometries and Paavo statistics from Statistics Finland
2. Merges pre-computed JSON files for external data (crime, air quality, transit, property prices, etc.)
3. Runs specialized fetch scripts for data that requires API calls (transit reachability, EV charging, tree canopy, voter turnout, etc.)
4. Outputs `public/data/metro_neighborhoods.geojson` (and the app converts it to TopoJSON for smaller bundle size)

```
scripts/prepare_data.py
├── Fetch postal code geometries (Statistics Finland WFS)
├── Fetch Paavo statistics (Statistics Finland PxWeb API)
├── Merge pre-computed JSON files:
│   ├── crime_index.json          air_quality.json
│   ├── transit_stop_density.json property_prices.json
│   ├── school_quality.json       transit_reachability.json
│   ├── tree_canopy.json          voter_turnout.json
│   ├── party_diversity.json      ev_charging.json
│   ├── light_pollution.json      noise_pollution.json
│   └── foreign_language_pct.json historical_trends.json
├── Run API fetch scripts (fetch_*.py) for data not pre-computed
└── Output → public/data/metro_neighborhoods.geojson

npm run build:data
├── geo2topo (GeoJSON → TopoJSON for smaller bundle)
└── build_grid_data.mjs (optional grid datasets)
```

A GitHub Actions workflow (`data-refresh.yml`) runs this pipeline monthly and creates a PR if data changes.

## Routing

```
main.tsx
├── / → App (main map application)
├── /alue/:slug → NeighborhoodProfilePage (Finnish, lazy)
├── /en/area/:slug → NeighborhoodProfilePage (English, lazy)
└── * → NotFoundPage (lazy)
```

Slug format: `{pno}-{slugified-name}` (e.g., `00100-helsinki-keskusta-etu-toolo`). The 5-digit postal code prefix guarantees uniqueness and enables O(1) lookup via `parseSlug()`.

Profile pages are pre-rendered to static HTML at build time by `scripts/prerender.mjs` for SEO. A sitemap is generated by `scripts/generate-sitemap.mjs`.

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Push/PR to main | Lint → type check → test → build → E2E → visual regression → bundle size (160 KB gzip budget) |
| `deploy.yml` | CI success on main | Build + pre-render + sitemap → deploy to GitHub Pages |
| `deploy-server.yml` | Manual | Deploy backend to DigitalOcean droplet |
| `data-refresh.yml` | Monthly cron / manual | Re-run data pipeline, create PR if changed |
| `auto-merge.yml` | `claude/*` branch push | Run CI suite, then auto-merge to main if passing |
| `issue-to-pr.yml` | On issue | Create branch from issue |
