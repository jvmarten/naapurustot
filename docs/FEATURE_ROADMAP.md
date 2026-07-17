# naapurustot.fi — Feature Roadmap

> Generated 2026-07-17. **Supersedes the 2026-06-17 roadmap.** From that plan, national filtering (`?city=all` search over all 3,018 areas), accent-folded + municipality search, the prerendered `/vertaa/` X-vs-Y comparison pages, and the server route-test gate all shipped — alongside a month of un-roadmapped work (voting layers, foreign-language time series, fit-for-you score, profile SEO/perf, mobile fixes). The isochrone feature was disabled (`ISOCHRONE_ENABLED`), mooting its parity items. The remaining candidates were re-triaged for impact; this roadmap keeps only the **15 highest-value survivors**. Item IDs are fresh and do not map to the prior roadmap's.

## The headline

Three fronts, in priority order:

1. **The most decision-relevant missing data layers**, all real-sourced, postal-or-finer, zero data-bundle cost: low-income share / segregation (`hr_pi_tul`), distance-to-essential-services including the missing **pharmacy** category, true building-level construction flow from the **Ryhti permit register**, national protected-nature access (SYKE), and job self-sufficiency (derived from already-fetched Paavo fields).
2. **Closing render/parity gaps on already-loaded data** — the React profile page shows less than its own `<noscript>`, mobile users can never reach a comparison chart, and the radar chart misrepresents rural areas with hardcoded metro-centric axes.
3. **Making the safety gates real** — the type-check and coverage-ratchet CI steps are provably no-ops, pushed data regenerations skip full validation, and the core docs state a bundle budget that is 33 KB stale.

## The bundle-budget reality (read before implementing anything)

CI fails when the gzipped sum of **all** app JS (lazy chunks included, only `maplibre-*` excluded) exceeds the `BUDGET` constant in `scripts/check-bundle-size.mjs` — currently **313,000 bytes** (CLAUDE.md and ARCHITECTURE.md still say 280,000; PO-2 fixes them). Measure headroom with `npm run bundle:check` before every push. `fi.json` is statically bundled (not free); `en.json`/`sv.json` are lazy `?url` assets (free). Build-time / prerender / `?url`-asset surfaces cost zero bundle bytes — every data layer below ships its values that way. **Exactly one designated item per batch may raise `BUDGET`** (history 256→280→…→313).

## Data integrity & granularity (non-negotiable)

Every value must trace to a real, verifiable, open-licensed source — never fabricated, estimated, or placeholder. Prefer postal-or-finer granularity; municipality-level values distributed to postal codes must be flagged `is_proxy:true`. Suppressed source values (e.g. Paavo `-1`) become no-data, never a number.

## Deliberately excluded — do not re-propose

Owner/prior-audit exclusions carry over: affordability calculator; neighbor-ring highlight; green-space layer; demographic 250 m grid; OSM building footprints; MML elevation; commute-destination filter; HAME maakuntakaava; **national asemakaava-coverage from Ryhti** (verified near-empty until the 1 Jan 2029 statutory deadline — the *permit* register, by contrast, is populated today and is CF-3).

**Value-pruned in this rewrite (real but not top-15; fair game later):** libraries layer (Kirkanta v4), cultural-heritage layer (Museovirasto WFS), FMI 1 km microclimate grid, SplitMapView planning-overlay parity, Speculation Rules prefetch, adaptive `theme-color`, onboarding-tour SR announcements, CSV/PDF export completeness, RegionRankingTable export parity, forced-colors CSS, legend no-data swatch, `<main>` landmark + language-switch announcements, filter-preset login-merge guard/tombstones, visual-regression keep-or-kill decision, DCAT/GeoJSON open-data packaging, QI traffic-accidents coverage-claim doc fix.

---

## 1 — Quick Wins

### QW-1 Job self-sufficiency (työpaikkaomavaraisuus) layer

| | |
|---|---|
| **What** | Derive `job_self_sufficiency = tp_tyopy / pt_tyoll * 100` in `prepare_data.py` (both fields already fetched and used there), propagate to the GeoJSON, run `build:data`. Add a **diverging** LayerConfig centered at 100 (employment hub vs. commuter suburb) in the economy group, mirror the derivation in `metrics.ts` per-feature *and* in the metro-aggregate ratio section (sum numerators/denominators — do **not** average per-area ratios), and add registry/provenance rows + fi/en/sv labels. |
| **Why** | Highest-ROI new layer: zero new fetch, 100% postal coverage, and a genuinely new axis distinct from `employment_rate` and the sector shares. |
| **Data source** | Statistics Finland Paavo `tp_tyopy` / `pt_tyoll` — https://stat.fi/tup/paavo/index.html — CC BY 4.0 — postal, `is_proxy:false` |
| **Touches** | `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~300–400 gz B; designated BUDGET-bumper for its batch |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Highlight + scroll-to the selected area in the ranking tables

| | |
|---|---|
| **What** | Thread the selected `pno` from `App.tsx` into `RankingTable` and `RegionRankingTable` (neither takes a `selected` prop today), highlight the matching row with a rank badge, and `scrollIntoView` on open. For `RegionRankingTable` the match is the selected area's region, since it ranks the 69 seutukunnat. |
| **Why** | "Where does my area rank?" is a core decision-support question, currently unanswerable without scanning ~200 rows. Pure prop + styling over data already in scope. |
| **Touches** | `src/components/RankingTable.tsx`, `src/components/RegionRankingTable.tsx`, `src/App.tsx` |
| **Bundle** | ~400 gz B |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Make the CI "Type check" step real (`tsc --noEmit` is a no-op)

| | |
|---|---|
| **What** | The root tsconfig is solution-style (`files:[]` + references), so `npx tsc --noEmit` (`ci.yml`, `auto-merge.yml`) compiles **zero** files and always passes. Replace with `tsc -b`, or delete the step since Build already runs `tsc -b && vite build`. |
| **Why** | A named gate that gives false assurance; type errors only surface later in the heavier Build step. Make it real or remove the misleading green check. |
| **Touches** | `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml` |
| **Bundle** | 0 (CI config) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Re-baseline the toothless coverage ratchet

| | |
|---|---|
| **What** | `coverage-baseline.json` still pins statements/branches/functions/lines at 32.27/27.05/25.34/32.91 while actual coverage is roughly double — `check-coverage.mjs` (0.5 pp tolerance) can never fire. Regenerate from a real `vitest run --coverage` and commit the true numbers with a modest margin. **Sequence last** so the baseline reflects post-roadmap coverage. |
| **Why** | The headline regression gate is inert — coverage could collapse by half without failing CI. Zero feature risk, protects every future test-touching push. |
| **Touches** | `coverage-baseline.json` |
| **Bundle** | 0 |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Stop shipping `dist/stats.html` (bundle treemap) to public Pages

| | |
|---|---|
| **What** | `rollup-plugin-visualizer` writes `dist/stats.html` on every build and `deploy.yml` uploads all of `dist` — the treemap is live at naapurustot.fi/stats.html. Extend `stripBuildOnlyData()` in `vite.config.ts` to delete it before deploy, or gate the visualizer behind an `ANALYZE` env flag. |
| **Why** | An unreferenced public asset disclosing the full bundle/module composition of a privacy-first app, plus dead deploy bytes. Zero downside to removing. |
| **Touches** | `vite.config.ts` |
| **Bundle** | 0 (removes a public asset) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 Low-income share (pienituloisuus) layer + opt-in Quality Index factor

| | |
|---|---|
| **What** | Derive `low_income_pct = hr_pi_tul / (hr_pi_tul + hr_ke_tul + hr_hy_tul) * 100` in `prepare_data.py`, guarding the Paavo `-1` suppression sentinel and zero denominators (emit no-data, never a fabricated value — ~97% of areas remain usable). Propagate to the GeoJSON, run `build:data`. Add a LayerConfig (`higherIsBetter:false`), the `metrics.ts` field + derive, an **optional `defaultWeight:0`** `QUALITY_FACTOR` (established opt-in pattern), registry/provenance rows, and fi/en/sv labels. `national_ranges.json` already carries the `hr_*` ranges. |
| **Why** | The only money signals today are median/average/disposable income; the lower tail — socioeconomic disadvantage and income segregation — is invisible. The single most decision-relevant missing axis for relocating households and the journalist/researcher fairness lens, from data already loaded. |
| **Data source** | Statistics Finland Paavo income-class household counts `hr_pi_tul`/`hr_ke_tul`/`hr_hy_tul` — https://stat.fi/tup/paavo/index.html — CC BY 4.0 — postal, `is_proxy:false`; `-1`/zero-denominator → no-data |
| **Touches** | `scripts/prepare_data.py`, `src/utils/metrics.ts`, `src/utils/colorScales.ts`, `src/utils/qualityIndex.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~300–400 gz B; designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Distance-to-nearest essential-service layers (the 15-minute-neighbourhood axis)

| | |
|---|---|
| **What** | Add "distance to nearest" (metres) metrics for grocery, health station, **pharmacy** (a brand-new category — nothing in `colorScales.ts` covers it), and comprehensive school, computed sub-postal in `prepare_data.py` exactly like `water_proximity_m` (reusing `_point_to_pno`/`_build_spatial_index`). Schools use the authoritative StatFin Oppilaitokset point WFS instead of OSM. Register each LayerConfig, `LAYER_GROUPS` entry, `metrics.ts` def, registry/provenance rows, and locale keys. |
| **Why** | The shipped amenity layers are all /km² density, which misleads for the ~95% of Finland outside metros — one central store in a large rural postal code reads as "low density". Distance-to-nearest is the honest, decision-relevant framing, and pharmacy is a glaring missing everyday service. |
| **Data source** | OSM `amenity=pharmacy` / `shop=supermarket\|convenience` / `amenity=clinic\|doctors\|hospital` (ODbL 1.0, coordinate-level, already fetched nationally at build time); Statistics Finland Oppilaitokset point WFS (CC BY 4.0, national) — https://geo.stat.fi/geoserver/oppilaitokset/wfs — coordinate→min-distance per area, `is_proxy:false` |
| **Touches** | `scripts/prepare_data.py`, `scripts/fetch_oppilaitokset.py`, `public/data/metro_neighborhoods.geojson`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~0.4–1.2 KB gz (data is zero-bundle; cost is ~4 LayerConfigs + fi keys); designated BUDGET-bumper for its batch |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 True building-level construction-flow layer from the Ryhti national permit register

| | |
|---|---|
| **What** | Upgrade the existing `construction_activity` layer (StatFin municipal data distributed to postal codes, `is_proxy:true`) to coordinate-level data: a new build-time `fetch_ryhti_permits.py` pages the Ryhti `open_permit_building` OGC API Features (~2.7M national permit points with decision date, action type, dwelling count, floor area), point-in-polygons recent new-construction permits into the 3,018 areas, and computes permits / permitted dwellings / floor area per 1,000 residents. Drop `is_proxy` only for municipalities with confirmed coverage (permit submission is voluntary until **31 Dec 2028**); gray fallback elsewhere. Re-baseline `validate_data.py`. |
| **Why** | Replaces a proxy municipal distribution with real building-level data — the "prefer finer-than-postal" mandate applied to an existing layer — and gives a true "how much is being built here" signal that pairs with the shipped kaavat & hankkeet centerpiece. |
| **Data source** | Ryhti building-permit OGC API Features `open_permit_building`/`open_permit_address` (SYKE/YM) — https://paikkatiedot.ymparisto.fi/geoserver/ryhti_permit/ogc/features/v1 — CC BY 4.0 — building point aggregated to postal, `is_proxy:false` where covered |
| **Touches** | `scripts/fetch_ryhti_permits.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/validate_data.py`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | 0 (build-time; reuses the existing layer) — not a BUDGET-bumper |
| **Complexity** | Large |
| **Dependencies** | IN-1 preferred first (its gate then validates this regeneration) |
| **Tag** | Claude Code |

### CF-4 National protected-nature & national-park access layer (SYKE)

| | |
|---|---|
| **What** | Build-time `fetch_protected_areas.py` over SYKE Natura 2000 + nature-conservation/wilderness/national-park polygons; per postal area compute distance-to-nearest protected area and/or %-of-area protected, write into the GeoJSON, run `build:data`. Register a LayerConfig (Environment group), `metrics.ts` def, registry/provenance rows, locale keys; re-baseline `validate_data.py`. Distinct from the excluded urban green-space layer — this is statutory conservation/wilderness access. |
| **Why** | `tree_canopy` (HSY LiDAR) is capital-region-heavy, leaving most of Finland with weak nature coverage. SYKE polygons are national and precise, answering a distinct relocation question — "how close is real wilderness?" — that fills the rural hole. |
| **Data source** | SYKE Natura 2000 + Luonnonsuojelu- ja erämaa-alueet WFS — https://ckan.ymparisto.fi/dataset/natura2000-alueet — CC BY 4.0 — national polygons aggregated to postal, `is_proxy:false` |
| **Touches** | `scripts/fetch_protected_areas.py`, `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/utils/metrics.ts`, `src/components/LayerSelector.tsx`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson` |
| **Bundle** | ~300–400 gz B (LayerConfig + fi labels; data zero-bundle); designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Render latent profile enrichment in the interactive React profile page

| | |
|---|---|
| **What** | The prerendered `<noscript>` (`prerender.mjs`) shows the full Paavo age pyramid, top-5 sector employment, household income/structure, plain-language strengths/weaknesses, an FAQ, kaavat & hankkeet, and a nearby-areas mesh — while `NeighborhoodProfilePage.tsx` renders only a stats grid + a few sections. The data is already in the `loadNeighborhoodData()` payload + `region_properties.json`. Add lazy section components under `src/components/profile/` so JS visitors reach parity with the crawler view. |
| **Why** | JS visitors (the majority) see strictly **less** than a no-JS crawler or AI agent. Pure render gap over already-loaded data; deepens the page and dwell time. |
| **Touches** | `src/pages/NeighborhoodProfilePage.tsx`, `src/components/profile/`, `src/utils/metrics.ts`, `src/locales/fi.json` |
| **Bundle** | ~0.8–1.5 KB gz (lazy section components); covered by its batch's designated bumper |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-6 ComparisonPanel: multi-series radar + mobile chart parity + winner summary

| | |
|---|---|
| **What** | The chart toggle and `ComparisonChart` live only in the desktop branch; the mobile branch renders `MobileCard`s and never reads `view`, so **mobile users can never reach any comparison chart**. (1) Add an overlaid radar plotting the 2–3 pinned areas as overlapping polygons, extending `RadarChart`'s axis machinery to N series with axes from `national_ranges.json` (depends on PO-1). (2) Surface the chart toggle on mobile. (3) Add a one-line synthesis above the table ("Area X leads on N of M metrics") from the already-computed `bestByKey` map. |
| **Why** | An overlaid radar is the strongest at-a-glance shape comparison for shortlisting, and this fixes a real mobile-parity bug using already-loaded data. |
| **Touches** | `src/components/RadarChart.tsx`, `src/components/ComparisonPanel.tsx`, `src/utils/nationalRanges.ts`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Bundle** | ~1–1.5 KB gz; designated BUDGET-bumper for its batch |
| **Complexity** | Medium |
| **Dependencies** | PO-1 |
| **Tag** | Claude Code |

### CF-7 Wikidata/Wikipedia entity linking (`Place.sameAs`) in profile + hub JSON-LD

| | |
|---|---|
| **What** | Build a committed `scripts/wikidata_qids.json` (one-time SPARQL query for the 69 seutukunnat + ~310 municipalities) and attach `sameAs: [Wikidata QID URL, Wikipedia URL]` to the `Place` nodes in the prerendered profile pages (`prerender.mjs`), region hubs (`prerender-hubs.mjs`), and the client `JsonLd.tsx`. No `sameAs`/Wikidata reference exists anywhere today. |
| **Why** | Entity grounding is the highest-leverage answer-engine lever: anchoring each area to its canonical Wikidata entity lets knowledge graphs and AI assistants disambiguate the place and cite naapurustot as the numeric source. Pure build-time HTML. |
| **Data source** | Wikidata SPARQL/REST (CC0) — QIDs + Wikipedia URLs only, no copied content — https://www.wikidata.org/wiki/Wikidata:Data_access |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `src/components/profile/JsonLd.tsx`, `scripts/wikidata_qids.json` |
| **Bundle** | 0 (build-time); client JSON-LD adds tens of bytes |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 Derive RadarChart axis min/max from `national_ranges.json`

| | |
|---|---|
| **What** | Replace the hardcoded `AXES` min/max literals in `RadarChart.tsx` (e.g. transit 5–65 vs. an actual national max of ~17; housing 1000–12000 vs. ~5410) with lookups into the already-loaded `national_ranges.json` (winsorized p2/p98), keeping direction handling. The composite services axis averages its three constituent bounds. |
| **Why** | Metro-centric caps peg most of the 3,018 areas near the floor, so the radar shape misrepresents rural areas — and the constants go stale on every data refresh. A data-honesty fix and the foundation for CF-6's N-series radar. |
| **Touches** | `src/components/RadarChart.tsx`, `src/utils/nationalRanges.ts` |
| **Bundle** | ~0 (constants swapped for an existing-asset lookup) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Doc truth-up: budget, layer counts, and drifted claims

| | |
|---|---|
| **What** | Fix verified-stale numbers across `CLAUDE.md` / `docs/ARCHITECTURE.md` / `docs/QUALITY_INDEX.md`: bundle budget "280,000" → the final post-roadmap `BUDGET` (313,000 at time of writing, raised once per batch); "59 layers" → the post-roadmap `LAYERS` count; hook/factor counts; grid-overlay list; any other claims contradicted by the code. **Sequence last** so counts reflect every merged layer. |
| **Why** | These docs are the source of truth for contributors and for Claude Code itself; a 33 KB-stale budget number causes wrong implementation decisions. Zero risk. |
| **Touches** | `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/QUALITY_INDEX.md` |
| **Bundle** | 0 (docs only) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Gate the full `validate_data.py` on data-touching branches

| | |
|---|---|
| **What** | `ci.yml` and `auto-merge.yml` run only `validate_data.py --files-only` (registry/provenance checks); the full suite — value ranges, coverage regression, all-null columns, geometry, feature counts — runs solely in the quarterly `data-refresh.yml` cron. Add a job (paths-filtered on `public/data/**` + `scripts/**`) to `auto-merge.yml` that runs the full validation against the committed GeoJSON. |
| **Why** | Today a hand-edited fetch script + regenerated GeoJSON merges with no sanity validation — a silently nulled column would ship. Closes a real integrity hole and protects every data-layer item in this roadmap; merge it first. |
| **Touches** | `.github/workflows/auto-merge.yml`, `scripts/validate_data.py` |
| **Bundle** | 0 |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Global rules for every batch: auto-merge shares one concurrency group, so **stagger pushes** (a second `claude/*` push cancels an in-flight merge); **exactly one item per batch** may edit `check-bundle-size.mjs` (the designated bumper) and one may own the GeoJSON regeneration + `build:data` run; re-run the i18n key-parity test after every locale edit. All 15 items are implementable in Claude Code sessions; the data fetchers hit external open APIs at build time (pin layer names via GetCapabilities; unavailable sources ship as honest partial coverage).

### Batch 1 — Real gates + flagship socioeconomic layer

| Item | Title | Category | Complexity |
|---|---|---|---|
| IN-1 | Gate full `validate_data.py` on data branches | Infrastructure | Medium |
| CF-1 | Low-income share layer + opt-in QI factor | Core | Medium |
| PO-1 | RadarChart axes from `national_ranges.json` | Polish | Small |
| QW-3 | Fix the no-op CI type-check | Quick Win | Small |

**Parallel-safety:** no two items share a file. CF-1 is the sole layer-registry editor, `build:data` runner, and BUDGET-bumper. IN-1 owns `auto-merge.yml` + `validate_data.py`; QW-3 owns `ci.yml` (+ the `auto-merge.yml` type-check line — merge after IN-1). Merge IN-1 before CF-1 so the new gate validates it.

### Batch 2 — Comparison upgrades + build hygiene

| Item | Title | Category | Complexity |
|---|---|---|---|
| CF-6 | Multi-series radar + mobile chart parity | Core | Medium |
| CF-7 | Wikidata `sameAs` entity linking | Core | Medium |
| QW-2 | Highlight + scroll-to selected area in rankings | Quick Win | Small |
| QW-5 | Stop shipping `dist/stats.html` | Quick Win | Small |

**Parallel-safety:** CF-6 owns `RadarChart.tsx` (PO-1 merged) + `ComparisonPanel.tsx` and is the sole BUDGET-bumper; CF-7 owns the prerender scripts + `JsonLd.tsx`; QW-2 owns `App.tsx` + the ranking tables; QW-5 owns `vite.config.ts`. Only CF-6 adds locale keys.

### Batch 3 — Fifteen-minute access layers

| Item | Title | Category | Complexity |
|---|---|---|---|
| CF-2 | Distance-to-essential-services layers (+ pharmacy) | Core | Large |
| CF-5 | Profile-page enrichment parity | Core | Medium |

**Parallel-safety:** CF-2 is the sole layer-registry editor, `build:data` runner, and BUDGET-bumper (sized to also cover CF-5's ~1.5 KB — CF-5 must not edit `check-bundle-size.mjs`). CF-5 owns `NeighborhoodProfilePage.tsx` + `src/components/profile/` (`JsonLd.tsx` free — CF-7 merged) — but both touch `metrics.ts`, so **merge CF-2 first** and rebase CF-5, or keep CF-5's `metrics.ts` edits additive-only. Two locale-adders — distinct keys, stagger merges.

### Batch 4 — Real building data + national nature

| Item | Title | Category | Complexity |
|---|---|---|---|
| CF-3 | Ryhti building-permit construction-flow layer | Core | Large |
| CF-4 | Protected-nature access layer (SYKE) | Core | Medium |

**Parallel-safety:** both are layer-registry/GeoJSON items — **serialize them** (CF-3 first; CF-4 rebases and owns the second `build:data` run + the batch's single BUDGET raise). Both re-baseline `validate_data.py` against IN-1's gate.

### Batch 5 — Last-layer quick win + final truth-up

| Item | Title | Category | Complexity |
|---|---|---|---|
| QW-1 | Job self-sufficiency layer | Quick Win | Small |
| PO-2 | Doc truth-up (budget/counts) | Polish | Small |
| QW-4 | Re-baseline the coverage ratchet | Quick Win | Small |

**Parallel-safety:** QW-1 is the sole layer-registry editor, `build:data` runner, and BUDGET-bumper. PO-2 and QW-4 are deliberately **last** — run them only after everything else merges so the documented budget, layer counts, and measured coverage reflect the finished roadmap.

---

### Method note

Statuses verified against the live codebase on 2026-07-17 (git log since 2026-06-17, grep/file checks for each carried-over item): shipped items dropped, the isochrone-dependent item mooted, and the remaining 31 candidates re-ranked by decision-relevance per byte of complexity; the pruned tail is listed under "value-pruned" above and remains fair game.
