# Naapurustot.fi — Feature Roadmap

> Generated 2026-03-17 from full codebase analysis.
> Status: **planning only** — nothing here has been implemented yet.

---

## Project Context

Naapurustot.fi is a client-side React/TypeScript SPA that visualizes 51 data layers across ~160 Helsinki metro neighborhoods on an interactive MapLibre GL map. The app already ships:

- 51 choropleth data layers across 7 categories (demographics, economy, housing, services, mobility, health, quality of life)
- Customizable quality index with 8 weighted factors and adjustable sliders
- Neighborhood comparison (pin up to 3), ranking table, multi-criteria filter with dual-thumb sliders
- 4-step neighborhood finder wizard with preference-based scoring
- Similar neighborhood recommendations (Euclidean distance on 12 metrics)
- Radar chart (8-axis) and historical trend charts (income, population, unemployment)
- Saved/favorite neighborhoods via localStorage
- CSV & PDF export, bilingual UI (FI/EN), dark/light themes, colorblind-safe viridis palette
- URL deep linking with copy-to-clipboard, keyboard Escape to dismiss panels
- Dynamic SEO meta tags, ARIA live regions for screen readers
- Shimmer loading skeleton, error banner with retry
- Mobile bottom sheets with drag handles, responsive stacked comparison cards
- Smooth 300ms layer transition animations
- Bitcoin Lightning donation button (BOLT12)
- Vitest unit tests, Brotli/Gzip compression, Netlify deploy workflow

**Tech stack:** React 19, TypeScript 5.9, Vite 8, MapLibre GL 5, Turf.js, Tailwind CSS 3, topojson-client, proj4, qrcode.react.
**Data:** Static TopoJSON (~1.1 MB) with 75 properties per neighborhood, built from Statistics Finland Paavo, HSL, HSY, Police open data, and property price APIs via a Python pipeline (`scripts/prepare_data.py`).

### Data Granularity Requirement

We want the lowest-level data possible. The minimum acceptable granularity is **postal code level**, but whenever a data source offers finer resolution (e.g., 250 m × 250 m grid cells, building-level, block-level, or coordinate-level data), prefer and integrate that instead.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Legend Intermediate Tick Labels

| | |
|---|---|
| **What** | Show 3–5 numeric stop values (e.g., "20k €", "5%", "50") along the legend gradient bar instead of only the first and last values. Use `layer.stops` and `layer.format` already available in `getLayerById()`. |
| **Why** | The legend currently shows only two endpoint values. Users can't judge what numeric value a mid-range color represents without hovering individual neighborhoods. Adding 3 evenly-spaced ticks makes the scale self-explanatory. |
| **Touches** | `src/components/Legend.tsx` (change `tickIndices` from `[0, n-1]` to include midpoints) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Empty State & No-Data Indicators

| | |
|---|---|
| **What** | When a neighborhood has `null` or missing data for the active layer, show "No data" in the tooltip and detail panel instead of blank/zero. Use a distinct hatched SVG pattern on the map polygon for neighborhoods with null values. |
| **Why** | Some neighborhoods have missing values for certain layers (e.g., crime, energy efficiency, school quality). Currently these render as blank or zero with no explanation — misleading for users making decisions. |
| **Touches** | `src/components/Tooltip.tsx` (null check + label), `src/components/NeighborhoodPanel.tsx` (null display), `src/components/Map.tsx` (add fill-pattern for null features), `src/utils/colorScales.ts` (null-aware expression) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Comparison URL Sharing

| | |
|---|---|
| **What** | Encode pinned neighborhood PNOs in the URL hash (e.g., `#pno=00100&layer=median_income&compare=00200,00300`). When the URL is loaded, automatically pin those neighborhoods and show the comparison panel. |
| **Why** | Users can share a single neighborhood via URL, but not a comparison view. Real estate agents and researchers comparing areas must ask others to manually pin the same neighborhoods. |
| **Touches** | `src/hooks/useUrlState.ts` (read/write `compare` param), `src/App.tsx` (restore pinned from URL on load) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Map Print / Screenshot Mode

| | |
|---|---|
| **What** | A "Print" button (in ToolsDropdown or SettingsDropdown) that hides all overlays, renders the current map view + legend into a clean layout via `@media print` CSS, and calls `window.print()`. |
| **Why** | Researchers, students, and real estate professionals want to include map screenshots in reports. Currently they must manually screenshot and crop UI elements. |
| **Touches** | `src/index.css` (print media queries to hide panels/controls, show only map + legend), `src/components/ToolsDropdown.tsx` (print button) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Onboarding Tour for First-Time Visitors

| | |
|---|---|
| **What** | A 4-step highlight overlay shown once on first visit (tracked via localStorage). Steps: (1) layer selector, (2) search bar, (3) click to explore, (4) filter/compare features. Each step has a tooltip with "Next"/"Got it" buttons. |
| **Why** | New users may never discover the layer selector, comparison mode, wizard, or filter panel. A brief tour dramatically improves feature discovery without permanently cluttering the UI. |
| **Touches** | New component `src/components/OnboardingTour.tsx`, `src/App.tsx` (first-visit state + render) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Address / Coordinate Search (Geocoding)

| | |
|---|---|
| **What** | Extend SearchBar to accept street addresses (e.g., "Mannerheimintie 5") in addition to neighborhood names. Use a free geocoding API (Digitransit/HSL or Nominatim) to resolve addresses to coordinates, then identify which neighborhood polygon contains the point using Turf.js `booleanPointInPolygon`. |
| **Why** | Most people know their address, not their postal code area name. "Which neighborhood is Mannerheimintie 5 in?" is the #1 entry point for house-hunters but currently impossible without external lookup. |
| **Touches** | `src/components/SearchBar.tsx` (address input mode, geocoding API call), `src/utils/geometryFilter.ts` or new `src/utils/geocode.ts` (point-in-polygon lookup) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires API key for Digitransit geocoding, or use Nominatim which is keyless but rate-limited) |

### CF-2 Shareable Neighborhood Score Card (Image)

| | |
|---|---|
| **What** | Generate a shareable PNG image summarizing a neighborhood's key stats — quality index badge, top 5 metrics, mini radar chart, and naapurustot.fi branding. Use `<canvas>` rendering (no external dependency needed) or a lightweight library like `html-to-image`. Downloadable via a "Share as image" button. |
| **Why** | Users sharing on WhatsApp, Instagram, or Twitter want a visual snapshot, not a URL. This drives organic traffic and is especially valuable for real estate agents sharing neighborhood profiles with clients. |
| **Touches** | New utility `src/utils/scoreCard.ts` (canvas rendering logic), `src/components/NeighborhoodPanel.tsx` (share-image button), `package.json` (optional `html-to-image` dep) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Dual-Layer / Split Map View

| | |
|---|---|
| **What** | A "Compare layers" mode that splits the map into two side-by-side views, each showing a different data layer for the same area. Synchronized pan/zoom between the two maps. Toggle via ToolsDropdown. |
| **Why** | Users often want to correlate two metrics visually — e.g., "where is income high but transit poor?" The filter panel answers this numerically, but a visual side-by-side is far more intuitive for spatial patterns. |
| **Touches** | New component `src/components/SplitMapView.tsx`, `src/components/Map.tsx` (refactor to accept layer prop externally), `src/App.tsx` (split mode state), `src/components/LayerSelector.tsx` (second layer picker) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Neighborhood Change Over Time ("What Changed")

| | |
|---|---|
| **What** | Add a "Trends" layer category that shows year-over-year percentage change for key metrics (income growth, population change, unemployment delta). Extend `prepare_data.py` to compute deltas from the existing `*_history` arrays. Color scale: green for positive change, red for negative (or inverted for unemployment). |
| **Why** | Static snapshots don't tell users whether a neighborhood is improving or declining. "This area's income grew 15% in 3 years" is more actionable than "median income is €35k". The trend data infrastructure (`*_history` arrays, `TrendChart.tsx`, `parseTrendSeries()`) already exists. |
| **Touches** | `scripts/prepare_data.py` (compute `*_change_pct` fields), `src/utils/colorScales.ts` (new change layers), `src/utils/metrics.ts` (new properties), `src/locales/*.json` (labels) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Point-of-Interest Overlay Layer

| | |
|---|---|
| **What** | Toggle-able map markers showing real POI locations: schools, daycares, grocery stores, healthcare facilities, transit stops. Data sourced from OpenStreetMap via Overpass API or HSL/HSY open data. Clustered at low zoom, individual pins at high zoom. |
| **Why** | The current density metrics (e.g., `school_density`, `grocery_density`) are abstract numbers. Showing actual locations on the map lets users see *where* services are relative to specific streets, not just that "this postal code has 3.2 schools per km²". |
| **Touches** | New `src/components/POILayer.tsx`, `src/components/Map.tsx` (additional source + layers), `scripts/prepare_data.py` or separate `scripts/fetch_pois.py` (POI data extraction), new `public/data/pois.geojson` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Overpass API queries or HSL API access; POI data must be fetched and cached) |

### CF-6 Multi-Year Time-Series Data Expansion

| | |
|---|---|
| **What** | Extend `prepare_data.py` to fetch Paavo data for 2019–2024 (currently limited coverage), compute comprehensive year-over-year deltas, and ensure all `*_history` arrays are fully populated. The existing `TrendChart.tsx` and `parseTrendSeries()` already handle rendering. |
| **Why** | The TrendChart component and history data schema exist but may have gaps in historical coverage. Full 5-year data turns static snapshots into dynamic narratives — "this area has been gentrifying for 5 years" or "unemployment has been falling steadily." |
| **Touches** | `scripts/prepare_data.py` (multi-year fetch loop, historical Paavo WFS queries), `src/utils/metrics.ts` (ensure parsing handles all years) |
| **Complexity** | Large |
| **Dependencies** | Requires verifying Statistics Finland WFS endpoint availability for each historical year. |
| **Tag** | Manual Setup |

---

## 3 — Polish

UX improvements, animations, better feedback, edge case handling.

### PO-1 Animated Number Transitions

| | |
|---|---|
| **What** | When switching neighborhoods or layers, animate numeric values in the detail panel (quality index score, stat values) with a brief count-up/count-down transition (~300ms). Use `requestAnimationFrame` — no library needed. |
| **Why** | Currently, all values snap instantly when switching neighborhoods. Animated transitions make the app feel responsive and alive, drawing attention to what changed. This is a standard practice in data dashboards. |
| **Touches** | New hook `src/hooks/useAnimatedValue.ts`, `src/components/NeighborhoodPanel.tsx` (wrap key numeric displays) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Keyboard Navigation for Layer Selector

| | |
|---|---|
| **What** | Add full keyboard navigation to LayerSelector: arrow keys to move between layers, Enter to select, Tab to move between groups, Escape to close. Add `role="listbox"` and `aria-selected` attributes. |
| **Why** | The layer selector is mouse/touch-only. Power users and accessibility-dependent users cannot navigate the 51-layer list via keyboard. This blocks WCAG 2.1 AA compliance. |
| **Touches** | `src/components/LayerSelector.tsx` (keydown handlers, ARIA roles, focus management) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Tooltip Enhancement: Mini Comparison

| | |
|---|---|
| **What** | Expand the hover tooltip to show a small bar or arrow indicating how the hovered neighborhood compares to the metro average for the active layer (e.g., "▲ 12% above avg"). Use existing `metroAverages` data. |
| **Why** | The current tooltip shows only name + raw value. Without context, users can't tell if "€32,000 income" is good or bad. A quick comparison indicator makes hovering over the map far more informative without needing to click. |
| **Touches** | `src/components/Tooltip.tsx` (add metro average prop and comparison display), `src/App.tsx` (pass metroAverages to Tooltip) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Wizard Results: "Show on Map" Mode

| | |
|---|---|
| **What** | After the wizard shows its top 5 results, add a "Show on map" button that closes the wizard and highlights those 5 neighborhoods on the map (similar to filter highlighting with green borders and dimmed non-matches). |
| **Why** | The wizard currently shows results in a modal overlay. Users must manually remember neighborhood names and find them on the map. Bridging wizard results directly to the map view completes the user flow. |
| **Touches** | `src/components/NeighborhoodWizard.tsx` (emit result PNOs), `src/App.tsx` (wizard results highlighting state), `src/components/Map.tsx` (wizard highlight layer, reuse filter dimming logic) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Filter Presets

| | |
|---|---|
| **What** | Add 3–4 preset filter configurations to FilterPanel: "Best for families" (child_ratio, school_quality, daycare_density, green_space), "Best for commuters" (transit_stop_density, commute_time, cycling_infra), "Most affordable" (property_price, rental_price, unemployment inverted). One-click to load preset criteria. |
| **Why** | The filter panel is powerful but intimidating — users must know which of 51 layers matter and what ranges are "good." Presets provide instant value for common use cases while teaching users how filtering works. |
| **Touches** | `src/components/FilterPanel.tsx` (preset buttons + predefined filter configs) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Mobile Bottom Sheet Improvements

| | |
|---|---|
| **What** | Unify the bottom sheet behavior across NeighborhoodPanel, LayerSelector, FilterPanel, and CustomQualityPanel into a shared hook or component. Add velocity-based snap (swipe up fast = full screen, slow = half), proper body scroll locking, and a semi-transparent backdrop that dims the map. |
| **Why** | Each panel currently reimplements its own touch drag logic with slightly different snap points and behavior. This creates inconsistency on mobile and makes maintenance harder. A shared abstraction also enables future panels to get mobile support for free. |
| **Touches** | New `src/hooks/useBottomSheet.ts` or `src/components/BottomSheet.tsx`, refactor all bottom-sheet panels to use it |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 CI Pipeline (Lint + Type-Check + Test)

| | |
|---|---|
| **What** | Add a GitHub Actions workflow that runs `eslint`, `tsc --noEmit`, and `vitest run` on every push and PR. Block merges on failure. The current `auto-merge.yml` merges everything with no quality gate. |
| **Why** | Broken code or type errors can ship immediately to production. A CI pipeline catches regressions before they reach users and gives confidence for parallel development. |
| **Touches** | New `.github/workflows/ci.yml`, `package.json` (ensure `lint` script exists, add `typecheck` script) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 End-to-End Tests with Playwright

| | |
|---|---|
| **What** | Add Playwright tests for critical user flows: load app → select neighborhood → view panel → switch layer → use search → pin & compare → export CSV → use filter → use wizard. Run in CI on each PR. |
| **Why** | Unit tests cover utility logic (colorScales, formatting, qualityIndex, metrics, geometryFilter) but not UI integration. Map interactions, panel rendering, and bottom sheet behavior are untested. Regressions in these areas go undetected. |
| **Touches** | New `e2e/` directory, `playwright.config.ts`, `package.json` (devDeps + script), `.github/workflows/ci.yml` (E2E step) |
| **Complexity** | Medium |
| **Dependencies** | IN-1 (CI pipeline should exist) |
| **Tag** | Claude Code |

### IN-3 Performance Budget & Bundle Analysis

| | |
|---|---|
| **What** | Add `rollup-plugin-visualizer` to Vite for bundle size reports. Set a CI check that fails if the JS bundle exceeds 250 KB gzipped or TopoJSON exceeds 400 KB brotli. Output a bundle size comment on each PR. |
| **Why** | The app loads a ~1.1 MB TopoJSON + JS bundle. Without a budget, new features and dependencies silently bloat the payload. Especially important as more layers, POIs, and history data are added. |
| **Touches** | `vite.config.ts` (visualizer plugin), `.github/workflows/ci.yml` (size check step), `package.json` (devDep) |
| **Complexity** | Small |
| **Dependencies** | IN-1 (CI must exist) |
| **Tag** | Claude Code |

### IN-4 Data Pipeline: Automated Monthly Refresh

| | |
|---|---|
| **What** | Add a GitHub Actions scheduled workflow (monthly cron) that runs `prepare_data.py`, validates output against a JSON schema, and opens a PR if data changed — with a diff summary (which metrics changed, by how much) in the PR body. |
| **Why** | The data pipeline is manual — someone must run the Python script locally and commit. Statistics Finland updates Paavo annually; property prices update quarterly; transit data changes with route updates. Stale data undermines user trust. |
| **Touches** | New `.github/workflows/data-refresh.yml`, `scripts/prepare_data.py` (add `--validate` flag, JSON schema), `requirements.txt` (pin deps) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires GitHub Actions secrets for authenticated APIs, Python environment setup in CI) |

### IN-5 Error Tracking & Privacy-Respecting Analytics

| | |
|---|---|
| **What** | Integrate Sentry for error tracking (catch runtime errors, map rendering failures, data load issues) and Plausible or Umami for privacy-respecting usage analytics (page views, most-used layers, feature usage). |
| **Why** | No visibility into production errors or usage patterns. Can't tell which layers are popular, whether users find the wizard, or if mobile users hit rendering bugs. Data-driven prioritization is currently impossible. |
| **Touches** | `src/main.tsx` (Sentry init), `index.html` (analytics script), `package.json` (Sentry SDK) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Sentry DSN creation and analytics account setup) |

### IN-6 Service Worker & Offline Support

| | |
|---|---|
| **What** | Add a service worker (via `vite-plugin-pwa` or manual `workbox`) that caches the app shell, TopoJSON data, and map tiles for offline use. Show a "You're offline — using cached data" indicator when network is unavailable. |
| **Why** | The app is fully static and could work offline, but doesn't. Users on trains (common in Helsinki metro commutes) lose access. Caching the 1.1 MB TopoJSON after first load also speeds up repeat visits significantly. |
| **Touches** | `vite.config.ts` (PWA plugin), new `src/sw.ts` or generated service worker, `src/App.tsx` (offline indicator), `index.html` (manifest link) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-7 React Error Boundaries

| | |
|---|---|
| **What** | Add React error boundaries around the Map, NeighborhoodPanel, and FilterPanel components. On crash, show a friendly fallback UI with a "Reload" button instead of a blank screen. Log errors to console (or Sentry if IN-5 is done). |
| **Why** | No error boundaries exist. A rendering error in any component (e.g., unexpected null property, MapLibre GL crash) white-screens the entire app with no recovery path. |
| **Touches** | New `src/components/ErrorBoundary.tsx`, `src/App.tsx` (wrap key sections) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-8 Unit Test Coverage Expansion

| | |
|---|---|
| **What** | Expand Vitest test suite to cover: `similarity.ts` (distance calculation edge cases), `qualityIndex.ts` (custom weight combinations, edge cases with all-null data), `export.ts` (CSV generation), `useUrlState.ts` (URL parsing), `useFavorites.ts` (localStorage operations). Current tests cover colorScales, formatting, metrics, geometryFilter, and basic components. |
| **Why** | Test coverage has gaps in critical business logic — similarity scoring, quality index calculation, and data export. These are the features users depend on most for making real decisions. |
| **Touches** | New test files in `src/__tests__/` (similarity.test.ts, export.test.ts, urlState.test.ts, favorites.test.ts), expand existing qualityIndex.test.ts |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Items within each batch can be safely developed as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order optimizes for: unblocking future work first, then high-impact user features, then polish.

### Batch 1 — Infrastructure Foundation & Independent Quick Wins

No dependencies. All items touch different files with zero merge conflict risk.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-1 CI Pipeline | Infrastructure | Small | Claude Code |
| IN-7 React Error Boundaries | Infrastructure | Small | Claude Code |
| IN-8 Unit Test Coverage Expansion | Infrastructure | Small | Claude Code |
| QW-1 Legend Intermediate Ticks | Quick Win | Small | Claude Code |
| QW-2 Empty State & No-Data | Quick Win | Small | Claude Code |
| QW-3 Comparison URL Sharing | Quick Win | Small | Claude Code |
| QW-4 Map Print Mode | Quick Win | Small | Claude Code |
| QW-5 Onboarding Tour | Quick Win | Small | Claude Code |

> **Why first:** CI (IN-1) gates all future PRs. Error boundaries (IN-7) prevent white-screens. Test expansion (IN-8) catches regressions. Quick wins are independent, small, and touch different files — zero conflict risk. Each session modifies at most 2–3 files with no overlap.

### Batch 2 — Core UX Features & CI Extensions

Depends on Batch 1 for CI pipeline. Feature items are independent of each other.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-3 Performance Budget | Infrastructure | Small | Claude Code |
| IN-6 Service Worker & Offline | Infrastructure | Medium | Claude Code |
| CF-2 Shareable Score Card | Core Feature | Medium | Claude Code |
| CF-4 Neighborhood Change Over Time | Core Feature | Medium | Claude Code |
| PO-1 Animated Number Transitions | Polish | Small | Claude Code |
| PO-3 Tooltip Mini Comparison | Polish | Small | Claude Code |
| PO-5 Filter Presets | Polish | Small | Claude Code |

> **Why second:** Performance budget depends on CI. The three core/polish features add new files/hooks without overlapping — CF-2 adds a utility, CF-4 touches colorScales (new layers only), PO-1 adds a hook, PO-3 modifies Tooltip only, PO-5 modifies FilterPanel only.

### Batch 3 — Polish, Mobile, & Advanced Features

Depends on Batch 2 for stable feature set. Items are independent of each other.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-1 Address / Coordinate Search | Core Feature | Medium | Manual Setup |
| CF-3 Dual-Layer / Split Map View | Core Feature | Large | Claude Code |
| PO-2 Keyboard Navigation for Layers | Polish | Small | Claude Code |
| PO-4 Wizard Results "Show on Map" | Polish | Small | Claude Code |
| PO-6 Mobile Bottom Sheet Unification | Polish | Medium | Claude Code |

> **Why third:** Address search needs API key setup. Split map is the largest feature — best done once the Map component is stable from earlier batches. Bottom sheet unification is a refactor best done after all panels exist. Wizard "Show on Map" builds on the filter highlighting pattern established in Batch 1's empty state work.

### Batch 4 — E2E Tests, Analytics & Data Pipeline

Depends on stable feature set from Batches 1–3. External service setup required for some items.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-2 E2E Tests (Playwright) | Infrastructure | Medium | Claude Code |
| IN-4 Data Pipeline Auto-Refresh | Infrastructure | Medium | Manual Setup |
| IN-5 Error Tracking & Analytics | Infrastructure | Small | Manual Setup |
| CF-5 POI Overlay Layer | Core Feature | Large | Manual Setup |
| CF-6 Multi-Year Time-Series Expansion | Core Feature | Large | Manual Setup |

> **Why last:** E2E tests benefit from a complete, stable feature set. Analytics and error tracking require account creation. POI overlay and multi-year data both need external API access and data pipeline work — highest effort with most external dependencies. Running E2E tests after all features are built maximizes coverage from a single test suite.
