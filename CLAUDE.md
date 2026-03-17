# CLAUDE.md

## Project overview

Naapurustot is a static React + TypeScript map application for exploring neighborhood-level data across the Helsinki metropolitan area. Live at naapurustot.fi. No backend — everything runs in the browser using a pre-built GeoJSON dataset.

## Commands

```bash
npm run dev        # Start dev server (Vite, port 5173)
npm run build      # TypeScript check + production build → dist/
npm run test       # Run tests (Vitest, jsdom)
npm run lint       # ESLint
```

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

## Code style

- TypeScript strict mode
- ESLint with typescript-eslint and React Hooks rules
- Functional components with hooks (no class components)
- Tailwind utility classes for styling
