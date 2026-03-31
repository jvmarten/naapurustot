# Architecture

## Overview

naapurustot is a single-page React application that visualizes neighborhood statistics on an interactive map. It has no backend — all data is bundled as static TopoJSON files (one per region) and all computation happens client-side. Data is lazy-loaded per region to keep initial page loads fast.

```
Browser
┌─────────────────────────────────────────────────────┐
│  index.html                                         │
│  ├── main.tsx (entry: ThemeProvider → App)           │
│  ├── App.tsx (top-level state orchestration)         │
│  │   ├── Map.tsx (MapLibre GL)                      │
│  │   ├── LayerSelector / Legend / SearchBar          │
│  │   ├── NeighborhoodPanel (lazy)                   │
│  │   ├── ComparisonPanel / RankingTable (lazy)       │
│  │   ├── FilterPanel / NeighborhoodWizard (lazy)     │
│  │   └── Tooltip / SettingsDropdown / ToolsDropdown  │
│  └── metro_neighborhoods.topojson (static data)      │
└─────────────────────────────────────────────────────┘
```

## Data flow

```
1. Region selection → useMapData loads per-region TopoJSON (lazy, cached)
   - Single region: loads src/data/regions/{regionId}.topojson
   - "All" view: loads combined metro_neighborhoods.topojson (prefetched)
2. TopoJSON → GeoJSON conversion via topojson-client
3. filterSmallIslands() removes tiny island polygons
4. computeQualityIndices() calculates composite scores (mutates feature properties)
5. computeChangeMetrics() derives trend change percentages from history arrays
6. computeQuickWinMetrics() derives demographic ratios from raw Paavo fields
7. computeMetroAverages() produces population-weighted averages for comparison
8. GeoJSON + averages flow down to Map and panel components via props
```

### Key design choice: mutable feature properties

Quality indices, change metrics, and quick-win metrics are computed by **mutating** GeoJSON feature properties in place after loading. This avoids copying the entire feature collection (~160 features × 100+ properties) and means the Map component's GeoJSON source always has the latest values. When custom quality weights change, `computeQualityIndices()` mutates again and a `qualityVersion` counter triggers a MapLibre source refresh.

## State management

There is no external state library. All state lives in `App.tsx` via `useState` / `useCallback` hooks:

| State | Location | Persistence |
|-------|----------|-------------|
| GeoJSON data + metro averages | `useMapData` hook | Fetched once, held in memory |
| Selected neighborhood | `useSelectedNeighborhood` hook | URL query param (`?pno=`) |
| Pinned comparisons (max 3) | `useSelectedNeighborhood` hook | URL query param (`?compare=`) |
| Active layer | `useState` in App | URL query param (`?layer=`) |
| Theme (dark/light/system) | `useTheme` Context | `localStorage` |
| Language (fi/en) | `useState` in App + `i18n.ts` module | `localStorage` |
| Favorites, notes, filter presets | Dedicated hooks | `localStorage` |
| Recent searches | `useRecentNeighborhoods` hook | `sessionStorage` |
| Colorblind mode | Module-level var in `colorScales.ts` | `localStorage` |

URL state is read once at startup (`readInitialUrlState`) and kept in sync via `useSyncUrlState`, which writes to `history.replaceState` on every change.

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
| `useMapData()` | Fetch + process TopoJSON. Returns `{ data, loading, error, metroAverages, retry }`. Eager prefetch at module load time. | Memory |
| `useSelectedNeighborhood()` | Manages selected neighborhood + up to 3 pinned comparisons. | React state (synced to URL) |
| `useTheme()` | Dark/light/system theme via React Context. | `localStorage` |
| `useFavorites()` | Toggle-able list of favorited PNOs. | `localStorage` |
| `useNotes()` | Free-text notes per neighborhood (5000 char limit). | `localStorage` |
| `useFilterPresets()` | Named sets of filter criteria. | `localStorage` |
| `useRecentNeighborhoods()` | Recently searched neighborhoods (max 10). | `sessionStorage` |
| `useUrlState` | `readInitialUrlState()` reads URL once at startup; `useSyncUrlState()` writes changes via `history.replaceState`. | URL query params |
| `useGridData(layerId)` | Lazy-loads fine-grained grid data (250m cells) when a grid layer is active. Falls back silently if file doesn't exist. | Memory cache |
| `useBottomSheet(opts)` | Touch drag with velocity-based snapping between peek/half/full positions. | React state |
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

Vendor code is split into separate chunks: `maplibre` and `vendor` (React + React DOM).

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

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Push/PR to main | Lint → type check → test → build → bundle size check (250 KB gzip budget) |
| `deploy.yml` | Push to main | Build + deploy to GitHub Pages |
| `data-refresh.yml` | Monthly cron / manual | Re-run data pipeline, create PR if changed |
| `auto-merge.yml` | On PR | Auto-merge approved PRs |
| `issue-to-pr.yml` | On issue | Create branch from issue |
| `fix-failures.yml` | On CI failure | Attempt automated fixes |
