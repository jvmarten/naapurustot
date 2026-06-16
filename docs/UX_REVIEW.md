# UX Review — naapurustot (Fresh Eyes)

**Date:** 2026-06-13
**Reviewer perspective:** A first-time visitor who knows nothing about the project, arriving cold at naapurustot.fi.
**Method:** A fresh multi-agent pass. Ten parallel review lenses (onboarding · search & navigation · data tools · save/account · error states · empty states · loading & perceived performance · mobile · accessibility · discoverability/IA/trust) each read the relevant frontend source and produced `file:line`-grounded findings. **Every finding was then independently re-verified against the *current* source by an adversarial checker** whose default was to reject — confirming the code still exhibits the issue (not already fixed by a prior pass), correcting stale line numbers, and adjusting severity. Of 59 raised findings, **58 were confirmed and 1 was dropped**. Severity reflects the verifier's adjusted rating, and many entries below carry the verifier's caveats (partial mitigations, narrowed blast radius) inline.
**Scope:** Frontend & user-facing behavior only.

> **Relationship to the prior review.** The 2026-06-10 review (48 findings) was fully implemented and merged — onboarding tour, language auto-detect, retryable banners, focus rings, a mobile bottom-sheet, the Data Sources/Privacy pages, the X1 mobile-footer surfacing, and more all shipped. None of the findings below restate something the current code already handles; each was re-checked against live source. What remains clusters around code that post-dates those fixes (the **CF-8 slim all-Finland landing**, address search, the settings-menu reorg, split view) and a deeper second layer of ARIA-vs-behavior and shared-device data-safety gaps.

**Severity legend** — *Critical:* blocks or excludes a class of users. *High:* frequent friction or a "looks broken" moment most first-timers hit. *Medium:* noticeable confusion for many. *Low:* polish / edge-case / consistency.

**Severity counts: 0 critical · 5 high · 15 medium · 38 low (58 findings).** Two findings are duplicates of the same root cause (see *Dedup* notes on **AY-4** and **ES-6**), so there are **56 unique root issues**.

> **Implementation status (2026-06-16).** All 55 of the 56 unique findings implementable in a Claude Code session have been shipped (branch `claude/ux-review-impl`). The lone exception is **DX-3** (add a mainstream payment method), which is **[MS]** — it needs a payment-provider account, so only its footer-link half is deferrable to code; left for manual setup. Two findings turned out to be **already shipped** by a prior batch and were verified rather than re-implemented: **AY-6** (the skip link is already localized at runtime via `aria.skip_to_content`) and **ON-4** (the dead `app.subtitle` key was already removed — the unused-key guard would have caught it otherwise). The bundle budget was raised 291 KB → 295 KB to absorb ~3.4 KB of new UI logic + trilingual strings.

---

## TL;DR

naapurustot remains a genuinely well-built, well-hardened static map app. The friction a first-timer hits now clusters into five patterns:

1. **The default `?city=all` aggregate landing (CF-8) silently misbehaves.** Because `data` is `null` and only 69 *seutukunta* blobs exist on the flagship first screen, a whole cluster of surfaces break or mislead: saved favorites vanish from the header (**ES-1**, high), shortlist exports no-op with no feedback (**ES-2**), the Filter tool and Wizard rank 69 region blobs while their copy promises "neighborhoods" (**DT-1** high, **DT-2**), an address pick leaves a mismatched query (**SN-5**), and nudging a custom weight triggers a silent ~10.6 MB download with zero loading UI (**LP-1**).
2. **The search box — the most natural first action — under-delivers.** Enter does nothing (**SN-1**, high), the placeholder never advertises address search (**SN-2**), no-results copy tells users to "switch city" on a view with nothing to switch from (**SN-4**/**ES-6**), and the combobox lies to screen readers about being open (**SN-3**/**AY-4**).
3. **Account/sync carries real data-safety and trust risk.** On a shared device, logout leaves the previous user's notes on the machine and the next login merges them into a *different* account (**AC-2**, high). Account recovery is promised but impossible, so a forgotten 12-char password is a permanent lockout (**AC-1**, **AC-4**).
4. **Mobile layout collides on the newer features.** Compare-layers split view is unusable on phones (**MO-1**, high), Android Back exits the site instead of closing sheets (**MO-3**), and bottom-center controls pile up (**MO-2**, **MO-4**, **MO-5**).
5. **Accessibility promises more than it delivers, and copy is stale.** Missing `aria-live` announcements, roving highlights that never move DOM focus, and `role` declarations that overpromise behavior recur across the app (**AY-1…AY-7**, **ER-3…ER-5**, **LP-5**). Several trust/marketing strings are inaccurate (**ON-1** "large file", **DX-2** "data last updated", **ON-4** dead subtitle, **DX-4** stripped embed attribution, **DX-3** crypto-only donations).

---

## The handful that matter most

| ID | Finding | Severity | Why it's top |
|----|---------|----------|--------------|
| **AC-2** | Logout leaves the previous user's data on the device; next login merges it into a different account | High | Shared-device privacy breach — A's private notes leak into B's cloud account and corrupt B's data |
| **ES-1** | Saved favorites silently disappear on the default all-Finland view | High | A returning visitor lands on the flagship view and their saved areas appear lost (button + badge vanish; signed-in users see a false "empty" state) |
| **SN-1** | Pressing Enter after typing does nothing | High | The most natural desktop flow — type my area, Enter — is a silent no-op, so the primary action looks broken on first use |
| **DT-1** | Filter tool filters 69 region blobs (not neighborhoods) on the landing view, while its copy says "neighborhoods" | High | From the landing view a first-timer literally cannot filter postal areas, yet every label promises it — the tool quietly does the wrong thing |
| **MO-1** | "Compare layers" split view is unusable on phones | High | Tapping a Tools entry on a phone yields ~187px panes, a search box covering the left picker, and no touch tooltips — looks and behaves broken |
| **AC-1** | Account recovery is promised in the UI but no recovery/change-password flow exists | Medium | The UI twice promises email recovery the backend can't deliver; a forgotten 12-char password is an unrecoverable lockout |
| **ES-2** | Shortlist CSV/PDF/GeoJSON/image-card buttons silently no-op on the all-Finland view | Medium | A returning user with a saved shortlist reliably lands here and watches every export do nothing |
| **LP-1** | Enabling custom quality weights nationwide silently downloads ~10.6 MB with no feedback | Medium | A headline feature freezes the map for seconds then abruptly recolors — reads as a hang while the user is interacting |

---

## 1. Onboarding & first impression

### ON-1 — Cold-load overlay tells first-timers the default landing is a "large file" — it isn't anymore · **Low** · [Claude Code]
**Problem.** On the default `?city=all` cold landing (no deep-link), the full-screen wordmark overlay shows `loading.nationwide` = "Loading nationwide data… (large file)". But per CF-8 that path fetches only `region_aggregates.json` + the seutukunnat outlines (~227 KB gz), **not** the ~10.6 MB national set. The "(large file)" qualifier is stale for the common first-load case; it's accurate only on the rarer deep-linked `needFullNational` boot, which shares the same string.
**Where.** `src/App.tsx:2018`; strings at `src/locales/{fi,en,sv}.json:812`; gating at `src/App.tsx:147` + `src/hooks/useMapData.ts:57-62`.
**Fix.** Drop the "(suuri tiedosto)/(large file)/(stor fil)" qualifier in all three locales (or reword to a neutral "Loading Finland…"). If a heavy-download notice is still wanted, gate a *separate* string on `needFullNational`.

### ON-2 — "Take the tour" is buried under collapsed "More settings"; the reopen note overpromises · **Low** · [Claude Code]
**Problem.** The reopen reassurance (`onboarding.reopen_note`) renders only on the *last* step (`isLast`), yet every step — including the welcome step — has a Skip button that calls `finish('skipped')`, so an immediate skipper never learns the tour is re-openable. And the "Take the tour" item lives inside the collapsible "More settings" disclosure, which is collapsed by default (auto-expands only for a non-default colorblind/opacity setting) — so "from Settings" is two clicks deeper than implied.
**Where.** `src/components/OnboardingTour.tsx:359-364` (note) & `:296-302` (Skip on every step); `src/components/SettingsDropdown.tsx:117,282,313-330`.
**Fix.** Move the "Take the tour" item out of the `advancedOpen` fold into the always-visible part of the menu. Surface the reopen note on the skip path too (e.g. a brief toast on `finish('skipped')`).

### ON-3 — Default Quality Index choropleth has no on-map explanation · **Low** · [Claude Code]
**Problem.** The default layer is `quality_index`, so a first-timer sees colored region blobs with on-map context limited to the Legend's label + ramp + min/max ticks. Nothing conveys that the index is a *weighted composite*, that higher = better, or links to methodology. The only composite explanation (`panel.quality_coverage_help`) lives inside the NeighborhoodPanel and appears only *after* an area is selected, so tour-skippers and returning users get no headline-metric explanation on the default view.
**Where.** `src/components/Legend.tsx:62-82` (legend body); default layer at `src/App.tsx:243`; reusable cursor-help pattern at `Legend.tsx:107-117` (currently fires only for proxy layers).
**Fix.** Add a small "i" affordance to the Legend for composite/derived layers (at minimum `quality_index`) with a one-line explanation linking to `/tietolahteet`, reusing the existing title/cursor-help span. Needs new fi/en/sv keys (none exist today).

### ON-4 — No persistent tagline; the one subtitle string is dead and stale · **Low** · [Claude Code]
**Problem.** `app.subtitle` ("Suomen kaupungit" / "Finnish Cities" / "Finlands städer") is defined in all three locales but referenced by **no component** (grep hits only the locale files). The header shows only the wordmark; the cold-load overlay shows only the wordmark + loading status. The copy is also stale — "cities," though the app now covers all 3,018 postal areas across 69 seutukunnat.
**Where.** `src/locales/{fi,en,sv}.json:3`; header at `src/App.tsx:2093-2095`; overlay at `src/App.tsx:2007-2019`.
**Fix.** Either delete the dead key, or repurpose with accurate copy (e.g. "Suomen asuinalueet kartalla" / "Finland's neighborhoods on a map") and actually render it under the wordmark or in the overlay.

### ON-5 — Finnish search placeholder implies searching *within* an area rather than *for* one · **Low** · [Claude Code]
**Problem.** The Finnish placeholder "Hae alueella…" uses the adessive case (*alueella* = "in/at the area"), reading as if search is scoped to a current location — even though search is global. The short form "Hae alue…" is also grammatically truncated. English/Swedish and the empty-state hint all read neutrally, so only Finnish first-timers get the misleading impression.
**Where.** `src/locales/fi.json:4` (placeholder) & `:5` (placeholder_short); consumed at `src/components/SearchBar.tsx:285,295`.
**Fix.** Change to a search-*for* phrasing: line 4 → "Hae aluetta tai osoitetta…", line 5 → "Hae aluetta…". No code change needed.

---

## 2. Core flows — Search & navigation

### SN-1 — Pressing Enter after typing silently does nothing · **High** · [Claude Code]
**Problem.** `highlightedIndex` resets to `-1` on every results change and is only advanced by Arrow keys or mouse hover. The Enter handler's two selection branches both require a valid `highlightedIndex`, so pressing Enter with results visible but nothing highlighted runs `e.preventDefault()` and then **does nothing** — no navigation, no submit. The most natural desktop flow ("type my area, Enter") appears broken. (Clicking a result or arrowing down still works, partially mitigating.)
**Where.** `src/components/SearchBar.tsx:252-259` (Enter case); reset at `:187-189`.
**Fix.** In the Enter case, before the highlighted-index branches, fall back to the top match when `highlightedIndex < 0`: select `results[0]`, else `addressResults[0]`. The universal "Enter selects the top match" convention.

### SN-2 — Placeholder never signals address search; the clearer string already exists but is unused · **Low** · [Claude Code]
**Problem.** Address geocoding is a headline capability (debounced Digitransit), yet the placeholder/aria-label is "Search by area…", which reads as name-only. A strictly better string, `search.address_placeholder` = "Search by address or postal code…", is defined in all three locales but **referenced nowhere**. First-timers won't try a street address — the very thing the feature was built for.
**Where.** `src/components/SearchBar.tsx:295` (placeholder) & `:285` (aria-label); unused string at `src/locales/{fi,en,sv}.json:482`.
**Fix.** Use `t('search.address_placeholder')` for the desktop placeholder (and aria-label), keeping the short form on the narrow mobile field. Gate the address-capable wording on `GEOCODING_ENABLED` so a keyless build doesn't promise address search it can't deliver.

### SN-3 — Recents list and empty/no-result panels are not driven by the combobox keyboard model · **Medium** · [Claude Code]
**Problem.** When the input is empty/focused, a `role=listbox` of recent areas renders, but `handleKeyDown` computes `totalItems = results.length + addressResults.length` and returns early when that's 0, so the combobox's Arrow/Enter model never traverses recents. Worse, `aria-expanded` is hard-wired to `isOpen && (results>0 || addresses>0)`, so while the recents popup (or the "start typing" hint / no-results panel) is *visibly open*, the combobox reports **collapsed**, and `aria-controls` points at `#search-results-list`, which isn't rendered in those states. Recent options also lack `id`/`aria-selected`. SR users get no signal a popup is open and can't drive it. (They remain Tab-focusable as native buttons, so "mouse-only" overstates — but the documented combobox model is broken.)
**Where.** `src/components/SearchBar.tsx:233-234` (early bail), `:281` (aria-expanded), `:283` (aria-controls), `:363-401` (recents listbox).
**Fix.** Give each recent button `id=search-result-N` and let `totalItems`/Arrow/Enter traverse them when the query is empty. Compute `aria-expanded` from whether *any* popup is rendered, point `aria-controls`/`aria-activedescendant` at the live list, and add `aria-selected`.

### SN-4 — No-result copy tells users to "try an address" even when address search is disabled · **Medium** · [Claude Code]
**Problem.** `GEOCODING_ENABLED` is exported but **never imported**, so SearchBar can't gate on it. The geocode effect sets `isGeocoding=true` for every 3+ char query regardless of whether a key exists, so the address header + "Etsitään osoitteita…" row flash for ~300 ms even in keyless builds where `geocodeAddress` always returns `[]`. The settled empty state then advises trying an address (impossible without a key) and to "switch the city" on the default `?city=all` view where there's nothing to switch from. (Production injects the key via `deploy.yml`, so the impossible-advice/flash bite keyless builds only; the contradictory "switch the city" suffix on the all-Finland default view affects every production user.)
**Where.** `src/utils/geocode.ts:20,36`; `src/components/SearchBar.tsx:116-138,444-454,482-488`; `fi.json:788`.
**Fix.** Import `GEOCODING_ENABLED`; when false, skip the address header/searching row and use an address-free empty state. Independently, pass `cityFilter` into SearchBar and drop the "switch the city" clause when it's already `all`. *(Dedup: this is the same `search.no_results` string as **ES-6** — sequence them so the edits stack.)*

### SN-5 — Picking an address from the default all-Finland view leaves a mismatched query and never offers "set as my home" · **Low** · [Claude Code]
**Problem.** On the default landing, `data` is null, so SearchBar's containment lookup returns null and falls into the `else` branch: `onSelect('', coords)` + `setQuery(addr.label)`. App then switches region and the `pendingGeo` resolver opens the panel via `select(props)` but never updates the query nor surfaces the home nudge. Result: (1) the search field keeps the raw street label while the open panel is titled with the differently-named postal area; (2) the "Set as my home" inline nudge — only created in SearchBar's resolved-neighborhood branch, unreachable on the geometry-stripped all view — never fires on the most common entry path. (The home capability itself isn't lost — the panel still exposes a reference/home toggle — so only the onboarding nudge + cosmetic label mismatch are the gap.)
**Where.** `src/components/SearchBar.tsx:219-222` (else branch), `:216-218` (nudge); `src/App.tsx:1160-1196` (handleSearch), `:1298-1315` (pendingGeo resolver).
**Fix.** Have App's resolution path own both the label and the nudge: after `select(props)`, sync the query to the resolved name and conditionally surface the "set as home" prompt (when `props.pno !== referencePno`). Or accept the panel's reference button as the home affordance and just clear/sync the query when the panel opens.

### SN-6 — Mobile region switcher is an icon with no visible current-region label · **Low** · [Claude Code]
**Problem.** On mobile the CitySelector collapses to an icon-only globe button with no text reflecting the current scope, whereas desktop uses a `<select>` that shows the value. Because the default is `?city=all` and search can silently auto-switch the region (surfaced only by a transient "Switched to {city}" toast that auto-dismisses after 4 s), mobile users have no persistent indication of whether they're viewing All Finland or a specific seutukunta.
**Where.** `src/components/CitySelector.tsx:81-98`; toast lifecycle `src/App.tsx:1325-1329`.
**Fix.** Render the current selection label next to the globe icon on mobile, at least when `value !== 'all'`. The button already uses `flex gap-1.5 items-center`, so a truncated `<span>{t('city.'+value)}</span>` is low-risk.

---

## 3. Core flows — Data tools (layers / filter / compare / wizard / correlation)

### DT-1 — Filter tool silently filters 69 sub-region blobs (not neighborhoods) on the landing view, while its copy promises "neighborhoods" · **High** · [Claude Code]
**Problem.** On the default `?city=all` view, Filter receives `filteredData = allCitiesData` — the **69 seutukunta aggregate features**, not the 3,018 postal areas. So adding any criterion or tapping a preset ranks at most ~69 region rows whose labels are region names (e.g. "Helsingin seutukunta"), with no indication they're sub-regions. Yet the title ("Etsi naapurustoja"), empty state, and no-match line all say *naapurustoja* (neighborhoods). Unlike the Wizard, FilterPanel has no scope toggle, so from the landing view a first-timer **cannot filter individual postal areas at all** without first knowing to pick a city.
**Where.** `src/App.tsx:474` (filteredData), `:466-472` (allCitiesData), `:2195-2205` (render); `src/components/FilterPanel.tsx:476-540`, `:521`/`:633` (region-name rows), `:672-676` (empty copy).
**Fix.** Pass an `isAggregate` prop (`cityFilter==='all'`). Either (a) load the national 3,018-area set via `loadAllData()` like the Wizard does, or (b) keep aggregate mode but show a banner ("Showing 69 sub-regions — pick a city to filter individual neighborhoods") and switch the title/empty/no-match copy + row labels to "sub-regions." Mirroring the Wizard's `ComparisonScopeToggle` is the most consistent option.

### DT-2 — Wizard defaults to "within this area" scope when no area exists, scoring region aggregates as matches · **Medium** · [Claude Code]
**Problem.** On the default all-Finland view, the Wizard receives the 69 region-aggregate features. Because `scope` defaults to `'region'` and `activeData = isNational ? nationalData : data`, a first-timer who opens the wizard (no `cityFilter` guard) and completes the 3 steps gets "Top matches" that are entire seutukunnat, scored from aggregated densities — while the toggle reads "Within this area" even though no single area is selected. (Mitigated: results are real aggregates, and a visible toggle switches to "Koko Suomi" for actual postal areas — but the default is backwards here and the label is wrong.)
**Where.** `src/components/NeighborhoodWizard.tsx:394` (scope default), `:415` (activeData), `:744-745` (label); `src/App.tsx:2398` (data), `:466-474`.
**Fix.** Pass `cityFilter` into the Wizard; when `'all'`, initialize `scope` to `'all'` so it scores the national postal-area set by default, and hide or relabel the 'region' option (the "Within this area" string only makes sense with a single region in view).

### DT-3 — "Save current filters" uses a native `window.prompt()` dialog · **Low** · [Claude Code]
**Problem.** Saving a preset uses a blocking native `prompt()` (desktop + mobile) to collect the name — visually jarring against the glass UI, unstyled, not dark-mode themeable.
**Where.** `src/components/FilterPanel.tsx:756` (desktop), `:898` (mobile).
**Fix.** Replace both with an inline name field (text input + Save/Cancel row in place of the button), reusing existing input styling. Polish, not a functional fix.

### DT-4 — Comparison-scope toggle is a dead, greyed-out control on the default landing · **Low** · [Claude Code]
**Problem.** On `?city=all` the comparison-scope toggle renders disabled (greyed, `cursor-not-allowed`) and visible on the first screen, where it has no meaning until a city is chosen. Its disabled tooltip is just `t('scope.all')` ("Koko Suomi"), which states the current scope but never explains *why* it's greyed out.
**Where.** `src/components/ComparisonScopeToggle.tsx:17-28`; `src/App.tsx:1522-1526` (desktop), `:2168-2172` (mobile); rendered via `LayerSelector.tsx:314`.
**Fix.** In all-Finland mode hide the toggle entirely, or replace it with a one-line hint ("Pick a city to compare within a sub-region"). If kept disabled, give it an explanatory tooltip distinct from `scope.all`. *(The "inverted semantics" sub-claim was rejected — the amber active state is an intentional active-filter cue.)*

### DT-5 — Opening the Filter panel on desktop hides the search bar (exact stacking overlap) · **Low** · [Claude Code]
**Problem.** On desktop, the opaque 320px Filter panel (`top-14 left-4 z-20`) draws directly on top of the 288px search bar (`top-[3.5rem] left-4 z-10`) — both 56px from top, both `left-4` — fully covering it. The search bar is never hidden/shifted while `showFilter` is true, so search appears to vanish.
**Where.** `src/components/FilterPanel.tsx:683`; `src/App.tsx:2145`.
**Fix.** Offset the desktop FilterPanel below the search bar (e.g. `top-28`/`7rem`, adjusting max-height), or hide/shift the search bar while `showFilter` is true.

### DT-6 — Correlation explorer permits identical X and Y metrics, producing a meaningless perfect correlation · **Low** · [Claude Code]
**Problem.** Both axis `<select>`s list the full `LAYERS` set with no exclusion. Setting X = Y produces r = 1.00, R² = 1.00, and a perfect diagonal best-fit line — a confusing degenerate result with no guard, undermining trust in the statistic for legitimate cases.
**Where.** `src/components/CorrelationExplorer.tsx:208-224`; stats via `src/utils/correlation.ts`.
**Fix.** Disable (or grey) the option matching the other axis's current value, or when `metricX === metricY` show an inline notice and suppress the r/R² readouts and the fit line. Needs new fi/en/sv keys.

### DT-7 — Split view lets both panes select the same layer, yielding two identical maps · **Low** · [Claude Code]
**Problem.** The per-pane `SplitLayerPicker` renders every layer for both sides with no cross-exclusion. A user can set left and right to the same layer, producing two identical choropleths and defeating "Compare layers." Nothing flags the identical state.
**Where.** `src/components/SplitMapView.tsx:17-36` (picker), `:884`/`:910` (uses); wired in `src/App.tsx:1961-1962`.
**Fix.** Disable/visually mark the other pane's selected layer in each picker, or render a one-line note when `leftLayer === rightLayer`. Needs a new locale key; keep it text-only to avoid the bundle-heavy paint logic.

---

## 4. Save & account flows

### AC-2 — Logout leaves the previous user's favorites/shortlist/notes on the device; next login merges them into a different account · **High** · [Claude Code]
**Problem.** On a shared device, `logout()` only clears the `has_session` flag and in-memory user — it never resets the localStorage-backed favorites/shortlist/notes, which stay visible in the signed-out UI. Worse, the per-hook login-merge effects **union those leftover local items with the next user's server data and save the union back**, leaking A's private free-text notes into B's cloud account and corrupting B's saved data.
**Where.** `src/hooks/useAuth.ts:96-100` (logout); merge bleed at `useFavorites.ts:90-115`, `useNotes.ts:123-151`, `useShortlist.ts:96-116`; wired at `src/App.tsx:2112`, leftover data re-rendered at `:2103`.
**Fix.** Add a dedicated `resetLocal()` to each hook that clears in-memory state, the data keys, **and** the matching `*-removed` tombstone keys (without writing *new* tombstones), then call them all from an App-level logout handler wrapping `useAuth.logout()`. Do **not** reuse `clearFavorites`/`clearShortlist` (they add tombstones, which would block the same user re-syncing on next login). Clearing existing tombstones is essential, else A's deletions would suppress B's matching server items. The signed-out→signup conversion merge is unaffected (that data legitimately belongs to that person).

### AC-1 — Account recovery is promised in the UI but no recovery/change-password flow exists · **Medium** · [Claude Code (honesty fix) / Manual Setup (full email reset)]
**Problem.** The signup UI labels the optional email "only for account recovery" and the privacy notice repeats it, but **no recovery or password-change mechanism exists**: `server/api/src/auth.ts` has no `/reset`, `/forgot`, or `/change-password` route, the stored email is never used by any route, and UserMenu has no change-password control. A user who supplies an email expecting recovery and forgets their 12-char password is **permanently locked out** of all cloud-synced data. (Blast radius bounded to optional-backend users who opt into email, losing only convenience data — but the copy makes a promise the system can't keep.)
**Where.** `auth.email_hint` (`fi.json:696`) + `privacy.s_account_b` (`fi.json:270`), rendered at `AuthModal.tsx:241`; no recovery route in `server/api/src/auth.ts:63-375`; no control in `UserMenu.tsx:226-280`.
**Fix.** *Honesty fix (Claude Code):* change `auth.email_hint`/`privacy.s_account_b` in all three locales so they no longer claim email enables recovery. *Infra-free win (Claude Code):* add a "Change password" control in UserMenu backed by a new authenticated `POST /auth/change-password` (re-hash for the valid session). *Full reset (Manual Setup):* `POST /auth/request-reset` + `/auth/reset` emailing a tokenized link requires SMTP/email infra.

### AC-4 — Signup password field has no show/hide toggle despite a 12-char minimum + confirm field · **Medium** · [Claude Code]
**Problem.** Both password and confirm-password inputs are `type="password"` with `minLength={12}` and no reveal toggle — users type a 12+ char password blind, twice. Because there's no reset flow (see **AC-1**), a consistent mistyped password produces a permanently locked-out account — avoidable friction at the conversion point.
**Where.** `src/components/AuthModal.tsx:197-207` (password), `:217-227` (confirm).
**Fix.** Add an eye/show-password toggle inside the input (flips `type`, with `aria-label`/`aria-pressed`). With a reveal toggle, the confirm field can optionally be dropped to reduce friction.

### AC-3 — Notes are a dead-end save: no list of "areas I noted" · **Low** · [Claude Code]
**Problem.** Per-area notes have no notes-specific retrieval surface. A note's existence shows only as a dot on ShortlistTray chips; neither the UserMenu favorites list nor the signed-out FavoritesButton list shows a note indicator, and `useNotes` exposes no `listNotedPnos()`. So a note on a non-shortlisted/non-favorited area is durably retrievable only by re-finding that exact area. (Mitigated: selecting an area to write a note adds it to recents — capped at 10 — and bulk export dumps all notes, so the note is never *lost*, only its targeted discoverability is weak.)
**Where.** `src/components/UserMenu.tsx:181-208` & `FavoritesButton.tsx:69-92` (no indicator); `src/hooks/useNotes.ts:39` (only `readNote`); `ShortlistTray.tsx:139-142,258-264` (sole has-note UI).
**Fix.** Reuse the `readNote(pno)` has-note dot in the UserMenu and FavoritesButton lists, and/or add a `listNotedPnos()` helper feeding a small "Areas with notes" section.

### AC-5 — Turnstile-blocked error tells a sign-up first-timer to "sign in with an existing account" they don't have · **Low** · [Claude Code]
**Problem.** The Turnstile widget renders only in signup mode. When its script is blocked, the failure UI shows `auth.error.bot_check_blocked`, which in all three locales ends "…or sign in with an existing account" — meaningless to a first-timer on the signup tab. (Not a dead end: the message also gives the correct fix and a Reload button sits below; the defect is the misleading trailing clause.)
**Where.** `src/components/Turnstile.tsx:93-111` (renders the string); `fi.json:798`; widget signup-only at `AuthModal.tsx:245`.
**Fix.** Drop the "or sign in with an existing account" clause from `auth.error.bot_check_blocked` in all three locales; keep the actionable "disable your ad/tracker blocker and reload."

---

## 5. Error states

### ER-1 — Address-search failures are silently shown as "No results" · **Low** · [Claude Code]
**Problem.** `geocodeAddress()` collapses every failure mode (non-OK HTTP, 5xx, over-quota, network drop, malformed JSON) into an empty array and explicitly never throws, so SearchBar can't tell "geocoder unreachable/throttled" from "no matches." When `isGeocoding` ends with empty results, the user is told "No results for '{query}'" even though their valid street address was never actually checked.
**Where.** `src/utils/geocode.ts:63,92-94` (swallowed failures); `src/components/SearchBar.tsx:127-133,482-488`.
**Fix.** Make `geocodeAddress` distinguish failure from emptiness (throw, or return `{ status: 'error' | 'ok', results }`) on non-OK/network error while still returning `[]` for a successful-empty response. In SearchBar, add an `addressError` state and render a dedicated "Address search unavailable — retry" row, suppressing the generic no-results branch. New `search.address_unavailable`/`search.address_retry` keys (×3 locales).

### ER-2 — Locale-load failure strands en/sv users in an all-Finnish UI with a Finnish-only error notice · **Low** · [Claude Code]
**Problem.** When the lazily-fetched English/Swedish dictionary fails to load, `t()` falls back to Finnish for every key. The amber recovery banner renders its message and Retry label via `t()` while `currentLang` is still the failed en/sv — so the recovery affordance meant for a non-Finnish user is shown in Finnish, the one language they may not read.
**Where.** `src/App.tsx:2591-2603` (banner); root cause `src/utils/i18n.ts:43-54,132-135`.
**Fix.** Render this single notice (message + retry/close labels) from a small **hardcoded trilingual constant** keyed by `getLocaleLoadError()`, not via `t()` — by definition that lang's dictionary is the one that failed.

### ER-3 — Grid-data load failure is never announced and is invisible while a panel is open · **Low** · [Claude Code]
**Problem.** When a grid layer (air quality ~250 m, light pollution ~500 m) fails to fetch, the map silently degrades to the coarse postal choropleth. The grid-failure notice has **no `role`/`aria-live`** (unlike the sibling loading row, which is `role="status"`), so a SR user is told "loading" and then never told it failed. Additionally the Legend is suppressed on **mobile** when a neighborhood is selected, so mobile users with a panel open get no failure notice and keep believing they're seeing ~250 m detail. (Desktop still shows the amber visual notice with a selection.)
**Where.** `src/components/Legend.tsx:91-96` (gridError div, no aria-live); `src/hooks/useGridData.ts:205-214`; `src/App.tsx:2277`.
**Fix.** Add `role="status" aria-live="polite"` to the gridError div. Optionally route the failure through the shared `app-toast` window event so mobile users with an open panel still hear "showing postal estimate."

### ER-4 — ErrorBoundary fallback isn't announced to assistive tech or focused · **Low** · [Claude Code]
**Problem.** When a non-recoverable render error trips the boundary wrapping `<Map>`/`<SplitMapView>`, the default fallback renders as a plain `<div>` with no `role="alert"` and no focus management; the Retry button has no `autoFocus`. A keyboard/SR user is left with focus on a detached node and gets no announcement of the crash or the recovery controls. (Common reconciliation errors auto-recover up to 3× before this UI shows, so the trigger is a rare hard crash.)
**Where.** `src/components/ErrorBoundary.tsx:61-85`; mounted at `src/App.tsx:1952`.
**Fix.** Give the fallback `role="alert"` and `tabIndex={-1}`, attach a ref, and focus it (or the Retry button) when `hasError` flips true — via `componentDidUpdate` or `autoFocus`.

### ER-5 — Offline indicator is not announced to screen readers · **Low** · [Claude Code]
**Problem.** The reactive offline banner is a bare `<div>` with no `role`/`aria-live`, unlike every other notice in the same top-center stack (the data-load ErrorBanner uses `role="alert"`; the geolocation, shared, and locale notices use `role="status"`). SR users get no announcement when the app goes offline — exactly the state change that explains why subsequent loads fail.
**Where.** `src/App.tsx:2556-2560`.
**Fix.** Add `role="status" aria-live="polite"` to the offline indicator div.

### ER-6 — Hardcoded English auth error fallbacks shown to fi/sv users · **Low** · [Claude Code]
**Problem.** useAuth's success guards fall through to hardcoded English strings ('Login failed'/'Signup failed'/'Delete failed') when the server returns a parseable 200 JSON body that omits the expected field. Every other auth error is localized, making these three the sole un-localized gap; a fi/sv user could see raw English inside the otherwise-localized modal.
**Where.** `src/hooks/useAuth.ts:77,93,119`; rendered at `AuthModal.tsx:249-251`.
**Fix.** Replace the three literal fallbacks with `t('auth.error.server_error')` (the key already exists in all three locales at line 701); import `t` from `../utils/i18n`.

---

## 6. Empty states

### ES-1 — Saved favorites silently disappear from the UI on the default all-Finland view · **High** · [Claude Code]
**Problem.** On the default `?city=all` view, `data` is null so `pnoFeatureMap` is empty; `favoriteEntries` then drops every postal-code favorite (region-ID favorites survive). For signed-out users with only postal-code favorites the whole FavoritesButton + badge **vanishes** from the header; for signed-in users the UserMenu shows a false "empty favorites" illustration. Postal-code areas are the primary favorite type, so a returning visitor's saved areas appear lost on the flagship view until they drill into the owning region.
**Where.** `src/App.tsx:1548-1564` (favoriteEntries), `:218-226` (empty pnoFeatureMap when `!data`), `:147,150,480` (aggregate mode), `:2103` (signed-out gate); `UserMenu.tsx:212-224` (false empty state).
**Fix.** Build a `pno→name` fallback from the eagerly-loaded `searchIndex.features` (which carry pno/nimi/namn/city with `geometry:null`), used when `pnoFeatureMap` has no entry, so postal-code favorites resolve a name on the all-Finland view. Add `searchIndex` to `favoriteEntries`' deps; mirror the existing Swedish-name handling.

### ES-2 — Shortlist CSV/PDF/GeoJSON/image-card buttons silently no-op in the all-Finland view · **Medium** · [Claude Code]
**Problem.** On the default landing (data null), `pnoFeatureMap` is empty so `featureFor` returns null for every shortlisted pno. The export buttons are gated only on `featureFor` being a defined function (always true), so they stay fully visible; clicking any resolves an empty array and silently returns with **zero feedback** (the image handler bails before its `try`, so even its error notice never fires). The shortlist persists and the tray renders on the idle landing (chips even show raw postal codes instead of names), so a returning user reliably hits this.
**Where.** `src/components/ShortlistTray.tsx:62-70,101-119,121-135,185-221`; root cause `src/App.tsx:147,218-226`, threaded at `:2427`.
**Fix.** Compute the resolvable count and **disable/hide** the export buttons (tooltip "Open a region to export") when it's 0, or surface the transient-notice pattern instead of a silent return. *Note:* threading from `searchIndex` will NOT make these work (it has no metrics/geometry); to make exports actually function from the all-Finland view, load the full national set on demand (flip `needFullNational`) when an export is invoked.

### ES-3 — FilterPanel mobile: zero-match empty state and 'Clear all' recovery are hidden behind a collapsed 'Show results' toggle · **Medium** · [Claude Code]
**Problem.** On mobile, the zero-match empty state (illustration + `filter.no_match` + the one-tap `Clear all` recovery) renders only inside `resultsList`, which the mobile sheet gates behind `mobileResultsOpen` (defaults false). When a user narrows filters to zero matches the sheet shows only "0 matches" + a "Show results" link — and a count of 0 makes "Show results" look pointless, so the guidance and escape hatch go undiscovered. (Filter rows with remove buttons stay visible, so not a total dead-end.)
**Where.** `src/components/FilterPanel.tsx:939` (`{mobileResultsOpen && resultsList}`), `:464`, `:655-670` (no-match block), `:789` (desktop always renders).
**Fix.** Render the no-match block on mobile regardless of `mobileResultsOpen`, or auto-open results when `filters.length > 0 && ranked.length === 0`.

### ES-4 — Region comparison table shows the same 'no data' message for a load failure as for genuinely empty data, with no retry · **Low** · [Claude Code]
**Problem.** The error and genuine-empty branches both render `region.comparison.no_data` ("Ei tietoja tälle mittarille"), making a transient load failure indistinguishable from a metric that legitimately has no regional data — with no retry; the user must close and reopen the tool. (Tempered: `loadAllData` is cached and backs the default view, so a rejection here is uncommon.)
**Where.** `src/components/RegionRankingTable.tsx:79` (error flag), `:140-142` (error branch), `:167-169` (empty branch). Compare `UserMenu.tsx:164-169` (retry affordance).
**Fix.** Give the error branch its own copy (e.g. `error.region_load_failed`) + a Retry button that resets error state and re-triggers `loadAllData()`, mirroring UserMenu's `retryAllSyncs()`.

### ES-5 — Ranking table empty state is a bare 'Ei tietoja' with no illustration or recovery hint · **Low** · [Claude Code]
**Problem.** When no area in the loaded region has a value for the active layer (common for sparse/low-coverage layers like the grid overlays), RankingTable renders just centered "Ei tietoja" — inconsistent with the polished, actionable empty states used everywhere else (FilterPanel, UserMenu favorites, ComparisonPanel), giving no clue why the list is empty or what to do.
**Where.** `src/components/RankingTable.tsx:163-167`; `fi.json` (`ranking.no_data`).
**Fix.** Replace the bare label with a guided empty state reusing `EmptyStateIllustrations` plus a sentence like "This layer has no data for the loaded areas — try another layer." New copy ×3 locales.

### ES-6 — Search 'no results' copy suggests actions that don't apply at the point it appears · **Low** · [Claude Code]
**Problem.** The no-results message advises "try an address or change city," but neither applies. Name/code search runs against the **global national index** (all 3,018 areas), so "change city" — a holdover from region-scoped search — can never reveal a missing area. And the message can show at a 2-char query while geocoding only fires at length ≥ 3, so "try an address" is suggested before any geocode was attempted.
**Where.** `src/components/SearchBar.tsx:482` (no-results gate at length ≥ 2), `:119` (geocoding at length ≥ 3); `fi.json:788`.
**Fix.** Reword `search.no_results` (×3 locales) to guidance that holds at the threshold and drop "change city" (search is already nationwide) — e.g. "Ei osumia haulle '{query}' — tarkista kirjoitusasu tai jatka osoitteen kirjoittamista." *(Dedup: same string as **SN-4** — sequence so the copy/gating edits stack.)*

---

## 7. Loading states & perceived performance

### LP-1 — Enabling custom quality weights nationwide silently downloads ~10.6 MB with zero loading feedback · **Medium** · [Claude Code]
**Problem.** In `?city=all`, the first time a user nudges a custom weight, `customWeights` flips `needFullNational`, turning off `skipAllFetch` so `useMapData` re-runs `loadAllData()` for the ~10.6 MB national set. Throughout that fetch `data` stays null, so `aggMode`/`allViewReady` are both true and `effectiveLoading` is **false** — the cold overlay and slim progress bar never appear. The debounced recompute also no-ops under `if (data)`, so the map holds its old default-weight colors. The view only updates when the data-keyed effect recomputes after the bytes arrive — **several seconds of zero feedback followed by an abrupt recolor** right when the user is interacting.
**Where.** `src/App.tsx:381-383` (trigger), `:147` (skipAllFetch), `:480-482` (effectiveLoading false), `:1033` (null-data no-op), `:2026` (unrendered bar); `useMapData.ts:59-62`.
**Fix.** Add a pending flag — `const fullNationalPending = cityFilter === 'all' && needFullNational && !data && !error;` — and render the existing slim bar when `firstLoadDone && (effectiveLoading || fullNationalPending)` with a "recomputing nationwide" aria-label. Optionally pass a `recomputing` prop into CustomQualityPanel. *(Note: `aggMode` also masks a failed full-national fetch — consider surfacing that error too.)*

### LP-2 — Profile page loading state is a bare gray 'Ladataan…' line · **Low** · [Claude Code]
**Problem.** A hard load of a prerendered profile page does **not** hydrate (`main.tsx` calls `createRoot().render()`, not `hydrateRoot`), so the static HTML is replaced on mount. The page is also lazy-loaded, so the sequence is: prerendered content → Suspense spinner → bare "Ladataan…" loading view → full content. The loading view is a single centered pulsing text line with no skeleton/wordmark/stat placeholders — a visible downgrade from the boot placeholder and the map's shimmer.
**Where.** `src/pages/NeighborhoodProfilePage.tsx:353-358` (loading view), `:65` (`loading=true` init), `:156-166` (payload read in post-paint effect); `src/main.tsx:133`.
**Fix.** Initialize state synchronously from the embedded payload (in a `useState` initializer; `loading=false` when `readEmbeddedProfile(pno)` returns a value) so prerendered pages skip the loading frame. For the genuine fetch path, replace the bare text with a lightweight skeleton. *(Caveat: the lazy Suspense spinner still flashes while the route chunk downloads.)*

### LP-3 — Auto-detected English/Swedish first-timers see a flash of Finnish on the cold-load overlay and chrome · **Low** · [Claude Code]
**Problem.** For an auto-detected non-Finnish first-timer, `main.tsx` fires `void setLang(detected)` without awaiting, but en/sv dictionaries are lazy-fetched and `t()` returns the bundled Finnish fallback until the JSON arrives. First paint isn't gated on the active locale, so the cold-load overlay and surrounding chrome render in Finnish, then swap once `useI18nVersion` bumps — a Finnish-then-correct flicker for exactly the users O2 detection is meant to welcome (bounded by the small same-origin asset RTT).
**Where.** `src/main.tsx:17-23`; `src/utils/i18n.ts:81-92,132-136`; `src/App.tsx:2008-2018,365`.
**Fix.** Either gate first paint on locale readiness (seed `localeReady` from `getLang()==='fi'`, set true when `setLang` settles, ~1.5 s timeout fallback; add `|| !localeReady` to the cold-overlay condition), or inject a `<link rel="preload" as="fetch" crossorigin>` for the detected locale JSON (reference the hashed `?url` asset path).

### LP-4 — Search shows a premature 'no results' before the global search index has loaded · **Low** · [Claude Code]
**Problem.** In the default view, `data` is null and the global search index is fetched async on mount. `searchSource = searchData ?? data`, so before the index lands `searchSource` is null and the name scan returns `[]`. For a query that doesn't trigger geocoding — exactly 2 chars, or a full 5-digit postal code — the settled no-results branch fires and shows "no results for {query}" even though the index simply hasn't loaded yet. Narrow window (eager ~40 KB fetch), self-corrects, but produces a transient false "looks broken" state on the very first interaction, most visible on slow connections.
**Where.** `src/components/SearchBar.tsx:77,79-80,482-488`; wiring `src/App.tsx:159,2148`.
**Fix.** Gate the no-results branch on the index being available — pass a `searchLoading` prop (`searchIndex == null`) or treat `searchSource == null` as "still loading" and render a subtle loading row instead.

### LP-5 — Cold-load overlay is not announced to assistive tech (no `role="status"`/`aria-busy`) · **Low** · [Claude Code]
**Problem.** The region-switch progress bar correctly uses `role="status"` + aria-label, but the initial full-screen cold-load overlay is a plain div with no `role`/`aria-live`/`aria-busy`, and the app-root carries only `data-loaded`. A SR user on first load gets no "loading" cue while the app boots and nationwide data resolves.
**Where.** `src/App.tsx:2008-2020` (overlay), `:1948` (app-root). The global sr-only live region (`:2703`) only carries selection/layer announcements.
**Fix.** Add `role="status" aria-live="polite"` to the cold-load overlay container, and `aria-busy={effectiveLoading}` on the app-root div.

---

## 8. Mobile

### MO-1 — "Compare layers" split view is unusable on phones · **High** · [Claude Code]
**Problem.** Split view is reachable on touch (no desktop/touch gate) but not adapted for small screens. The container is `relative flex h-full w-full` with two `h-full w-1/2` panes — no stacking — so on a ~375px phone each pane is ~187px, too narrow for a Finland-wide choropleth. The global SearchBar (gated only by `!IS_EMBED`) renders at `top-[3.5rem] left-3 w-52` directly on top of the **left pane's** SplitLayerPicker (`top-[3.5rem] left-2`), making the left layer unchangeable. Pane hover uses `mousemove` only, so touch users get **no value tooltip** — defeating the feature's purpose. The right pane's NavigationControl also collides with the mobile Layers FAB (not hidden in split mode). Net: tapping Compare layers on a phone yields a screen that looks and behaves broken.
**Where.** `src/components/SplitMapView.tsx:878-908,834,589-590`; `src/App.tsx:2144-2157,2211-2221`; `ToolsDropdown.tsx:340-361` (ungated item); `LayerSelector.tsx:344` (FAB).
**Fix.** Make SplitMapView responsive (`flex flex-col md:flex-row`; panes `h-1/2 w-full md:h-full md:w-1/2`; horizontal divider on mobile). Suppress the global SearchBar (and ideally the Layers FAB) while `splitMode` on small screens, or move SplitLayerPicker below the search row. Add a touch path (tap/longpress → `setHover`) for the per-pane readout. *Simplest mitigation:* gate the "Compare layers" item to `md:` (or show a "best on a larger screen" hint on touch).

### MO-2 — Onboarding "click an area" hint and the touch peek bar collide on the very first tap · **Medium** · [Claude Code]
**Problem.** On a coarse pointer, the first tap sets `peek` and returns **without** selecting, so `selected` stays null and the area-hint is never dismissed (it's only retired when `selected` becomes truthy). The hint (z-20) and the peek bar (z-30) then render simultaneously at the identical bottom-center anchor, stacking the peek over the still-mounted hint — which keeps telling the user to do what they just did.
**Where.** `src/App.tsx:2226` (hint), `:2245` (peek), `:1109-1124` (handleClick), `:1344-1346` (dismiss effect).
**Fix.** Add `&& !peek` to the hint render condition (preferred — restores the hint if the user closes the peek without selecting), or call `dismissAreaHint()` in the coarse-pointer branch of `handleClick`.

### MO-3 — Android Back / iOS edge-swipe exits the site instead of closing the mobile Layers sheet or split view · **Medium** · [Claude Code]
**Problem.** On touch (useBackGesture is coarse-pointer-only), two surfaces aren't back-dismissable. (1) The LayerSelector mobile bottom sheet stores its open state internally and never registers with `useBackGesture`; its only non-button dismissal is a keyboard-Escape handler (useless on touch). (2) `splitMode` is absent from App's `anyOverlayOpen`/`closeTopmost` cascade *and* the Escape cascade, so Compare-layers can only be left via the Tools toggle. Inconsistent with the neighborhood sheet, filter, ranking, draw, and select modes, which are all back-dismissable.
**Where.** `src/App.tsx:1919-1933` (cascade omits splitMode); `LayerSelector.tsx:51` (internal mobileOpen, no useBackGesture); `useBackGesture.ts:29-49`.
**Fix.** Add `splitMode` to `anyOverlayOpen` + `closeTopmost` (and the Escape cascade). For the Layers sheet, lift `mobileOpen` to App or call `useBackGesture(mobileOpen, () => setMobileOpen(false))` inside LayerSelector.

### MO-4 — Bottom-center controls pile up on the idle mobile view (shortlist tray vs Clear-all / wizard chips) · **Medium** · [Claude Code]
**Problem.** In the idle home view the full ShortlistTray always renders on mobile (the collapsed count chip is desktop-only), anchored at `bottom-24` and growing upward. The centered, same-`z-10` Clear-all chip (~80px) sits within the tray's lower span and the wizard-results chip (~128px) falls inside the tall card — painted after the tray with equal z-index, they overlay it as visual junk. (Broader than the wizard case: `isDirty` is also true for active filters or a non-'all' comparison scope, so any idle user with a shortlist + a filter hits it.)
**Where.** `src/App.tsx:2417-2446` (tray), `:2512-2525` (Clear-all), `:2529-2544` (wizard chip); `ShortlistTray.tsx:149` (`bottom-24`).
**Fix.** When the full tray shows on the idle view, lift the Clear-all/wizard chips clear of its footprint (bump bottom offsets to ~11rem/14rem when `shortlist.length > 0`), or move the tray higher when `isDirty`, or give mobile a collapsed count chip anchored away from the pills.

### MO-5 — Touch peek bar buttons fall below the 44px touch-target standard used elsewhere · **Low** · [Claude Code]
**Problem.** The mobile-only peek bar (the primary touch way to read an area's value) uses a details button of `px-2.5 py-1.5 text-[11px]` (≈23-28px tall, no min-height) and a close button that's just a `w-3.5 h-3.5` (14px) SVG with no min hit-area — both well under the `min-h-[44px]`/`min-w-[44px]` convention applied everywhere else (NeighborhoodPanel uses the identical padding but adds `min-h-[44px]`).
**Where.** `src/App.tsx:2263-2271`.
**Fix.** Add `min-h-[44px] md:min-h-0` to the details button and wrap the close button with `min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center`.

---

## 9. Accessibility

### AY-1 — Layer list: arrow-key navigation moves a visual-only highlight without moving DOM focus; 58 of 59 layer buttons are `tabIndex=-1` · **Medium** · [Claude Code]
**Problem.** LayerSelector's arrow-key roving updates only `focusedIndex`, which drives a visual `ring-2` highlight + `scrollIntoView` — it never moves DOM focus and the `role="group"` container has no `aria-activedescendant`. Combined with `tabIndex={isActive ? 0 : -1}` on every button: (a) SR users get **no per-item name/aria-pressed feedback** while arrowing through 59 metrics — the AT cursor stays put; and (b) only the active layer + the standalone quality_index button are Tab-reachable. (Mitigated: sighted keyboard users see the highlight and Enter works; App announces the result after selection — so the control is operable but the AT navigation is broken.)
**Where.** `src/components/LayerSelector.tsx:279` (tabIndex), `:104-136` (arrow handler), `:139-143` (scroll-only effect), `:151` (role=group, no activedescendant), `:70`.
**Fix.** Adopt a valid managed-widget pattern: either move DOM focus with the roving index (`.focus()` in the scroll effect; `tabIndex={flatIndex === focusedIndex || isActive ? 0 : -1}`), **or** add `aria-activedescendant` on the container pointing at the highlighted button's id (the pattern SearchBar already uses) and give each button a stable id. Reset `focusedIndex` to the active layer when the panel opens.

### AY-2 — Settings menu declares `role="menu"` but implements no arrow-key navigation or open-focus (and wraps non-menuitem form controls) · **Medium** · [Claude Code]
**Problem.** SettingsDropdown's open panel is `<div role="menu">` with `role="menuitem"` children, but implements no roving arrow-key navigation (no `onKeyDown`, no `menuRef`) and no move-focus-into-menu-on-open — its only effect handles outside-click + Escape. This breaks the same `role="menu"` contract the sibling ToolsDropdown explicitly honors, and a code comment falsely asserts arrow-key nav exists. The menu also holds controls outside the ARIA menu content model: a native `<select>` and an `<input type=range>` slider.
**Where.** `src/components/SettingsDropdown.tsx:217,170-189,292,84-92/308`. Contrast `ToolsDropdown.tsx:92-96,100-113,152`.
**Fix.** *Preferred:* drop `role="menu"`/`menuitem` and use `<div role="group" aria-label={t('settings.title')}>` — Tab already traverses all controls and `aria-pressed` toggles are correct on plain buttons. *Or:* port ToolsDropdown's open-focus + `handleMenuKeyDown` and move the `<select>` and slider out of the `role="menu"` container.

### AY-3 — Quality-Index "How is this calculated?" popover uses `role="dialog"` but can't be closed with Escape, outside-click, or focus management · **Low** · [Claude Code]
**Problem.** The QualityBadge explainer popover uses `role="dialog"` but provides none of the expected dialog behaviors: no Escape-to-close, no outside-click dismissal, no focus movement/trap — inconsistent with the sibling StatRow info popover (Escape + outside-mousedown + focus restore, and `role="tooltip"`). (Verifier correction: the user is *not* trapped — focus stays on the toggle button, which re-closes it — so the genuine defect is the ARIA-semantics-vs-behavior mismatch, not a trap; hence low.)
**Where.** `src/components/NeighborhoodPanel.tsx:603-606` (popover), `:578,592-602` (state/toggle). Compare `:138-157` (StatRow).
**Fix.** Change `role="dialog"` to `role="tooltip"` (or drop the role and rely on `aria-expanded`), and add an effect mirroring StatRow's: on `showHow`, listen for Escape + outside mousedown to close, restoring focus to the toggle.

### AY-4 — Search combobox reports collapsed and offers no arrow-key nav while the Recent/empty popups are shown · **Low** · [Claude Code]
**Dedup:** same root cause as **SN-3** (SearchBar combobox ARIA). Listed here for the a11y lens; **implement once** — `aria-expanded` hard-wired to `results>0`, `aria-controls` pointing at an unrendered `#search-results-list`, and `totalItems`/`handleKeyDown` excluding recents so arrow keys + `aria-activedescendant` never reach them.
**Where.** `src/components/SearchBar.tsx:281,283,233-234,363-401`.
**Fix.** See **SN-3**. (Set `aria-expanded` true whenever any popup is open; resolve the `aria-controls` IDREF to the live list; give recents `id`/`aria-selected` and include them in `totalItems` + the Enter branch.)

### AY-5 — Add-filter dropdown has no ARIA state and no Escape/focus handling · **Low** · [Claude Code]
**Problem.** FilterPanel's AddFilterDropdown trigger has no `aria-haspopup`/`aria-expanded`, and the popup is a bare `<div>` of buttons with no list/menu role. Its only behavior is close-on-outside-mousedown — no Escape, no focus to first option on open, no return to trigger on close/select. SR users get no signal the button opens a popup; keyboard users can't Escape — inconsistent with ToolsDropdown/SettingsDropdown.
**Where.** `src/components/FilterPanel.tsx:359-371` (trigger), `:373-399` (popup), `:348-355` (outside-click effect).
**Fix.** Add `aria-haspopup="listbox"` + `aria-expanded={open}` to the trigger, wrap options in `role="listbox"`/`role="option"`, add an Escape handler that closes and refocuses the trigger, and focus the first option on open.

### AY-6 — Skip-to-content link is hardcoded Finnish for English and Swedish users · **Low** · [Claude Code]
**Problem.** The skip link (first focusable element) in `index.html` is hardcoded Finnish ("Siirry sisältöön", `lang="fi"`) and never updated, even though App switches `documentElement.lang` at runtime for en/sv. Keyboard/SR users in en/sv get a Finnish-only primary navigation shortcut that mismatches the announced page language.
**Where.** `index.html:336`; runtime lang switch at `src/App.tsx:1680`.
**Fix.** Update the static link's `textContent` + `lang` in the same App effect that sets `documentElement.lang` (keeps it available during the boot placeholder phase). Add an `aria.skip_to_content` key to all three locales (none exists today).

### AY-7 — Global single-key shortcuts are not remappable or turn-off-able (WCAG 2.1.4) · **Low** · [Claude Code]
**Problem.** The window keydown handler registers single non-modifier character shortcuts (`?`, `/`, `[`, `]`, f/r/w/c/s/g/l). It's mitigated by bailing on INPUT/TEXTAREA/contentEditable focus and on Ctrl/Alt/Meta chords, but WCAG 2.1.4 (Level A) additionally requires single-key shortcuts to be remappable, turn-off-able, or active only on component focus — **none exists**, so dictation/speech reaching a focused non-text element (the map canvas, a layer button) can still trigger toggles with no opt-out.
**Where.** `src/App.tsx:1879-1909` (handler), `:1885-1907` (shortcuts); advertised in `ShortcutsOverlay.tsx:10-22`.
**Fix.** Add a "keyboard shortcuts: on/off" toggle persisted to localStorage that gates the handler (keep the Escape branch always-on), surfaced in ShortcutsOverlay — satisfies the turn-off provision with minimal code.

---

## 10. Discoverability, IA & trust

### DX-3 — The only way to support the project is a Bitcoin Lightning string, hidden in the gear menu · **Medium** · [Manual Setup]
**Problem.** The only donation method is a hardcoded BOLT12 Lightning offer shown as a copyable opaque string + QR. There's **no conventional Finnish payment path** (no MobilePay/IBAN/Ko-fi/etc. anywhere in code or locales), so the overwhelming majority of willing visitors can't donate. The button is mounted only in the gear dropdown and absent from the footer (which otherwise lists Contact/Sources/Privacy). The authors' own `donate.legitimacy` disclaimer confirms the trust concern is real but doesn't resolve the accessibility/discoverability gap.
**Where.** `src/components/DonateButton.tsx:9-10,64-121`; only mount at `SettingsDropdown.tsx:408-412`; footer at `src/App.tsx:2618-2641`.
**Fix.** Add at least one mainstream payment method (MobilePay, IBAN/bank line, or a Ko-fi/Liberapay/Buy-Me-a-Coffee link) — **Manual Setup**, needs a payment-provider account — and add a small "Support" link to the footer next to Contact/Sources/Privacy.

### DX-4 — Embed mode strips all upstream data-source attribution · **Medium** · [Claude Code]
**Problem.** In embed mode (`?embed=1`) the attribution footer is removed and the only remaining credit is the watermark, which shows just "naapurustot.fi" linking to the full-view URL. The Legend deliberately omits the source. The removed footer normally lists the actual upstream publishers + license ("Aineisto: Tilastokeskus, HSL, HSY, Poliisi, Kela, THL, Verohallinto, Traficom, Oikeusministeriö, OpenStreetMap (CC BY 4.0)"). So an embed on a third-party site displays CC BY 4.0 data with **no upstream credit and no link to `/tietolahteet`**.
**Where.** `src/App.tsx:2619` (footer removed in embed), `:2646-2673` (watermark); attribution text `fi.json:227`; Legend omission `Legend.tsx:48-52`.
**Fix.** Keep a compact always-visible attribution at the watermark anchor — e.g. "Aineisto: Tilastokeskus, HSL, HSY, OSM (CC BY 4.0)" (reuse/shorten `footer.attribution`) with a lang-aware `/tietolahteet` link. Optionally surface the active layer's source/year via `getMetricSource(layer.property)`.

### DX-1 — Contact has no surface on mobile — buried in the desktop-only footer · **Low** · [Claude Code]
**Problem.** On the map view the only contact affordance (ContactMenu) sits in the attribution footer, which is `hidden md:block`, so it's absent on phones. SettingsDropdown was deliberately extended to re-surface the footer's Privacy and Data Sources links for mobile (explicit X1 comment), but **Contact was not added** — an inconsistent gap. (Not a true dead-end: the email is reachable on mobile via the Privacy page and any profile-page footer.)
**Where.** `src/App.tsx:2620` (footer hidden), `:2624` (ContactMenu); `SettingsDropdown.tsx:414-442` (Privacy + Data Sources surfaced, no Contact).
**Fix.** Add a Contact row to SettingsDropdown after the Privacy/Data Sources links, reusing ContactMenu (or a row revealing/copying `info@naapurustot.fi`).

### DX-2 — "Data last updated: <build month>" in Settings overstates data freshness · **Low** · [Claude Code]
**Problem.** The gear menu renders the site's build month from `__BUILD_DATE__` prefixed by `t('data.last_updated')` ("Data last updated" / "Aineisto päivitetty"). This tells a newcomer the underlying *statistics* are current as of that month, which is false — many layers are 2021-2023 vintages (the panel/legend even show "X years ago" stale badges). The app's own Data Sources page deliberately says "Dataset rebuilt {date}," so the menu wording is internally inconsistent. (Impact limited: a faint 10px gray footnote with a "Data Sources & Methodology" link to the per-layer vintage table directly above it.)
**Where.** `src/components/SettingsDropdown.tsx:444-453`; key `en.json:539`; honest framing at `DataSourcesPage.tsx:132-137` / `en.json:251`.
**Fix.** Reword `data.last_updated` (×3 locales) to match the Data Sources page (e.g. "Site/Dataset rebuilt") so the footnote no longer asserts blanket statistics freshness.

### DX-5 — Custom Quality Index — a headline feature — is fronted by an unlabeled icon in the layer list · **Low** · [Claude Code]
**Problem.** In LayerSelector the only layer-list entry point for the Custom Quality Index is an **icon-only** button (tune/sliders SVG) whose label is carried only by `title` (no visible text, no touch tooltip), so scanning users get no cue it opens a per-dimension weighting tool. The same action inside an opened NeighborhoodPanel uses the identical icon but *adds* visible "Customize"/"Muokkaa" text — so the discoverable affordance only appears after drilling into an area.
**Where.** `src/components/LayerSelector.tsx:210-227`; labeled sibling at `NeighborhoodPanel.tsx:628-641`.
**Fix.** Match the panel's labeled button — render the `custom_quality.button` text next to the tune icon (at least when the Quality Index row is active, or whenever space allows).

### DX-6 — "Compare" — the app's headline verb — has no entry in the Tools menu's default list · **Low** · [Claude Code]
**Problem.** The product's headline verb is "compare neighborhoods," but the Tools menu's always-visible list offers only Show-my-area, Wizard, Filter, and Ranking. Every compare affordance is hidden under the collapsed "More tools" disclosure, and the prominent one there is "Compare *layers*" (split map — two metrics, one map), a confusion the code itself flags. The actual pin-to-compare flow works (NeighborhoodPanel pin button), so the headline action is reachable but never surfaced as a first-class Tools entry.
**Where.** `src/components/ToolsDropdown.tsx:157-216` (default list), `:339-368` (More tools); `NeighborhoodPanel.tsx:1038-1062` (pin-to-compare).
**Fix.** Add a clearly-labeled "Compare areas" entry to the default Tools list that explains/initiates the pin flow, kept visually distinct from "Compare layers."

---

## Coverage gaps / follow-up

Areas the synthesis flagged as under-reviewed in this pass — worth a targeted look next time, not findings themselves:

1. **ComparisonPanel / pin-to-compare flow itself** — only its *discoverability* (**DX-6**) was reviewed. Check the pinned-areas table rendering, mobile layout, the "pin one more" empty state, removing pins, and behavior on the data-null `?city=all` view (likely the same empty-`pnoFeatureMap` breakage as **ES-1**/**ES-2**).
2. **NeighborhoodPanel core content** — beyond the QI popover (**AY-3**): stat rows, the quality-index breakdown, share/copy-link affordances, panel scroll/close behavior, and focus trapping/return on open/close.
3. **Deep-link / URL-state round-trip** — `?pno`/`?compare` encoding/decoding, back/forward history integrity, the copy-shareable-link affordance. The deferred geo resolution in **SN-5** hints at fragility not fully traced.
4. **Profile pages (`/alue/...`) beyond the loading frame** (**LP-2**) — content correctness, in-page language switching, the prerendered hub pages, navigation back into the map.
5. **Grid-overlay UX** (air quality ~250 m, light pollution ~500 m) — only the load-failure announcement (**ER-3**) was covered. Per-cell value readout, legend interaction, zoom-dependent visibility.
6. **Theme/dark-mode and reduced-motion correctness** across the newer components (split view, correlation explorer, wizard, peek bar) — only the `prompt()` dark-mode gap (**DT-3**) surfaced; a systematic contrast + `prefers-reduced-motion` pass on the `animate-pulse`/transition states is warranted.
7. **Modal focus management in AuthModal and the onboarding tour** — **AC-4**/**AC-5** covered copy/inputs; whether focus is trapped, where it lands on open, and where it returns on close was not verified.

---

## Suggested Sequencing

Items within a batch are **file-disjoint** (or touch far-apart, independent regions of `App.tsx`) and are safe to run as **parallel Claude Code sessions**. Batches are ordered by dependency: shared-file work is split across batches so later sessions rebase on earlier ones rather than colliding (e.g. all `useAuth` work lands before secondary `useAuth` edits; the two `search.no_results` edits in **SN-4** and **ES-6** are deliberately separated). Every item is tagged **[CC]** = Claude Code (fully implementable in a session) or **[MS]** = Manual Setup. All items are [CC] except **DX-3**.

> **Dedup note:** **AY-4 ≡ SN-3** (one SearchBar combobox-ARIA fix) and **ES-6** pairs with **SN-4** (same `search.no_results` string). Implementing **SN-3** (Batch 3) and **SN-4** (Batch 4) makes their later twins largely no-op rebases — do them as a single coherent edit each.

**Batch 1 — Broken core flows on the landing view.** Highest-impact functional breakages; all file-unique or in disjoint `App.tsx` functions.
- **SN-1** Enter selects top match [CC] · **DT-1** Filter aggregate-scope copy/scope [CC] · **ES-1** Favorites name fallback on all-Finland [CC] · **SN-6** Mobile region-switcher label [CC] · **DT-6** Correlation identical X/Y guard [CC] · **AY-3** QI popover role/dismissal [CC]

**Batch 2 — Account & sync data-safety.** All account/auth files; defers secondary `useAuth`/`useNotes` work to later batches.
- **AC-2** Logout `resetLocal()` + tombstone clear [CC] · **AC-1** Recovery copy honesty + change-password [CC/MS] · **AC-4** Signup show/hide password [CC] · **SN-2** Address-search placeholder [CC]

**Batch 3 — Mobile split view + shortlist/search a11y on touch.**
- **MO-1** Responsive split view + search/FAB gating [CC] · **SN-3** Recents in combobox keyboard model [CC] · **ES-2** Disable shortlist exports when unresolvable [CC] · **ER-4** ErrorBoundary `role="alert"` + focus [CC] · **DT-3** Inline filter-preset name field [CC]

**Batch 4 — Perceived performance + filter/layer-list usability.**
- **LP-1** Loading bar for on-demand national fetch [CC] · **SN-4** `GEOCODING_ENABLED` gating + no-results copy [CC] · **ES-3** Mobile zero-match empty state [CC] · **LP-2** Profile-page synchronous init + skeleton [CC] · **AY-1** Layer-list roving focus / activedescendant [CC]

**Batch 5 — Onboarding, comprehension & all-Finland scope defaults.**
- **ON-2** Move "Take the tour" + reopen note on skip [CC] · **ON-3** Legend "i" explainer for composite layers [CC] · **SN-5** Address resolution query/home nudge [CC] · **DT-2** Wizard default scope on all-Finland [CC]

**Batch 6 — Dropdown/menu ARIA + scope toggle + no-results copy refinement.** (**ES-6** rebases on **SN-4**.)
- **AY-2** Settings menu role/keyboard semantics [CC] · **AY-5** Add-filter dropdown ARIA [CC] · **ES-6** Drop "change city" from no-results copy [CC] · **ER-3** Grid-failure `aria-live` [CC] · **DT-4** Disabled scope-toggle hint/hide [CC]

**Batch 7 — A11y announcements + skip link + auth/copy honesty.** (**AY-4** is the **SN-3** rebase; **ER-6** rebases on **AC-2**; **DT-7** rebases on **MO-1**.)
- **ER-5** Offline indicator `role="status"` [CC] · **AY-6** Localized skip link [CC] · **AY-4** Combobox expanded/controls (see SN-3) [CC] · **ER-6** Localize auth error fallbacks [CC] · **DT-7** Split-view identical-layer note [CC]

**Batch 8 — Loading announcement + notes retrieval + geocode errors + empty states.** (Secondary `useNotes`/`geocode.ts`/`LayerSelector` edits, free after Batches 2/4.)
- **LP-5** Cold-load overlay `role="status"`/`aria-busy` [CC] · **AC-3** Note indicator + `listNotedPnos()` [CC] · **ER-1** Geocode error vs empty distinction [CC] · **ES-5** Guided ranking empty state [CC] · **DX-5** Labeled custom-QI button in layer list [CC]

**Batch 9 — Keyboard-shortcut opt-out, locale-fail banner, mobile hint, contact, stale copy.** (Three disjoint far-apart `App.tsx` regions.)
- **AY-7** Shortcuts on/off toggle [CC] · **MO-2** Hint/peek collision (`&& !peek`) [CC] · **ER-2** Hardcoded trilingual locale-fail banner [CC] · **DX-1** Contact row in mobile gear menu [CC] · **ON-1** Drop "large file" qualifier [CC]

**Batch 10 — Back-gesture dismissal, embed attribution, compare discoverability, region-table error.** (**DX-6** rebases on **MO-1**.)
- **MO-3** `splitMode` + Layers sheet in back/Escape cascade [CC] · **DX-4** Embed-mode attribution line [CC] · **DX-6** "Compare areas" Tools entry [CC] · **ES-4** Distinct region-table error + retry [CC]

**Batch 11 — First-paint locale flash, donation channel, trust copy.** (Lone Manual Setup item placed once its deps are clear.)
- **LP-3** Gate first paint / preload detected locale [CC] · **DX-3** Add a mainstream payment method + footer Support link [**MS**] · **DX-2** Reword "Data last updated" [CC] · **AC-5** Trim Turnstile error clause [CC]

**Batch 12 — Search-index loading, mobile control stacking, filter overlap, dead-string cleanup.**
- **LP-4** Gate no-results on index availability [CC] · **MO-4** Lift bottom chips clear of the tray [CC] · **DT-5** Offset desktop Filter panel below search bar [CC] · **ON-4** Delete/repurpose dead `app.subtitle` [CC]

**Batch 13 — Remaining touch-target and copy polish.**
- **MO-5** Peek-bar 44px touch targets [CC] · **ON-5** Fix Finnish "Hae alueella" placeholder grammar [CC]
