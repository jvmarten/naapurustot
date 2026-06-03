# naapurustot.fi — Feature Roadmap

> Generated 2026-06-03 from a fresh multi-agent codebase audit (10 parallel subsystem surveys → synthesis → adversarial per-item verification that nothing here is already shipped → completeness critic). Supersedes the 2026-06-01 roadmap, nearly all of which has shipped.

## Project Context

naapurustot.fi is a static, backend-optional React 19 / TypeScript 5.9 / Vite 8 single-page app built on MapLibre GL, live at naapurustot.fi. It renders 60+ neighborhood-level data layers across ~3,018 postal codes in all 69 Tilastokeskus seutukunnat (lazy-loaded per-region TopoJSON), plus two real 250 m grids (air quality, light pollution), all from verifiable public sources (Tilastokeskus Paavo, HSL/Digitransit, HSY, Helsinki Region Infoshare, OSM, NASA VIIRS). On top of the map sits a deep decision-support layer: a composite Quality Index with personas, national winsorized normalization and per-area factor-coverage auditability; a discovery wizard; multi-criteria filters; similarity / correlation / ranking tools; comparison and a durable named shortlist; custom reference baselines; property-price & crime time-series with trend charts; travel-time isochrones; exhaustive shareable URL state; CSV / PDF / PNG export; and ~27,000 prerendered FI/EN/SV profile + hub pages with rich JSON-LD. An optional Express 5 + PostgreSQL backend (api.naapurustot.fi) cloud-syncs favorites/notes/shortlist/preferences behind hardened auth (bcrypt-12, Turnstile, rate limiting, timing-safe login). CI/CD is comprehensive (lint, tsc, Vitest coverage ratchet, e2e + axe a11y, Lighthouse, bundle budget, region payload audit, CodeQL, daily health-check cron, quarterly data-refresh).

The project is now **highly mature** — nearly the entire prior QW/CF/PO/IN roadmap has shipped (see "Completed" at the end). The remaining work is therefore narrower deltas and a few genuinely new frontiers rather than foundational gaps.

## The frontier this roadmap targets

1. **Translate abundant raw stats into a personal decision.** Almost every per-area number a relocator needs — median income, sale and rent €/m², quality dimensions, national ranges, percentiles — already sits in the GeoJSON but is shown as a flat figure. An affordability-to-my-income lens, an auto-composed plain-language strengths/weaknesses verdict, an anchor to the user's own address, commute-from-my-office filtering, and the **missing geographic lens — "what's the cheaper area next door"** — would convert a stats browser into a true "where could I actually live" tool with zero new data.
2. **Close honesty / parity deltas cheaply.** Surface the already-computed per-layer `coverage_pct` and per-layer vintage staleness, ship a true no-data hatch, correct a phantom "250 m grid" label, and serialize the last un-shareable analytical states (drawn areas) and embed parity — all high-trust, low-cost, real-data-only.
3. **Deeper real granularity (the data-mandate prize).** A *feasible* national 1 km / metro 250 m demographic grid, OSM building-footprint morphology, and an MML elevation/terrain signal. These are heavier and two were previously **deferred by the owner** — flagged explicitly below.
4. **Protect the maturing backend & distribution.** GDPR delete/export endpoints + a privacy notice, a server-API CI/test gate, a Postgres-backed rate limiter, DB-aware health checks, per-area social cards, and a share-URL version guard before the URL becomes the product's primary viral artifact.

Every item respects the hard constraints: real verifiable public sources only, finest-available granularity, data propagated into the GeoJSON source of truth and rebuilt into TopoJSON, the ~250 KB (256,000-byte) gzipped JS bundle budget with heavy deps lazy-loaded, and the `claude/*` branch + auto-merge workflow.

> **Note on item IDs:** these are fresh IDs for this document and do **not** map to the old roadmap's IDs (e.g. old `CF-1` shareable URL state has shipped; new `CF-1` is the affordability calculator). Verification confirmed all 49 items below are genuinely not-yet-built.

---

## 1 — Quick Wins

### QW-1 Crime-rate change-over-time choropleth layer

| | |
|---|---|
| **What** | Add a `crime_index_change` LayerId to `colorScales.ts` (diverging scale, `divergingCenter: 0`, `higherIsBetter: false`) reading the already-computed `crime_index_change_pct`, register it in a `LAYER_GROUPS` bucket in `LayerSelector.tsx` (otherwise it never renders), add its `data_sources.json` row and FI/EN/SV labels. Pure wiring of an existing derived metric — mirrors the shipped income/population/unemployment/property-price change layers. |
| **Why** | Whether crime is rising or falling is one of the most decision-relevant trends, but `crime_index_change_pct` (derived from Poliisi history, already in the GeoJSON + `national_ranges.json`) is reachable only via the time slider, not as a direct change choropleth. Closes the obvious gap among the change-over-time layers. |
| **Touches** | `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `src/utils/metrics.ts` (optional explanation), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Anchor the reference baseline to "where I live now" via address

| | |
|---|---|
| **What** | Wire the existing address geocoder so a user can type their current home address and set it as the (shipped) reference baseline. When `SearchBar` resolves an address to a containing neighborhood, offer a "Set as my home / compare everything to here" action calling `onSetReference`. Add a persistent "My home: {area}" chip, **adding new localStorage persistence** for the reference (today it lives only in component state + the `ref` URL param). |
| **Why** | The reference baseline shipped, but a relocator's natural anchor is the address they live at today — and they usually don't know its postal-code area name to select it manually. One-step access to the most persuasive lens, reusing the geocoder and `ref` URL state already built. |
| **Touches** | `src/components/SearchBar.tsx`, `src/App.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/hooks/useUrlState.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Correlation explorer: R², significance hint & per-region trend lines

| | |
|---|---|
| **What** | Alongside the existing Pearson r, compute and display R² (variance explained) and an n-aware significance hint, and add a "single trend vs color-by-region" control plus optional per-region best-fit lines so users can see when a global correlation is a clustering (Simpson's-paradox) artifact. Points are already colored by region; this adds grouped `bestFit()` calls and one toggle. |
| **Why** | A bare Pearson r overstates confidence and can mislead when regions cluster; R² and per-region trends make the explorer trustworthy for the journalists and officials the project targets, with no new data and a tiny code footprint. |
| **Touches** | `src/utils/correlation.ts`, `src/components/CorrelationExplorer.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/correlation.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Fix Swedish number formatting in the neighborhood panel

| | |
|---|---|
| **What** | `NeighborhoodPanel.tsx` has a panel-local `panelNumFmt()` whose locale is `getLang() === 'en' ? 'en-US' : 'fi-FI'`, so Swedish silently falls through to `fi-FI` for density, €/m² and water-proximity values. Either add an `sv-SE` branch or delete the local duplicates and use the already-`sv`-aware shared formatters in `formatting.ts`. |
| **Why** | A prior pass standardized `sv-SE` formatting everywhere except this panel-local cache, leaving the panel inconsistent with the legend/tooltip/profile under Swedish, a co-official language. Trivial, zero bundle cost, finishes the prior intent. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/utils/formatting.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Include user notes (and shortlist annotations) in exports & the shareable shortlist

| | |
|---|---|
| **What** | Fold the user's own free-text notes (`useNotes`) into the JSON/GeoJSON export (CF-10) and the shortlist export card/CSV (CF-11), under a clear "your private notes" heading. Should be scoped *into* CF-10/CF-11 rather than retrofitted after their export schemas are public. |
| **Why** | Notes are the single highest-effort artifact a user creates during a multi-week housing search, yet `export.ts` has zero note references — they survive in neither export nor share. Including them turns an export from a data dump into the user's actual research dossier. |
| **Touches** | `src/utils/export.ts`, `src/hooks/useNotes.ts`, `src/components/ComparisonPanel.tsx`, `src/components/ShortlistTray.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | CF-10, CF-11 |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 Affordability calculator: rent/buy here on my income or budget

| | |
|---|---|
| **What** | Add an Affordability section to `NeighborhoodPanel` (plus an optional global income/budget input) where the user enters monthly net income or a housing budget and an optional apartment size in m². Compute fully client-side from existing fields: estimated monthly rent (`rental_price_sqm × m²`) and estimated purchase price (`property_price_sqm × m²`), each as a share of budget with a green/amber/red band, plus a "local median income is €X" context line (reads `hr_mtu`). Persist inputs in localStorage and serialize into the share URL; optionally add an "affordable for me" map shading. **Must surface the rent source's vintage + partial coverage inline (see PO-6) so it never overstates confidence.** |
| **Why** | Affordability is the first hard gate in any housing search, and the app already holds €/m² sale prices, €/m²/month rents (~16% coverage) and median income (~97%) per area but shows them only as raw numbers. Turning them into "X% of your budget / you can afford ~Z m² here" converts a stats browser into a decision tool, with zero new data. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/utils/affordability.ts` (new), `src/hooks/useUrlState.ts`, `src/components/Map.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/affordability.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | PO-6 (rent staleness disclosure, hard companion) |
| **Tag** | Claude Code |

### CF-2 Auto-generated plain-language area summary (strengths & weaknesses)

| | |
|---|---|
| **What** | A short auto-composed block at the top of the panel overview turning the area's already-computed national/region percentiles into 2–4 readable sentences and a "Strong / Weak" chip list (e.g. "Top 10% nationally for transit and services; among the most expensive 15%; below-average air quality"). Template the N highest/lowest direction-aware percentiles with FI/EN/SV strings; feed the percentile-based sentences into the prerendered profile meta/noscript for SEO. Templated from real numbers only. *Implementation split:* `quality_dimension_scores` are computed at runtime and are **not** in the GeoJSON, so the dimension-score chips render client-side only; the prerender path uses the percentile sentences (the `percentileRanks` machinery already available there). |
| **Why** | Most visitors are not analysts; a wall of numbers forces interpretation. A two-second "what's good and bad here" verdict is the biggest comprehension upgrade and a highly clickable SEO snippet across ~27k profile pages. |
| **Touches** | `src/utils/areaSummary.ts` (new), `src/components/NeighborhoodPanel.tsx`, `src/utils/percentileRanks.ts`, `scripts/prerender.mjs`, `src/locales/{fi,en,sv}.json`, `src/__tests__/areaSummary.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Commute / destination travel-time filter (anchor an isochrone to a real address)

| | |
|---|---|
| **What** | A "How far from…" destination input beside the existing isochrone controls. The user geocodes a workplace/school address via `geocodeAddress()`, picks mode (walk/bike/transit; optionally a new car mode) and a time budget; the app fetches one isochrone *around the destination* (a `toPlace`/`arriveBy` variant of `fetchIsochrone`), point-in-polygon-tests each neighborhood centroid with `findNeighborhoodForPoint` to shade/filter commute-viable areas, and shows a "within X min of <address>" badge. Cache per destination+mode+budget in sessionStorage; degrade gracefully when `ISOCHRONE_ENABLED` is false. |
| **Why** | Commute is the single most decision-determining relocation constraint and the one question the map cannot answer today — the current isochrone only draws *outward* from a neighborhood you already chose. Typing your office and instantly seeing commute-viable neighborhoods turns "browse stats" into "find where I could live". |
| **Touches** | `src/utils/isochrone.ts`, `src/components/IsochroneControls.tsx`, `src/utils/geocode.ts`, `src/components/Map.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/App.tsx`, `src/hooks/useUrlState.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (inert without `VITE_DIGITRANSIT_API_KEY`) |

### CF-4 Persistent, shareable wizard "priority profile"

| | |
|---|---|
| **What** | Persist the wizard's `WizardAnswers` to localStorage (and cloud-sync when signed in, mirroring `useFilterPresets`/`useQualityWeights`), reopen the wizard pre-filled, and serialize a compact form into the share URL. Add a "Save my priorities" action and optionally map the lifestyle/family/budget answers onto Quality Index weights so the live map score reflects stated priorities continuously, not just in the one-shot results list. |
| **Why** | Choosing a home is a multi-day process, but the wizard resets to defaults every session and its output is throwaway. Filter presets and quality personas already persist and cloud-sync; the wizard — the most beginner-friendly entry point — is the odd one out. Durable, shareable priorities complete the "every analysis reproducible by URL" goal. |
| **Touches** | `src/components/NeighborhoodWizard.tsx`, `src/hooks/useWizardProfile.ts` (new), `src/hooks/useUrlState.ts`, `src/utils/api.ts`, `src/App.tsx`, `src/components/CustomQualityPanel.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Per-metric weight sliders for the similarity engine

| | |
|---|---|
| **What** | Extend the shipped on/off similarity-metric picker so each active metric carries a 0–3 weight, applied inside `findSimilarNeighborhoods` (multiply each normalized squared difference by the metric's weight before summing, normalize by total weight). Persist the weight map in localStorage and in **new** URL params (similarity selection is not currently URL-encoded), with compact weight steppers next to each chip. |
| **Why** | Users can pick *which* metrics define "similar" but not *how much* each matters; for a relocator, transit and price may dominate while crime is secondary. Weights make the existing engine far more expressive at zero new-data cost. |
| **Touches** | `src/utils/similarity.ts`, `src/hooks/useSimilarityMetrics.ts`, `src/components/NeighborhoodPanel.tsx`, `src/hooks/useUrlState.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-6 National-scope toggle for the correlation explorer and discovery wizard

| | |
|---|---|
| **What** | Give the correlation explorer and the wizard the same region-vs-national scope toggle the similarity engine already has: a switch that lazy-loads the all-Finland dataset (`loadAllData`, already used by `RegionRankingTable` and national similarity) and recomputes the scatter/r/best-fit (or wizard scoring) over every loaded area. Reuse the existing `ComparisonScopeToggle` component. *Caveat:* the national dataset (`region_properties.json`) is geometry-stripped, so national results must use the navigate-to-profile path (as national similarity already does) rather than fly-to. |
| **Why** | Coverage is whole-Finland and the dataset is already loadable, but two of the most analytical tools are silently confined to one region's ~200 areas. Removes a confusing capability asymmetry at low cost. |
| **Touches** | `src/components/CorrelationExplorer.tsx`, `src/components/NeighborhoodWizard.tsx`, `src/components/ComparisonScopeToggle.tsx`, `src/utils/dataLoader.ts`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-7 Percentile / relative-threshold mode for range filters

| | |
|---|---|
| **What** | A per-criterion toggle in `FilterPanel` between "absolute value" (current) and "percentile" mode. In percentile mode the slider expresses a 0–100 rank ("top 20% nationally", "bottom 30% within region"), and `computeMatchingPnos` resolves each percentile bound to a concrete value at filter time using `percentileRanks.ts` over the active scope (the `comparisonScope` plumbing already exists). Show the resolved real value beneath the slider. |
| **Why** | Absolute cutoffs are meaningless across 60+ metrics with wildly different units — users don't know a "good" `crime_index` number. Percentile filtering lets people express intent ("the greenest 25%") directly, reusing the percentile machinery already built for SEO superlatives. |
| **Touches** | `src/utils/filterUtils.ts`, `src/components/FilterPanel.tsx`, `src/utils/percentileRanks.ts`, `src/hooks/useUrlState.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-8 Broaden verifiable percentile superlatives beyond quality/income/transit

| | |
|---|---|
| **What** | Extend `PERCENTILE_METRICS` (and the `NeighbourhoodPercentiles` interface + `computeNeighbourhoodPercentiles`) to include high-coverage, clear-direction metrics: `crime_index` (100%), `air_quality_index` (100%), `tree_canopy_pct` (100%), `higher_education_rate` (97%), `employment_rate` (97%). Wire the new percentiles into prerendered profile copy and JSON-LD `additionalProperty` the same way the existing three are. Reduces reliance on `transit_reachability_score` (5.5% coverage) dominating one of three superlatives. *Note:* the superlative/FAQ copy lives inline in `prerender.mjs` and `JsonLd.tsx`, not the locale JSON; the panel distribution section already shows a direction-aware percentile for the active layer, so a dedicated panel block is optional. |
| **Why** | Percentile superlatives ("top 6% for clean air", "lowest-crime decile in its region") are the most clickable SEO/LLM hooks and the most reassuring panel insight, but only 3 metrics get them today and one covers 5.5% of the country. All proposed metrics already have full national distributions. |
| **Touches** | `src/utils/percentileRanks.ts`, `src/__tests__/percentileRanks.test.ts`, `scripts/prerender.mjs`, `src/components/profile/JsonLd.tsx`, `src/components/NeighborhoodPanel.tsx` (optional) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-9 Serialize drawn-area / select-areas polygons into the share URL

| | |
|---|---|
| **What** | A compact `draw` URL param encoding the drawn polygon or the select-areas pno set: for select-mode, a dot-joined pno list (like the shortlist `sl` param); for free-hand polygons, a quantized vertex list (lng~lat at 5 dp, capped ~60 vertices, Finland-bbox-clamped on parse, like the `v` viewport codec). Restore on mount so `AreaSummaryPanel` reopens for the shared area. Round-trip tests. |
| **Why** | Custom catchment analysis (draw a polygon / tap a set of areas, read the population-weighted summary) is the only major analytical state that cannot be shared or bookmarked. |
| **Touches** | `src/hooks/useUrlState.ts`, `src/App.tsx`, `src/__tests__/urlState.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | IN-3 (URL version guard should land first/with it) |
| **Tag** | Claude Code |

### CF-10 Machine-readable GeoJSON / JSON data export (area, comparison set, shortlist)

| | |
|---|---|
| **What** | `exportGeoJson(features)` / `exportJson` helpers in `export.ts` emitting a downloadable FeatureCollection (geometry + raw, unformatted metric values) for the selected neighborhood, the pinned comparison set, and the shortlist, plus a flat JSON variant. Wire "Download data (GeoJSON)" into the panel export row, the comparison export menu, and the shortlist tray. Use raw numeric properties for QGIS/pandas use. Blob download, no new deps. *Wiring note:* `ShortlistTray` holds only `{pno,name}`, so shortlist GeoJSON needs geometry threaded from `App.tsx`'s `pnoFeatureMap`. |
| **Why** | As an open-civic-data map sourced from Tilastokeskus/HSL/HRI/OSM, the natural power-user ask is raw data for reuse, but export is limited to human-formatted CSV strings and print-PDF. GeoJSON export turns the app into a data on-ramp and strengthens open-data credibility at near-zero bundle cost. |
| **Touches** | `src/utils/export.ts`, `src/components/NeighborhoodPanel.tsx`, `src/components/ComparisonPanel.tsx`, `src/components/ShortlistTray.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-11 Dedicated shareable shortlist link + shortlist export card

| | |
|---|---|
| **What** | A "Share shortlist" affordance in `ShortlistTray` building a minimal URL carrying **only** the shortlist (`sl` + `city`) so the recipient gets the candidate set without the author's unrelated layer/filter/weight state, via clipboard with Web Share fallback. Pair it with a branded shortlist summary image card (reuse the lazy `html-to-image` + `shareOrDownload` path in `scoreCard.ts`) showing each area's name + quality badge + 2–3 key metrics with the deep link baked in. Add shortlist CSV/PDF export. |
| **Why** | The shortlist round-trips via `sl`, but the only way to share it is to copy the whole app URL, which leaks the author's analysis state and is long. A clean scoped link plus a shareable card matches the multi-candidate housing-search workflow and creates traceable inbound traffic, reusing proven export machinery. |
| **Touches** | `src/components/ShortlistTray.tsx`, `src/utils/scoreCard.ts`, `src/utils/export.ts`, `src/hooks/useUrlState.ts`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | CF-10, PO-13 (reuse one card-templating helper) |
| **Tag** | Claude Code |

### CF-12 Spatial-neighbor (adjacency) analysis — "the cheaper area next door"

| | |
|---|---|
| **What** | The missing *geographic* lens. Precompute a postal-code adjacency graph at build time in `build_region_data.mjs` (shared TopoJSON arcs already encode neighbors — near-free), emit it as a small JSON, and surface "neighboring areas" chips in `NeighborhoodPanel` plus an optional ring/contiguity highlight on the map ("show me adjacent areas like this"). Falls back to a lazy `@turf/booleanIntersects` shared-border test if needed. |
| **Why** | The audit's one geographic blind spot: every analysis tool today is attribute-only. A relocator who likes a too-expensive area wants the cheaper area *next door*, not a statistically-similar area 300 km away. No new data source, respects granularity, near-zero bundle cost. |
| **Touches** | `scripts/build_region_data.mjs`, `src/utils/similarity.ts`, `src/components/NeighborhoodPanel.tsx`, `src/components/Map.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-13 GDPR account deletion & personal-data export endpoints

| | |
|---|---|
| **What** | Authenticated `DELETE /auth/account` (deletes the `users` row, cascading to favorites/shortlist/notes/preferences via the existing `ON DELETE CASCADE` FKs, and clears the cookie) and `GET /auth/export` (returns the user's full stored record as JSON for download). Surface both in the account UI (`UserMenu`): a "Download my data" link and a confirm-gated "Delete account" action with FI/EN/SV strings. Add the api-client methods. *Note:* `server/api` currently has no test harness — pair this with IN-6, which bootstraps one. |
| **Why** | The service stores email + PII and per-user data but offers no erasure or access path — a GDPR right-to-erasure / right-of-access gap and a real trust blocker for asking users to create accounts. The cascade infra makes erasure a single row delete. |
| **Touches** | `server/api/src/auth.ts`, `src/utils/api.ts`, `src/hooks/useAuth.ts`, `src/components/UserMenu.tsx`, `server/README.md`, `server/api/package.json`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | IN-6 |
| **Tag** | Claude Code |

### CF-14 Affordability- and commute-aware end-to-end scoring

| | |
|---|---|
| **What** | Close the loop on CF-1 + CF-3: fold their outputs as optional hard filters / soft weights into the discovery wizard result and the Quality-Index match-%, so "best match" actually respects "within my budget" and "within my commute" — the two most decision-determining constraints — instead of leaving affordability and commute as dead-end side panels. Consumes CF-1's affordability math and CF-3's reachable set; no new data. |
| **Why** | The audit flags that match/quality scores are not affordability- or commute-aware end to end. A high-leverage integration that prevents the two flagship lenses from shipping as isolated panels. |
| **Touches** | `src/components/NeighborhoodWizard.tsx`, `src/utils/filterUtils.ts`, `src/utils/similarity.ts`, `src/utils/qualityIndex.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | CF-1, CF-3 |
| **Tag** | Claude Code |

### CF-15 Feasible national 1 km / metro 250 m demographic grid (population & age) — ⚠ previously deferred

| | |
|---|---|
| **What** | Implement `scripts/fetch_grid_data.py` (today a documentation-only stub) against StatFin's published grid. A *true* national 250 m grid is impractical for a static-file app (~300k cells / ~60 MB, and StatFin's 250 m hila is geometry-only), so use the realistic real-data options: **(a)** national 1 km population/age grid from `geo.stat.fi` `vaestoruutu vaki2023_1km` (~97.6k populated cells; fields `vaesto/miehet/naiset/ika_0_14/ika_15_64/ika_65_`), reprojected EPSG:3067→4326; **or (b)** metro-region-scoped 250 m population/age. **Income is not published at grid level — exclude it.** Wire through `build_grid_data.mjs` so the grid manifest auto-discovers it; degrade to choropleth/hatch where cells are suppressed. **Measure payload before committing.** |
| **Why** | Postal codes can mix a dense apartment core with forest; a finer demographic grid satisfies the granularity mandate beyond today's two grids. |
| **Touches** | `scripts/fetch_grid_data.py`, `scripts/build_grid_data.mjs`, `scripts/validate_data.py`, `src/hooks/useGridData.ts`, `src/data/grid_manifest.json`, `src/utils/colorScales.ts`, `src/utils/metrics.ts` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |
| **⚠ Owner decision** | This revives the previously-deferred 250 m-grid item, re-scoped to the *feasible* 1 km / metro-250 m population/age variant (the deferral was over national-250 m payload + income-at-grid availability — both addressed here). Confirm before building. |

### CF-16 OSM building-footprint morphology layer (coverage, building density, typology) — ⚠ previously deferred

| | |
|---|---|
| **What** | `scripts/fetch_building_footprints.py` extracting OSM `building=*` footprints from a Finland `.pbf` extract (Geofabrik) rather than thousands of Overpass calls (the heaviest remaining compute and the original deferral blocker). Aggregate per postal code: footprint coverage ratio (Σ footprint area / `pinta_ala`), building-count density, and a coarse low-rise-vs-apartment typology share by footprint-size buckets. Write columns into the GeoJSON, add LayerId + color scale + metric metadata + registry entry (`osm`, `is_proxy: false`) + FI/EN/SV labels, rebuild TopoJSON. Partial OSM coverage degrades to the no-data hatch. |
| **Why** | Built-form morphology (leafy detached suburb vs dense apartment grid) is a top lived-experience signal currently only weakly proxied by `detached_house_share`. Output is small (per-postal aggregates); a `.pbf` extract removes the deferral blocker; data is free and verifiable. |
| **Touches** | `scripts/fetch_building_footprints.py`, `scripts/prepare_data.py`, `src/data/data_sources.json`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `public/data/metro_neighborhoods.geojson`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (needs new binary OSM tooling — osmium/pyrosm/GDAL — + a large Geofabrik extract download; no credentials/legal sign-off) |
| **⚠ Owner decision** | Revives the previously-deferred OSM-footprint item with the `.pbf` approach that resolves the compute blocker. Confirm before building. |

### CF-17 Elevation / terrain context from MML open DEM — ★ new data source

| | |
|---|---|
| **What** | Add a real elevation signal from Maanmittauslaitos (NLS) open elevation model (`korkeusmalli`, 2 m/10 m, CC BY 4.0). Start with the **postal-aggregate choropleth variant** (cheap, fits the postal-min mandate): a per-postal-code mean elevation and "% of area below ~5 m" metric propagated into the GeoJSON. Optionally, later, a lazy MapLibre hillshade/terrain layer behind a toggle (heavier — must never touch first paint or the JS budget). |
| **Why** | Elevation is a real lived-experience and climate-risk signal (low-lying coastal/riverine flood exposure; hilly vs flat for cyclists/elderly) — a genuinely new dimension. Finland publishes it free at the finest granularity. |
| **Touches** | `scripts/fetch_elevation.py` (new), `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `public/data/metro_neighborhoods.geojson`, `src/components/Map.tsx` (terrain variant only) |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup (NLS open-data API key is free but must be provisioned; terrain-tile hosting/attribution is an owner decision) |

---

## 3 — Polish

### PO-1 True diagonal-hatch fill for no-data neighborhoods

| | |
|---|---|
| **What** | Replace the dashed-border `NO_DATA_LAYER` with a real fill-pattern hatch: generate a small diagonal-stripe image at runtime (canvas) or ship a tiny PNG, register via `map.addImage` (re-add on style reload), and add a `fill-pattern` layer filtered to features where the active layer's property is null/missing (excluding `_isMetroArea`). `SplitMapView` has **no** no-data layer at all today, so for it this is "add from scratch" across both panes. |
| **Why** | Users cannot reliably distinguish "no data here" from "low value here" — both render flat gray, separated only by a subtle dashed outline that vanishes at low zoom. A diagonal hatch is the standard cartographic convention for missing data and directly improves data honesty. |
| **Touches** | `src/components/Map.tsx`, `src/components/SplitMapView.tsx` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Surface per-layer `coverage_pct` in sources page, legend & quality UI

| | |
|---|---|
| **What** | Surface the already-computed `coverage_pct` (read it from the bundled `build_metadata.json` — do **not** fold it circularly back into `data_sources.json`; it is computed *from* the registry in `build_region_data.mjs`): a Coverage column on `DataSourcesPage`, a subtle "covers X% of postal codes" caption in the `Legend` for partial-coverage layers, and a low-coverage banner on the active layer (transit ~11%, school quality ~10%, property price ~30%, rental ~16%). Tie sparse gray polygons to the PO-1 hatch. |
| **Why** | The map presents 11%-coverage layers with the same visual confidence as 100%-coverage ones, so a relocator outside Helsinki sees a mostly-gray map reading as "broken" rather than "limited data". Coverage transparency is a direct trust win using existing measured data. |
| **Touches** | `src/data/build_metadata.json`, `scripts/build_region_data.mjs`, `src/utils/metrics.ts`, `src/pages/DataSourcesPage.tsx`, `src/components/Legend.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | PO-1 |
| **Tag** | Claude Code |

### PO-3 Per-layer data-freshness & staleness signalling

| | |
|---|---|
| **What** | Wire the already-defined-but-unused `latestVintageYear()` / `STALE_VINTAGE_YEARS` helpers into the UI: **(1)** on `DataSourcesPage`, an amber "N years ago / updated YYYY" indicator next to each vintage for layers older than threshold, and make the table sortable by recency; **(2)** add "N years ago" context to the panel `StatRow` source popover. Presentation-only over `data_sources.json`. *Excludes the Legend caption — it was built and then deliberately reverted to keep the on-map legend clean; do not re-add.* |
| **Why** | Vintages range 2012–2026 but a single global "last updated" timestamp implies uniform freshness. An explicit "this layer is N years old" amber signal stops users over-trusting stale layers; the helpers and data already exist, so this is pure wiring. |
| **Touches** | `src/pages/DataSourcesPage.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Populate & render registry caveat notes for proxy/derived/partial metrics

| | |
|---|---|
| **What** | Fill the existing-but-empty `note` field in `data_sources.json` for every `is_proxy`/caveated metric (transit_reachability = regression estimate; walkability = OSM composite; light_pollution = VIIRS radiance; noise mixes 2022 Helsinki + 2012 PKS surveys; property/rental cover only the largest municipalities) **and add the rendering JSX** to the panel info popover and the sources table — the `note` is plumbed through types/`getMetricSource` but is currently rendered nowhere. Use **key-based i18n** (not inline prose) so only the main-bundle `fi.json` counts toward the budget (`en`/`sv` are lazy `?url`). |
| **Why** | The proxy badge says "estimate" but never says why or how derived. A one-sentence caveat per proxy/partial metric turns a vague badge into a defensible, auditable disclosure. (Notes were previously trimmed from the registry for bundle budget *because they weren't surfaced* — surfacing them via keys justifies their return.) |
| **Touches** | `src/data/data_sources.json`, `src/components/NeighborhoodPanel.tsx`, `src/pages/DataSourcesPage.tsx`, `src/utils/metrics.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Flag `crime_index` and `avg_construction_year` as `is_proxy`

| | |
|---|---|
| **What** | Set `is_proxy: true` for `crime_index` and `avg_construction_year` in `data_sources.json` — both are municipality-level figures distributed/refined to postal codes via Paavo proxies (`fetch_crime_index.py` `distribute_to_postal_codes()`; `fetch_building_age.py` `refine_to_postal_codes()`), exactly like walkability/transit/light_pollution which are already flagged. Optionally extend `validate_data.py` to warn when a metric's declared granularity is finer than its source's real granularity. |
| **Why** | The registry powers the proxy badge, sources page, and freshness UI. Presenting a municipality-distributed estimate as direct postal-level measurement overstates accuracy. A one-line-per-metric honesty fix grounded in the fetch logic; adds no fabricated data. |
| **Touches** | `src/data/data_sources.json`, `scripts/validate_data.py`, `scripts/fetch_crime_index.py`, `scripts/fetch_building_age.py` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Flag the frozen/retired rental source — "source discontinued"

| | |
|---|---|
| **What** | Give `rental_price_sqm` and `price_to_rent_ratio` a stronger caveat than generic staleness: the postal-code rent table (StatFin `asvu 13eb`) has been **retired** — current tables only publish at region/maakunta level, so postal-code rents fall back to the last published snapshot and can never refresh via the API (documented at `prepare_data.py:162`). Mark them "source discontinued — last published YYYY" in the registry (the current row's `vintage: 2024, is_proxy: false` understates this), and ensure the CF-1 affordability calculator shows it inline. |
| **Why** | A genuinely frozen source is a fundamentally different caveat from "old data," and CF-1's flagship affordability math is built directly on these rents — surfacing them without saying so would overstate confidence on the product's marquee new feature. |
| **Touches** | `src/data/data_sources.json`, `src/utils/metrics.ts`, `src/components/Legend.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-7 Honest granularity label for `transit_reachability` (resolve the phantom "250 m grid")

| | |
|---|---|
| **What** | `data_sources.json` declares `transit_reachability_score` as `granularity: "250m grid"`, but no transit grid file exists (`grid_manifest.json` has only air_quality + light_pollution, and the only postal data is a regression proxy at ~5.5% coverage). Correct the granularity to a truthful value (`postal`/proxy — check `VALID_GRANULARITY` in `dataSourceRegistry.test.ts`) and fix the misleading docstrings in `fetch_transit_reachability.py` / `build_metadata.json`. **Do not** emit a grid from the proxy — that would fabricate 250 m precision and violate the data-integrity rule. (A genuine grid would require manually downloading the multi-GB Helsinki Region Travel-Time Matrix and would cover only Helsinki — out of scope here.) |
| **Why** | The registry is the runtime single source of truth shown to users; a "250 m grid" label with no grid behind it is a visible accuracy overstatement. The honest fix is a one-line metadata correction. |
| **Touches** | `src/data/data_sources.json`, `scripts/fetch_transit_reachability.py`, `src/data/build_metadata.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-8 Dialog semantics + focus management for the neighborhood panel / bottom sheet

| | |
|---|---|
| **What** | Add `role` + `aria-label` to both the desktop side-panel and mobile bottom-sheet containers (currently bare `div`s), move focus to the panel heading/close button on open with focus return on close, and announce the full-height mobile sheet. Keep the desktop side panel non-trapping (it coexists with the map). Extend `e2e/a11y.spec.ts` to assert the panel exposes an accessible name. *(The global Escape-to-close already works on mobile via an App-level listener — the real gap is roles/aria + focus, not Escape.)* |
| **Why** | The panel is the app's primary detail surface yet its containers have no role/aria-label and no focus management — a keyboard/screen-reader gap on the most-used view. Low effort, improves the existing axe-gated a11y posture. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `e2e/a11y.spec.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-9 Localize `og:locale` and `og:image:alt` on prerendered profile & hub pages

| | |
|---|---|
| **What** | In `prerender.mjs` `generatePage()` rewrite `og:locale` to the page language (`fi_FI`/`en_US`/`sv_FI`), rewrite the two `og:locale:alternate` tags, and rewrite `og:image:alt` to a localized per-area string; do the same in `prerender-hubs.mjs` `htmlPage()` and the data-sources page. *Add a new underscore-format locale map* — the existing `LOCALE_TAG` is BCP-47 hyphen format for number formatting, not the `og:locale` underscore format. `index.html` already has correct tags and needs no edit. |
| **Why** | EN and SV profile/hub cards currently declare `og:locale=fi_FI` and a Finnish image alt, so localized social unfurls and locale-ranking signals are wrong on ~18,000 non-Finnish pages. Cheap, real-data-safe correctness fix on the highest-volume SEO surface. |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-10 Enrich hub & data-sources structured data (BreadcrumbList + richer Dataset)

| | |
|---|---|
| **What** | On the prerendered data-sources page add `BreadcrumbList` + a `WebPage`/`CollectionPage` JSON-LD node matching the hubs' depth. In `prerender-hubs.mjs` `buildHubDataset`, add `spatialCoverage` (region center is already computed), `keywords`, and `temporalCoverage` derived from registry vintages, so each hub Dataset is fully described for answer engines. |
| **Why** | Hubs and the sources page are the link-hub backbone answer engines crawl to reach the 27k leaf profiles, yet they carry thinner structured data than the profiles. Richer markup built only from data already in the repo improves discoverability at zero data risk. |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-11 Make Quality Index coverage honest about thin default-weighted factors

| | |
|---|---|
| **What** | The transit factor (default weight 3) reads `transit_stop_density` (~11% national coverage); outside Helsinki the index silently imputes the neutral midpoint. Add a per-factor national coverage figure (from `build_metadata.json`) to `computeQualityCoverage` / the panel breakdown so the coverage chip distinguishes "no data here AND little data anywhere" from a genuine local gap, and update the stale "~97–100% coverage except transit" claim in `docs/QUALITY_INDEX.md` (and the duplicated code comment) to match measured coverage. Update the existing `qualityCoverage.test.ts`. |
| **Why** | The methodology doc asserts default factors are ~97–100% covered, but `transit_stop_density` is 10.9% and `transit_reachability` 5.5% — so the flagship index quietly leans on neutral imputation for a chunk of the country while docs imply full coverage. Aligning the auditability surface and docs with measured reality defends the headline metric. |
| **Touches** | `src/utils/qualityIndex.ts`, `src/components/NeighborhoodPanel.tsx`, `docs/QUALITY_INDEX.md`, `src/__tests__/qualityCoverage.test.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-12 Stable per-area sitemap `lastmod` driven by the data-refresh date

| | |
|---|---|
| **What** | Replace the uniform `new Date()` `lastmod` in `generate-sitemap.mjs` (currently stamps today on every URL each deploy) with a stable `lastmod` sourced from `build_metadata.json`'s `generated` field for profile/hub/directory URLs (home stays on build date). Optionally derive a per-page `lastmod` only when a content hash of that area's properties changes. |
| **Why** | Emitting `lastmod=today` for all ~27k+ URLs on every build trains crawlers to ignore `lastmod` and dilutes recrawl priority for genuinely changed pages. Aligning to the real data vintage is honest and improves crawl efficiency. |
| **Touches** | `scripts/generate-sitemap.mjs`, `public/data/build_metadata.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-13 Per-area dynamic social card (templated OG image per profile)

| | |
|---|---|
| **What** | Generate one lightweight card per area at build time — SVG (or satori/sharp, kept strictly in the Node prerender toolchain, never the client bundle) — templated from real GeoJSON values (area name, quality index, a percentile badge, 2–3 key stats), emitted as a hashed static asset, and referenced as `og:image`/`twitter:image` per profile (and reused by the shortlist card in CF-11). |
| **Why** | Today every one of the ~27k profiles hardcodes the same `og-image.png`, so every WhatsApp/Slack/X share of a specific neighborhood looks identical and generic — killing click-through on the project's largest distribution surface. Build-time only, so zero runtime bundle impact. |
| **Touches** | `scripts/prerender.mjs`, `scripts/generate-sitemap.mjs`, `src/utils/percentileRanks.ts`, `public/` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-14 Privacy & data-handling notice page (FI/EN/SV, prerendered)

| | |
|---|---|
| **What** | A prerendered multilingual privacy page (`/tietosuoja`, `/en/privacy`, `/sv/integritet`) + a `PrivacyPage.tsx` SPA route, mirroring the shipped data-sources-page pattern (generate in `prerender.mjs`, sitemap with hreflang, route in `main.tsx`, noscript fallback). Content: what the optional account collects (email, hashed password, synced favorites/notes/preferences), legal basis, retention, third parties (Cloudflare Turnstile, Sentry, self-hosted Umami), that the map works fully without an account, and a contact for data requests. Link from `AuthModal` and the settings/footer. Transparency notice only. |
| **Why** | The backend collects emails and personal data and the site runs Turnstile/Sentry/Umami, yet there is no privacy notice anywhere — a basic compliance gap for a Finnish service handling personal data and a trust blocker at the signup moment. |
| **Touches** | `scripts/prerender.mjs`, `scripts/generate-sitemap.mjs`, `src/pages/PrivacyPage.tsx`, `src/main.tsx`, `src/components/AuthModal.tsx`, `src/components/SettingsDropdown.tsx`, `src/App.tsx` (footer link), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | CF-13 (so the copy can truthfully describe self-service export/deletion) |
| **Tag** | Manual Setup (owner must approve legal/retention wording) |

### PO-15 Public "data changes / refresh log" surface

| | |
|---|---|
| **What** | Render the machine-readable provenance/`build_metadata` output (per-layer vintage, coverage %, refresh date) as a human, indexable "Data updated" note / changelog on the data-sources page — what changed, when, and which vintage. |
| **Why** | Nothing today tells a returning user or skeptical journalist *when* the data last meaningfully changed and what moved. A return-visit hook and an auditable trail, reading only the provenance manifest the refresh items already produce. |
| **Touches** | `src/pages/DataSourcesPage.tsx`, `src/data/build_metadata.json`, `scripts/prerender.mjs`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | IN-4 |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Bring grids, no-data hatch, hover & coverage cues to SplitMapView

| | |
|---|---|
| **What** | Extend `SplitMapView` so each pane mirrors the main map's data fidelity: render the lazy grid layer with the same zoom fade, add the no-data hatch, add per-pane hover tooltip + click-to-open-panel, and a compact legend + coverage-scope badge per side. Requires **exporting/extracting** the currently module-private `buildGridFillOpacity` / fade constants from `Map.tsx` (only `buildFillColorExpression` and `getGridInfo` are exported today), and two `useGridData` calls (one per pane). |
| **Why** | Split/compare mode is a headline feature for comparing two metrics but silently downgrades grid layers to coarse postal fills and offers no value inspection — users comparing `air_quality` or `light_pollution` see worse data than the single map and can't read any cell's value. |
| **Touches** | `src/components/SplitMapView.tsx`, `src/App.tsx`, `src/hooks/useGridData.ts`, `src/components/Map.tsx`, `src/components/Legend.tsx` |
| **Complexity** | Large |
| **Dependencies** | PO-1 |
| **Tag** | Claude Code |

### IN-2 Precise region-keyed grid clipping

| | |
|---|---|
| **What** | Replace the first-vertex bbox test in the `App.tsx` `gridData` memo (`ring[0]` in/out of the data bbox) with a correct cell-centroid (or full-ring) containment check — `@turf/boolean-point-in-polygon` is already a dependency and can be lazy-loaded. Optionally clip to the region polygon rather than its bbox. *(Drop the "recomputes on every quality recompute" rationale — the memo is keyed on `[rawGridData, data]` and `data` identity is stable across quality recomputes; the genuine fix is containment precision.)* |
| **Why** | The current clip keeps/drops boundary cells based on a single vertex, so cells along region edges leak or get clipped incorrectly on the 50k-cell light_pollution grid. |
| **Touches** | `src/App.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Share-URL schema version tag + migration / clamp guard

| | |
|---|---|
| **What** | Add a tiny version key (e.g. `sv=2`) to the share URL and a parse-time migration/clamp path in `useUrlState`, so future schema changes can migrate (or safely ignore) older params instead of silently restoring a wrong-but-plausible state. Land this **before/with** CF-9, because every link minted in between is unversioned. |
| **Why** | The proposed set is about to make the URL the product's most-shared, most-viral artifact (CF-9 polygons; filters/weights/year/isochrone/viewport already encoded). Without a version guard, every future param change silently breaks links already pasted into forums, emails, and embeds. Cheap insurance. |
| **Touches** | `src/hooks/useUrlState.ts`, `src/__tests__/urlState.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-4 Make the quarterly data-refresh rebuild & commit the app-served TopoJSON

| | |
|---|---|
| **What** | Extend `data-refresh.yml` so after `prepare_data.py` + `validate_data.py` it also: (a) runs `fetch_price_crime_history.py --apply` to refresh history into the GeoJSON; (b) re-runs `validate_data.py`; (c) runs `npm run build:data` (`build_region_data` + `build_national_ranges` + `build_grid_data`), committing the regenerated `src/data/regions/*.topojson`, `region_properties.json`, `national_ranges.json`, `region_coverage.json`, `region_payload_manifest.json`, and `build_metadata.json` into the same refresh PR. Pin Node, `npm ci`. Keep NetCDF/NASA-token grid fetchers as a documented manual step. |
| **Why** | The app loads TopoJSON, not the GeoJSON; today the refresh ships a new GeoJSON but leaves the served TopoJSON, all-cities aggregation input, national ranges, and price/crime history stale until a human runs `build:data`. Automating it closes a silent staleness gap and makes the refresh self-consistent. |
| **Touches** | `.github/workflows/data-refresh.yml`, `scripts/fetch_price_crime_history.py`, `scripts/build_region_data.mjs`, `scripts/build_national_ranges.mjs`, `scripts/build_grid_data.mjs`, `scripts/validate_data.py` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-5 Validate the rebuilt region TopoJSON inside the data-refresh PR

| | |
|---|---|
| **What** | Extend the refresh's validation to also assert the regenerated per-region TopoJSON files exist for every configured region, parse as valid TopoJSON, and have feature counts matching `region_payload_manifest.json` — failing the refresh if a region silently drops to zero features or a file is missing/empty. (Depends on IN-4 actually rebuilding those files in the refresh job; alternatively guard the committed files in `ci.yml`.) |
| **Why** | The refresh's only structural guard is on the source GeoJSON; the artifacts the app serves are unchecked, so a partial `geo2topo` failure or an empty region would merge unnoticed and break the map for that city. |
| **Touches** | `.github/workflows/data-refresh.yml`, `scripts/validate_data.py`, `package.json` |
| **Complexity** | Medium |
| **Dependencies** | IN-4 |
| **Tag** | Claude Code |

### IN-6 CI gate that type-checks, builds & tests the server API

| | |
|---|---|
| **What** | Bootstrap a test runner under `server/api` (node:test or Vitest; the pure validators need no DB) and a CI step in both `ci.yml` and `auto-merge.yml` running `npm ci && npm run build && npm test` in `server/api`. High-value first tests: `USERNAME_RE`/password rules, `FAVORITE_RE`, `validateFilterPresets`/`validateQualityWeights`, `rateLimit` bucket logic, `verifyTurnstile` branches. Requires exporting the currently module-private validators from `auth.ts` and excluding `*.test.ts` from the production `tsc` build via `tsconfig`. |
| **Why** | The backend is shipped untested and ungated (CI only runs `npm audit` on it); a TS error or auth/validation regression reaches production and is caught only at deploy time on the live droplet. Gating it protects every logged-in user's data and unblocks growing the API (GDPR, rate limiter, health). |
| **Touches** | `server/api/package.json`, `server/api/tsconfig.json`, `server/api/src/auth.ts`, `server/api/src/auth.test.ts`, `server/api/src/rateLimit.test.ts`, `server/api/src/turnstile.test.ts`, `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-7 Persist the API rate limiter to Postgres

| | |
|---|---|
| **What** | Replace the in-memory `Map` in `rateLimit.ts` with a Postgres-backed counter (a `rate_limits` table keyed by `prefix+ip` with a window-reset timestamp, upserted per request and pruned periodically), falling back to in-memory only if the DB is unreachable. Keep the factory signature so signup(3/day)/login(10/15min) are unchanged (the middleware becomes async). |
| **Why** | The current limiter is per-process in-memory: every restart and any future second API replica resets all buckets, letting an attacker bypass the abuse limits that protect signup and login. Postgres is already a dependency. |
| **Touches** | `server/api/src/rateLimit.ts`, `server/api/src/db.ts`, `server/api/src/auth.ts` |
| **Complexity** | Medium |
| **Dependencies** | IN-6 |
| **Tag** | Claude Code |

### IN-8 Server self-monitoring: DB health in `/health` + assert it in the cron

| | |
|---|---|
| **What** | Extend `GET /health` to run a lightweight `SELECT 1` and report `db: ok|down` plus the API release (`SENTRY_RELEASE` already exists), and update `health-check.yml` to parse the JSON and alert specifically when the DB is unreachable (it currently only checks HTTP 200, so the API can be up while its database is dead). |
| **Why** | `/health` returns `ok` regardless of DB state, so a logged-in user's saves could silently fail (Postgres down) while monitoring shows green. A DB probe + cron assertion catches a dead database within a day. |
| **Touches** | `server/api/src/index.ts`, `server/api/src/db.ts`, `.github/workflows/health-check.yml` |
| **Complexity** | Small |
| **Dependencies** | IN-6 |
| **Tag** | Claude Code |

### IN-9 Alert on failed deploys (Pages + server)

| | |
|---|---|
| **What** | Add an `if: failure()` step to `deploy.yml` and `deploy-server.yml` that opens/updates a GitHub issue (reusing the `github-script` pattern in `health-check.yml`) when the build, Pages deploy, or SSH server deploy fails. Add `issues: write` to `deploy.yml`'s permissions and a permissions block to `deploy-server.yml`. *(Drop the original "double-deploy guard" — `deploy.yml` already has `concurrency: group: pages`, and the `workflow_run` trigger doesn't fire on auto-merge's `GITHUB_TOKEN` push, so the race doesn't occur.)* |
| **Why** | A failed deploy is currently only noticed ~next morning by the health-check (or not at all for a partial server deploy). Immediate alerting makes shipping reliable. |
| **Touches** | `.github/workflows/deploy.yml`, `.github/workflows/deploy-server.yml`, `.github/workflows/health-check.yml` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-10 Keep `audit_data_coverage.py`'s layer list in sync with the registry

| | |
|---|---|
| **What** | `audit_data_coverage.py` hardcodes `EXTERNAL_LAYERS`/`DERIVED_LAYERS` (~55 layers) independently of `data_sources.json`, and the lists have **already drifted** (5 registry metrics missing from the audit; a dead `green_space_pct` listed). Drive the audit's layer universe from the registry's stored metrics (or add a test asserting parity), so coverage reporting is complete-by-construction. (This is a manual reporting tool, not a CI gate — `validate_data.py` already derives from the registry — so the value is a complete report, not preventing two gates from diverging.) |
| **Why** | A hand-maintained layer list quietly stops covering new metrics — the exact drift the registry was created to prevent. Sourcing the audit from the single registry keeps it honest. |
| **Touches** | `scripts/audit_data_coverage.py`, `scripts/validate_data.py`, `src/data/data_sources.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-11 Bring embed + "open full view" state to parity with the share link

| | |
|---|---|
| **What** | Extend `EmbedState`/`stateParams` in `embed.ts` to also carry `ref`, filters, weights (`qp`/`qw`), isochrone (`iso`), shortlist (`sl`), and optionally viewport (`v`), reusing the exact keys/omit-default rules as `useUrlState.writeUrl`. Update `App.tsx` `handleCopyEmbed` and the embed watermark `buildFullViewUrl` to pass full state. **Factor the param-building into one shared serializer** imported by both `useUrlState` and `embed.ts` so they cannot drift. Add tests asserting embed params match share-URL params. |
| **Why** | An embed or "open full view" of a filtered, custom-weighted, reference-baselined view silently drops that analytical state today, so the most configured shares degrade to a generic view in the channel meant to showcase them. Parity makes embeds true showcases and prevents the two serializers diverging. |
| **Touches** | `src/utils/embed.ts`, `src/App.tsx`, `src/hooks/useUrlState.ts`, `src/__tests__/embed.test.ts` |
| **Complexity** | Small |
| **Dependencies** | IN-3 (share the versioned serializer) |
| **Tag** | Claude Code |

### IN-12 IndexNow ping on deploy

| | |
|---|---|
| **What** | Add an IndexNow key file under `public/` and a step in `deploy.yml`'s **deploy** job (after the site is live) that pings IndexNow (Bing/Yandex) with the sitemap location. No account needed — just a self-hosted key file. With stabilized `lastmod` (PO-12), a later iteration can submit only changed URLs. |
| **Why** | With ~27k URLs and a quarterly refresh, updated profiles rely entirely on organic recrawl today. A zero-cost IndexNow ping accelerates indexing of refreshed data. |
| **Touches** | `.github/workflows/deploy.yml`, `public/indexnow-key.txt` |
| **Complexity** | Small |
| **Dependencies** | PO-12 |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Each batch is internally parallel-safe for concurrent Claude Code sessions **with the serialization caveats noted**, and depends only on prior batches. Per the auto-merge concurrency model, push branches in a batch so their file edits don't collide; where two items in a batch share a file, serialize them in the stated order and re-run the i18n key-parity test after each locale edit.

### Batch 1 — Honesty/registry fixes, shareable-state primitives & test harness

Self-contained correctness/honesty fixes plus the two primitives later work depends on: the no-data hatch (PO-1 → feeds PO-2/IN-1), the URL version guard (IN-3 → must precede CF-9/IN-11), and the server-API test harness (IN-6 → unblocks all backend items). The frozen-rent flag (PO-6) lands here because CF-1 depends on it.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| PO-1 | Polish | Medium | Claude Code |
| PO-5 | Polish | Small | Claude Code |
| PO-6 | Polish | Small | Claude Code |
| PO-7 | Polish | Small | Claude Code |
| QW-1 | Quick Win | Small | Claude Code |
| QW-4 | Quick Win | Small | Claude Code |
| IN-2 | Infrastructure | Small | Claude Code |
| IN-3 | Infrastructure | Small | Claude Code |
| IN-10 | Infrastructure | Small | Claude Code |
| PO-12 | Polish | Small | Claude Code |
| IN-6 | Infrastructure | Medium | Claude Code |

**Parallel-safety:** QW-1, PO-5, PO-6, PO-7 all edit `data_sources.json` — **serialize** them (disjoint metric rows; merge QW-1 → PO-5 → PO-6 → PO-7); QW-1 also edits `colorScales.ts`/`LayerSelector.tsx` which the others don't. PO-1 (`Map.tsx` + `SplitMapView.tsx`), QW-4 (`NeighborhoodPanel.tsx` + `formatting.ts`), IN-2 (`App.tsx`), IN-3 (`useUrlState.ts` + test), IN-10 (Python), PO-12 (sitemap), IN-6 (`server/api` + CI) are otherwise disjoint.

### Batch 2 — Coverage, freshness & SEO disclosure + refresh/ops automation

Trust surfaces that consume Batch-1 foundations (PO-2 needs the PO-1 hatch) plus the data-refresh automation and the backend-ops items gated on IN-6.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| PO-2 | Polish | Medium | Claude Code |
| PO-3 | Polish | Small | Claude Code |
| PO-4 | Polish | Small | Claude Code |
| PO-11 | Polish | Medium | Claude Code |
| PO-9 | Polish | Small | Claude Code |
| PO-10 | Polish | Small | Claude Code |
| IN-4 | Infrastructure | Medium | Claude Code |
| IN-5 | Infrastructure | Medium | Claude Code |
| IN-9 | Infrastructure | Small | Claude Code |
| IN-7 | Infrastructure | Medium | Claude Code |
| IN-8 | Infrastructure | Small | Claude Code |

**Parallel-safety:** PO-2, PO-3, PO-4, PO-11 share `NeighborhoodPanel.tsx`/`DataSourcesPage.tsx`/locales — **serialize** PO-2 → PO-3 → PO-4 → PO-11 (PO-2 first since it also edits `data_sources.json`/`build_region_data.mjs`). PO-9 and PO-10 both edit the prerender scripts — **serialize** PO-9 → PO-10. IN-4 → IN-5 sequential (IN-5 validates what IN-4 rebuilds). IN-7 and IN-8 share `server/api/src/db.ts` — **serialize** IN-7 → IN-8. IN-9 (deploy workflows) is disjoint.

### Batch 3 — Decision-layer features & analytical depth (the frontier)

The "translate stats into a personal decision" features plus analytical-tool upgrades. CF-1 is the base for downstream personalization; CF-9 needs IN-3; IN-1 needs PO-1.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-1 | Core Feature | Medium | Claude Code |
| CF-2 | Core Feature | Medium | Claude Code |
| CF-5 | Core Feature | Medium | Claude Code |
| QW-2 | Quick Win | Small | Claude Code |
| CF-6 | Core Feature | Medium | Claude Code |
| QW-3 | Quick Win | Small | Claude Code |
| CF-7 | Core Feature | Medium | Claude Code |
| CF-8 | Core Feature | Medium | Claude Code |
| CF-9 | Core Feature | Medium | Claude Code |
| CF-12 | Core Feature | Medium | Claude Code |
| IN-1 | Infrastructure | Large | Claude Code |

**Parallel-safety:** CF-1, CF-2, CF-5, QW-2, CF-12 all edit `NeighborhoodPanel.tsx` (distinct sections) and several also edit `useUrlState.ts` — keep these in one **serialized lane** (CF-1 → CF-2 → CF-5 → QW-2 → CF-12), re-running i18n parity each time. CF-6 and QW-3 both edit `CorrelationExplorer.tsx` — **serialize** QW-3 → CF-6. CF-7 (`FilterPanel`/`filterUtils`) and CF-9 (`useUrlState`/`App`) overlap with the panel lane only on `useUrlState.ts`/`App.tsx` — sequence their URL-codec edits after CF-1/CF-5's. IN-1 (`SplitMapView` + helper extraction from `Map.tsx`) is otherwise isolated.

### Batch 4 — Sharing/export reach, distribution & accessibility

Distribution/export surfaces, per-area social cards, the panel a11y pass, the commute filter, and GDPR/privacy. IN-11 needs IN-3's shared serializer; PO-14 needs CF-13; PO-15 needs IN-4.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-10 | Core Feature | Medium | Claude Code |
| CF-11 | Core Feature | Medium | Claude Code |
| QW-5 | Quick Win | Small | Claude Code |
| CF-4 | Core Feature | Medium | Claude Code |
| CF-3 | Core Feature | Large | Manual Setup |
| CF-13 | Core Feature | Medium | Claude Code |
| PO-8 | Polish | Small | Claude Code |
| PO-13 | Polish | Medium | Claude Code |
| PO-14 | Polish | Small | Manual Setup |
| PO-15 | Polish | Small | Claude Code |
| IN-11 | Infrastructure | Small | Claude Code |
| IN-12 | Infrastructure | Small | Claude Code |

**Parallel-safety:** CF-10 → CF-11 → QW-5 share `export.ts` — **serialize** (and PO-13 should land before CF-11 so both reuse one card-templating helper). CF-13 (GDPR endpoints) must precede PO-14 (privacy copy must describe real deletion/export). CF-3 (`isochrone`/`Map`/`App`) and CF-4 (`wizard`/`useUrlState`/`App`) share `App.tsx` — **serialize** their `App.tsx` edits. PO-8 (panel a11y) shares `NeighborhoodPanel.tsx` with CF-10 — land PO-8 after CF-10. IN-11 (embed parity), IN-12 (IndexNow), PO-13/PO-15 (prerender/sitemap) are otherwise disjoint.

### Batch 5 — Integration & deeper/new data layers (heaviest, most serialized)

The end-to-end scoring integration plus the heavy data layers — two of which the owner previously deferred and one of which adds a new source. These rebuild the GeoJSON/TopoJSON and **must be serialized against each other**.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-14 | Core Feature | Medium | Claude Code |
| CF-15 | Core Feature | Large | Claude Code · ⚠ deferred |
| CF-16 | Core Feature | Large | Manual Setup · ⚠ deferred |
| CF-17 | Core Feature | Large | Manual Setup · ★ new source |

**Parallel-safety:** CF-15 (demographic grid), CF-16 (OSM footprints), and CF-17 (elevation) all write `public/data/metro_neighborhoods.geojson` / grid artifacts and touch `prepare_data.py` + `colorScales.ts`/`metrics.ts` — per CLAUDE.md and the auto-merge concurrency note these **cannot** run as concurrent `claude/*` branches; each must rebuild + validate + `build:data` before the next merges, or one silently clobbers another's columns. CF-14 (`wizard`/`qualityIndex`/`similarity`) depends on CF-1 + CF-3 (Batches 3–4) and is disjoint from the data-pipeline trio, so it can run in parallel with one of them. **CF-15 and CF-16 require explicit owner go-ahead** (they revive deliberately deferred work); **CF-17 requires an owner decision** on the NLS API key + any terrain-tile hosting.

---

## Completed since the 2026-06-01 Roadmap

Nearly the entire prior roadmap shipped. Verified present in the codebase:

| Capability | Area |
|---|---|
| Comprehensive shareable URL state (pno/layer/compare/city/scope/year/weights/filters/ref/isochrone/viewport/lang/colorblind/shortlist), debounced, strictly validated | State & sharing |
| Durable named shortlist with floating tray, open-into-comparison, `/auth/shortlist` cloud sync | State & sharing |
| Embed snippet carrying URL state with `postMessage` auto-resize + open-full-view deep link | State & sharing |
| Share-as-image cards for single area, comparison, and correlation (lazy `html-to-image`) | State & sharing |
| Custom reference-neighborhood baseline ("compared to {area}") across diffs and radar | Analysis |
| Configurable similarity engine with region-vs-national "search all of Finland" toggle | Analysis |
| Active-layer distribution histogram with direction-aware percentile in the panel | Analysis |
| Discovery wizard with per-criterion "why it matched" contribution breakdown | Analysis |
| Property-price & crime time-series with change metrics, time slider, trend charts, sparklines | Data & time-series |
| Composite Quality Index with personas, national winsorized normalization, per-area factor-coverage auditability | Quality Index |
| Single source-of-truth data-source registry (`data_sources.json`) driving `METRIC_SOURCES`, sources page, provenance gate | Data integrity |
| Public Data Sources & Methodology page prerendered FI/EN/SV with Dataset JSON-LD | Distribution/SEO |
| ~27k profiles ×3 langs + 69 hubs ×3 + directory prerendered with Place/BreadcrumbList/FAQPage/Dataset JSON-LD + percentile superlatives | Distribution/SEO |
| Manifest-driven grid discovery (`grid_manifest.json`) with two real 250 m grids (air quality, light pollution) | Map rendering & grids |
| All-cities metro-area dissolve via pre-baked seutukunnat boundaries | Map rendering & grids |
| Per-region TopoJSON quantization with committed payload manifest + CI payload report | Infrastructure |
| Test-coverage ratchet, build-time provenance manifest + coverage-regression gate, daily health-check cron | Infrastructure |
| Optional Express 5 + Postgres auth backend, cloud sync, bcrypt(12), Turnstile, rate limiting, timing-safe login | Backend & ops |
| `prefers-reduced-motion` support, AA color-contrast axe gate, FI/EN/SV key parity with `sv-SE` formatting | UI/UX & a11y |
| Proxy/estimate disclosure badge driven by registry `is_proxy` in Legend and panel | UI/UX & a11y |
| Observable sync layer with exponential-backoff retry and cross-tab localStorage sync across all persisted stores | State & sharing |

---

### Audit method

This roadmap was produced by a multi-agent workflow: 10 parallel subsystem surveys (map, data/metrics, analysis, state, UI/i18n, pipeline, SEO, backend, an old-roadmap-vs-git reconciliation, and a fresh-eyes product pass) → a synthesis that deduped and assigned IDs → **adversarial per-item verification** (one skeptic per item, charged with refuting it / proving it already shipped) → a completeness critic. All 49 items were verified against the actual code as genuinely not-yet-built; file lists, complexity, tags, and the CF-12/CF-15/CF-16 data-integrity and deferral flags reflect those verifications.
