# UX Review — naapurustot (Fresh Eyes)

**Date:** 2026-07-22
**Reviewer perspective:** A first-time visitor who knows nothing about the project — most likely arriving on a phone, from Google, in Finnish.
**Scope:** Frontend & user-facing behavior only. Capped at **three findings per category**.

**Method.** A fresh multi-agent pass over current source: two recon agents mapped entry points and failure surfaces, then 15 parallel review lenses (cold arrival · SEO arrival · search · map · panel/compare · save/share · power tools · network errors · auth/sync errors · empty states · loading · mobile layout · mobile touch · keyboard/focus · screen readers · neglected surfaces · data honesty) raised **70 candidate findings**. Each was then attacked by three independent adversarial verifiers — *does the mechanism reproduce in the current tree*, *is it already fixed or duplicated*, *would a real first-timer actually be hurt* — and only findings that **no** verifier could refute were kept. **26 survived**; 18 were refuted outright and are listed at the end so they are not re-found.

> **Two honesty notes on this run.** (1) The verification pass was cut short by an account spend limit before the accessibility and mobile verifier batches finished. The three accessibility findings below were therefore verified by hand against source rather than by the agent panel — each cites a line I read directly. (2) The **empty-states** category genuinely came back thin: only one finding survived, because most empty-state candidates were refuted as already shipped. That section has one item, not three, rather than padding.

> **Relationship to the prior review.** The 2026-07-17 review's 19 findings were all implemented in `0484d99`. Every one was re-checked against source; none is restated here.

**Severity legend** — *Critical:* actively misleads or breaks a core action for a whole class of users. *High:* frequent friction or a "this is broken" moment most first-timers hit. *Medium:* noticeable confusion for many.

**Counts: 1 critical · 13 high · 4 medium (18 findings).**

> **Status: all 18 implemented (2026-07-27), on `claude/ux-review-impl-2026-07-22`.** Batch 1 = CF-1, CF-2, ER-2, ER-3, EM-1, AY-3; Batch 2 = LO-1, LO-2, MO-3, ON-3; Batch 3 = AY-1, AY-2, MO-2, ER-1; Batch 4 = CF-3, ON-1, MO-1, ON-2. Two deviations from the prescribed fixes, both documented at the call sites: MO-2's back-gesture half had already shipped in the feature roadmap's PO-1, so only the Escape gap remained (added to App's cascade rather than to `RegionRankingTable`, so one cascade owns the order); and ON-3 ships the disclosure only — a real reset route is still **[Manual Setup]** (email provider + token table).

---

## TL;DR

Four patterns, in order of how much they cost:

1. **The app tells the user things that are not true.** Choosing "Ilmanlaatu" outside Helsinki drains the whole choropleth to bare basemap while the legend still shows a full colour ramp (**CF-1**). Rising unemployment and rising crime render in green with an up-arrow (**CF-2**). A failed zoning fetch renders as "no plans here" and caches that emptiness (**ER-3**). These are not missing features — they are confident wrong answers.
2. **Silent, unrecoverable async failures.** One dropped 40 KB request kills search for the whole session behind a permanent fake "Ladataan…" (**ER-1**); a *stalled* first fetch pins the visitor on a branded shimmer with no timeout and no retry (**LO-2**); the installed PWA can't open offline because every `.json` data asset escapes both service-worker caches (**ER-2**).
3. **First paint promises a map that isn't there yet.** The cold overlay lifts when the *data* resolves, not when MapLibre paints, so a mid-range phone gets a blank page with a "👆 tap an area" hint over nothing (**LO-1**).
4. **Mobile and keyboard users lose the thread of what they're looking at.** The peek bar shows a naked number while the only two elements naming the active metric are hidden (**MO-1**); Android Back exits the site from two overlays (**MO-2**); "Skip to content" skips nothing (**AY-1**); type-ahead in the region picker fires global shortcuts (**AY-2**).

**If you fix five things:** CF-1, CF-2, ER-1, LO-1, MO-1.

---

## 1. Onboarding

### ON-1 — Every "open this on the map" CTA from the ~9,000 SEO pages silently suppresses onboarding · **High** · [Claude Code]
**Problem.** The largest cold cohort arrives from Google on a prerendered page and enters the app through a CTA carrying `city` and/or `layer` (`/?city=tampere&layer=quality_index`). The tour's bail condition treats *any* `layer` or a non-`all` `city` as "a shared, configured link meant to present specific content", so the tour never starts. That rationale is right for a genuinely personal link (a comparison, a filter set, a drawn polygon) but wrong for a generic "open the map here" link. These visitors land in an unfamiliar choropleth with a header of unlabeled icon menus and a 76-layer selector, and are never oriented to the layer selector or the legend. (The on-map "tap an area" hint pill *does* still show, so the core tap interaction is taught — everything else is not.)
**Where.** `src/App.tsx:2044-2060` (bail condition), `:2065`; CTAs at `scripts/prerender-hubs.mjs:806-807,976,1108,1733`.
**Fix.** Split the condition: only `pno`, `compare`, `filters`, `shortlist`, `weights`, `isochrone`, `draw`, `wizardProfile`, `simWeights`, `ref`, `affordability` and `viewport` should count as "configured". A URL whose only structured params are `city` and/or `layer` should still start the tour.

### ON-2 — The tour's "Seuraava" button is a silent no-op for the first seconds of every cold visit · **Medium** · [Claude Code]
**Problem.** The tour starts immediately, above the loading overlay, but `advance()` refuses to reach the first *anchored* step until `chromeReady` (`firstLoadDone`) — via a bare `return`. During that window the Next button has no disabled state, no spinner and no `aria-busy`, and the full-screen click-blocker routes to the same dead `advance()`. So the very first interaction a first-time visitor performs produces no response at all, and tapping harder doesn't help.
**Where.** `src/components/OnboardingTour.tsx:128-132` (dead `advance`), `:311-317` (click-blocker), `:387-392` (Next button); gate at `src/App.tsx:685-702`.
**Fix.** Derive `blocked = !chromeReady && steps[stepIndex + 1]?.anchors.length > 0` and surface it *in the popover* (not only on the button): disable Next with an inline spinner plus `aria-busy`, so the hold is visible and the click-blocker's silence is explained.

### ON-3 — Signup demands a 12-character password that can never be reset, and never says so · **Medium** · [Claude Code] + [Manual Setup]
**Problem.** Signup requires a 12-character password entered twice and pitches the account as syncing favorites, shortlist and notes across devices — which reads as a backup. But the API has **no forgot/reset route at all** (signup, login, logout, export, delete, me, data endpoints — nothing else). Forgetting the password permanently costs the cloud copy and all cross-device access, and nothing in the flow warns the user before they commit. (The optional email is already correctly disclosed as *not* used for recovery — that part is fine, which is exactly why the absence of any recovery path needs saying out loud.)
**Where.** `src/components/AuthModal.tsx:236,270` (minLength 12); `server/api/src/auth.ts:97,187,232,310,369,394` (full route list).
**Fix.** *[Claude Code]* Add one line under the password field in signup mode: this password cannot be reset — save it in a password manager. Copy-only, three locale files. *[Manual Setup]* A real reset flow needs an email provider (SMTP/API credentials) plus a token table before the route can exist.

---

## 2. Core flows

### CF-1 — Picking "Air quality" outside Helsinki drains the entire map to bare basemap · **Critical** · [Claude Code]
**Problem.** Air quality and transit reachability are grid-backed, but their grid files cover only the Helsinki bbox. `useGridData` fetches that Helsinki file regardless of region, and App clips it to the current region, yielding `{...raw, features: []}` — a **non-null object**. `useGrid` is computed as `!!gridData && !!layer.gridProperty`, which is true for an *empty* grid, so the postal choropleth is swapped to `buildFillOpacityFadeOut`, driving fill-opacity to 0 at zoom ≥ 8.5. Every region preset zoom is 8.5–9.2. A first-timer in Tampere or Oulu taps "Ilmanlaatu" and the map goes blank at desktop preset zoom (near-blank on a phone, fully blank on any zoom-in) — while the legend still shows the full colour ramp and a "fine-grained grid" badge. Air quality has **100 % postal coverage nationally**: real data exists and is being hidden. The default `?city=all` view is unaffected.
**Where.** `src/components/Map.tsx:820,887-895` (and mirrored checks at `:1158,:1268`), `src/utils/gridFade.ts:18-19`, `src/data/grid_manifest.json`, `src/utils/regions.ts:132-159`, `src/components/Legend.tsx:140-145`.
**Fix.** Gate on cell count, not object identity: `!!gridData && gridData.features.length > 0 && !!layer.gridProperty`. (Equivalent cheaper fix: have `App.tsx:480` set `null` instead of an empty FeatureCollection when the clip yields zero features.)

### CF-2 — Rising unemployment and rising crime are coloured green · **High** · [Claude Code]
**Problem.** In an area panel's "Kehityssuunnat", `Työttömyysaste +18.2 % ↗` renders in green, `Rikollisuus +25.0 % ↗` renders in green, and a *falling* crime rate renders in red. `TrendChart` colours the change label purely on the sign of the number, with no notion of metric polarity — so for two of the five trends it charts, the hue signals the opposite of the truth to a house-hunter scanning for green. Everything else in the app is polarity-aware (`comparisonStats.refDeltaOf` takes `higherIsBetter`), which makes this the one remaining surface that lies. The number, arrow, plotted line and screen-reader text are all correct — only the hue is inverted.
**Where.** `src/components/TrendChart.tsx:76-81` (colour from sign alone), `:5-11` (no polarity prop), `:246-252` (unemployment), `:263-271` (crime); contrast `src/utils/comparisonStats.ts:86-90`.
**Fix.** Add `higherIsBetter?: boolean` to `TrendChartProps`; compute `good = higherIsBetter === false ? changePct < 0 : changePct > 0` and drive **only the emerald/rose class** from `good`. Do *not* flip the ↗/↘ glyph — it is factually correct and matches both the plotted line and the aria-label.

### CF-3 — "Delete account" leaves everything on the device, and it gets uploaded into the next account · **High** · [Claude Code]
**Problem.** The confirmation reads "This permanently deletes your account and all saved data (favorites, shortlist, notes, presets). This cannot be undone." You confirm; the menu closes silently; every starred area is still in the favorites dropdown, the shortlist tray is still floating over the map, every private note is still on its area panel. `deleteAccount` is passed straight through, so none of the six local stores are cleared — unlike logout, which wipes all of them. Worse, those survivors are merged upward into the **next account created on that device**, so "deleted" notes and favorites reappear in a brand-new cloud account. (Server-side deletion does work; the defect is local residue plus re-upload.)
**Where.** `src/components/UserMenu.tsx:76-90`, `src/App.tsx:2456`, `src/hooks/useAuth.ts:113-121`; the wipe it should mirror at `src/App.tsx:575-588`; re-upload via `src/hooks/useFavorites.ts:99-126`.
**Fix.** Wrap `deleteAccount` exactly as `handleLogout` is wrapped — run the six `reset*Local` calls plus `clearRecent` and `resetSyncStatus` on success — and show a brief confirmation before closing the menu.

---

## 3. Error states

### ER-1 — One dropped request kills search for the whole session, behind a permanent fake "Ladataan…" · **High** · [Claude Code]
**Problem.** On the default all-Finland landing the region dataset is deliberately not fetched, so the search box's only source is the lazily-fetched `region_search_index.json`. `useSearchIndex` fires that request once with `[]` deps and swallows failure in an empty `.catch` — the hook stays `null` forever. `indexLoading = !searchSource` is then permanently true, so typing anything ≥ 2 characters renders "Ladataan aluetietoja…" indefinitely, and that same flag suppresses both the honest no-results branch and any error affordance. A visitor on a flaky connection types "Kallio", waits, retypes, and concludes the site is broken. The cache is already evicted on failure, so a second call would succeed — nothing ever makes one. (`useMapData`'s `retry` does not help: it evicts the cache but the hook never refetches. Choosing a concrete region also restores search — an undiscoverable workaround, not a fix.)
**Where.** `src/hooks/useSearchIndex.ts:21-38`, `src/components/SearchBar.tsx:165,599-605,610`, `src/utils/dataLoader.ts:265-283`.
**Fix.** Return `{ index, failed, retry }` from `useSearchIndex` — set `failed` in the existing `.catch`, expose `retry()` that re-calls `loadSearchIndex()`. In SearchBar, when `failed`, render a retry row exactly like the existing `search.address_unavailable` block at `:582` instead of the perpetual loading row.

### ER-2 — The installed PWA cannot open offline: every core `.json` data asset escapes both caches · **High** · [Claude Code]
**Problem.** The app advertises `display: 'standalone'` and precaches the JS/CSS shell, so a returning user launches the installed app in a tunnel and gets an instant shell — then a red "loading failed" banner over an empty map. The precache glob is `['**/*.{js,css,ico,png,svg}']` and the runtime rule matches only `/\.(topojson|geojson)(\?|$)/`, but the assets gating first paint are `.json`: `region_aggregates.json` (first paint) and `region_search_index.json` (search) block the landing outright; `region_properties.json` and `adjacency.json` silently degrade specific features. An English or Swedish user additionally gets a locale-failure banner and a Finnish UI, since `en.json`/`sv.json` are uncached too.
**Where.** `vite.config.ts:170` (globPatterns), `:202-211` (runtimeCaching urlPattern), `:214-235` (manifest); consumers at `src/utils/dataLoader.ts:32,38,46`, `src/utils/i18n.ts:20-21`, `src/utils/adjacency.ts:17`.
**Fix.** Extend the StaleWhileRevalidate rule to `/\.(topojson|geojson|json)(\?|$)/` and raise `maxEntries` above 20 so region shards don't evict the aggregates.

### ER-3 — A failed zoning fetch renders as "no plans here" — and caches that emptiness for the session · **High** · [Claude Code]
**Problem.** Someone checking whether a building site is planned next to a prospective home turns on "kaavat ja hankkeet". The toggle is only offered when the app already knows plans exist there. `App` discards the hook's `loading` flag, so there is no spinner. Each shard has `.catch(() => [])`, and the merged — possibly empty — result is written to `geoCache`, so a single flaky shard produces a blank overlay cached for the rest of the session: toggling off/on or switching region and back keeps showing nothing. The user reasonably reads absence-of-plans from what is actually a network error, next to a fully rendered legend and an honest-looking coverage caption. That is a data-honesty failure, not a missing spinner.
**Where.** `src/hooks/usePlanningData.ts:96,101-115` (catch at `:102`, cache write at `:107`; same pattern in `usePlanningArea` at `:148,152-155`), `src/App.tsx:340` (loading discarded); precedent for the fix at `src/App.tsx:332-334` (`isochroneError`).
**Fix.** Track per-shard failure: if any shard rejects, do not write to `geoCache`, and return an `error` flag alongside `features`. Surface `loading` and `error` in `PlanningControls` — a spinner while fetching, and a retryable "kaavatietoja ei saatu ladattua" note instead of an empty overlay.

---

## 4. Empty states

*Only one finding survived here — the app's empty states are largely well-covered, and several candidates (the no-data hatch legend key, the shortlist and favorites empties) were verified as **already shipped** and refuted.*

### EM-1 — Layer search with no matches renders a completely blank panel, and can't match accented Finnish labels · **High** · [Claude Code]
**Problem.** The onboarding tour points a first-timer straight at the Layers panel. Faced with 76 layers they type into the search box. Every group whose filtered list is empty returns `null`, so when nothing matches the panel body renders as **pure empty space** below the input — no "no matching layers", no count, no explanation. On mobile that's a bottom sheet containing a text box over blank white, with no way to tell whether the query missed or the app broke. It's easy to hit because — unlike `SearchBar` and `CitySelector`, which both use `fold()` — the layer filter is a plain `.toLowerCase().includes()`, so typing "vaesto", "aanestys" or "ika" without diacritics matches none of the Finnish labels containing ä/ö.
**Where.** `src/components/LayerSelector.tsx:156,169,270,325-330,404-432,468-474`; contrast `src/components/CitySelector.tsx:4,57-59` and `src/components/SearchBar.tsx:7`.
**Fix.** Add a zero-result block after the `LAYER_GROUPS.map` that renders a short "no layers match '{query}'" line, and wrap both sides of the match in `fold()` from `utils/slug`. Note a clear-search **X already exists** at `:254-264` — the missing piece is the explanation, not the escape hatch.

---

## 5. Loading states

### LO-1 — The cold overlay lifts when the data is ready, not when the map is ready · **High** · [Claude Code]
**Problem.** On a cold arrival the branded overlay is dismissed the moment the small aggregate and outline fetches resolve — `effectiveLoading` is derived purely from `allViewReady`. Nothing in App knows whether MapLibre has rendered: `<Map>` is `React.lazy` behind `<Suspense fallback={null}>` and is passed no ready callback. The data path is ~180 KB + ~486 KB of pre-quantized JSON; the map path is maplibre-gl (~260 KB gz) plus parse, WebGL context creation, style load and first raster tiles. On a mid-range phone the data reliably wins that race, so the overlay unmounts onto an empty page background with a floating header, a search box and a legend — no map. Worse, `firstLoadDone` latches, so the slim progress bar never appears for the map either, and the "👆 tap an area" hint fires on `!effectiveLoading` — instructing the user to tap a map that has not painted.
**Where.** `src/App.tsx:669`, `:700-702`, `:2309-2314`, `:2350`, `:2593`; the `'load'` handler that already sets `mapStyleLoadedRef` is at `src/components/Map.tsx:507-508`.
**Fix.** Add an `onReady` prop to `Map`, fired from the `'load'` handler at `Map.tsx:507` (better: from `ensureLayers`, so the choropleth — not just the basemap — has been added). Store it as `mapReady` and change the overlay condition to `(effectiveLoading || !localeReady || !mapReady) && !firstLoadDone`; gate the hint pill on `mapReady` too.

### LO-2 — A *stalled* first fetch pins the visitor on a branded shimmer forever, and swallows their clicks · **High** · [Claude Code]
**Problem.** `loadAllAggregates` has no timeout and no AbortController; the hook leaves its loading state only on resolve or reject. A request that **stalls rather than fails** — the normal failure mode on flaky mobile networks — never does either. `effectiveLoading` stays true, `firstLoadDone` never flips, and the full-screen overlay stays mounted indefinitely: wordmark, three pulsing grey blocks, "Ladataan koko maan aineistoa…", forever. It is a plain div with no `pointer-events-none`, so it also swallows clicks on the header, search bar and layer FAB behind it. No banner fires (nothing rejected), no retry, no changing copy. The same unbounded wait traps a cold single-region or deep-link arrival, since `useMapData` has no timeout either. The codebase already uses grace timers for exactly this class of hang at `App.tsx:1443-1455`.
**Where.** `src/App.tsx:2350-2363`, `:669`, `src/hooks/useAllCitiesAggregates.ts:34-41`, `src/utils/dataLoader.ts:239-248`.
**Fix.** Add a ~12 s grace timer while `effectiveLoading && !firstLoadDone`; on expiry render a "this is taking longer than usual" line plus a Retry button wired to the already-existing `effectiveRetry` (`App.tsx:671`, currently unused by the overlay), and set `pointer-events-none` on the shimmer wrapper.

---

## 6. Mobile

### MO-1 — Tapping an area shows a naked number while every element naming the metric is hidden · **High** · [Claude Code]
**Problem.** On touch, tapping an area opens the peek bar, which renders `effectiveLayer.format(v)` and nothing else identifying the metric. In the same render the Legend is hidden (`hidden={!!selected || !!peek}`) — and so is the Layers FAB — so the only two on-map elements carrying the active layer's name disappear exactly when the value appears. Many formatters emit a bare number with no unit (`age` is reused for air quality *and* health index; also `gini`, `score`). The user sees "Kallio / 23.7 ▲ vs. keskiarvo" with nothing on screen saying whether 23.7 is air quality, morbidity or average age. The polarity-coloured arrow makes it worse: it implies a good/bad judgment about a quantity the user cannot name.
**Where.** `src/App.tsx:2611-2643` (peek bar), `:2660` + `src/components/Legend.tsx:89`, `:2578` + `src/components/LayerSelector.tsx:437` (FAB), `src/utils/colorScales.ts:186,193,194`.
**Fix.** Add the metric name to the peek bar — `<div className="text-[10px] uppercase opacity-60">{t(effectiveLayer.labelKey)}</div>` above the value line.

### MO-2 — Android Back exits the site from the region-comparison table and the scatter modal · **High** · [Claude Code]
**Problem.** Every other overlay is back-dismissable, but `showScatter` and `showRegionRanking` are missing from the `anyOverlayOpen` list that arms the history sentinel. A phone user opens Työkalut → "Seutukuntien vertailu", sees a panel covering most of the map, and presses Back — the browser leaves naapurustot.fi entirely and the whole session (region, layer, shortlist view state) is gone. The correlation modal is worse: it's a full-screen `fixed inset-0` overlay, so Back is the most obvious escape and it exits the site. On desktop the region table also ignores Escape — its only exit is a 28 px × icon. (The scatter modal *does* already handle Escape and backdrop click via its own capture-phase listener; the Back gap applies to both.)
**Where.** `src/App.tsx:2193-2206` (Escape cascade), `:2252-2254` (`anyOverlayOpen`), `src/hooks/useBackGesture.ts:41-48`, `src/components/RegionRankingTable.tsx:113-148`.
**Fix.** Add `showScatter` and `showRegionRanking` to `anyOverlayOpen` and to the `closeTopmost` cascade, next to `showFilter`/`showRanking`; add Escape handling to `RegionRankingTable`.

### MO-3 — Pinning the second area for comparison gives no confirmation, and the comparison is hidden · **Medium** · [Claude Code]
**Problem.** On mobile the user taps an area, taps "Lisää vertailuun", taps a second area, taps "Lisää vertailuun" — and sees nothing happen. The comparison sheet and the area sheet both anchor `bottom-0 z-20`, so the comparison sheet hard-hides itself whenever an area is selected, and the 1-pin nudge pill is suppressed on mobile. The only feedback is the button text flipping to "Vertailussa". Nothing signals that *closing the sheet* is what reveals the comparison. It is not a dead end — closing the sheet does work, and on mobile it occupies the same bottom band so closing is a natural next step — but at the moment the pin lands there is no confirmation and no count.
**Where.** `src/components/ComparisonPanel.tsx:512` (`areaPanelOpen ? 'hidden' : ''`), `:278` (`!hidden md:!flex`), `src/App.tsx:2850`, `src/components/NeighborhoodPanel.tsx:1088`.
**Fix.** When the pin lands on a coarse pointer, render a one-line tappable confirmation in the panel header — "2/3 vertailussa — näytä vertailu" — that closes the sheet and reveals the comparison.

---

## 7. Accessibility

*Verified by hand against source (the agent verifier batch for this category was cut short); each cites a line read directly.*

### AY-1 — There is no `<main>` landmark, and "Skip to content" skips nothing · **High** · [Claude Code]
**Problem.** The first Tab stop is the "Siirry sisältöön" skip link (`index.html:336`, `href="#main"`). Activating it focuses `#main` — but that element *is the whole app*: `<div id="main" tabIndex={-1} className="h-dvh w-screen …">` wraps everything including the `<header>`. So the next Tab lands on the header controls the link was supposed to skip past. There are **zero** `<main>` elements in `App.tsx`, so screen-reader users also get no main landmark to jump to.
**Where.** `src/App.tsx:2282` (root wrapper), `:2386` (header inside it), `index.html:336`.
**Fix.** Move the id/tabIndex off the root wrapper — keep the layout root a plain div with `data-testid="app-root"`, and wrap the post-header content (`App.tsx:2491` onward) in `<main id="main" tabIndex={-1} className="focus:outline-none">`.

### AY-2 — Type-ahead in the desktop region picker fires global commands · **High** · [Claude Code]
**Problem.** The desktop region picker is a native `<select>` with ~70 options, so the natural way to reach "Salon seutukunta" is to Tab to it and type the first letters. But App's global single-key shortcut handler excludes only `INPUT`, `TEXTAREA` and contentEditable — **`SELECT` is not excluded**, and keydown bubbles to the window listener. So typing to find your region also fires: `s` → flips to split-map view, `l` → opens the login modal, `g` → prompts for your location, `c` → opens the quality-weights panel, `f`/`r`/`w` → toggle filter/ranking/wizard. A keyboard user trying to change region detonates half the app.
**Where.** `src/App.tsx:2212` (guard), `:2222-2240` (the shortcuts), `src/components/CitySelector.tsx:75-87` (native `<select>`).
**Fix.** One line — add `SELECT` to the guard: `if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;`

### AY-3 — The account menu and mobile region menu can't be closed by keyboard, and don't announce themselves · **High** · [Claude Code]
**Problem.** `UserMenu`'s dropdown — containing sign-out, GDPR export and delete-account — is dismissed **only** by a document `mousedown` listener. There is no Escape handler anywhere in the file, no focus move into the menu, and the trigger has no `aria-expanded`/`aria-haspopup`. `CitySelector`'s mobile region popover is identical. A keyboard or screen-reader user who opens either has no way to close it, and no announcement that anything opened. `ToolsDropdown` already implements the correct pattern in this repo (Escape + `stopPropagation` + `aria-haspopup="menu"` + `aria-expanded`), so this is an inconsistency, not a missing capability.
**Where.** `src/components/UserMenu.tsx:103-112` (mousedown only), `:116-139` (trigger); `src/components/CitySelector.tsx:62-70`, `:91-111`; the good pattern at `src/components/ToolsDropdown.tsx:78-79,142-143`.
**Fix.** Copy the `ToolsDropdown` pattern into both: a document keydown listener while open that on Escape calls `stopPropagation()` + `stopImmediatePropagation()`, closes, and refocuses the trigger ref; add `aria-haspopup` and `aria-expanded` to both triggers, and make the mobile region trigger's accessible name include the active region.

---

## Refuted — do not re-report

These were raised by a lens and killed by verification. Recorded so a future pass doesn't resurface them:

**Already shipped:** the in-app value proposition (the tour auto-opens for every cold arrival with no configured URL state); the no-data hatch *is* in the legend with an explanatory string; the prerender first-paint skeleton; search rows *do* echo the selected name back into the input; the collapsed layer-group state is mitigated by the tour and the quality-index group being open by default.
**Factually wrong:** "signup is a guaranteed dead end because `VITE_TURNSTILE_SITE_KEY` is unset" — `.env` is a tracked file and Vite loads it at build; "logout has no way back" — favorites are always persisted locally, independent of auth; "export buttons do nothing when their chunk fails" — `ShortlistTray` and `export` are statically imported; "notes say 'Saved' while the cloud save fails" — an expired session signs the user out before that state is reachable; "the region-comparison download is 12 MB" — it is ~1–2 MB over the wire after compression.
**Real but below the bar:** the mobile search field is 208 px wide; "Copy share link (includes filters)" drops filters when an area is selected (a more prominent adjacent affordance covers it); three adjacent controls are all named "vertail-" something.

**Also verified real but pruned by the three-per-category cap** (fair game next pass): the radar chart's unexplained dashed average polygon and its silently inverted "Asuminen" axis; profile-page service/density stats losing their units; the percentile ranking Google promises in the snippet never appearing on the page; the correlation explorer charting 69 sub-region averages while calling them "areas within this area"; quality-index weight sliders changing nothing visible while another layer is active; bottom sheets keeping their pre-rotation height on orientation change (header and close button end up off-screen); the iPhone keyboard covering the visit-notes field; the Layers FAB overlapping the comparison sheet; landscape safe-area padding on notched iPhones; screen-reader silence when a search returns zero results; the comparison table's missing `scope="col"` / `<th scope="row">`; the peek bar's `aria-hidden` swallowing the "vs. average" text; `translate="no"` on `<body>` disabling browser translation across all ~9,000 profile pages.

---

## Suggested Sequencing

Items within a batch are safe to run as **parallel Claude Code sessions**; batches are ordered so each depends only on prior ones. `src/App.tsx` is the serialization bottleneck — it is touched by nine findings — so **each batch contains exactly one App.tsx-owning session**, and everything else in that batch is file-disjoint from it.

Two standing cautions: (a) `src/locales/{fi,en,sv}.json` are shared by several items — keys are flat and append-only, so conflicts are mechanical, but stagger those edits if two sessions in a batch both add copy; (b) auto-merge shares one concurrency group, so stagger the pushes.

**Batch 1 — Independent files, highest impact.** *(6 parallel; only ER-3 touches App.tsx, at one prop-wiring line)*
- **CF-1** Gate `useGrid` on cell count — `Map.tsx`
- **CF-2** Polarity-aware trend colour — `TrendChart.tsx`
- **ER-2** Cache `.json` in the service worker — `vite.config.ts`
- **EM-1** Layer-search zero-result message + `fold()` — `LayerSelector.tsx` *(+locales)*
- **AY-3** Escape + ARIA on the two dropdowns — `UserMenu.tsx`, `CitySelector.tsx`
- **ER-3** Don't cache failed planning fetches; surface loading/error — `usePlanningData.ts`, `PlanningControls.tsx` *(owns `App.tsx:340`)*

**Batch 2 — First-paint truth.** *(3 parallel; only the first touches App.tsx. Depends on Batch 1: LO-1 edits `Map.tsx`, which CF-1 changed.)*
- **LO-1 + LO-2** Map-ready gating and a stall timeout/retry on the cold overlay — `App.tsx`, `Map.tsx` *(+locales)*
- **MO-3** Pin confirmation on mobile — `ComparisonPanel.tsx`
- **ON-3** "This password cannot be reset" copy — `AuthModal.tsx` *(+locales)* · **[Manual Setup]** for the actual reset route (email provider credentials + token table)

**Batch 3 — Global handlers & document structure.** *(2 parallel; only the first touches App.tsx)*
- **AY-1 + AY-2 + MO-2** `<main>` landmark, `SELECT` in the shortcut guard, and the two overlays added to the back/Escape cascades — `App.tsx` *(+`RegionRankingTable.tsx` for Escape)*
- **ER-1** `useSearchIndex` failure + retry — `useSearchIndex.ts`, `SearchBar.tsx` — *note: if the hook's new signature needs a call-site change at `App.tsx:2493`, let this batch's App.tsx session own that line*

**Batch 4 — Remaining App.tsx cluster.** *(1 session)*
- **CF-3** Wipe local stores on account delete · **ON-1** Narrow the tour's bail condition · **MO-1** Metric name in the peek bar — `App.tsx`, `UserMenu.tsx` *(+locales for MO-1)*

All 18 items are **[Claude Code]**; only ON-3's real password-reset flow additionally requires **[Manual Setup]**.
