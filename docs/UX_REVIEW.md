# UX Review — naapurustot (Fresh Eyes)

**Date:** 2026-06-10
**Reviewer perspective:** A first-time visitor who knows nothing about the project, arriving cold at naapurustot.fi.
**Method:** A multi-agent fresh-eyes pass — six parallel recon reads that mapped every user-facing flow and state, then nine specialist lenses (onboarding, core flows, error states, empty states, loading states, mobile, accessibility, discoverability/IA/trust, perceived performance) each producing `file:line`-grounded findings, then an adversarial verification pass. Every **High**-severity finding below was re-verified by hand against the *current* source (`App.tsx`, `useMapData.ts`, `AuthModal.tsx`, `FilterPanel.tsx`, `OnboardingTour.tsx`, `i18n.ts`, `SearchBar.tsx`, `ErrorBanner.tsx`, `NeighborhoodPanel.tsx`, `SplitMapView.tsx`, `SettingsDropdown.tsx`, `LayerSelector.tsx`). Findings that the previous review's 2026-06-08 implementation already fixed were dropped.
**Scope:** Frontend & user-facing behavior only.

---

## Context: this is a *second-pass* review

The previous review (`docs/UX_REVIEW.md`, 2026-06-03) was fully implemented on 2026-06-08 — onboarding tour, retryable data-load banner, no-results search states, focus rings, an `aria-live` region, a skip link, a real mobile bottom-sheet, a privacy page, colorblind palettes, and an axe-core gate all shipped. **The easy wins are already done.** What remains is a second layer of friction: silent failure paths, ARIA semantics that *declare* more than they *deliver*, mobile layout collisions on the newer features, and a few discoverability/trust gaps. None of the findings below restate something the current code already handles — each was checked against live source.

**Severity legend** — *Critical:* blocks or excludes a class of users. *High:* frequent friction or a "looks broken" moment most first-timers hit. *Medium:* noticeable confusion for many. *Low:* polish / edge-case / consistency.

**Severity counts (deduped): 0 critical · 11 high · 27 medium · 10 low (48 findings).**

---

## TL;DR

naapurustot remains a genuinely well-built static map app, and the 2026-06 hardening shows. The friction that's left clusters into five patterns:

1. **Promises the code doesn't keep.** Several controls *announce* a contract they don't honor: `aria-modal="true"` modals that never trap focus (`AuthModal`, the mobile sheet), a `role="menu"` with no arrow-key navigation (`ToolsDropdown`), a "grid detail" legend badge that stays up after the grid silently failed to load, and a welcome hint that promises neighborhood "exact details" on a map that's actually showing 69 regional blobs.
2. **Silent failures.** Clipboard-blocked "Copy link", swallowed share-as-image errors (one with no `catch` at all), a national-similarity fetch that fails into a blank list with the toggle stuck on, a grid 404 that just makes the spinner vanish, and a map-load failure that is *never announced to screen readers*.
3. **Dead-end saves & unreachable flows.** Signed-out users can favorite areas but have **nowhere to see their favorites**; mobile users **can't add to the shortlist or set a reference at all**; the **Data Sources page is unreachable on mobile**; address search returns "no neighborhood" for fully-covered areas on the default screen.
4. **Mobile layout collisions on the new features.** Split-view layer pickers hide *under* the header; the shortlist tray overflows behind the Layers FAB; reduced-motion is ignored on the sheet and tab carousel.
5. **The trilingual audience hits a Finnish wall.** No `navigator.language` detection, and the language switch is an unlabeled `FI/EN/SV` row buried in a gear menu — so an English or Swedish first-timer gets the entire onboarding in Finnish.

---

## The handful that matter most

| # | Finding | Severity | Why it's top |
|---|---------|----------|--------------|
| **EM1** | Signed-out users can favorite, but have no surface to see favorites | High | The default user (logged out) stars areas into a void — looks broken |
| **E1** | Map data-load failure is never announced to screen readers | High | Excludes AT users from the one recovery affordance (Retry) on the most important failure |
| **C2** | Address search returns "no neighborhood" on the default all-Finland view | High | The most natural first action ("type my street") wrongly fails for covered areas |
| **C3** | Mobile panel omits shortlist + reference — those flows are unreachable on a phone | High | Excludes most mobile traffic from two core workflows entirely |
| **C1** | Every region switch throws a full-screen "reload-flash" that also blocks the header | High | Core drill-down feels like a page reload; chrome is unclickable during load |
| **M1** | Split-view layer pickers sit *under* the header — unusable on mobile | High | Makes the whole compare-layers feature non-functional on phones |
| **O1** | One stray click on the spotlighted control permanently kills the tour | High | The most natural reaction to a spotlight silently ends onboarding for good |
| **O2** | No language auto-detect; non-Finnish first-timers get Finnish-only onboarding | High | The trilingual app's designed-for audience hits a wall on arrival |
| **X1** | Data Sources & Methodology page is unreachable on mobile | High | Mobile majority loses every provenance/trust signal the app has |
| **A1 / A2** | Auth modal doesn't trap focus; filter sliders have no accessible name | High | Keyboard/SR users can't complete sign-up or operate the Filter tool |

---

## 1. Onboarding & first impression

### O1 — One stray click on the spotlighted control permanently kills the tour · **High** · [Claude Code]
**Problem.** The tour darkens the screen and cuts a bright spotlight hole around a control (e.g. the Layers button), which visually screams "click me." But the entire backdrop is a single transparent `<button>` whose `onClick` calls `finish('skipped')`, and that path writes `localStorage 'naapurustot-onboarding-seen'`. So a first-timer who instinctively clicks the highlighted element — the single most natural reaction to a spotlight — doesn't interact with it; they silently end onboarding for good. The reassurance that the tour is reopenable shows only on the final step they never reach.
**Where.** `src/components/OnboardingTour.tsx:256-264` (full-screen click-blocker → `finish('skipped')`); `src/components/OnboardingTour.tsx:83-88`; `src/App.tsx:1464-1467` (`handleCloseTour` persists "seen"). *(Verified: the click-blocker is `absolute inset-0` and calls `finish('skipped')`.)*
**Fix.** Make a backdrop/outside click advance to the next step (or be a no-op), not a permanent skip. Reserve permanent dismissal for the explicit Skip/Finish buttons. At minimum, don't write the "seen" flag when the tour ends via an outside click.
**Impact.** Most first-timers who reflexively click the highlighted control lose the entire orientation after step 1 and never see it again unless they hunt through Settings.

### O2 — No language auto-detection; the language switch is also unlabeled · **High** · [Claude Code]
**Problem.** `currentLang` defaults to `'fi'` and is only overridden by a stored `localStorage 'lang'` or an explicit `?lang` URL param — there is **no `navigator.language` detection anywhere in `src`**. A first-time English or Swedish visitor with no URL param sees the welcome tour, loading copy, skip link, and all chrome in Finnish. Their only escape is a row of unlabeled `FI / EN / SV` buttons buried in the gear Settings dropdown — and unlike the Theme and Colorblind controls in that same menu, the language picker has **no label row**, so it isn't even self-identifying. The app explicitly markets en/sv (`og:locale:alternate`, `hreflang`), so this is a designed-for audience hitting a wall.
**Where.** `src/utils/i18n.ts:67-73` (defaults `'fi'`, only localStorage override); `src/App.tsx:72` (lang only from URL); `src/components/SettingsDropdown.tsx:251-269` (unlabeled FI/EN/SV row; contrast the theme label at `:217`). *(Verified.)*
**Fix.** On first load with no stored `lang` and no `?lang`, read `navigator.languages` and pick `en`/`sv` when the user's preferred language matches, falling back to `fi` (the en/sv dicts are already lazy-fetched, and the tour is gated behind data load anyway, so the extra fetch is hidden). Independently, add a small label/globe row above the FI/EN/SV buttons.
**Impact.** Every non-Finnish first-timer with no `?lang` — a primary audience for a trilingual app — gets onboarding and chrome in a language they may not read, plus a hidden, unlabeled switch to escape it.

### O3 — The core "click an area" instruction lives only inside the tour · **Medium** · [Claude Code]
**Problem.** The instruction that teaches the app's central interaction — "click any area to see its details" — exists only as the welcome step's hint. It disappears the moment the user advances past step 1, and there's no persistent visible cue anywhere else (the only other guidance is the `sr-only` map-instructions paragraph). A user who taps Skip, or who returns with the "seen" flag set, faces a colored map with no sighted indication of what's clickable — and on touch there's not even a hover tooltip to hint at interactivity.
**Where.** `src/components/OnboardingTour.tsx:24` + `:295-299` (hint only on welcome step); `src/App.tsx:1653` (sr-only instructions are the only non-tour guidance).
**Fix.** Add a small dismissible on-map hint pill ("Click an area to see its stats") shown in the no-selection state, with its own persisted dismissal independent of the tour.
**Impact.** Every tour-skipper and returning visitor who never selected an area — especially on touch.

### O4 — Default all-Finland view shows region aggregates, but the welcome hint promises neighborhood "exact details" · **Medium** · [Claude Code]
**Problem.** The default landing scope is `city='all'`, which renders 69 coarse *seutukunta* blobs, not the postal-code neighborhoods the product is about. Yet the welcome hint reads "klikkaa kartalta mitä tahansa aluetta nähdäksesi sen **tarkat tiedot**" (…its exact details), and the search-step copy claims the view "kattaa kaikki Suomen postinumeroalueet." A first-timer who follows the hint clicks a large region and gets a regional *aggregate* panel, not the per-neighborhood detail implied. Nothing on the default map signposts that they're looking at regions or that neighborhood data requires drilling in.
**Where.** `src/locales/fi.json:693` (click hint) & `:688` (search-step copy); `src/App.tsx:106` + `src/utils/regions.ts:763` (default `'all'`); `src/App.tsx:1334` (region click → aggregate); `src/components/Legend.tsx:56-76` (no scope indicator).
**Fix.** When scope is `'all'`, add a small legend caption / one-time banner ("Aluekooste — valitse alue tai klikkaa nähdäksesi postinumerotiedot"), and soften the welcome + search copy so it doesn't over-promise postal-code resolution.
**Impact.** Every first-timer on the default view can misread regional aggregates as neighborhood data and may never discover the drill-down. *(Merges the Onboarding and Core-flows lenses' duplicate reports.)*

### O5 — Auto-tour skip-gate only checks `pno`, so shared/configured links still get the blank-slate welcome tour · **Medium** · [Claude Code]
**Problem.** The first-visit tour is suppressed for deep links only when `initialUrl.pno` is set. Any other restored state — a chosen layer, an active filter, a comparison set, a non-default city, a shortlist, a wizard config — does not suppress it. A newcomer following a link configured to show a specific layer/filter/comparison gets the generic 5-step walkthrough popping over the very content the link was meant to present.
**Where.** `src/App.tsx:1453-1462` (guard at `:1456` only checks `initialUrl.pno`). *(Verified.)*
**Fix.** Broaden the guard to skip the auto-tour whenever any meaningful state param is present (layer ≠ default, filters, compare, wizard, shortlist, or city ≠ `'all'`).
**Impact.** Anyone arriving via a shared/configured link without a selected area sees an orientation tour over content they were sent to look at.

### O6 — Onboarding is gated behind the heaviest payload · **Low** · [Claude Code]
**Problem.** The auto-tour effect early-returns while `loading || !data`, and the default scope loads the full nationwide dataset whose own overlay copy warns it's a large file. So a cold first-timer stares at a shimmer overlay with no orientation until the biggest download in the app finishes — even though the *welcome* step is anchorless, centered, and needs no map data.
**Where.** `src/App.tsx:1455` (`if (loading || !data) return;`); `src/App.tsx:1704-1717` (nationwide overlay).
**Fix.** Show the anchorless welcome step immediately on first visit even while data loads (the tour already sits above the overlay); keep only the *anchored* steps gated on readiness.
**Impact.** First-timers on slow connections see only a "large file" shimmer before any orientation appears.

### O7 — Mobile city/scope selector is an unlabeled globe icon · **Low** · [Claude Code]
**Problem.** On mobile the city selector is an icon-only button with no visible current-value text — just a globe glyph; the current scope is exposed only via `aria-label`/`title`. A first-timer on a phone has no on-screen indication that they're in the "Koko Suomi" view, or that this icon controls scope at all. The tour's search step references "the city selector," but on mobile there's no labeled control matching that mental model.
**Where.** `src/components/CitySelector.tsx:80-98`.
**Fix.** Show the current scope as a short visible label beside/under the globe icon (abbreviated region name or "Koko Suomi").
**Impact.** Mobile first-timers can't tell what geographic scope they're viewing or that the globe switches it.

---

## 2. Core interaction flows

### C1 — Every region/city switch throws a full-screen "reload-flash" that also blocks the header · **High** · [Claude Code]
**Problem.** `useMapData` resets to `{data:null, loading:true}` the instant `cityFilter` changes, and App renders the loading overlay as `absolute inset-0 z-50` with a backdrop-blur, shimmer blocks and a giant centered "naapurustot" wordmark — with **no `pointer-events-none`**. Because `z-50` sits above the `z-20` header, the overlay covers *and blocks* the search box, settings, tools menu and CitySelector for the whole load. So the most natural drill-down (pick a region, or click a seutukunta → "Explore postal codes") blanks the entire screen, reads as a hard page reload, and the user can't change their mind or search mid-load.
**Where.** `src/App.tsx:1704-1717` (overlay `inset-0 z-50`, no `pointer-events-none`) vs `src/App.tsx:1724` (header `z-20`); `src/hooks/useMapData.ts:41-44` (resets `loading:true` on every `regionId` change). *(Verified directly.)*
**Fix.** Distinguish cold first-load from subsequent switches: keep the previous map visible (optionally dimmed) and show a slim non-blocking top progress bar instead of the full-screen wordmark takeover. At minimum constrain the overlay below the header (`top-12` not `inset-0`), drop the wordmark after the first successful load, and keep the chrome interactive.
**Impact.** Hits essentially every engaged first-timer; drilling from the default into any of the 69 regions is the core exploratory action, and each switch feels like a full reload with a locked toolbar. *(Merges the Perceived-performance and Loading-states reports.)*

### C2 — Address search returns "no neighborhood" on the default all-Finland view · **High** · [Claude Code]
**Problem.** The default view is `?city=all`, where `data` is the geometry-stripped all-cities dataset. In `SearchBar`, `findNeighborhoodForPoint` skips every feature with `!feature.geometry`, so it always returns `null` here; the address pick then falls through to `onSelect('', coords)`, and `handleSearch` shows the toast "Ei naapurustodataa tällä osoitteella / No neighborhood data for this address." A first-timer's most natural action — typing their own street address on the default screen — is met with a "no data" message even though the area is fully covered; it just isn't loaded yet.
**Where.** `src/components/SearchBar.tsx:155-156` (skips geometry-less features) & `:217-219` (`onSelect('', …)`); handler at `src/App.tsx:980-985`. *(Verified.)*
**Fix.** In `handleSearch`, when `pno` is empty but `center` is valid, derive the owning region via `findRegionForCoords(center)` (already defined at `App.tsx:78` and used by geolocation), switch to it, and defer point-in-polygon selection using the same pending-resolution pattern as `handleUseLocation` (`App.tsx:1087-1099`). Only show the "no neighborhood" toast when the coords are genuinely outside coverage.
**Impact.** Hits any first-time user who searches a street address from the default view — a very common entry path — and wrongly tells them their area has no data.

### C3 — Mobile panel omits shortlist + reference actions — those flows are unreachable on a phone · **High** · [Claude Code]
**Problem.** The desktop panel header renders four area actions — favorite, shortlist, reference, pin. The mobile bottom-sheet header renders only **favorite + pin**. The shortlist and reference buttons are simply absent on mobile, and there's no other path: the ShortlistTray only lists/removes existing entries and only shows on the idle home view. So a mobile user can never build a shortlist or set a reference baseline at all.
**Where.** `src/components/NeighborhoodPanel.tsx:1994-1999` (mobile header renders only `{favoriteButton}{pinButton}`); desktop full set referenced nearby. *(Verified: the mobile action row is `{favoriteButton}{pinButton}` only.)*
**Fix.** Include `{shortlistButton}` (and `{referenceButton}` for non-metro areas) in the mobile header action row, or move them into an overflow menu so both core flows are reachable on touch.
**Impact.** Excludes all mobile visitors — a large share of first-time traffic — from the shortlist and reference-baseline flows entirely.

### C4 — Layer switcher starts minimized with every group collapsed · **Medium** · [Claude Code]
**Problem.** Switching the mapped metric is the central exploration action, yet on desktop the `LayerSelector` initializes `minimized=true` **and** every group `collapsed=true`, resetting that way on every page load. To change the layer a user must expand the panel, then expand a category, then click a layer — three clicks — and even after expanding they see only group headers, not the ~59 layers. The active metric shows only in the bottom-left Legend, far from the top-right control.
**Where.** `src/components/LayerSelector.tsx:39-41` (all groups collapsed) & `:45` (`minimized=true`). *(Verified.)*
**Fix.** Default the desktop panel to expanded, and/or auto-expand the group containing the active layer so at least one set of layers is visible on first paint.
**Impact.** Many first-timers — especially tour-skippers — won't discover that 59 data layers exist.

### C5 — No entry point for "compare neighborhoods," and it's confusable with "compare layers" · **Medium** · [Claude Code]
**Problem.** The neighborhood-comparison flow can only be started from the per-area "Lisää vertailuun" pin inside an open panel. The Tools menu — the app's discovery hub — has no "compare areas" entry; its closest item is "Vertaa tasoja" (compare *layers* over the same areas), a different feature. A first-timer who opens Tools to compare two neighborhoods finds a "compare" that does something else.
**Where.** `src/components/ToolsDropdown.tsx:298-315` (only "compare layers"); pin-to-compare only at `src/components/NeighborhoodPanel.tsx:947-971`.
**Fix.** Add a short hint in Tools (or near the pin) that "pinning areas builds a side-by-side comparison," or rename the split-map item ("Vertaa tasoja (jaettu kartta)") and add a distinct "Vertaile alueita" affordance.
**Impact.** Users seeking the headline "compare neighborhoods" value proposition may open the wrong tool or never find the pin-to-compare flow.

---

## 3. Error states & failure handling

### E1 — Map data-load failure is never announced to screen-reader users · **High** · [Claude Code]
**Problem.** When the initial nationwide fetch (or a region switch) fails, `useMapData` sets `error:'load_failed'` and App renders `<ErrorBanner>` — but the banner's container has **no `role="alert"`, no `aria-live`, no dismiss control**. A sighted user sees a red banner; a blind/low-vision user gets only a blank basemap with **zero** announcement that anything failed, and can't tell "broken" from "empty." This is the single most important failure state and it's silent for AT. (Contrast: the locale-error and geo toasts both use `role="status"`.)
**Where.** `src/components/ErrorBanner.tsx:8-36` (no role/aria-live); wired at `src/App.tsx:1720`; error set in `src/hooks/useMapData.ts:64-71`. *(Verified — the banner is a plain `<div>`.)*
**Fix.** Add `role="alert"` `aria-live="assertive"` `aria-atomic` to the banner's outer div so the failure + Retry are announced immediately. Optionally move keyboard focus to the Retry button on first render. *(This also resolves the Accessibility lens's duplicate report.)*
**Impact.** Screen-reader and keyboard-only users hit a dead, unannounced app whenever a fetch fails (offline, CDN hiccup, region 404) and are excluded from the one recovery affordance.

### E2 — Grid-fetch failure is silent: coarse data shows while the legend still claims grid detail · **Medium** · [Claude Code]
**Problem.** For grid layers (air_quality, transit_reachability, light_pollution) the topojson is fetched lazily. On a 404/network error the catch only `console.warn`s and calls `setLoading(false)` — the Legend's grid spinner just *disappears* while the "national/regional grid" scope badge stays up, so the UI actively asserts ~250 m detail that isn't there. A first-timer who selected "air quality" for street-level resolution silently gets postal blocks, labeled as grid data, with no retry.
**Where.** `src/hooks/useGridData.ts:164-171` (silent catch); grid-scope badge `src/components/Legend.tsx:77-82`. *(Verified by the adversarial pass.)*
**Fix.** Thread a fetch-error flag out of `useGridData`; when set, replace the grid badge with a one-line note ("Detailed grid unavailable — showing postal estimate") plus a retry. At minimum, suppress the grid badge when the grid failed. *(Merges the Error-states and Loading-states reports.)*
**Impact.** Anyone viewing a grid layer during a transient CDN/file error sees lower-resolution data mislabeled as high-resolution — undermining the app's "lowest-level data" promise.

### E3 — "Copy link" in the area panel and shortlist silently does nothing when the clipboard is blocked · **Medium** · [Claude Code]
**Problem.** `NeighborhoodPanel`'s `handleCopyLink` early-returns if `navigator.clipboard.writeText` is missing and swallows write rejections in an empty catch; `ShortlistTray`'s share-link does the same. In an iframe embed, an insecure context, or when clipboard permission is denied, the user clicks the primary "Copy link" / "Share" button and gets **nothing** — no toast, no error, no fallback. `SettingsDropdown` already solved this exact case by revealing a manual-copy textarea on failure, so the panel/tray paths are inconsistently degraded.
**Where.** `src/components/NeighborhoodPanel.tsx:834-840`; `src/components/ShortlistTray.tsx:75,81` (vs the working fallback at `src/components/SettingsDropdown.tsx:156-159,375-398`). *(Verified.)*
**Fix.** Reuse SettingsDropdown's pattern: on failure (or missing `writeText`) reveal a readonly textarea with the URL pre-selected, or at minimum show a transient "Copy failed — long-press to copy" toast.
**Impact.** Users in embeds, http origins, or with clipboard denied (a non-trivial slice, especially mobile/in-app browsers) can't share an area and get no feedback.

### E4 — Error and status toasts all stack at one coordinate and overlap illegibly · **Medium** · [Claude Code]
**Problem.** Every transient overlay renders at the identical absolute position `top-12 left-1/2 -translate-x-1/2 z-50`: the data-load `ErrorBanner`, the offline indicator, the geolocation status, the shared scope/city/address toast, and the locale-load error. Realistic combinations co-occur — going offline triggers both the offline banner and (on a region switch) the ErrorBanner; a geolocation prompt can overlap the locale-error toast — rendering them physically on top of each other with no offset.
**Where.** `src/components/ErrorBanner.tsx:9`; `src/App.tsx:2130, 2140, 2157, 2168`. *(Verified — ErrorBanner is at `top-12 left-1/2 z-50`.)*
**Fix.** Introduce a single top-center toast/stack container that lays active notices out vertically (flex column with gap) and assigns priority, instead of each notice absolutely positioning itself at the same coordinate.
**Impact.** Whenever two notices are active — common in the exact offline/error scenarios where clear messaging matters most — both are mutually obscured.

### E5 — Share-as-image failures are swallowed, and one path has no `catch` at all · **Medium** · [Claude Code]
**Problem.** The "Share as image" action lazy-imports the heavy html-to-image/scoreCard module. In `NeighborhoodPanel` the failure path is `.catch(() => {})`: if the module fails to load (offline, stale chunk after a deploy) the busy label flips back and nothing is produced. Worse, `ShortlistTray.handleShareImage` has a `try/finally` with **no `catch`**, so a load/render failure becomes an unhandled promise rejection while the user just sees the busy state revert.
**Where.** `src/components/NeighborhoodPanel.tsx:1019-1035` (esp. `:1024`); `src/components/ShortlistTray.tsx:85-96` (no catch). *(Verified.)*
**Fix.** Surface a transient "Couldn't generate image, try again" toast in both catch paths, and add an explicit `catch` to `ShortlistTray.handleShareImage`.
**Impact.** Users on a long-lived tab after a deploy, or offline, click "Share image," see the button flicker, and get silently nothing.

### E6 — WebGL fallback always says "reload," even when the device permanently lacks WebGL · **Medium** · [Claude Code]
**Problem.** Both `Map.tsx` and `SplitMapView.tsx` render `error.webgl_context_lost_desc` = "Map rendering was interrupted. Reload the page…" for **all** WebGL failures. That copy is correct only for a transient `webglcontextlost` event; the construction-failure path fires when the device/browser simply has no WebGL, where reloading is futile. A correct distinct string `error.webgl_unavailable_desc` ("Your browser or device doesn't support WebGL…") exists in all three locales but is wired up nowhere — confirming the differentiation was intended and dropped.
**Where.** `src/components/Map.tsx:1505-1523` (uses `:1513`) & `src/components/SplitMapView.tsx:762-780`; construction-failure source `Map.tsx:283-288`; unused correct string `src/locales/{fi,en,sv}.json:200`.
**Fix.** Track failure origin (a "permanent" flag in the construction catch vs the contextlost listener). For the permanent case show `error.webgl_unavailable_desc` and hide the Reload button; keep Reload only for transient context loss.
**Impact.** Users on devices without WebGL (older hardware, locked-down browsers, some webviews) are told to reload repeatedly, never understanding the map can't run there.

### E7 — Locale-load error banner is permanently silenced after one dismissal · **Low** · [Claude Code]
**Problem.** `localeErrorDismissed` initializes `false`, gates the locale-error banner, and is **only ever set to `true`** — never reset on a subsequent language switch or a new fetch failure. So after a user dismisses one failed en/sv dictionary load, every later failed language switch shows no banner: the UI silently stays in Finnish with no explanation and no retry.
**Where.** `src/App.tsx:121` (init), `:2165` (gate), `:2179` (only ever set true); failure source `src/utils/i18n.ts:48-52,97`. *(Verified.)*
**Fix.** Reset `localeErrorDismissed` to `false` inside `handleLangChange` (`App.tsx:1206`), or key the dismissal to the specific failing lang and reset when `getLocaleLoadError()` changes.
**Impact.** Non-Finnish users on flaky networks who dismiss one failure are then stranded in Finnish on every later retry with no indication.

### E8 — Popup-blocked PDF export uses a raw native `alert()`, localized only for Finnish/English · **Low** · [Claude Code]
**Problem.** When a print/PDF export's `window.open` is blocked, the only feedback is a native browser `alert()` — jarring and inconsistent with the otherwise-styled UI. The message is gated `getLang()==='fi' ? Finnish : English`, so Swedish users (a supported language) get an English alert.
**Where.** `src/utils/export.ts:206-213`. *(Verified.)*
**Fix.** Replace the `alert()` with the app's styled toast/`role=status` channel and a proper i18n key (`export.popup_blocked`, fi/en/sv).
**Impact.** Swedish users see an English error; all users get an off-brand native dialog when popups are blocked.

---

## 4. Empty states

### EM1 — Signed-out users can favorite areas but have no surface to see their favorites · **High** · [Claude Code]
**Problem.** The star toggle in the panel header renders for everyone (it only depends on `onToggleFavorite`), and favorites persist to localStorage even when signed out. But the **only** place favorites are listed is inside `UserMenu`, which is rendered only when `user` is truthy. There are no favorite markers on the map either. So a signed-out first-timer — the default, since accounts are optional — stars several areas, watches each star fill, then has no list, no markers, and no way back. The favorites empty-state illustration + "Mark neighborhoods with a star to save them here" copy *also* live only inside the login-gated menu. By contrast the shortlist (a near-identical feature) **does** have a signed-out surface via the floating ShortlistTray.
**Where.** `src/App.tsx:1781-1782` (`UserMenu` gated on `user`); `src/components/NeighborhoodPanel.tsx:891-906` (favorite toggle available signed-out); favorites list + empty state only in `UserMenu`. *(Verified: the favorites list lives behind `user ? <UserMenu/> : …`.)*
**Fix.** Surface favorites for anonymous users too — render a lightweight favorites list/tray not gated on `user` (mirror the ShortlistTray pattern), or move the list into a toolbar control. Keep cloud-sync as an upsell, not a gate. At minimum, on a signed-out user's first favorite, show a one-time toast pointing to where saved areas live.
**Impact.** Affects every signed-out visitor (the default majority) who tries the prominent star — they save areas into a void, which reads as a broken feature. *(Merges the Empty-states and Core-flows duplicate reports.)*

### EM2 — National-scope similarity load failure leaves a silent empty list with the toggle stuck on "national" · **Medium** · [Claude Code]
**Problem.** Switching the Similar section to national scope lazy-loads `loadAllData()`. On failure the catch is **empty** — its own comment says "toggle back to region" but the code does not revert `similarityScope`. After failure `nationalFeatures` is null, so the similar list resolves to `[]`: the toggle still shows "national" selected, but the results area is empty with no spinner, no error, no retry — indistinguishable from "no similar areas exist."
**Where.** `src/components/NeighborhoodPanel.tsx:1089-1096` (silent catch, no revert) → `:1098,1106-1113` (empty result). *(Verified by the adversarial pass — the catch body is genuinely empty.)*
**Fix.** In the catch, either revert `setScope('region')` (matching the comment) or set an error flag and render an inline error+retry row (mirroring `IsochroneControls`). Don't leave the national toggle selected with an unexplained empty result.
**Impact.** Users who pick national scope on a flaky/blocked connection see a blank Similar section that looks like "no matches."

### EM3 — Deselecting all similarity metrics produces a silent blank with no guidance · **Medium** · [Claude Code]
**Problem.** In the Similar section the user can toggle each metric chip off. When every chip is off, the panel passes an empty metric list / all-zero weights to `findSimilarNeighborhoods`; every candidate is skipped (`usedWeight === 0`), so the `similar` array is empty and the render maps it to nothing — the chips remain visible but the results area is blank, with no "select at least one metric" hint. A first-timer experimenting with the chips assumes the feature broke.
**Where.** `src/components/NeighborhoodPanel.tsx:1750-1776` (empty `.map` renders nothing) & `:1106-1113`; `src/utils/similarity.ts:167`.
**Fix.** When all metrics are off, render an inline hint (new key `panel.similar_no_metrics`: "Select at least one metric to find similar areas") in place of the empty results.
**Impact.** Hits any user who turns all the per-metric similarity chips off; the feature appears dead with no recovery cue.

### EM4 — RadarChart plots missing metrics at the center, making "no data" look identical to "worst score" · **Medium** · [Claude Code]
**Problem.** `normalize()` maps a null/NaN metric to `0`, which plots that axis at the chart center — exactly where a genuine bottom-of-range score also plots. There's no distinct "no data" marker. An area that simply lacks crime, property-price, or education data renders visually identical to one that genuinely scores worst, so a first-timer reading a sparse/low-coverage area's radar misreads data gaps as a terrible score. (The would-be guard at `:204` never fires, because `normalize` already returned a finite `0`.)
**Where.** `src/components/RadarChart.tsx:84-90` (null → 0 → center); rendered for every selected area at `NeighborhoodPanel.tsx:1276`. *(Verified by the adversarial pass.)*
**Fix.** Track which axes have null input and render them distinctly — omit the vertex / draw a hollow or dashed marker and add "no data" to the footnote/aria text — so absent metrics aren't conflated with the lowest score.
**Impact.** Anyone viewing the radar for a partially-covered area (common outside the largest metros); systematically misrepresents data gaps as poor performance.

### EM5 — Education breakdown shows an orphan heading with no bars when all four values are null/zero · **Low** · [Claude Code]
**Problem.** The "Education" heading always renders, but each `BarSegment` returns `null` below 1%, and `eduTotal` falls back to `1` when all four education fields are null/zero. For a low-coverage area where `ko_yl_kork/ko_al_kork/ko_ammat/ko_perus` are all null, the section renders the heading followed by nothing — an empty labeled block that looks like a rendering bug.
**Where.** `src/components/NeighborhoodPanel.tsx:1241-1250` (heading + segments); `:264-265` (segment returns null <1%); `:795-799` (`eduTotal` fallback). *(Verified.)*
**Fix.** Guard the block: if all four values are null, hide the heading or render an em-dash / "no data" placeholder, consistent with how other missing metrics show "—".
**Impact.** Edge case for low-coverage areas; an empty headed section reads as a bug.

---

## 5. Loading & async feedback

### L1 — Split-view grid layers download (up to ~11 MB) with no loading indicator · **Medium** · [Claude Code]
**Problem.** In the main map, picking a grid layer shows a spinner in the Legend while the grid downloads. The split/compare view has none: the right pane's grid hook never even captures the loading flag (`App.tsx:334` destructures only `gridData`), and `SplitPaneLegend` has no loading prop or spinner. `light_pollution_grid.geojson` is 10.82 MB. So a user in split view who picks one of these waits several seconds on a coarse choropleth while the scope badge already reads "▦ national/regional grid" — implying fine detail that's still silently downloading.
**Where.** `src/App.tsx:334` (only `gridData` destructured); `src/components/SplitMapView.tsx:91-125` (`SplitPaneLegend` has no loading prop); `public/data/light_pollution_grid.geojson` = 10.82 MB.
**Fix.** Destructure `loading` from `useGridData` for the secondary layer, pass per-pane `gridLoading` into `SplitMapView`, and render the same `role=status` spinner the main Legend uses inside `SplitPaneLegend`.
**Impact.** Anyone using split view with air-quality or light-pollution (esp. the right pane) sees a multi-second silent wait that reads as "this layer has no detailed data."

### L2 — Clicking "Sign in" (and split view, shortcuts) shows nothing while the lazy chunk downloads · **Medium** · [Claude Code]
**Problem.** `AuthModal` is lazy-imported and mounted with `Suspense fallback={null}`; the trigger just calls `setShowAuth(true)` with no pending state (the keyboard shortcut `L` too). On a cold/slow connection the auth chunk isn't fetched yet, so clicking "Kirjaudu" produces zero visible change until the chunk lands — the button feels dead and a first-timer clicks repeatedly. The same `fallback={null}` blanks the area when toggling split view (heavy `SplitMapView` chunk) and opening the shortcuts overlay.
**Where.** `src/App.tsx:46` (lazy AuthModal), `:2249-2257` (`Suspense fallback={null}`), `:1791-1806` (trigger has no pending state).
**Fix.** Give user-initiated lazy modals a visible fallback — reuse the existing `PanelSkeleton` (`App.tsx:95-102`) or a dimmed backdrop+spinner for `AuthModal`/`ShortcutsOverlay`/`SplitMapView`.
**Impact.** First-timers on slower networks who try to create an account get a dead-feeling button on the very action the app most wants them to take.

### L3 — Switching language gives no in-flight feedback; the UI stays Finnish then pops · **Medium** · [Claude Code]
**Problem.** `handleLangChange` calls `void setLang(next)` and ignores the returned promise. `setLang` flips `currentLang` and notifies subscribers synchronously (the language button's highlight/`aria-pressed` flips at once), but the en/sv dictionaries are lazy-fetched and `t()` keeps returning the Finnish fallback until the fetch resolves. So on a slow connection the whole UI sits in Finnish for a noticeable beat after the click, then suddenly re-renders — looking like the click did nothing.
**Where.** `src/App.tsx:1206-1213`; `src/utils/i18n.ts:81-92, 114-116` (`setLang` returns the pending promise, but no UI consumes it). *(Verified: `setLang` returns the load promise.)*
**Fix.** Use the promise `setLang` returns: in `SettingsDropdown` track a pending flag for the clicked language and show a tiny inline spinner until it settles. Better still, defer flipping `currentLang` until the new dict loads so the previous language stays rendered (no Finnish-fallback flash). *(Merges the Loading and Perceived-performance reports.)*
**Impact.** Every non-Finnish first-timer who switches language on a slow network — the toggle feels unresponsive.

---

## 6. Mobile & small-screen experience

### M1 — Split-view layer pickers sit *behind* the top header — unusable on mobile · **High** · [Claude Code]
**Problem.** In split/compare-layers mode each pane renders its layer `<select>` at `absolute top-2 left-2 z-10` (8px from the top), but the app header is `absolute top-0 h-12 z-20` — a 48px-tall, 80%-opaque bar drawn **on top** (`z-20 > z-10`) across the full width. Both pane pickers fall inside the header band and are visually covered and click-blocked. The single-map convention offsets chrome to `top-[3.5rem]` to clear the header (see `LayerSelector`, `SearchBar`), but the split panes were never given that offset. On phones it compounds: the two maps are a hard 50/50 (`w-1/2`, ~180px each) and `.maplibregl-ctrl-group` zoom buttons are hidden below 768px — so split view is two cramped maps with no working layer picker and no zoom buttons.
**Where.** `src/components/SplitMapView.tsx:790` & `:816` (pane pickers `absolute top-2 left-2 z-10`); `:786` (root `flex h-full w-full`, no header offset); `src/App.tsx:1724` (header `h-12 z-20`); `src/index.css:157-161` (mobile zoom controls hidden). *(Verified: both pickers are at `top-2 z-10` under the `z-20` header.)*
**Fix.** Offset both pane control rows below the header (`top-2` → `top-[3.5rem]`, or `pt-12` on the SplitMapView root). On mobile, consider stacking the panes vertically (`flex-col`, each map `h-1/2 w-full`) below ~768px and surfacing a per-pane zoom affordance since the default zoom group is hidden there.
**Impact.** Every mobile (and desktop) user who opens Compare-layers/split — the pickers look broken and the headline comparison feature is effectively non-functional on phones.

### M2 — Time slider overlaps the Legend on mobile and is never hidden when a panel opens · **Medium** · [Claude Code]
**Problem.** When a trends/time-series layer is active the `TimeSlider` renders `fixed bottom-5 left-1/2 -translate-x-1/2 z-10` (~20px from bottom, centered, 160px wide). The Legend renders `fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-3 z-10` — also ~20px from the bottom. On a 360–390px phone the two physically overlap. Worse: the Legend and Layers FAB are suppressed when an area is selected (`hidden={!!selected}`), but the `TimeSlider` is rendered with **no `hidden` prop**, so when a neighborhood is selected it stays at `z-10` trapped behind the `z-20` panel — half-covered and partially tappable through the gap above the sheet.
**Where.** `src/components/TimeSlider.tsx:26`; `src/App.tsx:1896-1906` (TimeSlider rendered with no `hidden`; cf. Legend at `:1893` which gets `hidden={!!selected}`). *(Verified: TimeSlider has no `hidden` prop while the adjacent Legend does. Scoped to the Trends layer group, hence Medium not High.)*
**Fix.** Pass `hidden={!!selected}` to `TimeSlider` and have it return null (mirroring Legend/LayerSelector). On mobile, move the slider above the legend band (e.g. `bottom-[calc(7rem+env(safe-area-inset-bottom))]`) or make it full-width centered above the legend.
**Impact.** First-timers exploring the Trends layers on a phone see the legend and play/scrub control overlapping; selecting an area leaves the slider stuck behind the sheet.

### M3 — Shortlist tray action row overflows with tiny touch targets and overlaps the Layers FAB · **Medium** · [Claude Code]
**Problem.** The ShortlistTray header packs up to 7 actions (Compare · Share link · Image · CSV · PDF · GeoJSON · Clear) into one `flex items-center gap-2 text-xs` row with no `flex-wrap` and no per-button min-height — bare `text-xs` text buttons. Inside a `w-[min(92vw,560px)]` tray (~331px on a 360px phone) that row can't fit and overflows / crushes the title, and each ~10px text button is far below the 44px touch minimum used elsewhere. The tray (`z-10`, `bottom-20`) and the Layers FAB (`z-30`, bottom-right) are both shown on the idle home view, so the FAB sits on top of the tray's bottom-right "Clear" end.
**Where.** `src/components/ShortlistTray.tsx:119` (container) & `:126-184` (non-wrapping `text-xs` row); `src/components/LayerSelector.tsx:329` (FAB `z-30`).
**Fix.** On mobile collapse secondary exports (Image/CSV/PDF/GeoJSON) behind one "Export" overflow, or allow the row to `flex-wrap`; give each action `min-h-[44px]`; raise/shift the tray so it doesn't sit under the bottom-right FAB.
**Impact.** Mobile users with a shortlist (the core "compare candidates" workflow) get a cramped, overflowing strip with mis-tap-prone targets and a FAB covering part of it.

### M4 — No lightweight value preview on touch — reading any value requires opening the full sheet · **Medium** · [Claude Code]
**Problem.** The hover tooltip (name, value, vs-avg delta) is CSS-hidden on touch via `@media (hover:none) and (pointer:coarse)`. On mobile the only way to see one area's value for the active layer is a full tap that opens the half-screen panel, then close, then tap the next. For a choropleth whose whole point is comparing values, mobile users must repeatedly open and dismiss a heavy sheet to compare even two neighborhoods.
**Where.** `src/index.css:150-155` (`.tooltip-desktop { display:none }` on coarse pointers); `src/components/NeighborhoodPanel.tsx:1924` (full sheet is the only touch read path).
**Fix.** Add a lightweight touch "peek" on single tap — a compact one-line bar (name + formatted value + vs-avg) anchored at the bottom that updates per tap, with a "details" affordance to open the full sheet.
**Impact.** Every mobile visitor comparing areas — the core task is slow because each value read costs a full sheet open/close.

### M5 — Bottom sheet and tab carousel animate regardless of `prefers-reduced-motion` · **Medium** · [Claude Code]
**Problem.** The mobile `NeighborhoodPanel` and `LayerSelector` sheets hardcode `transition: 'height 0.3s cubic-bezier(...)'`, and the panel's swipeable tab carousel hardcodes a `transform` transition — none consult the existing `useReducedMotion()` / `prefersReducedMotion()` helper, even though the app already gates the camera `flyTo`, the count-up, and the layer fade on reduced motion. So users who set "Reduce Motion" still get the full sliding/snapping on every sheet open, drag, and tab swipe — the two most frequent mobile interactions.
**Where.** `src/components/NeighborhoodPanel.tsx:1940` (sheet height) & `:2044` (carousel transform); `src/components/LayerSelector.tsx:366` (sheet height); `src/hooks/useSwipeNavigation.ts:147-150`.
**Fix.** Read `useReducedMotion()` in the sheet/carousel components and set the transition to `'none'` (instant snap) when reduced motion is preferred, matching the map's fast-path. *(Merges the Mobile and Perceived-performance reports.)*
**Impact.** Mobile users with vestibular sensitivity who opted out still get sliding sheets and snapping carousels on every interaction.

### M6 — LayerSelector mobile sheet drag handle omits `onTouchCancel`, risking a frozen sheet · **Low** · [Claude Code]
**Problem.** The shared `useBottomSheet` hook exposes `onTouchCancel` so a system-interrupted drag (incoming notification, multi-touch, OS edge-swipe — where the browser fires `touchcancel` instead of `touchend`) resets `isDragging`/`dragHeight`. The `NeighborhoodPanel` sheet wires all four handlers; the `LayerSelector` sheet wires only `onTouchStart/Move/End`, so a cancelled drag leaves `isDragging` true, the height transition disabled, and the sheet frozen at the last dragged height until the next touch.
**Where.** `src/components/LayerSelector.tsx:370-377`; cf. `src/components/NeighborhoodPanel.tsx:1944-1950`; the unused cancel path at `src/hooks/useBottomSheet.ts:161-164`.
**Fix.** Add `onTouchCancel={sheetHandlers.onTouchCancel}` to the LayerSelector drag handle.
**Impact.** Mobile users interrupted mid-drag of the Layers sheet can briefly land it stuck; self-heals on next touch (low frequency).

### M7 — Area-summary sheet stacks over the neighborhood sheet on mobile (missing `suppressMobile`) · **Low** · [Claude Code]
**Problem.** `ComparisonPanel` was given a `suppressMobile` prop precisely because it and the `NeighborhoodPanel` mobile sheet both anchor `fixed bottom-0 z-20`. `AreaSummaryPanel`'s mobile sheet is also `md:hidden fixed bottom-0 z-20` but has no such suppression. If a drawn/selected area is active (AreaSummaryPanel showing) and the user taps a single polygon, `NeighborhoodPanel` opens — but because `AreaSummaryPanel` renders later in the DOM at the same `z-20`, it paints on top and covers the just-opened neighborhood sheet.
**Where.** `src/components/AreaSummaryPanel.tsx:226` (no suppress); `src/App.tsx:2044` (rendered without `suppressMobile`) vs `:1934` (NeighborhoodPanel); pattern at `src/components/ComparisonPanel.tsx`.
**Fix.** Give `AreaSummaryPanel` a `suppressMobile` prop mirroring `ComparisonPanel` and pass `suppressMobile={!!selected}` (or clear the drawn polygon on single-area select).
**Impact.** Mobile users who draw/select then tap a polygon get the expected panel hidden behind the area-summary sheet — a "my tap did nothing" moment (reachable only via the draw+select sequence, so lower frequency).

---

## 7. Accessibility (keyboard, focus, screen reader, motion, contrast)

### A1 — Auth modal (and ShortcutsOverlay) set `aria-modal` but never trap focus · **High** · [Claude Code]
**Problem.** The sign-in/sign-up dialog declares `role="dialog" aria-modal="true"` (which tells AT the rest of the page is inert) but installs no Tab handler — its only keydown listener is Escape. Focus is moved in on open and restored on close, yet a keyboard/SR user who Tabs past the last element (the privacy link) lands on the map controls / header behind the overlay — content the modal just declared inert. The project already does this right in `OnboardingTour` (a full Tab trap); `AuthModal` and `ShortcutsOverlay` are the inconsistent ones.
**Where.** `src/components/AuthModal.tsx:109-122` (no Tab handler; only `handleEsc`); `src/components/ShortcutsOverlay.tsx:36-83`; correct pattern at `OnboardingTour.tsx:145-163`. *(Verified: AuthModal's sole keydown handler is Escape.)*
**Fix.** Add a Tab/Shift+Tab handler cycling focus among the dialog's focusable elements (mirror `OnboardingTour`), or apply `inert`/`aria-hidden` to the background while open. Apply the same to `ShortcutsOverlay`.
**Impact.** Keyboard-only and SR users creating an account can tab out into background controls announced as inert — breaks the modal contract on the action the app most wants completed.

### A2 — Dual-thumb filter sliders have no accessible name or value text · **High** · [Claude Code]
**Problem.** Each filter criterion renders two `<input type="range">` thumbs with **zero ARIA** — no `aria-label`, no `aria-labelledby`, no `aria-valuetext`. A screen reader announces both identically as a bare "slider, 50" with no indication of which metric the slider controls (the metric name lives in an unassociated sibling) or whether it's the lower or upper bound; percentile-vs-absolute values aren't conveyed either.
**Where.** `src/components/FilterPanel.tsx:128-166` (min thumb `128-148`, max thumb `150-166`). *(Verified: both inputs have only styling classes, no ARIA.)*
**Fix.** Add `aria-label` to each input naming the metric and bound (`${t(layer.labelKey)} – ${t('filter.min')}` / `– max`), and `aria-valuetext` set to the formatted value (`layer.format(value)` or `P${value}`).
**Impact.** SR users can't meaningfully operate the Filter tool — a core feature — because every slider sounds the same and gives no metric, bound, or formatted value.

### A3 — The map canvas focus indicator is explicitly removed · **Medium** · [Claude Code]
**Problem.** MapLibre is initialized without `keyboard:false`, so its handler makes the canvas tab-focusable (`tabindex=0`) and arrow-pannable — but `index.css` deliberately removes the canvas's `:focus-visible` outline. A sighted keyboard-only user who Tabs to the map gets no visible focus indicator at all — they can't tell the map is focused or that arrow keys will pan it (WCAG 2.4.7).
**Where.** `src/index.css:22-25` (`.maplibregl-canvas:focus-visible { outline: none; }`); focusability set in `src/components/Map.tsx:274-282, 340-341`.
**Fix.** Replace the blanket `outline:none` with a visible custom focus indicator on the canvas (e.g. an inset box-shadow ring).
**Impact.** Sighted keyboard users lose track of focus when it reaches the map and get no cue that arrow-key panning is available.

### A4 — Tools menu uses `role=menu` but implements no arrow-key navigation · **Medium** · [Claude Code]
**Problem.** The Tools popover sets `role="menu"` with `role="menuitem"` children and moves focus to the first item on open, but provides no Up/Down traversal — only Escape and outside-click. `role="menu"` tells screen readers to enter menu mode where arrow keys are the expected (often only AT-exposed) way to move between items; Tab is non-standard there. Users following the announced semantics press arrows and nothing happens.
**Where.** `src/components/ToolsDropdown.tsx:124-131` (role=menu) & `:84-89` (focus first item, no arrow handler).
**Fix.** Either implement roving-tabindex arrow-key navigation (Up/Down between items, Home/End), or drop `role="menu"`/`"menuitem"` in favor of a plain focusable button list so Tab is the documented interaction.
**Impact.** SR users in menu mode can't navigate the primary feature-discovery hub the way its ARIA role promises.

### A5 — Mobile bottom sheet is `aria-modal` at full snap but does not trap focus · **Medium** · [Claude Code]
**Problem.** The mobile neighborhood panel sets `aria-modal={snap==='full'}` — true when expanded full-screen — yet intentionally does not trap focus (acknowledged in a comment). With `aria-modal=true`, AT treats everything outside the sheet as inert, but because focus isn't contained, a keyboard/SR user can still Tab out into the map and chrome behind it, contradicting the announced semantics.
**Where.** `src/components/NeighborhoodPanel.tsx:1924-1942` (aria-modal at `:1928`; no-trap noted at `:850-865`).
**Fix.** When `snap==='full'`, trap focus within the sheet (or only set `aria-modal` once a real trap/inert background exists); conversely, if focus genuinely should not be trapped, don't set `aria-modal=true`.
**Impact.** SR users on mobile who expand the area panel can tab into content declared inert — inconsistent structure on the most common mobile interaction.

### A6 — Hardcoded English strings/labels bypass i18n in several controls · **Medium** · [Claude Code]
**Problem.** Four user-facing controls hardcode English instead of routing through `t()`, so Finnish and Swedish users (including SR users) get English: `RankingTable` close button `aria-label="Close ranking"`, `FilterPanel` close `aria-label="Close filter"`, `LayerSelector` search-clear `aria-label="Clear search"`, and `ComparisonPanel` `title="Remove"` (visible on hover). The sibling `RegionRankingTable` correctly uses `t('aria.close')`, proving the key exists and the inconsistency is accidental.
**Where.** `src/components/RankingTable.tsx:113`; `src/components/FilterPanel.tsx:677`; `src/components/LayerSelector.tsx:153`; `src/components/ComparisonPanel.tsx:377`. *(Merges the Accessibility and Discoverability lenses.)*
**Fix.** Replace all four literals with `t()` calls (`t('aria.close')`; add `aria.clear_search` / `compare.remove` keys with fi/en/sv parity).
**Impact.** All Finnish/Swedish users — the `title="Remove"` tooltip shows English on hover, and SR users on fi/sv hear English on three close/clear controls.

### A7 — Map exposes nested, duplicated `role="application"` regions · **Low** · [Claude Code]
**Problem.** Both the map wrapper div (`role="application"` + "Kartta, aineisto: {layer}…") and the inner MapLibre canvas (`role="application"` + "Karttanäkymä asuinalueista") carry `role="application"`. This nests one application region inside another with two different names, and applies the heavy-handed role to the outer wrapper that has no keyboard behavior of its own (only the inner canvas pans/zooms).
**Where.** `src/components/Map.tsx:1529-1530` (container) and `src/components/Map.tsx:340-341` (canvas).
**Fix.** Keep `role="application"` on only the canvas that handles keys; give the wrapper `role="region"`/`group` with the descriptive name, or reference the sr-only keyboard instructions via `aria-describedby`.
**Impact.** SR users navigating by landmark hit a redundant, doubly-named application layer with no operable content in the outer one — minor disorientation.

---

## 8. Cross-cutting: discoverability, trust & perceived performance

### X1 — Data Sources & Methodology page is unreachable on mobile · **High** · [Claude Code]
**Problem.** The Data Sources & Methodology page is the app's central trust artifact — every layer's source, license, vintage, freshness, per-postal coverage, measured-vs-estimate flag, and the Quality Index methodology. It's well-built, but the **only** in-app link lives inside the attribution footer, which is wrapped in `hidden md:block` (desktop only). The mobile-reachable Settings dropdown carries the Privacy link but **no** Data Sources link. So a first-time mobile visitor — likely the majority of traffic — can't reach any provenance/methodology page, undermining the app's "every value traces to a real source" positioning for exactly the audience that can't see the footer.
**Where.** `src/App.tsx:2192-2205` (footer `hidden md:block` + the sole `footer.sources` link); `src/components/SettingsDropdown.tsx` (privacy link present, **no** sources link — confirmed by search). *(Verified both ends.)*
**Fix.** Add a "Tietolähteet / Data sources" item to the Settings dropdown beside the privacy link (reuse the lang-aware `href` from `App.tsx:2201`). One anchor tag, reachable everywhere the gear menu is.
**Impact.** All mobile users lose access to data provenance, freshness, licensing and proxy disclosures — the strongest trust signals the app has.

### X2 — Auth modal never explains what an account is for · **Medium** · [Claude Code]
**Problem.** The sign-in/sign-up modal opens straight into tabs and fields (username, 12-char password, optional email, Turnstile) with **zero** value-proposition copy. Nothing tells a first-timer that an account syncs favorites, shortlist, notes and preferences across devices — that benefit is described only on the separate Privacy page. The trigger is just an icon/"Kirjaudu" with no subtitle. A newcomer asked for a 12-character password has no stated reason to create one.
**Where.** `src/components/AuthModal.tsx:109-266` (no intro copy); `src/App.tsx:1791-1806` (trigger is icon/label only).
**Fix.** Add a one-line subtitle under the tab header, e.g. `t('auth.value_prop')` = "Luo maksuton tili ja synkronoi suosikit, vertailulista ja muistiinpanot laitteiden välillä." (fi/en/sv parity).
**Impact.** Every logged-out first-timer who opens auth sees a credential form with no incentive, so most abandon it.

### X3 — Donations are Bitcoin-Lightning-only and unexplained · **Medium** · [**Manual Setup**]
**Problem.** The "Tue projektia / Support the project" control offers a single path: a copyable BOLT12 string + QR ("Works with Phoenix, Zeus, and other BOLT 12 compatible wallets"). There's no card/MobilePay/bank option, and no copy explaining who runs naapurustot.fi or what a donation funds. For a general Finnish civic-data audience, Lightning/BOLT12 is a niche method almost no one can act on, and an unexplained opaque crypto string under "support us" erodes trust rather than building it.
**Where.** `src/components/DonateButton.tsx:9-10` (BOLT12 is the only method) & `:64-115`; `src/locales/fi.json:301-307`, `en.json:302-307`.
**Fix.** Add a conventional option (MobilePay / bank / Ko-fi / Stripe link) alongside Lightning. **This is the Manual-Setup item** — it requires creating/holding a payment-provider account and credentials, so it can't be completed in a code-only session. *Interim, code-only mitigation:* add a one-line legitimacy/intent statement (who maintains the project, that it's a non-commercial open-data hobby, what funds cover) so the crypto string isn't the entire pitch — that copy change **is** doable in a Claude Code session and can land first.
**Impact.** Practically everyone who wants to support the project is excluded by the payment method, and the opaque string dents perceived legitimacy for casual viewers.

### X4 — On-map "Arvio/Estimate" legend badge has no explanation · **Low** · [Claude Code]
**Problem.** When a proxy/derived layer is active, the Legend shows an amber "Arvio" badge with no tooltip or info affordance. A first-timer sees the badge but can't learn the value is modeled (e.g. municipality figures distributed to postal codes). The `NeighborhoodPanel` does this right — it pairs the identical badge with an explanatory `data.estimate_desc` popover — so the legend is the one place the disclosure lacks its explanation.
**Where.** `src/components/Legend.tsx:93-100` (badge, no title); contrast `src/components/NeighborhoodPanel.tsx:201-205`.
**Fix.** Add `title={t('data.estimate_desc')}` to the legend badge span (or a small "i" affordance), matching the panel.
**Impact.** First-timers exploring proxy layers see an unexplained "Arvio" tag and may distrust or misread the data.

### X5 — Layer switch dissolves the choropleth to nothing before recoloring, while the legend updates instantly · **Medium** · [Claude Code]
**Problem.** On a layer switch the fill fades to opacity 0 over 150ms, the color expression is swapped 180ms later, then faded back in over 200ms. So for ~350ms the choropleth data is gone (only the basemap shows) while the Legend — keyed off `activeLayer` — already shows the new metric's title/ramp. The result is a brief map/legend contradiction and a recolor that never feels instant across 59 layers.
**Where.** `src/components/Map.tsx:912-974`.
**Fix.** Crossfade between two stacked fill layers (old colors stay visible while new ones fade in), or fade only to a partial opacity (e.g. 0.3) so data never fully disappears, or shorten the dip. The legend already updates instantly; the map should too.
**Impact.** Affects every user who toggles layers — the headline interaction — making it feel sluggish and slightly broken.

### X6 — Notes textarea autosaves silently with no "saving/saved" acknowledgment · **Low** · [Claude Code]
**Problem.** The notes field writes on every keystroke via `setNote` but shows no saved/saving indicator. For a logged-out user there's no confirmation the note persisted to localStorage; for a logged-in user it also syncs to the server in the background with no positive signal. After typing and closing the panel, the user has no feedback the input was captured.
**Where.** `src/components/NeighborhoodPanel.tsx:776-787`.
**Fix.** Add a subtle debounced "Saving…/Saved" label next to the notes heading (reuse the transient-flag pattern already used for the copy-link confirmation); for logged-in users, reflect the existing sync status.
**Impact.** Any user who writes a note is left unsure it was stored, reducing trust that the action registered.

---

## Suggested Sequencing

**How to read this.** The repo auto-merges `claude/*` branches **serially** (shared concurrency group — pushing a second branch cancels an in-flight merge), so "parallel-safe batch" here means: *a set of items that are logically independent — none depends on another's change and none contradicts another — so they can be assigned to separate sessions and merged one after another without rework.* The practical risk isn't logic, it's textual collisions on a few **hotspot files** that many items touch. Within a batch, items that share a hotspot file are flagged `↻file` and should be run sequentially (or expect a trivial rebase); items with no flag touch disjoint files.

**Hotspot files** (touched by many findings — serialize edits): `App.tsx`, `NeighborhoodPanel.tsx`, `Map.tsx`, `SplitMapView.tsx`, `SettingsDropdown.tsx`, `LayerSelector.tsx`, `ShortlistTray.tsx`, `Legend.tsx`, and the three locale JSONs `src/locales/{fi,en,sv}.json` (`ⓛ` = adds locale keys — only one `ⓛ` item per batch, or coordinate the key additions).

Batches are ordered by **dependency then priority**. Every item is `[Claude Code]` except **X3** (Manual Setup).

---

### Batch 1 — Unblock & make failures honest *(highest impact; files fully disjoint — true parallel)*
The top "looks broken / excludes users" fixes, each owning a different file.

| Item | Owns | Notes |
|------|------|-------|
| **E1** ErrorBanner `role="alert"`/`aria-live` | `ErrorBanner.tsx` | also resolves the a11y "not announced" report |
| **A2** Filter slider ARIA | `FilterPanel.tsx` | |
| **A1** AuthModal + ShortcutsOverlay focus trap | `AuthModal.tsx`, `ShortcutsOverlay.tsx` | |
| **A3** Map canvas focus ring | `index.css` | |
| **X1** Data Sources link in Settings | `SettingsDropdown.tsx` | |
| **C3** Mobile shortlist + reference buttons | `NeighborhoodPanel.tsx` | only NP item this batch |
| **O1** Stray-click no longer kills the tour | `OnboardingTour.tsx` (+`App.tsx` flag) | only App item this batch |
| **A7** De-duplicate `role="application"` | `Map.tsx` | only Map item this batch |

### Batch 2 — Core-flow correctness & navigation feel
Depends on nothing in Batch 1 logically; separated so its `App.tsx`/`LayerSelector`/`Legend` edits don't collide with Batch 1 or 3.

| Item | Owns | Notes |
|------|------|-------|
| **C1** Region-switch overlay: cold-vs-switch, keep chrome interactive | `App.tsx`, `useMapData.ts` | `↻App.tsx` |
| **C2** Address search resolves in all-Finland view | `SearchBar.tsx` (+`App.tsx` `handleSearch`) | `↻App.tsx` — run after C1 |
| **C4** Layer panel defaults to expanded / active group open | `LayerSelector.tsx` | |
| **E2** Grid-fetch error flag + Legend note | `useGridData.ts`, `Legend.tsx` | |
| **A4** Tools menu arrow-key navigation | `ToolsDropdown.tsx` | |
| **M1** Split-view pickers below header (+ mobile stack/zoom) | `SplitMapView.tsx`, `index.css` | |
| **EM4** RadarChart distinguishes no-data from worst | `RadarChart.tsx` | |

### Batch 3 — Empty/loading feedback & the Similar-areas section
`NeighborhoodPanel.tsx` is heavy here — run the NP items sequentially (`↻NP`).

| Item | Owns | Notes |
|------|------|-------|
| **EM1** Signed-out favorites surface (tray/list) | `App.tsx` (+ small new component) | `↻App.tsx` |
| **EM2** National-similarity failure: revert/retry | `NeighborhoodPanel.tsx` | `↻NP` |
| **EM3** "Select at least one metric" hint | `NeighborhoodPanel.tsx` ⓛ | `↻NP`; `ⓛ` |
| **E3** Clipboard-blocked copy fallback | `NeighborhoodPanel.tsx`, `ShortlistTray.tsx` | `↻NP`, `↻ShortlistTray` |
| **L1** Split-view grid loading spinner | `App.tsx`, `SplitMapView.tsx` | `↻App.tsx` |
| **EM5** Education orphan-heading guard | `NeighborhoodPanel.tsx` | `↻NP` |

### Batch 4 — Notifications, lazy-load feedback & i18n correctness
**E4 depends on E1** (Batch 1) — it consolidates the now-role-annotated ErrorBanner and the other top-center notices into one stack; new-toast items below should adopt it.

| Item | Owns | Notes |
|------|------|-------|
| **E4** Unified top-center toast/stack container | `App.tsx`, `ErrorBanner.tsx` | `↻App.tsx`; depends on **E1** |
| **E5** Share-image catch + ShortlistTray catch | `NeighborhoodPanel.tsx`, `ShortlistTray.tsx` | `↻NP`, `↻ShortlistTray` |
| **E8** PDF popup-blocked → styled toast + i18n | `export.ts` ⓛ | `ⓛ`; ideally uses E4 |
| **A6** Replace hardcoded English labels with `t()` | `RankingTable.tsx`, `FilterPanel.tsx`, `LayerSelector.tsx`, `ComparisonPanel.tsx` ⓛ | `ⓛ` |
| **E7** Reset locale-error dismissal on lang change | `App.tsx` | `↻App.tsx` — run after E4 |
| **E6** WebGL permanent-vs-transient messaging | `Map.tsx`, `SplitMapView.tsx` | |

### Batch 5 — Internationalization reach & onboarding signposting
Language detection + the scope/onboarding copy fixes. Heavy on locales (`ⓛ`) and `App.tsx`/`SettingsDropdown` — serialize those.

| Item | Owns | Notes |
|------|------|-------|
| **O2** `navigator.language` auto-detect + labeled lang switch | `i18n.ts`, `App.tsx`, `SettingsDropdown.tsx` ⓛ | `↻App.tsx`, `↻Settings`, `ⓛ` |
| **L3** Language-switch in-flight spinner | `SettingsDropdown.tsx`, `i18n.ts` | `↻Settings` — run after O2 |
| **O4** All-Finland scope signpost + soften copy | `Legend.tsx`, `App.tsx` ⓛ | `↻App.tsx`, `ⓛ` |
| **O3** Persistent on-map "click an area" hint pill | `App.tsx` ⓛ | `↻App.tsx`, `ⓛ` — run after O4 |
| **O5** Broaden auto-tour skip-gate | `App.tsx` | `↻App.tsx` |
| **C5** Disambiguate "compare areas" vs "compare layers" | `ToolsDropdown.tsx` ⓛ | `ⓛ` |
| **X2** Auth value-prop subtitle | `AuthModal.tsx` ⓛ | `ⓛ` |

### Batch 6 — Mobile polish, perceived performance & remaining low-priority
Mostly independent polish; `NeighborhoodPanel`/`LayerSelector`/`Map` appear a few times — serialize those.

| Item | Owns | Notes |
|------|------|-------|
| **M2** Hide TimeSlider when panel open + de-overlap legend | `TimeSlider.tsx`, `App.tsx` | `↻App.tsx` |
| **M3** Shortlist tray wrap/touch targets + FAB de-overlap | `ShortlistTray.tsx`, `LayerSelector.tsx` | |
| **M4** Lightweight touch "peek" value bar | `NeighborhoodPanel.tsx`, `index.css` | `↻NP` |
| **M5** Honor reduced-motion on sheet + carousel | `NeighborhoodPanel.tsx`, `LayerSelector.tsx`, `useSwipeNavigation.ts` | `↻NP` — run after M4 |
| **M6** LayerSelector sheet `onTouchCancel` | `LayerSelector.tsx` | run after M3 |
| **M7** AreaSummaryPanel `suppressMobile` | `AreaSummaryPanel.tsx`, `App.tsx` | `↻App.tsx` |
| **L2** Visible fallback for lazy modals | `App.tsx` | `↻App.tsx` |
| **X5** Crossfade layer recolor (no blank gap) | `Map.tsx` | |
| **A5** Trap focus (or drop `aria-modal`) on full-snap sheet | `NeighborhoodPanel.tsx` | `↻NP` |
| **O6** Show welcome step during nationwide load | `App.tsx` | `↻App.tsx` |
| **O7** Visible scope label on mobile globe | `CitySelector.tsx` | |
| **X4** "Arvio" legend badge tooltip | `Legend.tsx` ⓛ | `ⓛ` |
| **X6** Notes "Saved/Saving" indicator | `NeighborhoodPanel.tsx` | `↻NP` |

### Manual-Setup track *(independent of all batches — schedule whenever credentials exist)*
| Item | Why manual | Code-only interim |
|------|-----------|-------------------|
| **X3** Add a conventional donation method | Requires a payment-provider account/credentials (MobilePay/Stripe/Ko-fi) | The legitimacy/intent **copy** line is `[Claude Code]` and can ship in Batch 5 |

---

### Dependency summary
- **E1 → E4 → (E5, E7, E8):** add the alert role first, then the unified toast stack, then route new toasts through it.
- **C1 → C2:** both edit `App.tsx`; land the overlay rework before the search-handler change.
- **O4 → O3:** signpost the all-Finland scope before adding the on-map hint pill (shared `App.tsx` + locales).
- **O2 → L3:** auto-detect/label the language control before adding its in-flight spinner (shared `SettingsDropdown`).
- **M4 → M5, M3 → M6:** the touch-peek and tray reflow land before the reduced-motion / touch-cancel follow-ups on the same files.
- Everything in **Batch 1** is genuinely independent (disjoint files) and can run fully in parallel.
