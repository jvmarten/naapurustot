# Naapurustot.fi — Feature Roadmap

> Generated 2026-03-16 from full codebase analysis.
> Status: **planning only** — nothing here has been implemented yet.

---

## Project Context

Naapurustot.fi is a client-side React/TypeScript SPA that visualizes 41 data layers across ~100 Helsinki metro neighborhoods on an interactive MapLibre GL map. The app already ships:

- 41 choropleth data layers (demographics, economy, housing, services, mobility, quality of life)
- Customizable quality index with 8 weighted factors
- Neighborhood comparison (pin up to 3), ranking table, multi-criteria filter
- CSV & PDF export, bilingual UI (FI/EN), dark/light themes
- URL deep linking, keyboard-accessible search, mobile bottom sheets
- Vitest test suite, Brotli/Gzip compression, Netlify deploy workflow

**Tech stack:** React 19, TypeScript 5.9, Vite 8, MapLibre GL 5, Turf.js, Tailwind CSS 3, PostCSS.
**Data:** Static TopoJSON (~1.1 MB) built from Statistics Finland Paavo, HSL Digitransit, HSY, Police open data, and property price APIs via a Python pipeline.

### Data Granularity Requirement

We are interested in as low-level data as possible. The minimum acceptable granularity is **postal code level**, but whenever a data source offers finer resolution (e.g., 250 m × 250 m grid cells, building-level, block-level, or coordinate-level data), we should prefer and integrate that instead. When evaluating new data sources or extending existing ones, always check whether a sub-postal-code breakdown is available.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Permalink Share Button

| | |
|---|---|
| **What** | Add a "Copy link" button next to the neighborhood name in the detail panel. Copies the current URL (which already encodes pno + layer) to the clipboard with a brief "Copied!" toast. |
| **Why** | URL deep linking exists but users don't know they can share the URL. An explicit button makes sharing discoverable. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 "Back to Overview" Map Reset

| | |
|---|---|
| **What** | A small button (or double-click on brand mark) that resets the map to the default center/zoom and deselects any neighborhood. |
| **Why** | After zooming into a specific area, there's no quick way to return to the full metro overview. Users must manually zoom out. |
| **Touches** | `src/App.tsx`, `src/components/Map.tsx` (expose `flyTo` for reset coordinates) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Layer Value in Legend Tick Labels

| | |
|---|---|
| **What** | Show the numeric stop values (e.g. "20k €", "5%") along the legend gradient bar, not just low/high labels. |
| **Why** | The legend currently shows only the color gradient and unit. Users can't tell what numeric range a color represents without hovering individual neighborhoods. |
| **Touches** | `src/components/Legend.tsx`, `src/utils/colorScales.ts` (expose stop values) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Keyboard Shortcut: Escape to Close Panels

| | |
|---|---|
| **What** | Global `keydown` handler: Escape closes the topmost open panel (detail → filter → ranking → custom quality), allowing fast keyboard-driven navigation. |
| **Why** | Users who navigate via keyboard or power users expect Escape to dismiss overlays. Currently only the search dropdown responds to Escape. |
| **Touches** | `src/App.tsx` (global keydown effect) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Smooth Layer Transition Animation

| | |
|---|---|
| **What** | Add a `paint` transition of ~300ms to the `fill-color` and `fill-opacity` properties so layer switches crossfade instead of snapping. |
| **Why** | Layer changes are currently instant and jarring. A brief transition feels polished without adding complexity. |
| **Touches** | `src/components/Map.tsx` (MapLibre paint transition config) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Neighborhood "Similar To" Recommendations

| | |
|---|---|
| **What** | In the detail panel, show a "Similar neighborhoods" section listing 3–5 areas with the most similar statistical profile (Euclidean distance across normalized key metrics). Clickable to fly to each. |
| **Why** | Users interested in one neighborhood likely want to know comparable alternatives — especially house-hunters who didn't find availability in their first choice. |
| **Touches** | New utility `src/utils/similarity.ts`, `src/components/NeighborhoodPanel.tsx`, `src/utils/metrics.ts` (normalization helpers) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Saved / Favorite Neighborhoods

| | |
|---|---|
| **What** | Let users star/favorite neighborhoods (persisted in localStorage). Show a "My favorites" list accessible from the top bar. Favorites appear with a star icon on the map. |
| **Why** | Users comparing areas over multiple sessions lose their context on each visit. Favorites create continuity without requiring accounts. |
| **Touches** | New hook `src/hooks/useFavorites.ts`, `src/App.tsx` (state + UI toggle), `src/components/Map.tsx` (star markers), `src/components/NeighborhoodPanel.tsx` (favorite button) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Neighborhood Score Card (Shareable Image)

| | |
|---|---|
| **What** | Generate a shareable image (PNG via `<canvas>` or html2canvas) summarizing a neighborhood's key stats — quality index, top 5 metrics, mini radar chart. Downloadable and optimized for social sharing. |
| **Why** | Users sharing on social media or messaging apps want a visual snapshot, not a URL. This drives organic traffic and makes the app more useful for real estate agents. |
| **Touches** | New utility `src/utils/scoreCard.ts`, `src/components/NeighborhoodPanel.tsx` (share button), possibly `html2canvas` dependency |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Radar / Spider Chart for Neighborhood Profile

| | |
|---|---|
| **What** | An SVG radar chart (no library needed) in the detail panel showing 6–8 key dimensions (income, safety, transit, green space, education, services) as normalized axes. Optionally overlay pinned neighborhoods for visual comparison. |
| **Why** | A single number (quality index) doesn't capture a neighborhood's character. A radar chart instantly communicates the trade-off profile — "great transit but low green space." |
| **Touches** | New component `src/components/RadarChart.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/components/ComparisonPanel.tsx` (optional overlay) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Multi-Year Time-Series Data Integration

| | |
|---|---|
| **What** | Extend `prepare_data.py` to fetch Paavo data for 2019–2024, compute year-over-year deltas, and embed `*_history` arrays in the TopoJSON. The existing `TrendChart.tsx` component then renders sparklines for income, population, and unemployment trends. |
| **Why** | The TrendChart component and `*_history` data schema already exist but contain limited data. Full historical integration turns static snapshots into dynamic narratives — "this area has been gentrifying for 5 years." |
| **Touches** | `scripts/prepare_data.py` (multi-year fetch loop), `src/utils/metrics.ts` (history parsing), `src/components/TrendChart.tsx` (rendering), `src/components/NeighborhoodPanel.tsx` (display section) |
| **Complexity** | Large |
| **Dependencies** | Requires verifying Statistics Finland WFS endpoint availability for each historical year. |
| **Tag** | Manual Setup |

### CF-6 "Neighborhood Finder" Guided Wizard

| | |
|---|---|
| **What** | A step-by-step wizard (3–4 screens) that asks plain-language preference questions ("How important is public transit?", "Do you prefer quiet areas?") and maps answers to filter criteria. Shows top 5 matching neighborhoods with explanations. |
| **Why** | The filter panel is powerful but intimidating — users need to know which of 41 layers matter and what ranges are good. A guided wizard makes the tool accessible to non-technical users. |
| **Touches** | New component `src/components/NeighborhoodWizard.tsx`, `src/App.tsx` (wizard toggle), reuses `computeMatchingPnos` from FilterPanel |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

UX improvements, animations, better feedback, edge case handling.

### PO-1 Colorblind-Safe Palette Option

| | |
|---|---|
| **What** | Add a "Colorblind mode" toggle in settings that switches all choropleth gradients to viridis/cividis palettes. Persist choice in localStorage. |
| **Why** | ~8% of males have color vision deficiency. The current green-yellow-red scales are problematic for deuteranopia (the most common type). |
| **Touches** | `src/utils/colorScales.ts` (alternative palette sets), `src/components/Legend.tsx`, `src/App.tsx` (settings state), `src/components/Map.tsx` (palette-aware expression building) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Onboarding Tour for First-Time Visitors

| | |
|---|---|
| **What** | A 3–4 step overlay tour highlighting the layer selector, search bar, click-to-explore, and filter/compare features. Shown once on first visit (tracked via localStorage). Skippable with "Got it" button on each step. |
| **Why** | New users may not discover the layer selector, comparison mode, or filter panel. A brief tour dramatically improves feature discovery without cluttering the UI permanently. |
| **Touches** | New component `src/components/OnboardingTour.tsx`, `src/App.tsx` (first-visit state) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 ARIA Live Regions & Screen Reader Announcements

| | |
|---|---|
| **What** | Add `aria-live` regions to announce: layer changes, selected neighborhood, filter results count, comparison updates. Add `role` and `aria-label` attributes to all interactive elements missing them. |
| **Why** | The app has partial ARIA support (some buttons have labels) but no live announcements. Switching layers or selecting a neighborhood produces no audible feedback for screen reader users. |
| **Touches** | All components in `src/components/`, `src/App.tsx` (live region container) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Map Print / Screenshot Mode

| | |
|---|---|
| **What** | A "Print map" button that hides all overlays, renders the current map view + legend to a clean layout suitable for printing or screenshotting (via `window.print()` with a print-specific CSS stylesheet). |
| **Why** | Researchers and students want to include map screenshots in reports. Currently they must manually screenshot and crop. |
| **Touches** | `src/index.css` (print media queries), `src/App.tsx` (print mode toggle), `src/components/Legend.tsx` (print-friendly variant) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Empty State & No-Data Handling

| | |
|---|---|
| **What** | When a neighborhood has `null` or missing data for the active layer, show a clear "No data available" indicator in the tooltip, detail panel, and use a distinct hatched pattern on the map polygon instead of leaving it uncolored. |
| **Why** | Some neighborhoods have missing values for certain layers (e.g., crime, energy efficiency). Currently these show as blank/zero with no explanation, which is misleading. |
| **Touches** | `src/components/Tooltip.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/components/Map.tsx` (hatched fill pattern for null), `src/utils/colorScales.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Responsive Comparison Panel

| | |
|---|---|
| **What** | Redesign ComparisonPanel for mobile: stack cards vertically in a scrollable bottom sheet instead of horizontal layout. Add swipe-to-remove gesture for unpinning on touch devices. |
| **Why** | The comparison panel currently overflows on small screens when 3 neighborhoods are pinned. The horizontal layout doesn't work below 768px. |
| **Touches** | `src/components/ComparisonPanel.tsx`, `src/index.css` (mobile overrides) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 CI Pipeline (Lint + Type-Check + Test)

| | |
|---|---|
| **What** | Add a GitHub Actions workflow that runs `eslint`, `tsc --noEmit`, and `vitest run` on every push and PR. Block merges on failure. |
| **Why** | The current `auto-merge.yml` workflow merges everything to main with no quality gate. Broken code or type errors can ship immediately. |
| **Touches** | New `.github/workflows/ci.yml`, `package.json` (ensure `lint`, `typecheck` scripts exist) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 Performance Budget & Bundle Analysis

| | |
|---|---|
| **What** | Add `rollup-plugin-visualizer` to the Vite build for bundle size analysis. Set a CI check that fails if the JS bundle exceeds 250 KB (gzipped) or the TopoJSON exceeds 400 KB (brotli). |
| **Why** | The app loads a 1.1 MB TopoJSON + JS bundle on every visit. Without a budget, new features silently bloat the payload. A performance budget catches regressions early. |
| **Touches** | `vite.config.ts` (visualizer plugin), `.github/workflows/ci.yml` (size check step) |
| **Complexity** | Small |
| **Dependencies** | IN-1 (CI must exist) |
| **Tag** | Claude Code |

### IN-3 Data Pipeline: Automated Refresh

| | |
|---|---|
| **What** | Add a GitHub Actions scheduled workflow (e.g., monthly) that runs `prepare_data.py`, commits updated TopoJSON if data changed, and opens a PR for review. Include retry logic, schema validation, and diff summary in PR body. |
| **Why** | The data pipeline is manual — someone must run the Python script locally and commit. Statistics Finland updates Paavo data annually; property prices and transit data update more frequently. Stale data undermines user trust. |
| **Touches** | New `.github/workflows/data-refresh.yml`, `scripts/prepare_data.py` (add `--validate` flag and exit codes), `requirements.txt` (pin Python deps) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires GitHub Actions secrets for any authenticated APIs, plus Python env setup in CI) |

### IN-4 End-to-End Tests with Playwright

| | |
|---|---|
| **What** | Add Playwright tests for critical user flows: load app → select neighborhood → view panel → switch layer → use search → pin & compare → export CSV. Run in CI on each PR. |
| **Why** | Unit tests cover utility logic but not UI integration. The map, panels, and data pipeline interact in complex ways that only E2E tests can validate. Regressions in map click handling or panel rendering go undetected. |
| **Touches** | New `e2e/` directory, `playwright.config.ts`, `package.json` (devDeps + script), `.github/workflows/ci.yml` (E2E step) |
| **Complexity** | Medium |
| **Dependencies** | IN-1 (CI pipeline) |
| **Tag** | Claude Code |

### IN-5 Structured SEO & Open Graph Metadata

| | |
|---|---|
| **What** | Generate per-neighborhood `<meta>` tags (title, description, og:image) dynamically when a pno is in the URL hash. Add JSON-LD structured data for the site. Consider pre-rendering or SSG for key neighborhoods to improve search indexing. |
| **Why** | As a SPA, the app serves identical meta tags for every URL. Search engines and social media previews show generic content regardless of the shared neighborhood. This limits organic discovery. |
| **Touches** | `index.html` (base meta), `src/App.tsx` (dynamic `document.title`), potentially a pre-rendering build step |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-6 Error Tracking & Analytics

| | |
|---|---|
| **What** | Integrate lightweight error tracking (Sentry) and privacy-respecting analytics (Plausible or Umami) to understand usage patterns and catch runtime errors in production. |
| **Why** | No visibility into whether users hit errors, which layers/neighborhoods are most popular, or how many people use comparison/filter features. Data-driven prioritization is impossible. |
| **Touches** | `src/main.tsx` (Sentry init), `index.html` (analytics script tag), `package.json` (Sentry SDK) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Sentry DSN and analytics account creation) |

### IN-7 Data Pipeline Hardening

| | |
|---|---|
| **What** | Add retry logic with exponential backoff, rate limiting, JSON schema validation for API responses, and structured error reporting to `prepare_data.py`. Add a `--dry-run` flag that validates without writing. Pin all API versions explicitly. |
| **Why** | The Python script calls 5+ external APIs. A transient failure or schema change silently produces bad or partial data, which then gets committed and shipped. |
| **Touches** | `scripts/prepare_data.py` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-8 Internationalization: Externalize Strings to JSON

| | |
|---|---|
| **What** | Move the `translations` object from `src/utils/i18n.ts` into separate `locales/fi.json` and `locales/en.json` files. This enables future crowd-sourced translations and tooling (e.g., i18next, Crowdin). |
| **Why** | The current inline translation map (140+ keys) is growing and hard to manage. Adding a third language (e.g., Swedish, Estonian) would require duplicating the entire TypeScript object. JSON files are standard for i18n tooling. |
| **Touches** | `src/utils/i18n.ts` (loader refactor), new `src/locales/fi.json`, `src/locales/en.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Items within each batch can be safely developed as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order optimizes for: unblocking future work first, then high-impact user features, then polish.

### Batch 1 — Infrastructure Foundation & Independent Quick Wins (no dependencies)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-1 CI Pipeline | Infrastructure | Small | Claude Code |
| IN-7 Data Pipeline Hardening | Infrastructure | Medium | Claude Code |
| IN-8 Externalize i18n Strings | Infrastructure | Small | Claude Code |
| QW-1 Permalink Share Button | Quick Win | Small | Claude Code |
| QW-2 Back to Overview Reset | Quick Win | Small | Claude Code |
| QW-3 Legend Tick Labels | Quick Win | Small | Claude Code |
| QW-4 Escape to Close Panels | Quick Win | Small | Claude Code |
| QW-5 Smooth Layer Transition | Quick Win | Small | Claude Code |

> **Why first:** CI (IN-1) gates all future PRs. Pipeline hardening (IN-7) and i18n (IN-8) touch isolated files. Quick wins are all independent, small, and touch different components — zero merge conflict risk.

### Batch 2 — Core UX Features & CI Extensions (depends on Batch 1)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-2 Performance Budget | Infrastructure | Small | Claude Code |
| IN-5 SEO & Open Graph | Infrastructure | Medium | Claude Code |
| CF-1 Similar Neighborhoods | Core Feature | Medium | Claude Code |
| CF-2 Saved Favorites | Core Feature | Medium | Claude Code |
| CF-4 Radar Chart | Core Feature | Medium | Claude Code |
| PO-5 Empty State Handling | Polish | Small | Claude Code |

> **Why second:** Performance budget depends on CI. SEO is independent. The three core features (CF-1, CF-2, CF-4) each add new files/components without overlapping — CF-1 adds a utility, CF-2 adds a hook, CF-4 adds a component. PO-5 touches Tooltip and Map but only for null-value paths, not conflicting with others.

### Batch 3 — Polish & Advanced Features (depends on Batch 2)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-3 Shareable Score Card | Core Feature | Medium | Claude Code |
| CF-6 Neighborhood Finder Wizard | Core Feature | Medium | Claude Code |
| PO-1 Colorblind-Safe Palettes | Polish | Medium | Claude Code |
| PO-2 Onboarding Tour | Polish | Small | Claude Code |
| PO-4 Map Print Mode | Polish | Small | Claude Code |
| PO-6 Responsive Comparison | Polish | Small | Claude Code |

> **Why third:** Score card and wizard are new standalone components. Colorblind palettes touch colorScales.ts (safe now that Batch 2's features are stable). Onboarding tour, print mode, and responsive comparison are isolated to their own components/CSS.

### Batch 4 — Accessibility, E2E Tests & External Integrations (depends on Batch 3)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-4 E2E Tests (Playwright) | Infrastructure | Medium | Claude Code |
| IN-6 Error Tracking & Analytics | Infrastructure | Small | Manual Setup |
| PO-3 ARIA Live Regions | Polish | Medium | Claude Code |
| CF-5 Multi-Year Time-Series | Core Feature | Large | Manual Setup |
| IN-3 Data Pipeline Auto-Refresh | Infrastructure | Medium | Manual Setup |

> **Why last:** E2E tests benefit from a stable feature set. ARIA touches all components — best done when the component tree is settled. Time-series and auto-refresh require external service verification and secrets configuration. These are the highest-effort items with the most external dependencies.
