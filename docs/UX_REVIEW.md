# UX Review — naapurustot (Fresh Eyes)

**Date:** 2026-06-03
**Reviewer perspective:** A first-time visitor who knows nothing about the project, arriving cold at naapurustot.fi.
**Method:** Seven parallel read-throughs of the frontend (one per dimension below) plus a completeness sweep, each grounded in the actual source with `file:line` references, then manually spot-verified against `App.tsx`, `SearchBar.tsx`, `useMapData.ts`, `useGridData`, `ErrorBanner`, `OnboardingTour`, `useBottomSheet`, and `e2e/a11y.spec.ts`.
**Scope:** Frontend & user-facing behavior only.

---

## Implementation status (2026-06-08)

This review has now been **implemented** (branch `claude/ux-review-fixes`, executed in the review's own batch order). i18n: 27 new keys + 3 reworded onboarding strings across fi/en/sv. Verified: `tsc -b` clean, ESLint clean, 2419/2419 Vitest tests pass, production build green, gzipped app-JS bundle 278,914 B (≤ 280,000 B budget — now only ~1 KB headroom, keep future additions minimal).

- **Implemented (all severities):** C1, L4, EM5, A6, MO1, EM6, MO4, C11, A3 (global `:focus-visible` + per-component rings on Tools/Settings/panel/AuthModal), A4, MO6, E5, E3, A5, E4, L5, A8, C5, C9, A7, E8, O7, O6, O4, O5, A1, O1/EM1/EM4, C6, MO5, E6, E9, C4, C7, C8, C10, C2, X1, X3, L2, EM3, L1, L3, L6, L7, E1, E2, E7, MO2, MO7, MO3, C3/EM2, X4, and the Claude-Code-doable parts of X6 (manifest `theme_color` reconciled to `#1e3a5f`; manifest description set to the Finnish source string).
- **Dropped at owner's request:** **O2** (Quality Index legend category labels), **O3** (persistent tagline), **X5** (donation fiat option).
- **Already shipped before this batch (no work needed):** **A2** (panel is `role="complementary"` + focus move/restore), **X2** (privacy page, routes, signup/footer/settings links, cookieless-Umami statement, prerendered noscript+JSON-LD — all present from roadmap PO-14), **X7** core (the "Data updated" freshness section on the Data Sources page shipped as PO-15; the optional map-corner footer note was skipped to stay within the bundle budget).
- **Manual remainder (needs design assets / infra, not done here):** **X6** real 192/512 + maskable PNG icons and a 180×180 `apple-touch-icon.png` (plus the `manifest.icons[]` / `<link rel="apple-touch-icon">` wiring that follows once those assets exist); **X4** secondary half (localizing the *root* `index.html` OG card per `?lang` via prerendered lang-variant root copies — the primary fix, pointing the share link at the per-area profile URL that already has correct OG, is done).

---

## TL;DR

naapurustot is **well-built for a hobbyist static map app** and clearly cares about UX: a one-time onboarding tour, a retryable data-load error banner, a WebGL fallback, a self-hosted cookieless analytics choice, colorblind palettes, an axe-core a11y gate, a skip link, an `aria-live` region, a real mobile bottom-sheet, lazy-loaded panels, and honest "low data / —" handling. Most happy paths are genuinely good.

The friction is concentrated in a few recurring patterns:

1. **Silent dead-ends.** Several user actions produce *zero feedback* on failure or emptiness — most importantly **searching for something that doesn't match shows nothing at all** (no "no results"), and **copying a share link fails silently** if the clipboard is blocked.
2. **Discoverability cliffs.** Half the app (filter, wizard, ranking, compare, scatter, split view) hides behind **one unlabeled wrench icon**, and the core "click a polygon" interaction is taught *only* inside a dismissible tour. A tour-skipper lands on a colored map with no key and no obvious next step.
3. **The map is invisible to assistive tech.** It is the entire product, yet exposes **no accessible name, no role, and no keyboard path** to select an area — the one **critical**-severity finding.
4. **Missing async feedback on heavy operations.** Switching to a grid layer silently downloads **up to 11 MB** with no spinner; share-as-image buttons look dead while rendering.
5. **Mobile layout collisions.** A selected-area sheet **buries the legend** and a stray layer FAB floats on top of it; one mobile drag handle is **wired up but does nothing**; safe-area insets are applied in exactly one place.
6. **Trust gaps.** Accounts, JWT cookies, and analytics ship with **no privacy policy, terms, or consent notice** — a credibility and likely GDPR problem for an EU service.

Severity counts (deduped): **1 critical, 13 high, 17 medium, ~19 low.**

**Severity legend** — *Critical:* blocks or excludes a class of users. *High:* frequent friction or a "looks broken" moment most first-timers hit. *Medium:* noticeable confusion for many. *Low:* polish / edge-case / consistency.

---

## The handful that matter most

If only a few things get fixed, fix these (each is detailed below):

- **A1** — Map has no accessible name/role and no keyboard way to pick an area. *(critical, a11y)*
- **C1** — Search with no match shows a silent empty dropdown. *(high, appears in core-flows, errors, and empty-states)*
- **X1** — "Copy share link" / "Copy embed" fail completely silently when clipboard is denied. *(high, trust)*
- **L1** — Grid layers download up to 11 MB with no loading feedback. *(high, loading)*
- **MO1 / MO2** — A mobile drag handle does nothing; the open panel buries the legend & collides with the FAB. *(high, mobile)*
- **C2** — All analytical tools hide behind one unlabeled wrench icon. *(high, discoverability)*
- **X2** — No privacy policy/terms/consent despite accounts + analytics. *(high, trust/legal)*

---

## 1. Onboarding & first impression

> **Health:** Strong foundation. The 5-step tour (`OnboardingTour.tsx`) fires once on first visit after data loads, is fully skippable (Esc / Skip / X / click-outside), keyboard-navigable, shows progress dots, is re-launchable from Settings, and is correctly suppressed for deep-links, embeds, and automation (`App.tsx:1143-1158`). The weakness: the app leans *entirely* on that one dismissible tour. The moment it's skipped, the map gives almost no standing orientation.

**O1 — The core interaction ("click an area") is taught only inside the dismissible tour.** *(high)*
- *Problem:* A ready-made string `empty.click_to_explore` ("Click any area to explore") exists in all three locale files but is **rendered nowhere** (grep returns zero `.tsx` hits). The only place a newcomer learns that clicking a polygon opens its profile is the tour's welcome step. Skip/close the tour (the localStorage flag is then set permanently) and the idle map offers no cue to click anything.
- *Where:* `src/locales/{fi,en,sv}.json` (`empty.click_to_explore`), `src/App.tsx:1310-1820` (idle render path), `src/components/EmptyStateIllustrations.tsx:8` (`MapPinIllustration`, also unused).
- *Fix:* Render a lightweight, dismissible on-map hint (a pill near bottom-center, reusing `MapPinIllustration` + `empty.click_to_explore`) when `!selected && !showTour && pinned.length === 0 && !IS_EMBED`. Auto-fade after the first selection so it never nags returning users.

**O2 — Default Quality Index legend has no category labels and no explanation.** *(high)*
- *Problem:* The app boots on the synthesized `quality_index` layer (`App.tsx:132`), but the legend shows only the endpoints "0" and "100" — no semantic bands. The project's own FAQ defines meaningful tiers (0–20 avoid … 81–100 excellent), none of which reach the on-screen legend. A first-timer sees a multi-color map keyed by two bare numbers, with no on-screen text saying what "Quality Index" *is*, that it's a composite, or that it's user-weightable.
- *Where:* `src/components/Legend.tsx:42-56`, `src/utils/colorScales.ts:173-179`.
- *Fix:* For `quality_index`, show category labels under the swatches (e.g. *Avoid … Excellent*) and add a one-line info affordance explaining it's a customizable 0–100 composite. Keep it concise so other layers' legends stay uncluttered.

**O3 — No persistent value proposition / tagline in the chrome.** *(medium)*
- *Problem:* The header center is just the wordmark (`App.tsx:1425`). An `app.subtitle` string exists in every locale but is only used on the profile breadcrumb. Outside SEO meta and the (invisible) `noscript` block, nothing in the live UI states what the app is for. A tour-skipper has no textual signal this is a neighborhood-comparison tool.
- *Where:* `src/App.tsx:1418-1429`, `src/locales/*.json` (`app.subtitle`), loading overlay `App.tsx:1367-1368`.
- *Fix:* Surface a short tagline (render `app.subtitle` or a "Compare Finnish neighborhoods" line) near the wordmark on desktop and/or in the loading overlay. Keep it subtle on mobile.

**O4 — Tour step 2 spotlights the Data Layers panel while it's collapsed.** *(medium)*
- *Problem:* On desktop the `LayerSelector` initializes `minimized=true` (`LayerSelector.tsx:43`). The tour's "layers" step spotlights this collapsed pill while its copy says "Browse 50+ data layers… Click a category to expand" — but no layers/categories are visible at that moment. The instruction doesn't match the screen, on the exact step meant to teach the primary control.
- *Where:* `LayerSelector.tsx:43,296-318`, `OnboardingTour.tsx:25`, `locales … onboarding.layers.body`.
- *Fix:* Auto-expand the `LayerSelector` while that tour step is active, or reword the step to "Open the Data Layers panel here."

**O5 — Tour copy & default Helsinki view undersell nationwide coverage.** *(low)*
- *Problem:* The app defaults to `helsinki_metro` (`App.tsx:88`) and the tour says the city selector switches between "Helsinki, Turku and Tampere metro areas." The dataset actually spans 3,018 postal areas across all 69 Finnish regions. A newcomer reasonably concludes coverage is three metros and may never find the "All cities" view or their own town.
- *Where:* `locales … onboarding.search.body`, `src/App.tsx:88`.
- *Fix:* Reword to convey full-Finland coverage and mention the "All cities" overview.

**O6 — Tour finish label is vague and there's no "reopen" reassurance.** *(low)*
- *Problem:* The final button reads "Got it" while the tour silently sets a permanent localStorage flag (`App.tsx:1160`). No signal that finishing/skipping is permanent, nor that it can be reopened (the relaunch lives in Settings).
- *Where:* `OnboardingTour.tsx:302`, `locales … onboarding.finish`.
- *Fix:* Use a clearer label ("Start exploring") and add a one-line note that the tour can be reopened from Settings.

**O7 — Onboarding tour is a `role="dialog"` with no focus move and no focus trap.** *(high, accessibility)*
- *Problem:* The tour auto-launches for first-timers and is `aria-modal="true"`, but unlike the other modals it never moves focus into the popover and never traps it. Its Next/Back/Skip buttons sit late in the DOM, so a keyboard/SR user lands with focus behind the overlay, can Tab into the dimmed page underneath, and gets no clear way to advance.
- *Where:* `OnboardingTour.tsx:189-195,285-304`.
- *Fix:* On mount, focus the popover (`tabIndex=-1`) or its Next button and trap Tab within it; restore focus to the trigger on completion/skip. Reuse the pattern in `ShortcutsOverlay.tsx:34` / `NeighborhoodWizard.tsx:328`.

---

## 2. Core interaction flows

> **Health:** The primary job — *click a place, read its data* — works well: rich panel, immediate `aria-live` announcement, throttled hover tooltips, a smooth layer-fade with a no-data hatch, a clear 4-step wizard, and a well-designed Escape cascade. The problems are **discoverability and invisible cause-and-effect**, not broken mechanics.

**C1 — Search query with no match shows a silent empty dropdown (dead end).** *(high — also surfaces under Errors and Empty states)*
- *Problem:* The dropdown is gated on `isOpen && (results.length > 0 || addressResults.length > 0)` (`SearchBar.tsx:298`), so a query that matches nothing renders **nothing** — no "No results," no "try an address," no hint that coverage is per-region (a Helsinki-metro view won't surface Turku names until that city loads). There is no `search.no_results` key anywhere, confirming the state was never designed. It's indistinguishable from the app being frozen.
- *Where:* `src/components/SearchBar.tsx:51-83,274-357`.
- *Fix:* Add a "no results" branch: when `isOpen && debouncedQuery.length >= 2 && results.length === 0 && addressResults.length === 0` and geocoding isn't pending, render a small row ("No matches for '{query}' — try an address, or check the selected city"). Add `search.no_results` to fi/en/sv. Distinguish the still-geocoding state from settled-empty so it doesn't flash during the 300 ms address debounce.

**C2 — All analytical tools hidden behind one unlabeled wrench icon.** *(high)*
- *Problem:* Filter, Ranking, Wizard, Split view, Region comparison, Scatter, Select-area, Draw, Show-my-area and Print are **all** collapsed into one wrench button whose only label is a hover `title`. A user who skips the tour has essentially no on-screen signal that filtering or the wizard exist — the two flows the brief calls "core jobs."
- *Where:* `src/components/ToolsDropdown.tsx:75-91`, `src/App.tsx:1393-1415`.
- *Fix:* Add a visible "Tools" text label next to the wrench on desktop (there's room), and/or promote the 2–3 highest-value actions (Filter, Wizard, Ranking) to their own labeled buttons. Don't rely on the dismissible tour as the only pointer.

**C3 — Comparison flow is hard to bootstrap; the "pin one more" hint is desktop-only.** *(high)*
- *Problem:* Comparison only appears once two areas are pinned, via a small "Add to comparison" button buried among four panel actions. The only guidance — the "Pin one more neighborhood to compare" card — is wrapped in `hidden md:flex` (`ComparisonPanel.tsx:235`), so on mobile a user who pins one area gets **no feedback and no instruction**; the pinned state is invisible until they happen to pin a second.
- *Where:* `App.tsx:1657-1663`, `ComparisonPanel.tsx:234-246`, `NeighborhoodPanel.tsx:776-791`.
- *Fix:* Show a pinned-count indicator and the "pin one more" hint on mobile too; a transient first-pin toast ("Pinned — pin another area to compare side by side") makes the single-pinned state visible on all breakpoints.

**C4 — Comparison Scope toggle is icon-only and its powerful effect is unexplained.** *(medium)*
- *Problem:* Toggling scope from "whole of Finland" to "within this region" **re-normalizes the entire choropleth** *and* recomputes every Quality Index (`App.tsx:529-565`). Yet it's a single 4-square icon button; when toggled, colors and scores shift with only a tiny amber "Within this region" pill as explanation. The same area's score can change, which is surprising.
- *Where:* `ComparisonScopeToggle.tsx:16-34`, `App.tsx:993-1008,1466-1479`.
- *Fix:* Give the toggle a short visible label ("Compare: Finland / Region") on desktop and a one-line first-toggle explanation that colors and the Quality Index are re-scaled to the selected region.

**C5 — Switching layers while a panel is open silently changes the panel's content.** *(medium)*
- *Problem:* The open panel's "Distribution" section is keyed to `activeLayer`. Change the layer and the map fades (good) but the panel's histogram + "better than X% of areas" line silently swaps to the new metric with no transition. A reader may not notice the section now describes a different metric.
- *Where:* `NeighborhoodPanel.tsx:318-385,1009-1012`, `App.tsx:1580`.
- *Fix:* Make the change perceptible — a brief highlight/fade on the section when `activeLayer` changes, or a more prominent metric name.

**C6 — No visible reset / "back to home" affordance.** *(medium)*
- *Problem:* The only reset control is the centered "naapurustot.fi" wordmark (`handleResetView`), discoverable only via a hover `title`. Deselect works via X / Escape / empty-map click but nothing says so. With a filter open + an area drawn + a neighborhood selected, the user must press Escape several times in a fixed order, or hunt for close buttons, to reach a blank map.
- *Where:* `App.tsx:925-927,1259-1271,1419-1429`.
- *Fix:* Add an explicit labeled "Reset / home" control and/or make the logo's behavior discoverable; optionally a single "clear all" when multiple overlays are active.

**C7 — Selecting a search result in another city silently switches the whole region.** *(medium)*
- *Problem:* Picking a neighborhood from a different city calls `setCityFilter(props.city)` (`App.tsx:760-762`), swapping the dataset, legend scope, available years, and possibly re-normalized colors — with no toast. It reads as "I searched for one place and the whole map jumped for no reason."
- *Where:* `App.tsx:748-785`, `SearchBar.tsx:165-191`.
- *Fix:* On a forced city switch, show a brief "Switched to Turku" toast so the change is attributable to the user's action.

**C8 — Address-only result pans the map but selects nothing, with no feedback.** *(low)*
- *Problem:* `selectAddressResult` calls `onSelect('', coords)` when a geocoded address can't be matched to a polygon; `handleSearch` then just `setFlyTarget` with no selection. The map pans to an empty area and nothing explains why — "I clicked a result and nothing happened."
- *Where:* `SearchBar.tsx:173-191`, `App.tsx:777-779`.
- *Fix:* When an address resolves to no neighborhood, show a "No neighborhood data here" toast instead of a silent pan.

**C9 — Pin button silently no-ops at the 3-area limit on touch.** *(low)*
- *Problem:* `pin()` caps at 3 and returns silently when full. Desktop shows a disabled style + hover `title`; on touch there's no hover, so a tapped-but-disabled button just does nothing with no "max 3" message.
- *Where:* `NeighborhoodPanel.tsx:776-791`, `useSelectedNeighborhood.ts:22-28`.
- *Fix:* On tap-while-full, show a brief toast ("Compare up to 3 areas — remove one first").

**C10 — Wizard "Show on map" dims the whole map with the only exit buried in Tools.** *(low)*
- *Problem:* `handleWizardShowOnMap` sets `wizardResultPnos` and closes the wizard, dimming all non-matching areas. The only "Clear highlights" control lives inside the wrench/Tools dropdown. A user can be stuck staring at a mostly-grey map unsure how to restore it.
- *Where:* `NeighborhoodWizard.tsx:640-651`, `App.tsx:985-988`, `ToolsDropdown.tsx:250-261`.
- *Fix:* Render a persistent on-map chip ("Wizard results · Clear") whenever `wizardResultPnos` is non-empty.

**C11 — Settings & Tools dropdowns can't be closed with Escape, lack menu semantics & focus return.** *(high, accessibility)*
- *Problem:* Both header dropdowns close *only* on outside `mousedown`. No Escape handler, no `role="menu"`/`menuitem`, focus isn't moved to the first item on open, `aria-expanded` isn't reflected on the trigger, and focus isn't returned on close. For the menu that gates most of the app, this is significant keyboard friction.
- *Where:* `SettingsDropdown.tsx:135-144,166`, `ToolsDropdown.tsx:61-70,93`.
- *Fix:* Add Escape-to-close + focus-return-to-trigger; `aria-haspopup`/`aria-expanded`; ideally `role="menu"` with roving focus, or at minimum focus the first item on open. Mirror across both.

---

## 3. Error states & failure handling

> **Health:** Surprisingly strong for a no-backend SPA — retryable data-load banner, WebGL fallback, deploy-time lazy-chunk auto-reload, graceful auth/sync degradation, and swallowed (non-crashing) geocode/grid/isochrone errors. The weak spots are **silent failures where the user acted and got nothing back**, plus two structural gaps.

**E1 — Isochrone (travel-time) fetch failure is completely silent.** *(high)*
- *Problem:* `fetchIsochrone` returns `null` on *any* failure (network, HTTP, expired Digitransit key, empty response). The caller just `setIsochronePolygon(null)`. The user clicks "walk / 20 min," the "Fetching travel-time area…" line flashes, then nothing appears and the text vanishes. They can't tell if the area has no reachable zone, the service is down, or they erred.
- *Where:* `App.tsx:891-906`, `utils/isochrone.ts:44-80`, `IsochroneControls.tsx:74-77`.
- *Fix:* Distinguish failure from a legitimate empty result (throw/return a discriminated result on network/HTTP error); pass an error flag to `IsochroneControls` to show "Couldn't load travel-time area — try again" with retry. Add the i18n key to all three locales.

**E2 — Geolocation failures show wrong or unhelpful messages.** *(high)*
- *Problem:* Every non-permission error code (`POSITION_UNAVAILABLE`, `TIMEOUT`) maps to `geoStatus='outside'` → "Location outside coverage," so a GPS *timeout* wrongly tells the user they live outside the supported areas. `denied` and `unavailable` both fall through to a generic "Couldn't get your location" with no guidance to re-enable permission. No `geolocation.denied` key exists.
- *Where:* `App.tsx:790-794,825-827,1732-1737`.
- *Fix:* Map `err.code` correctly — `PERMISSION_DENIED` → "denied" with a re-enable hint; `POSITION_UNAVAILABLE`/`TIMEOUT` → "couldn't get location, try again"; reserve "outside" for coordinates that genuinely fall outside `findRegionForCoords`. Add `geolocation.denied`/`unavailable` keys.

**E3 — No top-level ErrorBoundary above the router — a lazy-route failure can white-screen.** *(high)*
- *Problem:* `main.tsx` wraps `<Routes>` only in `<Suspense fallback={null}>`. `App.tsx` boundaries guard internal panels, but nothing guards the route level. If a lazy route chunk fails and `chunkReload` doesn't recover (it reloads at most once per 10 s and refuses entirely when `sessionStorage` is unavailable — incognito/blocked storage), the rejected import throws to the root and React unmounts the tree → blank white page, no recovery UI.
- *Where:* `src/main.tsx:115-134`, `utils/chunkReload.ts:22-31`.
- *Fix:* Wrap `<Routes>` (or the whole app) in the existing `ErrorBoundary` with a localized full-page fallback offering Reload.

**E4 — Data-load error banner shows a raw, untranslated technical message.** *(medium)*
- *Problem:* The banner header is localized (`error.load_failed`) but the subtitle renders the raw `err.message` from deep in `dataLoader` — e.g. "Failed to load data: 404" or "Invalid TopoJSON: no objects found" — so a Finnish user gets a Finnish title with an English/technical subtitle, then `truncate` cuts it mid-sentence anyway. (Verified: `ErrorBanner.tsx:27` renders `{message}`, `useMapData.ts:66` passes `err.message`.)
- *Where:* `ErrorBanner.tsx:26-27`, `useMapData.ts:64-67`, `dataLoader.ts:65,113`.
- *Fix:* Pass an error *code* (`http_404` / `parse_error` / `network`) from `useMapData`/`dataLoader` and translate it in `ErrorBanner`; or drop the raw subtitle for a localized "Check your connection and try again." Keep technical detail in console/Sentry only.

**E5 — No async map error handling — runtime WebGL context loss leaves a frozen blank map.** *(medium)*
- *Problem:* The WebGL fallback only triggers inside the synchronous `try/catch` around `new maplibregl.Map()`. MapLibre also signals failures asynchronously (the map `error` event, the browser `webglcontextlost` event — common on mobile when the OS reclaims the GPU after backgrounding). No listeners exist, so the canvas goes blank with no message or recovery.
- *Where:* `Map.tsx:309-324,1475-1487`, `SplitMapView.tsx:199-201`.
- *Fix:* Register `map.on('error', …)` and `webglcontextlost`/`webglcontextrestored` listeners; on unrecoverable loss, show the same friendly fallback (or a "map needs reloading" banner) the synchronous path already provides.

**E6 — Profile page error screen has no retry, only "back to map."** *(low)*
- *Problem:* When the national dataset fetch fails on a directly-loaded profile URL (`load_failed`), the page offers only a "back to map" link — no Retry. A transient blip on a shared profile link forces the user to navigate away and re-enter. (`not_found`/`invalid_url` are correctly final.)
- *Where:* `pages/NeighborhoodProfilePage.tsx:189-194,338-348`.
- *Fix:* For `load_failed` specifically, add a Retry button that re-runs the load effect.

**E7 — Cloud-sync failure is only visible inside the user-menu dropdown.** *(low)*
- *Problem:* The sync system tracks failures and offers retry, but "Changes not saved to your account" lives only inside the (closed-by-default) `UserMenu`. A logged-in user whose favorites/notes fail to reach the server won't notice — they believe data is cloud-saved when it's only in localStorage.
- *Where:* `UserMenu.tsx:24-101`, `utils/syncStatus.ts:32-38`.
- *Fix:* Surface a small persistent indicator (a dot on the avatar/menu trigger, or a brief toast) when `syncStatus === 'error'`; keep the detail + Retry in the dropdown.

**E8 — Turnstile script-load failure dead-ends signup with a terse message.** *(low)*
- *Problem:* If the Cloudflare Turnstile script is blocked (ad blocker, privacy extension), the widget shows only "Bot verification failed." with no retry. `AuthModal` blocks signup submit when a site key is set but no token exists, so the user is fully stuck with no path forward (login still works, but that isn't obvious).
- *Where:* `Turnstile.tsx:40-48,93-99`, `AuthModal.tsx:61-64`.
- *Fix:* On script-load failure, show a clearer localized message ("a tracker/ad blocker may be blocking verification — disable it or try logging in") with a "reload widget" action (key bump). Consider not hard-blocking submit if the server can degrade.

**E9 — Selecting English/Swedish silently shows Finnish if the lazy dictionary fetch fails.** *(medium, cross-cutting)*
- *Problem:* EN/SV dictionaries are fetched lazily; on a failed fetch `loadLocale` swallows the error and `t()` falls back to Finnish. A user who chose English — *including the recipient of a `?lang=en` share link* — silently gets a fully Finnish UI on a flaky network, with no indication and no retry.
- *Where:* `utils/i18n.ts:40-47,82-86`.
- *Fix:* On a failed locale fetch, surface a small non-blocking "couldn't load English, showing Finnish — retry" notice and/or retry with backoff. Prefer EN over FI as the SV fallback.

---

## 4. Empty states

> **Health:** Several empty states are thoughtful — filter-no-match (illustration + copy), filter-no-criteria (presets + nudge), region-ranking loading/error/empty, no-data sub-region panel, and honest "—" for missing values. "Low data" is communicated well (amber "X/Y coverage" chip, struck-through factors, italic "No data" instead of a fake 0). The gaps are the *idle* and *search* states, plus orphaned assets.

**EM (C1) — Search with no matches shows nothing — looks broken.** *(high)* — see **C1**.

**EM1 — Idle home view has no "nothing selected" empty state or nudge.** *(medium)*
- *Problem:* With nothing selected, no pins, and onboarding dismissed, the user sees only a bare colored map with floating controls. `NeighborhoodPanel` renders only when `selected` is truthy (`App.tsx:1566`) and nothing fills the gap. A purpose-built `MapPinIllustration` and `empty.click_to_explore` string both exist but are never wired up.
- *Where:* `App.tsx:1566`, `EmptyStateIllustrations.tsx:8`, `locales … empty.click_to_explore`.
- *Fix:* Render a dismissible idle hint when `!selected && pinned.length === 0 && !showTour` using `MapPinIllustration` + the existing string. (Same fix as **O1**.)

**EM2 — Comparison "pin one more" hint is invisible on mobile.** *(medium)* — see **C3** (the `hidden md:flex` hint card).

**EM3 — Favorites empty state is text-only, login-gated, and its illustration is unused.** *(low)*
- *Problem:* The favorites list and its empty state live inside `UserMenu`, which only renders when logged in — so an anonymous user who starred areas (favorites persist to localStorage) has no way to see them, and the only favorites empty state is post-auth. The empty state is plain text; a purpose-built `FavoritesEmptyIllustration` is never imported. The copy doesn't say where the star control is.
- *Where:* `UserMenu.tsx:146-155`, `App.tsx:1433-1452`, `EmptyStateIllustrations.tsx:94`.
- *Fix:* Either surface a favorites view for anonymous users, or at minimum use `FavoritesEmptyIllustration` and reword to "Tap the star on any area to save it here."

**EM4 — Dead empty-state illustrations (`MapPinIllustration`, `FavoritesEmptyIllustration`).** *(low)*
- *Problem:* Two of four illustration components are exported but imported nowhere — they ship as dead code and signal two intended empty states that were designed and never connected.
- *Where:* `EmptyStateIllustrations.tsx:8-34,94-122`.
- *Fix:* Wire them into the idle-home (EM1) and favorites (EM3) states so all four share one visual language; if not, remove the dead exports.

**EM5 — Recent-searches list never appears for genuine first-timers.** *(low)*
- *Problem:* The focused-empty search shows "Recently viewed" only if `recent.length > 0`. For a first-timer (sessionStorage empty) the dropdown is simply absent — no placeholder suggestions, no "start typing" hint — which, combined with C1, makes search feel inert until a successful match. Recents are session-only, so returning users hit this often too.
- *Where:* `SearchBar.tsx:274-296`, `hooks/useRecentNeighborhoods.ts`.
- *Fix:* On focus-with-empty-and-no-recents, show a brief "Start typing an area name or address" hint (or a few example areas). Consider promoting recents to localStorage.

**EM6 — Filter "no match" empty state offers no recovery action.** *(low)*
- *Problem:* The no-match state shows a nice illustration + "try adjusting criteria," but no one-tap recovery (clear all, loosen the tightest range). An over-constrained user must manually hunt for which slider is the bottleneck.
- *Where:* `FilterPanel.tsx:534-541`.
- *Fix:* Add a "Clear filters" button inside the no-match state (`onFiltersChange([])`); optionally flag which single criterion, if relaxed, would yield results.

---

## 5. Loading & async feedback

> **Health:** The single most important path is handled well — the big initial TopoJSON load shows a branded shimmer overlay (`App.tsx:1357`) with a retryable error banner. Auth submit, geolocation, and isochrone have explicit feedback. But several operations a first-timer *will* hit give **zero** feedback.

**L1 — Switching to a grid layer downloads up to 11 MB with no loading feedback.** *(high)*
- *Problem:* "Light pollution" fetches an ~11 MB GeoJSON and "Air quality" an ~1.5 MB TopoJSON. `useGridData` returns a `loading` flag, but `App.tsx:134` destructures only `gridData` and **discards `loading`** (verified). So the user clicks the layer, the legend updates, but the map keeps showing the old choropleth for seconds with no spinner — it looks broken or empty.
- *Where:* `App.tsx:134`, `hooks/useGridData.ts:68,130`, `data/grid_manifest.json`.
- *Fix:* Consume `loading` from `useGridData` and show a lightweight indicator near the legend/layer selector while a grid layer fetches (even "loading detailed grid…"). Consider a size hint for the 11 MB file.

**L2 — Share-as-image buttons have no busy state during PNG generation.** *(medium)*
- *Problem:* All three image exports (`scoreCard`/`comparison`/`correlation`) fire as fire-and-forget `…catch(()=>{})`, lazy-loading `html-to-image` and running `toPng({ pixelRatio: 2 })`. The button doesn't disable or spin, so on a cold chunk + large card the user sees nothing for a beat, assumes failure, and clicks again — re-appending an off-screen container and re-rendering.
- *Where:* `NeighborhoodPanel.tsx:819`, `ComparisonPanel.tsx:301`, `CorrelationExplorer.tsx:202`, `utils/scoreCard.ts:103-104`.
- *Fix:* Add a per-button generating state (disable + spinner/label, like AuthModal's "submitting") and guard against re-entry. Apply consistently across all three.

**L3 — Lazy panels open with no fallback — blank gap on slow connections.** *(medium)*
- *Problem:* Every lazy panel uses `<Suspense fallback={null}>` (verified across `App.tsx`). The first click on a neighborhood or tool must download the chunk; until it arrives, nothing renders. On 3G the click appears to do nothing. `main.tsx` similarly wraps the route tree in `fallback={null}`.
- *Where:* `App.tsx:1315,1484,1532,1554,1607,1659`, `main.tsx:119`.
- *Fix:* Replace `fallback={null}` with a minimal skeleton/spinner for user-triggered panels (at least `NeighborhoodPanel`, the tool panels, and the route-level fallback).

**L4 — Address search performs a debounced network geocode with no "searching" indicator.** *(medium)*
- *Problem:* Typing an address triggers a 300 ms-debounced Digitransit call with no spinner/"searching…" row. Local matches appear instantly; a street search just looks "not found" until results suddenly pop in.
- *Where:* `SearchBar.tsx:88,97`, `utils/geocode.ts:17,41`.
- *Fix:* Track an in-flight geocoding state and render a subtle loading row under the "Address results" header (distinct from the C1 no-results state).

**L5 — Blank screen before first paint.** *(medium)*
- *Problem:* `index.html` ships an empty `#root` and `main.tsx` renders inside `<Suspense fallback={null}>`. Between HTML parse and the App chunk executing, the user sees a blank themed background — the in-app shimmer only appears *after* React boots, so it can't cover the JS-parse gap. Visible on mid-tier mobile.
- *Where:* `index.html:281`, `main.tsx:115,119`.
- *Fix:* Add a tiny inline placeholder (logo + shimmer, inline-styled, zero extra requests) inside `#root`; React replaces it on mount.

**L6 — All-cities view downloads ~10 MB with only the generic overlay.** *(low)*
- *Problem:* `?city=all` fetches `region_properties.json` (~10 MB). The generic shimmer covers it (not zero-feedback), but the same "Loading neighborhood data…" message and no progress make a long wait feel like a hang.
- *Where:* `dataLoader.ts:178-181`, `App.tsx:1358`.
- *Fix:* Show a more specific "Loading nationwide data…" message and/or a progress hint for this heavier view.

**L7 — Auth session restore on mount has no visible indication.** *(low)*
- *Problem:* For a returning logged-in user, `useAuth` starts `loading:true` and calls `api.me()`, but `App.tsx` renders the signed-out header (Sign in) until it resolves, then swaps to `UserMenu` — a brief "Sign in" flash for authenticated users.
- *Where:* `hooks/useAuth.ts:35,40`.
- *Fix:* Render a small skeleton for the auth control while `useAuth.loading` is true.

---

## 6. Mobile & small-screen experience

> **Health:** Real investment here — a shared `useBottomSheet` with velocity snapping, a swipeable tabbed panel, a layer FAB + sheet, dedicated `md:hidden` layouts, mostly-44px touch targets, an iOS anti-zoom rule, `dvh` units, hover-tooltips hidden on touch, reduced-motion handling. The issues are concrete layout collisions and one broken gesture.

**MO1 — FilterPanel mobile drag handle is wired up but does nothing.** *(high)*
- *Problem:* The mobile filter sheet renders a drag handle and wires `onTouchStart/Move/End` to `useBottomSheet`, but the component destructures only `isDragging` + `handlers` — it **never reads `sheetHeight`** and never applies a height/transform. The sheet is a static `max-h-[85vh]` box, so dragging the handle moves nothing: a visibly broken gesture on a core tool. (`NeighborhoodPanel`/`LayerSelector` correctly bind `style={{ height: sheetHeight }}`.)
- *Where:* `FilterPanel.tsx:348,671-690`.
- *Fix:* Bind the hook output (`style={{ height: sheetHeight }}`, drop the fixed `max-h`) like the other sheets — or remove the handle + wiring so no dead affordance is shown.

**MO2 — Open neighborhood panel covers the Legend and collides with the layer FAB.** *(high)*
- *Problem:* On mobile the panel opens as a bottom sheet at `initialSnap:'half'` (z-20). The Legend (`bottom-5`, z-10) and the layer FAB (`bottom-8`, z-30) are always rendered. Result: the Legend is **buried** under the panel (the user can't read what the colors mean while inspecting an area) and the FAB — being z-30 — floats incongruously **on top of** the panel's tab bar.
- *Where:* `NeighborhoodPanel.tsx:1577-1587`, `LayerSelector.tsx:323-343`, `Legend.tsx:37`, `App.tsx:1516-1528`.
- *Fix:* While an area is selected on mobile, hide/relocate the Legend and FAB (gate them on `!selected` at the `md:hidden` breakpoint, or lift the panel's z-index and pad so the legend reappears above the sheet).

**MO3 — Safe-area insets are missing on almost every bottom-anchored mobile surface.** *(medium)*
- *Problem:* The `.pb-safe` helper exists but is used in exactly one place (the layer sheet). Every other bottom-anchored surface — `NeighborhoodPanel`, `ComparisonPanel`, `FilterPanel`, `CustomQualityPanel`, `AreaSummaryPanel` sheets, the Legend, the FAB, the draw/select hint toasts — ignores the home-indicator inset, so on notched iPhones their bottom rows sit under the home indicator and are hard to tap.
- *Where:* `index.css:130-132`, the sheet roots listed above, `App.tsx:1682`.
- *Fix:* Add `pb-safe` to each sheet's scroll container/footer and bump the FAB/Legend/toast offsets (`bottom-[calc(2rem+env(safe-area-inset-bottom))]`). Confirm a `viewport-fit=cover` meta exists so `env()` is non-zero.

**MO4 — Tools menu has no max-height/scroll — lower items unreachable in landscape.** *(medium)*
- *Problem:* The Tools dropdown is `absolute … w-56` with no height cap and ~12 items (~500 px tall). On a phone in landscape (~360–400 px tall) or any short screen, the bottom items overflow past the viewport with no scroll. `SettingsDropdown` already solves this (`max-h-[calc(100vh-80px)] overflow-y-auto`); Tools is the outlier.
- *Where:* `ToolsDropdown.tsx:94-96`, cf. `SettingsDropdown.tsx:167-169`.
- *Fix:* Add `max-h-[calc(100vh-80px)] overflow-y-auto` to the Tools container.

**MO5 — Custom-quality sheet: a drag handle that doesn't drag, and no tap-outside dismiss.** *(low)*
- *Problem:* The mobile custom-quality panel renders the universal grab-handle pill but has no touch handlers and doesn't use `useBottomSheet`, so dragging does nothing. It also has no backdrop, so there's no tap-outside-to-close — only a small 28 px X.
- *Where:* `CustomQualityPanel.tsx:314-326`.
- *Fix:* Either wire the handle to `useBottomSheet` for real drag-to-dismiss, or remove the pill; add a tap-outside backdrop calling `onClose`.

**MO6 — Range-slider thumbs are 16 px — below comfortable touch size.** *(low)*
- *Problem:* The dual-thumb filter range and custom-quality weight sliders use 16 px (`w-4 h-4`) thumbs — fiddly on touch, especially the two close-together thumbs of the dual range.
- *Where:* `FilterPanel.tsx:137-143,159-165`, `CustomQualityPanel.tsx:80-83`.
- *Fix:* Enlarge thumbs on coarse pointers (`@media (pointer: coarse)` → `w-6 h-6`) without changing desktop density.

**MO7 — Comparison and Neighborhood panels can stack at the bottom on mobile.** *(low)*
- *Problem:* When a user has pinned an area *and* has one selected, both the `ComparisonPanel` mobile sheet (`bottom-0`, z-20) and the `NeighborhoodPanel` mobile sheet (`bottom-0`, z-20) render simultaneously at the same anchor and z-index, with no coordination — two sheets fighting for the same region.
- *Where:* `ComparisonPanel.tsx:408`, `NeighborhoodPanel.tsx:1577-1587`, `App.tsx:1565-1602,1656-1663`.
- *Fix:* Coordinate them — suppress the comparison sheet while the panel is open, or collapse it to a compact pinned-count chip, so only one bottom sheet is active.

---

## 7. Accessibility (keyboard, focus, screen reader, motion, contrast)

> **Health:** A genuinely solid foundation — skip link to `#main`, a polite `aria-live` region announcing selection + layer changes, a well-formed search combobox, `prefers-reduced-motion` handling (CSS + JS), three colorblind palettes, an axe-core e2e gate on serious/critical violations with `color-contrast` *enforced*, and proper `role="dialog"` + focus management on the Wizard, AuthModal, and Shortcuts overlay. But a first-time keyboard/SR user still hits real walls.

**A1 — The map exposes no accessible name, role, or keyboard path to select a neighborhood.** *(critical)*
- *Problem:* The map is a bare `<div ref={containerRef} className="absolute inset-0" />` with no `role`/`aria-label`, and MapLibre boots with no accessible region. The only ways to select an area are clicking a canvas polygon or typing in search. An SR user hears nothing meaningful (the canvas is — correctly — excluded from the axe scan), and a keyboard-only user **cannot Tab to or activate any neighborhood on the map at all**. The central content of the app is unoperable for AT users.
- *Where:* `Map.tsx:310-318,1489`, `App.tsx:739`.
- *Fix:* Give the container `role="region"`/`"application"` + an `aria-label` describing the active layer & city; set a meaningful `aria-label` on the canvas via `getCanvas().setAttribute`. Provide a keyboard alternative: document the search combobox as the entry point and/or expose the existing `RankingTable` as a focusable, SR-friendly "browse and pick an area" list. Confirm MapLibre keyboard pan/zoom is enabled.

**A2 — Desktop NeighborhoodPanel is not a dialog/region and never receives focus.** *(high)*
- *Problem:* On selection the side panel mounts as a plain `<div class="… absolute top-0 left-0">` with no role, no `aria-modal`/region, no `aria-labelledby` tying it to the `<h2>` name, and no focus move/restore. A keyboard user who selected via search is left with focus on the search field while the panel content (stats, similar areas, profile link, close) sits later in / detached from the tab order, signaled only by a terse `aria-live` line.
- *Where:* `NeighborhoodPanel.tsx:1523,1530`, `App.tsx:739`.
- *Fix:* Give the panel `role="region"`/`"complementary"` + `aria-labelledby` on the name heading; on open, move focus to the heading/close button and restore to the trigger on close (mirror `NeighborhoodWizard.tsx:328-332`). Same for the mobile sheet (~line 1604).

**A3 — No global `:focus-visible`; many controls set `focus:outline-none` with no replacement ring.** *(high)*
- *Problem:* `index.css` defines no `:focus-visible` fallback, so focus indication relies on per-element classes — and many high-traffic controls have no ring: icon-only close buttons (AuthModal, panel, wizard), the gear/wrench triggers, every Settings/Tools menu item, the LayerSelector buttons, and SearchBar result/recent buttons. A keyboard user frequently can't tell where focus is.
- *Where:* `index.css:1-217`, `ToolsDropdown.tsx:99-303`, `SettingsDropdown.tsx:175-316`, `LayerSelector.tsx:258-283`, `NeighborhoodPanel.tsx:1552`.
- *Fix:* Add a global `:focus-visible { outline: 2px solid <brand>; outline-offset: 2px }` (dark-mode aware) as a baseline, and audit each `focus:outline-none` to pair it with a visible `focus-visible:ring-2`. Prioritize dropdown items and icon-only buttons.

**A4 — Diverging color layers lose their meaning in colorblind mode.** *(medium)*
- *Problem:* Several layers are diverging (`income_change`, `population_change`, `unemployment_change`, `gender_ratio`, `property_price_change`, …) and rely on a neutral midpoint to convey below/above. But in colorblind mode `getLayerById` replaces *every* palette with a **sequential** CB ramp (viridis/cividis/inferno) regardless — so a diverging layer becomes monotonic and the neutral 0% point is no longer distinguishable, defeating the diverging semantic precisely for the users colorblind mode exists to help.
- *Where:* `colorScales.ts:419-444,730-737,805-820`.
- *Fix:* Detect diverging layers (`divergingCenter != null`) and substitute a CVD-safe **diverging** palette (e.g. blue-grey-orange) instead of the sequential ramp; keep sequential CB palettes for sequential layers.

**A5 — Legend conveys data only through color, with no text scale or pattern.** *(medium)*
- *Problem:* The ramp is bare swatch `div`s showing only the first and last tick; no `aria` text, no value→color mapping for AT. An SR user gets only the layer label and two numbers; a low-vision user can't map intermediate colors to values. With the map having no SR data path, the legend is the only data key and it's color-only.
- *Where:* `Legend.tsx:42-56`.
- *Fix:* Wrap the ramp in `role="img"` with an `aria-label` summarizing min/max + units, or render tick values as visually-hidden text; consider an opt-in pattern overlay.

**A6 — SearchBar results listbox and recent-list have no accessible name.** *(low)*
- *Problem:* The combobox itself is well done, but the popup `role="listbox"` has no `aria-label`, and the "recent neighborhoods" dropdown is a plain `div` of buttons with no list semantics. The popup is announced as an unnamed listbox.
- *Where:* `SearchBar.tsx:274-303`.
- *Fix:* Add `aria-label` to the listbox; give the recent list `role="listbox"`/`option` + a label (or fold it into the combobox popup).

**A7 — AuthModal lacks focus-into-modal and a focus trap.** *(low)*
- *Problem:* `AuthModal` is correctly `role="dialog"` with Escape + `aria-label`, but doesn't move focus into the dialog on open and doesn't trap Tab, so focus can leave the modal into the page behind it. Lower severity than the tour (it's opened intentionally) but still a gap vs the Wizard/Shortcuts which handle it.
- *Where:* `AuthModal.tsx:29-42,92-103`.
- *Fix:* Focus the first field (or the dialog container, `tabIndex=-1`) on open, trap Tab, restore on close. Reuse `NeighborhoodWizard.tsx:328-332`.

**A8 — Distribution chart is `role="img"` but with a generic static label.** *(low)*
- *Problem:* The panel's distribution mini-chart has `role="img"` + `aria-label={t('panel.distribution')}` — good — but the label is a static "distribution" that conveys none of the data (this area's value, percentile, position). An SR user learns a chart exists but nothing about it.
- *Where:* `NeighborhoodPanel.tsx:359`.
- *Fix:* Make the `aria-label` dynamic and data-bearing (metric name, this area's value, its rank/percentile).

---

## 8. Cross-cutting & whole-flow gaps

> Issues that fall between the per-dimension lenses — whole flows (share, embed, donate, privacy) and consistency concerns.

**X1 — "Copy share link" / "Copy embed code" fail completely silently when the clipboard is denied.** *(high)*
- *Problem:* `handleCopyShareLink`/`handleCopyEmbed` catch any clipboard rejection and return `false`; the `SettingsDropdown` handlers only show "Copied!" on `true` and do nothing on `false`. In an insecure context, when permission is denied, or in a browser without `navigator.clipboard`, the user clicks and **literally nothing happens** — no confirmation, no error, and (unlike `ContactMenu`/`DonateButton`, which expose selectable text) the URL is never shown for manual copy. The headline shareability feature appears broken.
- *Where:* `App.tsx:1175-1207`, `SettingsDropdown.tsx:111-133`.
- *Fix:* On failure, fall back to a visible recovery path like `DonateButton` does — a `textarea` + `execCommand('copy')`, or reveal the URL/snippet as select-all text with "copy manually." At minimum show a transient error toast so the click is acknowledged.

**X2 — No privacy policy, terms, or cookie/consent notice despite accounts, JWT cookies, and analytics.** *(high)*
- *Problem:* Signup collects username/password/optional email and auth uses an httpOnly JWT cookie (`api.ts` `credentials:'include'`); Umami analytics loads on every page. Yet there is **no** privacy policy, terms, GDPR/consent, or cookie page anywhere in `src`, and no link from the signup form. For an EU/Finnish service handling personal data this is both a trust gap and a likely compliance problem.
- *Where:* `AuthModal.tsx:200-218`, `index.html:272-273`, `utils/api.ts:4`, `hooks/useAuth.ts:27`.
- *Fix:* Add a short privacy/terms page (static, prerendered like `DataSourcesPage`), link it from the signup form ("By signing up you agree to…") and the footer. If Umami is truly cookieless/anonymous, state that explicitly; otherwise add a consent gate. *(Page scaffold is mechanical; the policy content is a human/legal decision — see sequencing.)*

**X3 — Share & embed are hidden under the Settings gear, not a discoverable Share control.** *(medium)*
- *Problem:* "Copy share link" / "Copy embed code" live inside the **Settings** dropdown alongside colorblind mode, opacity, language, and the tour. A user wanting to share looks for a share/link icon, not "Settings" — and the Tools menu doesn't have them either. The most viral action is buried two levels deep behind an unrelated icon.
- *Where:* `SettingsDropdown.tsx:288-316`, `App.tsx:1390-1391`.
- *Fix:* Add a dedicated labeled Share affordance (icon + "Share") near the header/legend that opens the link/embed options, or at least move them into Tools next to Print.

**X4 — Shared deep links produce a generic Finnish social-preview card regardless of what was shared.** *(medium)*
- *Problem:* The share link bakes selection/layer/filters into query params on the SPA root, but `index.html` serves fixed Finnish OG/Twitter meta that the client never rewrites for `/`. So a shared link to a specific neighborhood/metric unfurls as the same generic "vertaile asuinalueita…" Finnish card with the default image — never the area name, the metric, or the recipient's language. (The standalone `/alue/:slug` profile route *does* set correct per-page OG; the primary map view does not.)
- *Where:* `index.html:7-30`, `App.tsx:1199-1207`, `utils/embed.ts:55-59`.
- *Fix (pragmatic, Claude Code):* Point the "share this view" link at the per-neighborhood `/alue/:slug` profile URL (which already has correct OG), and localize the map-deep-link meta to the `?lang` param. *(A fully dynamic per-state OG image is a larger, manual infra effort.)*

**X5 — The only donation path is a Bitcoin Lightning BOLT12 offer; copy in two strings disagrees.** *(medium)*
- *Problem:* "Support the project" shows only a long BOLT12 Lightning string to paste into a "Lightning wallet" (Phoenix/Zeus). Most well-meaning donors have no Lightning wallet and no idea what BOLT12 is — the flow dead-ends with no card/PayPal/MobilePay/bank option and no "what is this?" Additionally `donate.description` promises "Scan the QR code or copy…" while the rendered panel uses `descriptionShort` and hides the QR behind a toggle, so the leading instruction doesn't match the screen.
- *Where:* `DonateButton.tsx:9-10,64-115`, `locales … donate.description`.
- *Fix:* Add at least one mainstream option (MobilePay / card / PayPal / IBAN) with a one-line crypto explainer, and align the donate copy (show QR by default, or use the short wording consistently). *(Mainstream payment needs an account — manual.)*

**X6 — PWA install metadata is thin and inconsistent.** *(low)*
- *Problem:* The "Add to Home Screen" manifest has an English-only description ("Finnish neighborhoods on a map"), a single SVG icon (no PNG/maskable, so Android icons may render poorly), `theme_color` `#6366f1` that mismatches `index.html`'s `#1e3a5f`, and no `apple-touch-icon`.
- *Where:* `vite.config.ts:122-136`, `index.html:37`.
- *Fix:* Provide 192/512 PNG + a maskable icon, a localized manifest description, reconciled theme-color, and an `apple-touch-icon`. *(Icon assets are a design task — manual.)*

**X7 — Data Sources page omits per-layer last-updated/vintage dates and any freshness statement.** *(low)*
- *Problem:* The public Data Sources & Methodology page lists source/license/year/granularity per layer (good), but "year" is the source vintage, not when the *site* last refreshed, and there's no single "data as of <date>" line. The build-derived freshness timestamp lives only inside the Settings dropdown, where most visitors never look — so a skeptic on the dedicated trust page can't tell how current the data is.
- *Where:* `pages/DataSourcesPage.tsx:59-115`, `SettingsDropdown.tsx:318-323`.
- *Fix:* Show the `build_metadata` freshness date prominently at the top of the Data Sources page (and a small footer note on the map).

---

## Suggested Sequencing

These batches group the fixes for **parallel Claude Code sessions**. The constraint: three files are **shared "hot" surfaces** — `src/App.tsx` (touched by ~15 findings), `src/components/NeighborhoodPanel.tsx`, and the three `src/locales/*.json` files. The batching keeps **at most one session editing `App.tsx` per batch** and **at most one editing `NeighborhoodPanel.tsx` per batch**; the locale JSONs are edited additively by several sessions, which produces at most trivial "keep both keys" merge conflicts (call them out in each PR). Within a batch, the listed sessions touch **disjoint component files** and can run concurrently. Batches are ordered so each depends only on prior ones.

Tags: **[CC]** = fully implementable in a Claude Code session. **[Manual]** = needs an account, credentials, external service, design asset, or a human policy decision.

> Note on focus rings (A3): the *global* `:focus-visible` baseline lands in Batch 1 (`index.css`); the per-component `focus:outline-none` → `focus-visible:ring` fixes ride along inside each component's owning session (Tools in B1.3, Settings in B2.2, panel in B2.1, AuthModal in B2.3, tour/LayerSelector in B2.4).

---

### Batch 1 — Fix broken & silent (max parallelism; no `App.tsx`/`NeighborhoodPanel` contention)
*Highest-impact, file-isolated fixes. All 10 can run concurrently.*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 1.1 | Search empty/loading/recents/aria | **C1, L4, EM5, A6** | `SearchBar.tsx`, `useRecentNeighborhoods.ts` | CC |
| 1.2 | Filter sheet drag + no-match recovery | **MO1, EM6** | `FilterPanel.tsx` | CC |
| 1.3 | Tools dropdown: scroll + Escape/menu semantics + rings | **MO4, C11(tools), A3(tools)** | `ToolsDropdown.tsx` | CC |
| 1.4 | Colorblind diverging palettes | **A4** | `colorScales.ts` | CC |
| 1.5 | Global `:focus-visible` + coarse-pointer slider thumbs | **A3(global), MO6** | `index.css` | CC |
| 1.6 | WebGL async / context-loss recovery | **E5** | `Map.tsx`, `SplitMapView.tsx` | CC |
| 1.7 | Top-level ErrorBoundary above router | **E3** | `main.tsx`, `ErrorBoundary.tsx` | CC |
| 1.8 | Legend: QI category labels + ramp `aria` | **O2, A5** | `Legend.tsx` | CC |
| 1.9 | Error banner: localized message (drop raw) | **E4** | `ErrorBanner.tsx`, `useMapData.ts`, `dataLoader.ts` | CC |
| 1.10 | First-paint inline placeholder + `viewport-fit` | **L5** | `index.html` | CC |

### Batch 2 — Core accessibility & focus management
*Depends on Batch 1. `App.tsx` owner: 2.5. `NeighborhoodPanel` owner: 2.1.*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 2.1 | NeighborhoodPanel a11y + small flow cues | **A2, A8, C5, C9, A3(panel)** | `NeighborhoodPanel.tsx` | CC |
| 2.2 | Settings dropdown a11y | **C11(settings), A3(settings)** | `SettingsDropdown.tsx` | CC |
| 2.3 | AuthModal focus trap + Turnstile fail message | **A7, E8, A3(authmodal)** | `AuthModal.tsx`, `Turnstile.tsx` | CC |
| 2.4 | Onboarding tour focus + copy + layer auto-expand | **O7, O4, O5, O6** | `OnboardingTour.tsx`, `LayerSelector.tsx` | CC |
| 2.5 | Map a11y (name/role/keyboard entry) | **A1** | `Map.tsx`, `App.tsx` | CC |

### Batch 3 — Orientation & isolated polish
*`App.tsx` owner: 3.1. The other four touch fully disjoint files.*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 3.1 | App orientation (idle hint, illustrations, tagline, reset) | **O1/EM1, EM4, O3, C6** | `App.tsx`, `EmptyStateIllustrations.tsx` | CC |
| 3.2 | Custom-quality sheet: real drag + tap-outside dismiss | **MO5** | `CustomQualityPanel.tsx` | CC |
| 3.3 | Profile page: Retry on `load_failed` | **E6** | `NeighborhoodProfilePage.tsx` | CC |
| 3.4 | i18n: surface failed-locale notice / retry | **E9** | `utils/i18n.ts` | CC |
| 3.5 | Data Sources page: dataset freshness | **X7** | `DataSourcesPage.tsx` | CC |

### Batch 4 — Discoverability, flow feedback & share
*`App.tsx` owner: 4.1. `NeighborhoodPanel` owner: 4.2 (depends on 2.1).*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 4.1 | App flow feedback + share | **C4, C7, C8, C10, C2, X1, X3** | `App.tsx`, `ComparisonScopeToggle.tsx`, `ToolsDropdown.tsx`, `SettingsDropdown.tsx` | CC |
| 4.2 | Share-as-image busy state + re-entry guard | **L2** | `NeighborhoodPanel.tsx`, `ComparisonPanel.tsx`, `CorrelationExplorer.tsx` | CC |
| 4.3 | Favorites empty state (illustration + copy) | **EM3** | `UserMenu.tsx`, `EmptyStateIllustrations.tsx` | CC |

### Batch 5 — Loading/error feedback + independent manual setup
*`App.tsx` owner: 5.1. The two manual items are fully independent and can start anytime.*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 5.1 | App loading/error feedback | **L1, L3, L6, L7, E1, E2, E7** | `App.tsx`, `main.tsx`, `useGridData.ts`, `useAuth.ts`, `isochrone.ts`, `IsochroneControls.tsx`, `UserMenu.tsx` | CC |
| 5.2 | Donation: add fiat/MobilePay option + align copy | **X5** | `DonateButton.tsx` | Manual |
| 5.3 | PWA icons/manifest/theme-color/apple-touch-icon | **X6** | `vite.config.ts`, `index.html`, `public/` | Manual |

### Batch 6 — Mobile layout reflow *(run 6.1 → 6.2 → 6.3 in order — NOT parallel)*
*All three rework the same bottom-sheet region (`App.tsx` + `NeighborhoodPanel` + `ComparisonPanel` + `Legend` + `LayerSelector`), so they must be sequential. Depends on Batch 2 (panel a11y).*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 6.1 | Hide/relocate Legend + FAB while panel open; coordinate stacked sheets | **MO2, MO7** | `App.tsx`, `Legend.tsx`, `LayerSelector.tsx`, `NeighborhoodPanel.tsx`, `ComparisonPanel.tsx` | CC |
| 6.2 | Safe-area insets on all bottom-anchored surfaces | **MO3** | the bottom-sheet roots + `Legend.tsx`, `LayerSelector.tsx`, `App.tsx`, `index.html` | CC |
| 6.3 | Comparison bootstrap (mobile pin-hint + count + first-pin toast) | **C3/EM2** | `App.tsx`, `ComparisonPanel.tsx`, `NeighborhoodPanel.tsx` | CC |

### Batch 7 — Trust & social *(run 7.1 → 7.2 in order; both touch `App.tsx` + `index.html`)*
*Largely independent of the layout work and can be started early, but the two items share `App.tsx`/`index.html`, so sequence them.*

| # | Session | Findings | Owns files | Tag |
|---|---------|----------|-----------|-----|
| 7.1 | Privacy/terms/cookie page + signup link + footer link | **X2** | new `pages/PrivacyPage.tsx`, `main.tsx`, `AuthModal.tsx`, `App.tsx`, locales | Manual *(scaffold is CC; policy content is a human/legal decision)* |
| 7.2 | Share links → profile-URL OG + localize map-deep-link meta | **X4** | `App.tsx`, `index.html`, `utils/embed.ts` | CC |

---

### Dependency summary

- **Batch 1** depends on nothing.
- **Batch 2** depends on Batch 1 (focus-ring baseline, error infra).
- **Batches 3, 4, 5** depend on Batches 1–2 (panel a11y restructure precedes any further panel edits; share-image and comparison work builds on the panel changes).
- **Batch 6** depends on Batch 2 (panel a11y) and is internally sequential.
- **Batch 7** is independent of 3–6 except for the shared `App.tsx` merge point; the **Manual** items (5.2, 5.3, 7.1's policy content, plus the payment/icon assets) need external accounts/assets/decisions and can be kicked off in parallel with any CC batch.
