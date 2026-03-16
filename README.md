# Naapurustot

Interactive map application for exploring demographic, economic, housing, and quality-of-life data across Helsinki metropolitan area neighborhoods.

Live at [naapurustot.fi](https://naapurustot.fi)

## Features

- **Interactive map** — browse ~100 postal-code neighborhoods with color-coded data layers
- **18 data layers** — quality index, median income, unemployment, education, population density, transit access, air quality, property prices, housing mix, and more
- **Neighborhood profiles** — click any area for detailed statistics compared against metro averages
- **Quality Index** — composite 0–100 score based on income (35%), low unemployment (35%), and higher education (30%)
- **Search** — find neighborhoods by name or postal code
- **Bilingual** — Finnish and English
- **Dark / light theme**

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | React 19, TypeScript 5.9 |
| Build | Vite 8 |
| Map | MapLibre GL JS, Turf.js, proj4 |
| Styling | Tailwind CSS 3 |
| Linting | ESLint 9, typescript-eslint |

No backend — the app runs entirely in the browser using a static GeoJSON dataset.

## Getting started

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # TypeScript check + production bundle → dist/
npm run preview    # Serve the production build locally
npm run lint       # ESLint
```

## Data sources

All data is pre-processed into `public/data/metro_neighborhoods.geojson` by the Python script in `scripts/prepare_data.py`.

| Source | What it provides | License |
|--------|-----------------|---------|
| [Statistics Finland — Paavo (2024)](https://stat.fi/tup/paavo/) | Population, income, employment, education, housing | CC BY 4.0 |
| [HSL Digitransit API](https://digitransit.fi/en/developers/) | Transit stop density | — |
| [HSY Open Data](https://www.hsy.fi/en/air-quality-and-climate/air-quality-now/) | Air quality index | CC BY 4.0 |
| [Statistics Finland — Property prices](https://stat.fi/) | Apartment price per m² | CC BY 4.0 |
| OKM (Ministry of Education, 2020) | Foreign-language speaker share | — |

To rebuild the data file:

```bash
cd scripts
python3 prepare_data.py
```

## Architecture

```
src/
├── App.tsx                        # Top-level state & layout
├── components/
│   ├── Map.tsx                    # MapLibre GL map & interactions
│   ├── NeighborhoodPanel.tsx      # Detail stats panel
│   ├── LayerSelector.tsx          # Data layer picker
│   ├── Legend.tsx                  # Color scale legend
│   ├── SearchBar.tsx              # Autocomplete search
│   ├── Tooltip.tsx                # Hover tooltip
│   └── ThemeToggle.tsx            # Dark/light switch
├── hooks/
│   ├── useMapData.ts              # Fetch & process GeoJSON
│   ├── useTheme.tsx               # Theme context
│   └── useSelectedNeighborhood.ts # Selection state
└── utils/
    ├── colorScales.ts             # Layer definitions & color stops
    ├── metrics.ts                 # Data interfaces & metro averages
    ├── qualityIndex.ts            # Composite score calculation
    ├── i18n.ts                    # Translations (fi/en)
    ├── formatting.ts              # Number & currency formatting
    └── geometryFilter.ts          # Small-island cleanup

public/data/
└── metro_neighborhoods.geojson    # Static dataset (~1.1 MB)

scripts/
├── prepare_data.py                # Data pipeline
└── foreign_language_pct.json      # Pre-computed language data
```

State is managed with React hooks and Context (theme only) — no external state library.

## License

Data is licensed under CC BY 4.0 by Statistics Finland, HSL, and HSY.
