# naapurustot.fi — Feature Roadmap

> Generated **2026-08-27**. **Supersedes the 2026-07-22 roadmap**, which has been almost entirely executed. Item IDs are fresh and do not map to the prior roadmap's.
>
> **Method.** Seven parallel subsystem readers mapped the current tree and re-verified the status of every prior item; five cross-cutting proposal lenses raised ~60 candidates; the survivors were capped at three per category and each surviving claim was re-checked by hand against the working tree — `grep`/`Read` at the cited `file:line`, and direct measurement of `src/data/region_properties.json` (columnar, 3,018 records), the bundle constants, and the CI gates. Numbers here are measured, not estimated.

## What shipped since 2026-07-22 (so it is not re-proposed)

The prior roadmap and the 2026-07-22 UX review both landed in full, and a large amount of new work shipped on top:

- **Data integrity (prior IN-1):** the 13,500 Paavo `-1` suppression sentinels are gone (**17 remain, all genuine change values**); `active_plan_count` zeros became `null` (**905 present / 2,113 null**); `water_proximity_m` is now resident-weighted (distinct 384, no zero cluster); `walkability_index` was recomputed (distinct 75); density-precision false-zeros were fixed for most layers; ranking no longer surfaces null/empty areas as "best".
- **Prior CF-2/CF-1/QW-3:** the national-percentile ladder ships (`src/data/national_percentiles.json`), the content mesh is de-orphaned for crawlers (`area_nav.generated.json`), and `?pno=<regionId>` deep links resolve.
- **Prior IN-2/IN-3:** the `tsc`/ESLint gates are real (`tsc -b --noEmit`), the sitemap is a gzipped `<sitemapindex>` with a 45,000-URL ceiling, and `check-dist-size.mjs` hard-gates both dist profiles.
- **Accounts/billing (new):** password reset/change/email routes + a mailer, a Stripe "naapurustot PRO" tier with server-derived entitlement and dunning, a Bitcoin/Lightning pay path, an operator dashboard, and 116 server tests on the merge lane.
- **`/live/` (new, now a major sub-app):** ~14 realtime feeds (trains, AIS ships, road incidents, FMI temperature/air-quality/radar/lightning/clouds/sea-level/wind/UV, MET Norway rain nowcast) over a single clock and terminator, with terrain-cast shadows.

The result: this roadmap is about **honesty of the numbers already shown, completing the decision funnel, and hardening the now-larger surface** — not net-new features, of which the app already has many.

## Bundle-budget reality (read before implementing anything)

`scripts/check-bundle-size.mjs` enforces two gates, both near their ceilings:

- **`BUDGET = 326,000`** (`:145`) — gzipped sum of all app JS except `maplibre-*` and the `/live/` chunk. Survey-measured **jsTotal ≈ 324,470 (~1.5 KB headroom)**.
- **`LIVE_BUDGET = 40,000`** (`:224`) — the `/live/` sub-app. CLAUDE.md records **38,535 gzipped on 2026-08-25 (~1.5 KB headroom)**.

Read the constants and run `node scripts/check-bundle-size.mjs` after a build for the live figure; do not trust the prose. **IN-1 exists to reclaim ~7.9 KB and remove this constraint for the rest of this roadmap** — sequence it first, and with it merged none of the frontend items below need a BUDGET bump.

## Data integrity & granularity (non-negotiable)

Every value must trace to a real, verifiable, open-licensed source — never fabricated, estimated or placeholder. Prefer postal-or-finer; municipality-distributed or modeled values must be flagged `is_proxy: true`. Suppressed source values (Paavo `-1`) become no-data, never a number. **CF-1 and IN-3 exist because the codebase still breaks this in one place** (the noise floor) and keeps one standing way to break it again (the transit backfill script).

---

## 1 — Quick Wins

### QW-1 · Rescale the all-Finland landing choropleth to the 69-region distribution

| | |
|---|---|
| **What** | `effectiveLayer` (and `effectiveSecondaryLayer`) in `App.tsx` bail out of `rescaleLayerToData` whenever `cityFilter === 'all'` (`App.tsx:873` and `:898`: `if (comparisonScope !== 'region' \|\| cityFilter === 'all' \|\| !filteredData) return base;`), so the 69 seutukunta aggregates are painted with colour stops calibrated to the spread of 3,018 individual postal areas. Call the existing `rescaleLayerToData(base, filteredData.features)` on the all-view too (a national-cohort branch). Mirror in `SplitMapView.tsx`. The comparison-scope toggle is hidden on this view, so this must be default behaviour, not an opt-in. |
| **Why** | This is the first thing every visitor sees. On `quality_index` the 69 regions span ~42–65 against stops built for 0–100, so **64 of 69 land in a single colour band** — the map reads "Finland is uniform", the exact opposite of the product's premise, and looks unfinished. Highest impact-per-byte item on the roadmap; the rescale function is already shipped and hot, so bundle cost is ~0. |
| **Touches** | `src/App.tsx` (`effectiveLayer`/`effectiveSecondaryLayer` memos, ~`:866–901`), `src/components/SplitMapView.tsx`; reuses `src/utils/colorScales.ts` `rescaleLayerToData` as-is |
| **Complexity** | Small |
| **Dependencies** | None. Touches the same memos as any future secondary-layer work — own that region. |
| **Tag** | Claude Code |

### QW-2 · Make the shortlist table's "Set priorities" cell actually open the Finder

| | |
|---|---|
| **What** | In the shortlist decision table, any area with no fit score renders `t('fit.cta')` ("Set priorities") as a bare non-interactive `<span>` (`ShortlistTray.tsx:370`). It looks identical to the `FitForYouBadge` CTA, which for the same string is a real `<button onClick={onSetPriorities}>` (`FitForYouBadge.tsx:113–117`) — but `ShortlistTray` is never passed an `onSetPriorities` prop (its props at `:61` don't include one), so the cell is structurally incapable of doing anything. Thread the wizard-open handler App already owns down to the tray and wrap the cell in a button. |
| **Why** | A silent dead-end sitting inside the very table (shipped as the prior CF-3) built to drive the decision, and the single most natural place to convert a shortlist-holder — a returning, committed user — into a Finder user. A cell that reads as a link and eats every tap trains users to distrust the table. |
| **Touches** | `src/components/ShortlistTray.tsx` (`:368–371`), `src/App.tsx` (pass the existing wizard-open handler to the tray) |
| **Complexity** | Small |
| **Dependencies** | Shares `ShortlistTray.tsx` and the tray's render site in `App.tsx` with CF-2 and PO-1 — serialise (see sequencing). |
| **Tag** | Claude Code |

### QW-3 · Link the running app into the hub / ranking / open-data mesh from the footer

| | |
|---|---|
| **What** | The SPA footer exposes exactly two content links — data-sources (`App.tsx:3354`) and privacy (`:3362`) — and nothing else. There is **zero one-click path from the running app** into the browsable prerendered mesh: the `/kaupungit/` directory, the `/parhaat/` rankings, or the `/avoin-data/` open-data program. Add a small persistent link row (directory, a rankings entry point, open-data) to the footer, lang-aware like the two links already there, and mirror the links into the `<noscript>` block in `index.html` for non-executing crawlers. |
| **Why** | The home surface is the site's highest-authority page, and today it distributes internal-link equity to nothing browsable. The prior CF-1 de-orphaned the mesh's *internal* links for crawlers, but the app's own front door still points at nothing — the surface most visitors (and JS-executing AI agents) actually navigate from. A few links close the gap for humans and pass authority into the ~15,000-page mesh. |
| **Touches** | `src/App.tsx` (footer, ~`:3344–3365`), `index.html` (`<noscript>` mesh links), `src/locales/{fi,en,sv}.json` (new label keys) |
| **Complexity** | Small |
| **Dependencies** | None. Adds a few `fi.json` bytes to BUDGET — trivial once IN-1 has landed. Shares locale files with several items — stagger the merge. |
| **Tag** | Claude Code |

---

## 2 — Core Features

### CF-1 · Give the noise layer a real gradient instead of a 40 dB floor over 74 % of Finland

| | |
|---|---|
| **What** | `fetch_noise_pollution.py:80` defines `BACKGROUND_DB = 40.0` and assigns it (`:443`, `:615`) to every postal area outside a measured traffic-noise contour. **Measured now: 2,234 of 3,018 areas (74.0 %) carry exactly 40.0 dB**; only ~784 have a contour-derived value. The gate already records the intended fix — `validate_data.py:259–265` whitelists `noise_pollution` out of the distinctness check with the comment *"FOLLOW-UP: replace the flat baseline with a distance-to-major-road/rail attenuation model so uncovered areas get a real gradient."* Fetch OSM major-road + rail geometry (the pipeline already uses Overpass for POIs/LIPAS) and model the uncovered 74 % with an ISO 9613-style distance-attenuation from the nearest major road/rail, keeping the measured contour values where they exist. Flag the modeled component **`is_proxy: true`** and remove the distinctness exemption. Re-baseline `data_baseline.json` deliberately. *(Honest interim if the model is deferred: at minimum flip the registry to `is_proxy: true` and rewrite `note.noise_pollution` to state the ~26 % measured / ~74 % modeled split — today the layer ships `is_proxy: false`, `data_sources.json:571–578`.)* |
| **Why** | This is the project's own hardest rule, and the noise layer is its most degenerate `is_proxy: false` metric: three-quarters of the country renders as one flat sheet of an invented constant presented as a direct postal measurement, and `noise_pollution` is a Quality-Index factor and a summary metric, so "quietest 5 %" claims are computed against 2,234 tied fabricated values. A distance-attenuation model turns that flat sheet into a real, decision-relevant gradient — the single largest honesty *and* utility gain in the dataset. |
| **Touches** | `scripts/fetch_noise_pollution.py`, `scripts/validate_data.py` (drop the exemption), `src/data/data_sources.json`, `scripts/provenance.json`, `src/data/data_baseline.json`, `public/data/metro_neighborhoods.geojson`, `src/data/` (via `build:data`), `src/locales/{fi,en,sv}.json` (note) |
| **Complexity** | Large |
| **Dependencies** | Owns the `build:data` regeneration and the `data_baseline.json` re-baseline, so it must land before IN-3 (whose new gate enforces exactly this fix and shares `validate_data.py` + `data_sources.json`). |
| **Tag** | Claude Code |

### CF-2 · Let the landing (`?city=all`) shortlist Compare and export, not just display

| | |
|---|---|
| **What** | On the default all-Finland view the shortlist is a rich sortable table, but Compare and the GeoJSON/CSV/PDF/image exports are **deliberately hidden**: `pnoFeatureMap` is empty under `skipAllFetch`, so `hasGeometry = pnoFeatureMap.size > 0` is false (`App.tsx:3132`) and the exports would no-op, and `handleCompareShortlist` (`:2122`) reads the empty `pnoFeatureMapRef`. The table already lazily loads `shortlistNationalProps` for exactly these areas (`:2101–2115`). Extend that: drive a CSV export and a national-scope Compare from `shortlistNationalProps` (values, no geometry) so the funnel's *act-on-your-decision* step works where the shortlist is actually curated — without triggering the 12 MB national geometry fetch. Keep the geometry-only exports (GeoJSON/image) gated as they are. |
| **Why** | App comments confirm the landing is where returning users, `?sl=` recipients, and the wizard's "add all" actually build the shortlist. A user who curated an eight-area, cross-region shortlist there can sort it but cannot compare or export it — the decision funnel converges on a table it then refuses to act on. This completes the funnel's last mile on its most-used view. |
| **Touches** | `src/App.tsx` (`shortlistNationalProps` ~`:2100–2117`, `handleCompareShortlist` `:2122`, export/compare gating `:3123–3139`), `src/components/ShortlistTray.tsx` (export/compare enablement) |
| **Complexity** | Medium |
| **Dependencies** | Shares `ShortlistTray.tsx` and the `shortlistNationalProps` block in `App.tsx` with QW-2 and PO-3 — serialise (see sequencing). |
| **Tag** | Claude Code |

### CF-3 · Make the Finder's Fit % mean one thing across the hand-off

| | |
|---|---|
| **What** | `NeighborhoodWizard` scores matches with `buildFitRanges(features)` (`NeighborhoodWizard.tsx:88`), which takes raw per-view min/max. The panel badge and the shortlist compute the *same* area's fit through the winsorized `getNationalFitRanges` (`fitScore.ts:93–103`) via `FitForYouBadge`. On the default `?city=all` view the wizard runs national scope but still uses the raw-range function, so the same area shows one % in the Finder result and a different % on the panel it links to. Select `getNationalFitRanges` when scope is national; region scope keeps `buildFitRanges`. |
| **Why** | Wizard result → tap a match → land on its panel is a direct one-tap hand-off and the headline personalization feature — the reason to run the Finder at all. Seeing 82 % in the finder and 76 % on the same area's panel reads as a bug and quietly undermines trust in the whole Fit system. Making the number coherent everywhere completes the feature. |
| **Touches** | `src/components/NeighborhoodWizard.tsx` (`:88`, scope already drives `activeData` at `:186–209`), `src/utils/fitScore.ts` (existing `buildFitRanges` / `getNationalFitRanges`) |
| **Complexity** | Small |
| **Dependencies** | None. File-disjoint from all other items. |
| **Tag** | Claude Code |

---

## 3 — Polish

### PO-1 · Guard the shortlist "Clear" — one tap destroys the curated set on every device

| | |
|---|---|
| **What** | The tray's Clear button is a plain text control with no guard (`ShortlistTray.tsx:300`, `onClick={onClear}`). `onClear → clearShortlist` writes tombstones for the entire list (`useShortlist.ts:140–142`, `addTombstones(TOMBSTONE_KEY, shortlistRef.current)`), so the deletion **syncs to the server and cannot be recovered even after re-login** — unlike the tombstone-free `resetLocal` (`:146`). Add a lightweight confirm, or an undo toast (reuse the existing app-toast window event) that removes the just-written tombstones and restores the array before the 1 s debounced sync fires. |
| **Why** | The shortlist is the funnel's most valuable user asset — a candidate set built over multiple sessions and the strongest argument for holding an account. One mis-tap on an unguarded text button permanently destroys it across all devices, with no recovery path. Near-zero cost for the highest-consequence mis-tap in the app. |
| **Touches** | `src/components/ShortlistTray.tsx` (`:299–303`), `src/hooks/useShortlist.ts` (`:140–146`, expose a tombstone-clearing restore), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | Shares `ShortlistTray.tsx` with QW-2 and CF-2 — serialise. Shares locales with QW-3 — stagger. |
| **Tag** | Claude Code |

### PO-2 · `/live/` sidebar: per-group toggle-all, and a bandwidth cue on "All"

| | |
|---|---|
| **What** | The live sidebar has only an app-wide All / Clear pair (`FeedSidebar.tsx:135`, `:143`, `onSetAll(true/false)`); a group header's only action is collapse (`:77` `toggleGroup`). The per-group on-count is already computed (`:169` `onCount`) but used only as a badge. (1) Add a scoped toggle-all next to each group's count, calling `onSetAll` with the group's feed ids. (2) Surface a one-line bandwidth hint (or a subtle cost glyph on the heavy rows) so "All" — which silently enables the `defaultOn: false` heavy feeds (radar per-instant rasters, AIS ships, road incidents) that ship off precisely for cost — is an informed choice. |
| **Why** | `FEED_GROUPS` is explicitly built to accumulate feeds (weather already holds six), and per-feed toggling doesn't scale to a six-feed group — the count badge already implies a group-level "how many are on". Both fixes are budget-neutral and match the page's stated ethic of being honest about what each feed costs. |
| **Touches** | `src/live/FeedSidebar.tsx` (`:135`, `:168–176`), `src/live/feeds.ts` (expose the already-documented per-feed cost flag), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None. File-disjoint from all non-`/live/` items. Mind `LIVE_BUDGET` (~1.5 KB headroom) — keep the addition to the sidebar chrome, not new feed code. |
| **Tag** | Claude Code |

### PO-3 · Apply the user's custom Quality-Index weights to the landing shortlist's QI column

| | |
|---|---|
| **What** | Quality Index is the shortlist table's headline sort column. On the `?city=all` view the QI shown for shortlisted areas is computed from `shortlistNationalProps` with the **default** weights, while every other surface (map, ranking, panel) reflects the user's tuned weights. Recompute the shortlist's QI through the same `computeQualityIndices` weight path the rest of the app uses (the pattern already exists in `RegionRankingTable`), so the number the returning user trusts to rank candidates matches what they configured. |
| **Why** | A user who tuned the weights sees the shortlist silently contradict every other surface, on the one table whose entire job is ranking their candidates. A quiet correctness gap on the funnel's convergence point; small, and it makes the shortlist honest about the very weights the product invites users to set. |
| **Touches** | `src/App.tsx` (`shortlistNationalProps` computation, ~`:2100–2117`), `src/utils/dataLoader.ts` (`computeQualityIndices` call pattern) |
| **Complexity** | Small |
| **Dependencies** | Edits the same `shortlistNationalProps` block as CF-2 — sequence **after** CF-2. |
| **Tag** | Claude Code |

---

## 4 — Infrastructure

### IN-1 · Reclaim bundle headroom: move `national_ranges.json` + `data_sources.json` to lazy `?url` assets

| | |
|---|---|
| **What** | Two data-only JSON files are pulled into the map-route JS via plain static imports — `national_ranges.json` (`nationalRanges.ts:14`, ~5.0 KB gzipped) and `data_sources.json` (`metrics.ts:4`, ~2.9 KB gzipped) — so **~7.9 KB gzipped of pure lookup data rides in the critical-path bundle**, against ~1.5 KB of BUDGET headroom. Fetch both as `?url` static assets the way the locales, region files and adjacency graph already do (a small preload kick in `App.tsx`), and adjust the reader modules to await them. CLAUDE.md already prescribes exactly this ("keep data out of JS"). |
| **Why** | With ~1.5 KB of headroom, the next map feature — including several items on this roadmap — forces a BUDGET bump that erodes the gate. Reclaiming 7.9 KB (over 5× the current headroom) in one pass buys room for the whole roadmap and keeps the budget meaningful. This is the item that makes every other frontend item here free of budget pressure. |
| **Touches** | `src/utils/nationalRanges.ts`, `src/utils/metrics.ts`, `src/App.tsx` (preload), `scripts/check-bundle-size.mjs` (adjust the measured baseline note) |
| **Complexity** | Medium |
| **Dependencies** | None, but **land it first** so no later frontend item needs a BUDGET bump. Sole editor of `check-bundle-size.mjs`. |
| **Tag** | Claude Code |

### IN-2 · Off-site encrypted database backups — droplet loss is currently total and unrecoverable

| | |
|---|---|
| **What** | `backup.sh` writes gzipped `pg_dump`s only to `BACKUP_DIR=/backups` (`:7`), a bind mount from `./backups` on the **same droplet** (`docker-compose.yml:87`, an `external` volume). Nothing copies them off-box (no `rclone`/`aws`/`scp`/`rsync`/`gpg` anywhere in the script), and `README.md` still lists off-droplet copy as a manual recommendation. Add an encrypted push of each dump to object storage (age/gpg + rclone/S3), gated by env so it stays inert without credentials. The failure-swallowing that made this worse (`|| true`) and the retention race are already fixed — off-site is the whole residual gap. |
| **Why** | The one gap whose downside is unrecoverable rather than merely annoying: a droplet loss takes every account, favourite, shortlist and note — and now the PRO/payment records — with it, and durable cross-device sync is the account system's entire value proposition. The prior roadmap singled this out; the arrival of paying PRO users makes it the most consequential non-user-facing gap on the list. |
| **Touches** | `server/backup.sh`, `server/docker-compose.yml`, `server/.env.example`, `server/README.md` |
| **Complexity** | Medium |
| **Dependencies** | None. The push script is Claude-authorable and inert without env; the item is not *functional* until a bucket + credentials exist. |
| **Tag** | **Manual Setup** (object-storage bucket + credentials) |

### IN-3 · Close the two standing ways to ship fabricated data

| | |
|---|---|
| **What** | Two cheap guards on the project's hardest rule. (1) **Quarantine the transit backfill.** `scripts/fetch_transit_reachability_all.py` fits a linear regression on `transit_stop_density` (its own docstring: R² ≈ 0.58, `:15–25`) and writes *predicted* `transit_reachability_score`s for Tampere/Turku — a modeled estimate of a measured quantity, which the integrity rules forbid. It is correctly **not** applied today (coverage is still 183/3,018, Helsinki-only), but it sits in `scripts/` as a live landmine: one `python … && build:data` would silently replace "honestly absent" with invented numbers, and no gate would catch it (distinctness passes, coverage regression only fires on drops). Hard-guard it (raise unless an explicit override env is set) or delete it. (2) **Add a modeled-constant gate.** The distinctness check is the only guard against a single dominant value, and it relies on a manual `DISTINCTNESS_EXEMPT` allowlist — which is how the noise floor got through by exemption rather than fix. Add a check that any `is_proxy: false` metric whose dominant non-null value is a round modeled constant fails the build unless it is flagged `is_proxy: true` or carries a documented reason. This makes CF-1's fix permanent and catches the next one at build time. |
| **Why** | The validation suite is strong on the failure modes it already knows (sentinels, density precision, dense-urban zeros, provenance vintage), but it has no defence against the two remaining paths to fabrication: a standing script that produces it, and a manual exemption that hides it. Both are cheap to close and directly protect the rule the whole dataset rests on. |
| **Touches** | `scripts/fetch_transit_reachability_all.py`, `scripts/validate_data.py`, `src/data/data_sources.json` |
| **Complexity** | Medium |
| **Dependencies** | The modeled-constant gate must land **after CF-1** (otherwise it fails on the current noise floor) and shares `validate_data.py` + `data_sources.json` with it — serialise behind CF-1. |
| **Tag** | Claude Code |

---

## Considered and pruned (so they are not re-discovered as new)

All verified real, all fair game later; dropped only on the three-per-category cap or on lower impact:

- **Sliding JWT session** — `auth.ts:63` still `expiresIn: '7d'` with reissue only on login/signup/password-change, so an active signed-in user is logged out weekly. Small, App-free; the account system's biggest day-to-day wart, but it only touches the signed-in minority.
- **Sitemap floor guard** — `generate-sitemap.mjs` skips empty URL families silently, so a partial prerender or a population regression could de-index thousands of pages with CI green. There is a *ceiling* guard (45,000) but no *floor*. Add per-family floor counts that hard-fail the build.
- **Density-precision time-bomb** — three density layers (`ev_charging_density` 89.6 % zeros, `sports_facility_density` 42.8 %, `transit_stop_density`) still ship at 1 decimal under a dated `DENSITY_PRECISION_EXEMPT` in `validate_data.py` that **expires 2027-02-28**, after which every `claude/*` auto-merge reddens. Clearing it needs a network re-fetch (which `build:data` cannot do).
- **DB-aware `/health` + API container healthcheck** — `app.ts` `/health` returns a static `ok`; `docker-compose.yml` probes only `db`. An outage or exhausted pool reads as healthy and the container is never restarted.
- **Lightning charge reconciliation** — `lightning.ts` inserts `status='pending'` and credits PRO only from the webhook; a dropped webhook is a paid-but-no-PRO dead end with no chargeback. Add a reconciliation sweep + settle-on-success-redirect.
- **`transit_reachability_score` honest scope** — still 183/3,018 (6 %), Helsinki-only, yet a summary + percentile metric; verify its national claims are population/coverage-floored the way ranking now is.
- **Route tests for the money paths** — signup, login, `GET /export`, `DELETE /account` success still lack direct route tests despite the suite growing to 116.
- **SHA-pin `appleboy/ssh-action`** — `deploy-server.yml:16` uses the floating `@v1` tag while holding the production `DEPLOY_SSH_KEY`; a tag-move supply-chain attack runs attacker code with that key.
- **Dependabot / Renovate** — no `.github/dependabot.yml`; `npm audit`/`pip-audit`/CodeQL are pass/fail on existing state, nothing proposes upgrades.
- **`LivePage.tsx` is 6,166 lines / ~270 KB** — the largest obstacle to adding the next `/live/` feed under a tight budget; a deliberate split (the compositing invariants are easy to break) would pay off, but is large.

**Owner-excluded — do not re-propose:** affordability calculator, neighbour-ring highlight, green-space layer, demographic 250 m grid, OSM building footprints, MML elevation, commute-destination filter, HAME maakuntakaava, national asemakaava from Ryhti (empty until 2029).

---

## Suggested Sequencing

Items within a batch are safe to run as **parallel Claude Code sessions**; batches are ordered so each depends only on prior ones.

**Global rules for every batch.** Auto-merge shares one concurrency group, so **stagger pushes** — a second `claude/*` push cancels an in-flight merge. **`src/App.tsx` and `src/components/ShortlistTray.tsx` are the serialization bottlenecks** — each batch has at most **one owner of each**; where a batch has two disjoint `App.tsx` edits, the merge order is named and the sessions are file-disjoint elsewhere. **Exactly one item runs `npm run build:data`** (CF-1) and **exactly one edits `check-bundle-size.mjs`** (IN-1), both in Batch 1. Re-run the i18n key-parity test after every locale edit and stagger locale merges (flat, append-only keys). Every item is **Claude Code** except **IN-2 (Manual Setup)**.

### Batch 1 — Foundation: reclaim budget, fix the data, independent work

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| IN-1 | Move `national_ranges` + `data_sources` to `?url` assets | Infrastructure | Medium | Claude Code |
| CF-1 | Real noise gradient (OSM road/rail attenuation) | Core | Large | Claude Code |
| CF-3 | Finder Fit % consistency across the hand-off | Core | Small | Claude Code |
| IN-2 | Off-site encrypted DB backups | Infrastructure | Medium | **Manual Setup** |

**Parallel-safety:** file-disjoint. IN-1 owns `App.tsx` (imports + preload), `nationalRanges.ts`, `metrics.ts`, `check-bundle-size.mjs`; CF-1 owns the Python pipeline, the data artifacts, `build:data` and the `data_baseline` re-baseline; CF-3 owns `NeighborhoodWizard.tsx` + `fitScore.ts`; IN-2 owns `server/`. IN-1 is only App.tsx editor here. Land IN-1 first so nothing downstream needs a BUDGET bump; land CF-1 before Batch 2's IN-3.

### Batch 2 — Landing map, integrity gate, live sidebar

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-1 | Rescale the all-Finland landing choropleth | Quick Win | Small | Claude Code |
| IN-3 | Close the two data-fabrication paths | Infrastructure | Medium | Claude Code |
| PO-2 | `/live/` per-group toggle + bandwidth cue | Polish | Small | Claude Code |

**Parallel-safety:** QW-1 owns the `effectiveLayer` memos in `App.tsx` + `SplitMapView.tsx`; IN-3 owns `validate_data.py`, the transit script and `data_sources.json`; PO-2 owns `FeedSidebar.tsx` + `feeds.ts`. QW-1 is the only App.tsx editor. **IN-3 depends on CF-1** (its modeled-constant gate would fail on the un-fixed noise floor, and both touch `validate_data.py`/`data_sources.json`).

### Batch 3 — Footer mesh links + shortlist Clear guard

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-3 | App footer → hub/ranking/open-data mesh | Quick Win | Small | Claude Code |
| PO-1 | Confirm/undo the shortlist Clear | Polish | Small | Claude Code |

**Parallel-safety:** QW-3 owns the `App.tsx` footer (+ `index.html` noscript); PO-1 owns `ShortlistTray.tsx` (Clear) + `useShortlist.ts`. Only QW-3 edits `App.tsx`; only PO-1 edits `ShortlistTray.tsx`. Both add locale keys — **stagger the two merges** (distinct keys, mechanical).

### Batch 4 — Landing shortlist becomes actionable

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| CF-2 | Enable Compare + CSV/PDF on the `?city=all` shortlist | Core | Medium | Claude Code |

**Parallel-safety:** single session — CF-2 owns both bottleneck files at once (`ShortlistTray.tsx` **and** the `shortlistNationalProps` + export/compare-gating region of `App.tsx`), so nothing else can safely run alongside it. Sequenced after Batch 3 because both touch `ShortlistTray.tsx`.

### Batch 5 — Shortlist Finder CTA + custom-weight QI column

| Item | Title | Category | Complexity | Tag |
|---|---|---|---|---|
| QW-2 | "Set priorities" cell opens the Finder | Quick Win | Small | Claude Code |
| PO-3 | Custom QI weights in the landing shortlist column | Polish | Small | Claude Code |

**Parallel-safety:** QW-2 owns `ShortlistTray.tsx` (the fit cell) + the tray's render site in `App.tsx`; PO-3 owns the `shortlistNationalProps` computation region of `App.tsx` (~`:2100–2117`) — a **different, non-adjacent** region, so the two are file-disjoint apart from `App.tsx` (stagger the merge, either order). Both depend on CF-2 (Batch 4): QW-2 shares `ShortlistTray.tsx` with it, and PO-3 refines the `shortlistNationalProps` block CF-2 establishes.

---

### Batch dependency graph

```
Batch 1 ─┬─ IN-1 (frees BUDGET) ─────────────┐
         ├─ CF-1 (fixes noise, owns build:data)┼─▶ Batch 2 ─┬─ QW-1
         ├─ CF-3                               │            ├─ IN-3 (needs CF-1)
         └─ IN-2                               │            └─ PO-2
                                               │
Batch 2 ──────────────────────────────────────┴─▶ Batch 3 ─┬─ QW-3
                                                            └─ PO-1
                                                               │
Batch 3 (ShortlistTray) ─────────────────────────▶ Batch 4 ─ CF-2
                                                               │
Batch 4 (ShortlistTray + shortlistNationalProps) ─▶ Batch 5 ─┬─ QW-2
                                                             └─ PO-3
```

Batches 3–5 are ordered only by the `App.tsx`/`ShortlistTray.tsx` bottleneck, not by logic; if the shortlist trio (QW-2, CF-2, PO-1) were reworked to touch disjoint regions they could compress, but as scoped they must serialise one ShortlistTray owner per batch.

### Method note

Every quantitative claim was verified against the working tree on 2026-08-27: `git log` since 2026-07-22, `grep`/`Read` at each cited `file:line`, and direct measurement of `src/data/region_properties.json` (columnar/1, 3,018 records — noise `40.0 ×2,234`, `active_plan_count` 905/2,113, `transit_reachability_score` 183/2,835) and the bundle/CI constants. One survey candidate was dropped in verification: localizing `/avoin-data/` — `build_open_data.mjs` already emits a **trilingual** landing page (`inLanguage: ['fi','en','sv']`) carried in the sitemap's fi/en/sv pages family, so the gap did not exist.
