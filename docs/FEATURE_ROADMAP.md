# naapurustot.fi — Feature Roadmap

> Generated 2026-07-22. **Supersedes the 2026-07-17 roadmap**, whose six non-data items (IN-1, QW-2, QW-3, CF-3, PO-1, PO-2) all shipped in `0484d99` along with all 19 findings of the 2026-07-17 UX review. Its three new-data items were deliberately skipped and are re-triaged here. Item IDs are fresh and do not map to the prior roadmap's.
>
> **Method.** Seven parallel subsystem readers, eight proposal lenses (50 candidates), then every claim below re-verified by hand against the live tree — file:line greps, and direct measurement of `src/data/region_properties.json`, `dist/sitemap.xml` and the shipped grid assets. Numbers in this document are measured, not estimated.

## The headline

Three fronts, in priority order:

1. **The app publishes values nobody measured.** 74.0 % of Finland carries an identical fabricated `noise_pollution` of 40.0 dB, 72.1 % carries `active_plan_count: 0` that means "this city publishes no WFS", and 13,500 Paavo `-1` suppression sentinels are live in the public open-data CSV and the frozen `/api/v1` JSON. All three are registered `is_proxy: false` at 100 % coverage, so the honesty UI built for exactly this case stays silent. This violates the project's own hardest rule.
2. **The content mesh is half-orphaned and the entry view undersells itself.** 10,653 of 19,927 prerendered pages — every ranking, comparison, planning and municipality hub — receive zero links from the running app. Meanwhile the landing choropleth paints 69 regions into 2 of 8 colour bands, and the region deep link the landing view itself produces is unreadable and costs a pointless 12.3 MB.
3. **The decision funnel converges on nothing.** The shortlist — the one surface a returning user comes back to, and the only real argument for an account — is a row of undifferentiated name chips carrying no metric, no score and no sort.

## The bundle-budget reality (read before implementing anything)

CI fails when the gzipped sum of **all** app JS (lazy chunks included, only `maplibre-*` excluded) exceeds `BUDGET` in `scripts/check-bundle-size.mjs` — currently **314,000 bytes**, last measured **312,774** (~1.2 KB headroom). Measure with `npm run bundle:check` before every push. `fi.json` is statically bundled and costs budget; `en.json`/`sv.json` are lazy `?url` assets and are free. Build-time, prerender and `?url`-asset surfaces cost zero bundle bytes. The bundled items below total ~2.5–3.4 KB, so this roadmap needs a raise to roughly **318,000** — taken **once per batch by the designated bumper named in the sequencing section** (history 256 → 280 → … → 314).

## Data integrity & granularity (non-negotiable)

Every value must trace to a real, verifiable, open-licensed source — never fabricated, estimated or placeholder. Prefer postal-or-finer; municipality-distributed values must be flagged `is_proxy: true`. Suppressed source values (Paavo `-1`) become no-data, never a number. IN-1 exists because the codebase currently breaks this in three places.

## Deliberately excluded — do not re-propose

Owner and prior-audit exclusions carry over: affordability calculator; neighbour-ring highlight; green-space layer; demographic 250 m grid; OSM building footprints; MML elevation; commute-destination filter; HAME maakuntakaava; **national asemakaava coverage from Ryhti** (verified near-empty until the 1 Jan 2029 statutory deadline).

**Value-pruned in this pass** — all verified real, all fair game later, listed so they are not re-discovered as new:

- ⚠️ **Off-site encrypted database backups** — `server/backup.sh:35-38` pipes `pg_dump` into a bind mount on the same droplet and swallows failures with `|| true`; `postgres_data` is `external: true`. A droplet loss destroys every account, favourite, shortlist and note **together with the only copy of the backups**, and a persistently failing dump signals nothing. This is the one pruned item whose downside is unrecoverable rather than merely annoying. **Tag: Manual Setup** (needs an object-storage bucket + credentials). Promote it into a batch if the account system has real users.
- **Server route tests** — `auth.routes.test.ts` has 7 tests; signup, login, `GET /export` and `DELETE /account` have none, and the CI type-check that nominally guards them checks zero files (see IN-2).
- **The 11.3 MB `light_pollution_grid.geojson`** — the only grid never converted to TopoJSON, served whole on `?city=all` (`useGridData.ts:155-158` applies its 69 existing shards only when `cityFilter !== 'all'`), with no `.gz` sidecar because `vite.config.ts:149-150`'s compression filter omits `.geojson`. One layer tap ≈ 18 s on 5 Mbps.
- **Distance-to-nearest essential services** (grocery / health / pharmacy / school, `euref_x`/`euref_y` centroids + the existing `_point_to_pno` STRtree) — the honest alternative to the four /km² density layers; pharmacy is a wholly missing category. Large; dropped only on the three-per-category cap.
- **`water_proximity_m` and `walkability_index` are degenerate** — 2,789/3,018 areas read exactly 0 m (measured from the polygon edge, so any area clipping a stream scores 0) and `walkability_index` has 37 distinct values nationally with 1,412 areas sharing the value 76. Both feed the Quality Index and the wizard fit score. IN-1's distinctness check will flag them; fixing them is separate work.
- **Ryhti building-permit flow** to replace the municipality-distributed `construction_activity` proxy; **sliding JWT session** (7-day `expiresIn` at `auth.ts:165,226` with no reissue, so a returning user is logged out every week); **password change / recovery code** (no such route exists — a forgotten password destroys the account); **mobile focus traps** (`useFocusTrap`'s selector ignores `inert`, and five sheets declare `role="dialog"` with no trap at all); **PWA offline** (`vite.config.ts` caches no `.json`, so the default view cannot paint offline); **provenance columns in CSV/PDF exports**; **EN/SV `/avoin-data/` pages** (translations written and shipped as dead code at `build_open_data.mjs:470`); **`llms.txt` documents 3 of 12 page families**; **merge-lane hardening** (`checks`/`e2e`/`merge-to-main` have no `timeout-minutes`, floating `appleboy/ssh-action@v1` holds the production root key, no Dependabot).

---

## 1 — Quick Wins

### QW-1 Two zero-fetch Paavo layers: low-income share and job self-sufficiency

| | |
|---|---|
| **What** | Derive in `prepare_data.py::calculate_metrics` from columns already on every shipped feature: `low_income_pct = hr_pi_tul / hr_tuy * 100` and `job_self_sufficiency = tp_tyopy / pt_tyoll * 100`. Guard the `-1` sentinel and zero denominators — emit no-data, never a number. Register two `LayerId`s + `LayerConfig`s in `colorScales.ts` (low-income sequential, `higherIsBetter:false`; job self-sufficiency **diverging centred at 100**, unbounded above — city centres exceed 300), `LAYER_GROUPS` entries, `metrics.ts` fields, registry + provenance rows, and fi/en/sv labels. Add an **opt-in `defaultWeight: 0`** `QUALITY_FACTOR` for low-income (the established pattern). For the metro aggregate, sum numerators and denominators — do **not** average per-area ratios. |
| **Why** | Two genuinely new axes for ~zero cost. Income is currently only ever a central tendency (`median_income`, `disposable_income`): two areas with the same €31k median can be a stable middle-income suburb or a polarised one, and that distinction moves a relocation decision more than the median. Job self-sufficiency is the closest thing to a **commute signal** that exists at postal granularity — the app has none at all, since `ISOCHRONE_ENABLED` is hard-false and `transit_reachability_score` covers 6.1 % of postal codes. |
| **Verified** | `hr_pi_tul: 2866`, `hr_tuy: 16397`, `tp_tyopy: 55646`, `pt_tyoll: 10107` are present on shipped features; `grep -rl "hr_pi_tul\|job_self_sufficiency\|low_income" src/utils src/components` returns **nothing** — downloaded by every user today, read by no code. |
| **Data source** | Statistics Finland Paavo (`postialue:pno_tilasto_{year}` WFS, already fetched at `prepare_data.py:383-414`) — CC BY 4.0, postal, `is_proxy: false`. **No new fetch.** |
| **Touches** | `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/utils/qualityIndex.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `scripts/validate_data.py`, `public/data/metro_neighborhoods.geojson`, `src/data/`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~250–400 gz B (2 LayerConfigs + fi keys) |
| **Complexity** | Small |
| **Dependencies** | Must follow **IN-1** — both regenerate `build:data` and re-baseline `data_baseline.json`; running them in parallel guarantees a conflict. |
| **Tag** | Claude Code |

### QW-2 Rescale the all-Finland landing choropleth to the 69-region distribution

| | |
|---|---|
| **What** | `App.tsx:792` and `:817` both bail with `if (comparisonScope !== 'region' \|\| cityFilter === 'all' \|\| !filteredData)`, so the 69 seutukunta averages are painted with stops calibrated to the spread of 3,018 individual postal areas. Call the existing `rescaleLayerToData(base, filteredData.features)` on the aggregate view too — it already handles `prevEffectiveLayerRef` identity preservation and inverted directions. Mirror in `SplitMapView.tsx`, which builds its own layer objects. The comparison-scope toggle is deliberately hidden on this view (`App.tsx:1772`), so this must be default behaviour, not an opt-in. |
| **Why** | This is literally the first thing every visitor sees. With the default layer, region `quality_index` spans 46.2–64.9 against stops `[0,14,28,43,57,71,86,100]` — all 69 regions land in **2 of 8 bands**. A choropleth that flat reads as "Finland is uniform", the exact opposite of the product's premise, and makes the landing map look unfinished. Highest impact-per-byte item on this roadmap. |
| **Touches** | `src/App.tsx`, `src/components/SplitMapView.tsx` |
| **Bundle** | ~0 (widens a condition around an already-bundled call) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Restore `?pno=<regionId>` deep links and drop the 12.3 MB fallback fetch

| | |
|---|---|
| **What** | Selecting a seutukunta on the default view sets `selected.pno = 'helsinki_metro'`, which the app serialises as `?pno=helsinki_metro`. `parseUrl` accepts it (`useUrlState.ts:438`, `VALID_CITIES.has(pno)`), but the deep-link resolver at `App.tsx:1424-1441` looks it up in `pnoRegionMap`, built from a `region_search_index.json` that contains only 5-digit postal rows. The miss falls through to `setNeedFullNational(true)`, whose `pnoFeatureMap` **also** has no region ids — so the restore still never fires and the resumed URL write strips the param. Branch on the region-id set *before* the `pnoRegionMap` lookup, restore the selection from the already-loaded `region_aggregates`, and never set `needFullNational` for that case. |
| **Why** | The most likely link a first-time visitor produces: land on `?city=all`, click a region, reload or share. Today they lose the selection **and** pay a 12,307,807 B (~1.96 MB gz, ~215 ms parse) download that buys them nothing — the app writes a URL it cannot read back. Also the single largest accidental fetch in the product. Three independent proposal lenses found this bug separately. |
| **Touches** | `src/App.tsx`, `src/hooks/useUrlState.ts`, `src/__tests__/` |
| **Bundle** | ~150–250 gz B; may be net negative |
| **Complexity** | Small |
| **Dependencies** | None. Land early — it is cheap and removes a large fetch from a common path. |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 De-orphan the content mesh: 10,653 pages currently get zero links from the app

| | |
|---|---|
| **What** | Four zero-bundle-to-near-zero fixes. (1) **App → hubs:** `grep -rn "kaupungit\|/kunta/\|parhaat\|/vertaa/" src/ --include=*.tsx` returns **nothing** — the SPA's only outbound prerender links are `/kaupunki/{region}/` and `/tietolahteet`, and `index.html` puts the directory link only inside `<noscript>`, which a rendering crawler discards. Add a real directory link plus municipality-hub and ranking links beside the profile page's region breadcrumb. (2) **Profile `<noscript>` nav:** `prerender.mjs:1027-1033` emits exactly three links (region, `/?pno=`, directory); add the municipality hub, the rankings the area appears in, its `/vertaa/` pages and its `/kaavoitus/` hub, reusing the existing `muniPath` / `rankPath` / `planningPath` helpers in `prerender-hubs.mjs`. (3) **Municipality-hub CTA is wrong:** `prerender-hubs.mjs:1108` renders `href="/?city=${muni.regionId}"` — "Avaa Espoo kartalla" opens the whole Helsinki seutukunta. Route it to a representative area of the municipality via `/?pno=`, and add the compare + planning nav the region body already has at `:985-988`. (4) **De-leaf rankings and compares:** add a sibling-metric row to ranking bodies (`:810-820`) via the existing `buildBestAreasNav`, and region + municipality links plus sibling comparisons to compare bodies (`:1725-1734`); fix the compare `BreadcrumbList` at `:1748-1754`, whose position-2 entry has no `item` and whose trail skips the region level. Cap sibling lists at ~8 links. |
| **Why** | Measured from `dist/sitemap.xml` (19,927 URLs): rankings 6,240 + compares 2,946 + municipality hubs 915 + planning hubs 552 = **10,653 pages, 53 % of the corpus, reachable from exactly one parent each and from the running app not at all**. These are precisely the pages that answer the highest-intent queries — "best areas for X in Y", "A vs B", "Espoo asuinalueet" — and the municipality hub's single conversion click currently lands on the wrong map extent. |
| **Touches** | `index.html`, `src/App.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~250–400 gz B (app-side links + 3–5 fi keys); the prerender half is 0 |
| **Complexity** | Medium |
| **Dependencies** | None. Ranking/compare membership is computed in `prerender-hubs.mjs`; either hoist those computations or run the profile pass after them. |
| **Tag** | Claude Code |

### CF-2 Answer "is this good, or just good for around here?" — national percentiles with a scope label

| | |
|---|---|
| **What** | Two halves. (a) **Label the cohort.** `NeighborhoodPanel.tsx:496-501` and `:518-523` render a bare `summary.chip_top` ("top 12 %") with no cohort word, while `allFeatures` is one seutukunta in region view and the 69 aggregates on `?city=all`. The scope-aware machinery already exists and is already translated in all three locales — `composeSummarySentences` implements `scope: 'national' \| 'region'` — but its only non-test consumer is `scripts/prerender.mjs`. Wire scope + region name into the chips and the distribution percentile so it reads "top 12 % within Pirkanmaa". (b) **Give the panel a real national number without the 12.3 MB fetch.** Extend `build_national_ranges.mjs` — which already walks all 3,018 records — to emit `national_percentiles.json`, a ~101-breakpoint ladder per percentile metric, fetched as a **`?url` static asset** (the locales/adjacency pattern, so zero bundle) and read via the existing `percentileRankSorted`. Add coverage and population floors while here: `transit_reachability_score` is a summary *and* percentile metric at **6.1 % coverage / 183 rows**, and neither `areaSummary.ts` nor `percentileRanks.ts` references `he_vakiy` at all, so a 46-person postal code can win a national claim on a volatile rate. |
| **Why** | The core relocation question, and the app cannot answer it in-app. A top-10 % area in a weak sub-region renders identically to a top-10 % area in Finland. The honest phrasing was written, translated into fi/en/sv and shipped — **to search-engine crawlers only**, while the human user gets the ambiguous version. The transit case is worse than vague: a "national top 5 % for transit" claim currently rests on beating 175 areas, and it propagates into profile meta descriptions and JSON-LD. |
| **Touches** | `scripts/build_national_ranges.mjs`, `src/utils/percentileRanks.ts`, `src/utils/areaSummary.ts`, `src/components/NeighborhoodPanel.tsx`, `src/utils/nationalRanges.ts`, `src/locales/{fi,en,sv}.json`, `src/data/`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~700–1,000 gz B of JS — the ladder itself is a `?url` asset and costs nothing. **Do not** add it to `national_ranges.json`, which is statically imported and would charge the full payload. |
| **Complexity** | Large |
| **Dependencies** | None, but it is the designated BUDGET-bumper of its batch. Ladder must derive from committed source data only (no `Date.now()`) or the `build:data` idempotency gate fails. |
| **Tag** | Claude Code |

### CF-3 Make the shortlist a decision table instead of a row of name chips

| | |
|---|---|
| **What** | `ShortlistTray.tsx:271-300` renders each entry as a `<span>` containing a note dot, a name button and a `×` — verified: no metric, no score, no sort control anywhere in the component. Resolve each entry's properties through the fallback chain the tray already uses for names, then render a sortable row list: Quality Index, **Fit-for-you %** (reuse `scoreFeatureFit` from `utils/fitScore.ts`, already powering the wizard and the panel badge), and one column driven by the active layer, with an explicit "no data" state rather than an omitted row. Keep the chip row as the collapsed state so the tray's footprint is unchanged. Where the area's feature is unavailable — the default `?city=all` view, where `pnoFeatureMap` is empty under `skipAllFetch` — resolve from `region_properties`-backed lookups rather than triggering the national fetch. |
| **Why** | The funnel's convergence point and its thinnest surface. Every upstream surface — map, ranking, correlation, wizard, panel — is analytically rich; the one step where the decision actually happens carries no information at all. A user who ran the wizard and curated eight candidates across sessions returns to eight undifferentiated text chips and must re-open each one to rebuild the comparison they already did. One value column plus a sort turns a bookmark list into the answer the product exists to produce, and it is the surface most likely to bring someone back for a second session — the only real argument for having an account. |
| **Touches** | `src/components/ShortlistTray.tsx`, `src/App.tsx`, `src/utils/fitScore.ts`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~400–600 gz B (`fitScore` and `getLayerById` are already bundled) |
| **Complexity** | Medium |
| **Dependencies** | Shares `ShortlistTray.tsx` with **PO-1**'s compare-truncation toast — land them in one branch or serialise. |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 Silent failures: dead tools on the landing view, a truncating Compare, and Back that exits the site

| | |
|---|---|
| **What** | Four confirmed no-ops, all cheap. (1) **Select-areas "Finish"**: `handleFinishSelect` (`App.tsx:966-972`) calls `computeSelectionHull`, which returns `null` on its first guard `if (pnos.length === 0 \|\| !data)` — on `?city=all`, `data` is null by design, so no polygon is produced and `selectMode` never exits. `ToolsDropdown` offers the mode with no `cityFilter` gating. (2) **Free-hand draw** early-returns `[]`, so `AreaSummaryPanel` summarises whichever of the 69 seutukunta aggregates the shape intersects — a neighbourhood-sized shape reports on hundreds of thousands of people in identical UI. (3) **Shortlist "Compare"**: `handleCompareShortlist` (`App.tsx:1920-1926`) loops every pno through `pin()`, which returns `prev` unchanged once `pinned.length >= MAX_PINNED` (`useSelectedNeighborhood.ts:22-28`) — an 8-item shortlist silently becomes an arbitrary 3. Emit the existing app-toast window event ("comparing 3 of 8") and clear `pinned` first so repeated presses are idempotent. (4) **Back gesture**: `anyOverlayOpen` (`App.tsx:2252-2254`) lists `showRanking` but **not** `showRegionRanking` or the correlation explorer, so Android Back / iOS edge-swipe navigates off naapurustot.fi entirely while either is open, losing selection, filters and pins. |
| **Why** | Each is a user pressing a button and getting nothing — no error, no toast, no disabled state — which is the canonical "this app is broken" moment, and three of the four occur on the view every visitor lands on. The Compare case is worse than silent: a user who curated eight candidates gets three and may reasonably conclude the other five were lost. The Back omission is the harshest failure mode on mobile: it discards everything and leaves the site. |
| **Touches** | `src/App.tsx`, `src/components/ToolsDropdown.tsx`, `src/components/ShortlistTray.tsx`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~600 gz B (disabled-state props + ~3 fi keys; reuses the existing toast event) |
| **Complexity** | Small |
| **Dependencies** | Shares `ShortlistTray.tsx` with **CF-3** |
| **Tag** | Claude Code |

### PO-2 Mobile panel parity: a route to the profile, and an honest no-data state

| | |
|---|---|
| **What** | Both live in `panelContent` (`NeighborhoodPanel.tsx:2035`), rendered at exactly one place (`:2143`) inside the `hidden md:block` desktop column. That block owns the `d._noData` empty state — `_noData` occurs **once** in the 2,300-line file — and the "view full profile" anchor at `:2053`. The mobile sheet renders `mobileSectionDefs = [sectionOverview, sectionStats, sectionTrends, sectionSimilar]` (`:2016`) and checks neither. (The `profileHref` call at `:1276` is `openNationalResult`, a search-result handler — not a CTA for the selected area.) Hoist the `_noData` guard above the desktop/mobile split, and add the profile CTA to the shared `sectionOverview` or the sheet's existing action row. |
| **Why** | Mobile users have **no route at all** from a selected area on the map to that area's `/alue/` profile — the richest per-area content in the product and the destination ~9,000 prerendered SEO pages point back at. Since those pages are the main organic entry point, the mobile map → profile funnel simply does not exist. Separately, tapping a region with no ingested data on a phone shows a fully populated four-tab carousel of blank rows and empty charts, indistinguishable from a loading failure, where desktop shows a clean message that is already written and translated. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` |
| **Bundle** | ~150–300 gz B (`panel.no_data_region` and `profile.view_full` already exist in all three locales) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Ranking tables: say what was excluded, and show the layer's coverage

| | |
|---|---|
| **What** | `RankingTable.tsx:55-61` drops every feature whose value is non-finite or whose `he_vakiy` is null/zero, with no counter, and the footer at `:245-249` prints `{items.length} {t('ranking.areas')}` — a survivor count that reads as the size of the set. Track the excluded counts in the same `useMemo` (split `noValue` from `noPopulation`), render "1,097 of 3,018 areas — 1,921 without data", and put the layer's coverage badge in the header using `getCoveragePct` / `formatCoveragePct`, already imported by `Legend.tsx` and `LayerSignals`. Mirror into `RegionRankingTable.tsx`. `CorrelationExplorer.tsx:347` already ships this exact pattern ("+N no data"). |
| **Why** | "Best areas for X" is the most legible thing a non-analyst does with this app, and a ranked list with a total at the bottom is read as complete by everyone. Ranking `property_price_sqm` (36.3 % coverage) or `school_quality_score` (10.3 %) produces a confident best-to-worst list built from about a third of the country — and the areas most likely to be missing price data are the rural ones a user may be specifically considering. Copying a shipped pattern into the surface where it matters more: `RankingTable` is a primary discovery path, the scatter plot is not. One number, immediate credibility gain across 77 layers. |
| **Touches** | `src/components/RankingTable.tsx`, `src/components/RegionRankingTable.tsx`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~150–250 gz B (coverage helpers already bundled) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Stop shipping fabricated values, and add the value-level gate that keeps them out

| | |
|---|---|
| **What** | Three live integrity breaks, plus the validator work that makes them non-recurring. (a) **Noise floor:** `fetch_noise_pollution.py:80` defines `BACKGROUND_DB = 40.0` and assigns it at `:443` and `:615-618` to every postal code outside a measured contour — **measured: 2,234 of 3,018 areas (74.0 %) carry exactly 40.0**. Emit `null` instead. (b) **Planning zeros:** `active_plan_count` is 0 for **2,177 of 3,018 (72.1 %)** because only five municipalities publish a plan WFS; keep an explicit served-municipality allowlist so 0 means "source present, nothing found" and `null` means "no source". (c) **Suppression sentinels:** **measured: exactly 13,500 values equal to `-1` across 74 properties** in `src/data/region_properties.json`, because `prepare_data.py:903-924` nulls only a hardcoded 22-field allowlist while `build_region_data.mjs:166` serialises `f.properties` wholesale — they flow into the public `naapurustot_areas.csv` and the frozen `/api/v1` JSON with codebook entries describing them as counts. Replace the allowlist with a prefix-wide sweep (`he_*`/`ko_*`/`hr_*`/`tr_*`/`te_*`/`ra_*`/`pt_*`/`tp_*`), keeping the targeted zero-suppression exceptions. Then in `validate_data.py`: fail on **any** `-1`; extend `RANGE_CHECKS` (currently ~40 of 77 layer properties) to the unchecked ones; add a **distinctness assertion** (fail when >50 % of non-null values for a postal metric are byte-identical); and propagate `is_proxy` to derived children — `crime_index_change_pct` is registered `is_proxy: false` although it derives entirely from `crime_index`, which is `is_proxy: true`. Re-baseline `data_baseline.json` deliberately (noise → ~26 %, planning → ~28 %). |
| **Why** | This is the project's own hardest rule, broken in production. It is also the exact case the honesty UI was built for and the one case it misses: `LayerSelector.tsx:72` returns `null` when a layer is full-coverage, non-proxy and fresh — which is precisely what all three claim to be. Today two rural areas compared on "noise" show an identical value nobody measured, and `noise_pollution` is a summary metric, so "quietest 5 %" chips are computed against 2,234 tied fabricated values. **No app change is needed**: the `LayerSignals` chip, the Legend low-coverage badge and the grey no-data fill are already data-driven and start firing automatically. The distinctness check is the durable part — it would already catch `water_proximity_m` (2,789 zeros) and `walkability_index` (1,412 areas sharing the value 76), and it catches the next one at build time instead of in production. |
| **Touches** | `scripts/fetch_noise_pollution.py`, `scripts/fetch_city_zoning.py`, `scripts/prepare_data.py`, `scripts/validate_data.py`, `scripts/data_baseline.json`, `src/data/data_sources.json`, `scripts/provenance.json`, `public/data/metro_neighborhoods.geojson`, `src/data/` |
| **Bundle** | 0 — pipeline, registry and validation only; shipped artifacts shrink slightly |
| **Complexity** | Medium |
| **Dependencies** | None, but it **owns the `build:data` regeneration and the `data_baseline.json` re-baseline**, so it must merge before QW-1. Lands on the IN-1 data-validation job from the prior roadmap (`auto-merge.yml:164`), which already runs the full suite on data-touching branches — so the new checks will actually bite. |
| **Tag** | Claude Code |

### IN-2 Make the two inert static-analysis gates real

| | |
|---|---|
| **What** | (a) `npx tsc --noEmit` in `auto-merge.yml:96` and `ci.yml:68` resolves `tsconfig.json`, which is a solution-style config — verified, its entire contents are `"files": []` plus two `references`. Without `-b`, `tsc` **compiles nothing**. Change both steps to `npx tsc -b --noEmit`, or drop the step and rename the Build step honestly, since `npm run build` (`tsc -b && vite build`) is where types are actually caught. (b) `eslint.config.js` has exactly two `files:` scopes, both `**/*.{ts,tsx}` — so `eslint .` enumerates all 23 `scripts/*.mjs` and applies an **empty ruleset**. `prerender.mjs` (1,895 lines) and `prerender-hubs.mjs` (1,824 lines) get no `no-undef`, no `no-unused-vars`, no `no-unreachable`. Add a `{ files: ['**/*.{mjs,js,cjs}'], extends: [js.configs.recommended], languageOptions: { globals: globals.node, sourceType: 'module' } }` block and fix the fallout. |
| **Why** | ~4,700 lines of untyped, untested build scripts generate all 19,927 SEO pages, and a typo'd identifier in that chain surfaces only as a runtime crash during `build:pages` — or worse, as silently wrong HTML across thousands of pages, the exact failure class `CLAUDE.md` already warns about for the head-token regexes. The type-check step is additionally a **false green signal**: any future refactor that reorders or lightens the Build job would silently remove type gating while the step keeps passing. Two config edits buy real coverage over the largest un-analysed surface in the repo. |
| **Touches** | `tsconfig.json`, `eslint.config.js`, `.github/workflows/auto-merge.yml`, `.github/workflows/ci.yml`, `scripts/*.mjs` |
| **Bundle** | 0 |
| **Complexity** | Medium (the config change is trivial; the lint fallout across 23 scripts is the work) |
| **Dependencies** | None. Should land **before** any batch that touches `scripts/`, so the new lint catches that batch's own regressions. |
| **Tag** | Claude Code |

### IN-3 Guard the physical ceilings: sitemap index split, URL/byte assertions, dist size

| | |
|---|---|
| **What** | (a) `generate-sitemap.mjs:203-215` writes a single flat `urlset` — **measured: 19,927 `<loc>` entries, 10,419,843 bytes** — with no index and no guard against the sitemaps.org 50,000-URL / 50 MB ceilings. Split into `sitemap-index.xml` plus per-family children (`alue`, `kunta`, `kaupunki`, `parhaat`, `vertaa`, `kaavoitus`, static), gzip them, and add a hard `throw` past 45,000 URLs / 45 MB. Update `robots.txt` and `llms.txt` to point at the index. (b) Add `scripts/check-dist-size.mjs` mirroring the shape of `check-bundle-size.mjs` (a `BUDGET` const, a printed breakdown by top-level directory, non-zero exit past threshold), wired into `checks` and into `deploy.yml` before upload — **measured: `dist/` is 575.8 MB across 41,875 files** before deploy-time rasterisation of ~9,261 social-card PNGs, against GitHub Pages' 1 GB cap. |
| **Why** | Both failure modes are silent and total. Google rejects an over-limit sitemap wholesale, which would take the entire 19,927-page mesh's **only** discovery path offline — and per CF-1 more than half those pages have no crawl path from the app at all, so the sitemap is not a redundancy, it is the mechanism. Page count is combinatorial rather than linear: one new ranking metric adds ~600 URLs per locale and a fourth locale roughly doubles the tree. Crossing 1 GB breaks the production deploy with no prior warning. These guards are what make the next SEO expansion safe to attempt. |
| **Touches** | `scripts/generate-sitemap.mjs`, `scripts/check-dist-size.mjs`, `.github/workflows/auto-merge.yml`, `.github/workflows/deploy.yml`, `public/robots.txt`, `public/llms.txt`, `package.json` |
| **Bundle** | 0; net negative on deploy artifact size |
| **Complexity** | Medium |
| **Dependencies** | Sequence **after CF-1**, so the child sitemaps reflect the final link structure. Note the known CRLF drift on `public/llms*.txt` — regenerate deliberately here rather than `git checkout`-ing it. |
| **Tag** | Claude Code |

---

## Suggested Sequencing

**Global rules for every batch.** Auto-merge shares one concurrency group, so **stagger pushes** — a second `claude/*` push cancels an in-flight merge. **Exactly one item per batch may edit `scripts/check-bundle-size.mjs`** (the designated bumper, named below), and **exactly one may run `npm run build:data`**. Re-run the i18n key-parity test after every locale edit. All 12 items are Claude Code; the only Manual Setup item on the whole list (off-site backups) is in the pruned section.

### Batch 1 — Real gates first

| Item | Title | Category | Complexity |
|---|---|---|---|
| IN-1 | Stop shipping fabricated values + value-level validation | Infrastructure | Medium |
| IN-2 | Make the inert `tsc` / ESLint gates real | Infrastructure | Medium |
| QW-2 | Rescale the all-Finland landing choropleth | Quick Win | Small |
| QW-3 | Restore `?pno=<regionId>` deep links | Quick Win | Small |

**Parallel-safety:** no shared files. IN-1 solely owns the pipeline, `data_baseline.json` and the `build:data` regeneration. IN-2 owns `tsconfig.json`, `eslint.config.js` and the CI workflows. QW-2 owns the `effectiveLayer` memos in `App.tsx`/`SplitMapView.tsx`; QW-3 owns the deep-link effect in `App.tsx` — different functions, but both edit `App.tsx`, so **merge QW-2 before QW-3** rather than truly in parallel. No BUDGET bumper needed (both quick wins are ≤250 B and fit the existing 1.2 KB headroom). Merge IN-1 and IN-2 first so every later batch is validated and linted by the real gates.

### Batch 2 — Content mesh and the honest number

| Item | Title | Category | Complexity |
|---|---|---|---|
| CF-1 | De-orphan the 10,653-page content mesh | Core | Medium |
| CF-2 | National percentiles + scope-labelled standing | Core | Large |
| QW-1 | Low-income share + job self-sufficiency layers | Quick Win | Small |

**Parallel-safety:** CF-1 owns `prerender*.mjs`, `index.html` and the profile page; CF-2 owns `NeighborhoodPanel.tsx`, `areaSummary.ts`, `percentileRanks.ts` and `build_national_ranges.mjs`; QW-1 is the sole layer-registry editor (`colorScales.ts`, `LayerSelector.tsx`, `metrics.ts`, `qualityIndex.ts`) and the sole `build:data` runner — it must follow IN-1's merge. **CF-2 is the designated BUDGET bumper** (314,000 → ~318,000); size the raise to cover CF-1's and QW-1's few hundred bytes too, and neither of them may touch `check-bundle-size.mjs`. All three add locale keys — distinct keys, but stagger the merges.

### Batch 3 — The funnel's last mile

| Item | Title | Category | Complexity |
|---|---|---|---|
| CF-3 | Shortlist becomes a decision table | Core | Medium |
| PO-2 | Mobile panel parity: profile route + no-data state | Polish | Small |
| PO-3 | Ranking tables: excluded count + coverage | Polish | Small |

**Parallel-safety:** CF-3 owns `ShortlistTray.tsx`; PO-2 owns `NeighborhoodPanel.tsx` (CF-2 merged in batch 2); PO-3 owns the two ranking tables. No overlap. CF-3 is the designated BUDGET bumper if batch 2's raise left under ~1 KB. CF-3 reads much better after QW-3, since a shared region link now resolves instead of landing on a view where Compare and the exports are hidden.

### Batch 4 — Silent failures, then the ceiling guards

| Item | Title | Category | Complexity |
|---|---|---|---|
| PO-1 | Dead tools, truncating Compare, Back exits the site | Polish | Small |
| IN-3 | Sitemap index split + dist/URL ceiling guards | Infrastructure | Medium |

**Parallel-safety:** PO-1 touches `App.tsx`, `ToolsDropdown.tsx` and `ShortlistTray.tsx` — it must follow CF-3's merge, since both edit the tray. IN-3 touches only build scripts, workflows and `public/`. Deliberately **last**: IN-3's child sitemaps should reflect CF-1's final link structure, and PO-1's compare-truncation toast should sit on top of CF-3's finished table.

---

### Method note

Statuses and every quantitative claim were verified against the working tree on 2026-07-22: `git log` since 2026-07-17, `grep`/`Read` for each carried-over item, and direct measurement of `src/data/region_properties.json` (3,018 records), `dist/sitemap.xml` (19,927 URLs), `dist/` (575.8 MB / 41,875 files) and the grid assets. Shipped items were dropped; the remainder were re-ranked by decision-relevance per unit of complexity and capped at three per category. Two candidate claims were corrected during verification: the `-1` sentinel problem spans **74 properties, not 25**, and `profileHref` does appear once outside `panelContent` (as `openNationalResult`) without providing the mobile profile route PO-2 adds.
