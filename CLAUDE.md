# CLAUDE.md

## Project overview

naapurustot is a static React + TypeScript map application for exploring neighborhood-level data across the Helsinki metropolitan area. Live at naapurustot.fi. No backend — everything runs in the browser using a pre-built GeoJSON dataset.

## Commands

```bash
npm run dev        # Start dev server (Vite, port 5173)
npm run build      # TypeScript check + production build → dist/
npm run test       # Run tests (Vitest, jsdom)
npm run test:watch # Vitest in watch mode
npm run test:e2e   # Playwright end-to-end tests
npm run lint       # ESLint
npm run preview    # Serve production build locally
```

## Further docs

- `docs/ARCHITECTURE.md` — system architecture, data flow, map layers, CI/CD
- `docs/FEATURE_ROADMAP.md` — planned features and phases

## Architecture

- **Framework:** React 19, TypeScript 5.9, Vite 8
- **Map:** MapLibre GL JS with Turf.js for geospatial calculations, proj4 for coordinate transforms
- **Styling:** Tailwind CSS 3
- **State:** React hooks + Context (theme only). No external state library.
- **i18n:** Finnish (default) and English. Translations live in `src/locales/fi.json` and `src/locales/en.json`. Use `t('key')` from `src/utils/i18n.ts`.

### Key directories

- `src/components/` — React components (Map, NeighborhoodPanel, LayerSelector, Legend, SearchBar, etc.)
- `src/hooks/` — Custom hooks (useMapData, useTheme, useSelectedNeighborhood)
- `src/utils/` — Data layers (`colorScales.ts`), metric definitions (`metrics.ts`), quality index calculation, formatting, i18n, geometry filtering
- `src/locales/` — Translation JSON files (fi.json, en.json)
- `src/__tests__/` — Vitest tests (jsdom environment)
- `public/data/metro_neighborhoods.geojson` — Static dataset (~1.1 MB)
- `scripts/prepare_data.py` — Python data pipeline that rebuilds the GeoJSON

### Adding a new data layer

1. Add the `LayerId` to the union type in `src/utils/colorScales.ts`
2. Define color scale and stops in the same file
3. Add metric metadata in `src/utils/metrics.ts`
4. Add Finnish and English labels to both `src/locales/fi.json` and `src/locales/en.json`
5. Include the data in `public/data/metro_neighborhoods.geojson` (via `scripts/prepare_data.py`)

## Data integrity

**All data must come from real, verifiable sources.** Never generate, fabricate, or use placeholder/fake data — not in the GeoJSON dataset, not in the data pipeline, and not as temporary stand-ins. If real data is not yet available for a metric or area, leave it out entirely rather than filling in synthetic values. Every value shown on the map must trace back to an actual data source (e.g., Statistics Finland, HSL, Helsinki Region Infoshare, OpenStreetMap).

## Data granularity

We want the lowest-level data possible. The minimum acceptable granularity is **postal code level**, but whenever a data source offers finer resolution (e.g., 250 m × 250 m grid cells, building-level, block-level, or coordinate-level data), prefer and integrate that instead. When evaluating new data sources or extending existing ones, always check whether a sub-postal-code breakdown is available.

## Code style

- TypeScript strict mode
- ESLint with typescript-eslint and React Hooks rules
- Functional components with hooks (no class components)
- Tailwind utility classes for styling
