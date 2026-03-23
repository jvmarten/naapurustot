# naapurustot.fi — Feature Roadmap

> Generated 2026-03-23 from full codebase analysis.
> Replaces previous roadmap. Items from the prior plan that were implemented are noted in the **Completed** section at the bottom.

---

## Project Context

naapurustot.fi is a client-side React/TypeScript SPA visualizing 54 data layers across ~160 Helsinki metro neighborhoods on an interactive MapLibre GL map. The app already ships a mature feature set:

**Implemented:** 54 choropleth layers (8 categories), customizable quality index (10 weighted factors), multi-criteria filter with presets, comparison panel (pin up to 3), ranking table, 4-step neighborhood wizard, similar neighborhood recommendations, radar + trend charts, address geocoding (Digitransit), split map view, favorites + notes (localStorage), CSV/PDF/PNG export, bilingual FI/EN, dark/light theme, colorblind palettes, PWA with offline indicator, URL deep linking, keyboard navigation, ARIA live regions, lazy-loaded panels, unified bottom sheet drag, animated value transitions.

**Tech stack:** React 19, TypeScript 5.9, Vite 8, MapLibre GL 5, Turf.js, Tailwind CSS 3, Vitest + Playwright.

**Data:** Static TopoJSON (~400 KB gzipped) with 75+ properties per neighborhood, built from Statistics Finland Paavo, HSL, HSY, Police, OSM, NASA VIIRS, and more via a Python pipeline. Monthly automated refresh via GitHub Actions.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Onboarding Tour for First-Time Visitors

| | |
|---|---|
| **What** | A 4–5 step highlight overlay shown once on first visit (tracked via localStorage). Steps: (1) layer selector — "54 data layers across 8 categories", (2) search bar — "search by name, postal code, or address", (3) click a neighborhood — "click to explore details", (4) tools dropdown — "filter, compare, rank, and find your ideal neighborhood". Each step has a tooltip with "Next" / "Skip" buttons and a semi-transparent backdrop highlighting the target element. No external library — a simple portal-based component with `position: fixed` overlays. |
| **Why** | New users may never discover the filter panel, wizard, comparison mode, or split map view. A brief tour dramatically improves feature discovery without cluttering the UI. |
| **Touches** | New `src/components/OnboardingTour.tsx`, `src/App.tsx` (first-visit check + conditional render), `src/locales/fi.json` and `src/locales/en.json` (tour step labels) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Share / Copy Link Button

| | |
|---|---|
| **What** | A share button next to the search bar (or in the NeighborhoodPanel header) that copies the current URL to clipboard with a "Copied!" toast. On mobile, uses the Web Share API (`navigator.share`) if available. URL already contains the selected neighborhood, layer, and comparisons via `useUrlState`. |
| **Why** | The URL deep linking system works but is invisible to most users. They don't realize they can share what they see. A visible share button makes the existing URL state feature discoverable and drives organic sharing. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` (share button), `src/App.tsx` or new small component (toast notification) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Keyboard Shortcuts Overlay

| | |
|---|---|
| **What** | A keyboard shortcuts help panel triggered by `?` key (when no input is focused). Show: Escape (close panels), `/` (focus search), `1-8` (switch layer category), `F` (toggle filter), `C` (toggle comparison), `R` (toggle ranking). Add the actual keyboard handlers for shortcuts that don't exist yet. |
| **Why** | Power users who explore many neighborhoods benefit from keyboard-driven navigation. The app already handles Escape and arrow keys — extending this to layer switching and panel toggles makes the workflow much faster. |
| **Touches** | `src/App.tsx` (keydown handlers), new `src/components/ShortcutsOverlay.tsx`, `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Print-Optimized Layout

| | |
|---|---|
| **What** | Add `@media print` CSS rules that hide the layer selector, toolbar, search bar, and floating controls; expand the map to full width; render the NeighborhoodPanel and Legend in a print-friendly layout beside the map. Add a "Print" button in NeighborhoodPanel (alongside existing export buttons). |
| **Why** | Real estate agents and relocation advisors print neighborhood profiles. The current print output includes all UI chrome. A clean print layout turns the app into a professional report generator for free. |
| **Touches** | `src/index.css` or Tailwind `@layer` (print styles), `src/components/NeighborhoodPanel.tsx` (print button) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Metric Source Attribution Tooltips in Legend

| | |
|---|---|
| **What** | Show the data source and year (from the existing `METRIC_SOURCES` map in `metrics.ts`) as a small info line below the legend when a layer is active. E.g., "Source: Statistics Finland Paavo 2024" or "Source: HSY Air Quality 2024". |
| **Why** | Users making real decisions (buying apartments, relocating) need to know how current and trustworthy the data is. The attribution data already exists in code — it just needs to be surfaced in the UI. |
| **Touches** | `src/components/Legend.tsx` (source text below gradient), `src/utils/metrics.ts` (already has `METRIC_SOURCES`) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Point-of-Interest Overlay Layer

| | |
|---|---|
| **What** | Toggle-able map markers showing real POI locations: schools, daycares, grocery stores, healthcare facilities, transit stops. `POILayer.ts` already exists with full MapLibre layer code (clustered circles, category colors, individual markers). Needs: (1) a `scripts/fetch_pois.py` to query Overpass API and generate `public/data/pois.geojson`, (2) a toggle in ToolsDropdown or LayerSelector, (3) wiring `addPOILayers()` in Map.tsx. |
| **Why** | Current density metrics (e.g., `school_density`) are abstract numbers. Showing actual locations lets users see *where* services are relative to specific streets — much more actionable for someone choosing between two neighborhoods. The rendering code is already written. |
| **Touches** | New `scripts/fetch_pois.py`, new `public/data/pois.geojson`, `src/components/Map.tsx` (import and call `addPOILayers`), `src/components/ToolsDropdown.tsx` (POI toggle), `src/App.tsx` (POI state) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires running Overpass queries; data should be fetched once and committed as static GeoJSON, then periodically refreshed) |

### CF-2 Grid Heatmap View for Sub-Postal-Code Data

| | |
|---|---|
| **What** | Complete the partially-wired grid visualization for layers that have 250m resolution data. `useGridData` hook already exists and loads grid GeoJSON files; Map.tsx already renders a `grid-fill` layer. Currently only `light_pollution` has grid data. Extend to: population density (Statistics Finland 250m grid), income (250m grid), and any other layers where sub-postal-code data is available. Add a visual toggle indicator when grid data is active. |
| **Why** | Postal code areas vary hugely in size. A 250m grid reveals intra-neighborhood variation that postal code averages hide. Aligns with the CLAUDE.md data granularity requirement. The infrastructure is built — it just needs more data layers feeding into it. |
| **Touches** | `scripts/prepare_data.py` or new `scripts/fetch_grid_250m.py` (fetch Statistics Finland 250m grid WFS), new grid GeoJSON files in `public/data/`, `src/utils/colorScales.ts` (add `gridProperty` to more layers), `src/components/Legend.tsx` (grid indicator) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires fetching Statistics Finland 250m grid WFS data and processing it) |

### CF-3 Swedish Language Support

| | |
|---|---|
| **What** | Add Swedish as a third language (FI/EN/SV). The GeoJSON already contains the `namn` (Swedish name) property. Create `src/locales/sv.json` with Swedish UI translations. Update `SettingsDropdown` to show a three-option language picker. Update `SearchBar` and `NeighborhoodPanel` to use `namn` when Swedish is active. |
| **Why** | Swedish is an official language in Finland, widely spoken in parts of Helsinki metro (especially Espoo, Kirkkonummi, Sipoo). The neighborhood name data already exists — only UI translations are needed. |
| **Touches** | New `src/locales/sv.json`, `src/utils/i18n.ts` (add 'sv' to Lang union), `src/components/SettingsDropdown.tsx` (language picker), `src/components/SearchBar.tsx` and `NeighborhoodPanel.tsx` (use `namn` for SV) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Isochrone / Travel Time Visualization

| | |
|---|---|
| **What** | When a neighborhood is selected, show a "reachable within X minutes" overlay on the map using the Digitransit Routing API or a pre-computed isochrone dataset. User selects travel mode (walk, bike, transit) and time budget (10/20/30 min). Render the reachable area as a semi-transparent polygon on the map. |
| **Why** | "How far can I get from here in 30 minutes by transit?" is the #1 question for commuters. The existing `transit_reachability` metric gives a single score — an isochrone polygon shows the actual reachable geography, making the data spatially meaningful. |
| **Touches** | New `src/components/IsochroneOverlay.tsx`, `src/components/Map.tsx` (isochrone layer), `src/components/NeighborhoodPanel.tsx` (trigger button), new `src/utils/isochrone.ts` (API client), `src/locales/*.json` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (Digitransit Routing API is free but may require registration for higher rate limits) |

### CF-5 Neighborhood Comparison URL Sharing with Social Preview

| | |
|---|---|
| **What** | When sharing a URL with `?compare=00100,02100`, generate an Open Graph meta image (og:image) showing a mini comparison card of the pinned neighborhoods. Use a serverless function (e.g., Cloudflare Worker or Vercel OG) to render the image on-the-fly from query params, or pre-generate static OG images for popular neighborhoods. |
| **Why** | When users share neighborhood links on WhatsApp, Slack, or social media, a rich preview with neighborhood names, quality scores, and a mini comparison drives significantly more click-throughs than a generic site thumbnail. |
| **Touches** | New serverless function or build-time OG image generation, `index.html` (dynamic og:meta tags — App.tsx already sets some dynamically) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires serverless function deployment or build-time image generation tooling) |

### CF-6 Custom Area Drawing / Polygon Stats

| | |
|---|---|
| **What** | Let users draw a freeform polygon on the map and see aggregated stats (population-weighted averages) for all neighborhoods intersecting that area. Uses MapLibre's draw interaction + Turf.js `booleanIntersects` (already a dependency pattern). Show results in a summary panel similar to ComparisonPanel but for the drawn region. |
| **Why** | Users often think in terms of "the area around Kallio and Sörnäinen" rather than individual postal codes. Drawing a region and seeing combined stats bridges the gap between how users think about neighborhoods and how the data is structured. |
| **Touches** | New `src/components/DrawTool.tsx`, `src/components/AreaSummaryPanel.tsx`, `src/components/Map.tsx` (draw interaction handlers), `src/App.tsx` (draw mode state) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

UX improvements, animations, better feedback, edge case handling.

### PO-1 Data Freshness Indicator

| | |
|---|---|
| **What** | Show a "Data updated: March 2026" label in the footer or settings panel. Embed a build timestamp in the TopoJSON metadata during `build:data`. Optionally, show per-metric source dates when hovering the source attribution badge (already partially implemented in `METRIC_SOURCES`). |
| **Why** | Users making real decisions need to know data currency. "Is this 2024 or 2020 data?" erodes trust. Transparency is free. |
| **Touches** | `scripts/prepare_data.py` (add `_metadata.updated` property), `src/hooks/useMapData.ts` (extract metadata), `src/components/SettingsDropdown.tsx` or footer (display), `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Smooth Layer Transition Animation

| | |
|---|---|
| **What** | When switching layers, animate the choropleth colors by briefly fading opacity to 0, switching the fill-color expression, then fading back to the user's opacity setting. Currently layers snap instantly which can be visually jarring. Use MapLibre's `setPaintProperty` with a 200ms CSS transition or a requestAnimationFrame opacity tween. |
| **Why** | Instant color changes when switching between 54 layers feel harsh. A brief fade transition makes the experience feel polished and helps users track which areas changed relative ranking. |
| **Touches** | `src/components/Map.tsx` (layer switch useEffect — add opacity transition before/after color expression change) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Mobile Panel Swipe Navigation

| | |
|---|---|
| **What** | On mobile, allow swiping left/right in the NeighborhoodPanel to navigate between sections (Overview, Stats, Trends, Similar) instead of scrolling through all sections vertically. Uses horizontal touch gesture detection on top of the existing `useBottomSheet` hook. Show section dots/tabs at the top. |
| **Why** | On mobile, the NeighborhoodPanel is very long (7+ collapsible sections). Horizontal swiping between focused views reduces scrolling and matches mobile app conventions (e.g., property listing apps). |
| **Touches** | `src/components/NeighborhoodPanel.tsx` (section tabs + swipe gesture), possibly new `src/hooks/useSwipeNavigation.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Empty State Illustrations

| | |
|---|---|
| **What** | Replace generic text prompts with small SVG illustrations + helpful copy for: (1) no neighborhood selected ("Click any area to explore"), (2) empty comparison panel ("Pin neighborhoods to compare"), (3) no filter results ("No neighborhoods match — try adjusting criteria"), (4) empty favorites ("Star neighborhoods to save them here"). |
| **Why** | Empty states are the most common first impression for each feature. Clear illustrations with actionable guidance reduce confusion and teach users what to do, especially on first visit. |
| **Touches** | New SVG assets (inline in components or `src/assets/`), `src/components/ComparisonPanel.tsx`, `src/components/FilterPanel.tsx`, various panel empty states, `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Neighborhood Panel — Metric Sparklines

| | |
|---|---|
| **What** | For metrics that have trend data (income, population, unemployment — stored as JSON arrays in the GeoJSON), show a tiny inline sparkline (30×12px SVG) next to the metric value in the stat rows. The sparkline shows the 5-year trend at a glance without expanding the trend chart section. |
| **Why** | Trend data exists for 3 metrics but is buried in a collapsible "Trends" section. Sparklines surface trend information inline, letting users spot growth/decline patterns while scanning the summary stats — a proven data visualization pattern. |
| **Touches** | New `src/components/Sparkline.tsx` (tiny SVG component), `src/components/NeighborhoodPanel.tsx` (render sparklines in stat rows for metrics with trend arrays) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Comparison Panel — Radar Chart Overlay

| | |
|---|---|
| **What** | Add an option to overlay the radar charts of 2–3 compared neighborhoods on a single radar chart (different colors, semi-transparent fills). Currently the RadarChart component renders one neighborhood at a time. Extend it to accept multiple data arrays. |
| **Why** | The comparison panel shows tabular data and bar charts, but the radar chart — the best tool for holistic comparison — only works for single neighborhoods. Overlaid radar charts make relative strengths/weaknesses immediately visible. |
| **Touches** | `src/components/RadarChart.tsx` (accept array of datasets, render overlaid polygons), `src/components/ComparisonPanel.tsx` (pass compared neighborhood data) |
| **Complexity** | Small–Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-7 Accessibility Audit Fixes

| | |
|---|---|
| **What** | Run axe-core or Lighthouse accessibility audit and fix identified issues. Known gaps: (1) color contrast on some Tailwind text utilities in dark mode, (2) focus ring visibility on map controls, (3) screen reader announcements for filter match count changes, (4) alt text for radar and trend charts, (5) skip-to-content link. The app already has ARIA live regions and keyboard nav — this is about closing remaining gaps. |
| **Why** | Public data tools should be accessible to all users. Finland's accessibility legislation (EU Web Accessibility Directive) applies to public information services. Fixing these issues also improves SEO. |
| **Touches** | Various components (contrast fixes, focus styles, aria attributes), `index.html` (skip link), `src/components/RadarChart.tsx` and `TrendChart.tsx` (aria-label / role="img") |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 Error Tracking (Sentry)

| | |
|---|---|
| **What** | Configure Sentry for production error tracking. `src/main.tsx` already has an optional Sentry DSN integration point. Set up the Sentry project, configure source maps upload in the Vite build, and add the DSN as an environment variable. |
| **Why** | No visibility into production errors. Map rendering failures, data loading issues, and edge-case crashes are invisible. Sentry provides stack traces, breadcrumbs, and user impact data. |
| **Touches** | `src/main.tsx` (configure Sentry init), `vite.config.ts` (source map upload plugin), `.github/workflows/deploy.yml` (set SENTRY_DSN env var) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Sentry account and project creation) |

### IN-2 Privacy-Respecting Analytics

| | |
|---|---|
| **What** | Add Plausible or Umami self-hosted analytics. No cookies, GDPR-compliant, no consent banner needed. Track: page views, most-used layers, feature usage (wizard, filter, comparison, export), mobile vs desktop split. Single script tag in `index.html`. |
| **Why** | Can't prioritize features without knowing what users actually use. Are the 54 layers all getting traffic or just 5? Does anyone use the wizard? Data-driven prioritization is impossible without usage signals. |
| **Touches** | `index.html` (analytics script tag), optionally `src/App.tsx` or individual components (custom event tracking) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Plausible subscription or Umami self-hosted setup) |

### IN-3 Visual Regression Testing

| | |
|---|---|
| **What** | Add Playwright screenshot comparison tests for key visual states: (1) default map load, (2) dark mode, (3) neighborhood panel open, (4) comparison panel with 3 neighborhoods, (5) filter panel active, (6) colorblind mode. Compare against committed baseline screenshots. Run in CI on PRs. |
| **Why** | The app is heavily visual — color scales, chart rendering, responsive layouts, dark mode. Unit tests verify logic, but subtle visual regressions (wrong spacing, broken dark mode, truncated labels) slip through. Playwright's built-in `toHaveScreenshot()` requires no external service. |
| **Touches** | New `e2e/visual/` test files, `playwright.config.ts` (screenshot config), `.github/workflows/ci.yml` (visual test step) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-4 Bundle Size Tracking Over Time

| | |
|---|---|
| **What** | Add a CI step that records the gzipped JS/CSS bundle sizes to a tracking file or PR comment after each build. Currently CI enforces a 250KB budget but doesn't show trends. Use `bundlesize` or a simple script that compares against the previous build and comments the delta on PRs. |
| **Why** | The bundle budget is a hard ceiling but doesn't show gradual creep. Knowing "this PR adds 3.2KB" prevents death-by-a-thousand-cuts growth and makes size-conscious decisions easy. |
| **Touches** | `.github/workflows/ci.yml` (size tracking step), possibly `package.json` (bundlesize devDep) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-5 Data Pipeline Validation Suite

| | |
|---|---|
| **What** | Add a `scripts/validate_data.py` that runs after `prepare_data.py` and checks: (1) expected number of features (~160), (2) no all-null properties, (3) value ranges are plausible (e.g., income > 0, percentages 0–100), (4) all required properties present, (5) valid geometries (no self-intersections). Run in the data-refresh GitHub Actions workflow. |
| **Why** | The automated monthly data refresh can silently break if an upstream API changes format. Validation catches data regressions before they reach production. Currently the refresh workflow has minimal validation. |
| **Touches** | New `scripts/validate_data.py`, `.github/workflows/data-refresh.yml` (add validation step) |
| **Complexity** | Small–Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-6 Performance Budget: Core Web Vitals Monitoring

| | |
|---|---|
| **What** | Add `web-vitals` library (3KB) to report LCP, FID, CLS, INP, and TTFB. In development, log to console. In production, send to analytics endpoint (Plausible custom events or a simple beacon). Add Lighthouse CI to the GitHub Actions pipeline with performance score thresholds. |
| **Why** | Map rendering is heavy — MapLibre GL, TopoJSON parsing, and 10 useEffect hooks in Map.tsx all compete for the main thread. Without CWV monitoring, performance regressions from new features go unnoticed until users complain. |
| **Touches** | `package.json` (web-vitals dep), `src/main.tsx` (report vitals), `.github/workflows/ci.yml` (Lighthouse CI step) |
| **Complexity** | Small |
| **Dependencies** | IN-2 (analytics endpoint for production reporting, optional) |
| **Tag** | Claude Code (vitals reporting) / Manual Setup (Lighthouse CI thresholds need calibration) |

---

## Suggested Sequencing

Items within each batch can be safely developed as **parallel Claude Code sessions** without logical conflicts (no overlapping files). Each batch depends only on prior batches being complete.

### Batch 1 — Quick Wins & Low-Hanging Infrastructure

All items touch completely independent files. Zero merge conflict risk.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| QW-1 Onboarding Tour | Quick Win | Small | Claude Code |
| QW-2 Share / Copy Link Button | Quick Win | Small | Claude Code |
| QW-3 Keyboard Shortcuts Overlay | Quick Win | Small | Claude Code |
| QW-5 Metric Source in Legend | Quick Win | Small | Claude Code |
| PO-1 Data Freshness Indicator | Polish | Small | Claude Code |
| IN-4 Bundle Size Tracking | Infrastructure | Small | Claude Code |
| IN-5 Data Pipeline Validation | Infrastructure | Small–Medium | Claude Code |

> **Why first:** Maximum value for minimum effort. Each session touches 1–3 files with no overlap. QW-1 is a new component; QW-2 adds a button to the panel; QW-3 adds keyboard handlers in App.tsx (QW-2 doesn't touch App.tsx); QW-5 only touches Legend.tsx; PO-1 touches prepare_data.py + useMapData; IN-4 only touches CI; IN-5 is a new script.
>
> **Parallelism notes:** QW-3 touches `App.tsx` — no other item in this batch does. QW-2 touches `NeighborhoodPanel.tsx` — no conflict. All safe to run simultaneously.

### Batch 2 — Core Features & Polish (Independent)

Depends on Batch 1 only for stable App.tsx keyboard handling. All items are independent of each other.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-3 Swedish Language | Core Feature | Medium | Claude Code |
| PO-2 Smooth Layer Transitions | Polish | Small | Claude Code |
| PO-4 Empty State Illustrations | Polish | Small | Claude Code |
| PO-5 Metric Sparklines | Polish | Small | Claude Code |
| PO-6 Comparison Radar Overlay | Polish | Small–Medium | Claude Code |
| QW-4 Print-Optimized Layout | Quick Win | Small | Claude Code |
| IN-3 Visual Regression Tests | Infrastructure | Medium | Claude Code |

> **Why second:** CF-3 adds a new locale file + touches i18n.ts and SettingsDropdown. PO-2 only touches Map.tsx layer switching. PO-4 touches panel empty states (non-overlapping with PO-5 which touches stat rows). PO-5 adds sparklines to NeighborhoodPanel stat rows. PO-6 only touches RadarChart + ComparisonPanel. QW-4 is CSS-only. IN-3 adds new E2E test files.
>
> **Parallelism notes:** PO-5 and PO-6 both touch `NeighborhoodPanel.tsx` indirectly (PO-5 modifies stat rows, PO-6 modifies ComparisonPanel which imports RadarChart). These are safe as PO-5 touches `NeighborhoodPanel.tsx` stat row rendering while PO-6 touches `RadarChart.tsx` + `ComparisonPanel.tsx`.

### Batch 3 — External Data & Medium Features

Depends on Batch 2 for visual stability. Items are independent.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-1 POI Overlay Layer | Core Feature | Medium | Manual Setup |
| CF-6 Custom Area Drawing | Core Feature | Large | Claude Code |
| PO-3 Mobile Panel Swipe Navigation | Polish | Medium | Claude Code |
| PO-7 Accessibility Audit Fixes | Polish | Medium | Claude Code |
| IN-1 Error Tracking (Sentry) | Infrastructure | Small | Manual Setup |
| IN-2 Privacy-Respecting Analytics | Infrastructure | Small | Manual Setup |

> **Why third:** CF-1 needs Overpass data fetching (manual step). CF-6 is a large feature but doesn't conflict with CF-1 (different Map.tsx layers and different UI components). PO-3 touches NeighborhoodPanel mobile layout. PO-7 is a cross-cutting audit. IN-1 and IN-2 require external account setup.
>
> **Parallelism notes:** CF-1 touches Map.tsx (POI layers) and CF-6 touches Map.tsx (draw interaction). Run these **sequentially** or coordinate carefully — both add new layers/interactions to Map.tsx. All other items are safe in parallel.

### Batch 4 — Advanced Features

Depends on Batch 3 for analytics (IN-2) and error tracking (IN-1). Large features that benefit from a stable, monitored foundation.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-2 Grid Heatmap View | Core Feature | Large | Manual Setup |
| CF-4 Isochrone Visualization | Core Feature | Large | Manual Setup |
| CF-5 Social Preview OG Images | Core Feature | Medium | Manual Setup |
| IN-6 Core Web Vitals Monitoring | Infrastructure | Small | Claude Code / Manual Setup |

> **Why last:** CF-2 requires fetching and processing Statistics Finland 250m grid data — significant data pipeline work. CF-4 needs Digitransit Routing API integration. CF-5 requires serverless function deployment. IN-6 benefits from having analytics (IN-2) already in place for production metric reporting. These are the highest-effort items with the most external dependencies.
>
> **Parallelism notes:** CF-2 touches the data pipeline + Map.tsx grid rendering. CF-4 adds a new overlay component + Map.tsx layer. These modify different parts of Map.tsx (grid fill vs. polygon overlay) but should be coordinated. CF-5 and IN-6 are fully independent.

---

## Completed (from previous roadmap)

These items from the 2026-03-18 roadmap have been fully implemented:

| Tag | Item | Status |
|-----|------|--------|
| QW-1 | Legend Intermediate Tick Labels | Done — `showTickIndices` in Legend.tsx |
| QW-2 | Wire useAnimatedValue | Done — wired in NeighborhoodPanel |
| QW-3 | Wire useBottomSheet | Done — integrated into 3 components |
| QW-4 | Wire SplitMapView | Done — toggle in ToolsDropdown, rendered in App |
| CF-1 | Address / Geocoding Search | Done — Digitransit API in SearchBar |
| CF-2 | Shareable Score Card | Done — PNG export via html-to-image |
| CF-4 | Neighborhood Notes | Done — useNotes hook + NeighborhoodPanel |
| PO-1 | Hatched Pattern for Missing Data | Done — Map.tsx no-data pattern layer |
| PO-2 | Collapsible Sections | Done — NeighborhoodPanel sections |
| PO-3 | Layer Search/Filter | Done — LayerSelector search input |
| PO-4 | Comparison Chart View | Done — ComparisonPanel SVG bars |
| PO-5 | Recently Viewed Neighborhoods | Done — useRecentNeighborhoods + SearchBar |
| IN-1 | Refactor computeMetroAverages | Done — data-driven METRIC_DEFS approach |
| IN-2 | Expand E2E Tests | Done — 6 comprehensive test files |
| IN-3 | Automated Data Refresh | Done — GitHub Actions monthly workflow |
| IN-6 | Lazy Load Heavy Components | Done — React.lazy + Suspense for 7 panels |
