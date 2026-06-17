# naapurustot.fi — Feature Roadmap

> Generated 2026-06-17 from a fresh **63-agent multi-agent codebase audit**: 9 parallel subsystem surveys + 5 live external data-source/competitive research dossiers → 6 ideation lenses → dedup/pre-filter → **one adversarial verifier per candidate** against the real code and live data APIs → completeness critic → dependency sequencing (70 raw candidates → 34 deduped → 33 confirmed + 3 critic additions = **35 items**, 1 rejected on a live-API granularity check). **Supersedes the 2026-06-13 roadmap, whose kaavoitukset & hankkeet centerpiece and nearly all 31 items shipped and merged.** Item IDs here are **fresh** and do not map to the prior roadmap's.

## The headline

The planning centerpiece is done, so this roadmap pivots to four reinforcing fronts:

1. **Eight genuinely-new, real-sourced data layers** at postal-or-finer granularity and zero *data*-bundle cost — low-income/segregation (`hr_pi_tul`), job self-sufficiency (`tp_tyopy/pt_tyoll`), distance-to-essential-services (incl. the missing **pharmacy** category), true building-level construction flow from the **Ryhti permit register**, libraries (Kirkanta), protected nature (SYKE), cultural heritage (Museovirasto), and an **FMI 1 km microclimate grid**.
2. **Closing core capability gaps on the dominant navigation/comparison paths** — accent-folded + municipality search, national filtering across all 3,018 areas, SplitMapView overlay parity, mobile comparison charts, and ranking-table orientation.
3. **Compounding the SEO / answer-engine moat** with prerendered X-vs-Y pages, Wikidata entity grounding, and Speculation Rules prefetch.
4. **Hardening the integrity scaffolding the data work depends on** — making the coverage ratchet, the type-check, full data-validation, visual-regression, and server-route gates *actually enforce*; closing a cross-device sync data-loss window; and truing-up drifted docs.

Build-time and static-asset (`?url`) surfaces are favored so the near-zero JS-bundle headroom is respected; the `BUDGET` constant is raised exactly once per batch.

## The bundle-budget reality (read before implementing anything)

CI fails when the gzipped sum of **all** app JS (lazy chunks included, only `maplibre-*` excluded) exceeds the single `BUDGET` constant in `scripts/check-bundle-size.mjs` (`bundle:check`, called by both `ci.yml` and `auto-merge.yml`). Verified state on this branch:

1. **`BUDGET = 295_000` bytes** (`scripts/check-bundle-size.mjs:59`) — note the prior roadmap and several docs still say 280,000/287,000; those are **stale** (PO-2 fixes the docs). Measure live headroom with `npm run bundle:check` before every push.
2. **`fi.json` is NOT free** (statically bundled in the i18n chunk); **`en.json`/`sv.json` ARE free** (lazy `?url` assets). Prerender/profile text uses **inline FI/EN/SV strings, not locale keys** wherever possible. Build-time / prerender / static-asset (`?url`, manifest + `fetch`) surfaces cost **zero** bundle bytes — strongly preferred, and every new *data* layer here ships its values that way.
3. **Exactly one designated item per batch may edit the `BUDGET` constant.** Raising it for a substantial real batch is established practice (history 256→280→282→287→295). Every JS-touching item below carries a `Bundle` estimate.

## Data integrity & granularity (non-negotiable)

Every value must trace to a **real, verifiable, open-licensed** source — never fabricated, estimated, or placeholder. Prefer postal-or-finer granularity; municipality-level values distributed to postal codes **must** be flagged `is_proxy:true`. Every data layer below names a real source with URL + license + granularity; the one candidate whose premise failed a live-API check was rejected (see below).

## Deliberately excluded — do not re-propose

Owner/prior-audit exclusions: the affordability **calculator**; neighbor-ring map highlight; duplicate scope pill; idle hint pill; header share button; the green-space **layer** (`tree_canopy` supersedes it); the national/metro demographic 250 m grid; OSM building footprints; MML elevation/DEM; commute/isochrone destination filter; off-droplet nightly DB backups; **HAME maakuntakaava** as a primary zoning layer (too coarse). Note: `@turf/union` is already removed and `affordability.ts`/`useAffordability.ts` are out of scope here (still bundled, but a separate cleanup the owner has not requested).

### Considered and rejected during verification

- **"National detailed-plan coverage (asemakaava-aste) layer from Ryhti"** — *data-integrity reject.* The source is real (`pub_valid_ld_plan_ix_gs`, OGC API Features, verified live `numberMatched=5634`, plan-polygon granularity, CC BY 4.0) but **not national in 2026**: a 1,000-feature sample yields only ~9 distinct *small* municipality codes (Siilinjärvi/Pihtipudas-class), a CQL filter for Helsinki (091) returns `numberMatched=0`, and **no metro is present**. A "% of area under a valid detailed plan" metric would be 0/blank for ~99% of the 3,018 areas — either a near-empty layer or a fabricated `0%` implying "no plan exists" when the truth is "municipality not yet in Ryhti". The codebase already made this call (`fetch_city_zoning.py` chose per-city WFS precisely because Ryhti is unpopulated until the **1 Jan 2029** statutory deadline). The Ryhti **permit** register, by contrast, *is* densely populated today — captured as **CF-5**.
- **Value-pruned (kept off the ~34 cap, fair game later):** school-age-children (7–17) cohort layer; primary-sector employment layer; native View Transitions polish; reset-north/scale-bar affordances; share-`dist`-as-CI-artifact; deterministic-audit CI hygiene; SVG-chart SR text-table alternative (a11y theme is represented by QW-10/PO-4/PO-6); automated source-vintage staleness detector.

---

## 1 — Quick Wins

### QW-1 Job self-sufficiency (työpaikkaomavaraisuus) layer

| | |
|---|---|
| **What** | Derive `job_self_sufficiency = round(tp_tyopy / pt_tyoll * 100, 1)` in `prepare_data.py` alongside the existing employment/sector derivations (`tp_tyopy` read at `:642`, `pt_tyoll` at `:659`); propagate into the GeoJSON; run `build:data`. Add a **diverging** LayerConfig (centered at 100 = employment hub vs. commuter/dormitory) to `LAYERS` and the id to the existing `layers.economy` group (there is no "Livelihood" group). In `metrics.ts` mirror the derivation in **two** places: the per-feature derive block (~`:311-362`, like `employment_rate` at `:328`) **and** the metro-aggregate special-ratio section (~`:909-949`) — add a `totalJobs` accumulator (none exists; `result.tp_tyopy` is never emitted) and compute `result.job_self_sufficiency = sum(tp_tyopy)/sum(pt_tyoll)*100`. **Do not** use a jobs-weighted `METRIC_DEFS` row — averaging per-area ratios with differing numerator/denominator bases is mathematically wrong. Add `data_sources.json` + `provenance.json` rows (`is_proxy:false`) and fi/en/sv labels. |
| **Why** | Highest-ROI, lowest-risk new layer: both inputs are already fetched and stored, so no new source/fetch is needed. Adds a genuinely new "employment hub vs. commuter suburb" axis at 100% postal coverage and strong profile-text material, distinct from `employment_rate` and the sector-share layers. |
| **Data source** | Statistics Finland Paavo (`tp_tyopy` = workplaces total, `pt_tyoll` = employed residents) — https://stat.fi/tup/paavo/index.html — CC BY 4.0 — postal (3,018), `is_proxy:false` |
| **Touches** | `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~300–400 gz B (LayerConfig + fi labels + aggregation code); designated BUDGET-bumper for its batch |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Complete CSV/PDF exports — add the ~13 panel metrics missing from `collectStats()`

| | |
|---|---|
| **What** | Extend the `rows` array in `export.ts` `collectStats()` (`:42-84`, the single source feeding `exportCsv`/`exportPdf`/`exportComparison{Pdf,Csv}` and shortlist exports) to include metrics the panel renders but the human-readable exports drop: `price_to_rent_ratio`, `avg_construction_year`, `elderly_ratio_pct`, `avg_household_size`, `property_price_change_pct`, `traffic_accident_rate`, `water_proximity_m`, `cycling_density`, `single_person_hh_pct`, `new_construction_pct`, and the three job-sector pcts. All 13 `panel.*` fi keys already exist and `rawExportProps` (`:477`) already carries these fields — pure formatting reuse. |
| **Why** | A user exporting CSV/PDF currently gets a strictly smaller dataset than they see on screen — silent under-reporting in the most shareable deliverable. No data-integrity concern (existing real-sourced properties). |
| **Touches** | `src/utils/export.ts` |
| **Bundle** | ~150–300 gz B (13 array entries reusing existing formatters + locale keys) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Highlight + scroll-to the selected area in the ranking tables

| | |
|---|---|
| **What** | Thread the currently-selected pno (`App.tsx` holds `selected?.pno` at `:2109/:2125`; tables rendered at `:2328-2336` and `:2541-2547` receive no `selected` prop) into `RankingTable` and `RegionRankingTable`, style the matching row (highlight + rank badge), and scroll it into view on open via a ref + `scrollIntoView`. `RankingTableProps` (`:11-22`) and `RegionRankingTable` props (`:9-18`) have no `selected` field today. For `RegionRankingTable` the matched row is the selected area's **region** (`selected.city`), since that table ranks the 69 seutukunnat. |
| **Why** | "Where does my area rank?" is a core decision-support question, currently unanswerable without scanning ~200 rows. Pure prop + styling using data already in scope. |
| **Touches** | `src/components/RankingTable.tsx`, `src/components/RegionRankingTable.tsx`, `src/App.tsx` |
| **Bundle** | ~400 gz B (className conditional + ref + `scrollIntoView`) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 RegionRankingTable CSV export + copy-deep-link parity

| | |
|---|---|
| **What** | Add a CSV-download button (`exportRankingCsv`, `export.ts:424`) and a copy-deep-link button (`buildFullViewUrl`, `embed.ts:58`) to `RegionRankingTable`'s header (currently reverse + close only, `:116-135`), mirroring `RankingTable.tsx:107-138`. Both helpers are already bundled — import them and map `displayItems` (`RegionAgg {regionId,value}` at `:20-25`) to `exportRankingCsv`'s `{rank,name,pno,value}` shape (`regionId→pno`, `regionName(id)→name`). Copy-link is the all-Finland `?layer=X` deep link (`buildFullViewUrl` handles `city:null`). Only `RegionRankingTable.tsx` changes. |
| **Why** | The 69-seutukunta aggregate ranking is exactly the citable output worth exporting/sharing (journalists, realtors), yet it is the one ranking surface with no export or share affordance — an asymmetric capability gap. |
| **Touches** | `src/components/RegionRankingTable.tsx` |
| **Bundle** | ~150–250 gz B (helpers pre-bundled; only two buttons + copied state + row map are new) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Re-baseline the toothless coverage ratchet

| | |
|---|---|
| **What** | Regenerate `coverage-baseline.json` from a real `vitest run --coverage` (locally `--exclude "**/slugAliases.test.ts"`) and commit the true numbers with a modest safety margin, keeping the `_comment` "may only go up" rule. The file pins statements/branches/functions/lines at 32.27/27.05/25.34/32.91 (single commit `50f664d`, never updated) but actual coverage is ~78/68/71/80 — a ~46 pp gap that `scripts/check-coverage.mjs` (0.5 pp tolerance, wired in `ci.yml:76` + `auto-merge.yml:104`) can never fire on. Only `coverage-baseline.json` changes. **Sequence last** so the re-baseline reflects post-roadmap coverage. |
| **Why** | The headline CI gate meant to stop coverage regressions is inert — coverage could collapse from 78% to 33% without failing. Re-baselining makes the gate real with zero feature risk and protects every future test-touching PR. |
| **Touches** | `coverage-baseline.json` |
| **Bundle** | 0 (build-time) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-6 Speculation Rules prerender/prefetch in the ~9,000 static pages

| | |
|---|---|
| **What** | Inject a `<script type="speculationrules">` JSON block (document rules, `eagerness:'moderate'`, restricted to `/alue/` and hub/ranking link patterns) into the prerendered head via the existing `html.replace('</head>', …)` injection sites in `prerender.mjs` (e.g. `:1342/:1634/:1666`) and `prerender-hubs.mjs` (`htmlPage :337`, ranking `:529`). The block contains no `<title>/<noscript>/</head>` tokens, so it won't trip `assertHeadIntegrity`. Progressive enhancement; unsupported browsers ignore it. Run `build:pages` to verify head integrity. |
| **Why** | The app already emits ~9,000 static MPA-style pages — exactly the shape this native API targets — so near-instant hub→profile and ranking→profile navigation is a free UX/perf win with zero client JS. |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs` |
| **Bundle** | 0 (build-time static HTML) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-7 Make the CI "Type check" step actually check files (`tsc --noEmit` is a no-op)

| | |
|---|---|
| **What** | Replace `npx tsc --noEmit` (`ci.yml:67-68`, `auto-merge.yml:95-96`) with `tsc -b` (or `tsc -p tsconfig.app.json --noEmit`), or delete the redundant step since the Build step already runs `tsc -b` (`package.json` build = `tsc -b && vite build`). The root tsconfig is solution-style (`{files:[],references:[…]}`), so `tsc --noEmit` empirically compiles **0** src files and always passes. |
| **Why** | The named gate gives false assurance: isolated type errors only surface later in the heavier Build step. Either make the gate real or remove the misleading green check. Codifies the `tsc --noEmit ≠ tsc -b` gotcha already in project memory. |
| **Touches** | `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml` |
| **Bundle** | 0 (CI config) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-8 Stop shipping `dist/stats.html` (bundle treemap) to public Pages

| | |
|---|---|
| **What** | Extend `stripBuildOnlyData()` (`vite.config.ts:61-88`, today scoped only to `dist/data`) to also delete `dist/stats.html` before deploy, **or** gate `rollup-plugin-visualizer` (`vite.config.ts:180-185`) behind an `ANALYZE` env flag / write the report outside `dist`. The visualizer runs before `stripBuildOnlyData`, so a `closeBundle` deletion runs after the file is written; `deploy.yml:41` builds and `:85-87` uploads all of `dist` with no intervening removal. |
| **Why** | The visualizer writes a `stats.html` on every build that ships publicly at `naapurustot.fi/stats.html` — an unreferenced asset disclosing the full bundle/module composition of a privacy-first app, plus dead bytes on every deploy. Zero downside to removing. |
| **Touches** | `vite.config.ts` |
| **Bundle** | 0 (build config; removes a public asset) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-9 Adapt `theme-color` meta to light/dark for mobile browser chrome

| | |
|---|---|
| **What** | Replace the single hardcoded `<meta name="theme-color" content="#1e3a5f">` (`index.html:39`, `prerender-hubs.mjs:320`) with two media-scoped tags (`prefers-color-scheme:dark` keeps `#1e3a5f`, light uses a near-white/light-navy value), update the X6 sync comment in `vite.config.ts:165` (`manifest.theme_color` stays a single baked install-time value), and optionally have `ThemeProvider` (`useTheme.tsx:43-98`) rewrite the active meta when the user picks an explicit non-system mode. Media-scoped `theme-color` is supported by current iOS Safari and Chrome Android. |
| **Why** | In light theme the app surface is near-white while the mobile address/status bar stays dark navy — a conspicuous theming mismatch where the system-aware theming work stops at the document and never reaches browser chrome. |
| **Touches** | `index.html`, `scripts/prerender-hubs.mjs`, `vite.config.ts`, `src/hooks/useTheme.tsx` |
| **Bundle** | ~0 for the HTML tags; ~60–80 gz B only if the optional dynamic rewrite is included |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-10 Announce onboarding tour step changes to screen readers

| | |
|---|---|
| **What** | The `OnboardingTour` popover moves focus into itself only once on mount (focus effect at `:86-90` has `[]` deps) and is labelled once via `aria-labelledby` (`:235`); advancing/going back swaps `h2#onboarding-title` (`:308`) and body (`:311`) in place with no announcement. Wrap title+body in a `role=group aria-live=polite` container (or re-focus the title per `stepIndex`), optionally routing through the app's `setAriaAnnouncement` live region (`App.tsx:2884`). Add the new key to all three locales. |
| **Why** | The multi-step walkthrough is fully keyboard-operable but completely silent to screen-reader users stepping through it, so onboarding fails its purpose for AT users — a real WCAG-relevant gap in a first-run flow. |
| **Touches** | `src/components/OnboardingTour.tsx`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~150 gz B (attributes + optional fi key; en/sv free) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 Opt-in national filtering across all 3,018 areas

| | |
|---|---|
| **What** | On the default `?city=all` view, `filteredData` resolves to the 69 seutukunta **aggregates** (`App.tsx:530`; `buildMetroAreaFeatures` collapses even the full national set at `:524`), so `computeMatchingPnos` (`:1550`) cannot rank individual postal areas nationally. Replace the explanatory `isAggregate` banner (`FilterPanel.tsx:666`) with a "Search all 3,018 areas" button that lazy-fetches `region_properties.json` via the existing `loadAllData()` (`dataLoader.ts:190`, a `?url` asset already used by `NeighborhoodWizard.tsx:406`, gated behind explicit click), runs `computeMatchingPnos` + `bestMatchScore` (`filterUtils.ts:154/220`) over the full national set, and renders matches as national-scope results (navigate to profile pages, since aggregate features have `geometry:null`). |
| **Why** | This is the app's core promise — filter neighborhoods across all of Finland — currently structurally impossible without first choosing one of 69 regions. The single highest-value capability gap for relocating households and journalists who think nationally; documented in `UX_REVIEW.md:113` as the unshipped fix (a). |
| **Touches** | `src/App.tsx`, `src/components/FilterPanel.tsx`, `src/utils/dataLoader.ts`, `src/utils/filterUtils.ts` |
| **Bundle** | ~0.8–1.2 KB gz (loader trigger + national-result UI; data is an existing `?url` asset = 0) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Accent-folded + municipality-aware search

| | |
|---|---|
| **What** | (1) Factor `slug.ts`'s module-private diacritic strip (`slugify :11-23`) into a shared `foldText()` and apply it to **both** the query and the indexed `nimi/namn/pno` before matching, so "Toolo"→"Töölö", "Aanekoski"→"Äänekoski", "Ahtari"→"Ähtäri" resolve (`SearchBar.tsx:86,95-100` today matches raw `.toLowerCase().includes/startsWith` and falls into the no-results branch at `:555`). Precompute folded fields once per index load. (2) Add the already-baked `municipality` field (`metrics.ts:27-28`; on all 3,018 areas, 308 distinct) to each row of `region_search_index.json` at build time (`build_region_data.mjs:179` emits only `{pno,nimi,namn,city}`) and match it at a lower relevance score, optionally as a result-row subtitle, so typing a town ("Espoo", "Nurmijärvi") finds every area in it. The index is a `?url` asset whose rows spread into feature props (`dataLoader.ts:263-266`) = zero bundle. |
| **Why** | Both failures silently return "no results" on the dominant navigation path. Accent-insensitivity is critical for non-Finnish keyboards and fast typists; "search by town" is a dominant mental model, using real already-baked Tilastokeskus data. |
| **Data source** | Statistics Finland Paavo `municipality` field (already in `region_properties.json`) — CC BY 4.0 — postal |
| **Touches** | `src/components/SearchBar.tsx`, `src/utils/slug.ts`, `src/hooks/useSearchIndex.ts`, `scripts/build_region_data.mjs`, `src/utils/dataLoader.ts` |
| **Bundle** | ~150–300 gz B (fold helper shared with `slug.ts` + municipality match; index is `?url` = 0) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Low-income share (pienituloisuus) layer + opt-in Quality Index factor

| | |
|---|---|
| **What** | Derive `low_income_pct = round(hr_pi_tul/(hr_pi_tul+hr_ke_tul+hr_hy_tul)*100, 1)`, **guarding** the Paavo `-1` suppression sentinel and the zero denominator (emit null/no-data, never a fabricated value — ~74 areas masked, ~17 zero-denom, so ~2,927 usable / ~97% coverage). Propagate to GeoJSON via `prepare_data.py`; run `build:data`. Add a LayerConfig (`higherIsBetter:false`), a `NeighborhoodProperties` field + `computeQuickWinMetrics` derive in `metrics.ts`, an **optional `defaultWeight:0`** Livelihood/Safety `QUALITY_FACTOR` in `qualityIndex.ts` (established opt-in pattern), a `METRIC_DEFS` row, registry + provenance rows (`is_proxy:false`), and fi/en/sv labels. Gray fallback for suppressed/zero-denom areas. `national_ranges.json:183-196` already carries `hr_pi/ke/hy` ranges. |
| **Why** | The only money signals today are median/average/disposable income; the lower tail — socioeconomic disadvantage and income segregation — is invisible. Arguably the single most decision-relevant missing axis for relocating households and especially the journalist/researcher fairness lens. Real, ~97%-covered Paavo data already loaded; no segregation layer exists today. |
| **Data source** | Statistics Finland Paavo gross-income-class household counts `hr_pi_tul`/`hr_ke_tul`/`hr_hy_tul` — https://stat.fi/tup/paavo/index.html — CC BY 4.0 — postal, `is_proxy:false`; `-1` and zero-denominator treated as no-data |
| **Touches** | `scripts/prepare_data.py`, `src/utils/metrics.ts`, `src/utils/colorScales.ts`, `src/utils/qualityIndex.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~300–400 gz B (LayerConfig + QI factor + fi labels); designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Distance-to-nearest essential-service access layers (the 15-minute-neighbourhood axis)

| | |
|---|---|
| **What** | Add "distance to nearest" (metres) access metrics for everyday services — grocery, health station, **pharmacy** (brand-new category; nothing matches pharmacy in `colorScales.ts` and it is absent from the national healthcare query at `prepare_data.py:1302-1313`), comprehensive school — computed sub-postal in `prepare_data.py` exactly like the existing `water_proximity_m` layer (`colorScales.ts:810`), reusing `_point_to_pno`/`_build_spatial_index`. Schools use the authoritative StatFin Oppilaitokset point WFS instead of OSM. Register each as a LayerConfig/`LayerId`, a `LAYER_GROUPS` amenity entry, a `METRIC_DEFS` row, registry + provenance rows, and fi/en/sv keys. OSM POIs are already fetched nationally (`prepare_data.py:1173`) — build-time, zero data-bundle. |
| **Why** | The seven shipped amenity layers are **all** /km² density at postal level, which misleads for the ~95% of Finland outside metros where one central store in a large rural postal code reads as "low density". Distance-to-nearest (metres) is the honest, decision-relevant framing, and pharmacy is a glaring missing everyday service. |
| **Data source** | OSM `amenity=pharmacy` / `shop=supermarket\|convenience` / `amenity=clinic\|doctors\|hospital` (ODbL 1.0, coordinate-level); Statistics Finland Oppilaitokset point WFS `oppilaitokset:oppilaitokset` (EPSG:3067, national, CC BY 4.0) — https://geo.stat.fi/geoserver/oppilaitokset/wfs . Coordinate→min-distance per postal area, `is_proxy:false` |
| **Touches** | `scripts/prepare_data.py`, `scripts/fetch_oppilaitokset.py`, `public/data/metro_neighborhoods.geojson`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/check-bundle-size.mjs`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~0.4–1.2 KB gz (data zero-bundle; cost is ~4 LayerConfigs + fi keys). Designated BUDGET-bumper for its batch |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 True building-level construction-flow layer from the Ryhti national permit register

| | |
|---|---|
| **What** | Upgrade the existing `construction_activity` layer (`data_sources.json:554`, StatFin distributed to postal codes, `is_proxy:true`, built by `fetch_construction_permits.py`) to **coordinate-level** data. A new build-time `fetch_ryhti_permits.py` paginates the Ryhti `open_permit_building` OGC API Features (live ~2.73M national permit points; fields `decision_date`/`construction_action_type`/`apartment_count`/`gross_floor_area` + point geometry) joined with `open_permit_address` (`postal_code`), point-in-polygons new-construction permits from the last N years into the 3,018 postal areas, and computes permits / permitted dwellings / floor-area per 1,000 residents. **Drop `is_proxy` for covered municipalities**; gray fallback elsewhere. Re-baseline `validate_data.py`. **Caveat:** permit submission is voluntary until **31 Dec 2028**, so confirm per-municipality coverage before dropping `is_proxy`. |
| **Why** | Replaces a fabricated municipal distribution with real building-level data, satisfying the "prefer finer-than-postal" granularity mandate, and gives every covered area a true "how much is being built here" signal from the same Ryhti system the planning centerpiece targets. Unlike the rejected plan-coverage layer, the permit register **is** densely populated today. |
| **Data source** | Ryhti building-permit OGC API Features `open_permit_building` / `open_permit_address` (SYKE/YM) — https://paikkatiedot.ymparisto.fi/geoserver/ryhti_permit/ogc/features/v1/collections/open_permit_building/items — CC BY 4.0 — building point aggregated to postal, `is_proxy:false` where covered |
| **Touches** | `scripts/fetch_ryhti_permits.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/validate_data.py`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | 0 (build-time; reuses existing layer) or ~150 gz B if relabeled — **not** the batch BUDGET-bumper |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-6 Render latent profile enrichment in the interactive React profile page

| | |
|---|---|
| **What** | `NeighborhoodProfilePage.tsx` renders only a 6-card stats grid (`:524-579`) + 4 sections (`:582-638`), but the prerendered `<noscript>` (`prerender.mjs buildNoscriptContent :861-929`) additionally shows the full Paavo age pyramid (`he_*`), top-5 NACE-sector employment (`tp_*`), household income/structure (`tr_*`, `hr_mtu`), plain-language strengths/weaknesses (`summarySentencesFor`), a templated FAQ (`buildFaq :961`), kaavat & hankkeet (`buildPlanningHtml`), and a within-region nearby-areas mesh (`buildNearbyHtml`). The data is already in the `loadNeighborhoodData()` payload + `region_properties.json` (185 keys/area). Add lazy section components under `src/components/profile/` so JS visitors reach parity with the crawler/no-JS view; keep en/sv labels as `?url` assets. |
| **Why** | JS visitors (the majority) currently see strictly **less** than a no-JS crawler or AI agent — the richest, already-loaded content benefits only crawlers. Deepens the page, increases dwell/engagement, and makes the SPA match the structured/no-JS content. Pure render gap, no new data. |
| **Touches** | `src/pages/NeighborhoodProfilePage.tsx`, `src/components/profile/`, `src/utils/metrics.ts`, `src/locales/fi.json` |
| **Bundle** | ~0.8–1.5 KB gz (lazy section components); CF-14's batch anchor sizes the raise to cover this |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-7 Prerendered pairwise "X vs Y" comparison pages

| | |
|---|---|
| **What** | The in-app `ComparisonPanel` only produces a non-indexable `?compare=` query param. Generate a **bounded** set of static comparison pages (`/vertaa/{alueA}-vs-{alueB}/` + EN `/compare`, SV `/jamfor`) for adjacent / same-region area pairs, driven by `adjacency.json` neighbour pairs + within-region top areas, reusing `comparisonStats.ts` (`refDeltaOf`/`findBest`/`ALL_STATS`, no React deps) and the existing JSON-LD/head-integrity machinery in `prerender-hubs.mjs` (mirror `buildRankingPage :647` / `writeRankingSet :1230` / the `dist/ranking-pages.json` manifest pattern at `:1249`). Each page: a direction-aware comparison table, verifiable "top X%" superlatives, a `FAQPage` block; add to sitemap (`generate-sitemap.mjs :144`) and a kaavoitus-style manifest. Bound volume (adjacency neighbours + region top-N) to avoid combinatorial explosion. |
| **Why** | "X vs Y" is one of the highest-intent relocation queries and a favourite of AI assistants, yet has no landing page today. Mirrors the shipped ranking-page family, is pure build-time HTML (zero bundle), and gives a citable head-to-head over already-sourced data. |
| **Touches** | `scripts/prerender-hubs.mjs`, `scripts/generate-sitemap.mjs`, `src/utils/comparisonStats.ts`, `src/data/adjacency.json` |
| **Bundle** | 0 (build-time prerendered HTML) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-8 Wikidata/Wikipedia entity linking (`Place.sameAs`) in profile + region-hub JSON-LD

| | |
|---|---|
| **What** | At build time, attach `sameAs [Wikidata QID URL, Wikipedia article URL]` to the `Place` node of each prerendered area profile (`prerender.mjs buildJsonLd`) and the `about` Place of each region hub (`prerender-hubs.mjs`), plus the client `JsonLd.tsx` Place node. Build a committed `scripts/wikidata_qids.json` id→QID map once via a Wikidata SPARQL query for the 69 seutukunnat (`P31=Q15921476`) and ~310 municipalities, consumed by the prerenderers. (Grep confirms 0 `sameAs`/wikidata occurrences in `prerender.mjs` today.) |
| **Why** | Entity grounding is the single highest-leverage GEO/answer-engine lever: anchoring each area to its municipality's canonical Wikidata entity lets Google's Knowledge Graph and AI assistants disambiguate the place and cite naapurustot's numbers as the authoritative numeric source. |
| **Data source** | Wikidata SPARQL/REST (CC0) for QIDs + Wikipedia article URLs (links/IDs only, no copied content); municipality (always) + many districts — https://www.wikidata.org/wiki/Wikidata:Data_access |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `src/components/profile/JsonLd.tsx`, `scripts/wikidata_qids.json` |
| **Bundle** | 0 (build-time); client `JsonLd.tsx` adds a few tens of bytes |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-9 ComparisonPanel: multi-series radar + mobile chart parity + winner summary

| | |
|---|---|
| **What** | `ComparisonPanel` only offers a bar chart, and the toggle + `ComparisonChart` live inside the desktop-only `hidden md:block` branch (`:209/:219-237/:292`); the mobile branch (`:381-430`) renders only `MobileCard` and never reads `view`, so **mobile users can never reach any comparison chart**. (1) Add an overlaid radar plotting the 2–3 pinned areas as overlapping polygons, reusing `RadarChart`'s axis/normalize machinery extended to N series and deriving axis min/max from `national_ranges.json` (depends on **PO-1**) so rural areas don't peg at the floor. (2) Surface the chart toggle on mobile. (3) Add a one-line synthesis above the table — "Area X leads on N of M directional metrics" — reusing the already-computed `bestByKey` map (`:170-178`). This batch's single BUDGET raise lands here (add `check-bundle-size.mjs` to touches). |
| **Why** | An overlaid radar is a strong at-a-glance shape comparison for shortlisting; fixes a real mobile-parity gap (mobile users can never reach any comparison chart today) and turns a raw table into an at-a-glance recommendation, using already-loaded data. |
| **Touches** | `src/components/RadarChart.tsx`, `src/components/ComparisonPanel.tsx`, `src/utils/nationalRanges.ts`, `scripts/check-bundle-size.mjs`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~1–1.5 KB gz (N-series SVG radar + mobile wiring + summary). Designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | PO-1 (extends `RadarChart`'s national-range-derived axes to N series) |
| **Tag** | Claude Code |

### CF-10 Bring the planning + isochrone overlays to SplitMapView (CF-2 parity)

| | |
|---|---|
| **What** | The kaavat & hankkeet overlay (plan polygons by Ryhti status + project lines by type + click popups) and the travel-time isochrone exist only on the main map (`Map.tsx` isochrone effect `:794-831`; planning source/layers `:835-869`; click popup `:905-939`). `SplitMapView.tsx` defines no `PLANNING_*`/`ISOCHRONE_*` sources/layers (grep = 0) and `App.tsx:2099-2116` passes no `planningData`/`isochrone` props to it (those props at `:2144-2145` belong to the main `<Map>` only). Clone the main-map planning + isochrone blocks into `SplitMapView`, structured like its existing `syncGridLayer` effect (`:293-358`), and thread the props through `App.tsx`. Reuses existing `usePlanningData` shards — zero new data. (git `54bf809` shipped only config/opacity/selection parity.) |
| **Why** | Closes an explicitly roadmap-scoped (prior `CF-2`) but **deferred** parity gap: in split-compare mode the planned-development and reachability context silently disappears, so a researcher/journalist comparing two metrics can't see what's being built in either pane, and the two views disagree. |
| **Data source** | Existing `public/data/planning_*_shards` (Väylä CC BY 4.0 + city WFS CC BY 4.0); no new fetch |
| **Touches** | `src/components/SplitMapView.tsx`, `src/App.tsx`, `src/hooks/usePlanningData.ts` |
| **Bundle** | ~0.6–0.9 KB gz (clone of existing overlay code; data is existing static shards) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-11 Library access layer from the Kirkanta v4 national register

| | |
|---|---|
| **What** | New build-time `fetch_libraries.py` pages the Kirkanta v4 API (`with=coordinates,addressInfo`; ~982 service points with lat/lon + zipcode), snaps each point into a postal polygon via `prepare_data.py`'s `_point_to_pno`/`_build_spatial_index`, and computes distance-to-nearest-library (m) and/or libraries per 10k residents per area; join in `prepare_data.py`, run `build:data`. Register a `LayerId`/LayerConfig (align units with existing service layers), a `LAYER_GROUPS` `layers.services` entry (`LayerSelector.tsx:31`), a `metrics.ts` def, registry + provenance row (publisher `kirjastot_fi`, `is_proxy:false`), and fi/en/sv labels. No library category exists today. |
| **Why** | Libraries are a beloved, universal Finnish everyday service and a category with zero coverage today. An authoritative, complete, live national register beats OSM; directly relevant to families/students; build-time so data is zero-bundle. |
| **Data source** | Kirjastohakemisto / Kirkanta API v4 — https://api.kirjastot.fi/v4/library?with=coordinates,addressInfo — CC BY 4.0 — coordinate (982 service points), snapped to postal, `is_proxy:false` |
| **Touches** | `scripts/fetch_libraries.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | 0 (build-time) for data; ~300–400 gz B for LayerConfig + fi labels. Designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-12 National protected-nature & national-park access layer (SYKE)

| | |
|---|---|
| **What** | Add a national "distance to nearest protected area / national park" (and/or per-postal %-protected) layer from SYKE Natura 2000 + nature-conservation/wilderness/national-park polygons. Build-time `fetch_protected_areas.py` (mirroring `fetch_tree_canopy.py`), intersect each postal polygon, write into the GeoJSON, run `build:data`; real polygon geometry → `is_proxy:false`. Register a LayerConfig, a `LAYER_GROUPS` Environment entry, a `metrics.ts` def, registry/provenance row, locale keys, and re-baseline `validate_data.py`. Distinct from the **excluded** urban green-space layer — this is statutory conservation/wilderness access. |
| **Why** | `tree_canopy` (HSY LiDAR) is real but capital-region-heavy, leaving most of Finland with weak "greenery/nature" coverage. SYKE protected areas are national and polygon-precise, answering a distinct relocation question ("how close is real wilderness/nature?") that fills `tree_canopy`'s rural hole. |
| **Data source** | SYKE Natura 2000 + Luonnonsuojelu- ja erämaa-alueet WFS — https://ckan.ymparisto.fi/dataset/natura2000-alueet — CC BY 4.0 — polygon (national, INSPIRE Protected Sites), aggregated to postal, `is_proxy:false` |
| **Touches** | `scripts/fetch_protected_areas.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | 0 (build-time) for data; ~300–400 gz B for LayerConfig + fi labels. Designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-13 Cultural-heritage / historic-character layer from Museovirasto WFS

| | |
|---|---|
| **What** | New build-time `fetch_heritage.py` + spatial join over Museovirasto's open WFS (`muinaisjäännökset` points/areas, RKY 2009 nationally-significant built-environment polygons, protected buildings) to derive per-postal "protected heritage sites per km²" and/or "share of area inside an RKY zone"; `build:data`. Add a **neutral** LayerConfig (no `higherIsBetter`) + a `LAYER_GROUPS` entry + `metrics.ts` def + registry/provenance (publisher `Museovirasto`, `is_proxy:false`) + fi/en/sv labels. No heritage/protection layer exists today; `building_age` measures construction vintage, orthogonal to legal protection. |
| **Why** | Captures a genuinely new, decision-relevant "is this an old, characterful, protection-constrained area or a new-build zone?" dimension that pairs with `building_age` and the planning centerpiece. National CC BY 4.0 WFS with real geometry, strong distinctive SEO/profile material. |
| **Data source** | Museoviraston kulttuuriympäristöaineistot, suojellut kohteet WFS (muinaisjäännökset, RKY 2009, suojellut rakennukset) — endpoint `http://kartta.nba.fi/arcgis/services/WFS/MV_KulttuuriymparistoSuojellut/MapServer/WFSServer` — CC BY 4.0 — point+polygon, national, aggregated to postal, `is_proxy:false` |
| **Touches** | `scripts/fetch_heritage.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | 0 (build-time) for data; ~300–400 gz B for LayerConfig + fi labels. Designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-14 Microclimate grid overlay (snow-cover days / mean annual temperature) from FMI 1 km gridded observations

| | |
|---|---|
| **What** | New build-time `fetch_fmi_climate.py` from the FMI gridded-observations AWS S3 bucket (`fmi-gridded-obs-daily-1km`) aggregates multi-year daily 1 km grids into a climate normal (snow-cover days and/or mean annual temperature), downsamples to the project grid, and emits a new grid shard fetched at runtime as a `?url` asset. Wire via the existing grid machinery: add to `grid_manifest.json` (currently only `air_quality`/`light_pollution`/`transit_reachability`), a `gridProperty` entry + LayerConfig in `colorScales.ts` (selectable in `LayerSelector.tsx`); `useGridData`/`gridFade` handle the rest. Register in registry/provenance (publisher FMI, `is_proxy:false`). Does **not** touch `metrics.ts` or the GeoJSON (grid path). |
| **Why** | A genuinely new environmental axis (warmth / snow burden) distinct from air quality/light pollution/noise/tree canopy, at 1 km resolution (finer than postal), slotting directly into the shipped grid-overlay pattern so data ships as a `?url` grid shard with zero JS-bundle data cost. Snow-cover days is a concrete relocation signal (heating/maintenance burden). |
| **Data source** | FMI gridded climate observations on AWS S3 (1 km grids: mean temperature, snow depth, precipitation; 1981–present NetCDF) — https://en.ilmatieteenlaitos.fi/gridded-observations-on-aws-s3 — CC BY 4.0 — 1 km grid (sub-postal), national, `is_proxy:false` |
| **Touches** | `scripts/fetch_fmi_climate.py`, `scripts/build_grid_data.mjs`, `src/data/grid_manifest.json`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Bundle** | 0 (lazy `?url` grid asset) for data; ~250–350 gz B for LayerConfig + manifest entry + fi labels. Designated BUDGET-bumper for its batch (sized to also cover CF-6) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 Derive RadarChart axis min/max from `national_ranges.json` instead of hardcoded constants

| | |
|---|---|
| **What** | Replace the baked `AXES` min/max literals in `RadarChart.tsx:20-76` (e.g. transit 5–65, housing 1000–12000, crime cap 170) with lookups into the already-loaded `national_ranges.json` via `nationalRanges.ts` `getNationalRanges` (winsorized p2/p98 bounds), keeping inverted/direction handling. The `radar.services` axis is a composite mean of grocery/healthcare/school_density with no single national key — average those three bounds (all present). Net-zero bundle (constants swapped for an existing-asset lookup). |
| **Why** | Current caps are metro-centric (national transit max = 17.07 vs hardcoded 65; housing max = 5410 vs 12000), so most of the 3,018 areas peg near the floor and the radar shape misrepresents rural areas; the constants also go stale on every data refresh. A data-honesty + accuracy fix using the live national distribution the app already has. Foundation for CF-9's N-series radar. |
| **Data source** | Statistics Finland Paavo national ranges already in `src/data/national_ranges.json` — CC BY 4.0 — postal |
| **Touches** | `src/components/RadarChart.tsx`, `src/utils/nationalRanges.ts` |
| **Bundle** | ~0 (constants replaced by existing-asset lookup) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Doc-honesty pass: correct drifted budget / counts / migration claims

| | |
|---|---|
| **What** | Fix verified-stale numbers/claims across `CLAUDE.md` + `docs/ARCHITECTURE.md` + `docs/QUALITY_INDEX.md`: bundle budget "280,000" → the final `check-bundle-size.mjs` `BUDGET` (currently 295,000, raised once per batch this roadmap); "weightable factors" count → post-roadmap `QUALITY_FACTORS` (+1 from CF-3); "~21 hooks" → ~25; grid section "(air_quality, light_pollution)" → 3+ grids incl. `transit_reachability` (and CF-14's climate grid); remove "no migration system" (`db.ts` now has a forward-only `runMigrations` with `schema_migrations` + advisory lock; fix the stale `db.ts` JSDoc too); "59 layers" → post-roadmap `LAYERS` count; "Map.tsx ~1,500 lines" → ~1806. Derive counts at build time where cheap. **Sequence last** so counts reflect every newly merged layer/factor. |
| **Why** | These docs are the onboarding/source-of-truth for contributors and for Claude Code itself; drift erodes trust and causes wrong decisions (e.g. assuming "no migration system" and hand-altering tables, or acting on a wrong budget). Pure correctness/credibility win, zero risk. |
| **Touches** | `docs/ARCHITECTURE.md`, `CLAUDE.md`, `docs/QUALITY_INDEX.md` |
| **Bundle** | 0 (docs only) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Quality-Index honesty gap: a default Safety factor is only 72.4% covered but code/docs claim ~97–100%

| | |
|---|---|
| **What** | `qualityIndex.ts:74` asserts "every default factor has ~97–100% national coverage" and that thin coverage "only affects optional factors like school_quality", and `QUALITY_INDEX.md:72-77` repeats it — yet `traffic_accidents` (a **default-weighted** Safety factor, `defaultWeight 4`, `primary:true`, reads `traffic_accident_rate`, `qualityIndex.ts:447-454`) has **72.4%** coverage per `build_metadata.json:470-476`, so ~833 postal codes get neutral-50 imputed under all-Finland scope. Correct the comment + methodology doc to acknowledge the ~72% figure (and that thin coverage affects this default factor, not only optional ones). Advisable scope is the **doc/comment fix only** — the existing Väylävirasto data is postal + non-proxy, so a municipal Traficom backfill would *downgrade* granularity. |
| **Why** | The methodology doc is a core trust artifact for a data-honest product; overstating completeness for a quarter of the country on a headline-affecting factor undermines exactly the honesty positioning the project leans on. Zero-risk doc fix. |
| **Touches** | `src/utils/qualityIndex.ts`, `docs/QUALITY_INDEX.md` |
| **Bundle** | 0 (build-time) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 High-contrast / forced-colors accessibility layer

| | |
|---|---|
| **What** | No `prefers-contrast` or `forced-colors` support exists today (grep over `src/` = 0; existing media blocks are only reduced-motion and coarse-pointer). Add a CSS-only layer in `src/index.css`: `@media (prefers-contrast: more)` strengthens borders, makes translucent `/80` panel backgrounds opaque, and thickens focus rings; `@media (forced-colors: active)` adds `forced-color-adjust` hints and visible borders on legend swatches and map controls so Windows High Contrast users keep affordances. Distinct axis from the existing colorblind palettes. |
| **Why** | Serves low-vision and Windows High Contrast Mode users — an accessibility population the colorblind palettes don't cover. CSS-only, no JS bundle cost. |
| **Touches** | `src/index.css` |
| **Bundle** | 0 (CSS only) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Add a "no data" hatch swatch to the Legend and SplitPaneLegend

| | |
|---|---|
| **What** | Render a small diagonal-hatch swatch labeled "Ei tietoa / No data" in `Legend.tsx` (alongside the ramp at `:123-137`) and in `SplitMapView`'s `SplitPaneLegend` (`:95-141`), reusing `hatchPattern.ts` geometry (45° stripe, `#94a3b8`/`#64748b`) as a CSS `repeating-linear-gradient` (prefer CSS to stay under budget) so the on-map gray hatch is self-explanatory even when the `<50%` `coverage.low_banner` does not fire. Optionally a second swatch for the sub-region "estimate" hatch. Adds 3 short fi keys (en/sv free). |
| **Why** | On sparse layers the gray hatch can dominate the map, but the legend only shows the color ramp (and a `▦`-glyph banner gated at `<50%`); users can't map the pattern to a meaning. An honesty/legibility win. |
| **Touches** | `src/components/Legend.tsx`, `src/components/SplitMapView.tsx`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~300 gz B (CSS swatch + 3 fi keys) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Promote the map container to a `<main>` landmark + announce language switches

| | |
|---|---|
| **What** | Two a11y fixes: (1) change `<div id="main" tabIndex={-1}>` (`App.tsx:2092`) to `<main id="main">` so the skip link lands on a real landmark, matching `NeighborhoodProfilePage.tsx:456` (single `main` per SPA, block-level so the `h-dvh`/`overflow-hidden` layout holds). (2) Route language switches through the existing `setAriaAnnouncement` live region (`App.tsx:2884`, fed for selection/filter/wizard/layer at `:1199/:1560/:1565/:1833` but never for lang) from `handleLangChange` (`App.tsx:1517-1529`) / `LanguagePicker.tsx` so SR users hear the change and brief loading state. Add the new key to all three locales. |
| **Why** | On the app's core screen the single most important region is not exposed as "main" (inconsistent with the profile/404 pages), and a content-wide language change is the one large state change the app's live region never announces. Both reuse existing infrastructure. |
| **Touches** | `src/App.tsx`, `src/components/LanguagePicker.tsx`, `src/locales/{fi,en,sv}.json` |
| **Bundle** | ~100 gz B (1 `t()` call + a couple keys; en/sv free) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Gate the full `validate_data.py` on data-touching branches

| | |
|---|---|
| **What** | Add a CI job in `auto-merge.yml` (paths filter on `public/data/**` + `scripts/**`) that runs the **full** `python scripts/validate_data.py` — value-range, coverage-regression, all-null, geometry, feature-count, postal-format checks (`:593-605`) against the committed 39 MB GeoJSON. Today `ci.yml:62` and `auto-merge.yml:73` run only `--files-only` (registry/provenance checks at `:572-578`, skipping the GeoJSON); the heavy suite runs solely in `data-refresh.yml:96` (quarterly cron). The push path's only data gate is the `build:data` idempotency check, which verifies reproducibility, not sanity. |
| **Why** | A hand-edited fetch script + regenerated GeoJSON pushed on a `claude/*` branch merges with no value-range, coverage-drop, or geometry validation — a silently nulled column would ship. Closes a real integrity hole on the manual-data path and **protects every data-layer batch in this roadmap**. |
| **Touches** | `.github/workflows/auto-merge.yml`, `scripts/validate_data.py` |
| **Bundle** | 0 (build-time) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 Expand the `server/api` route test suite (and mirror it into `ci.yml`)

| | |
|---|---|
| **What** | Expand `server/api/src/auth.routes.test.ts` beyond the lone favorites GET/PUT + 401/413/CSRF/429 to cover the untested security/GDPR-critical handlers: signup (`:94`), login incl. invalid-credential/enumeration path (`:184`), logout (`:226`), `/me` (`:373`), notes (`:515/532`), shortlist (`:460/476`), preferences (COALESCE partial-update preserving unspecified fields at `:718-725` + `wizardProfile` persistence at `:707-714`), `/export` payload shape (`:304`), `DELETE /account` (`:348`), and the `db.ts` forward-only migration runner (`:38-87`). The harness (pg-mem + supertest + `createApp`) already exists. **Note:** the server suite is *already* gated for merges — `auto-merge.yml` defines a `server` job (`:229-255`) that merge-to-main depends on (`:258`); do **not** re-add it there. The only remaining wiring is mirroring `npm test` into `ci.yml` (which runs only `npm audit` at `:26-27`) for faster branch-level feedback. |
| **Why** | The most security-relevant handlers (credential auth, GDPR export/delete, partial-update preferences, schema migrations) have zero route-level tests; the merge gate already runs the suite, so new tests immediately become enforcing. |
| **Touches** | `server/api/src/auth.routes.test.ts`, `.github/workflows/ci.yml` |
| **Bundle** | 0 (server-side / build-time; no app JS) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Add the missing login-merge guard (and tombstones) to `useFilterPresets`

| | |
|---|---|
| **What** | Add the `loginMergePendingRef` pattern to `useFilterPresets.ts` so its 1 s debounced PUT (`:116-128`) is deferred during the null→id login transition until the on-login GET/merge resolves (mirroring `useQualityWeights.ts:66/85/93` + `.finally` clear at `:152`), and add deletion tombstones via `syncTombstones.ts` (`mergeRespectingTombstones`/`addTombstone`, keyed on `presetSig`) so a deleted preset isn't resurrected by the pure set-union `mergePresets` (`:59-70`) from a stale server/device copy. Five of the six synced stores got these guards in the prior sync work; filter presets (a list store) got neither. |
| **Why** | Closes a real (if narrow) cross-device data-loss window and fixes cross-device preset resurrection, bringing the last synced store in line with the conflict-resolution rollout. Pure correctness, near-zero bundle, mirrors proven code. |
| **Touches** | `src/hooks/useFilterPresets.ts`, `src/utils/syncTombstones.ts` |
| **Bundle** | ~0.1 KB gz |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-4 Make visual-regression real on the merge path, or remove the dead suite

| | |
|---|---|
| **What** | Either **(a)** add a `workflow_dispatch` job that generates+commits `*-linux.png` baselines on the ubuntu runner and wire a `visual` job into `auto-merge.yml`'s `needs` list; or **(b)** delete `e2e/visual/visual-regression.spec.ts` + the Playwright `visual` project (`playwright.config.ts ~:58-67`). Today there are **0** committed `*-linux.png` baselines (`ci.yml:88-98` self-generates with `--update-snapshots||true` then self-compares = always green) and `auto-merge.yml` has no `visual` job, while `ci.yml` is skipped on `claude/*` (`:11-12/:42-43`) — so visual tests never gate the only path to main. **Recommend (b)** as lower-risk/higher-honesty unless pixel gating is actively wanted. |
| **Why** | All visual-regression infrastructure is dead weight providing false assurance. Making it real catches CSS/layout regressions on the merge path; removing it deletes a maintenance trap. Either choice resolves the honesty gap. |
| **Touches** | `.github/workflows/auto-merge.yml`, `.github/workflows/ci.yml`, `e2e/visual/visual-regression.spec.ts`, `playwright.config.ts` |
| **Bundle** | 0 (build-time) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-5 Make the open-data corpus GIS-joinable and portal-harvestable (lat/lon + GeoJSON + DCAT `data.json`)

| | |
|---|---|
| **What** | Add centroid lat/lon columns to `areas.csv` and the `/api/v1/areas/{pno}.json` records (`ID_COLUMNS` at `build_open_data.mjs:273` omits coordinates today; `region_properties.json` already carries lat/lon + `euref_x/euref_y`), emit a new `/avoin-data/naapurustot_areas.geojson` centroid-points distribution, and publish a **DCAT-AP `/data.json`** catalog (alongside the existing schema.org JSON-LD distribution at `:457`) describing the CSVs + frozen JSON API + codebook so CKAN/DCAT harvesters (avoindata.fi, data.europa.eu) can ingest automatically. Wire the new files into the sitemap. |
| **Why** | Researchers can't map or spatially join the corpus today even though `region_properties.json` already carries coordinates. Adding centroid lat/lon + a GeoJSON makes it directly GIS-joinable, and a DCAT catalog makes the dataset eligible for automated harvesting — extending reach with zero new external source. |
| **Data source** | Repackages existing in-repo data: `region_properties.json` lat/lon + `euref_x/euref_y` (ETRS-TM35FIN) from Tilastokeskus Paavo postal-area centroids, CC BY 4.0 — no new external source |
| **Touches** | `scripts/build_open_data.mjs`, `scripts/generate-sitemap.mjs` |
| **Bundle** | 0 (build-time) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code — *with one Manual Setup follow-up:* actual avoindata.fi ingestion needs a one-time harvest-source/organization registration on the portal. The DCAT catalog **enables** harvesting but does not auto-trigger it. |

---

## Suggested Sequencing

Each batch is internally parallel-safe for concurrent Claude Code sessions **with the serialization notes stated**, and depends only on prior batches. **Global caveats for every batch:**

- **Auto-merge shares one concurrency group**, so a second `claude/*` push cancels an in-flight merge — develop sessions in parallel but **stagger the pushes** (treat each intra-batch order below as the push order).
- **Exactly one designated item per batch may edit `scripts/check-bundle-size.mjs`** (the BUDGET-bumper, called out per batch). Every JS-touching item must still measure its gz delta with `bundle:check` before push.
- **Data-layer items each run `build:data`** (regenerating `region_properties.json`/`national_ranges.json`/`regions/*.topojson`); only one item per batch may own the GeoJSON regeneration — noted per batch.
- Re-run the i18n key-parity test after every locale edit.

**No item is strictly Manual Setup** — all 35 are implementable in a Claude Code session. The only manual follow-up is IN-5's optional avoindata.fi portal registration. Operational call-outs (not hand-blocking): the data-layer fetchers (CF-4/5/11/12/13/14, QW-1) hit external open WFS/OGC/REST endpoints **at build time** (pin layer names via GetCapabilities; confirm CI/build network egress; any unavailable source ships as honest partial coverage with the gray-fallback policy). IN-2 touches `server/`, deployed via the separate `deploy-server.yml` pipeline.

### Batch 1 — Foundation: flagship socioeconomic layer + core search + real CI gates

Open with the single most decision-relevant new data axis and the dominant-navigation-path fix, while standing up the integrity scaffolding the rest of the roadmap leans on.

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-3 | Low-income share layer + opt-in QI factor | Core | Medium | Claude Code |
| CF-2 | Accent-folded + municipality-aware search | Core | Medium | Claude Code |
| QW-3 | Highlight + scroll-to selected area in ranking tables | Quick Win | Small | Claude Code |
| IN-1 | Gate full `validate_data.py` on data branches | Infrastructure | Medium | Claude Code |
| IN-2 | Expand server route tests + mirror into `ci.yml` | Infrastructure | Medium | Claude Code |
| PO-1 | Derive RadarChart axes from `national_ranges.json` | Polish | Small | Claude Code |

**Parallel-safety:** No two items share a file. **CF-3** is the only editor of `colorScales.ts`/`metrics.ts`/`prepare_data.py`/`qualityIndex.ts`/`data_sources.json`/`provenance.json`/GeoJSON here, the sole `build:data` runner, and the **sole BUDGET-raiser**. CF-2 owns `dataLoader.ts`/`build_region_data.mjs`; QW-3 owns `App.tsx` + the ranking tables; IN-1 owns `auto-merge.yml` + `validate_data.py`; IN-2 owns `ci.yml` + `auth.routes.test.ts`; PO-1 owns `RadarChart.tsx`. Only CF-3 adds locale keys. If possible, **merge IN-1 before CF-3** so CF-3 is validated by the new gate. PO-1 also lays the national-range axis foundation CF-9 (Batch 3) extends.

### Batch 2 — National reach: 3,018-area filtering + 15-minute access layers

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-4 | Distance-to-essential-services layers (+ pharmacy) | Core | Large | Claude Code |
| CF-1 | Opt-in national filtering across 3,018 areas | Core | Large | Claude Code |
| QW-7 | Fix the no-op CI type-check step | Quick Win | Small | Claude Code |
| QW-4 | RegionRankingTable CSV + copy-link parity | Quick Win | Small | Claude Code |
| QW-8 | Stop shipping `dist/stats.html` | Quick Win | Small | Claude Code |

**Parallel-safety:** **CF-4** is the sole editor of the layer-registry cluster (`colorScales.ts`/`metrics.ts`/`prepare_data.py`/registries/GeoJSON/locale), the sole `build:data` runner, and the **sole BUDGET-raiser**. CF-1 owns `App.tsx` + `FilterPanel.tsx` + `dataLoader.ts` + `filterUtils.ts` (CF-2's `dataLoader.ts` edits already merged). QW-7 owns `ci.yml` + `auto-merge.yml` (rebasing on IN-1); QW-8 owns `vite.config.ts`; QW-4 owns `RegionRankingTable.tsx` (QW-3 already merged). CI-workflow edits proceed in order IN-1(B1)→QW-7(B2)→IN-4(B3).

### Batch 3 — Real building data + comparison upgrades + split-view parity

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-5 | True Ryhti building-permit construction-flow layer | Core | Large | Claude Code |
| CF-9 | ComparisonPanel multi-series radar + mobile parity | Core | Medium | Claude Code |
| CF-10 | Planning + isochrone overlays in SplitMapView | Core | Medium | Claude Code |
| CF-7 | Prerendered X-vs-Y comparison pages | Core | Large | Claude Code |
| IN-4 | Make visual-regression real, or remove the dead suite | Infrastructure | Medium | Claude Code |

**Parallel-safety:** **CF-5** owns `colorScales.ts`/`metrics.ts`/`prepare_data.py`/GeoJSON/`validate_data.py` (rebasing on IN-1's gate) and is the only `build:data` runner. **CF-9** owns `RadarChart.tsx` + `ComparisonPanel.tsx` and is the **designated sole BUDGET-raiser** — CF-5 reuses the existing `construction_activity` layer (~0 JS), so CF-9's bump must cover CF-9 (~1.5 KB) + CF-10 (~0.9 KB). CF-10 owns `SplitMapView.tsx` + `App.tsx` + `usePlanningData.ts`; CF-7 owns `prerender-hubs.mjs` + `generate-sitemap.mjs` + `comparisonStats.ts` + `adjacency.json`; IN-4 owns the visual spec + `playwright.config.ts` (its `ci.yml`/`auto-merge.yml` edits follow QW-7). CF-9 depends on PO-1 (merged Batch 1). Two locale-adders (CF-5, CF-9) add distinct append-only keys — stagger their merges.

### Batch 4 — Livelihood axis + entity grounding + accessibility/legibility polish

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-1 | Job self-sufficiency layer | Quick Win | Small | Claude Code |
| CF-8 | Wikidata/Wikipedia entity linking in JSON-LD | Core | Medium | Claude Code |
| PO-5 | "No data" hatch swatch in Legend + SplitPaneLegend | Polish | Small | Claude Code |
| PO-6 | `<main>` landmark + announce language switches | Polish | Small | Claude Code |

**Parallel-safety:** **QW-1** is the sole layer-registry editor, only `build:data` runner, and **sole BUDGET-raiser** (sized to also cover PO-5's ~300 B and CF-8's client tens-of-bytes). CF-8 owns `prerender.mjs` + `prerender-hubs.mjs` + `JsonLd.tsx` + `wikidata_qids.json` (CF-7's `prerender-hubs.mjs` edits already merged). PO-5 owns `Legend.tsx` + `SplitMapView.tsx` (CF-10 already merged). PO-6 owns `App.tsx` + `LanguagePicker.tsx`. Two locale-adders (QW-1, PO-5) — distinct keys, stagger merges.

### Batch 5 — Libraries layer + speculation prefetch + open-data plumbing

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-11 | Library access layer (Kirkanta v4) | Core | Medium | Claude Code |
| QW-6 | Speculation Rules prefetch in static pages | Quick Win | Small | Claude Code |
| IN-5 | GIS-joinable + DCAT-harvestable open-data corpus | Infrastructure | Medium | Claude Code* |
| PO-3 | Fix QI coverage-honesty claim (traffic_accidents 72.4%) | Polish | Small | Claude Code |

**Parallel-safety:** **CF-11** is the sole layer-registry editor, only `build:data` runner, and **sole BUDGET-raiser**. QW-6 owns `prerender.mjs` + `prerender-hubs.mjs` (CF-8's prerender edits already merged). IN-5 owns `build_open_data.mjs` + `generate-sitemap.mjs` (CF-7's sitemap edits already merged). PO-3 owns `qualityIndex.ts` + `QUALITY_INDEX.md` (CF-3's `qualityIndex.ts` edits already merged; PO-2's `QUALITY_INDEX.md` edit deferred to Batch 8). Only CF-11 adds locale keys. *IN-5 has the optional manual portal-registration follow-up.*

### Batch 6 — Protected-nature layer + mobile chrome theming + complete exports

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-12 | National protected-nature / national-park layer (SYKE) | Core | Medium | Claude Code |
| QW-9 | Light/dark `theme-color` for mobile chrome | Quick Win | Small | Claude Code |
| QW-2 | Complete CSV/PDF exports (~13 missing metrics) | Quick Win | Small | Claude Code |

**Parallel-safety:** **CF-12** is the sole layer-registry editor, only `build:data` runner, and **sole BUDGET-raiser**. QW-9 owns `index.html` + `prerender-hubs.mjs` + `vite.config.ts` + `useTheme.tsx` (`prerender-hubs.mjs` free again — CF-7/CF-8/QW-6 merged; `vite.config.ts` free — QW-8 merged). QW-2 owns `export.ts`. Only CF-12 adds locale keys.

### Batch 7 — Cultural-heritage layer + sync correctness + onboarding a11y

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-13 | Cultural-heritage / historic-character layer (Museovirasto) | Core | Medium | Claude Code |
| IN-3 | Login-merge guard + tombstones for `useFilterPresets` | Infrastructure | Small | Claude Code |
| QW-10 | Announce onboarding tour steps to screen readers | Quick Win | Small | Claude Code |

**Parallel-safety:** **CF-13** is the sole layer-registry editor, only `build:data` runner, and **sole BUDGET-raiser**. IN-3 owns `useFilterPresets.ts` + `syncTombstones.ts`. QW-10 owns `OnboardingTour.tsx`. Two locale-adders (CF-13, QW-10) — distinct keys, stagger merges.

### Batch 8 — Climate grid + profile depth + final doc/coverage truth-up

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-14 | FMI 1 km microclimate grid overlay | Core | Large | Claude Code |
| CF-6 | Render latent profile enrichment in the React profile page | Core | Medium | Claude Code |
| PO-4 | High-contrast / forced-colors a11y layer | Polish | Medium | Claude Code |
| PO-2 | Doc-honesty pass (budget/counts/migration) | Polish | Small | Claude Code |
| QW-5 | Re-baseline the coverage ratchet | Quick Win | Small | Claude Code |

**Parallel-safety:** **CF-14** owns `colorScales.ts` + `LayerSelector.tsx` + `grid_manifest.json` + `build_grid_data.mjs` (the **grid path** — it does **not** touch `metrics.ts` or the GeoJSON) and is the **sole BUDGET-raiser**, sized to cover CF-6's ~1.5 KB. **CF-6** owns `NeighborhoodProfilePage.tsx` + `src/components/profile/` + `metrics.ts` (disjoint from CF-14, which is why they co-batch) and must **not** edit `check-bundle-size.mjs`. PO-4 owns `index.css`. **PO-2** (`ARCHITECTURE.md`/`CLAUDE.md`/`QUALITY_INDEX.md`) and **QW-5** (`coverage-baseline.json`) are deliberately **last** so counts, BUDGET, and measured coverage reflect every merged layer/factor — run them only after the other Batch-8 items merge. Two locale-adders (CF-14, CF-6 fi) — distinct keys, stagger merges.

---

### Cross-batch serialization is free

Because batches merge sequentially, every file shared **across** batches is auto-serialized — each later toucher rebases on the prior batch's merged state: the layer-registry cluster `colorScales.ts`/`metrics.ts`/`prepare_data.py`/`data_sources.json`/`provenance.json`/GeoJSON (one sole owner per batch: CF-3 → CF-4 → CF-5 → QW-1 → CF-11 → CF-12 → CF-13; CF-14 uses the disjoint grid path), `qualityIndex.ts` (CF-3 → PO-3), `validate_data.py` (IN-1 → CF-5), the CI workflows (IN-1 → QW-7 → IN-4 → IN-2), `prerender-hubs.mjs` (CF-7 → CF-8 → QW-6 → QW-9), `App.tsx` (QW-3 → CF-1 → CF-10 → PO-6), `SplitMapView.tsx` (CF-10 → PO-5), and the doc files (PO-3's `QUALITY_INDEX.md` → PO-2).

---

### Audit method

Produced by a 63-agent background workflow: **9 parallel codebase subsystem surveys** (map/viz, data-layers/QI/similarity, panels/exports, state/sync/backend, search/filter/URL, SEO/prerender/open-data, i18n/a11y/mobile, data-pipeline, infra/CI/perf) + **5 live external-data dossiers** (new national open datasets, Ryhti/RYTJ zoning+permit rollout, sub-postal services/amenities, competitive/GEO landscape, frontend/web-platform tech) → **6 ideation lenses** → dedup/pre-filter (70 raw → 34) → **one adversarial verifier per candidate** (charged with proving it already shipped, was excluded, violated the bundle/real-data/granularity constraints, or rested on unavailable data — checking file:line, `git log`, and live external APIs) → a **completeness critic** (added 3 verified items) → a sequencing analysis over the verified `touches` lists. 33 of 34 deduped candidates survived verification (1 rejected — the national asemakaava-coverage layer, on a live `numberMatched=0`-for-Helsinki check). External facts verified live include the Ryhti `ryhti_plan`/`ryhti_permit` OGC API collections (5,634 valid plans vs ~2.73M permit points), the Kirkanta v4 library API (982 points), StatFin Oppilaitokset + 1 km grid, SYKE Natura 2000, Museovirasto WFS, FMI gridded-observations S3, and the verified deadlines (zoning statutory 1 Jan 2029; permit submission voluntary until 31 Dec 2028).
