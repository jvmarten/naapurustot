# naapurustot

Interactive map application for exploring neighborhood-level data across the Helsinki metropolitan area. Live at [naapurustot.fi](https://naapurustot.fi).

No backend — everything runs in the browser using a pre-built TopoJSON dataset.

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
- **Dark / light / system theme**
- **PWA** — installable, works offline via service worker
- **Accessibility** — ARIA live regions, keyboard navigation (Escape closes panels)
- **Colorblind modes** — protanopia, deuteranopia, tritanopia palettes

## Quick start

**Prerequisites:** Node.js 18+ (CI uses Node 22)

```bash
git clone https://github.com/jvmarten/naapurustot.git
cd naapurustot
cp .env.example .env      # defaults work out of the box
npm install
npm run dev               # http://localhost:5173
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | TypeScript check + production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run test` | Run Vitest unit tests (jsdom) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |

## Environment variables

All variables are prefixed with `VITE_` and injected at build time by Vite. Copy `.env.example` to `.env` — the defaults target the Helsinki metro area.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MAP_CENTER_LNG` | `24.94` | Map initial center longitude |
| `VITE_MAP_CENTER_LAT` | `60.17` | Map initial center latitude |
| `VITE_MAP_ZOOM` | `10.5` | Map initial zoom level |
| `VITE_MAP_MIN_ZOOM` | `8` | Minimum allowed zoom |
| `VITE_MAP_MAX_ZOOM` | `16` | Maximum allowed zoom |
| `VITE_BASEMAP_LIGHT_URL` | CARTO light | Raster tile URL for light theme |
| `VITE_BASEMAP_DARK_URL` | CARTO dark | Raster tile URL for dark theme |
| `VITE_SENTRY_DSN` | *(unset)* | Optional — enables Sentry error tracking |

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | React 19, TypeScript 5.9 (strict mode) |
| Build | Vite 8, Rollup (manual chunks for maplibre + vendor) |
| Map | MapLibre GL JS, Turf.js (bbox, point-in-polygon), TopJSON |
| Styling | Tailwind CSS 3 (class-based dark mode) |
| Fonts | Inter (body), Space Grotesk (headings) |
| Testing | Vitest (jsdom), Playwright (e2e) |
| Compression | gzip + Brotli via vite-plugin-compression |
| PWA | vite-plugin-pwa (Workbox service worker) |
| Linting | ESLint 9, typescript-eslint, React Hooks rules |
| CI | GitHub Actions (lint → type check → test → build → bundle size check) |

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

### Rebuilding the data

```bash
pip install -r requirements.txt
python scripts/prepare_data.py --validate
```

The data refresh runs automatically via GitHub Actions on the 1st of each month. If data changes, it creates a PR for review.

## Deployment

The app deploys to **GitHub Pages** automatically on push to `main`:

1. CI workflow runs lint, type check, tests, and build
2. Build includes a bundle size check (fails if JS exceeds 250 KB gzipped)
3. Deploy workflow builds and publishes to GitHub Pages
4. Custom domain `naapurustot.fi` is configured at the DNS level

A bundle analysis report is generated at `dist/stats.html` on every build.

## URL state

The app encodes state in query parameters for shareable links:

| Param | Example | Description |
|-------|---------|-------------|
| `pno` | `?pno=00100` | Selected neighborhood (5-digit postal code) |
| `layer` | `?layer=median_income` | Active data layer (omitted for default `quality_index`) |
| `compare` | `?compare=00100,02100` | Comma-separated pinned comparison PNOs |

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
7. Include the data in the TopoJSON file via `scripts/prepare_data.py`

## License

Data is licensed under CC BY 4.0 by Statistics Finland, HSL, and HSY. Map tiles by CARTO, data by OpenStreetMap contributors.
