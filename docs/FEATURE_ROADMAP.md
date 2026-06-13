# naapurustot.fi — Feature Roadmap

> Generated 2026-06-13 from a fresh multi-agent codebase audit (8 parallel subsystem surveys + 4 live external data-source research dossiers → opportunity brief → 7 ideation lenses + a 3-variant kaavoitukset/hankkeet design panel with a design judge → synthesis/dedup → one adversarial verifier per item against the real code and live data APIs → completeness critic → sequencing; 55 agents). **Supersedes the 2026-06-10 roadmap, every item of which (QW-1…8, CF-1…21, PO-1…5, IN-1…8) shipped and merged.** Recent `main` commits are post-roadmap UX/bug batches, not roadmap items. Item IDs here are **fresh** and do not map to the prior roadmap's IDs.

## The headline: the owner's centerpiece — *kaavoitukset & hankkeet* (zoning plans + development/infrastructure projects)

The product currently has **nothing** about what is being planned or built near an area — verified greenfield (zero `kaava`/`hanke`/`asemakaava`/`ryhti`/`vireillä` references in `src/` except one area name in `slug_aliases.json`). No Finnish consumer service combines per-area neighbourhood stats with "what's planned/built nearby" — Oikotie and Etuovi explicitly punt zoning lookup to city sites; municipal/Ryhti viewers are pro-grade and un-aggregated. naapurustot is positioned to be first.

**The honest data reality (this shapes the whole feature):**

- A **national, machine-readable, postal-or-finer ZONING dataset does not exist today.** The correct long-term source — **Ryhti / RYTJ** (`paikkatiedot.ymparisto.fi/geoserver/ryhti_plan/ogc/features/v1`, OGC API Features, CC BY 4.0, plan-polygon granularity) — is real but effectively empty for the big cities: machine-readable submission is voluntary until end-2028 and **statutory only from 1 Jan 2029**; today it holds ~2 of 18 regions (Etelä-/Pohjois-Savo via the VOOKA pilot). It is the **migration target, not the launch source**.
- **HAME** (harmonized maakuntakaava) is near-national and CC BY 4.0 but the **wrong granularity** (one regional polygon spans hundreds of postal codes) — use at most as a coarse context note, or skip.
- **Per-city WFS feeds** are the only source of in-progress (`vireillä`) plan geometry today, and they are fragmented (GeoServer vs Tekla, GeoJSON vs GML, CRS 3879/3878/3133 → all must reproject to EPSG:3067; layer names drift → pin via GetCapabilities each build). Confirmed CC BY 4.0 vireillä feeds: **Helsinki** (`kartta.hel.fi/ws/geoserver/avoindata/wfs`), **Espoo** (`kartat.espoo.fi` Tekla), **Tampere** (`geodata.tampere.fi`, GeoJSON verified), **Vantaa**, **Turku+Kaarina**, **Jyväskylä**. Coverage: top ~6 cities ≈ 35% of population but only a few hundred of 3,018 postal codes; top ~10–15 ≈ ~45–50% population. Acceptable under the documented gray-fallback + "low data" policy — but the label/note **must** say "in-progress municipal planning in participating cities as of <snapshot>, not nationwide." Real geometry → `is_proxy:false`, partial coverage.
- **The PROJECTS half (*hankkeet*) is genuinely national TODAY.** **Väylävirasto käynnissä olevat väylähankkeet** — OGC API Features `avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1/` (collections `hanketiedot:tiehankkeet`, `:ratahankkeet`, `:ratasuunnitelmat`, `:paattyneet_hankkeet`), CC BY 4.0, point/line geometry, full-country, refreshed daily–weekly; `vaylavirasto` publisher already registered. Caveat: **state** road/rail/waterway only — excludes municipal trams/light rail and city development (those need per-city sources). Every area in Finland gets real *hankkeet* content immediately.

**Buildable shape, in dependency order:** (A) **prerender + panel + hub** content from a build-time pipeline — zero bundle bytes, national via Väylä, highest SEO ROI, ship first (IN-1 → CF-1, CF-3, CF-4, CF-10); (B) an **interactive additive map overlay** modeled on the isochrone effect, funded by a justified BUDGET raise (CF-2); (C) a **neutral planning/development-activity choropleth** (CF-5), backstopped nationally by a StatFin construction-FLOW layer (CF-11). Design the per-area schema around Ryhti's lifecycle vocabulary (`vireillä→ehdotus→hyväksytty→lainvoimainen→kumottu`) so the ~6–10 city adapters can later collapse into one Ryhti fetcher as municipalities onboard through 2029. **Document the 2029 backstop so partial coverage is framed as a migration phase, not a defect.**

## The bundle-budget reality (read before implementing anything)

CI fails when the gzipped sum of **all** app JS (lazy chunks included, only `maplibre-*` excluded) exceeds the single `BUDGET` constant in `scripts/check-bundle-size.mjs` (`bundle:check`, called by both `ci.yml` and `auto-merge.yml`). Verified state:

1. **`BUDGET = 287_000` bytes; measured usage ≈ 286,676 B gz → ~324 B headroom (effectively zero).** Every JS-touching item below carries a measured/estimated gz byte cost. Raising `BUDGET` for a substantial real batch is **established practice** (history 256→280→282→287) — but exactly **one** item per batch may edit the constant.
2. **`fi.json` is NOT free** (statically bundled in the ~16 KB i18n chunk, `i18n.ts:19`); **`en.json`/`sv.json` ARE free** (lazy `?url` assets). Prerender text uses **inline FI/EN/SV strings, not locale keys** (the `NEXTSTEPS_LABELS`/CF-13 pattern). Build-time / prerender / static-asset (`?url`, manifest+`fetch`) surfaces cost **zero** bundle bytes — strongly preferred.
3. **Batch 1 deliberately front-loads the three headroom-freeing items** — QW-9 (remove vestigial affordability plumbing, ~1.5–2.5 KB), IN-7 (split page-only `fi.json` strings to a lazy asset, ~2 KB), QW-8 (prune orphan keys, net-negative) — **freeing ~4 KB** so the planning UI and new data layers can often land without a `BUDGET` raise. Measure with `bundle:check` before every push.

## Deliberately removed / excluded — do not re-propose

Everything in the prior roadmap (all QW/CF/PO/IN items) shipped — treat as done. Owner-excluded (do not re-propose): affordability **calculator** (QW-9 removes only its dead residue, not the feature), neighbor-ring map highlight, duplicate scope pill, idle hint pill, header share button, the green-space **layer** (QW-7 purges only its orphaned column), national/metro demographic 250 m grid, OSM building footprints, MML elevation, commute/isochrone destination filter, off-droplet nightly DB backups. **HAME maakuntakaava** as a primary zoning layer (granularity too coarse) is also excluded by this audit.

### Refuted during verification (considered, rejected)

- **"Trajectory / momentum analysis mode from history arrays"** — already shipped: the five realized-change metrics are a full *Trends* layer group (`colorScales.ts:425+`), `RankingTable` already ranks fastest-improving/declining by any active change layer, and `TrendChart`/`TrendSection` show per-area slope and change %. The only delta (OLS slope vs first-to-last %) is a methodology tweak, not a new surface.
- **"Remove vestigial affordability scoring (the whole stack)"** — over-scoped/false as written: `affordability.ts` is still used by the live wizard budget fold and hydrates shared `?aff=` links by deliberate design (commit `6078a54`). Only the dead `filterUtils` CF-14 trio is truly removable. (QW-9 below carries the **correct, verified-narrow** version of this cleanup.)

---

## 1 — Quick Wins

### QW-1 Two latent-Paavo decision layers: disposable household income (`tr_mtu`) + living space per person (`te_as_valj`)

| | |
|---|---|
| **What** | Surface two decision-critical Paavo columns already present on every per-region feature but rendered nowhere as map layers. (1) `tr_mtu` = median household **disposable** income (käytettävissä olevat rahatulot, after tax+transfers), genuinely distinct from the surfaced `median_income` which maps to `hr_mtu` = per-resident state-taxable income (`colorScales.ts:194`). (2) `te_as_valj` = living space m²/person (reuse the sqm formatter, distinct from `apt_size`=`ra_as_kpa`). **Required data-cleanup (the field is NOT clean as-is):** both carry raw Paavo `-1` confidentiality sentinels (188 areas each) + 19 zero-suppression artifacts because `prepare_data.py` `clean_properties()` (lines 799-811) nulls `-1` only for a key-fields list that omits these. Add `tr_mtu`/`tr_ktu`/`te_as_valj` to that list, null the existing `-1`/`0` in the GeoJSON, add a LayerConfig each (euro/sqm), `LAYER_GROUPS` entries (economy / housing), `metrics.ts` typing + `METRIC_DEFS` rows with `requirePositive:true`, registry + provenance rows (Paavo, postal, `is_proxy:false`), labels ×3, then `build:data` so `national_ranges.json` min becomes the real positive p2 (it is currently polluted to `-1`). |
| **Why** | A relocating household judges "can households like mine afford to *live* here, and how crowded is it?" Median household disposable income answers take-home affordability far better than per-resident taxable income; m²/person is the most concrete crowding signal. CF-13 already prints both as static profile text + JSON-LD (proving the data is real) but they are absent from the interactive map/compare/wizard. ~600–900 B gz (2 LayerConfigs + 2 `LAYER_GROUPS` ids + 2 `METRIC_DEFS` + `fi.json` labels; en/sv free) → small `BUDGET` bump. |
| **Touches** | `scripts/prepare_data.py`, `public/data/metro_neighborhoods.geojson`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/data/national_ranges.json`, `src/data/region_properties.json`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Wire `health_index`, `radon` and `flood_risk` into the Quality Index as opt-in `defaultWeight:0` factors

| | |
|---|---|
| **What** | Add three `QualityFactor` entries to `QUALITY_FACTORS` in `qualityIndex.ts` (the array at 64-552), each `defaultWeight:0` / `primary:false` so published headline/persona scores stay **byte-for-byte identical** (`computeQualityIndices` skips weight-0 factors at 676/695): `health_index` (invert:true), `radon` (invert:true), `flood_risk` (`flood_risk_pct`, invert:true). Add each to `FACTOR_DIMENSION` (837-864) under `health` — `flood_risk` as an explicit counterweight to `water_proximity` (847, invert:true) which today rewards waterfront unconditionally. Labels are inline `{fi,en,sv}` on the factor reusing existing `layer.*` strings → **no locale-file change**. Document in `QUALITY_INDEX.md`; extend `qualityIndex.test.ts` to assert default-weight scores are unchanged and each new factor has a dimension mapping. |
| **Why** | The Health dimension (weight 28) is built entirely from environmental proxies; `health_index` (THL/Kela Sotkanet morbidity) is the first real population-health **outcome** the index could use, and `flood_risk` is a direct climate counterweight to the unconditional waterfront reward. CF-21 explicitly punted this exact integration as "a follow-up owner decision" because non-zero weights "change everyone's scores"; `defaultWeight:0` resolves that while letting users opt in via "Show more" and the correlation/persona tooling pick them up automatically. ~200–300 B gz (inline labels) — ride the batch raise. |
| **Touches** | `src/utils/qualityIndex.ts`, `docs/QUALITY_INDEX.md`, `src/__tests__/qualityIndex.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Expand the similarity-finder metric picker beyond the frozen 10

| | |
|---|---|
| **What** | Add five already-shipped, already-labelled metrics to both `SIMILARITY_METRICS` (`similarity.ts:16-27`) and `AVAILABLE_SIMILARITY_METRICS` (34-45): `air_quality_index`, `health_index`, `rental_price_sqm`, `tree_canopy_pct`, `walkability_index` — each reuses an existing `layer.*` key (zero new locale keys) and the existing min-max normalization + per-metric weight machinery; the picker renders straight from the array so **only `similarity.ts` changes**. Note `useSimilarityMetrics.ts:20-24` defaults every key to weight 1, so the five become active by default (consistent with the existing "default selection is all of them" design, but shifts baseline similarity results — verify any snapshot test). |
| **Why** | "Find similar areas" is frozen at the original 10; environment (air quality, canopy), health outcome, rental cost and walkability are exactly the axes users say define "feels like my area" but can neither select nor weight. All five are real, shipped layers → pure reuse, no new data. ~120–180 B gz (the smallest-cost item in the roadmap). |
| **Touches** | `src/utils/similarity.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Fix mobile section tab labels frozen at first-mount language

| | |
|---|---|
| **What** | `MOBILE_SECTIONS` (`NeighborhoodPanel.tsx:959-964`) is a `useMemo` with an **empty dependency array**, so the four `t('panel.tab.*')` labels are evaluated once at mount and never recompute. The panel calls `useI18nVersion()` (851) but does not capture/use its value, so the i18n version is absent from the memo deps — defeating the whole point of `useI18nVersion()` for these labels. Fix: capture `const i18nVersion = useI18nVersion()` and add it to the memo deps (or drop the `useMemo` — it only builds a 4-element string array; `useMemo` stays imported by other memos). |
| **Why** | Direct i18n correctness defect on the primary mobile surface (the `role=tablist` strip at 2177-2192). Two real failure modes: after FI→EN/SV the persistent panel's tab strip stays in the old language while the rest updates; and if the panel mounts before the en/sv dictionary loads, labels freeze at the Finnish fallback even after the dict arrives. ~0 bytes (changes a dependency array). |
| **Touches** | `src/components/NeighborhoodPanel.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Adjacency-driven "naapurialueet / nearby areas" link mesh in the prerendered profiles

| | |
|---|---|
| **What** | `src/data/adjacency.json` (2,975 pno → neighbour lists, rebuilt every refresh) is consumed by the in-app adjacency tool and by **no build surface** (zero references in `prerender.mjs`); prerendered profiles link only upward (region hub, map, directory at `prerender.mjs:802-808`), never laterally. Read `adjacency.json` once at the top of `prerender.mjs`, build a pno→feature map from the existing `features` array (one must be constructed — none exists today), thread it into `buildNoscriptContent`, and append a per-language "Naapurialueet / Nearby areas / Närliggande områden" list (cap ~8, resolve each neighbour to its slug + per-language URL + localized name, skip any absent from the map), with inline FI/EN/SV headings (no locale keys). Within-region only, so links stay inside the seutukunta. Distinct from the shipped (in-app) QW-5. |
| **Why** | Civic readers and journalists explore by geography ("what about the next neighbourhood over?"); a static profile is currently a dead end except upward. The cheapest crawl-depth / internal-PageRank win on the whole profile surface — turns a star topology into a connected within-region mesh. The graph is already built and committed. 0 bundle bytes (build-time). |
| **Touches** | `scripts/prerender.mjs` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-6 Atom-feed + open-data discovery links in standalone hub/ranking/landing/open-data page heads

| | |
|---|---|
| **What** | The PO-5 data-updates Atom feed (`dist/data-updates.atom`) is the recurring-visit hook. Its `<link rel="alternate" type="application/atom+xml">` is on `index.html:12` and (because `prerender.mjs` clones `index.html` and strips only JSON-LD/keywords) is carried onto all ~9,000 profiles and the sources pages — but the standalone pages built by `htmlPage()` in `prerender-hubs.mjs` (head template 289-323) omit it, as does the `/avoin-data` landing in `build_open_data.mjs` (240-251). Add the one-line atom alternate `<link>` to both head templates, plus a footer/discovery link to `/tietolahteet` and `/avoin-data`, covering ~1,470 standalone citable pages (69 hubs ×3 + directories + EN/SV landings + ~420 ranking sets ×3 + the open-data landing). |
| **Why** | Closes the recurring-visit + bulk-download discovery loop on the standalone pages that lack it. Feed readers/crawlers auto-discover the atom `<link>` (more re-crawls); the open-data link surfaces the CSV/codebook/JSON API to researchers landing on a hub or ranking page. 0 bytes (build-time markup). |
| **Touches** | `scripts/prerender-hubs.mjs`, `scripts/build_open_data.mjs` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-7 Drop the orphaned `green_space_pct` column end-to-end to shrink first-paint payloads

| | |
|---|---|
| **What** | Purge the dead `green_space_pct` field. The green-space **layer** was deliberately removed (superseded by `tree_canopy`), but the column survives as residue in `prepare_data.py` (`fetch_osm_green_spaces()` L1170, `join_green_spaces()` L1242, call sites L2635-2636, emitted-field list L2748), in `metro_neighborhoods.geojson`, `region_properties.json` (3,018 occurrences), `national_ranges.json`, all 69 `regions/*.topojson`, plus a stale `validate_data.py:85` RANGE_CHECKS row and an `audit_data_coverage.py:40` entry. Stop fetching/joining/emitting it, remove the two stale script rows, and `build:data` so it drops from every artifact. Purges residue of an already-removed layer — does **not** re-introduce the green-space layer. |
| **Why** | `region_properties.json` (~11 MB) is the universal national first-paint payload and carries this column on each of 3,018 features; every per-region TopoJSON repeats it. Removing a column the app never reads trims runtime fetch bytes for all areas at zero bundle cost, deletes a stale validator row, and eliminates a column with no provenance (it has no `data_sources.json` entry) — consistent with the "leave it out rather than carry unsourced data" policy. 0 bundle bytes. |
| **Touches** | `scripts/prepare_data.py`, `scripts/validate_data.py`, `scripts/audit_data_coverage.py`, `public/data/metro_neighborhoods.geojson`, `src/data/region_properties.json`, `src/data/national_ranges.json`, `src/data/regions/` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-8 Unused-`fi.json`-key audit + drift guard: prune verified orphans to reclaim bundle headroom

| | |
|---|---|
| **What** | Add a build/test-only unused-key audit for `fi.json` (the statically-bundled locale) and delete only **verified** orphans. Because fi keys are frequently composed at runtime, the scan **must** carry an explicit dynamic-key allowlist or it over-reports massively (a naive scan flags 138 keys, ~120 false positives). Allowlist the used dynamic families: `privacy.s_*`, `summary.sentence.*` incl. `*_region`, `metric_explanation.${property}`, `panel.${property}`, `wizard.size_*`/`wizard.afford_mode_*`, `settings.theme_*`, `correlation.sig_*`, and layer/metric labels. Prune the genuine orphans (verified unreferenced anywhere): `app.subtitle`, `panel.section.{demographics,economy,housing,quality_of_life,health,services,mobility}` (mobile tabs use `panel.tab.*`), `settings.light_mode`/`dark_mode`, `filter.sort_by`/`sort_asc`/`sort_desc`. Add a Vitest guard that fails CI when a non-allowlisted fi key has zero source references (drift prevention). Completes what shipped QW-1 began (it removed only `empty.click_to_explore` and added no guard). |
| **Why** | Deleting verified-orphan strings shrinks the always-loaded i18n chunk — one of the rare changes that **grows** headroom (~−121 gz bytes for the 13 confident orphans alone), helping fund the centerpiece UI. The audit guard is test/build-time only (0 bundle bytes) and prevents the dead-string drift QW-1 left unguarded. Net bundle cost: **negative**. |
| **Touches** | `src/locales/fi.json`, `src/__tests__/i18nUnusedKeys.test.ts` |
| **Complexity** | Small |
| **Dependencies** | IN-7 (must scan `fi.json` ∪ `fi-extra.json` after IN-7's split) |
| **Tag** | Claude Code |

### QW-9 Remove the vestigial affordability scoring/calculator plumbing to reclaim bundle headroom

| | |
|---|---|
| **What** | The owner-removed affordability **calculator** left its compute + state + URL + wizard-fold stack still bundled. Verified: there is **no** affordability input UI anywhere, so `hasAffordability` (`NeighborhoodWizard.tsx:369-372`) can only become true via a legacy `?aff=` share URL nothing can now produce, or a stale localStorage key — so the affordability-match UI block (751-776) and its scoring fold (305-327) are effectively dead. Delete `affordability.ts` (264 lines) and `useAffordability.ts` (86 lines); strip the affordability prop + fold from `NeighborhoodWizard.tsx`; remove the `App.tsx` wiring (import 43, hook call 416-418, `affordability:` extras 992, dirty-check 1729, prop 2405); excise the URL codec (`useUrlState.ts` `UrlAffordability` 59-60, fields 104-105/130-131, serialize/deserialize 212-225, parse 451, write 517-518, debounce key 605/612). Delete the three orphaned test files. Keep the codec version unchanged and **ignore** an inbound `aff` param (old links degrade to no-op). Cleanup of already-removed-feature residue — does **not** re-introduce the calculator. |
| **Why** | One of the rare changes that **grows** the ~324 B headroom — directly funding the `BUDGET` raises the centerpiece (CF-2/CF-3/CF-5) needs. Estimated net **−1.5 to −2.5 KB gz** (`affordability.ts` ~1.0–1.4 + `useAffordability` ~0.3 + wizard fold/UI ~0.4–0.6 + URL codec ~0.2–0.3; the wizard chunk is lazy but still counts). Also removes a non-functional cost model (3.5% rate / 25% down assumptions) no user can reach. Measure before/after with `bundle:check`. |
| **Touches** | `src/utils/affordability.ts`, `src/hooks/useAffordability.ts`, `src/components/NeighborhoodWizard.tsx`, `src/App.tsx`, `src/hooks/useUrlState.ts`, `src/__tests__/{affordability,affordabilityScoring,urlStateAffordability}.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 Kaavat & hankkeet: prerendered "Kaavoitus ja hankkeet lähistöllä" profile section + Place JSON-LD (ship first)

| | |
|---|---|
| **What** | Highest-ROI, zero-bundle expression of the centerpiece. In `prerender.mjs`, read `public/data/area_planning.json` at build time and, inside `buildNoscriptContent` (after the CF-4 next-steps push at 796-797, before the sources block at 799-808), append a "Kaavoitus ja hankkeet lähistöllä" / "Planning & projects nearby" / "Planläggning och projekt i närheten" section to each profile noscript, listing each entry `{name, status, date, url, source}` as an outbound `rel="noopener nofollow"` link to the originating city plan page or Väylä hanke page, using **inline FI/EN/SV strings** exactly like `NEXTSTEPS_LABELS` (723-749) — no locale keys. Push each entry into the Place JSON-LD `additionalProperty` array (`buildJsonLd`, 881-956) as `PropertyValue` nodes. Include a one-line honest coverage caption ("käynnissä olevat valtion väylähankkeet koko maassa; kuntien vireillä oleva asemakaavoitus osallistuvissa kaupungeissa tilanteessa &lt;snapshot&gt;; ei valtakunnallinen kaava-aineisto"), framing partial coverage as a migration phase toward the statutory 2029 Ryhti rollout. Areas with no entry omit the section; the national Väylä half keeps most areas non-empty. |
| **Why** | Closes the verified greenfield centerpiece gap on the surface that costs nothing and ranks: captures dense long-tail SEO/GEO intent ("mitä Pasilaan rakennetaan", "Kalasatama kaavoitus", "Tunnin juna asema") that no Finnish consumer service aggregates, with national Väylä content keeping areas across all of Finland non-empty. Ships before the overlay because it delivers centerpiece value at zero budget risk. 0 bytes (build-time prerender; inline strings; `area_planning.json` is a build input never fetched by the app). |
| **Touches** | `scripts/prerender.mjs`, `public/data/area_planning.json`, `src/data/data_sources.json` |
| **Complexity** | Medium |
| **Dependencies** | IN-1 (produces `area_planning.json`) |
| **Tag** | Claude Code |

### CF-2 Kaavat & hankkeet: toggleable additive map overlay with status-colored sourced popups + coverage honesty

| | |
|---|---|
| **What** | The on-map interactive centerpiece, built as an **additive overlay** modeled on the CF-5 isochrone effect (`Map.tsx:748-782`), **not** a `LAYERS` choropleth entry (LAYERS is single-active, so the overlay must coexist with income/price/safety). New `src/hooks/usePlanningData.ts` is a slim sibling of `useGridData.ts`: reads `planning_manifest.json`, lazy-fetches the active region's projects + plans shards (whole-file fallback, LRU cache, silent error → empty FeatureCollection), returns one merged FeatureCollection. A new `Map.tsx` effect cloned from the isochrone effect (gate on `mapStyleLoadedRef.current` with `apply()`/`map.on('load',apply)` fallback + `off` cleanup) adds one `planning` source plus: a fill for plan polygons colored by **plan status** (`vireillä`/`luonnos`/`ehdotus`/`hyväksytty`/`voimassa`), a line outline, and a circle/symbol layer for project points/lines colored by type (road/rail/waterway), all inserted `beforeId=HIGHLIGHT_LAYER` (same fallback as the isochrone). Click → MapLibre popup with `{name, status, date}` + an outbound `rel="noopener"` source link. **Critical:** unlike the grid fill (`buildGridFillOpacity`, no match expression — so filter/wizard dimming is defeated over it, see PO-4), the planning fill must honor the active filter/wizard dimming. State threads from `App.tsx` as a boolean toggle (mirroring `isochronePolygon`) and into `useUrlState.ts` as a shareable flag alongside `iso`. New `src/components/PlanningControls.tsx` (cloned from `IsochroneControls.tsx`, `aria-pressed` toggles, projects/plans type filters) shows a partial-coverage caption + a status/type swatch legend when the active region has no plan shard. `SplitMapView.tsx` gets the same overlay for parity (it has no isochrone overlay today — follow its grid-effect structure). |
| **Why** | The distinctive visual identity of the centerpiece — the first Finnish consumer map to show **what is planned/built near an area while keeping any choropleth active**. Popups deliver named+dated+sourced entities; the toggle makes it shareable via URL; the legend/caption keep partial coverage honest. **~2.4–2.8 KB gz** of bundled app JS (hook ~0.6, Map overlay+popup+filter-aware fill ~0.9, controls+legend ~0.5, App/URL ~0.2, SplitMapView ~0.3, `fi.json` labels ~0.3; en/sv free). Requires raising `BUDGET` (or riding Batch 1's freed ~4 KB — measure). All **data** stays zero-bundle (static shards + manifest, exactly like grids). |
| **Touches** | `src/hooks/usePlanningData.ts`, `src/components/Map.tsx`, `src/components/SplitMapView.tsx`, `src/components/PlanningControls.tsx`, `src/components/Legend.tsx`, `src/App.tsx`, `src/hooks/useUrlState.ts`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Complexity** | Large |
| **Dependencies** | IN-1 (shards + `planning_manifest.json`) |
| **Tag** | Claude Code |

### CF-3 Kaavat & hankkeet: accessible, mobile-reachable planning list in `NeighborhoodPanel`

| | |
|---|---|
| **What** | Surface the centerpiece interactively for the selected area without bloating first paint. Add a thin hook (sibling to the `useGridData.ts` lazy-fetch + LRU pattern) that fetches the active region's planning shard on demand, and render a read-only "Kaavat & hankkeet lähistöllä" section in `NeighborhoodPanel` by reusing the CF-4 next-steps outbound-link host markup/styling (1982-2010; `rel="noopener noreferrer"`, same null-on-empty contract), gated on `!d._isMetroArea`. Each entry's accessible name announces name+status+date with a **non-color-only** status badge; a coverage caption uses the low-data gray treatment stating scope honestly. On mobile it must be reachable: add it as a dedicated **fifth carousel section** by extending `MOBILE_SECTIONS` (959-964; feeds `useSwipeNavigation` `sectionCount`) with a 44px min tap target, coordinating with the WAI-ARIA carousel work (CF-7). Returns null when the area has no entries. Data stays a free static per-region shard fetched on demand and is kept **out of** `region_properties.json` feature props so it never inflates the ~10.6 MB deferred national fetch. |
| **Why** | Gives interactive (JS-on) visitors parity with the prerendered profiles so the centerpiece is a usable in-app decision surface, not only crawler-facing and not only discoverable by hunting the map overlay. ~1.0–1.5 KB gz (lazy hook + JSX + 2 `fi.json` heading keys; en/sv free) — shares the batch `BUDGET` raise. Degrades to nothing when a region shard is empty/absent. |
| **Touches** | `src/hooks/usePlanningData.ts`, `src/components/NeighborhoodPanel.tsx`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Complexity** | Medium |
| **Dependencies** | IN-1; coordinate with CF-2 (shared `usePlanningData.ts`) and CF-7 (mobile carousel) |
| **Tag** | Claude Code |

### CF-4 Kaavat & hankkeet: indexable `/kaavoitus/{kunta}/` planning hub page family + region-hub cross-links

| | |
|---|---|
| **What** | Turn planning data into a dedicated crawl/PageRank hub layer at zero bundle cost. In `prerender-hubs.mjs`, following the ranking page-family precedent (`buildRankingPage`/`rankPath`/`rankAlternates`, all on the self-contained `htmlPage()` helper at 263), emit for each municipality that has any `area_planning.json` content a trilingual trio: `/kaavoitus/{kunta-slug}/` (fi), `/en/planning/{slug}/`, `/sv/planlaggning/{slug}/`. Group postal codes by the per-feature `municipality`/`kunta` properties (present on all 3,018 features). Each page is a crawlable list of that municipality's in-progress plans + major Väylä projects, each row linking **out** to the city kaavoituskatsaus / Väylä hanke source and **in** to the affected `/alue/{slug}/` profiles, with `CollectionPage` + `ItemList` JSON-LD. Add a "Kaavoitus ja hankkeet" cross-link row to each region hub (model on `buildBestAreasNav`, insert in `buildCityHub`). Register the new URLs in `generate-sitemap.mjs` via a `dist/kaavoitus-pages.json` alternates manifest consumed exactly like the existing `ranking-pages.json` block (single source of truth). All copy inline FI/EN/SV (no locale keys). Only municipalities with real content get a page. |
| **Why** | Creates a municipality-level planning hub that ranks for "kaavoitus {kaupunki}" / planning queries and funnels link equity into the ~9,000 localized profile pages — the cheapest indexable-surface expansion given the near-zero JS headroom. 0 bytes (pure build-time HTML reusing the standalone `htmlPage()` renderer). |
| **Touches** | `scripts/prerender-hubs.mjs`, `scripts/generate-sitemap.mjs` |
| **Complexity** | Medium |
| **Dependencies** | CF-1 (produces `area_planning.json`) |
| **Tag** | Claude Code |

### CF-5 Kaavoitus- ja hankeaktiivisuus: neutral planning/development-activity choropleth + opt-in `defaultWeight:0` QI factor

| | |
|---|---|
| **What** | From the same intersection pipeline, derive a per-postal `active_plan_count` (distinct `vireillä`/`ehdotus` plan polygons **and** Väylä infrastructure features intersecting the postal polygon) as the primary, geometry-type-agnostic metric, optionally also `planned_area_pct` (polygon plans only). Write into the GeoJSON in `prepare_data.py`, then `build:data`. Register a **neutral** informational `LAYERS` choropleth (`higherIsBetter` omitted — active development is a preference, not good/bad; `property_price`/`foreign_language_pct` are existing neutral precedents) via the 7-step add-a-layer flow. **Critical:** `is_proxy:false` (real geometry, sub-postal) — do **not** add to `MUNICIPALITY_DISTRIBUTED_PROXIES`; add a value-range entry + an explicit non-proxy assertion to `validate_data.py`. Gray fallback + "osallistuvat kaupungit; väylähankkeet koko Suomi; tilanne &lt;snapshot&gt;" caption. Optionally wire as a single-direction `defaultWeight:0` descriptive factor in the housing dimension so it never moves published scores but exposes an opt-in "I value an up-and-coming area" weight. Distinct from backward-looking `new_construction_pct` (Paavo dwelling stock) and `avg_construction_year`. |
| **Why** | Lets a buyer scan a whole region at a glance for where change is concentrated — some want an up-and-coming densifying area, others a settled neighbourhood that won't be a construction site for a decade; today the map answers neither. Fills the space between per-area text and manual overlay inspection. ~300–400 B gz (LayerConfig + `fi.json` label) → small `BUDGET` bump; per-area counts ride existing per-region TopoJSON at zero JS cost. Coverage honestly partial. |
| **Touches** | `scripts/prepare_data.py`, `public/data/metro_neighborhoods.geojson`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/utils/qualityIndex.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/validate_data.py`, `scripts/check-bundle-size.mjs`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | IN-1; rebases on QW-2/PO-5 (`qualityIndex.ts`) |
| **Tag** | Claude Code |

### CF-6 Population-projection (väestöennuste) layer — is this area growing or shrinking?

| | |
|---|---|
| **What** | A forward-looking projected-population-growth-% diverging choropleth (centered at 0%) from Tilastokeskus StatFin Väestöennuste 2024 (database `vaenn`, CC BY 4.0). Verified live: table `statfin_vaenn_pxt_14wx` publishes projected total population per municipality per year 2024–2045 (published 24.10.2024). New `scripts/fetch_population_projection.py` fetches projected population per kunta, computes growth % over a fixed window (e.g. 2024→2040), assigns each postal code its municipality value via the existing `kunta`/`municipality` join keys — flagged `is_proxy:true` + added to `MUNICIPALITY_DISTRIBUTED_PROXIES` (crime/health precedent). Write to GeoJSON; `build:data`. Register a LayerConfig reusing the `divergingCenter:0` palette of `population_change`, add `LAYER_GROUPS`/metrics/RANGE_CHECK/labels ×3, registry + provenance rows under the registered `tilastokeskus` publisher (granularity `postal`, crime precedent). Bump `BUDGET` ~+1 KB. Genuinely distinct from the historical `population_change_pct` (backward-looking, real postal, `is_proxy:false`). |
| **Why** | One of a buyer's quietest, most consequential fears is committing a 30-year mortgage to an area the country is leaving — declining municipalities mean closing schools, thinning services, soft resale. The historical layer shows where people *were* going; the official projection shows where they're *expected* to go. Pairs thematically with the centerpiece ("where Finland is growing"). ~300–400 B gz → small `BUDGET` raise (CF-19/20/21 precedent); fetcher/GeoJSON/`src/data` are zero-bundle. Honestly `is_proxy:true`. |
| **Touches** | `scripts/fetch_population_projection.py`, `scripts/prepare_data.py`, `scripts/validate_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `public/data/metro_neighborhoods.geojson`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-7 Complete the WAI-ARIA Tabs pattern for the mobile section carousel

| | |
|---|---|
| **What** | PO-3 (prior roadmap) shipped the swipe carousel plus a partial tablist (`role=tablist/tab/aria-selected` at `NeighborhoodPanel.tsx:2177-2192`) and stopped there. Complete the APG Tabs pattern: (1) `ArrowLeft`/`ArrowRight`/`Home`/`End` keydown on the tablist with roving tabindex (active tab `tabindex=0`, others `-1`) that moves DOM focus and calls the already-exposed `setActiveSection` — no hook change; (2) stable ids wiring tab↔pane via `aria-controls`/`aria-labelledby`; (3) `role=tabpanel` on each pane and make the three inactive, off-screen panes **non-focusable** — set `inert` (or `aria-hidden=true` + `tabindex=-1`) so SR/keyboard users cannot Tab into the CSV/PDF/GeoJSON export buttons rendered into every pane (`{section && exportButtons}` at 2235) or the off-screen explore/similar links (translated to `translateX(-100%..-300%)`, clipped only visually). Panes map `MOBILE_SECTIONS`, so the pattern scales automatically to CF-3's fifth section. No new locale keys. |
| **Why** | Keyboard-only and SR users on the most-used mobile surface cannot move between sections with arrow keys (the canonical tabs interaction), and Tab focus lands on invisible off-screen export buttons/links — confusing SR users and yanking the carousel mid-read. The largest remaining a11y parity gap after the prior roadmap. ~250–400 B gz (keydown + id/aria/inert plumbing) — likely a small `BUDGET` raise or land alongside a JS-saving item. |
| **Touches** | `src/components/NeighborhoodPanel.tsx` |
| **Complexity** | Medium |
| **Dependencies** | None (interacts with CF-3's fifth section — sequence CF-3 → CF-7) |
| **Tag** | Claude Code |

### CF-8 CSV export for the in-app `RankingTable` & `CorrelationExplorer` + a deep link for the ranking view

| | |
|---|---|
| **What** | CF-12 (prior roadmap) shipped prerendered ranking **pages**, but the live in-app tools take nothing with you: `RankingTable.tsx` has only sort-toggle + close; `CorrelationExplorer.tsx:329-355` is PNG-only. Add: (1) a "Lataa CSV" download to both — the ranked list (rank, name, pno, value) and the scatter's two-metric XY pairs with name+pno — as two small `exportRankingCsv()`/`exportCorrelationCsv()` in `export.ts` reusing the module-private `escapeCsvField` + `downloadBlob` + UTF-8 BOM (mirroring `exportComparisonCsv`), so no helper is duplicated or made public; (2) a "Kopioi jakolinkki" copy-link on `RankingTable` reproducing the current choropleth via the exported `buildFullViewUrl(layer + city + scope)` — `App.tsx` must pass city/scope to `RankingTable`, which it does not currently receive. **Out of scope (corrected):** the scatter's `metricX/metricY` are not representable in the current URL/embed codec (single `layer` only), so ship CSV for the scatter, copy-link only for the ranking. Reuse existing `export.csv` and `share.link` keys; at most one new "copied" toast key. |
| **Why** | The two live analysis tools offer no way to take their data with you, while every other panel does. A ranked CSV and a reproducible deep link turn an ephemeral on-screen view into citable, reproducible output for the journalist/researcher lens the product courts. ~150–300 B gz (two tiny CSV builders + two buttons + clipboard handler; `fi.json` ~0 — keys exist). If the measured delta exceeds headroom, bump `BUDGET`. |
| **Touches** | `src/components/RankingTable.tsx`, `src/components/CorrelationExplorer.tsx`, `src/utils/export.ts`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-10 Open-data program expansion: latent Paavo columns + planning dataset + schema.org Dataset JSON-LD (Google Dataset Search)

| | |
|---|---|
| **What** | Three zero-bundle additions to `build_open_data.mjs` (runs in the `build:pages` chain). (1) The `METRIC_COLUMNS` filter at 108 emits only the ~60 registry-labelled metrics, so the latent Paavo fields CF-13 already renders on every profile (full age pyramid, 21 NACE `tp_*` sectors, disposable income `tr_mtu`/`tr_ktu`, income-class mix, living space `te_as_valj`) are **excluded** from `naapurustot_areas.csv`, codebook and `/api/v1` — contradicting the "full dataset" claim. Add a build-only `LATENT_METRIC_INFO` map (FI/EN labels + units + **inline** Paavo source/vintage, like the existing build-only `METRIC_INFO`), relax the filter to include latent fields when present, make `codebookEntry` fall back to it, and apply the Paavo `-1` confidentiality guard (write `''` for values < 0). Keep all provenance **inline** — do **not** add columns to `data_sources.json` (statically bundled via `metrics.ts:4`). (2) [gated on IN-1] Emit the planning dataset: `naapurustot_kaavat_hankkeet.csv` (long format `pno,region,type,status,name,date,source_url,is_proxy`), a `planning[]` array in `/api/v1/areas/{pno}.json`, codebook rows, a landing block, and a "Kaavat ja hankkeet" section in `generate-llms.mjs` describing scope + the 2029 Ryhti backstop. (3) Add a schema.org `Dataset` JSON-LD block to `/avoin-data` with `DataDownload` distribution entries (CSV files + frozen `/api/v1`), license, spatial/temporal coverage — the homepage Dataset block has no distributions today, so the corpus is currently ineligible for Google Dataset Search. |
| **Why** | For the research/AI-assistant audience the headline promise is the full, raw, citable dataset, but only ~60 of `region_properties.json`'s 183 columns are emitted — the latent fields CF-13 prints as text cannot be downloaded, so the "full dataset" claim is literally false for them. Sub-feature (2) gives the planning corpus a bulk surface; sub-feature (3) opens the high-authority Google Dataset Search channel. 0 bytes (build-time CSV/JSON/HTML; provenance kept inline). |
| **Touches** | `scripts/build_open_data.mjs`, `scripts/generate-llms.mjs`, `public/llms-full.txt`, `src/data/region_properties.json`, `README.md` |
| **Complexity** | Medium |
| **Dependencies** | IN-1 (sub-feature 2 only); sub-features 1 & 3 independently shippable |
| **Tag** | Claude Code |

### CF-11 National construction-FLOW choropleth (StatFin building permits / completed dwellings per 1,000), `is_proxy:true`

| | |
|---|---|
| **What** | A forward-flow "rakentamisen vilkkaus / construction activity" choropleth giving **every** area in Finland a real building-activity signal — the national counterpart to CF-5, whose plan-polygon + Väylä `active_plan_count` resolves to ~0 across most of the country (no city WFS, no Väylä corridor nearby), leaving rural/mid-size-town users with a misleading "nothing happening" reading. New `scripts/fetch_construction_permits.py` pulls granted building permits or completed-dwelling floor area per municipality (trailing 12 months) from StatFin "Rakennus- ja asuntotuotanto" (`ras`, table family `statfin_ras_pxt_*`, CC BY 4.0, municipal), normalizes to a per-1,000-resident FLOW rate, assigns each postal code its municipality value via the `kunta` join keys — flagged `is_proxy:true` + added to `MUNICIPALITY_DISTRIBUTED_PROXIES`. Write to GeoJSON; `build:data`. Register a sequential LayerConfig (`higherIsBetter` omitted, neutral like CF-5), `LAYER_GROUPS`/metrics/RANGE_CHECK/labels ×3, registry + provenance under `tilastokeskus`. Distinct from `new_construction_pct` (Paavo STOCK), `avg_construction_year`, and CF-5 `active_plan_count` (PLANNED, participating-cities + sparse Väylä). |
| **Why** | Completes the centerpiece's "where is Finland actually building right now" at **national** granularity, correcting the misleading near-zero CF-5 reading outside the ~15 WFS cities. Together with `population_change_pct` (historical), CF-6 (future demand) and CF-5 (planned), it forms the full where-is-this-area-headed picture a 30-year-mortgage buyer needs. ~300–400 B gz → small `BUDGET` bump; fetcher/GeoJSON/`src/data` zero-bundle. Honestly `is_proxy:true` (StatFin publishes only municipal; the finer postal STOCK signal is already `new_construction_pct`). |
| **Touches** | `scripts/fetch_construction_permits.py`, `scripts/prepare_data.py`, `scripts/validate_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `public/data/metro_neighborhoods.geojson`, `src/locales/{fi,en,sv}.json`, `scripts/check-bundle-size.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 Comparison honesty: neutral price direction on the share card + main panel, and a direction-aware comparison bar chart

| | |
|---|---|
| **What** | QW-3 (prior roadmap) shipped neutral price direction only in the comparison **table** (`comparisonStats.ts:59/85/96`). Three trust defects remain on the decide surface. (1) The PNG **share card** hardcodes `property_price_sqm` `higherIsBetter:true` (`scoreCard.ts:44`); `isGood = higherIsBetter ? diff>0 : diff<0` (91) → a pricier-than-metro area's delta renders **green** as if it won. Give it a null/neutral direction in the card's `METRICS` array and treat null as gray with no +/− judgment. (2) The main panel price `StatRow` (`NeighborhoodPanel.tsx:1522`) calls `diffColor` with no direction arg, and `formatting.ts:118` defaults `higherIsBetter=true`, so a higher-than-average price colors emerald — extend `diffColor` to accept `higherIsBetter` of `boolean` or `null` (null → neutral) and pass null for price (mirroring crime/air/traffic rows that pass false). (3) The comparison **bar chart** defines `higherIsBetter` on every `CHART_METRICS` entry (`ComparisonPanel.tsx:79-85`) but never reads it (colors by per-area index only), so a longer crime/unemployment bar reads as "more" with no "worse" cue — thread the parent's existing `bestByKey` precompute (161) into `ComparisonChart` to badge the best-direction bar with the table's emerald cue, and add a "pienempi parempi / lower is better" caption (1 new bundled `fi.json` key) on the inverted metrics. |
| **Why** | A household's deepest-compare step is shortlisting finalists and sharing the card with a partner/agent, and right now the shareable PNG, the primary panel, and the in-app chart all imply the most expensive (and, for crime/unemployment, the worst) area is the winner — contradicting QW-3's table fix and the data-honesty brand. The share card is the artifact that travels outside the app. ~250–450 B gz (mostly the chart cue + 1 caption key); measure with `bundle:check`, small raise if needed. |
| **Touches** | `src/utils/scoreCard.ts`, `src/components/ComparisonPanel.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/utils/formatting.ts`, `src/locales/{fi,en,sv}.json`, `src/__tests__/{scoreCard,comparisonPanel}.test.*` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Localize the skip-to-content link (hardcoded Finnish breaks EN/SV SR users)

| | |
|---|---|
| **What** | `index.html:336` hardcodes `<a class="skip-link" href="#main" lang="fi">Siirry sisältöön</a>`. The app sets `documentElement.lang` on every locale change (`App.tsx:1679-1681`) but the skip link keeps Finnish text and an explicit `lang="fi"` override, so EN/SV SR users hear the Finnish phrase in a Finnish voice on the very first focusable element. Add `aria.skip_to_content` (the codebase uses the `aria.*` prefix; no skip key exists today) to all three locales. Fix on two surfaces: **(a) build-time, 0 bytes** — in `prerender.mjs` (which already clones `index.html` and `replace`s `<html lang="fi">`) add an analogous replace rewriting the cloned skip-link text + lang per page language (~9,000 pages); `prerender-hubs.mjs` builds HTML from scratch with **no** skip link today, so add a localized one before `<main>` (parity). **(b) client, ~100–150 B gz** — in the same `App.tsx` lang effect, query the skip link (outside `#root`) and set `textContent` + `lang`. Optionally extract a tiny shared helper for the standalone pages that also set lang. |
| **Why** | Clear a11y parity defect (mirrors UX_REVIEW AY-6, documented but never shipped) for non-Finnish assistive-tech users on the first focusable element of every page. The build-time half is 0 bytes and covers ~9,000 pages; the client half (~100–150 B gz) fits the ~0.5 KB headroom without raising `BUDGET`. |
| **Touches** | `index.html`, `src/App.tsx`, `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Screen-reader feedback parity: silent toasts + unannounced filter/wizard result counts

| | |
|---|---|
| **What** | Two feedback-parity fixes reusing existing surfaces. (1) Add `role="status"` (aria-live=polite) to the two silent transient toasts in `NeighborhoodPanel.tsx`: the "copied" clipboard toast (2244-2249) and the compare-cap `pinToast` (2253-2259). The sibling `imgError` toast (2262-2268) already has `role="status"` — the correct template. (2) Push an "N areas match" / "N areas highlighted" string to the **existing** global ARIA live region (`App.tsx:2703-2705`, fed by `setAriaAnnouncement`) whenever the percentile-filter match set (`filterMatchPnos`, count shown visually only in `FilterPanel`) or the wizard highlight set (`wizardResultPnos`, count shown visually only in a chip) changes, via a small `useEffect` keyed on the set lengths. No new live region. |
| **Why** | A screen-reader user gets no spoken confirmation of "copied" or "limit reached", and no spoken result count when a filter or the discovery wizard narrows 3,018 areas — the chip count is purely visual. Reuses the one existing global live region. ~150–250 B gz + one `fi.json` key; fits the ~0.5 KB headroom without a raise — measure. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-4 Honest feedback when a percentile filter or wizard highlight is active over a grid layer

| | |
|---|---|
| **What** | `Map.tsx`'s fill-opacity effect (884-913) only applies "dim non-matching" to `FILL_LAYER` (the postal choropleth, match on `['get','pno']`). When the active layer is one of the three sub-postal grids (air_quality, light_pollution, transit_reachability), the grid branch fades `FILL_LAYER` out and paints grid cells via `buildGridFillOpacity` (`gridFade.ts:43-49`), **neither carrying a match expression** — so an active filter/wizard highlight produces **no visible dimming** over grids, silently misleading the user. Grid cells aren't keyed by pno, so the honest fix is feedback, not faked dimming: (a) dim the whole grid layer uniformly while a filter/wizard set is active so it doesn't read as "unfiltered", and (b) surface a small `role=status` caption in `Legend.tsx` (mirroring the existing `grid.loading`/`subregionEstimate` caption hosts) reading "Suodatin ei koske ruutuaineistoa" / "Filter does not apply to grid data", driven by a new boolean prop set in `App.tsx` from the in-scope `filterActive` + `wizardResultPnos` when `hasGridData(activeLayer)`. Apply the same rule in the layer-switch transition effect (994-997) and to any future planning overlay. |
| **Why** | Edge-case feedback defect: the percentile filter and wizard are decision-critical tools, yet on the three sub-postal grids the product is proudest of, their core visual affordance disappears with no explanation — the map reads as if nothing is filtered. Restores honest feedback for free (no new data). ~150–300 B gz + 1 `fi.json` key; fits the ~0.5 KB headroom only if kept minimal (single neutral caption, opacity multiplier rather than a new expression) — otherwise fold into a batch raising `BUDGET`. |
| **Touches** | `src/components/Map.tsx`, `src/components/Legend.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Quality-Index honesty: fix the "Balanced = 20 each" doc drift and make `equalDimensionWeights` sum to exactly 100

| | |
|---|---|
| **What** | Two methodology-honesty defects in a product whose brand **is** transparent methodology. (1) `QUALITY_INDEX.md:101` claims the Balanced persona weights "Every evaluative dimension weighted *exactly equally* (20 each)", but `equalDimensionWeights()` (`qualityIndex.ts:1011-1027`) targets `Math.round(100 / evaluativeDims)` = **25** each across four evaluative dimensions — the "20" is stale from the retired six-dimension model that the code comment itself flags as wrong. Update the doc to ~25 each. (2) The "exactly equally" claim is also imperfect: per-factor `Math.round` lets a dimension re-total to 24 or 26 and the four sum to ≠100 (e.g. 25/25/26/26 = 102). Either soften the doc to "~25 each" **or** (preferred) replace per-factor `Math.round` with a largest-remainder allocation so each evaluative dimension totals exactly 25 and the four sum to exactly 100, making the claim literally true; add a `qualityIndex.test.ts` assertion. (3) Fix the stale "green space" reference in the "Nature & quiet" persona row (`QUALITY_INDEX.md:106`) — the green-space layer was removed for `tree_canopy` (matches QW-7). |
| **Why** | The methodology doc states a number (20) the engine doesn't use and an exactness claim the rounding violates — a small but concrete credibility leak on the single document that justifies the headline scores to researchers and skeptics. Doc edits + green-space fix are 0 bytes; the optional largest-remainder rounding is ~100–200 B gz — fits the headroom standalone, ride a batch raise to be safe. Making the code match the claim is cheaper to trust than caveating it. |
| **Touches** | `docs/QUALITY_INDEX.md`, `src/utils/qualityIndex.ts`, `src/__tests__/qualityIndex.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Kaavat & hankkeet data pipeline: Väylä national projects + city WFS plans → per-area list, geometry shards, manifest

| | |
|---|---|
| **What** | Build-time data backbone for the centerpiece, **zero client JS**. New `scripts/fetch_vayla_projects.py` pulls national projects from the Väylävirasto OGC API Features endpoint (`avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1/`, EPSG:3067, CC BY 4.0; verified collections `hanketiedot:tiehankkeet`, `:ratahankkeet`, `:ratasuunnitelmat`, `:paattyneet_hankkeet` — enumerate `/collections` at fetch time; read `/queryables` + `DescribeFeatureType` first to pin real status/name/schedule field names), normalizing to `{name,type,subtype,status,date,source_url}`. New `scripts/fetch_city_zoning.py` adds per-city `vireillä` asemakaava polygons from confirmed feeds — Helsinki (`kartta.hel.fi/ws/geoserver/avoindata/wfs`, `Kaavahakemisto_alue_kaava_vireilla`, EPSG:3879 — verified), Espoo (`kartat.espoo.fi` Tekla `GIS:Kaavoitushankkeet`), Tampere (`geodata.tampere.fi` GeoServer GeoJSON), Vantaa/Turku/Jyväskylä where a feed exists — each pinning layer names via GetCapabilities, reprojecting to EPSG:3067, mapping statuses onto the Ryhti lifecycle (`vireillä→ehdotus→hyväksytty→lainvoimainen→kumottu`) so adapters can later collapse into one Ryhti fetcher. New `scripts/build_planning_data.mjs` mirrors `build_grid_data.mjs` sharding: shapely-intersects each postal polygon (municipality + WGS84 centroid already baked into `region_properties.json` by the shipped CF-4) to emit (a) a compact per-pno named list to `scripts/area_planning.json` (build input read at prerender, never shipped — same pattern as `scripts/flood_risk.json`; if placed under `public/data/`, add to the `vite.config.ts` `stripBuildOnlyData()` plugin) and (b) per-seutukunta geometry shards `public/data/planning_{projects,plans}_shards/*.geojson` + `src/data/planning_manifest.json` carrying per-region presence, a scope flag (`projects:'national'`, `plans:'partial'`) and the snapshot build date. **Do not** register planning under `data_sources.json` `metrics` (it is geometry/lists, not a numeric choropleth — would trip `validate_data.py::check_provenance_vintage_match`); register only the new city + SYKE/Ryhti **publishers**, and record the planning snapshot vintage in `planning_manifest.json`, not `provenance.json`. Real geometry, never proxied (`is_proxy` N/A). Delete/repurpose the dead `scripts/fetch_grid_data.py` placeholder. Wire both fetchers + the builder into `build:data` and the quarterly refresh. |
| **Why** | The product has nothing about what is planned/built near an area, and no Finnish consumer service combines neighbourhood stats with nearby plans/projects. The Väylä half is genuinely **national today** so every area gets real content immediately; the city half is honest partial coverage. One pipeline emitting **both** a per-pno list and geometry shards gives all downstream surfaces (CF-1/2/3/4/5/10, IN-8) one source of truth. 0 bytes of app JS (fetchers/builder are build-time; the per-pno list is a build input never shipped; shards are lazy fetch assets like the grids; the manifest is generated). |
| **Touches** | `scripts/fetch_vayla_projects.py`, `scripts/fetch_city_zoning.py`, `scripts/build_planning_data.mjs`, `scripts/area_planning.json`, `public/data/planning_projects_shards/`, `public/data/planning_plans_shards/`, `src/data/planning_manifest.json`, `src/data/data_sources.json`, `vite.config.ts`, `package.json`, `scripts/fetch_grid_data.py` |
| **Complexity** | Large |
| **Dependencies** | None (critical path for CF-1/2/3/5, CF-10 sub-2, IN-8) |
| **Tag** | Claude Code |

### IN-2 Extend the IN-6 head-integrity guard to `prerender-hubs.mjs` (~10,500 hub, ranking, directory, EN/SV landing pages)

| | |
|---|---|
| **What** | The pure `assertHeadIntegrity` from `prerender-lib.mjs` is asserted on every profile/route page in `prerender.mjs` (1548/1554/1560/1605/1615) but `prerender-hubs.mjs` — which writes **all** hub, ranking, directory and EN/SV landing pages — never imports or calls it. Every hub family flows through one assembler, `htmlPage()` (263-339; raw-interpolates `jsonLd`, title/canonical/og:url): `buildDirectory`, `buildLanding`, `buildCityHub`, `buildRankingPage`. Add `import { assertHeadIntegrity } from './prerender-lib.mjs'` and call it once near the end of `htmlPage()` on the assembled string (no expect-flags — hubs have neither FAQPage nor a profile payload), asserting singleton `<title>`/`</head>`/canonical, at-most-one og:url, a complete (non-lonely) hreflang cluster, and parseable JSON-LD. Add fixture tests under `src/__tests__/` (extend `prerenderOutput.test.ts`) covering a well-formed hub passing and a duplicated-token/lonely-hreflang hub throwing. |
| **Why** | These hub/ranking/directory pages are the citable, rich-results surface the centerpiece planning hubs (CF-4) hang off and rank for, yet they are the one large prerendered surface IN-6 skipped — the guard runs on ~9,000 profiles but never on these ~10,500 pages. Region names, metric titles and breadcrumb labels are interpolated into the head/title; the assertion catches template regressions loudly at build time instead of silently corrupting thousands of pages — exactly the failure mode CLAUDE.md documents. 0 bytes (build/test only). |
| **Touches** | `scripts/prerender-hubs.mjs`, `src/__tests__/prerenderOutput.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Range-check the four un-validated post-roadmap layers in `validate_data.py`

| | |
|---|---|
| **What** | Extend `RANGE_CHECKS` (`validate_data.py:81-110`) to cover the four live layers that shipped after the list was last extended and are currently **not** value-range-validated: `radon` (Bq/m³, ~0–3000; 300 = STUK action level), `health_index` (~0–300, 100 = national average), `flood_risk_pct` (0–100 — also **missing from `PERCENTAGE_FIELDS`** at 66-79, so add it there), and `rental_price_sqm` (~3–80 €/m²/month). All four pass un-bounded today, so an upstream unit/scale change (radon Bq vs pCi, rents flipped to €/month, morbidity rebasing, a SYKE share given as 0–1 vs 0–100) would reach the public choropleth silently. Optionally pre-register the planning fields (`active_plan_count` ≥ 0, `planned_area_pct` 0–100) — `check_value_ranges` skips absent properties, so they're inert until the data lands. **Do not** re-add a coverage-regression diff — `check_coverage_regression` (451-476) already ships. Re-run the validator against the committed GeoJSON to confirm nothing falls outside the new bounds. |
| **Why** | Closes a real honesty gap: four publicly displayed layers bypass all value-range validation, so an upstream unit/scale change would silently produce a wrong-by-orders-of-magnitude public choropleth that the quarterly refresh would merge unflagged. The coverage-regression guard the original candidate also asked for already exists, so this narrows to the genuinely-missing piece. 0 bytes (Python/CI only). |
| **Touches** | `scripts/validate_data.py` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-5 Sync backend hardening: migration advisory lock, per-user rate limit, first route-level integration tests

| | |
|---|---|
| **What** | Three server-only robustness fixes (zero client bytes). (1) Wrap the IN-3-era forward-only migration runner (`server/api/src/db.ts:29-54`, no lock today) in a Postgres session advisory lock (`pg_advisory_xact_lock` around the migrations loop). The API runs as a single `docker compose` service with `restart: unless-stopped`; a crash-loop relaunch (or future multi-replica) can start a second instance mid-migration — both pass the `schema_migrations` check, then the second's `INSERT` hits the PK (23505), rolls back, and crashes startup. It self-heals today only because the single migration is idempotent; the next non-idempotent one could half-apply. (2) Add a second fixed-window bucket keyed on the **authenticated userId** for the write routes + `GET /auth/export`, generalizing `rateLimit.ts` (it currently keys only on client IP). IN-4 shipped a per-IP limiter even though its spec called for per-user — so on shared NAT/CGNAT all users share one bucket (false throttling) while an authenticated abuser rotating IPs is unbounded per account. (3) Add the **first** route-level integration tests — `auth.test.ts` exercises only pure helpers, so the credentialed GET/PUT round-trips, the 413 body-limit dispatch, the `sameOriginOnly` CSRF 403 and the rate-limit 429 have zero coverage; add a pg-mem (preferred over testcontainers — no Docker in CI) suite. |
| **Why** | The sync backend is the fragile, internet-facing credentialed surface future sync work builds on; it runs in CI via the IN-2-era build+test lane but still has unprotected gaps. The advisory lock de-risks every future schema change; the per-user limiter closes the CGNAT false-throttle / IP-rotation abuse gap IN-4 was specced to close but shipped per-IP; the first route tests cover the auth/sync/GDPR/413/CSRF/429 paths that today have zero assertions. 0 client bundle bytes (server + test only; the dev dependency is never shipped). |
| **Touches** | `server/api/src/db.ts`, `server/api/src/rateLimit.ts`, `server/api/src/auth.ts`, `server/api/src/index.ts`, `server/api/src/auth.routes.test.ts`, `server/api/package.json` |
| **Complexity** | Medium |
| **Dependencies** | None (precedes IN-6's `auth.ts` edits) |
| **Tag** | Claude Code |

### IN-6 Finish sync conflict resolution: timestamp last-write-wins via `updated_at` + kill the save-on-login race

| | |
|---|---|
| **What** | Two sync-trust follow-ups the prior roadmap left undone (CF-6 shipped tombstones + longer-text-wins, not the `updated_at` LWW it also proposed; CF-7's save-on-login race fix was never built — CF-7 aborted on its gzip guard). (1) **Timestamp LWW:** all five user tables carry `updated_at` (`db.ts:67-98`) but no GET endpoint returns it (`auth.ts:387/439/493/633-637`), so the client merges on lossy heuristics — longer-text-wins for notes, "both custom → leave as-is" for weights/profile. Surface `updated_at` in the four GET responses (server SELECT + JSON only — 0 bundle bytes), widen the `api.ts` response types, and resolve diverged conflicts by comparing server `updated_at` against a client-stored per-store last-edit timestamp (per-item for notes) — last write wins. (2) **Kill the save-on-login race:** add a per-hook `loginMergePendingRef` set on the `userId` null→id transition and cleared when the on-login merge resolves, and make each debounced-save effect skip while it is set, so the local value is never pushed before the merge decides the winner — closing the `useQualityWeights` default-weights-on-login clobber (it has no `isCustom` gate) and the weights/profile/list clobber windows. `getPreferences` already dedups concurrent GETs, so no GET-collapse work is needed. |
| **Why** | The remaining ways a signed-in user silently loses/corrupts saved data across devices: notes merge by longer-text-wins (a shorter, newer edit loses), "both custom" weights/profile keep whichever copy a device happens to hold, and every `userId` transition can push the local value before the merge runs — `useQualityWeights` even pushes **default** weights on login, which the server `ON CONFLICT` overwrites custom weights with. Trust in persistence is a prerequisite for the account feature mattering. Server delta 0 bytes; client delta ~300–550 B gz — tight against ~0.5 KB headroom; measure, small raise justified if it exceeds (closes a real data-loss class). |
| **Touches** | `server/api/src/auth.ts`, `server/api/src/auth.test.ts`, `src/utils/api.ts`, `src/hooks/{useNotes,useQualityWeights,useWizardProfile,useFavorites,useShortlist}.ts`, `src/__tests__/{useNotes,useQualityWeights}.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | IN-5 (shares `auth.ts`) |
| **Tag** | Claude Code |

### IN-7 Split page-only `fi.json` strings (`sources.*`, privacy body) off the always-loaded i18n chunk

| | |
|---|---|
| **What** | `fi.json` is statically imported into the always-loaded i18n chunk (`i18n.ts:19`, full file 15,762 B gz). A measured subset is rendered **only** on lazy, prerendered routes and never by the core map: the 29 `sources.*` keys (`DataSourcesPage.tsx` + `prerender.mjs`) and the 16 privacy-policy body keys (`PrivacyPage.tsx`, excluding `privacy.link`). Move exactly those 45 keys into a new `src/locales/fi-extra.json` fetched as a lazy `?url` asset (mirroring en/sv), loaded on `/tietolahteet` and `/tietosuoja`. Keep the synchronous Finnish fallback intact for every key the core map uses. **Do not** move `metric_explanation.*`, `data.*` badges, `correlation.*`, or `privacy.link` — all render in the core map and would show raw key strings until the lazy fetch resolved. The two lazy page components must await `fi-extra` before first render so their hydrated output matches the prerendered HTML, and `prerender.mjs` must merge `fi-extra.json` into its LOCALES map. Update `i18nKeyParity.test.ts` to compare (`fi.json` ∪ `fi-extra.json`) against en/sv. |
| **Why** | The budget has ~0.5 KB headroom, blocking new UI. This reclaims a **measured ~1,995 B gz** off the always-loaded core chunk (full `fi.json` 15,762 → 13,767 B gz after the split); the moved strings cost 0 against the core budget once they ship as a lazy `?url` asset like en/sv — roughly 4–5× the durable headroom **without** a `BUDGET` raise. Honest scope note: this is a ~2 KB lever, not the ~16 KB the whole file represents — the larger groups (`metric_explanation`, `correlation`, `data.*`) cannot move because they render in the core map. Net app JS: ~−1,995 B gz. |
| **Touches** | `src/utils/i18n.ts`, `src/locales/fi.json`, `src/locales/fi-extra.json`, `src/main.tsx`, `src/pages/PrivacyPage.tsx`, `src/pages/DataSourcesPage.tsx`, `scripts/prerender.mjs`, `src/__tests__/i18nKeyParity.test.ts`, `src/__tests__/setup.ts` |
| **Complexity** | Medium |
| **Dependencies** | None (precedes QW-8, which must scan `fi.json` ∪ `fi-extra.json`) |
| **Tag** | Claude Code |

### IN-8 Planning-data integrity & freshness: per-city presence guard + Atom-feed entry on each kaava/hanke refresh

| | |
|---|---|
| **What** | Close the one integrity blind spot the centerpiece introduces. The existing coverage-regression guard `check_coverage_regression` (`validate_data.py:451-476`) iterates **only** registry-stored props against `data_baseline.json` — but IN-1 deliberately keeps planning **out** of the metrics registry, so the planning shards/lists get **zero** automated protection. The kaava feeds are also the most fragile inputs in the product: ~6–10 heterogeneous city WFS endpoints whose layer names drift and whose servers go down, all re-fetched unattended on the quarterly cron. A silent fetch failure drops a city's plans, the gray fallback masks it, and the "tilanne &lt;snapshot&gt;" caption keeps claiming freshness. (1) Add a planning presence baseline: record per-city plan/project counts into `planning_manifest.json` (or a sibling `planning_baseline.json`), and add a guard (in `build_planning_data.mjs` or a new `scripts/validate_planning.mjs` wired into the data-refresh validate stage) that **fails the build** when a city that had plans in the baseline now resolves to zero (the planning analog of `check_coverage_regression`), with a `--write-baseline` escape hatch. (2) On a successful planning refresh, append a "Kaavat ja hankkeet päivitetty" entry to `src/data/data_updates.json` so the PO-5-era Atom feed (`generate-feed.mjs` → `dist/data-updates.atom`) surfaces the new snapshot date — the recurring-visit hook CF-4 explicitly punted as out of scope. |
| **Why** | The centerpiece's only real honesty risk is staleness/silent coverage loss: plans change status weekly and the city feeds are the product's flakiest inputs, yet nothing fails the quarterly refresh when Helsinki or Tampere silently returns nothing. A presence guard makes a dropped feed a loud build failure instead of a thousand profiles quietly losing their "lähistöllä" section while still dated "today". The feed entry turns each refresh into a re-engagement signal for the research/journalist audience. 0 bytes (build/CI + a static JSON changelog). |
| **Touches** | `scripts/build_planning_data.mjs`, `scripts/validate_planning.mjs`, `src/data/planning_manifest.json`, `src/data/data_updates.json`, `.github/workflows/data-refresh.yml` |
| **Complexity** | Medium |
| **Dependencies** | IN-1 |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Each batch is internally parallel-safe for concurrent Claude Code sessions **with the serialization caveats noted**, and depends only on prior batches. **Global caveat for all batches:** auto-merge shares a concurrency group, so a second `claude/*` push cancels an in-flight merge — develop sessions in parallel but **stagger the pushes** (treat each intra-batch "merge order" as the push order), and re-run the i18n key-parity test after every locale edit. **`BUDGET` discipline:** exactly **one** designated item per batch may edit the `scripts/check-bundle-size.mjs` constant. Batch 1 front-loads the headroom-freeing items (QW-9 + IN-7 + QW-8) so the centerpiece UI and new data layers may often land **without** a raise — but every JS-touching item must still measure its gz delta with `bundle:check` before push.

**No item is Manual Setup** — all 31 are tagged Claude Code. Operational call-outs (not hand-blocking): IN-1 fetches ~6–10 heterogeneous external endpoints at **build time** (pin layer names via GetCapabilities/DescribeFeatureType; confirm CI/build network egress; any unavailable city feed ships as honest partial coverage); IN-5/IN-6 are server-side and deploy via the separate `deploy-server.yml` (docker compose) pipeline; IN-8 edits the quarterly `data-refresh.yml` cron — verify the new step locally first.

### Batch 1 — Foundation: planning data backbone + bundle headroom + build-time guards

Zero/negative app-JS — frees ~4 KB headroom for later UI, with no `BUDGET` contention.

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| IN-1 | Kaavat & hankkeet data pipeline (Väylä + city WFS → list, shards, manifest) | Infrastructure | Large | Claude Code |
| QW-9 | Remove vestigial affordability plumbing (frees ~1.5–2.5 KB) | Quick Win | Medium | Claude Code |
| IN-7 | Split page-only `fi.json` strings into lazy `fi-extra.json` (frees ~2 KB) | Infrastructure | Medium | Claude Code |
| QW-8 | Unused-`fi.json`-key audit + drift guard | Quick Win | Small | Claude Code |
| QW-7 | Drop orphaned `green_space_pct` column end-to-end | Quick Win | Small | Claude Code |
| IN-3 | Range-check the 4 un-validated layers | Infrastructure | Small | Claude Code |
| IN-2 | Head-integrity guard for `prerender-hubs.mjs` | Infrastructure | Small | Claude Code |

**Parallel-safety:** (1) IN-1 isolated — all-new files + sole editor of `data_sources.json`/`vite.config.ts`/`package.json`/`fetch_grid_data.py`. (2) QW-9 isolated — sole editor of `App.tsx`/`useUrlState.ts`/`NeighborhoodWizard.tsx`. (3) **IN-7 → QW-8** serialize on `fi.json` (IN-7 moves 45 keys to `fi-extra.json`; QW-8 then prunes orphans + adds the drift guard scanning `fi.json` ∪ `fi-extra.json`). (4) **QW-7 → IN-3** serialize on `validate_data.py`; QW-7 solely owns the GeoJSON regeneration here. (5) IN-2 isolated. Files recurring in later batches (`prerender.mjs`, `prerender-hubs.mjs`, `data_sources.json`, `validate_data.py`) are sole-owned here, so downstream batches simply rebase.

### Batch 2 — Planning centerpiece surfaces (consume IN-1) + planning integrity + isolated lanes

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-1 | Prerendered "Kaavoitus ja hankkeet lähistöllä" profile section + JSON-LD (ship first) | Core | Medium | Claude Code |
| CF-2 | Toggleable additive map overlay + status-colored sourced popups | Core | Large | Claude Code |
| CF-3 | Accessible, mobile-reachable planning list in `NeighborhoodPanel` | Core | Medium | Claude Code |
| IN-8 | Planning-data integrity & freshness (presence guard + feed entry) | Infrastructure | Medium | Claude Code |
| QW-3 | Expand the similarity-finder metric picker | Quick Win | Small | Claude Code |
| IN-5 | Sync backend hardening | Infrastructure | Medium | Claude Code |

**Parallel-safety:** all consume IN-1 (now on main). (1) CF-1 sole editor of `prerender.mjs` + `data_sources.json` this batch. (2) **CF-2 → CF-3** serialize on the new `usePlanningData.ts` + locales + `check-bundle-size.mjs`: CF-2 lands first as the authoritative overlay hook and sole owner of any `BUDGET` raise; CF-3 rebases, reusing the hook and adding the panel list + fifth mobile section. (3) IN-8 isolated — must **add** fields to `planning_manifest.json`, not restructure, to stay compatible with CF-2/CF-3's reader. (4) QW-3 isolated (`similarity.ts`). (5) IN-5 isolated (`server/api/*`; precedes IN-6 in Batch 5). **Budget:** Batch 1 freed ~4 KB, so CF-2+CF-3 (~3.7 KB) may fit with no raise — measure; if over, CF-2 owns the single raise.

### Batch 3 — Independent decision data layers (serial) + Quality-Index honesty (parallel track)

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-1 | Two latent-Paavo layers (disposable income + living space/person) | Quick Win | Medium | Claude Code |
| CF-6 | Population-projection (väestöennuste) diverging layer | Core | Medium | Claude Code |
| CF-11 | National construction-FLOW choropleth (StatFin permits/completions) | Core | Medium | Claude Code |
| QW-2 | Wire health/radon/flood into the QI as opt-in `defaultWeight:0` factors | Quick Win | Small | Claude Code |
| PO-5 | Quality-Index honesty: doc drift + `equalDimensionWeights` sums to 100 | Polish | Small | Claude Code |

**Parallel-safety:** two **fully disjoint** tracks. **Track A (data layers) QW-1 → CF-6 → CF-11 strictly serial** — all three edit `prepare_data.py`, the GeoJSON, `colorScales.ts`, `LayerSelector.tsx`, `metrics.ts`, the registries, `validate_data.py`, `check-bundle-size.mjs` and locales, and each runs `build:data` regenerating `region_properties.json`/`national_ranges.json`/`regions/*.topojson`; QW-1 (first) owns the single `BUDGET` raise. **Track B (Quality Index) QW-2 → PO-5 serial** on `qualityIndex.ts` + `QUALITY_INDEX.md` + `qualityIndex.test.ts`. Track B touches none of Track A's files → A and B run fully concurrently; Track B's `qualityIndex.ts` edits land before CF-5 (Batch 4) rebases on them.

### Batch 4 — Planning-derived surfaces: activity choropleth + `/kaavoitus/` hub family + open-data expansion

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-5 | Neutral planning/development-activity choropleth + opt-in QI factor | Core | Medium | Claude Code |
| CF-4 | Indexable `/kaavoitus/{kunta}/` planning hub family + region-hub cross-links | Core | Medium | Claude Code |
| CF-10 | Open-data expansion: latent Paavo columns + planning dataset + Dataset JSON-LD | Core | Medium | Claude Code |

**Parallel-safety:** 3 tracks. CF-5 needs IN-1 + the Batch-3 QI work (merged); CF-4 needs CF-1 (merged); CF-10 sub-2 needs IN-1. (1) CF-5 is the sole data-layer item — owns the pipeline/registry/locale files + `qualityIndex.ts` (rebased on Batch 3) and regenerates `region_properties.json`; owns any `BUDGET` raise. (2) CF-4 isolated (`prerender-hubs.mjs` + `generate-sitemap.mjs`). (3) **CF-5 → CF-10** order on `region_properties.json` (CF-10 only **reads** the regenerated file, no double-write). `build_open_data.mjs` (CF-10) precedes QW-6 in Batch 5.

### Batch 5 — Interactive polish: panel a11y, comparison honesty, in-app exports, sync trust, static-page discovery

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-4 | Fix mobile section tab labels frozen at first-mount language | Quick Win | Small | Claude Code |
| CF-7 | Complete the WAI-ARIA Tabs pattern for the mobile section carousel | Core | Medium | Claude Code |
| PO-1 | Comparison honesty: neutral price + direction-aware bar chart | Polish | Small | Claude Code |
| CF-8 | CSV export for in-app `RankingTable` & `CorrelationExplorer` + ranking deep link | Core | Small | Claude Code |
| IN-6 | Finish sync conflict resolution (`updated_at` LWW + kill save-on-login race) | Infrastructure | Medium | Claude Code |
| QW-5 | Adjacency-driven "naapurialueet" link mesh in prerendered profiles | Quick Win | Small | Claude Code |
| QW-6 | Atom-feed + open-data discovery links in standalone page heads | Quick Win | Small | Claude Code |

**Parallel-safety:** 5 tracks. (1) **Panel track QW-4 → CF-7 → PO-1** serialize on `NeighborhoodPanel.tsx` (QW-4 memo fix → CF-7 WAI-ARIA over `MOBILE_SECTIONS`, scaling over CF-3's fifth section → PO-1's price-StatRow edit); PO-1 also solely edits `ComparisonPanel.tsx`/`scoreCard.ts`/`formatting.ts`. (2) CF-8 isolated (`export.ts`/`RankingTable.tsx`/`CorrelationExplorer.tsx` + sole `App.tsx` editor this batch). (3) IN-6 isolated (server `auth.ts` rebased on IN-5 + `api.ts` + 5 client hooks + 2 tests). (4) QW-5 isolated (`prerender.mjs`, rebases on CF-1/IN-7). (5) QW-6 isolated (`prerender-hubs.mjs` + `build_open_data.mjs`, rebases on CF-4/CF-10). Locales edited by PO-1 + CF-8 (distinct keys → rebase); first to need `check-bundle-size.mjs` owns any raise.

### Batch 6 — Localization & screen-reader feedback parity

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| PO-2 | Localize the skip-to-content link | Polish | Small | Claude Code |
| PO-3 | Screen-reader feedback parity: `role=status` toasts + announced result counts | Polish | Small | Claude Code |
| PO-4 | Honest feedback when a filter/wizard highlight is active over a grid layer | Polish | Small | Claude Code |

**Parallel-safety:** 3 small items; **serialize on `App.tsx` and `src/locales/{fi,en,sv}.json`** (distinct regions/keys → rebase in sequence, suggested PO-2 → PO-3 → PO-4). Outside those two shared surfaces each is isolated: PO-2 also solely edits `index.html`/`prerender.mjs`/`prerender-hubs.mjs` (rebases on QW-5/QW-6); PO-3 also solely edits `NeighborhoodPanel.tsx` (toasts region; the Batch-5 panel track already merged); PO-4 also solely edits `Map.tsx`/`Legend.tsx`. Likely fits the prevailing `BUDGET` — only PO-4 *may* need a small raise. Deliberately last because every member rebases on the heavily-touched `App.tsx` (CF-2 Batch 2, CF-8 Batch 5) and the prerender/panel surfaces settled upstream.

---

### Cross-batch serialization is free

Because batches merge sequentially, every file shared **across** batches is auto-serialized — each later toucher rebases on the prior batch's merged state: `validate_data.py` (B1 → B3 → B4), `data_sources.json` (B1 → B2 → B3 → B4), `qualityIndex.ts` (B3 → B4), `prerender.mjs` (B1 → B2 → B5 → B6), `prerender-hubs.mjs` (B1 → B4 → B5 → B6), `build_open_data.mjs` (B4 → B5), `App.tsx` (B1 → B2 → B5 → B6), `NeighborhoodPanel.tsx` (B2 → B5 → B6), `useUrlState.ts` (B1 → B2), server `auth.ts` (B2 → B5).

---

### Audit method

This roadmap was produced by a 55-agent workflow: **8 parallel codebase subsystem surveys** (data layers/pipeline, map/overlays, panels/tools/exports, state/sync/backend, SEO/prerender/build, i18n/a11y/mobile/perf, TODOs/git-history, quality-index/regions/similarity) + **4 live external data-source research dossiers** (national Ryhti/RYTJ/SYKE zoning systems, municipal open-zoning WFS feeds, Väylä/rail/light-rail infrastructure projects, licensing + granularity + competitive prior-art) → an **opportunity brief** → **6 ideation lenses + a 3-variant kaavoitukset/hankkeet design panel** (map-overlay vs prerendered-content vs derived-metric) with a **design judge** → a synthesis that deduped 100 raw candidates into 29 → **one adversarial verifier per item** (charged with proving it already shipped, was deliberately removed, violates the bundle/real-data/granularity constraints, or rests on unavailable data — checking file paths, line numbers, git history, and live external APIs/datasets) → a **completeness critic** that added 4 verified items → a sequencing analysis over the verified `touches` lists. 27 of 29 synthesis candidates survived verification (2 refuted — see "Refuted during verification" above); all 4 critic additions survived. External facts checked live during verification include the Väylävirasto OGC API Features collections, the Helsinki/Tampere zoning WFS endpoints, the Ryhti plan API + 2029 statutory deadline, and the StatFin `vaenn` (population projection) and `ras` (construction) PxWeb tables.
