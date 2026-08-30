# Architecture

## Overview

naapurustot is a React + TypeScript SPA that visualizes postal-code-level statistics for all of Finland — 3,018 postal-code areas across 69 sub-regions (*seutukunnat*) — on an interactive MapLibre GL map. The frontend is fully static: all data ships as pre-built TopoJSON/JSON assets and every computation (quality index, filtering, similarity, correlation, aggregation) happens client-side. An optional Express backend provides user accounts and sync of favorites, shortlist, notes, and preferences.

The default landing view is the whole country (`DEFAULT_CITY = 'all'` in `src/utils/regions.ts`); individual regions load lazily as separate TopoJSON assets when selected. SEO-critical pages (~9,000 area profiles, region hubs) are pre-rendered to static HTML at build time.

```
Browser
┌──────────────────────────────────────────────────────────────────┐
│  index.html (theme anti-flash, JSON-LD, Umami)                   │
│  └── main.tsx — chunk-reload handler → SW registration →         │
│      Sentry (only if DSN set) → StrictMode > ThemeProvider >     │
│      BrowserRouter > ErrorBoundary > Suspense > Routes           │
│      ├── /            → App.tsx (the map application)            │
│      │     ├── Map.tsx (MapLibre GL, init-once)                  │
│      │     ├── SearchBar / CitySelector / LayerSelector / Legend │
│      │     ├── lazy panels: NeighborhoodPanel, ComparisonPanel,  │
│      │     │   RankingTable, RegionRankingTable, FilterPanel,    │
│      │     │   NeighborhoodWizard, CustomQualityPanel,           │
│      │     │   CorrelationExplorer, AreaSummaryPanel,            │
│      │     │   SplitMapView, TimeSlider, AuthModal,              │
│      │     │   OnboardingTour, ShortcutsOverlay                  │
│      │     └── TooltipOverlay / Settings / Tools dropdowns       │
│      ├── /alue/:slug (+ /en/area, /sv/omrade) → profile page     │
│      ├── data-sources + privacy pages (fi/en/sv)                 │
│      └── * → NotFoundPage                                        │
│  Static (outside React Router): /kaupungit, /kaupunki/{region}   │
│  hub pages + en/sv variants — prerendered HTML only              │
└──────────────────────────────────────────────────────────────────┘

Server (optional, Docker Compose on a DigitalOcean droplet)
┌──────────────────────────────────────────────────────────────────┐
│  Caddy (auto-HTTPS)                                              │
│  ├── api.naapurustot.fi → Express 5 API (auth + user-data sync)  │
│  ├── analytics.naapurustot.fi → Umami                            │
│  ├── PostgreSQL 16 (shared by API + Umami)                       │
│  └── db-backup sidecar (daily gzipped pg_dump)                   │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow

```
1. App starts on the all-Finland view (or ?city= region from the URL)
2. useMapData(regionId) loads data via dataLoader.ts:
   - Single region:  src/data/regions/{id}.topojson (one of 69 lazy
     assets via import.meta.glob)
   - 'all' view:     region_properties.json — geometry-stripped
     properties of all 3,018 areas; region outline geometry comes
     separately from src/data/seutukunnat.topojson
   - Each fetch is cached as a Promise (dedup); rejected promises are
     evicted so navigation retries after a transient failure
3. processTopology() runs a fixed pipeline (dataLoader.ts):
   a. TopoJSON → GeoJSON (topojson-client)
   b. coerceNumericProperties() — TopoJSON stringifies numbers; every
      property is coerced back except the ID_FIELDS set
   c. filterSmallIslands() — drops MultiPolygon islands < 15% of the
      largest polygon's area (skipped for the geometry-less all view)
   d. computeQualityIndices(features, weights, nationalRanges)
   e. computeChangeMetrics() — trend % from *_history arrays
   f. computeQuickWinMetrics() — demographic ratios from raw Paavo
   g. computeTimeSeriesValues() — flattens history arrays into per-year
      props (MapLibre expressions can't index JSON strings)
   h. computeMetroAverages() — population/household/jobs-weighted
4. GeoJSON + averages flow to App.tsx via useMapData and down as props
5. All-Finland view: buildMetroAreaFeatures() (metroAreas.ts) attaches
   pre-baked seutukunta boundary geometry and aggregates per-region
   averages; regions without data become gray _noData features
```

### Key design choice: mutable feature properties

Quality indices, change metrics, and quick-win metrics are computed by **mutating** GeoJSON feature properties in place. This avoids copying 3,018 features × 100+ properties, and means the Map's GeoJSON source always holds current values. React can't observe the mutation, so App threads a monotonic `qualityVersion` counter through `useMemo` dependency arrays and Map effects (some with `eslint-disable exhaustive-deps`) — removing those "unused" deps silently breaks quality-weight updates. Several utilities (`rescaleLayerToData`, similarity ranges, `collectRange`) cache by features-array *identity* for the same reason; in-place mutations don't invalidate them.

### Normalization: national ranges

Quality scores and percentiles are normalized against pre-computed, winsorized (p2/p98) national min/max/avg ranges in `src/data/national_ranges.json` (built by `scripts/build_national_ranges.mjs` over all 3,018 areas), so a region view never needs the full national dataset in memory and a given postal code scores identically in region and national views. The explicit "within region" comparison scope re-normalizes against the loaded region instead. Under national scope, a missing factor is imputed at the neutral midpoint (50); under region scope, the loaded-set mean. `hr_mtu` (median income) ≤ 0 is a Paavo missing-data sentinel and is special-cased as missing everywhere income is consumed.

## State management

There is no external state library. App.tsx owns the map/UI state; persistence is split between the URL, localStorage, and the optional server.

| State | Where | Persistence |
|-------|-------|-------------|
| GeoJSON + averages | `useMapData(regionId)` | In-memory promise cache per region |
| Selected area / pinned (max 3) | `useSelectedNeighborhood` (pure in-memory) | URL `?pno=` / `?compare=` written by App via `useSyncUrlState` |
| Active layer / region / scope / year | `useState` in App | URL (`?layer=`, `?city=`, `?scope=`, `?year=`), defaults omitted |
| Theme | `useTheme` Context | `naapurustot-theme` |
| Language (fi/en/sv) | module state in `i18n.ts` + `useI18nVersion` | `lang` |
| Colorblind mode | module state in `colorScales.ts` | `naapurustot-colorblind` |
| Quality weights | `useQualityWeights` | `naapurustot-quality-weights` + server + URL (`qp`/`qw`) |
| Favorites / shortlist / notes / filter presets / wizard profile | dedicated hooks | localStorage + debounced server sync when signed in |
| Affordability / similarity weights / home reference / recent areas | dedicated hooks & utils | localStorage (+ URL for shareable ones) |
| Auth session | `useAuth` | httpOnly JWT cookie; `has_session` localStorage flag skips the `/auth/me` probe for never-logged-in users |
| Hover tooltip | external store (`tooltipStore.ts`) | memory only |

### URL state

`useUrlState.ts` is the single codec for shareable state. `readInitialUrlState()` runs once at module scope; `useSyncUrlState()` writes changes through a 100 ms-debounced `history.replaceState`, suppressed until initial restoration has consumed the inbound params. Params: `pno`, `layer`, `compare`, `city`, `scope`, `year`, `cb`, `lang`, `ref`, `filter`, `qp`/`qw` (quality persona / weight diff), `iso`, `v` (viewport — only on explicitly built share links, never during sync), `sl` (shortlist), `aff`, `simw`, `draw`, `wp` (wizard), plus `_v` (schema version, currently 2; stamped only when a structured param is present, and future-versioned links drop structured params but keep primitives). Hand-edited values are clamped (viewport to Finland's bbox, draw polygons to 60 vertices, etc.). Legacy `#hash` links are migrated to query params on load. The version key is `_v`, deliberately not `sv` — that's the Swedish value of `lang`.

### The server-sync hook pattern

`useFavorites`, `useNotes`, `useShortlist`, `useFilterPresets`, `useQualityWeights`, and `useWizardProfile` all follow one pattern: localStorage is the source of truth; when `userId` becomes truthy they fetch the server copy and merge (each with domain-appropriate conflict rules — e.g. notes resolve by "longer text wins", weights by custom-beats-default); saves are debounced 1 s through `runSync` (`syncStatus.ts`, exponential backoff 2 s→2 min, status surfaced in UserMenu); pending saves flush on unmount; cross-tab `storage` events adopt the other tab's value with a `fromServerRef` guard suppressing the save echo. localStorage writes always happen in effects or timers, never inside setState updaters (StrictMode double-invokes those).

### Tooltip performance pattern

Hover state lives in an external store (`tooltipStore.ts`) subscribed via `useSyncExternalStore`, so ~60 Hz mousemove re-renders only `TooltipOverlay`, never the App tree. The tooltip element positions itself by mutating `style.transform` in `useLayoutEffect` (compositor-only — `left/top` would force layout at 60 Hz). `TooltipOverlay` must keep its `getServerSnapshot` argument or the prerenderer crashes.

## Map architecture (MapLibre GL)

`Map.tsx` (~1,500 lines) creates the map **once** and mutates it in place through ~20 independent `useEffect` hooks — init, theme (vector `setStyle` with a `transformStyle` that carries the data layers across the base swap), data (`setData`), layer switch (fill-color swap with a 150/200 ms cross-fade, skipped under reduced motion), quality version, grid overlay, isochrone, region boundaries, opacity, filter/wizard/pinned/selection highlights, draw mode, flyTo, resize. The `[data]` effect deliberately depends only on `data`; everything else has its own effect so a quality-weight slider tick doesn't tear down the layer stack.

Event handlers attach exactly once and read state through refs. Hover/selection use MapLibre **feature-state** (source `promoteId: 'pno'`) with rAF-throttled mousemove — no per-frame `setFilter`.

### Layer stack (bottom → top)

| Layer id | Type | Purpose |
|----------|------|---------|
| basemap fills/roads (OpenFreeMap) | vector | Basemap; light/dark swapped via `setStyle` (shared `openmaptiles` source) |
| `seutukunnat-boundary-line` | line | Region outlines (added at browser idle; ~199 KB fetch) |
| `neighborhoods-fill` | fill | The choropleth |
| `grid-fill` | fill | 250–500 m grid overlay; cross-fades with the postal fill over zoom 7→8.5 |
| `neighborhoods-line` | line | Postal-code borders — **excludes** `_isMetroArea` features |
| `neighborhoods-metro-line` | line | Region outlines in the all-Finland view (`_isMetroArea` only) |
| `isochrone-fill` / `-line` | fill/line | Travel-time reachable area |
| `neighborhoods-highlight` | line | Hover/selection (feature-state driven) |
| `neighborhoods-no-data-pattern` | fill | Diagonal-hatch pattern on missing-data areas |
| pinned / select-area / filter / wizard highlights, 6 `draw-*` layers | line/fill | Added on demand, below the basemap's roads/labels |
| basemap roads + place labels (OpenFreeMap) | line/symbol | Drawn on top of the choropleth — data layers are inserted below the base style's first road/label layer, so roads and labels stay crisp (replaces the old raster labels overlay + roads-ghost) |

MapLibre gotchas this file works around (don't regress them):

- **Never replace a state-dependent paint expression with a constant** — MapLibre keeps a stale binder and the next `setFeatureState` throws `this.expression.evaluate is not a function`. Hide layers by passing opacity 0 through `buildFillOpacity()` instead.
- **Gate post-init work on the persistent `mapStyleLoadedRef`, not `map.isStyleLoaded()`** — the latter returns false during any in-flight `setData` re-parse, and queuing on the already-fired one-shot `load` event silently drops the work.
- Grid data can win the race against the main data effect; `addGridLayer` defers via a ref until the base layers exist.
- The no-data hatch is a runtime-generated canvas image; style reloads drop images, so `ensureHatchImage` wires a one-time `styleimagemissing` handler. Always use it, never raw `addImage`.
- iOS Safari resize is unreliable; the component layers a debounced ResizeObserver, `visualViewport`, `orientationchange`, `pageshow`, staggered settle timers, and canvas-pixel verification.

`SplitMapView.tsx` runs two camera-synced maps (mutual `jumpTo` with a reentry guard); each pane needs its own freshly built style object (MapLibre mutates style internals) and uses pane-local tooltip state, not the global store. `MiniMap.tsx` (profile pages) is non-interactive and self-catches errors inside the async `load` callback — iOS WebKit can throw there, bypassing the ErrorBoundary.

### All-Finland view (metro areas)

`metroAreas.ts` no longer dissolves polygons with `@turf/union`. Region geometry is **pre-baked** into `src/data/seutukunnat.topojson` (built by `scripts/build_seutukunta_boundaries.mjs` from the official Tilastokeskus seutukunta boundaries) and fetched lazily; the runtime fallback while it loads is raw MultiPolygon concatenation. The cache (`metroAreaCache`) records whether it was built with outlines (`usedOutlines`) and rebuilds when they arrive — do not remove that check, or the all-Finland view can lock onto the fallback that shows internal postal borders. `ensureOutlinesLoaded` also resets its promise on failure *and* on an empty parse for the same reason. Both `Map.tsx` and `SplitMapView.tsx` must keep filtering `_isMetroArea` features out of the regular line/no-data layers. Dataless regions are emitted into the same source as `_noData: true` features so they share hover/click behavior. `clearMetroAreaCache({ qualityIndexOnly: true })` recomputes only per-region quality averages — the dominant cost of dragging a quality-weight slider in the all-Finland view.

### Grid overlays

`useGridData` discovers sub-postal-code grids from `src/data/grid_manifest.json` (currently `air_quality`, ~250 m TopoJSON, Helsinki region; `light_pollution`, ~500 m GeoJSON, national) and fetches them the first time a grid-capable layer activates. The grid fades in over zoom 7→8.5 while the postal choropleth fades out (`gridFade.ts`). Fetch failures fall back silently to the postal choropleth. Grid cells are clipped to the active region in two stages: a synchronous centroid-bbox pass paints immediately, then a lazy `@turf/boolean-point-in-polygon` pass refines.

## Quality Index

See [`QUALITY_INDEX.md`](QUALITY_INDEX.md) for the full methodology. In short: `src/utils/qualityIndex.ts` defines 69 weightable factors of which 13 carry default weights whose magnitudes sum to 100, organized into four evaluative dimensions — Safety 30 (crime 26, traffic accidents 4), Health & environment 28 (air 9, tree canopy 8, noise 7, water proximity 4), Livelihood 26 (employment 12, income 10, education 4), Everyday life 16 (walkability 7, cycling 3, transit 3, services 3) — plus two descriptive zero-weight dimensions (housing, demographics). Factors are normalized 0–100 against the national ranges, reconciled with their label via `invert` (a data fact: the raw column runs opposite to the label), pointed at the user's preferred end by the SIGN of the weight (every slider is signed −100…+100 with zero in the middle; hazard-labelled factors therefore carry negative defaults, e.g. noise −7), weighted by |weight|, and rounded to an integer (UI badges assume `Number.isInteger`). Users customize weights in `CustomQualityPanel` (7 persona presets, cloud-synced); changes recompute in place (debounced 150–200 ms) and bump `qualityVersion`.

## Internationalization

Three locales — `fi.json`, `en.json`, `sv.json` (flat key-value, ~850 keys each, enforced 1:1 by `i18nKeyParity.test.ts` including placeholder tokens). Finnish is statically bundled; **English and Swedish are `?url` imports fetched at runtime** so ~45 KB of JSON each stays out of the gzipped-JS bundle budget — never convert them to static imports. Fallback chains: sv → en → fi → key; en → fi → key; fi → en → key. `t()` reads module state; `React.memo` components that call `t()` in render **must** also call `useI18nVersion()` (a `useSyncExternalStore` version counter) or they keep showing the Finnish fallback after the lazy dictionary arrives. Language persists in localStorage `lang`, is settable via `?lang=`, and drives `document.documentElement.lang`.

## Hooks reference

All 25 hooks in `src/hooks/`:

| Hook | Purpose | Persistence |
|------|---------|-------------|
| `useMapData(regionId)` | Load + process region data; returns `{ data, loading, error, metroAverages, retry }`. Resets state *during render* on region change so consumers never see stale features. | memory |
| `useGridData(layerId)` | Lazy grid overlays via `grid_manifest.json` | memory |
| `useSearchIndex()` | Geometry-stripped national search index (shares `loadAllData()`'s cache) | memory |
| `useAllCitiesUnionPreload(city)` | Starts the seutukunta-outlines fetch as soon as the all view is selected; bumps a counter when ready | memory |
| `useAllCitiesAggregates(city)` | Prebuilt per-region aggregates (`region_aggregates.json`) for the all-Finland view | memory |
| `usePlanningData` | Lazy loaders for the kaavat & hankkeet (planning) overlay datasets + region manifest | memory |
| `useSelectedNeighborhood()` | Selected + up to 3 pinned (in-memory; App syncs to URL) | URL via App |
| `useUrlState` | `readInitialUrlState` / `useSyncUrlState` / share-URL builders | URL |
| `useTheme()` | dark/light/system Context | `naapurustot-theme` |
| `useAuth()` | `{ user, loading, login, signup, logout, exportData, deleteAccount }` | httpOnly cookie + `has_session` flag |
| `useFavorites(userId?)` | One-tap favorites | localStorage + server |
| `useShortlist(userId?)` | Durable shortlist; adopts URL-shared lists via merge | localStorage + server |
| `useNotes(userId?)` | Per-area notes (5,000 chars; 500 ms local / 1 s server debounce) | localStorage + server |
| `useFilterPresets(userId?)` | Named filter presets (cap 50) | localStorage + server |
| `useQualityWeights(userId?)` | Quality-index weights | localStorage + server |
| `useWizardProfile(userId?)` | Wizard answers (server sync is client-side only — the API currently ignores `wizardProfile`) | localStorage (+ URL `wp`) |
| `useAffordability(initial?)` | Budget inputs; URL-shared value wins on first load | localStorage (+ URL `aff`) |
| `useSimilarityMetrics(initial?)` | Per-metric similarity weights 0–3; persists only the non-default diff | localStorage (+ URL `simw`) |
| `useRecentNeighborhoods()` | Last 10 searched areas (**localStorage**, not sessionStorage) | `naapurustot-recent` |
| `useBottomSheet(opts)` | Touch-drag sheet with velocity snapping (peek/half/full) | none |
| `useSwipeNavigation(opts)` | Horizontal section swiping | none |
| `useBackGesture(active, onClose)` | Hardware back / edge-swipe dismissal of mobile sheets & modals (history-entry based) | none |
| `useFocusTrap(ref)` | Contain Tab focus within `aria-modal` dialogs | none |
| `useAnimatedValue(target)` | rAF ease-out count-up; instant under reduced motion | none |
| `useReducedMotion()` | Reactive `prefers-reduced-motion` (+ non-hook `prefersReducedMotion()`) | none |

## Code splitting & the bundle budget

CI enforces a hard budget — **314,000 bytes gzipped for the sum of all app JS chunks, lazy ones included**, excluding only the `maplibre` chunk — and the app sits ~1 KB under it. Lazy-loading a dependency does *not* exempt it; keeping data out of JS entirely does. Hence the standing strategy:

- Manual chunks: `maplibre`, `vendor` (react, react-dom, react-router). Turf modules are deliberately *not* grouped — each feature lazy-imports the one it needs (`@turf/bbox`, `@turf/boolean-point-in-polygon`, `@turf/boolean-intersects`, `@turf/area`, `@turf/helpers`).
- Heavy data is fetched as hashed static assets, never imported into JS: the 69 region TopoJSONs (`import.meta.glob` with `?url`), `region_properties.json` (~10.6 MB), `adjacency.json`, `en.json`/`sv.json` locales, the seutukunta outlines.
- Build-time `define`s (`__BUILD_DATE__`, `__COVERAGE_PCT__`) inline just the needed slices of `build_metadata.json` instead of the whole file. `vitest.config.ts` is standalone and must mirror these defines or component tests crash.
- `React.lazy` panels: NeighborhoodPanel, ComparisonPanel (mounts only with ≥1 pin), RankingTable, RegionRankingTable, FilterPanel, CustomQualityPanel, NeighborhoodWizard, CorrelationExplorer, SplitMapView, AreaSummaryPanel, TimeSlider, AuthModal, OnboardingTour, ShortcutsOverlay; route-level: profile, data-sources, privacy, 404 pages. Chart widgets (TrendChart, RadarChart, Sparkline, IsochroneControls) ship inside the panel chunks that use them. html-to-image (~30 KB) and qrcode.react (~12 KB) load on click.

## Authentication & server (optional)

The backend is fully optional — `api.ts` returns `{ error }` objects instead of throwing on network failure, `useAuth` simply stays logged out, and every synced hook falls back to localStorage.

- **Endpoints** (Express 5, JSON body capped at 16 KB): `GET /health`; `POST /auth/signup` (Turnstile-gated, rate-limited 3/IP/day), `POST /auth/login` (10/IP/15 min, timing-safe against username enumeration via a dummy bcrypt compare), `POST /auth/logout`, `GET /auth/me`; `GET`/`PUT` for `favorites`, `shortlist`, `notes`, `preferences` (filter presets + quality weights, partial updates); GDPR `GET /auth/export` and `DELETE /auth/account` (requires literal `confirm: "DELETE"`); password reset `POST /auth/forgot-password` (5/IP/hour) and `POST /auth/reset-password` (10/IP/hour), plus `PATCH /auth/email` and `PATCH /auth/password` (both 10/user/hour, both re-verify the current password).
- **Sessions**: 7-day JWT (`{userId, tv}`, `JWT_SECRET` — required in production) in an httpOnly, Secure, `SameSite=None` cookie. `tv` is the credential generation: `resolveUser` compares it against `users.token_version` on every request, and a completed password reset increments that column — which is what makes a reset actually end other sessions instead of leaving a stolen 7-day cookie alive. Pre-`tv` tokens read as generation 0 (the column default), so shipping it signed nobody out.
- **Validation**: bcrypt cost 12; passwords 12–1000 chars; usernames `/^[a-zA-Z0-9_-]{3,20}$/` lowercased; favorites/shortlist max 200 ids; notes max 500 × 5,000 chars; weights finite in [-100,100].
- **Rate limiting** is an in-process Map keyed on `req.ip` with `trust proxy = 1` (one hop = Caddy). Never hand-parse `X-Forwarded-For` — the leftmost entry is attacker-controlled and a previous implementation allowed limit-bucket minting.
- **Turnstile**: verified server-side on signup; an unset `TURNSTILE_SECRET` silently disables the check, a Cloudflare outage fails closed. Tokens are single-use — the client remounts the widget after a failed signup.
- **Database** (PostgreSQL 16, tables auto-created with `CREATE TABLE IF NOT EXISTS`; column changes go through the forward-only migration runner in `db.ts`, serialized on a pg advisory lock): `users` plus four JSONB tables keyed `user_id UUID PK FK ... ON DELETE CASCADE` (`user_favorites`, `user_notes`, `user_preferences`, `user_shortlist`) and `password_reset_tokens` (SHA-256 hash only, 1-hour expiry, single-use, redeemed by one atomic conditional `UPDATE ... RETURNING`).
- **Password reset**: `POST /auth/forgot-password` answers `200 {ok:true}` for every address — real, unknown or malformed — and answers *before* doing the lookup or the send, so neither the body nor the latency is an account-enumeration oracle. Mail goes out via Resend (`mailer.ts`, no SDK — global `fetch`), which no-ops when `RESEND_API_KEY` is unset. The emailed link points at `/uusi-salasana/`, a real prerendered directory. A client-only route would work — `deploy.yml` copies `index.html` over `404.html`, so Pages serves the SPA shell for unknown paths and the router matches client-side — but it would answer HTTP 404 with `robots: index, follow` and a canonical pointing at `/`. Prerendering gets it a 200, a noindex and its own title. (The redirect stub in `public/404.html`, which *would* drop the path, survives only in local `npm run preview`.)
- Email is **optional** at signup, so accounts without one cannot be recovered; `PATCH /auth/email` (re-authenticated with the current password, because the address is the reset channel) lets users add one later, surfaced in `UserMenu`.
- **Changing a password while signed in** (`PATCH /auth/password`) bumps `token_version` like a reset but RE-ISSUES the caller's cookie against the new generation, so only the other sessions die. It also rejects reuse of the current password, which the reset path deliberately allows — see server/README.md for why the two differ.
- Known gap: the client sends `wizardProfile` in `PUT /auth/preferences` but the server ignores it (and a wizardProfile-only PUT gets a 400) — CF-4 server support is unimplemented.

## Build pipeline

```
npm run build = tsc -b && vite build
├── manualChunks: maplibre, vendor; assetsInlineLimit 0 (data always
│   emitted as hashed assets)
├── define: __BUILD_DATE__, __COVERAGE_PCT__ (from build_metadata.json)
├── sentryVitePlugin only when SENTRY_AUTH_TOKEN is set: hidden source
│   maps uploaded then deleted from dist/
├── compression: gzip + Brotli for js/css/html/json/topojson/svg ≥1 KB
├── VitePWA (prompt): precache js/css/icons only — HTML excluded
│   (NetworkFirst, 3 s timeout), OpenFreeMap tiles CacheFirst (500/30 d),
│   topojson/geojson StaleWhileRevalidate (20/30 d). main.tsx defers
│   the update reload until the tab is hidden (no mid-session reset)
├── stripBuildOnlyData plugin: deletes metro_neighborhoods.geojson and
│   converted *_grid.geojson from dist/ (≈40 MB of pipeline inputs)
└── rollup-plugin-visualizer → dist/stats.html
```

`npm run build:pages` (deploy only) runs `prerender.mjs` + `prerender-hubs.mjs` + `generate-sitemap.mjs`. The prerenderer imports the app's `.ts` modules directly under Node's type stripping (Node 22.18+) and clones `dist/index.html` with first-match regexes over `<title>`, meta tags, `</head>`, and `<noscript>` — **never add those tokens to index.html's head, even in comments**, or every prerendered page silently corrupts. Each area page embeds a JSON payload (`#__naapurustot_profile__`) so profiles render without fetching the 10.6 MB properties file, plus per-area JSON-LD and a social card. Hub pages and the sitemap (~9,270 URLs with hreflang alternates) are generated alongside.

The social card is emitted as a content-hashed **SVG**, but the published asset is the **PNG** sibling (`og:image`/`twitter:image` both point at `.png` — Facebook, LinkedIn, WhatsApp and X do not render SVG). `scripts/rasterize-cards.mjs` renders the PNGs in deploy only, then **deletes the SVGs**: they are build inputs, not published assets. Two invariants keep the published tree from growing without bound, and both have already failed once — see "Social-card cache" below.

Rendering runs as an orchestrator over process-isolated batches, one child per core. The process isolation bounds memory — `@resvg/resvg-js` retains ~3 MiB per card (a 1200×630 RGBA pixmap the native allocator does not return), which OOM-killed the deploy back when all ~9,000 cards rendered in one long-lived process. Because the ~200 MiB fixed cost per child does not divide across workers, the batch size scales *down* as concurrency scales up, holding the total peak at ~1.4 GB. A cold pass over all 9,261 cards takes ~3m50s on a 4-vCPU runner; it took ~14m30s when the batches ran sequentially on one core.

## Data pipeline

```
scripts/prepare_data.py  (Python; nationwide by default — 69 seutukunnat,
│                         308 municipalities; a full run takes hours)
├── Paavo postal-code geometries + statistics (Statistics Finland WFS /
│   PxWeb, 6-year history), auto-detected latest vintage
├── Direct APIs: PxWeb prices/rents, HSL Digitransit stops, HSY air
│   quality, Overpass POIs per region bbox (1 s rate limit, cached)
├── Pre-computed scripts/*.json from 24 fetch_*.py scripts: crime,
│   school quality, noise, VIIRS light pollution, voter turnout,
│   broadband, EV charging, tree canopy, transit reachability, LIPAS
│   sports, water proximity, building age, price history, …
├── Derived metrics (walkability composite, price-to-rent, ~20 ratios)
├── Resilience: 3× retry w/ backoff, atomic UTF-8 cache writes
│   (scripts/cache/), fallback to cache, _backfill_nulls restores any
│   still-null column from the previous output (a failed source shows
│   stale values, not gaps — read the run log)
└── → public/data/metro_neighborhoods.geojson (~39 MB, 3,018 features)

python scripts/validate_data.py   # feature count, ranges, no all-null
│   columns, registry/provenance lockstep (data_sources.json ↔
│   provenance.json), proxy flags, coverage regression vs baseline
│   (--write-baseline after intentional changes)

npm run build:data
├── build_region_data.mjs    # split by city → 69 topojson (geo2topo
│   -q 1e5, no simplify) + region_properties.json + adjacency.json +
│   region_coverage.json + region_payload_manifest.json +
│   build_metadata.json
├── build_national_ranges.mjs # winsorized p2/p98 ranges, 161 metrics
└── build_grid_data.mjs       # *_grid.geojson → topojson if ≤5 MiB,
                              # else served raw; writes grid_manifest.json
```

### Density precision (do not lower it)

Every per-km² metric is stored at **4 decimals** (`prepare_data.POI_DENSITY_DECIMALS`, mirrored in `fetch_lipas.py`, `fetch_ev_charging.py`, `fetch_transit_stops.py`, and `METRIC_DEFS` in `src/utils/metrics.ts`). This is not cosmetic. Densities were stored at 1 decimal until 2026-08, which meant anything below 0.05/km² became exactly `0.0` — and since the median Finnish postal area is 52 km² and 2,238 of the 3,018 areas exceed 20 km², *a single real shop, school or clinic rounded away in three-quarters of the country*. 3,169 (metric, area) pairs shipped a measured-looking zero with a facility actually inside the polygon. Four decimals is the coarsest precision at which nothing can: the largest postal area (99800 Ivalo, 7,143.8 km²) yields 1/7143.8 = 0.00014.

The five consumer-facing service layers also persist the raw integer count (`grocery_count`, `school_count`, `daycare_count`, `healthcare_count`, `restaurant_count`) alongside the density. The count is what the profile page renders — "6 grocery stores" is a claim we can stand behind; the density it used to round to was not. `validate_data.check_dense_urban_zero` hard-fails on a positive count with a zero density. `cycling_density` deliberately has no count: it counts OSM way *records*, so it measures how finely contributors split ways rather than any physical quantity.

Proxy metrics (municipality-level values distributed to postal codes — crime index, construction year; regression-based transit reachability outside Helsinki) must carry `is_proxy: true` in `data_sources.json`; validation hard-fails otherwise and the UI badges them as estimates. The rental-price PxWeb table was retired upstream: its fetch 400s *by design* and falls back to the committed snapshot — don't "fix" it. `data-refresh.yml` re-runs the pipeline quarterly and opens a PR on changes.

## Routing & prerendered pages

React routes (`src/main.tsx`): `/`, profile pages `/alue/:slug` · `/en/area/:slug` · `/sv/omrade/:slug`, data-sources and privacy pages in three languages, `*` → 404. Slug format `{pno}-{slugified-name}`; the 5-digit prefix makes lookup O(1) and `parseSlug` accepts the postal code alone. Hub/directory pages (`/kaupungit/`, `/kaupunki/{region}/` + language variants) are prerendered static HTML **outside** React Router — client-side `<Link>`s to them would 404.

The profile page reads the prerender-embedded payload for instant paint (guarded by a pno equality check), hydrates region geometry and the national dataset in the background, and manages its own SEO tags (restoring them on unmount). App.tsx separately rewrites SEO tags for `?pno=` selections — two systems that stay consistent only because their routes don't overlap.

## Testing & CI/CD

- **Unit**: 170+ Vitest files, jsdom (`vitest.config.ts` is standalone — it does not inherit `vite.config.ts`). Locale dictionaries are injected synchronously in `setup.ts`. Many files are coverage-driven variants (`*Deep`, `*Critical`, `*Edge`…) — search by module prefix before adding a new file. `criticalInvariants.test.ts` pins worst-regression behaviors.
- **Coverage ratchet**: CI compares `vitest --coverage` totals against `coverage-baseline.json` with 0.5 pp tolerance, downward-only; raise the baseline manually to lock in gains.
- **E2E**: Playwright `e2e` project (chromium) against `vite preview` on :4173 — build first. 7 specs incl. axe-core a11y (serious/critical only, map canvas excluded). Hard 300 s global timeout for the whole run.
- **Visual**: 6 screenshots, but baselines are deliberately not committed — CI regenerates them per run, so the gate only catches intra-run flakiness. Don't commit baselines.
- **Lighthouse CI**: 3 runs, assertions on the median. A11y/best-practices/SEO ≥0.95 (error) everywhere; performance ≥0.78 (error) on prerendered profile pages, warn-only ≥0.4 on the SPA root.

| Workflow | Trigger | Notes |
|----------|---------|-------|
| `ci.yml` | push/PR to main | 3 parallel jobs (security audits / lint+type+test+build+e2e+visual+bundle / lighthouse); **skips claude/* PRs entirely**; bundle-delta PR comment; budget 314,000 B gzip (the shared `BUDGET` in `scripts/check-bundle-size.mjs`) |
| `auto-merge.yml` | push to `claude/**` | The only gate for those branches: parallel jobs mirroring CI (security / checks / data-validation / e2e / lighthouse / server; no visual tests). `data-validation` runs the FULL `validate_data.py` suite when the branch touches `public/data/**` or `scripts/**`, then `merge --no-ff` to main with push-retry/backoff (conflicts fail immediately), branch delete, **explicit** `gh workflow run deploy.yml` (bot pushes don't trigger workflows). Concurrency group cancels an in-flight run when a second claude/* branch pushes — serialize or stack branches |
| `deploy.yml` | CI success on main / manual | build (+ Sentry secrets) → `build:pages` → rasterize social cards → dist-size guard → 404 fallback copy → GitHub Pages |
| `deploy-server.yml` | push to main touching `server/**` / manual | SSH → `git pull` → rebuild api → `compose up -d` |
| `data-refresh.yml` | quarterly cron / manual | pipeline + validation → PR on change |
| `health-check.yml` | daily cron | site/API/sitemap/data-age checks → GitHub issue on failure |
| `codeql.yml` | push/PR + weekly | JS/TS + Python |
| `issue-to-pr.yml` | issue labeled `claude` | Claude Code action implements the issue |

### Social-card cache

Rasterizing ~9,261 social cards takes minutes, so `deploy.yml` caches `dist/og` across
deploys under a content-derived key with a `restore-keys: og-cards-` prefix fallback. That
cache is a **ratchet** unless two invariants hold, and in Aug 2026 both were broken at once:

1. **`prerender-hubs.mjs` deletes every cache-restored `*.svg` before emitting its own.**
   `rasterize-cards.mjs` prunes a PNG only when no SVG of that (content-hashed) name
   remains, so a surviving stale SVG kept its stale PNG alive and neither was ever
   collected — each deploy layered on one more data-version of cards.
2. **`rasterize-cards.mjs` deletes the SVGs once the PNGs exist.** The cache is saved from
   `dist/og` itself, so anything left there is carried into the next deploy *and* uploaded.
   The SVGs are inputs; nothing in `src/` or the prerendered HTML fetches `/og/*.svg`.

Without them the tree reached **2.4 GB / ~65,000 files** (32,538 in `dist/og` against
~9,000 real cards). Nothing failed loudly: the `deploy` dist-size guard had been made
warn-only, so the only symptom was the Pages sync creeping up until it passed
`actions/deploy-pages`' **10-minute default timeout** — 9m52s on the last green run, then
three straight failures stuck in `deployment_queued`. `deploy.yml` now sets that timeout
explicitly, but it is a backstop; the invariants above are the actual fix.

`npm run dist:check` (the `pages` profile) is the hard pre-merge gate on the prerendered
mesh, which is where combinatorial page growth lives. The `deploy` profile guards the full
post-rasterize tree.
