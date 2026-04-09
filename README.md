# naapurustot

Interactive map application for exploring neighborhood-level data across the Helsinki metropolitan area. Live at [naapurustot.fi](https://naapurustot.fi).

The frontend is fully static — all data layers run in the browser using pre-built TopoJSON datasets. An optional backend (Express API + PostgreSQL) handles user accounts and favorites sync.

## Features

- **Interactive map** — browse ~160 postal-code neighborhoods with color-coded data layers
- **45+ data layers** — quality index, median income, unemployment, education, population density, transit access, air quality, property prices, housing mix, walkability, school quality, and more
- **Neighborhood profiles** — click any area for detailed statistics compared against metro averages
- **Quality Index** — composite 0–100 score with customizable weights (safety, income, employment, education, transit, services, air quality)
- **Comparison** — pin up to 3 neighborhoods for side-by-side comparison
- **Neighborhood Wizard** — answer preference questions to find matching neighborhoods
- **Ranking table** — sort all neighborhoods by any metric
- **Filter** — set range sliders on multiple metrics to find neighborhoods that match all criteria, with saveable presets
- **Trend charts** — historical income, population, and unemployment data
- **Search** — find neighborhoods by name, postal code, or street address (via Digitransit geocoding)
- **Similar neighborhoods** — Euclidean distance across 10 normalized key metrics
- **Export** — CSV, PDF printable report, and PNG score card
- **Share** — URL state includes selected neighborhood, layer, and pinned comparisons
- **Bilingual** — Finnish (default) and English
- **Multi-region** — Helsinki metro, Turku, Tampere, and 19 other Finnish cities with per-region lazy loading
- **User accounts** — optional sign-up/login for cross-device favorites sync (server-side)
- **Dark / light / system theme**
- **PWA** — installable, works offline via service worker
- **Accessibility** — ARIA live regions, keyboard navigation (Escape closes panels)
- **Colorblind modes** — protanopia, deuteranopia, tritanopia palettes
- **Neighborhood profile pages** — SEO-friendly `/alue/{pno}-{name}` routes with pre-rendered HTML

## Quick start

**Prerequisites:** Node.js 18+ (CI uses Node 22)

```bash
git clone https://github.com/jvmarten/naapurustot.git
cd naapurustot
cp .env.example .env      # defaults work out of the box
npm install
npm run dev               # http://localhost:5173
```

No Python or data pipeline setup is needed for frontend development — the TopoJSON dataset is checked into the repo.

## Project structure

```
src/
├── main.tsx                 # Entry point: React root, router, SW registration, Sentry
├── App.tsx                  # Top-level state orchestration, lazy-loaded panels
├── pages/
│   ├── NeighborhoodProfilePage.tsx  # SEO profile page (/alue/:slug)
│   └── NotFoundPage.tsx             # 404 fallback
├── components/
│   ├── Map.tsx              # MapLibre GL instance, 10 independent useEffect hooks
│   ├── NeighborhoodPanel.tsx # Detail panel (stats, trends, radar, export)
│   ├── SearchBar.tsx        # Address geocoding + neighborhood name search
│   ├── LayerSelector.tsx    # Grouped layer picker (54 layers, 11 categories)
│   ├── Legend.tsx            # Color gradient + min/max values
│   ├── RankingTable.tsx     # Sortable ranking with infinite scroll
│   ├── FilterPanel.tsx      # Multi-criteria filter with range sliders
│   ├── ComparisonPanel.tsx  # Side-by-side stats for pinned neighborhoods
│   ├── NeighborhoodWizard.tsx # 4-step preference-based neighborhood finder
│   ├── CustomQualityPanel.tsx # Quality index weight customization
│   ├── DrawTool.tsx         # Freeform polygon drawing on map
│   ├── AreaSummaryPanel.tsx # Aggregated stats for drawn region
│   ├── SplitMapView.tsx     # Side-by-side dual-map comparison
│   ├── Tooltip.tsx          # Hover tooltip with value vs metro average
│   ├── TooltipOverlay.tsx   # External-store tooltip (avoids App re-renders)
│   ├── AuthModal.tsx        # Signup/login modal (lazy-loaded)
│   ├── UserMenu.tsx         # Profile dropdown with favorites management
│   ├── SettingsDropdown.tsx # Theme, language, colorblind, opacity controls
│   └── ToolsDropdown.tsx    # Filter/ranking/wizard/draw toggle buttons
├── hooks/
│   ├── useMapData.ts        # Fetch + process TopoJSON per region (lazy)
│   ├── useSelectedNeighborhood.ts  # Selected + pinned (max 3)
│   ├── useTheme.tsx         # Dark/light/system theme context
│   ├── useUrlState.ts       # URL ↔ state sync (?pno=, ?layer=, ?compare=, ?city=)
│   ├── useGridData.ts       # Lazy-load fine-grained grid data (250m cells)
│   ├── useAuth.ts           # JWT-based auth state (optional server)
│   ├── useFavorites.ts      # localStorage + server-synced favorites
│   ├── useNotes.ts          # localStorage-backed per-neighborhood notes
│   ├── useFilterPresets.ts  # localStorage-backed named filter presets
│   ├── useRecentNeighborhoods.ts  # sessionStorage-backed recent searches
│   ├── useBottomSheet.ts    # Touch drag with velocity-based snapping
│   ├── useSwipeNavigation.ts # Horizontal swipe for mobile panels
│   └── useAnimatedValue.ts  # requestAnimationFrame numeric transition
├── utils/
│   ├── colorScales.ts       # LayerId union type, 54 layer configs, color expressions
│   ├── metrics.ts           # NeighborhoodProperties interface, metro averages
│   ├── qualityIndex.ts      # Quality index (0–100) from 10 weighted factors
│   ├── similarity.ts        # Euclidean distance for finding similar neighborhoods
│   ├── filterUtils.ts       # Multi-criteria range filtering
│   ├── dataLoader.ts        # Per-region lazy data loading + caching
│   ├── formatting.ts        # Locale-aware number/currency/percentage formatting
│   ├── i18n.ts              # Flat key-value translation system (fi/en)
│   ├── geocode.ts           # Digitransit API geocoding with LRU cache
│   ├── export.ts            # CSV + PDF export
│   ├── scoreCard.ts         # PNG score card via html-to-image (lazy)
│   ├── geometryFilter.ts    # Remove tiny island polygons from MultiPolygons
│   ├── metroAreas.ts        # Dissolve postal polygons into city outlines (@turf/union)
│   ├── regions.ts           # Region config (22 cities, viewports, municipality codes)
│   ├── slug.ts              # URL slug generation for profile pages
│   ├── tooltipStore.ts      # External store for tooltip state (60 Hz perf)
│   ├── api.ts               # API client for auth/favorites server
│   ├── analytics.ts         # Umami event tracking wrapper
│   └── mapConstants.ts      # Default map center/zoom from env vars
├── locales/
│   ├── fi.json              # Finnish translations
│   └── en.json              # English translations
├── data/
│   ├── metro_neighborhoods.topojson  # Combined dataset (all regions)
│   └── regions/*.topojson            # Per-region files (lazy-loaded)
└── __tests__/               # 100+ Vitest test files

scripts/                     # Python data pipeline
├── prepare_data.py          # Main pipeline: fetches, merges, outputs GeoJSON
├── fetch_*.py               # API-specific data fetchers (~20 scripts)
├── *.json                   # Pre-computed intermediate data files
├── validate_data.py         # Post-pipeline data validation
├── audit_data_coverage.py   # Coverage reporting
├── build_region_data.mjs    # Split GeoJSON into per-region TopoJSON files
├── build_grid_data.mjs      # TopoJSON grid generation (250m cells)
├── prerender.mjs            # Pre-render neighborhood profile pages to static HTML
└── generate-sitemap.mjs     # Generate sitemap.xml for SEO

server/                      # Optional backend (DigitalOcean droplet)
├── docker-compose.yml       # Caddy + API + Umami + PostgreSQL
├── api/src/
│   ├── index.ts             # Express server entry point
│   ├── auth.ts              # Signup/login/logout + favorites sync endpoints
│   ├── db.ts                # PostgreSQL connection + schema init
│   ├── rateLimit.ts         # In-memory per-IP rate limiter
│   └── turnstile.ts         # Cloudflare Turnstile bot verification
└── README.md                # Server setup instructions

public/data/
├── metro_neighborhoods.geojson   # Source of truth (~1.3 MB, ~160 neighborhoods)
└── *_grid.{geojson,topojson}     # 250m grid overlays (air quality, light, transit)
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | TypeScript check + production build → `dist/` |
| `npm run preview` | Serve the production build locally (port 4173) |
| `npm run lint` | ESLint |
| `npm run test` | Run Vitest unit tests (jsdom) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests (requires `npm run build` first) |
| `npm run build:data` | Rebuild TopoJSON from GeoJSON (after data pipeline changes) |

## Environment variables

### Frontend (`.env`)

All variables are prefixed with `VITE_` and injected at build time by Vite. Copy `.env.example` to `.env` — the defaults target the Helsinki metro area and work out of the box.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MAP_CENTER_LNG` | `24.94` | Map initial center longitude |
| `VITE_MAP_CENTER_LAT` | `60.17` | Map initial center latitude |
| `VITE_MAP_ZOOM` | `9.2` | Map initial zoom level |
| `VITE_MAP_MIN_ZOOM` | `8` | Minimum allowed zoom |
| `VITE_MAP_MAX_ZOOM` | `16` | Maximum allowed zoom |
| `VITE_BASEMAP_LIGHT_URL` | CARTO light | Raster tile URL for light theme |
| `VITE_BASEMAP_DARK_URL` | CARTO dark | Raster tile URL for dark theme |
| `VITE_SENTRY_DSN` | *(unset)* | Optional — enables Sentry error tracking |
| `VITE_API_URL` | `https://api.naapurustot.fi` | Backend API URL for auth/favorites (optional) |

### Server (`server/.env`)

Only needed if running the backend. Copy `server/.env.example` to `server/.env`.

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | PostgreSQL password for the Umami database |
| `APP_SECRET` | Umami application secret |
| `API_DB_PASSWORD` | PostgreSQL password for the API database |
| `JWT_SECRET` | Secret for signing JWT auth tokens |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key for bot protection |

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | React 19, TypeScript 5.9 (strict mode), React Router 7 |
| Build | Vite 8, Rollup (manual chunks for maplibre + vendor) |
| Map | MapLibre GL JS 5, Turf.js (union, bbox, point-in-polygon), TopoJSON |
| Styling | Tailwind CSS 3 (class-based dark mode) |
| Fonts | Inter (body), Space Grotesk (headings) |
| Testing | Vitest (jsdom, 100+ tests), Playwright (E2E + visual regression) |
| Compression | gzip + Brotli via vite-plugin-compression |
| PWA | vite-plugin-pwa (Workbox service worker, NetworkFirst HTML) |
| Linting | ESLint 9, typescript-eslint, React Hooks rules |
| CI | GitHub Actions (lint → type check → test → build → E2E → visual → bundle size) |
| Backend (optional) | Express 5, PostgreSQL 16, bcrypt, JWT, Cloudflare Turnstile |
| Analytics | Umami (self-hosted, privacy-friendly) |
| Hosting | GitHub Pages (frontend), DigitalOcean droplet + Caddy (backend) |

## Testing

**Unit tests** use Vitest with jsdom. Tests cover utilities (color scales, metrics, quality index, similarity, filtering, formatting, i18n, geocoding), hooks (favorites, URL state), and component rendering. Run with `npm run test`.

**E2E tests** use Playwright against the production build. The CI workflow builds first, then runs Playwright at `http://localhost:4173`. To run locally:

```bash
npm run build
npx playwright install   # first time only
npm run test:e2e
```

## Data sources

All data is pre-processed into `src/data/metro_neighborhoods.topojson` by the Python pipeline in `scripts/`.

| Source | What it provides | License |
|--------|-----------------|---------|
| [Statistics Finland — Paavo (2024)](https://stat.fi/tup/paavo/) | Population, income, employment, education, housing, demographics | CC BY 4.0 |
| [Statistics Finland — PxWeb](https://stat.fi/) | Property prices, rental prices, price changes | CC BY 4.0 |
| [HSL Digitransit API](https://digitransit.fi/en/developers/) | Transit stop density, geocoding | — |
| [HSY Open Data](https://www.hsy.fi/en/air-quality-and-climate/air-quality-now/) | Air quality index, tree canopy (LiDAR) | CC BY 4.0 |
| [OpenStreetMap](https://www.openstreetmap.org/) | Restaurants, grocery stores, healthcare, schools, daycares, cycling infra, EV charging, light pollution | ODbL |
| Police / Poliisi (2023) | Crime index | — |
| [Traficom](https://www.traficom.fi/) | Broadband coverage | — |
| [Väylävirasto](https://vayla.fi/) | Traffic accidents | — |
| [Statistics Finland (kuntavaalit 2025)](https://stat.fi/) | Voter turnout, party diversity | CC BY 4.0 |
| YTL (ylioppilastutkinto 2024) | School quality scores | — |
| OKM (Ministry of Education, 2020) | Foreign-language speaker share | — |
| [NASA VIIRS Black Marble](https://blackmarble.gsfc.nasa.gov/) | Light pollution (VNP46A4 radiance) | — |
| Helsinki meluselvitys / HRI | Noise pollution levels | — |

### Rebuilding the data

The data pipeline is Python-based. You only need this if you're updating the underlying dataset:

```bash
pip install -r requirements.txt
python scripts/prepare_data.py --validate   # fetches + merges all sources → GeoJSON
npm run build:data                          # converts GeoJSON → TopoJSON for the app
```

The pipeline fetches from Statistics Finland, HSL, and other APIs, merges pre-computed JSON files from `scripts/`, and writes `public/data/metro_neighborhoods.geojson`. The `build:data` script then converts this to the TopoJSON file the app actually loads.

A GitHub Actions workflow (`data-refresh.yml`) runs this pipeline on the 1st of each month and creates a PR if data changes.

## Deployment

### Frontend (GitHub Pages)

The app deploys to **GitHub Pages** automatically on push to `main`:

1. CI workflow runs lint, type check, tests, build, E2E, and visual regression
2. Build includes a bundle size check (fails if app JS exceeds 160 KB gzipped, excluding MapLibre)
3. Deploy workflow builds, pre-renders profile pages, generates sitemap, and publishes to GitHub Pages
4. Custom domain `naapurustot.fi` is configured at the DNS level

A bundle analysis report is generated at `dist/stats.html` on every build.

### Backend (DigitalOcean)

The server is optional — the app works fully without it. See [`server/README.md`](server/README.md) for setup.

Services (via `docker compose`):
- **Caddy** — reverse proxy with automatic HTTPS for `api.naapurustot.fi` and `analytics.naapurustot.fi`
- **API** — Express.js auth server (signup, login, favorites sync)
- **Umami** — self-hosted privacy-friendly analytics
- **PostgreSQL** — shared database for Umami and the API

Deploy: `ssh` into the droplet, `cd /opt/naapurustot`, `docker compose pull && docker compose up -d`.

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `App` | Main map application |
| `/alue/:slug` | `NeighborhoodProfilePage` | Finnish neighborhood profile (e.g., `/alue/00100-helsinki-keskusta`) |
| `/en/area/:slug` | `NeighborhoodProfilePage` | English neighborhood profile |
| `*` | `NotFoundPage` | 404 fallback |

Profile pages are pre-rendered to static HTML at build time (`npm run build:pages`) for SEO. The slug format is `{pno}-{slugified-name}` — the postal code prefix enables O(1) lookup.

## URL state

The app encodes state in query parameters for shareable links:

| Param | Example | Description |
|-------|---------|-------------|
| `pno` | `?pno=00100` | Selected neighborhood (5-digit postal code) |
| `layer` | `?layer=median_income` | Active data layer (omitted for default `quality_index`) |
| `compare` | `?compare=00100,02100` | Comma-separated pinned comparison PNOs |
| `city` | `?city=turku` | Active region (omitted for default `helsinki_metro`; use `all` for all cities) |

Legacy `#hash` URLs are automatically migrated to query params.

## Local storage keys

The app persists user preferences in localStorage:

| Key | Purpose |
|-----|---------|
| `lang` | UI language (`fi` or `en`) |
| `naapurustot-theme` | Theme mode (`light`, `dark`, `system`) |
| `naapurustot-colorblind` | Colorblind palette mode |
| `naapurustot-fill-opacity` | Map fill opacity (0–1) |
| `naapurustot-favorites` | Favorited neighborhood PNOs (JSON array) |
| `naapurustot-notes` | User notes per neighborhood (JSON object) |
| `naapurustot-filter-presets` | Saved filter presets (JSON array) |

Recent searches are stored in `sessionStorage` under `naapurustot-recent`.

## Adding a new data layer

1. Add the layer ID to the `LayerId` union type in `src/utils/colorScales.ts`
2. Define the color scale, stops, property name, and formatter in the `LAYERS` array (same file)
3. Add the property to `NeighborhoodProperties` in `src/utils/metrics.ts`
4. Add metric source attribution to `METRIC_SOURCES` (same file)
5. If the metric needs weighted metro averaging, add a `MetricDef` entry to `METRIC_DEFS` (same file)
6. Add Finnish and English labels to `src/locales/fi.json` and `src/locales/en.json`
7. Include the data in the GeoJSON via `scripts/prepare_data.py`, then run `npm run build:data`

If the layer should contribute to the Quality Index, add a `QualityFactor` entry in `src/utils/qualityIndex.ts`.

## CI/CD workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Push/PR to main | Lint → type check → test → build → E2E → visual regression → bundle size (160 KB gzip budget) |
| `deploy.yml` | Push to main / manual | Build + pre-render profile pages + generate sitemap → deploy to GitHub Pages |
| `deploy-server.yml` | Manual | Deploy backend services to DigitalOcean droplet |
| `data-refresh.yml` | Monthly cron / manual | Re-run Python data pipeline, create PR if data changed |
| `auto-merge.yml` | On `claude/*` branch push | Run CI, then auto-merge to main if all checks pass |
| `issue-to-pr.yml` | On issue creation | Create a branch from the issue |

## Further documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture, data flow, map layers, state management
- [`docs/FEATURE_ROADMAP.md`](docs/FEATURE_ROADMAP.md) — planned features and phases

## License

Data is licensed under CC BY 4.0 by Statistics Finland, HSL, and HSY. Map tiles by CARTO, data by OpenStreetMap contributors.
