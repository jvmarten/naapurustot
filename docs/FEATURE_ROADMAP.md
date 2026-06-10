# naapurustot.fi — Feature Roadmap

> Generated 2026-06-10 from a fresh multi-agent codebase audit (11 parallel subsystem surveys → 6 ideation lenses → synthesis/dedup → adversarial per-item verification against the code → completeness critic → sequencing analysis; 64 agents). Supersedes the 2026-06-03 roadmap, **all 36 items of which shipped on 2026-06-08** (commit `bb69348`), as did the UX-review batch (`33c5ffd`).

## Project Context

naapurustot.fi is a static, backend-optional React 19 / TypeScript 5.9 / Vite 8 single-page app on MapLibre GL, live at naapurustot.fi. It renders ~59 postal-code data layers across 3,018 areas in all 69 seutukunnat (lazy per-region TopoJSON) plus two real sub-postal grids (air quality ~250 m, light pollution ~500 m), all from verifiable public sources. On top sits a deep decision layer: Quality Index with personas and per-area coverage auditing, discovery wizard with a persisted priority profile, percentile filters, similarity weights, correlation explorer with R², adjacency analysis, comparison + durable shortlist with share links and PNG cards, GeoJSON/CSV/PDF export, exhaustive shareable URL state with a version guard, and ~27,000 prerendered FI/EN/SV profile/hub pages with per-area SVG social cards, privacy page, and GDPR endpoints. The optional Express 5 + PostgreSQL backend cloud-syncs favorites/shortlist/notes/preferences. CI/CD: lint, tsc, Vitest coverage ratchet, e2e + axe, Lighthouse, bundle budget, payload audit, CodeQL, daily health check, quarterly data refresh.

The product is **feature-complete for its original vision**. What the fresh audit found instead is a different frontier: roughly twenty **verified correctness/honesty defects** where the shipped UI contradicts itself or its own data (wrong "Best match" ordering, comparison "Best" highlighting the most expensive area, the quality-index methodology page describing a model that no longer exists, a guaranteed sync-error loop for every signed-in wizard user, a quarterly data-refresh pipeline that can never pass its own size gate), plus large untapped leverage in **build-time surfaces that cost zero bundle bytes** (ranking pages, raster social cards, open data, prerender enrichment) and **five genuinely new real-data layers** (radon, flood risk, health index, current rents, national transit stops).

## The bundle-budget reality (read before implementing anything)

CI fails when the gzipped sum of **all** app JS (lazy chunks included, only `maplibre-*` excluded) exceeds **280,000 bytes**; current usage is ~278,900 bytes — **~1.1 KB of headroom**. Three consequences verified by the audit:

1. **Dead code frees nothing.** `DrawTool.tsx`, `.storybook/`, and `@turf/union` are unimported and already absent from the bundle — deleting them is hygiene, not headroom. The only real recoveries are pruning orphaned keys from the statically-bundled `fi.json` and the sync-hook consolidation (CF-7), and even that nets a few hundred bytes at best (gzip already dictionary-compresses the duplicated hooks).
2. **`en.json`/`sv.json` are free** (lazy `?url` assets); **`fi.json` is not** (statically imported in `i18n.ts:19`). Prerender-only strings must live inline in the build scripts, never in locale files.
3. Every JS-touching item below carries a measured-or-estimated byte cost; **IN-1 (per-merge size deltas) is the enabling observability** and lands in Batch 1. Measure before every push.

## Deliberately removed / excluded — do not re-propose

- Affordability calculator section, neighbor-ring map highlight, duplicate scope pill (removed `6078a54`); idle hint pill and header share button (removed `214673e`); green-space layer (removed `3de51a7` in favor of tree canopy — a re-proposal was refuted during verification); UX-review items O2/O3/X5 (dropped by owner).
- Owner-excluded data work: national/metro demographic 250 m grid, OSM building footprints, MML elevation, commute/isochrone destination filter.
- IN-9 (off-droplet nightly DB backups) — dropped 2026-06-10: it is a Manual Setup item gated on an owner-provisioned object-storage bucket + credentials, so it cannot be completed autonomously.

> **Note on item IDs:** fresh IDs for this document; they do **not** map to the 2026-06-03 roadmap's IDs.

---

## 1 — Quick Wins

### QW-1 Bundle dead-weight sweep: DrawTool, .storybook, @turf/union, orphaned strings, stale meta copy

| | |
|---|---|
| **What** | Delete `src/components/DrawTool.tsx` (zero importers; draw mode lives inline in Map.tsx/App.tsx), the `.storybook/` directory (no storybook dep or script), and the vestigial `@turf/union` dependency. Remove orphaned `empty.click_to_explore` keys (all three locales) and the unconsumed `MapPinIllustration` export. Move the hardcoded FI/EN/SV meta-description strings at `App.tsx:1410-1425` into locale keys, rewriting them to accurate nationwide copy (they still claim "Helsingin seudun" and "35+ mittaria" against 3,018 areas / 59 layers); the relocated effect must re-run on the i18n version (not just lang) so non-FI first paint doesn't keep the FI fallback. Optional: dedupe `correlation.ts`'s exported `percentileRank` onto `percentileRanks.ts` (semantically safe, negligible bytes). Measure the gzip delta before/after. |
| **Why** | Clears two known defects from the docs pass and fixes the worst remaining trust bug: selecting any area rewrites the page description back to Helsinki-only copy contradicting the all-Finland product. Realistic gzip delta ≈ −150 to −500 bytes (en/sv meta strings exit the bundle as lazy assets). |
| **Touches** | `src/components/DrawTool.tsx` (delete), `.storybook/` (delete), `package.json`, `package-lock.json`, `src/App.tsx`, `src/components/EmptyStateIllustrations.tsx`, `src/utils/correlation.ts`, `src/components/NeighborhoodPanel.tsx`, `src/__tests__/correlation.test.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Fix the filter "Best match" ranking: direction- and percentile-aware scoring

| | |
|---|---|
| **What** | `FilterPanel.tsx`'s ranked useMemo (lines 485-497) scores `(value − rf.min) / (rf.max − rf.min)` on stored bounds — for percentile-mode criteria those are 0-100 ranks while `value` is the raw metric, so that criterion explodes to hundreds and dominates the sort; the term also always rewards higher values, so for crime/noise/unemployment the **worst** areas sort first. Resolve percentile criteria through the already-imported `resolveCriterionBounds` before normalizing, flip the normalized position when `layer.higherIsBetter === false`, clamp to [0,1] (at-rail outliers admit out-of-bounds values), skip unresolvable criteria like `computeMatchingPnos` does, and extract scoring into `filterUtils.ts` for unit testing. |
| **Why** | The filter panel is the primary narrowing tool and its ranked output is currently meaningless-to-inverted: a family filtering for safety can be shown the highest-crime areas first under the label "Best match". Verified an oversight (score path predates percentile mode), not a decision. ~0 bundle bytes. |
| **Touches** | `src/components/FilterPanel.tsx`, `src/utils/filterUtils.ts`, `src/__tests__/filterRanking.test.ts` (new) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Comparison table honesty: Quality Index row and corrected "Best" directions

| | |
|---|---|
| **What** | Add a `quality_index` row (plus crime_index/walkability_index rows whose formatters exist) to `STAT_SECTIONS` in `ComparisonPanel.tsx:47-82` — the flagship score already leads the comparison CSV/PDF and PNG card but is absent from the on-screen table. Fix "Best" judgments: `property_price_sqm` is `higherIsBetter:true` (line 77), so the most expensive finalist is highlighted green as "Best" — make `findBest` (and `refDeltaOf`, so reference-baseline price deltas stop coloring) accept a null/neutral direction for `property_price_sqm` and `foreign_language_pct`, matching the main panel's deliberate no-judgment treatment, and resolve the ownership_rate/rental_rate complement contradiction (both currently higher-is-better). Existing locale keys cover all rows — zero i18n cost. |
| **Why** | The deepest-compare step for a household choosing between finalists omits the headline score and tells buyers the priciest area "wins". Marking price neutral stays clear of the removed affordability framing. ~150-300 gzipped bytes. |
| **Touches** | `src/components/ComparisonPanel.tsx`, `src/__tests__/comparisonPanel.test.tsx` (new) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Provenance honesty pass: correct proxy flags, fix validator drift, gate the cross-check in CI

| | |
|---|---|
| **What** | Repair the three standing provenance errors that make `validate_data.py` **fail on committed state today** (add `crime_index_change_pct` to `scripts/provenance.json`; align rental vintages to the registry's 2022). Correct misdeclared registry rows: `broadband_coverage_pct`, `voter_turnout_pct`, `party_diversity_index` → `is_proxy:true` (fetchers document municipality/income-proxy distribution); `air_quality_index` granularity honesty (250 m ENFUSER is Helsinki-metro only; nationwide is FMI SILAM ~5-10 km — declare `postal` to stay within `VALID_GRANULARITY`); `noise_pollution` attribution gains Väylävirasto + Tampere plus a modeled-40 dB-fill note. Extend `MUNICIPALITY_DISTRIBUTED_PROXIES`, remove the dead `seniors_alone_pct` validator row, re-run `build:data` so the publicly served `build_metadata.json` stops showing wrong flags/vintages, and add the registry-vs-provenance cross-check as a **files-only** CI step in both workflows (`main()` currently loads the 39 MB GeoJSON unconditionally — needs a light mode). |
| **Why** | Attribution honesty is what a fact-checking journalist audits first; three layers claim measured postal data that is actually modeled, the public manifest is stale, and the next quarterly refresh is guaranteed to fail validation. The existing "estimate" badge picks corrected flags up for free. Keep new note strings terse (`fi.json` is bundled). |
| **Touches** | `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/validate_data.py`, `src/data/build_metadata.json`, `public/data/build_metadata.json`, `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml`, `src/locales/{fi,en,sv}.json`, `src/__tests__/dataSourceRegistry.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Language-aware internal link mesh between panel, profiles, hubs and the sources page

| | |
|---|---|
| **What** | Fix `NeighborhoodPanel.tsx:1835` so "view full profile" uses the per-language prefix map `openNationalResult` already uses (`/alue/`, `/en/area/`, `/sv/omrade/`) instead of hardcoded Finnish, ideally via a router Link so the map session survives. Point the profile breadcrumb (`NeighborhoodProfilePage.tsx:411`) at the prerendered `/kaupunki/{id}/` hub as a **plain anchor** (hubs are standalone no-bundle HTML; no SPA route exists), align the hydrated `JsonLd.tsx:323` breadcrumb + addressLocality/addressRegion to the prerendered version, and replace the stale four-source footer string (`NeighborhoodProfilePage.tsx:619`) with a link to `/tietolahteet`. |
| **Why** | EN/SV users are currently sent to Finnish profile URLs with a full reload, the ~210 hub pages have zero inbound links from the app, and crawlers see different structured data hydrated vs static. ~100-200 gzipped bytes. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `src/components/profile/JsonLd.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-6 Mobile sheet a11y and gesture-robustness sweep: labels, dialog roles, touchcancel

| | |
|---|---|
| **What** | Add `aria-label={t('aria.close')}` (key exists ×3 locales) to the three unlabeled SVG-only mobile close buttons (`FilterPanel.tsx:808`, `LayerSelector.tsx:383`, `AreaSummaryPanel.tsx:239`); replace four hardcoded English aria-labels ("Close filter", "Close ranking", "Clear search", "Language") with `t()` keys (one new `Language` key ×3); add `role="dialog"` + keyed aria-label to the five anonymous mobile sheets (FilterPanel, LayerSelector, AreaSummaryPanel, ComparisonPanel, CustomQualityPanel) matching the NeighborhoodPanel pattern. Wire the already-returned `onTouchCancel` handler onto the FilterPanel, LayerSelector, and CustomQualityPanel drag handles (`useBottomSheet.ts:161` returns it; only NeighborhoodPanel wires it) so an OS-interrupted gesture no longer freezes a sheet mid-drag. |
| **Why** | Guaranteed axe "button-name" serious violations and Finnish/Swedish screen-reader users hearing English — shipping today only because the axe gate never scans mobile states (see IN-7, which locks this in). The touchcancel fix kills a real frozen-sheet bug. ~100-200 gzipped bytes. |
| **Touches** | `src/components/FilterPanel.tsx`, `src/components/LayerSelector.tsx`, `src/components/AreaSummaryPanel.tsx`, `src/components/ComparisonPanel.tsx`, `src/components/CustomQualityPanel.tsx`, `src/components/RankingTable.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-7 First-run orientation refresh for the all-Finland default landing

| | |
|---|---|
| **What** | Update `onboarding.welcome`/`onboarding.search` bodies in all three locales to orient users in the all-Finland view they now actually land on ("you're seeing all 69 regions — tap one or search your town to zoom in") instead of framing All-Finland as an optional destination. Pure copy edit: the tour already has a ToolsDropdown step (`OnboardingTour.tsx:27`), so no component changes. Keep the new Finnish copy roughly length-neutral (`fi.json` is bundled). |
| **Why** | The tour is the only standing first-run orientation and it describes the pre-2026-06-09 landing (national default flipped in `214673e`, after the last copy rewording). ~0 bytes. |
| **Touches** | `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-8 Grid-cell hover values in the tooltip

| | |
|---|---|
| **What** | Hover/click query only `FILL_LAYER` (`Map.tsx:1088/1142`; same in SplitMapView), but above the zoom-8.5 crossfade the postal fill is at opacity 0 while still returned by `queryRenderedFeatures` — so over the air-quality/light-pollution grids the tooltip reports the postal aggregate while the user looks at 250/500 m cells with visibly different values. When the active layer has gridData and zoom is past `GRID_ZOOM_FADE_IN`, include `GRID_FILL_LAYER` in the query and surface the cell's `gridProperty` value (existing layer format fn, labeled as cell value) via the existing rAF/tooltipStore path; fall back to the postal aggregate below the fade. Same in SplitMapView's pane-local hover. Scope to hover only (click-path postal selection is arguably correct). |
| **Why** | A straight correctness defect in a data-integrity-first product: the number on hover doesn't describe the geometry under the cursor whenever a grid is visible. Makes the grids (and CF-18's planned one) actually inspectable. ~0.3-0.5 KB gzipped — measure. |
| **Touches** | `src/components/Map.tsx`, `src/components/SplitMapView.tsx`, `src/components/Tooltip.tsx`, `src/components/TooltipOverlay.tsx`, `src/utils/tooltipStore.ts`, `src/App.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/tooltipStore.test.ts` |
| **Complexity** | Small |
| **Dependencies** | QW-1 (bundle sequencing); CF-18 (soft — two grids already ship) |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 Quality Index credibility batch: truthful personas, weights-aware coverage audit, custom weights in national scope, corrected methodology copy

| | |
|---|---|
| **What** | Four verified internal contradictions in the flagship score. (1) Regenerate `PERSONA_WEIGHTS` against the shipped four-dimension model: the "Balanced" persona claims "every dimension weighted exactly equally" (`qualityIndex.ts:1039`) while its comment says "20 each" against a six-dimension model that no longer exists, and most personas silently zero the wellbeing factors added in the reweight; fix stale "Prosperity" comments and the inline {fi,en,sv} persona descriptions. (2) Make `computeQualityCoverage` accept live `QualityWeights` so the X/Y auditability chip enumerates the factors actually contributing to the displayed score (today the "nature" persona's light_pollution is scored but never audited). (3) After `loadAllData` resolves for any national-scope tool (wizard, similarity, correlation, RegionRankingTable), re-run `computeQualityIndices` with the user's custom weights — today the same area shows different scores on the region map vs national results. (4) Rewrite `sources.methodology_body` ×3 locales: the public trust page still describes "61 factors across six dimensions" (`en.json:254`), contradicting `docs/QUALITY_INDEX.md` and the in-app explainer. |
| **Why** | The methodology page, persona descriptions, auditability chip, and cross-scope scores all disagree with the implemented model or each other — for a data-honesty-branded product, the quality index lying about itself is the highest-credibility defect found. ~0.2-0.5 KB gzipped; measure. |
| **Touches** | `src/utils/qualityIndex.ts`, `src/utils/dataLoader.ts`, `src/App.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/components/NeighborhoodWizard.tsx`, `src/components/RegionRankingTable.tsx`, `src/components/CorrelationExplorer.tsx`, `src/locales/{fi,en,sv}.json`, `docs/QUALITY_INDEX.md`, `src/__tests__/qualityCoverage.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Map rendering correctness batch: unify style-loaded gating and close SplitMapView parity gaps

| | |
|---|---|
| **What** | (1) Extract an `applyWhenStyleReady` helper gated on the persistent `mapStyleLoadedRef` and convert the five verified stragglers still using `map.isStyleLoaded()` or one-shot `'load'` queuing — pinned (`Map.tsx:1223`), select-areas (1256), wizard-highlight (1291) return early with no retry; draw-preview (1406) and drawn-polygon (1489) queue on `'load'` — so overlay updates landing during an in-flight `setData` re-parse are no longer silently dropped (the exact recurring bug class CLAUDE.md documents; the correct pattern already exists at lines 520/574/647/804). (2) Thread `layerConfig` (App-level effective/rescaled config — the right pane needs a second memo for `secondaryLayer`), `fillOpacity`, and `selectedPno` into SplitMapView: split mode currently ignores region-rescaled stops and the time-slider year (calls `getLayerById` directly), hardcodes opacity 1, and references a `'selected'` feature-state nothing sets — clicking opens the panel with no visual selection. Re-set the map canvas aria-label on language change (set once inside `map.once('load')`). |
| **Why** | Five live instances of a documented recurring pitfall silently drop user-visible overlay state; split view renders the same layer with different color scales than the main map. Roughly net-zero bytes (helper dedupes five inline guards). |
| **Touches** | `src/components/Map.tsx`, `src/components/SplitMapView.tsx`, `src/App.tsx`, `src/__tests__/splitMapParity.test.tsx` (new, optional) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Make the shortlist reachable on phones and visible while browsing

| | |
|---|---|
| **What** | (1) Render the already-constructed `shortlistButton` and `referenceButton` variables (`NeighborhoodPanel.tsx:928/913`) in the mobile bottom-sheet header action row (~line 1994) — phone users currently have **no way** to add an area to the shortlist. (2) Relax the ShortlistTray gate (`App.tsx:2019`, `!selected && pinned.length === 0`) so a compact count chip remains visible while a panel is open, tapping it restoring the full tray; style it from the tray's own classes (the owner has twice removed pill chrome — keep it unobtrusive, avoid stacking collisions with the bottom sheet). (3) Add a dot on shortlist chips when `readNote()` returns text so saved visit notes become discoverable. |
| **Why** | The shortlist is a flagship synced feature (cloud sync, share links, cards, exports) that is invisible during the compare workflow it exists for and completely unreachable on phones — the largest feature-access hole on mobile. ~300-400 gzipped bytes; verify with the budget check. |
| **Touches** | `src/components/NeighborhoodPanel.tsx`, `src/App.tsx`, `src/components/ShortlistTray.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/shortlist.test.ts` |
| **Complexity** | Small |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-4 Next steps: housing-listing and visit-planning links from the panel and profile pages

| | |
|---|---|
| **What** | A "Seuraavat askeleet" action group: pure helper `src/utils/nextSteps.ts` builds outbound URLs from municipality + postal code for housing listings (Oikotie/Etuovi for sale, Vuokraovi for rent — deep-link granularity verified per portal at implementation, falling back to stable municipality-level search URLs) and a "plan a visit" link to the national journey planner (opas.matka.fi) pre-filled with the area centroid. Plain `rel="noopener"` anchors in the panel actions row and on profile pages; emit the same links into the prerendered profile footers via `prerender.mjs` (bundle-free, clear of the head-token pitfall). Data plumbing verified as the real work: `region_properties.json` exposes only kunta code `"091"` and ETRS-TM35FIN coordinates, and national-scope features have `geometry: null` — bake municipality name slugs + WGS84 centroids into `region_properties.json` at `build:data` time (Tilastokeskus municipality classification — real, verifiable). Instrument with the existing `trackEvent`. |
| **Why** | The product dead-ends at the decision: a household that has chosen an area gets no path to actual homes or to visiting. Closing decide-to-act is the highest-leverage journey fix; outbound links only, so the real-data rule is untouched. ~0.4-0.7 KB gzipped — land after QW-1, measure. |
| **Touches** | `src/utils/nextSteps.ts` (new), `src/components/NeighborhoodPanel.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `scripts/prerender.mjs`, `scripts/build_region_data.mjs`, `src/utils/metrics.ts`, `src/data/region_properties.json` (regenerated), `src/locales/{fi,en,sv}.json`, `src/__tests__/nextSteps.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-5 Back-gesture dismissal of mobile sheets and modals via a history sentinel

| | |
|---|---|
| **What** | Push one `history.pushState` sentinel whenever a mobile-relevant overlay opens (bottom sheet past peek, FilterPanel/LayerSelector sheets, wizard, auth modal, shortcuts overlay) and add one `popstate` listener in App.tsx routing through the existing layered Escape-cascade priority logic (`App.tsx:1585-1599`) to close the topmost surface. Cautions from verification: the cascade is distributed — LayerSelector (window listener with `stopImmediatePropagation`) and AuthModal (document listener) consume Escape themselves, and bottom-sheet snap state lives inside NeighborhoodPanel via `useBottomSheet` — so those components are touchpoints; keep the armed flag in a **ref**, not `history.state` (useUrlState's `replaceState(null, ...)` clobbers the sentinel's state object on any URL sync), and consume stale sentinels via `history.back()` when overlays close by other means. |
| **Why** | On Android (and iOS swipe-back), pressing back with a sheet open exits the site entirely — the most jarring platform-convention violation left on mobile. ~250-400 gzipped bytes. |
| **Touches** | `src/App.tsx`, `src/components/LayerSelector.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/components/AuthModal.tsx`, `src/hooks/useUrlState.ts`, `src/__tests__/backGestureSentinel.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-6 Persistence trust: end deletion-resurrection, stop shared links overwriting personal state, cross-tab logout

| | |
|---|---|
| **What** | Three verified data-loss/corruption vectors. (1) **Deletion resurrection:** login merges are plain union for favorites/shortlist (`useFavorites.ts:27-36`) and longer-text-wins for notes, so an item deleted on device A reappears after device B's next push-back — return the server's existing `updated_at` (columns already exist on all five user tables) in GET responses and apply last-write-wins per store, or per-item tombstones for list stores. (2) **Shared-link overwrite:** URL restore (`App.tsx:773/776`) persists the link *author's* quality weights and wizard profile into the recipient's localStorage and cloud sync with no confirmation — apply inbound `wp`/`qw` (and `useSimilarityMetrics`' URL-seeding) session-only, persisting only after the user edits. Note: the URL-seeding is documented as deliberate prior design — this is a conscious reversal, but the persist-to-cloud side effect was never an owner-level decision. (3) **Cross-tab auth:** `useAuth` has no `storage` listener, so logging out in one tab leaves others PUTing with a cleared cookie into the 401-retry path — add the ~10-line `has_session` listener matching the pattern the six data hooks already use. |
| **Why** | The three remaining ways the app silently loses or corrupts a signed-in user's saved data. Trust in persistence is a prerequisite for the account feature mattering at all. Low bytes (part 2 deletes code); land inside CF-7's measured saving. |
| **Touches** | `server/api/src/auth.ts`, `server/api/src/auth.test.ts`, `src/hooks/useFavorites.ts`, `src/hooks/useShortlist.ts`, `src/hooks/useNotes.ts`, `src/hooks/useAuth.ts`, `src/hooks/useQualityWeights.ts`, `src/hooks/useWizardProfile.ts`, `src/hooks/useSimilarityMetrics.ts`, `src/App.tsx`, `src/utils/api.ts`, `src/__tests__/useNotes.test.ts`, `src/__tests__/useWizardProfile.test.ts`, `src/__tests__/useFavorites.test.ts` (new), `src/__tests__/useAuth.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | CF-7, IN-3 |
| **Tag** | Claude Code |

### CF-7 Consolidate the six copy-pasted cloud-sync hooks into one factory (measured net JS saving)

| | |
|---|---|
| **What** | Extract the ~80-line pattern duplicated across `useFavorites`/`useShortlist`/`useNotes`/`useFilterPresets`/`useQualityWeights`/`useWizardProfile` (debounced save via runSync, unmount flush, on-login fetch+merge with one-time push-back, fromServerRef echo suppression, cross-tab storage listener) into a `useSyncedStore` factory parameterized by storage key, API fns, and merge strategy — merge strategies genuinely differ per hook (array union, canonical-sig merge, custom-vs-default adoption, longer-text-wins) and must be carried per store. Add a cached shared promise in `api.ts` (the `loadAllData` pattern) so the three identical `GET /auth/preferences` calls collapse to one per login transition, and fix the save-on-login race once, in the factory. Existing per-hook Vitest suites pin behavior (note: `useQualityWeights` has no hook-level test — add one); **abort any hook whose migration measures gzip-positive**. |
| **Why** | The largest measured-savings candidate in the codebase — realistically a few hundred gzipped bytes (gzip already compresses the duplication), plus login chatter cut from 6 GETs toward 1 and the race fixable in one place. Funds the JS-positive items in later batches. |
| **Touches** | `src/hooks/useSyncedStore.ts` (new), the six hooks, `src/utils/api.ts`, `src/__tests__/useSyncedStore.test.ts` (new), `src/__tests__/{favorites,shortlist,useNotes,useFilterPresets,useWizardProfile}.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-8 Slim the all-Finland landing with a prebuilt seutukunta-aggregate artifact

| | |
|---|---|
| **What** | The default landing (`?city=all`) fetches `region_properties.json` — measured **10,640,718 B raw / ~1.75 MB gzipped** — plus outlines just to render 69 regional aggregates that `buildMetroAreaFeatures` computes client-side (`useSearchIndex` eagerly fetches the full set on mount, making it worse). Emit a build-time `region_aggregates.json` (~69 records, a few KB gz) from `build_region_data.mjs` reusing the existing aggregation logic (derived from real data), drive first paint from it, and defer the full national fetch to the events that genuinely need per-area data: first search-index use, custom quality-weight recompute (stored custom weights require the full fetch on boot — aggregates carry default-weight quality_index), region drill-in, national-scope tools. Extend the `metroAreaCache.usedOutlines` invalidation pattern with a `usedAggregates` flag so the view upgrades in place — respecting CLAUDE.md all-Finland pitfall #2 exactly. Then consider promoting `lighthouserc.cjs`'s root-SPA perf gate from warn to error (its own comment waits for this work). |
| **Why** | The universal first impression: time-to-usable-map drops from a ~2 MB download to ~200 KB, especially on mobile. ~0.3-0.5 KB gz net JS — must land after CF-7's savings and be measured. |
| **Touches** | `scripts/build_region_data.mjs`, `src/data/region_aggregates.json` (new, generated), `src/utils/dataLoader.ts`, `src/utils/metroAreas.ts`, `src/hooks/useMapData.ts`, `src/hooks/useSearchIndex.ts`, `src/hooks/useAllCitiesUnionPreload.ts`, `src/App.tsx`, `lighthouserc.cjs`, `src/__tests__/{dataLoader,dataLoaderCore,useMapData,useSearchIndex,metroAreasCacheAndThreshold,metroAreasBranches}.test.ts` |
| **Complexity** | Large |
| **Dependencies** | CF-7 |
| **Tag** | Claude Code |

### CF-9 Shard the national light-pollution grid per region and evict inactive grids from memory

| | |
|---|---|
| **What** | Measured: `light_pollution_grid.geojson` is **11,343,381 B raw / ~808 KB gzipped**, parsed in one `JSON.parse` of 50,594 features and pinned forever by `useGridData`'s never-evicting cache plus clipped copies in App. TopoJSON makes the wire size *worse* for this dense regular grid (measured ~970 KB gz), so the lever is sharding: extend `build_grid_data.mjs` to split national-scope grids into per-region files keyed by `scripts/seutukunta_bboxes.json` (manifest gains a `shards` map) so `useGridData` fetches only the active region's cells (whole-file path kept for `?city=all`). Cap the cache at an LRU of 1-2 grids — the fetchedRef/retry logic already supports refetch. Thread the active cityFilter into both `useGridData` call sites in App.tsx; SplitMapView gets grids via props, untouched. |
| **Why** | Cuts the worst single runtime payload to tens of KB for region-scoped sessions and stops permanently pinning tens of MB of heap after one layer visit — important on mobile. +0.2-0.4 KB gz; measure. |
| **Touches** | `scripts/build_grid_data.mjs`, `src/hooks/useGridData.ts`, `src/App.tsx`, `src/data/grid_manifest.json`, `scripts/seutukunta_bboxes.json`, `public/data/light_pollution_shards/*.geojson` (new, generated), `src/__tests__/useGridData.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-10 SEO head integrity pass: canonical alignment, profile JSON-LD slimming, localized EN/SV root landings

| | |
|---|---|
| **What** | (1) SPA: on selection, `App.tsx:1420-1422` must set canonical/og:url to the trailing-slash `/alue/<slug>/` profile URL `getShareUrl` already builds, not `?pno=` — currently re-opening the duplicate-signal problem the `59946a4` de-indexing fix solved. (2) Prerender: strip the homepage-scoped WebSite/WebApplication/Organization/Dataset JSON-LD blocks and Finnish meta keywords from the ~9,000 profile clones (the FAQPage strip at `prerender.mjs:914-919` shows the pattern); add the missing trailing slash to SOURCES/PRIVACY canonicals and sitemap entries. (3) Write `dist/en/index.html` and `dist/sv/index.html` in prerender-hubs' standalone-HTML style (translated title/description/OG, links to localized directories/hubs/`/?lang=`), then point `index.html:38-41`'s currently self-referential home hreflang cluster and the sitemap home entry at `/`, `/en/`, `/sv/`. Hardcode the EN/SV landing strings in the build script (locale keys would eat bundled `fi.json` headroom). Respect the head-token regex pitfall; run `build:pages` to verify. |
| **Why** | Crawlers executing JS see a canonical pointing at a non-prerendered query-param URL, every profile dilutes its structured data with five homepage blocks, and ~6,200 EN/SV pages have no language-matched entry page — ranking hygiene on the largest acquisition surface. ~0 bytes. |
| **Touches** | `src/App.tsx`, `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `index.html`, `scripts/generate-sitemap.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None (IN-6 first is strongly recommended — it restructures the same scripts) |
| **Tag** | Claude Code |

### CF-11 Share-preview upgrade: raster PNG social cards plus static oEmbed endpoints

| | |
|---|---|
| **What** | Facebook/LinkedIn/WhatsApp/X do **not render SVG og:images**, so the per-area cards ship blank previews on every major platform. Add a build-only rasterizer (`@resvg/resvg-js` as devDependency with a committed OFL font covering ä/ö/å) so every content-hashed SVG in `dist/og/` gets a sibling PNG referenced as og:image/twitter:image (content-hash skipping keeps ~9,000 cards incremental; a representative card measures ~17 KB → ~200-350 MB added to the 345 MB dist, within the 1 GB Pages cap — **gate the step to deploy.yml only**, keep it out of ci/auto-merge `build:pages` runs). Reuse `buildSocialCardSvg` in prerender-hubs to give all 210 hub/directory pages a per-region card (name, area count, total population — already aggregated). Emit `dist/oembed/{slug}.{lang}.json` (type `rich`, html = the iframe snippet `buildEmbedSnippet` already defines) and inject `<link rel="alternate" type="application/json+oembed">` into profile heads at prerender time. |
| **Why** | The single biggest leak in the share loop; oEmbed lets WordPress/Discourse/newsroom CMSes auto-embed the live map from a pasted profile link. 0 client JS. |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `scripts/social-card.mjs`, `scripts/rasterize-cards.mjs` (new), `scripts/fonts/` (new, committed OFL font), `package.json`, `package-lock.json`, `.github/workflows/deploy.yml`, `src/utils/embed.ts` (read-only reuse) |
| **Complexity** | Medium |
| **Dependencies** | None (PO-2 edits `embed.ts` — land PO-2 first or rebase) |
| **Tag** | Claude Code |

### CF-12 Prerendered "best areas by metric" ranking pages per region plus national top lists

| | |
|---|---|
| **What** | Extend `prerender-hubs.mjs` (already loads the full GeoJSON, locales, registry) with a static page family `/kaupunki/{region}/parhaat/{metric}/` ×3 languages for ~6-8 high-coverage, high-intent metrics (quality_index, median income, safety via inverted crime_index, families-with-children share, transit access, air quality — all verified real GeoJSON properties), each a direction-aware top-10/15 table with real values, source + vintage disclosure from the registry, ItemList + BreadcrumbList JSON-LD, links into `/alue/` profiles. National top-50 pages per metric. Compute coverage gating from the GeoJSON the script already loads (`region_coverage.json` only stores aggregate counts), replicate the higherIsBetter map inline (the .mjs cannot import `percentileRanks.ts` — header documents the replication pattern). Cross-link from region hubs; register in the sitemap with hreflang. All page strings inline in the script — **no locale keys**. |
| **Why** | Households start with "paras asuinalue Tampere lapsiperheelle" queries and journalists need citable ranking URLs; rankings exist only as an ephemeral in-app panel. ~1,500+ long-tail pages from data already in build inputs, zero bundle cost. |
| **Touches** | `scripts/prerender-hubs.mjs`, `scripts/generate-sitemap.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None (after IN-6 refactor) |
| **Tag** | Claude Code |

### CF-13 Prerender-only profile enrichment from the latent Paavo fields

| | |
|---|---|
| **What** | Extend the noscript/static HTML of all ~9,000 profile pages with real-data tables from fields already shipped in `region_properties.json` but surfaced nowhere: full age pyramid (`he_7_12`…`he_85_`), top-5 employment sectors from the 21 NACE `tp_*` fields, household income (`tr_mtu`/`tr_ktu`) and income-class mix, living space per person (`te_as_valj`). Mirror key figures as PropertyValue entries in the existing Place JSON-LD. **Critical caveat (verified):** the latent fields carry raw Paavo `-1` confidentiality sentinels (64-343 areas per field) — filter with a `>= 0` guard and exclude `tp_x_tunt` from top-5, or pages will print "-1 €". Headings + 21 sector names ×3 languages inline in `prerender.mjs` per the existing SECTION_LABELS pattern — **no locale keys**. |
| **Why** | Roughly triples verifiable statistical content per profile (long-tail queries like "Kallio ikäjakauma"; stronger AI-assistant citability) via the one route completely exempt from the bundle budget. `region_properties.json` carries 177 property keys vs 59 surfaced layers. ~+2-4 KB static HTML per page. |
| **Touches** | `scripts/prerender.mjs` |
| **Complexity** | Medium |
| **Dependencies** | None (after IN-6 refactor) |
| **Tag** | Claude Code |

### CF-14 Open-data program: CSV + codebook downloads, static /api/v1/ JSON, versioned dataset releases

| | |
|---|---|
| **What** | New `scripts/build_open_data.mjs` in the `build:pages` chain reads `region_properties.json`, the registry, and `build_metadata.json` and emits `dist/avoin-data/`: `naapurustot_areas.csv` (3,018 rows, raw numerics for ~59 metrics), `naapurustot_timeseries.csv` (long format from the five `*_history` arrays), `codebook.csv+json` (column, FI/EN description, unit, source, vintage, granularity, is_proxy, coverage_pct, license — mind ODbL honesty for OSM-derived columns), and a trilingual index page in the hub style. Also `dist/api/v1/areas/{pno}.json` (clean per-area record with per-metric provenance), `areas.json` index, `metrics.json` codebook — the `v1` prefix freezes the public contract; `/api/` sits outside the robots.txt `/data/` disallow. Add `.github/workflows/dataset-release.yml` publishing GitHub Releases tagged `data-YYYY.MM` with gzipped CSVs, the source GeoJSON, SHA-256 checksums, and notes auto-generated from build_metadata vintages. Sitemap + sources-page + llms.txt links. |
| **Why** | The biggest gap for the journalist/researcher audience: today the only bulk access is reverse-engineering an internal 10.6 MB hashed asset that robots.txt disallows. One-step pandas/R/Excel loading; frozen releases keep published stories verifiable across quarterly refreshes. 0 client JS. |
| **Touches** | `scripts/build_open_data.mjs` (new), `.github/workflows/dataset-release.yml` (new), `package.json`, `scripts/generate-sitemap.mjs`, `scripts/prerender.mjs`, `public/llms.txt`, `public/llms-full.txt`, `README.md`, `docs/ARCHITECTURE.md` |
| **Complexity** | Medium |
| **Dependencies** | QW-4 (soft — codebook republishes is_proxy/vintage fields) |
| **Tag** | Claude Code |

### CF-15 Revive the frozen rental layer with current StatFin municipality rents, honestly proxy-flagged

| | |
|---|---|
| **What** | `rental_price_sqm`/`price_to_rent_ratio` are frozen at a 2022 snapshot of 473 postal codes because the postal table (asvu 13eb) was retired upstream. **Verified against the live PxWeb API:** the successor table is **asvu 15fa** (current quarterly EUR/m² rents for ~27 large cities **with sub-city cost zones** plus 19 maakunnat — the repo comment "region/maakunta only" is wrong). Replace the frozen-snapshot fallback with city/cost-zone values distributed per postal code flagged `is_proxy:true` — ideally replaying the genuine 2022 intra-municipality postal variation against the current level, mirroring `crime_index_history` — added to `MUNICIPALITY_DISTRIBUTED_PROXIES`. Update vintage and remove the discontinued flag in registry/provenance in lockstep, propagate into the GeoJSON, re-run `build:data`. Coverage stays ~473 large-city postal codes (maakunta backfill would breach the granularity floor); `price_to_rent_ratio` un-freezes automatically. **Owner sign-off recommended:** the owner removed the affordability calculator over this source's retirement — switching methodology vs keeping the frozen-with-badge status quo is a product decision; this is a data-honesty refresh, not an affordability re-add. |
| **Why** | A third of Finnish households rent; the rent layer is currently dead data wearing a permanent 2022 staleness warning. Zero client JS — badge rendering already exists. |
| **Touches** | `scripts/fetch_rental_prices_municipality.py` (new, asvu 15fa), `scripts/prepare_data.py`, `scripts/rental_prices.json`, `scripts/validate_data.py`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/data/data_baseline.json`, `public/data/metro_neighborhoods.geojson`, `src/data/` (regenerated) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-16 Double real property-price coverage by unifying on the sales-weighted multi-year method

| | |
|---|---|
| **What** | `prepare_data.py`'s in-pipeline `fetch_property_prices()` queries only the latest single year and a narrow building-type slice, yielding 913 postal codes (30.3% coverage), while the standalone `fetch_property_prices.py`/`fetch_price_crime_history.py` already implement the richer method against the **same StatFin ashi 13mu table** — sales-count-weighted averaging across building types with multi-year fallback — and that table carries ~1,724 postal codes (verified via live PxWeb metadata). Port the method into the main path with a clear vintage rule for fallback-year values in registry/provenance notes. **Also verified:** the repo's table URL form now returns HTTP 400 (StatFin PxWeb migration renamed variable codes), so the in-pipeline fetcher currently fails silently to cached 2024 data — the port must update URL + variable matching. Propagate, `build:data`, intentionally re-baseline. `property_price_change_pct` and `price_to_rent_ratio` improve downstream automatically. |
| **Why** | Property price is among the most decision-critical layers and one of the weakest-covered, feeding comparison, adjacency "cheaper next door", and wizard scoring — and the better method already exists in-repo against the same real source. Zero client JS. |
| **Touches** | `scripts/prepare_data.py`, `scripts/fetch_property_prices.py`, `scripts/fetch_price_crime_history.py`, `scripts/property_prices.json`, `scripts/property_price_history.json`, `public/data/metro_neighborhoods.geojson`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/data/data_baseline.json` |
| **Complexity** | Medium |
| **Dependencies** | QW-4 |
| **Tag** | Claude Code |

### CF-17 Nationwide transit stop density via the national GTFS aggregate (11% → ~100% coverage)

| | |
|---|---|
| **What** | `transit_stop_density` covers 330 postal codes because `fetch_transit_stops.py` queries only HSL, Föli and Nysse. Fintraffic's NAP catalogue (finap.fi, operated for Traficom, CC BY 4.0) hosts static GTFS for every Finnish operator — extend the fetcher to the national GTFS set (or the Digitransit national router GraphQL already integrated for isochrones) and compute stops/km² from `stops.txt` coordinates for all 3,018 polygons, preserving existing urban values in the merge. Update the registry row (source/publisher change — current entry says "HSL (Digitransit)"; `traficom` publisher already registered) + provenance, intentionally re-baseline (the coverage jump is the point), propagate, `build:data`. Update `docs/QUALITY_INDEX.md:75` (hardcodes ~10.9%) and `qualityCoverage.test.ts` (asserts nationalCoveragePct≈10.9). |
| **Why** | Lifts the second-weakest layer to genuinely national coordinate-level data and strengthens the regression behind `transit_reachability_score`. Transit access is a top-3 relocation criterion outside Helsinki too. Zero client JS; no locale changes (layer already labeled ×3). |
| **Touches** | `scripts/fetch_transit_stops.py`, `scripts/transit_stop_density.json`, `scripts/prepare_data.py`, `public/data/metro_neighborhoods.geojson`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/data/data_baseline.json`, `docs/QUALITY_INDEX.md`, `src/__tests__/qualityCoverage.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-18 Ship the missing transit_reachability 250 m grid from the Helsinki Region Travel Time Matrix

| | |
|---|---|
| **What** | `gridProperty:'reachability'` at `colorScales.ts:518` is dead config — no grid asset or manifest entry exists. Build a real one from the Helsinki Region Travel Time Matrix 2023 (Univ. of Helsinki Digital Geography Lab, **Zenodo record 11220980 verified live**, CC BY 4.0, ~13,132 populated 250 m YKR cells covering Helsinki/Espoo/Vantaa/Kauniainen): emit a per-cell score as `public/data/transit_reachability_grid.geojson`; `build_grid_data.mjs` auto-discovers it, quantizes to TopoJSON, registers in `grid_manifest.json` with scope `regional`; `useGridData` + the existing zoom 7-8.5 crossfade activate it with zero renderer changes. **Verified caution:** the shipped postal values are a stop-density regression proxy (R²≈0.58), *not* matrix-derived, and a recent commit deliberately deleted a proxy-grid exporter with a "do NOT register as 250m grid" honesty note — so this pipeline (2.7-8.3 GB Zenodo downloads, 30-min reachability aggregation) is **built from scratch**, and the scope must include re-aggregating Helsinki postal scores from the real grid, refitting the Tampere/Turku regression, and rewording `note.transit_reachability` ×3. Record granularity honestly ("250m grid (Helsinki metro)" — air_quality is the precedent). |
| **Why** | Turns documented dead config into the third sub-postal overlay, honoring the prefer-finer-granularity rule with a vetted, licensed source. This is a travel-time grid, **not** the owner-excluded StatFin demographic grid. Near-zero bundle (manifest entry ~100 raw bytes). |
| **Touches** | `scripts/fetch_transit_reachability.py`, `scripts/fetch_transit_reachability_all.py`, `public/data/transit_reachability_grid.geojson` (new), `src/data/grid_manifest.json` (regenerated), `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `src/data/` (regenerated), `src/__tests__/useGridData.test.ts` |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-19 Radon concentration layer from STUK postal-level measurements

| | |
|---|---|
| **What** | STUK publishes small-house indoor radon concentrations **by postal code area** (stuk.fi serves a machine-readable .xlsx — verified; measurements 1980-2023, ≥10 dwellings per area, exceedance shares at ≥300 Bq/m³; **license confirmation (CC BY assumed, not confirmed on-page) is the true first step**). New `scripts/fetch_radon.py` downloads it, writes `scripts/radon.json` keyed by pno, joins in `prepare_data.py`, then `build:data`. If only municipality medians prove machine-readable, distribute flagged `is_proxy:true` per the crime_index pattern. Add a `radon_median` LayerConfig (`higherIsBetter:false`) to the environment group, metrics metadata + explanation, a new `stuk` publisher + registry row with matching provenance vintage, labels ×3. Sparse areas stay null — gray fill, hatch, and partial-coverage caption handle it per project convention. |
| **Why** | Radon is the second-leading cause of lung cancer in Finland and a standard due-diligence question when buying a house (Pirkanmaa/Kymenlaakso hotspots); no consumer map combines it with these metrics, and it is one of very few new sources natively postal-granular. ~300-400 gzipped bytes (consumes roughly a third of remaining layer headroom — measure). |
| **Touches** | `scripts/fetch_radon.py` (new), `scripts/radon.json` (new), `scripts/prepare_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `scripts/validate_data.py`, `src/locales/{fi,en,sv}.json`, `public/data/metro_neighborhoods.geojson`, `src/data/` (regenerated) |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-20 Flood-risk exposure layer from SYKE flood hazard zones

| | |
|---|---|
| **What** | SYKE's tulvavaarakartat (fluvial + coastal 1/100a flood hazard zones, CC BY 4.0) — **verified live, but use the ArcGIS REST query API (`f=geojson`) at paikkatieto.ymparisto.fi; the WFS path 404s**. New `scripts/fetch_flood_risk.py` intersects hazard polygons with postal polygons via shapely (same pattern as `fetch_water_proximity.py`) to compute `flood_risk_pct` = share of each postal area inside the 1/100a zone. **Methodology caveat (verified):** values are 0 only *within mapped extents* (use the "kartoitetut alueet" layers); unmapped areas must be null with the no-data hatch, per the partial-coverage policy. Add LayerConfig (`higherIsBetter:false`) to the environment group, a `syke` publisher + registry row (sub-postal measured geometry — no proxy flag) + provenance, labels ×3 with a `note.*` caveat explaining the 1/100a scenario. |
| **Why** | The climate-adaptation question buyers increasingly ask, and a direct counterweight to `water_proximity_m`, which today rewards waterfront living unconditionally. Real differentiation exists (Pori, Rovaniemi, Turku riverbanks, low-lying coastal Helsinki). ~350 gzipped bytes — sequence after QW-1, measure. |
| **Touches** | `scripts/fetch_flood_risk.py` (new), `scripts/prepare_data.py`, `public/data/metro_neighborhoods.geojson`, `scripts/validate_data.py`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### CF-21 Municipal health-outcome layer from the THL/Kela health index, proxy-flagged

| | |
|---|---|
| **What** | The Sotkanet REST API (CC BY 4.0, JSON) serves the Kela+THL standardized morbidity index — **verified live: target indicator 5641 ("Sairastavuusindeksi" within the Kansallinen terveysindeksi family), which returns 292 municipality rows for 2023; do NOT use legacy indicator 244, frozen at 2019**. New `scripts/fetch_health_index.py` (the `SOTKANET_URL` constant has sat unused in `prepare_data.py:133` since Phase 7) assigns each postal code its municipality's value flagged `is_proxy:true`, added to `MUNICIPALITY_DISTRIBUTED_PROXIES`. Register a `thl` publisher + registry row (granularity `postal` — the registry's `VALID_GRANULARITY` has no municipality value; crime_index precedent) with matching provenance vintage, LayerConfig (`higherIsBetter:false`, 100 = national average), labels ×3. **Leave QUALITY_FACTORS integration as a follow-up owner decision** (it changes everyone's scores). Note: previously-removed health layers (obesity/life-expectancy) were removed as *fabricated data* — this is the real source replacing them. |
| **Why** | The Quality Index "Health" dimension (weight 28) is currently built entirely from environmental proxies — this is the product's first actual population health-outcome metric, from the flagship area statistic. ~300-400 gzipped bytes; must fit raw headroom on its own — measure before merge. |
| **Touches** | `scripts/fetch_health_index.py` (new), `scripts/prepare_data.py`, `scripts/validate_data.py`, `public/data/metro_neighborhoods.geojson`, `src/utils/colorScales.ts`, `src/components/LayerSelector.tsx`, `src/utils/metrics.ts`, `src/data/data_sources.json`, `scripts/provenance.json`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 Scope-honest area summary and graceful national-data failure in the panel

| | |
|---|---|
| **What** | (1) `AreaSummarySection` ranks against the loaded region cohort while its sentence templates hardcode national phrasing ("In the top {pct}% **nationally**…"), so the live panel and the Google-indexed profile page can assert different national percentiles for the same area. Add a scope parameter to `computeAreaSummary` keyed off whether the loaded cohort is national (`cityFilter === 'all'` — **not** `comparisonScope`, which only rescales the choropleth), with region-scoped sentence variants ×3 locales ("In the top {pct}% within {region}…"); the prerenderer keeps its true-national cohort. (2) `NeighborhoodPanel.tsx:1089-1096` has an empty catch whose comment promises a fallback never written — when `loadAllData` fails offline, the effect refetches the 10.6 MB `region_properties.json` in a tight loop. Implement `setScope('region')` in the catch (the exact pattern NeighborhoodWizard and CorrelationExplorer already use) plus a transient `role=status` toast. |
| **Why** | Cross-region plain-language claims read as cross-Finland facts that are silently wrong; an unbounded fetch loop on a metered mobile connection is the worst possible error state. ~200-400 gzipped bytes; measure. |
| **Touches** | `src/utils/areaSummary.ts`, `src/components/NeighborhoodPanel.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/areaSummary.test.ts` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Locale-faithful numbers and export/share completeness pass

| | |
|---|---|
| **What** | One output-correctness batch. (1) Route `formatPct`/`formatDiff`/`formatYtlGradeFull` (`toFixed` at `formatting.ts:54/64/140`) through the cached `Intl.NumberFormat` so FI/SV users see "12,3 %" per locale convention (also fix `export.ts`'s exportNumFmt mapping sv→fi-FI). (2) Expand `export.ts` `collectStats` (~22 of the panel's ~45 metrics today; omits crime, walkability, school quality, noise/light, canopy, rents, employment, service densities) and actually use the averages map both exportCsv/exportPdf receive but ignore (`_avg` params at `export.ts:107/135`) for the vs-average column the panel shows. (3) Surface the implemented-and-tested-but-unreachable `exportJson` plus a raw-numeric CSV on `rawExportProps` (current CSV cells are locale-formatted strings with units — hostile to spreadsheets). (4) Unify the PNG card pipeline: route `generateScoreCard` through `shareOrDownload` with a deep link; replace hardcoded English "vs. metro" and the fi/en-only popup-blocked alert with `t()`. (5) Add CSV/GeoJSON/PNG buttons to `AreaSummaryPanel` (drawn-area aggregates have zero export affordances despite the machinery shipping in the same lazy chunk); rescope the embed `compare=` inconsistency as *showing a comparison affordance in embeds*, not dropping the param (it also feeds the open-full-view deep link). **Heads-up:** ~65 `toFixed`-style assertions across 11 formatting test files break when FI/SV switch to comma decimals — mechanical churn priced into the Large rating. |
| **Why** | Every defect here is a place where what the user reads or exports is wrong, incomplete, or inconsistent with the screen — wrong decimal convention across the whole FI/SV UI, exports silently dropping half the panel, a tested feature wired to no UI. Offset additions by refactoring `collectStats` into a shared data-driven metric config; measure. |
| **Touches** | `src/utils/formatting.ts`, `src/utils/export.ts`, `src/utils/scoreCard.ts`, `src/utils/embed.ts`, `src/components/NeighborhoodPanel.tsx`, `src/components/ComparisonPanel.tsx`, `src/components/ShortlistTray.tsx`, `src/components/AreaSummaryPanel.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/` (export, scoreCard, embed, 8 formatting suites) |
| **Complexity** | Large |
| **Dependencies** | QW-1 |
| **Tag** | Claude Code |

### PO-3 Keyboard and switch-access parity: tappable sheet snapping, tab semantics, shared focus trap

| | |
|---|---|
| **What** | Convert the bottom-sheet drag-handle divs (`NeighborhoodPanel.tsx:1944`, FilterPanel:795, LayerSelector:370, CustomQualityPanel:342) into `<button>` elements with `aria-expanded` whose tap/Enter cycles peek → half → full via `useBottomSheet`'s snap state (**not currently exposed — surface `setSnap`, trivial**) — today touch-drag is the *only* way to expand a sheet. Add `role="tablist"/"tab"/aria-selected` to the mobile section tabs (`NeighborhoodPanel.tsx:2002-2016`). Extract the working Tab-containment logic from `OnboardingTour.tsx:145-163` into a ~20-line `useFocusTrap` hook and apply it to AuthModal, NeighborhoodWizard and ShortcutsOverlay — all three declare `role=dialog aria-modal=true` but let keyboard focus escape behind the overlay; refactor OnboardingTour to consume the shared hook so the extraction partially pays for itself. |
| **Why** | Sheet expansion is gesture-gated, excluding keyboard and switch users entirely; aria-modal without containment is worse than no modal claim — on exactly the first-run surfaces (tour → auth → wizard) new users hit. ~300-500 gzipped bytes — land after QW-1/QW-6, measure. |
| **Touches** | `src/hooks/useBottomSheet.ts`, `src/hooks/useFocusTrap.ts` (new), `src/components/NeighborhoodPanel.tsx`, `src/components/FilterPanel.tsx`, `src/components/LayerSelector.tsx`, `src/components/CustomQualityPanel.tsx`, `src/components/OnboardingTour.tsx`, `src/components/AuthModal.tsx`, `src/components/NeighborhoodWizard.tsx`, `src/components/ShortcutsOverlay.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/useBottomSheet.test.ts` |
| **Complexity** | Small |
| **Dependencies** | QW-6, QW-1 |
| **Tag** | Claude Code |

### PO-4 Citation infrastructure: Dublin Core meta, CITATION.cff, and registry-generated llms.txt

| | |
|---|---|
| **What** | Inject Dublin Core meta (DC.title, DC.creator, DC.date from build_metadata, DC.identifier = canonical, DC.rights with source credit) into every profile head in `prerender.mjs` so Zotero's Embedded Metadata translator produces a correct one-click citation. Add a visible "Cite this page" section (ready citation string + BibTeX `@misc` carrying the data vintage) to hub/directory pages and the prerendered sources pages, plus `CITATION.cff` at the repo root. Replace the hand-maintained, **already-drifting** `public/llms.txt`/`llms-full.txt` (58 hand-edited layer bullets vs 59 layer ids, untouched since 2026-05-21) with a `build:pages` generator deriving the layer catalogue from `LAYERS`, the source/license table from the registry, and "last updated" from build_metadata — keeping hand-written prose as template literals. **Verified snag:** the generator cannot import `colorScales.ts` under plain Node (its chain reaches Vite-only `?url` specifiers via `formatting.ts → i18n.ts`) — needs a small resolve hook, a refactor moving `formatYtlGrade` out of the chain, or static extraction. Cite-section strings stay script-local — no locale keys. |
| **Why** | Nothing on the site is machine-citable and the primary AI-distribution documents silently diverge with every data change — citability and drift-free AI docs directly serve the journalist/researcher/AI-assistant audiences. 0 bytes. |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `scripts/generate-llms.mjs` (new), `CITATION.cff` (new), `public/llms.txt`, `public/llms-full.txt`, `package.json` |
| **Complexity** | Medium |
| **Dependencies** | None (after IN-6 refactor) |
| **Tag** | Claude Code |

### PO-5 Data-updates Atom feed and a full per-metric coverage table on the sources page

| | |
|---|---|
| **What** | Have `build_region_data.mjs` append to a committed `src/data/data_updates.json` whenever a metric's vintage or coverage_pct changes vs the previous build_metadata (real build events only — no fabricated dates). New `scripts/generate-feed.mjs` in the `build:pages` chain renders it as `dist/data-updates.atom` (localized titles like "Crime index refreshed to 2024 vintage"), with `<link rel="alternate" type="application/atom+xml">` injected into profile/sources heads at prerender time and added statically to `index.html` (verified safe: the tag contains no head-token regex triggers). Extend the prerendered sources page with the complete per-metric audit table (coverage_pct, row_count, vintage, granularity, is_proxy) — the SPA already ships most of this; the prerendered noscript lacks it entirely. `data_updates.json` must never be imported from client code (0 bytes). |
| **Why** | The refresh changelog exists but has no subscription surface — a feed gives journalists a standing "data updated" return hook, the cheapest recurring-visit loop available to a static site. |
| **Touches** | `scripts/build_region_data.mjs`, `scripts/generate-feed.mjs` (new), `src/data/data_updates.json` (new), `scripts/prerender.mjs`, `index.html`, `package.json`, `src/locales/{fi,en,sv}.json`, `src/__tests__/dataUpdatedLog.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | QW-4 (truthful build_metadata first) |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 Single-source the bundle budget and make per-merge size deltas work on auto-merge

| | |
|---|---|
| **What** | Move the duplicated 280,000-byte check (`ci.yml:103-125` and `auto-merge.yml:78-90` carry independent copies of the constant) into `scripts/check-bundle-size.mjs` called by both, emitting the per-chunk gzip table to `GITHUB_STEP_SUMMARY`. Save the bundle-size baseline from the **auto-merge merge-to-main job** — the existing save at `ci.yml:251-256` is unreachable (GITHUB_TOKEN pushes never trigger ci.yml on main), so the delta machinery is permanently dead ("No baseline from main yet") — and restore it in the checks job so every `claude/*` branch shows its exact byte delta vs main. Design note: merge-to-main doesn't build, so forward the baseline from the checks job (artifact/cache keyed to the merged SHA). Port the region-payload report to auto-merge in the same pass. Add a `bundle:check` npm script per repo convention. |
| **Why** | With ~1 KB of headroom, per-merge visibility of the precise gzip delta on the path that produces ~100% of merges is the highest-value observability gain available — it de-risks every JS-touching item in this roadmap. 0 bytes. |
| **Touches** | `scripts/check-bundle-size.mjs` (new), `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml`, `package.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 Server hardening lane: CI build+test, Turnstile hostname forwarding, post-merge deploy and CodeQL dispatch

| | |
|---|---|
| **What** | Add a ~1-minute auto-merge job running `npm ci && npm run build && npm test` in `server/api` — the node:test suite and tsc currently run in **no workflow**, so server type errors surface only during the docker build on the droplet after merge. Forward `TURNSTILE_ALLOWED_HOSTNAMES` in docker-compose's api environment block (one line; the anti-phishing hostname allowlist is silently disabled in production — known defect #2) and remove the `README:118` caveat. In the merge-to-main job, dispatch `deploy-server.yml` when the merged diff touches `server/**` (its push trigger can never fire — GITHUB_TOKEN pushes are suppressed; auto-merge only dispatches deploy.yml today) and dispatch `codeql.yml` so merged code is scanned same-day instead of the following Monday (**codeql.yml needs a `workflow_dispatch` trigger added** — verified absent). |
| **Why** | Closes the largest untested merge surface (auth, sync, GDPR endpoints reach production with zero compile or test gate), restores a designed-in security control, and fixes two GITHUB_TOKEN blind spots. 0 bytes. |
| **Touches** | `.github/workflows/auto-merge.yml`, `server/docker-compose.yml`, `server/README.md`, `.github/workflows/deploy-server.yml`, `.github/workflows/codeql.yml`, `server/api/package.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Server-side wizard-profile sync plus a minimal migration runner (kill the permanent 400 loop)

| | |
|---|---|
| **What** | Add a ~50-line `schema_migrations` table + ordered-SQL runner to `initDb()` in `server/api/src/db.ts` (replacing the documented manual-ALTER-on-live-DB policy) and use it to add a `wizard_profile` JSONB column. Accept/validate/return `wizardProfile` in GET/PUT `/auth/preferences` (size-capped, key-allowlisted, mirroring `sanitizeWizardAnswers`) and include it in the GDPR export — the client already sends, sanitizes and merges the field (`api.ts:127-138` documents the gap). Client: add the one-line `isCustomWizardAnswers` gate in `useWizardProfile`'s debounced save (its own comment at line 24 demands it) so default profiles never sync, and make `syncStatus.ts` treat 4xx as terminal using the status field api.ts already returns, surfacing a distinct "session expired, log in again" state in UserMenu instead of infinite 120 s-backoff retries. Extend server unit tests. **Deploy note:** deploy-server.yml does not auto-fire for auto-merged server changes — dispatch manually after merge, or land IN-2 first. |
| **Why** | Every signed-in user who touches the wizard currently enters a **guaranteed-400 retry loop** — a failing PUT every ~2 minutes, a permanent false sync-error badge, and the priority profile is the only persisted store that never crosses devices (known defect #4). The migration runner unblocks all future schema work. Client delta ~200-400 gzipped bytes. |
| **Touches** | `server/api/src/db.ts`, `server/api/src/auth.ts`, `server/api/src/auth.test.ts`, `src/hooks/useWizardProfile.ts`, `src/utils/syncStatus.ts`, `src/utils/api.ts`, `src/components/UserMenu.tsx`, `src/locales/{fi,en,sv}.json`, `src/__tests__/syncStatus.test.ts`, `src/__tests__/useWizardProfile.test.ts` |
| **Complexity** | Medium |
| **Dependencies** | None (CF-7 reshapes useWizardProfile — coordinate ordering) |
| **Tag** | Claude Code |

### IN-4 Server body-limit fix and authed-endpoint abuse hardening

| | |
|---|---|
| **What** | (1) The global `express.json({ limit: '16kb' })` (`index.ts:48`) contradicts the notes endpoint's own validation allowance of 500 notes × 5,000 chars (~2.5 MB): any user whose notes exceed ~16 KB **can never sync again**, and the PayloadTooLargeError surfaces as a generic 500 because the fallback handler ignores `err.status`. Make the global parser skip `/auth/notes` and `/auth/preferences` and mount a per-route ~1 MB limit there (stacking a second parser doesn't work — the global one runs first); honor `err.status` so 413 reaches the client (api.ts already maps statuses to i18n keys). (2) Rate limits exist only on signup/login — add a modest per-user fixed-window limit on the authed write routes and `GET /auth/export`, reusing `rateLimit.ts`. (3) Add an Origin allowlist on state-changing routes — `POST /auth/logout` is CSRF-able with the SameSite=None cookie. Extend the node:test suite. |
| **Why** | Heavy note-takers — the most invested users — silently lose sync forever with a misleading error; (2)/(3) close the only unprotected abuse surfaces on an internet-facing credentialed API. ~100 gzipped bytes worst case (one fi.json key). |
| **Touches** | `server/api/src/index.ts`, `server/api/src/auth.ts`, `server/api/src/rateLimit.ts`, `server/api/src/auth.test.ts`, `src/utils/api.ts`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | IN-2 (soft — so the new tests actually run in CI) |
| **Tag** | Claude Code |

### IN-5 Repair the quarterly data-refresh workflow end-to-end with a build:data sync gate

| | |
|---|---|
| **What** | The refresh pipeline is provably broken three ways. (1) Raise `data-refresh.yml`'s 10,485,760-byte size gate to a 30-60 MB band — the committed GeoJSON measures **39,276,740 bytes**, so every scheduled run since the all-Finland expansion has failed at validation (known defect #1; the "~1.1 MB" comment is badly stale). (2) Run `npm run build:data` inside the workflow and commit the regenerated `src/data` artifacts alongside the GeoJSON — today only the GeoJSON is committed, so even a merged refresh changes nothing the app loads. (3) Push to a `claude/data-refresh-*` branch instead of a GITHUB_TOKEN PR that triggers zero CI. **Verified caveat:** a branch pushed with GITHUB_TOKEN won't trigger auto-merge either (same recursion guard) — add a `workflow_dispatch` trigger to auto-merge.yml and invoke via `gh workflow run`; note the quarterly push shares the auto-merge concurrency group. Add `timeout-minutes` for the cold ~483-query Overpass run. Then add a build:data idempotency gate to auto-merge (`git diff --exit-code src/data/` after re-running against the committed GeoJSON), first making `build_region_data.mjs`'s `generated` timestamp deterministic (derive from the GeoJSON content hash, not `Date.now()`), mechanically enforcing the CLAUDE.md "never skip build:data" rule. |
| **Why** | The project's only data-freshness mechanism cannot pass its own gates, never propagates to what the app loads, and its output receives zero CI — the committed state has already drifted silently once. 0 bytes. |
| **Touches** | `.github/workflows/data-refresh.yml`, `.github/workflows/auto-merge.yml`, `scripts/build_region_data.mjs`, `scripts/validate_data.py`, `public/data/metro_neighborhoods.geojson` |
| **Complexity** | Medium |
| **Dependencies** | QW-4 (validation must pass on committed state first) |
| **Tag** | Claude Code |

### IN-6 Prerender output regression tests for the ~9,000-page static surface

| | |
|---|---|
| **What** | Nothing asserts the correctness of `prerender.mjs`, `prerender-hubs.mjs` or `generate-sitemap.mjs` output, even though CLAUDE.md documents that the first-match head-token regexes can silently corrupt all ~9,000 pages — and several items in this roadmap edit exactly those code paths. Refactor the page-generation cores into an importable `scripts/prerender-lib.mjs` (prerender.mjs currently executes at import with top-level fs side effects — extract or guard main) and add a Vitest suite against fixture features asserting: exactly one title/canonical/og:url per page, correct trailing-slash + per-language hreflang clusters, every JSON-LD block parses and homepage-scoped blocks are stripped, exactly one FAQPage per profile, the embedded `__naapurustot_profile__` payload parses, and sitemap `<loc>` entries match emitted file paths byte-for-byte. The test must live under `src/__tests__/` (vitest include pattern). Rider: fix `.github/workflows/issue-to-pr.yml:47` to include `src/locales/sv.json` — the current prompt guarantees an i18nKeyParity failure for any automated issue adding user-visible text. |
| **Why** | The prerendered pages are the entire SEO distribution and the most fragile build step; today the only safeguard is eyeballing `build:pages` output. Converts a documented silent-corruption hazard into a CI failure before CF-10/11/12/13/PO-4 touch those scripts. 0 bytes (coverage ratchet only includes `src/**` source — no baseline churn). |
| **Touches** | `scripts/prerender.mjs`, `scripts/prerender-hubs.mjs`, `scripts/generate-sitemap.mjs`, `scripts/prerender-lib.mjs` (new), `src/__tests__/prerenderOutput.test.ts` (new), `.github/workflows/issue-to-pr.yml` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-7 Mobile-viewport Playwright project with an axe gate on the sheet UI

| | |
|---|---|
| **What** | Add a third Playwright project (phone descriptor, e.g. Pixel 7 viewport, `hasTouch: true`) and `e2e/mobile-a11y.spec.ts` that opens the neighborhood bottom sheet, FilterPanel sheet, and LayerSelector sheet, exercises a snap-drag, and runs the same AxeBuilder wcag2a/aa/21aa scan failing on serious/critical. Wire into the auto-merge e2e lane so it gates every merge. Implementation cautions (verified): scope via `testMatch` + `testIgnore` so specs don't double-run across projects; snap-drag needs manual TouchEvent/CDP dispatch (`page.touchscreen` only taps); `package.json`'s `test:e2e` is `--project=e2e` and must include the new project; watch the 5-min globalTimeout with CI workers:1. |
| **Why** | Every mobile code path — the entire bottom-sheet UI — has zero e2e or axe coverage, which is exactly why unlabeled buttons shipped. Locks in QW-6 and PO-3 permanently. 0 bytes. |
| **Touches** | `playwright.config.ts`, `e2e/mobile-a11y.spec.ts` (new), `package.json`, `.github/workflows/ci.yml`, `.github/workflows/auto-merge.yml` |
| **Complexity** | Medium |
| **Dependencies** | QW-6 (must land first or the gate fails on arrival) |
| **Tag** | Claude Code |

### IN-8 Slug-stability safety net: alias registry and redirect stubs for renamed areas

| | |
|---|---|
| **What** | Commit a `src/data/slug_aliases.json` (old slug → pno): when a pno's slug changes (Paavo renames an area), the old slug is preserved and a tiny stub page is written at the old URL with `rel=canonical` + meta refresh pointing at the new `/alue/<slug>/` page, under all three language paths. **Verified design constraints:** deploy builds never commit back, so the diff/update must happen in the data-refresh flow (or `build:data`) via a dedicated `scripts/update_slug_aliases.mjs`, not in prerender.mjs alone; `generate-sitemap.mjs` needs no change (it enumerates only current slugs, so stubs can't leak in by construction). GitHub Pages' 404 fallback returns status 404, so renames currently burn accumulated link equity. Unit test: a renamed fixture produces a stub, not a 404. |
| **Why** | Profile URLs derive from the current GeoJSON `nimi`, so a quarterly refresh that renames an area silently 404s an indexed page — a precondition for the repaired refresh pipeline (IN-5) paying off rather than damaging rankings; valuable for manual GeoJSON updates too. 0 bytes (never imported from client code). |
| **Touches** | `scripts/prerender.mjs`, `scripts/update_slug_aliases.mjs` (new), `src/data/slug_aliases.json` (new), `.github/workflows/data-refresh.yml`, `package.json`, `src/__tests__/slugAliases.test.ts` (new) |
| **Complexity** | Medium |
| **Dependencies** | None (pairs naturally with IN-5) |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Each batch is internally parallel-safe for concurrent Claude Code sessions **with the serialization caveats noted**, and depends only on prior batches. Global caveat for **all** batches: auto-merge shares a concurrency group, so a second `claude/*` push cancels an in-flight merge — develop sessions in parallel but **stagger the pushes**, and re-run the i18n key-parity test after every locale edit.

### Batch 1 — Bundle headroom recovery & CI gate foundations

The measurement and consolidation work that everything JS-positive depends on, plus the honesty fixes that unblock the data pipeline and the a11y gate.

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-1 | Bundle dead-weight sweep | Quick Win | Small | Claude Code |
| CF-7 | Cloud-sync hook factory | Core | Medium | Claude Code |
| QW-4 | Provenance honesty pass | Quick Win | Small | Claude Code |
| IN-1 | Single-source bundle budget + deltas | Infrastructure | Small | Claude Code |
| QW-6 | Mobile sheet a11y + touchcancel sweep | Quick Win | Small | Claude Code |

**Parallel-safety:** locale files are shared by QW-1, QW-6 and QW-4 — merge QW-1 (deletes orphaned keys) → QW-6 → QW-4. `package.json` is shared by QW-1 and IN-1 — QW-1 first. `ci.yml`/`auto-merge.yml` are shared by QW-4 and IN-1 — merge QW-4 first so IN-1's `check-bundle-size.mjs` is the final state of the size gate. CF-7 is collision-free.

### Batch 2 — Independent lanes: prerender base, map core, server, transit grid

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| IN-6 | Prerender output regression tests | Infrastructure | Medium | Claude Code |
| CF-10 | SEO head integrity pass | Core | Medium | Claude Code |
| CF-2 | Map rendering correctness batch | Core | Medium | Claude Code |
| CF-18 | transit_reachability 250 m grid | Core | Large | Claude Code |
| IN-3 | Wizard-profile sync + migration runner | Infrastructure | Medium | Claude Code |
| IN-2 | Server hardening lane | Infrastructure | Small | Claude Code |
| QW-2 | Filter "Best match" fix | Quick Win | Small | Claude Code |
| QW-3 | Comparison table honesty | Quick Win | Small | Claude Code |
| QW-7 | First-run orientation refresh | Quick Win | Small | Claude Code |

**Parallel-safety:** prerender scripts are shared by IN-6 and CF-10 — land IN-6 first (its `prerender-lib.mjs` extraction restructures the scripts), then CF-10 on top. `App.tsx` is shared by CF-2 and CF-10 — merge CF-2 → CF-10. IN-3 follows CF-7 from Batch 1 (it rewrites `useWizardProfile`/`api.ts` the factory consolidated). Locale files are shared by QW-7, IN-3 and CF-18 — merge in that order (distinct keys). QW-2 and QW-3 are collision-free. CF-18 is the only data-pipeline item — start it first (Large; QW-8 in Batch 6 benefits from it).

### Batch 3 — Unlock wave 1: UI trust, price data, workflow repairs

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-1 | Quality Index credibility batch | Core | Medium | Claude Code |
| CF-5 | Back-gesture dismissal | Core | Medium | Claude Code |
| QW-5 | Language-aware internal link mesh | Quick Win | Small | Claude Code |
| CF-15 | Revive frozen rental layer | Core | Medium | Claude Code |
| CF-16 | Double property-price coverage | Core | Medium | Claude Code |
| IN-5 | Repair quarterly data-refresh | Infrastructure | Medium | Claude Code |
| CF-12 | Prerendered ranking pages | Core | Medium | Claude Code |
| CF-13 | Latent-Paavo profile enrichment | Core | Medium | Claude Code |
| IN-7 | Mobile-viewport Playwright + axe gate | Infrastructure | Medium | Claude Code |
| IN-4 | Server body-limit + abuse hardening | Infrastructure | Small | Claude Code |

**Parallel-safety:** `NeighborhoodPanel.tsx` + `App.tsx` chain: merge CF-1 → CF-5 → QW-5. Data-pipeline chain (`prepare_data.py`, registry/provenance, `data_baseline.json`, `validate_data.py`, the GeoJSON + regenerated `src/data`): merge CF-15 → CF-16 → IN-5, re-running `build:data` only in the currently-merging branch. `auto-merge.yml` is shared by IN-5 and IN-7 — merge IN-5 → IN-7. CF-12 (hubs+sitemap) and CF-13 (prerender.mjs only) touch disjoint prerender files, both on the Batch-2 prerender-lib refactor — no mutual collision. IN-4's server files are free now that IN-3 landed. CF-15 carries an owner sign-off note (rental methodology change).

### Batch 4 — Unlock wave 2: landing performance, grid sharding, new data layers

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-17 | Nationwide transit stop density | Core | Medium | Claude Code |
| CF-4 | Next-steps listing/visit links | Core | Medium | Claude Code |
| IN-8 | Slug-stability safety net | Infrastructure | Medium | Claude Code |
| CF-8 | Slim all-Finland landing | Core | Large | Claude Code |
| CF-9 | Shard light-pollution grid + LRU | Core | Medium | Claude Code |
| CF-19 | Radon layer (STUK) | Core | Medium | Claude Code |

**Parallel-safety:** a single merge order resolves every overlap: CF-17 → CF-4 → IN-8 → CF-8 → CF-9 → CF-19. Specifically: pipeline files + registry shared by CF-17 and CF-19 (CF-17 first); `metrics.ts` + locales + regenerated `region_properties.json` shared by CF-4 and CF-19 (CF-4 first); `prerender.mjs` shared by CF-4 and IN-8; `build_region_data.mjs` shared by CF-4 and CF-8; `App.tsx` shared by CF-8 and CF-9. Run `build:data` only in the branch currently merging. CF-19's first step is confirming the STUK dataset license.

### Batch 5 — Share cards, accessibility parity, persistence trust, flood layer

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| PO-4 | Citation infrastructure | Polish | Medium | Claude Code |
| CF-11 | Raster social cards + oEmbed | Core | Medium | Claude Code |
| CF-20 | Flood-risk layer (SYKE) | Core | Medium | Claude Code |
| PO-3 | Keyboard & switch-access parity | Polish | Small | Claude Code |
| PO-2 | Locale-faithful numbers + export completeness | Polish | Large | Claude Code |
| CF-6 | Persistence trust | Core | Medium | Claude Code |

**Parallel-safety:** `prerender.mjs`/`prerender-hubs.mjs`/`package.json` shared by PO-4 and CF-11 — merge PO-4 → CF-11. `LayerSelector.tsx` + locales + `NeighborhoodPanel.tsx` chain: merge CF-20 → PO-3 → PO-2. `App.tsx` shared by PO-2 and CF-6 — merge PO-2 → CF-6. Cross-item gotcha: PO-2 modifies `src/utils/embed.ts`, which CF-11's prerender reads — land PO-2 before finalizing CF-11, or rebase. CF-20 is the only pipeline item in the batch. CF-6's dependencies (CF-7, IN-3) landed in Batches 1-2.

### Batch 6 — Open data, feeds, shortlist UX, final layers

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-21 | THL/Kela health-index layer | Core | Medium | Claude Code |
| CF-3 | Shortlist reachable on phones | Core | Small | Claude Code |
| PO-1 | Scope-honest area summary | Polish | Small | Claude Code |
| QW-8 | Grid-cell hover tooltip | Quick Win | Small | Claude Code |
| PO-5 | Data-updates Atom feed + coverage table | Polish | Medium | Claude Code |
| CF-14 | Open-data program | Core | Medium | Claude Code |

**Parallel-safety:** `prerender.mjs` + `package.json` shared by PO-5 and CF-14 — merge PO-5 → CF-14 (CF-14's llms.txt updates then reflect the feed); PO-5 adds a head `<link>` to `index.html` — respect the head-token regex pitfall and run `build:pages` to verify. `App.tsx` + `NeighborhoodPanel.tsx` + locales chain: merge CF-21 → CF-3 → PO-1 → QW-8. CF-21 is the only pipeline item (pipeline files free after Batch 5). QW-8's `Map.tsx`/`SplitMapView.tsx` are free since CF-2 landed in Batch 2, and its CF-18 dependency landed in Batch 2.

---

## Completed since the 2026-06-03 roadmap

All 36 items of the previous roadmap shipped 2026-06-08 across five batches (`a4e134a` … `812c261`, merged in `bb69348`): honesty/registry fixes, URL version guard, no-data hatch, coverage/freshness/proxy disclosure, affordability calculator + end-to-end scoring (later removed by owner decision, `6078a54`), plain-language area summary, similarity weights, adjacency analysis, percentile filters, national-scope toggles, share-URL polygons, split-map fidelity, GeoJSON/JSON export, shortlist sharing + cards, notes in exports, wizard priority profile, GDPR endpoints, privacy page, data-changes log, per-area social cards (SVG), panel a11y pass. The UX-review batch (`33c5ffd`, O2/O3/X5 dropped) and a performance pass (`0c37dd3`) followed; the bundle budget was raised 256,000 → 280,000 bytes (`d034d4b`) and is nearly exhausted again. A full documentation pass landed 2026-06-10 (`970e5dc`).

---

### Audit method

This roadmap was produced by a 64-agent workflow: 11 parallel subsystem surveys (map/grids, analysis tools, panel/exports, state/sync, backend, pipeline, layer catalog, SEO/prerender, CI/testing, i18n/a11y/mobile, product fresh-eyes + git-history reconciliation) → 6 ideation lenses (relocating household, new data sources, journalists/researchers, UX/mobile, performance/infrastructure, growth/SEO) → a synthesis that deduped 56 raw ideas into 36 candidates → **one adversarial verifier per item** (charged with proving it already shipped, was deliberately removed, or violates the bundle/real-data/granularity constraints — checking file paths, line numbers, git history, and live external APIs/datasets) → a completeness critic that surfaced 8 additional verified items → a sequencing analysis over the verified file lists. 35 of 36 synthesis candidates survived verification (one refuted as a re-proposal of the deliberately-removed green-space layer); all 8 critic additions survived. External facts checked live during verification: StatFin asvu 15fa and ashi 13mu (PxWeb), Sotkanet indicator 5641, Zenodo record 11220980 (travel-time matrix), STUK radon .xlsx, and the SYKE flood-hazard REST service.
