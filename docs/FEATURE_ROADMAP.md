# Naapurustot.fi — Feature Roadmap

> Generated 2026-03-16 from full codebase analysis.
> Status: **planning only** — nothing here has been implemented yet.

---

## Project Context

Naapurustot.fi is a client-side React/TypeScript SPA that visualizes demographic, economic, housing, and quality-of-life data for Helsinki metro area neighborhoods on an interactive MapLibre GL map. It currently ships 18 data layers, bilingual (FI/EN) support, dark/light themes, and a detailed neighborhood stats panel.

**Tech stack:** React 19, TypeScript 5.9, Vite 8, MapLibre GL, Turf.js, Tailwind CSS 3, PostCSS.
**Data:** Static GeoJSON (~1.1 MB) built from Statistics Finland Paavo, HSL Digitransit, HSY air quality, and property price APIs via a Python build script.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 URL Deep Linking

| | |
|---|---|
| **What** | Encode the selected neighborhood postal code and active layer in the URL hash/query params so users can share or bookmark a specific view. |
| **Why** | Currently there is no way to share a link to a specific neighborhood — every visit starts from scratch. |
| **Touches** | `src/App.tsx` (state init & sync), `src/hooks/useSelectedNeighborhood.ts`, `src/components/SearchBar.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Search Result Truncation Indicator

| | |
|---|---|
| **What** | When the autocomplete list is capped at 8 results, show a "N more results…" hint so users know to refine their query. |
| **Why** | With 100+ neighborhoods, users may not realize their target is just outside the visible list. |
| **Touches** | `src/components/SearchBar.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Keyboard Navigation for Search

| | |
|---|---|
| **What** | Arrow-key navigation through autocomplete results, Enter to select, Escape to close. |
| **Why** | Standard UX pattern that power users expect; improves accessibility. |
| **Touches** | `src/components/SearchBar.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Proper README

| | |
|---|---|
| **What** | Replace the boilerplate Vite README with a real project description, setup instructions, data-source attribution, and architecture overview. |
| **Why** | The current README says nothing about the project. New contributors and visitors have no context. |
| **Touches** | `README.md` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Tooltip Off-Screen Clamping

| | |
|---|---|
| **What** | Detect when the hover tooltip would overflow the viewport and flip/shift it so it stays fully visible. |
| **Why** | Neighborhoods at screen edges cause the tooltip to clip or disappear. |
| **Touches** | `src/components/Tooltip.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Neighborhood Comparison Mode

| | |
|---|---|
| **What** | Let users pin 2–3 neighborhoods and view them in a side-by-side stats table with highlighted differences. |
| **Why** | Comparing neighborhoods is the most natural follow-up after browsing individual ones — currently impossible without switching back and forth. |
| **Touches** | New component `src/components/ComparisonPanel.tsx`, `src/App.tsx` (multi-select state), `src/components/Map.tsx` (multi-highlight), `src/hooks/useSelectedNeighborhood.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Multi-Layer Filtering / Neighborhood Finder

| | |
|---|---|
| **What** | A "Find neighborhoods" mode where users set min/max thresholds on multiple layers (e.g., income > €35k AND transit density > 50) and matching neighborhoods are highlighted on the map with a ranked list. |
| **Why** | Browsing one layer at a time makes it hard to answer multi-criteria questions like "affordable areas with good transit." |
| **Touches** | New component `src/components/FilterPanel.tsx`, `src/App.tsx` (filter state), `src/components/Map.tsx` (filter-aware rendering), `src/utils/colorScales.ts` (layer metadata for ranges) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Noise Level Layer

| | |
|---|---|
| **What** | Implement the noise level data layer that already has translation keys (`layer.noise`) but no data pipeline or rendering. Source from HSY/Syke noise maps. |
| **Why** | Noise is a top concern for residents choosing neighborhoods; translations already promise this feature. |
| **Touches** | `scripts/prepare_data.py` (new data source), `src/utils/colorScales.ts` (new layer config), `src/components/LayerSelector.tsx` (add to group) |
| **Complexity** | Medium |
| **Dependencies** | Requires identifying and integrating a suitable noise data API or dataset. |
| **Tag** | Manual Setup (need to evaluate and register for noise data source) |

### CF-4 Data Export (CSV / PDF)

| | |
|---|---|
| **What** | Add export buttons to the NeighborhoodPanel: CSV for raw stats, and a styled PDF summary card. |
| **Why** | Real estate professionals and researchers need to get data out of the app for reports. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` (export buttons), new utility `src/utils/export.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Neighborhood Ranking View

| | |
|---|---|
| **What** | A togglable list/table view showing all neighborhoods ranked by the active layer, with sparkline bars. Clicking a row flies to that neighborhood. |
| **Why** | Map view is great for spatial patterns but bad for answering "which neighborhood has the highest X?" |
| **Touches** | New component `src/components/RankingTable.tsx`, `src/App.tsx` (toggle state) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-6 Time-Series Data / Historical Trends

| | |
|---|---|
| **What** | For layers where historical data is available (income, population, unemployment), show a mini line chart in the neighborhood panel showing change over time. |
| **Why** | Trends matter more than snapshots — a neighborhood getting better fast is more interesting than one that's already good but declining. |
| **Touches** | `scripts/prepare_data.py` (fetch multi-year data), new `src/components/TrendChart.tsx`, `src/components/NeighborhoodPanel.tsx`, GeoJSON schema expansion |
| **Complexity** | Large |
| **Dependencies** | Requires multi-year Paavo data availability check. |
| **Tag** | Manual Setup (verify multi-year data availability from Statistics Finland) |

---

## 3 — Polish

UX improvements, animations, better feedback, edge case handling.

### PO-1 Mobile-Optimized Layout

| | |
|---|---|
| **What** | Responsive redesign: bottom sheet for neighborhood panel, swipe-up layer selector, larger touch targets, collapsible controls. |
| **Why** | The app works on mobile but panels overlap the map and controls are small. Mobile is likely the majority of casual user traffic. |
| **Touches** | `src/App.tsx` (layout), `src/components/NeighborhoodPanel.tsx`, `src/components/LayerSelector.tsx`, `src/index.css`, `tailwind.config.js` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Colorblind-Safe Palettes

| | |
|---|---|
| **What** | Add alternative color scales (e.g., viridis, cividis) and a toggle in settings. Optionally add pattern fills for choropleth boundaries. |
| **Why** | ~8% of males have color vision deficiency. The current green-red scales are problematic. |
| **Touches** | `src/utils/colorScales.ts` (alternative palettes), `src/components/Legend.tsx`, new settings UI or toggle |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 ARIA Labels & Screen Reader Support

| | |
|---|---|
| **What** | Add ARIA roles, labels, and live regions to all interactive elements. Announce layer changes, selected neighborhood, and panel content to screen readers. |
| **Why** | The app currently has almost no ARIA markup outside the theme toggle — it is unusable for blind and low-vision users. |
| **Touches** | All components in `src/components/`, `src/App.tsx` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Smooth Layer Transition Animation

| | |
|---|---|
| **What** | Animate color changes when switching layers (crossfade or interpolate fill colors over ~300ms). |
| **Why** | Layer switches are currently instant and jarring — a brief transition makes the experience feel polished. |
| **Touches** | `src/components/Map.tsx` (paint property transitions) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Loading & Error States

| | |
|---|---|
| **What** | Show a skeleton/shimmer UI while GeoJSON loads, and a user-friendly error banner with retry button if the fetch fails. |
| **Why** | Currently a silent failure if the data doesn't load; users see an empty map with no explanation. |
| **Touches** | `src/hooks/useMapData.ts` (error state), `src/App.tsx` (error UI), new `src/components/ErrorBanner.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Onboarding Tour / First-Visit Hints

| | |
|---|---|
| **What** | A 3–4 step overlay tour for first-time visitors highlighting the layer selector, search, and neighborhood panel. Dismissed permanently via localStorage. |
| **Why** | New users may not discover the layer selector or realize they can click neighborhoods for details. |
| **Touches** | New component `src/components/OnboardingTour.tsx`, `src/App.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 Unit & Integration Test Suite

| | |
|---|---|
| **What** | Set up Vitest + React Testing Library. Write tests for: quality index calculation, metro average computation, color scale generation, formatting utilities, and key component rendering. |
| **Why** | Zero test coverage today. Any refactor or data change risks silent regressions — especially dangerous for the quality index and statistical calculations. |
| **Touches** | New `vitest.config.ts`, new `src/__tests__/` directory, `package.json` (devDeps) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 GeoJSON Caching & Compression

| | |
|---|---|
| **What** | Serve the GeoJSON gzipped with proper cache headers. Add a content hash to the filename for cache-busting. Consider topojson for ~60% size reduction. |
| **Why** | 1.1 MB is loaded fresh on every visit with no caching strategy. Returning visitors re-download the same data. |
| **Touches** | `vite.config.ts` (asset hashing), `public/data/` (compression), `src/hooks/useMapData.ts` (path update) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Environment Configuration

| | |
|---|---|
| **What** | Move hardcoded values (map center, zoom, basemap URL, data path) into Vite env variables with `.env` defaults. |
| **Why** | Enables staging/production environments, local development overrides, and makes the app adaptable to other metro regions. |
| **Touches** | New `.env`, `.env.example`, `vite.config.ts`, `src/components/Map.tsx`, `src/hooks/useMapData.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-4 CI Pipeline (Lint + Type-Check + Test)

| | |
|---|---|
| **What** | Add a GitHub Actions workflow that runs ESLint, `tsc --noEmit`, and Vitest on every push and PR. |
| **Why** | The current auto-merge workflow merges everything to main with no quality gate. Broken code can ship immediately. |
| **Touches** | `.github/workflows/ci.yml`, `package.json` (scripts) |
| **Complexity** | Small |
| **Dependencies** | IN-1 (test suite must exist first) |
| **Tag** | Claude Code |

### IN-5 Eliminate `any` Types

| | |
|---|---|
| **What** | Replace all `any` usages with proper types: MapLibre expression types, GeoJSON geometry unions, and typed feature properties. |
| **Why** | Multiple `any` casts bypass TypeScript's safety net, especially in Map.tsx, SearchBar.tsx, colorScales.ts, and qualityIndex.ts. |
| **Touches** | `src/components/Map.tsx`, `src/components/SearchBar.tsx`, `src/utils/colorScales.ts`, `src/utils/qualityIndex.ts`, `src/utils/metrics.ts` |
| **Complexity** | Small |
| **Dependencies** | IN-1 (tests protect against regressions during refactor) |
| **Tag** | Claude Code |

### IN-6 Data Pipeline Hardening

| | |
|---|---|
| **What** | Add retry logic, rate limiting, schema validation, and error reporting to `prepare_data.py`. Pin API versions. Add a `--dry-run` flag. |
| **Why** | The Python build script calls 4+ external APIs with no error handling — a transient failure silently produces bad data. |
| **Touches** | `scripts/prepare_data.py` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-7 Deployment Pipeline (Static Hosting)

| | |
|---|---|
| **What** | Add a GitHub Actions deploy workflow to push `dist/` to Vercel, Netlify, or GitHub Pages on merge to main. Include preview deploys for PRs. |
| **Why** | No automated deployment exists. Shipping requires manual steps. |
| **Touches** | `.github/workflows/deploy.yml`, potentially `vercel.json` or `netlify.toml` |
| **Complexity** | Small |
| **Dependencies** | IN-4 (CI should pass before deploy) |
| **Tag** | Manual Setup (requires hosting account creation and secret configuration) |

### IN-8 Error Tracking & Analytics

| | |
|---|---|
| **What** | Integrate a lightweight error tracker (e.g., Sentry) and privacy-respecting analytics (e.g., Plausible or Umami) to understand usage patterns and catch runtime errors. |
| **Why** | No visibility into whether users hit errors or which features are actually used. |
| **Touches** | `src/main.tsx` (init), `index.html` (analytics script), `package.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (requires Sentry/analytics account creation and DSN/keys) |

---

## Suggested Sequencing

Items within each batch can be safely developed as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete.

### Batch 1 — Foundation & Quick Wins (no dependencies)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-1 Unit & Integration Test Suite | Infrastructure | Medium | Claude Code |
| IN-3 Environment Configuration | Infrastructure | Small | Claude Code |
| IN-6 Data Pipeline Hardening | Infrastructure | Medium | Claude Code |
| QW-4 Proper README | Quick Win | Small | Claude Code |
| QW-5 Tooltip Off-Screen Clamping | Quick Win | Small | Claude Code |
| PO-5 Loading & Error States | Polish | Small | Claude Code |

> **Why first:** Tests (IN-1) and env config (IN-3) are foundational. The rest are isolated quick wins that touch no shared code.

### Batch 2 — CI, Type Safety & Core UX (depends on Batch 1)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| IN-4 CI Pipeline | Infrastructure | Small | Claude Code |
| IN-5 Eliminate `any` Types | Infrastructure | Small | Claude Code |
| QW-1 URL Deep Linking | Quick Win | Small | Claude Code |
| QW-2 Search Truncation Indicator | Quick Win | Small | Claude Code |
| QW-3 Keyboard Navigation for Search | Quick Win | Small | Claude Code |
| PO-4 Smooth Layer Transition | Polish | Small | Claude Code |

> **Why second:** CI and type cleanup depend on tests from Batch 1. Search improvements (QW-2, QW-3) touch the same file but different functions — safe in parallel. QW-1 and PO-4 are fully isolated.

### Batch 3 — Major Features (depends on Batch 2)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-1 Neighborhood Comparison Mode | Core Feature | Medium | Claude Code |
| CF-4 Data Export (CSV / PDF) | Core Feature | Medium | Claude Code |
| CF-5 Neighborhood Ranking View | Core Feature | Medium | Claude Code |
| PO-1 Mobile-Optimized Layout | Polish | Medium | Claude Code |
| IN-2 GeoJSON Caching & Compression | Infrastructure | Small | Claude Code |

> **Why third:** Comparison and ranking add new components without conflicting. Mobile layout touches existing components but is primarily CSS. GeoJSON caching is isolated to data loading.

### Batch 4 — Accessibility & External Integrations (depends on Batch 3)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| PO-2 Colorblind-Safe Palettes | Polish | Medium | Claude Code |
| PO-3 ARIA Labels & Screen Reader Support | Polish | Medium | Claude Code |
| PO-6 Onboarding Tour | Polish | Small | Claude Code |
| CF-3 Noise Level Layer | Core Feature | Medium | Manual Setup |
| IN-7 Deployment Pipeline | Infrastructure | Small | Manual Setup |
| IN-8 Error Tracking & Analytics | Infrastructure | Small | Manual Setup |

> **Why fourth:** Accessibility work (PO-2, PO-3) benefits from stable component APIs from prior batches. Manual Setup items can proceed whenever accounts are ready, but are grouped here so CI/CD is solid first.

### Batch 5 — Advanced Features (depends on Batch 4)

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-2 Multi-Layer Filtering | Core Feature | Large | Claude Code |
| CF-6 Time-Series Historical Trends | Core Feature | Large | Manual Setup |

> **Why last:** These are the highest-effort features. Filtering depends on stable layer metadata and rendering from prior batches. Time-series requires external data source verification and significant data pipeline changes.
