# naapurustot.fi — Feature Roadmap

> Generated 2026-03-18 from full codebase analysis.
> Status: **planning only** — nothing here has been implemented yet.

---

## Project Context

naapurustot.fi is a client-side React/TypeScript SPA that visualizes 54 data layers (including 3 trend/change layers) across ~160 Helsinki metro neighborhoods on an interactive MapLibre GL map. The app ships a substantial feature set:

**Visualization:** 54 choropleth layers across 8 categories (quality of life, trends, demographics, economy, housing, services, mobility, health). Colorblind-safe viridis palette. Smooth 300ms layer transitions. Print mode with `@media print` CSS.

**Analysis tools:** Customizable quality index (16 weighted factors, adjustable sliders). Multi-criteria filter with dual-thumb sliders and 4 presets (families, commuters, affordable, premium). Ranking table. 4-step neighborhood finder wizard with preference-based scoring and "Show on Map" highlighting. Similar neighborhood recommendations (Euclidean distance on 12 metrics). Radar chart (8-axis) and historical trend charts (income, population, unemployment). Comparison panel (pin up to 3).

**UX:** Bilingual FI/EN, dark/light theme, URL deep linking with comparison sharing, search by name/PNO, keyboard navigation in layer selector, CSV & PDF export, saved favorites via localStorage, tooltip with metro average comparison (arrow + % diff), Escape to dismiss panels, dynamic SEO meta tags, ARIA live regions.

**Infrastructure:** CI pipeline (lint + typecheck + test + build + bundle size budget), Playwright E2E skeleton (5 tests), PWA with service worker (Workbox, map tile caching, offline indicator), Brotli/Gzip compression, rollup-plugin-visualizer, Netlify deploy, ErrorBoundary wrappers, Vitest unit tests (colorScales, formatting, metrics, geometryFilter, qualityIndex, export, urlState, similarity, favorites).

**Unused/unwired code:** `SplitMapView.tsx` exists but is not rendered in `App.tsx`. `useAnimatedValue.ts` hook exists but no component imports it. `useBottomSheet.ts` hook exists but panels use custom drag logic.

**Tech stack:** React 19, TypeScript 5.9, Vite 8, MapLibre GL 5, Turf.js, Tailwind CSS 3, topojson-client, proj4, qrcode.react.

**Data:** Static TopoJSON (~1.1 MB) with 75+ properties per neighborhood, built from Statistics Finland Paavo, HSL, HSY, Police, Kela, THL, Tax Administration, and OpenStreetMap data via a Python pipeline (`scripts/prepare_data.py`).

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Legend Intermediate Tick Labels

| | |
|---|---|
| **What** | Show 3–5 evenly-spaced numeric stop values along the legend gradient bar instead of only the first and last values. Currently `Legend.tsx` hardcodes `tickIndices = [0, n - 1]`. Change to include 2–3 midpoints (e.g., indices 0, 2, 4, 7 for an 8-stop scale). Use existing `layer.stops` and `layer.format`. |
| **Why** | Users can't judge what color corresponds to which value without hovering individual neighborhoods. Three intermediate ticks make the scale self-explanatory — critical for 54 layers with different units. |
| **Touches** | `src/components/Legend.tsx` (lines 14–15: change `tickIndices` calculation) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Wire Up useAnimatedValue in Panels

| | |
|---|---|
| **What** | Import and use the existing `useAnimatedValue` hook in `NeighborhoodPanel.tsx` for the quality index score display and key stat values. The hook already exists at `src/hooks/useAnimatedValue.ts` with 300ms ease-out cubic animation — it just needs to be imported and wrapped around numeric displays. |
| **Why** | The hook was written (PO-1) but never connected. Currently all values snap instantly when switching neighborhoods. Animated transitions make the app feel responsive and draw attention to what changed. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` (import hook, wrap quality index display + key stats) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Unify Bottom Sheet Logic (Wire useBottomSheet)

| | |
|---|---|
| **What** | Replace the custom `dragStartY`/`setDragOffset`/`handleTouchEnd` logic in `NeighborhoodPanel.tsx`, `LayerSelector.tsx`, and `FilterPanel.tsx` with the existing `useBottomSheet` hook. The hook at `src/hooks/useBottomSheet.ts` already implements velocity-based snapping with peek/half/full snap positions — but no component uses it. |
| **Why** | Three components independently reimplement bottom sheet drag behavior with subtly different snap points and missing velocity detection. Using the shared hook makes behavior consistent, reduces code, and makes future panels mobile-ready for free. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/components/LayerSelector.tsx`, `src/components/FilterPanel.tsx` (replace custom drag state with `useBottomSheet` call) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Wire Up SplitMapView

| | |
|---|---|
| **What** | Add a "Compare layers" toggle to `ToolsDropdown.tsx` that renders `SplitMapView.tsx` (already exists with synchronized pan/zoom between two MapLibre instances) in place of the main `Map` component. Add state in `App.tsx` for split mode and a secondary layer picker. |
| **Why** | The `SplitMapView` component is fully implemented but unreachable from the UI. Users frequently want to correlate two metrics visually (e.g., income vs. transit access) — the filter handles this numerically, but spatial side-by-side comparison is more intuitive. |
| **Touches** | `src/App.tsx` (split mode state, conditional rendering), `src/components/ToolsDropdown.tsx` (new menu item), `src/components/LayerSelector.tsx` (secondary layer support) |
| **Complexity** | Small–Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Onboarding Tour for First-Time Visitors

| | |
|---|---|
| **What** | A 4-step highlight overlay shown once on first visit (tracked via localStorage). Steps: (1) layer selector — "51+ data layers across 8 categories", (2) search bar — "search by name or postal code", (3) click a neighborhood — "click to explore details", (4) tools dropdown — "filter, compare, and find neighborhoods". Each step has a tooltip with "Next"/"Got it" buttons and a semi-transparent backdrop highlighting the target element. |
| **Why** | New users may never discover the layer selector, comparison mode, wizard, or filter panel. A brief tour dramatically improves feature discovery without cluttering the UI. |
| **Touches** | New `src/components/OnboardingTour.tsx`, `src/App.tsx` (first-visit state + conditional render), `src/locales/fi.json` and `src/locales/en.json` (tour step labels) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Address / Coordinate Search (Geocoding)

| | |
|---|---|
| **What** | Extend `SearchBar.tsx` to accept street addresses (e.g., "Mannerheimintie 5") in addition to neighborhood names/PNOs. Use the Digitransit geocoding API (free, rate-limited, no key required for moderate traffic) or Nominatim as fallback. Resolve address to coordinates, then identify which neighborhood polygon contains the point using Turf.js `booleanPointInPolygon` (already a dependency). Show "Address results" section below neighborhood matches in the dropdown. |
| **Why** | Most users know their address, not their postal code area. "Which neighborhood is Aleksanterinkatu 10 in?" is the #1 entry point for house-hunters but currently requires external lookup. The Digitransit API is operated by HSL and specifically serves Helsinki metro data. |
| **Touches** | `src/components/SearchBar.tsx` (detect address-like input, API call, point-in-polygon), new `src/utils/geocode.ts` (API client + caching), `src/locales/*.json` (labels for address mode) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (Digitransit API is keyless but may need registration for high traffic; Nominatim has strict rate limits) |

### CF-2 Shareable Neighborhood Score Card (Image)

| | |
|---|---|
| **What** | Generate a shareable PNG image summarizing a neighborhood's key stats — quality index badge, top 5 metrics with metro comparison, mini radar chart, and naapurustot.fi branding. Use `html-to-image` (already a common pattern with the existing React rendering). Downloadable via a "Share as image" button in the panel header. |
| **Why** | Users sharing on WhatsApp, Instagram, or Twitter want a visual snapshot, not a URL. Real estate agents sharing neighborhood profiles with clients especially benefit. This drives organic traffic with branded visuals. |
| **Touches** | New `src/utils/scoreCard.ts` (image generation logic), `src/components/NeighborhoodPanel.tsx` (share-image button), `package.json` (html-to-image dep) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Point-of-Interest Overlay Layer

| | |
|---|---|
| **What** | Toggle-able map markers showing real POI locations: schools, daycares, grocery stores, healthcare facilities, transit stops. Data sourced from OpenStreetMap via Overpass API or downloaded as static GeoJSON. Clustered markers at low zoom (MapLibre's built-in clustering), individual pins at high zoom. Toggle via a checkbox in the layer selector or a new POI section. |
| **Why** | Current density metrics (e.g., `school_density`, `grocery_density`) are abstract numbers. Showing actual locations lets users see *where* services are relative to specific streets — much more actionable for someone choosing between two neighborhoods. |
| **Touches** | New `src/components/POILayer.tsx`, `src/components/Map.tsx` (additional source + clustered layer), `scripts/fetch_pois.py` (Overpass query), new `public/data/pois.geojson`, `src/locales/*.json` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires running Overpass queries, data may need periodic refresh) |

### CF-4 Neighborhood Notes / User Annotations

| | |
|---|---|
| **What** | Let users add private text notes to neighborhoods, stored in localStorage alongside favorites. Display notes in the NeighborhoodPanel with an editable text area. Export notes as part of CSV/PDF exports. |
| **Why** | Users researching multiple neighborhoods over days/weeks need to record observations ("visited on Saturday, loved the park but noisy highway nearby"). Currently they must use external tools. Notes complement the existing favorites feature. |
| **Touches** | New `src/hooks/useNotes.ts` (localStorage CRUD), `src/components/NeighborhoodPanel.tsx` (notes section), `src/utils/export.ts` (include notes in CSV/PDF) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Heatmap / Grid View Mode

| | |
|---|---|
| **What** | An alternative visualization mode that shows data as a 250m grid heatmap instead of postal code polygons, using Statistics Finland's 250m grid data where available (population, income, education). Toggle between "Neighborhoods" and "Grid" view via ToolsDropdown. Uses MapLibre's heatmap layer type. |
| **Why** | Postal code areas vary hugely in size — some cover entire forests while others are single city blocks. A fine-grained grid reveals intra-neighborhood variation that postal code averages hide (e.g., a wealthy enclave within a lower-income postal code). Aligns with the CLAUDE.md data granularity requirement to "prefer sub-postal-code breakdown." |
| **Touches** | New `scripts/fetch_grid_data.py`, new `public/data/grid_250m.topojson`, `src/components/Map.tsx` (grid source + heatmap layer), `src/components/ToolsDropdown.tsx` (toggle), `src/App.tsx` (view mode state) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires fetching Statistics Finland 250m grid WFS data) |

### CF-6 Swedish Language Support

| | |
|---|---|
| **What** | Add Swedish as a third language option (FI/EN/SV). The data already includes Swedish names (`namn` property). Create `src/locales/sv.json` with Swedish translations. Update `SettingsDropdown` to cycle through three languages or show a language picker. |
| **Why** | Swedish is an official language in Finland and widely spoken in parts of the Helsinki metro area (Espoo/Kirkkonummi especially). The GeoJSON data already contains the `namn` (Swedish name) field — it's simply not exposed in the UI. |
| **Touches** | New `src/locales/sv.json`, `src/utils/i18n.ts` (add 'sv' to Lang union, load sv.json), `src/components/SettingsDropdown.tsx` (language picker), `src/components/NeighborhoodPanel.tsx` / `SearchBar.tsx` (use `namn` for Swedish) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

UX improvements, animations, better feedback, edge case handling.

### PO-1 Hatched Pattern for Missing Data

| | |
|---|---|
| **What** | When a neighborhood has `null` for the active layer, render the polygon with a distinct diagonal-stripe SVG fill pattern instead of solid gray (`#d1d5db`). This makes missing-data areas visually distinct from low-value areas. The current `buildFillColorExpression` returns gray for null — add a second fill layer with a pattern for null features. |
| **Why** | Solid gray can be confused with "low value" on some scales. A hatched pattern is the cartographic convention for "no data available" and immediately communicates the distinction. |
| **Touches** | `src/components/Map.tsx` (add fill-pattern layer for null features), `src/utils/colorScales.ts` (optional: export a null-detection expression) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Neighborhood Panel — Collapsible Sections

| | |
|---|---|
| **What** | Group the long list of stats in `NeighborhoodPanel.tsx` into collapsible sections (Demographics, Economy, Housing, Quality of Life, Health, Services, Mobility) with section headers. Default: first two sections open, rest collapsed. Persist toggle state per session. |
| **Why** | The panel currently shows 25+ stat rows in a single scrollable list. On mobile especially, users scroll endlessly to find the metric they care about. Collapsible sections let users jump to relevant categories and reduce cognitive load. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` (wrap stat rows in collapsible groups) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Layer Search / Quick Filter in Layer Selector

| | |
|---|---|
| **What** | Add a small search/filter input at the top of the LayerSelector panel. As the user types, filter the 54 layers to only show those whose label matches the query. Especially valuable on mobile where the full list requires significant scrolling through 8 groups. |
| **Why** | With 54 layers across 8 groups, finding a specific layer requires opening groups and scanning. A type-to-filter input lets power users jump directly to "walkability" or "crime" without scanning the entire tree. |
| **Touches** | `src/components/LayerSelector.tsx` (search input + filtering logic), `src/locales/*.json` (placeholder label) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Comparison Panel — Chart View

| | |
|---|---|
| **What** | Add a "Chart" tab to the `ComparisonPanel` that shows a grouped bar chart comparing the 2–3 pinned neighborhoods across key metrics (income, unemployment, property price, transit, walkability, safety). Use SVG bars rendered inline — no charting library needed. |
| **Why** | The current comparison shows a table of raw numbers. Humans compare quantities much faster visually with bars than by reading numbers in columns. A side-by-side bar chart makes the "winner" per metric instantly obvious. |
| **Touches** | `src/components/ComparisonPanel.tsx` (add chart tab, SVG bar rendering) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 "Recently Viewed" Neighborhoods

| | |
|---|---|
| **What** | Track the last 5–10 neighborhoods the user clicked on (stored in sessionStorage or a ref). Show them as small chips below the search bar or in a "Recent" section in the search dropdown when the input is empty/focused. |
| **Why** | Users exploring neighborhoods frequently want to go back to one they looked at 5 minutes ago. Currently they must search again by name or scroll the map. Recent history provides quick navigation. |
| **Touches** | `src/components/SearchBar.tsx` (recent list in dropdown), `src/App.tsx` or new `src/hooks/useRecentNeighborhoods.ts` (history tracking) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Data Freshness Indicator

| | |
|---|---|
| **What** | Show a small "Data last updated: March 2026" label in the footer or settings panel. Embed the build timestamp in the data pipeline output (add a `_metadata` property to the TopoJSON) and display it. Optionally, show per-metric source dates. |
| **Why** | Users making real decisions (buying apartments, relocating) need to know how current the data is. "Is this 2024 or 2020 data?" is a common concern. Transparency builds trust. |
| **Touches** | `scripts/prepare_data.py` (add metadata timestamp), `src/hooks/useMapData.ts` (extract metadata), `src/components/SettingsDropdown.tsx` or footer (display date), `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 Refactor computeMetroAverages

| | |
|---|---|
| **What** | Replace the ~210-line `computeMetroAverages` function in `src/utils/metrics.ts` (which manually maintains 60+ counter variables) with a data-driven approach: define an array of `{ property, type: 'population-weighted' | 'household-weighted' | 'count' }` objects and compute all averages in a single loop. |
| **Why** | Every new data layer requires adding 4+ lines of counter variables, an accumulation block, and a result entry. This is the #1 source of bugs when adding layers. A data-driven approach makes adding a layer a one-line config change. |
| **Touches** | `src/utils/metrics.ts` (rewrite `computeMetroAverages`) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 Expand E2E Test Coverage

| | |
|---|---|
| **What** | Expand the Playwright test suite from 5 basic tests to comprehensive user flow coverage: select neighborhood → view panel → verify stats → switch layer → verify legend updates → pin & compare → export CSV → use filter presets → use wizard → verify wizard "show on map." Currently only tests: app load, search, layer click, URL hash, tools dropdown open. |
| **Why** | The existing E2E tests verify the app loads but don't test any actual user flows or data correctness. Regressions in panel rendering, filter logic, comparison, and wizard are undetectable. The CI pipeline runs these tests but they cover almost nothing. |
| **Touches** | `e2e/app.spec.ts` (expand), possibly split into `e2e/search.spec.ts`, `e2e/panel.spec.ts`, `e2e/filter.spec.ts`, `e2e/wizard.spec.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Data Pipeline: Automated Refresh Workflow

| | |
|---|---|
| **What** | Add a GitHub Actions scheduled workflow (monthly or quarterly cron) that runs `prepare_data.py`, validates output (row count, no null-only columns, schema check), and opens a PR if data changed — with a diff summary in the PR body. Pin Python deps in `requirements.txt`. |
| **Why** | The data pipeline is manual. Statistics Finland updates Paavo annually; property prices and transit data change more frequently. Stale data undermines user trust. Automated refresh with validation catches data regressions. |
| **Touches** | New `.github/workflows/data-refresh.yml`, `scripts/prepare_data.py` (add `--validate` flag), new `requirements.txt` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires ensuring all API endpoints work in CI, Python env setup, possible API keys) |

### IN-4 Error Tracking & Usage Analytics

| | |
|---|---|
| **What** | Integrate Sentry for error tracking (runtime errors, map rendering failures, data load issues) and Plausible or Umami for privacy-respecting usage analytics (page views, most-used layers, feature usage — no cookies, GDPR-compliant). |
| **Why** | No visibility into production errors or usage patterns. Can't tell which of the 54 layers are popular, whether users find the wizard, or if mobile users hit rendering bugs. Data-driven prioritization is impossible without this. |
| **Touches** | `src/main.tsx` (Sentry init), `index.html` (Plausible/Umami script tag), `package.json` (Sentry SDK) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Sentry DSN, Plausible/Umami account setup) |

### IN-5 Component Storybook or Visual Regression Tests

| | |
|---|---|
| **What** | Add Chromatic or Percy visual regression testing for key components (Legend, Tooltip, RadarChart, ComparisonPanel, FilterPanel) to catch unintended visual changes. Alternatively, set up Storybook for isolated component development. Run in CI on PRs. |
| **Why** | The app is heavily visual — color scales, chart rendering, responsive layouts, dark mode. Unit tests verify logic, but subtle visual regressions (wrong spacing, broken dark mode, truncated labels) slip through. Visual testing catches these automatically. |
| **Touches** | New `.storybook/` or visual test config, `package.json` (devDeps), `.github/workflows/ci.yml` (visual test step) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (Chromatic/Percy require account setup; Storybook is Claude Code) |

### IN-6 Performance: Lazy Load Heavy Components

| | |
|---|---|
| **What** | Lazy-load `NeighborhoodWizard`, `CustomQualityPanel`, `RankingTable`, `FilterPanel`, `SplitMapView`, and `ComparisonPanel` using `React.lazy()` + `Suspense`. These components are only rendered when the user actively opens them but currently are bundled in the main chunk. |
| **Why** | The main JS bundle includes all panel code upfront. Lazy loading these conditionally-rendered components reduces initial bundle size and speeds up first paint. The CI bundle budget (250KB gzip) becomes easier to maintain as features grow. |
| **Touches** | `src/App.tsx` (wrap conditional panels in React.lazy + Suspense) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Items within each batch can be safely developed as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order optimizes for: wiring existing code first, then high-impact features, then polish, then infrastructure.

### Batch 1 — Wire Existing Code & Independent Quick Wins

These items complete already-written code or touch completely independent files. Zero merge conflict risk.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| QW-1 Legend Intermediate Ticks | Quick Win | Small | Claude Code |
| QW-2 Wire useAnimatedValue | Quick Win | Small | Claude Code |
| QW-3 Wire useBottomSheet | Quick Win | Small | Claude Code |
| QW-5 Onboarding Tour | Quick Win | Small | Claude Code |
| IN-1 Refactor computeMetroAverages | Infrastructure | Medium | Claude Code |
| IN-6 Lazy Load Heavy Components | Infrastructure | Small | Claude Code |

> **Why first:** QW-2, QW-3 complete existing unused code — maximum value for minimum effort. QW-1 and QW-5 are fully independent. IN-1 makes future layer additions easier. IN-6 reduces bundle size. Each session touches 1–3 files with no overlap.

### Batch 2 — Core UX & Polish

Depends on Batch 1 for stable panel behavior (bottom sheets) and averages refactor. Items are independent of each other.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| QW-4 Wire SplitMapView | Quick Win | Small–Medium | Claude Code |
| CF-2 Shareable Score Card | Core Feature | Medium | Claude Code |
| CF-4 Neighborhood Notes | Core Feature | Small | Claude Code |
| CF-6 Swedish Language | Core Feature | Medium | Claude Code |
| PO-1 Hatched Pattern for Missing Data | Polish | Small | Claude Code |
| PO-2 Panel Collapsible Sections | Polish | Small | Claude Code |
| PO-3 Layer Search in Selector | Polish | Small | Claude Code |

> **Why second:** QW-4 wires the last major unused component. CF-2, CF-4, CF-6 add new files without overlapping. PO-1 touches Map.tsx (no conflict with QW-4 which replaces Map rendering conditionally). PO-2 only touches NeighborhoodPanel. PO-3 only touches LayerSelector.

### Batch 3 — Polish & Testing

Depends on Batch 2 for complete feature set. All items are independent.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-1 Address / Geocoding Search | Core Feature | Medium | Manual Setup |
| PO-4 Comparison Chart View | Polish | Medium | Claude Code |
| PO-5 Recently Viewed Neighborhoods | Polish | Small | Claude Code |
| PO-6 Data Freshness Indicator | Polish | Small | Claude Code |
| IN-2 Expand E2E Tests | Infrastructure | Medium | Claude Code |

> **Why third:** CF-1 needs external API evaluation. PO-4 and PO-5 enhance existing features. IN-2 benefits from a stable, complete feature set — writing comprehensive E2E tests after all UI features are in place maximizes coverage.

### Batch 4 — External Services & Advanced Features

Requires account creation, external API access, or large data pipeline work. Items are independent.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-3 POI Overlay Layer | Core Feature | Large | Manual Setup |
| CF-5 Heatmap / Grid View | Core Feature | Large | Manual Setup |
| IN-3 Automated Data Refresh | Infrastructure | Medium | Manual Setup |
| IN-4 Error Tracking & Analytics | Infrastructure | Small | Manual Setup |
| IN-5 Visual Regression Tests | Infrastructure | Medium | Manual Setup |

> **Why last:** All require external service setup, API access, or significant data pipeline work. CF-3 and CF-5 are the largest features. IN-3 and IN-4 need credentials. IN-5 needs Chromatic/Percy accounts. These should be tackled after the core app is fully polished and tested.
