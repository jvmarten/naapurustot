# UX Review — naapurustot (Fresh Eyes)

**Date:** 2026-07-17
**Reviewer perspective:** A first-time visitor who knows nothing about the project, arriving cold at naapurustot.fi.
**Method:** A fresh multi-agent pass over the current source: five parallel review lenses (onboarding & search · data tools · account/sync & error/empty states · mobile & loading · accessibility/trust/profile pages), each producing `file:line`-grounded findings verified against the code as it is today, with the top claims re-verified independently. Findings are **capped at three per category** — only the most impactful survivors are listed; verified-but-minor items are named in the *checked-and-pruned* note so they aren't re-found.
**Scope:** Frontend & user-facing behavior only.

> **Relationship to the prior review.** The 2026-06-13 review (56 unique findings) was fully implemented by 2026-06-16, and a month of further UX work shipped since (national filtering on the default view, accent + municipality search, fit-for-you score, profile framing, mobile planning toggle, responsive split view). Nothing below restates an already-fixed finding — each was checked against live source. What remains clusters in code that post-dates those fixes and in the prior review's own declared blind spots (the ComparisonPanel flow, profile-page internals, modal keyboard handling).

**Severity legend** — *Critical:* blocks or excludes a class of users. *High:* frequent friction or a "looks broken" moment most first-timers hit. *Medium:* noticeable confusion for many. *Low:* polish.

**Severity counts: 0 critical · 4 high · 10 medium · 5 low (19 findings).**

---

## TL;DR

The app is in the best shape it has ever been — the prior review's 56 fixes hold up. What's left clusters into four patterns:

1. **Panels fight each other for the same screen real estate.** Both ranking tables render exactly on top of the search box (**DT-1**, high — the same bug already fixed for FilterPanel), the desktop comparison table covers the open area panel mid-pin-flow (**DT-2**), and the mobile peek bar paints over the Legend (**MO-2**).
2. **The newest surfaces missed the app's own conventions.** Search results still hide the municipality even though search now *matches* on it (**SN-1**, high), shortlist chips ignore the 44 px touch standard (**MO-1**), and the profile pages' section headers aren't headings (**AY-3**).
3. **Profile→profile navigation is the worst moment on the highest-traffic surface**: a client-side tap on "Similar neighbourhoods" blanks the whole page and pulls the multi-MB national dataset to resolve one area (**LP-1**, high).
4. **Auth and sync fail silently for the users who most need feedback.** Auth errors are never announced to screen readers (**AY-1**, high), a "Session expired" state is a dead end that survives re-login (**AC-1**), and deleted filter presets resurrect across devices (**AC-2**).

---

## The handful that matter most

| ID | Finding | Severity | Why it's top |
|----|---------|----------|--------------|
| **DT-1** | Both ranking panels render directly on top of the search box (and on top of each other) | High | Two core tools make the primary navigation control unusable while open |
| **SN-1** | Search results show name + postal code but never the municipality | High | Dozens of areas share names like "Keskusta"; the dominant nav path returns indistinguishable rows |
| **LP-1** | Profile→profile navigation blanks the page and downloads the national dataset | High | The highest-traffic (SEO) surface has its heaviest, most jarring moment on its most natural click |
| **AY-1** | Auth errors are invisible to screen readers | High | A failed login/signup gives an SR user zero feedback at a hard gate |
| **AC-1** | "Session expired" sync state is a dead end and survives logout → re-login | Medium | The copy says "log in again" but offers no control, and doing so leaves the error on screen |

---

## 1. Onboarding & first impression

### ON-1 — Welcome step teaches "click a seutukunta" while the map is fully masked and any click just advances the tour · **Low** · [Claude Code]
**Problem.** The anchorless welcome step renders a solid 65 %-black backdrop with no spotlight cutout, so the map is entirely hidden — yet its hint text invites the user to "click a seutukunta." The full-screen click-blocker turns any click into "Next," so the gesture being taught is both invisible and non-functional at that moment.
**Where.** `src/components/OnboardingTour.tsx:277-294` (backdrop + click-blocker); hint string wired at `:32` / `src/locales/fi.json:735`.
**Fix.** Move the click hint to the closing step (right before control returns to the map), or reword the welcome hint so it doesn't invite an action that can't be performed yet.

### ON-2 — On a slow first load, tour spotlights reveal the blank loading overlay instead of the chrome · **Low** · [Claude Code]
**Problem.** The tour starts immediately (by design) at `z-[100]`, but the cold-load overlay is `absolute inset-0 z-50` above all chrome — so an anchored step reached before `effectiveLoading` clears cuts its spotlight hole onto the white shimmer, not the control it describes. Reachable on slow mobile connections by clicking "Next" quickly.
**Where.** `src/App.tsx:2328-2341` (overlay), `:2010-2043` (tour armed pre-load); `src/components/OnboardingTour.tsx:243,259-275`.
**Fix.** Gate the first *anchored* step (not the welcome step) on `firstLoadDone`.

---

## 2. Search & navigation

### SN-1 — Search results show only name + postal code, never the municipality · **High** · [Claude Code]
**Problem.** Result rows render `displayName` + `pno` only. Finnish postal-area names are massively duplicated ("Keskusta", "Kirkonkylä" exist in dozens of towns), so a query like "keskusta" returns rows reading `Keskusta 00100`, `Keskusta 33100`, `Keskusta 90100`… with no town shown. Search now *matches* on municipality — but the matched municipality is used for scoring and then discarded at render, so even the town the user typed isn't echoed back.
**Where.** `src/components/SearchBar.tsx:489-506` (rows), `:99,121-130` (`muni` scored, never displayed).
**Fix.** Render the municipality as a secondary label on each row, e.g. `Keskusta · Tampere  33100`.

### SN-2 — Mobile region switcher is a 70-item unsearchable scroll list · **Medium** · [Claude Code]
**Problem.** The mobile region dropdown lists "Koko Suomi" plus all 69 seutukunnat in a `w-48 max-h-80` popover with no filter input and no typeahead (the desktop native `<select>` at least supports type-to-jump). Reaching an alphabetically-late region means scrolling ~70 rows in a small popover.
**Where.** `src/components/CitySelector.tsx:80-121` (mobile branch), `:21-24` (options list).
**Fix.** Add a small filter input at the top of the mobile dropdown, mirroring the LayerSelector's search field.

### SN-3 — The visible placeholder hides address & postal-code search from sighted users · **Low** · [Claude Code]
**Problem.** The visible placeholder is always the short "Hae aluetta…"; the richer "Hae osoitetta tai postinumeroa…" exists only as the `aria-label`. Sighted first-timers get no cue that they can type a street address — the most natural first action — even on desktop where the wider field has room.
**Where.** `src/components/SearchBar.tsx:359` (visible placeholder), `:349` (aria-label); `src/locales/fi.json:3-5`.
**Fix.** Use the longer address/postal placeholder at the `md:` breakpoint, keeping the short form on mobile.

---

## 3. Data tools

### DT-1 — Both ranking panels render directly on top of the search box — and on top of each other · **High** · [Claude Code]
**Problem.** `RankingTable` and `RegionRankingTable` both render at `absolute top-14 left-4 z-20 w-80` with an opaque surface; the SearchBar sits at the same anchor (`top-[3.5rem] left-4`) at `z-10`, so either ranking panel fully covers and blocks the search input. This is the exact bug already fixed for FilterPanel (moved to `top-28`, with a code comment saying why) — the ranking tables never got the fix. The two ranking tools are also independent toggles that don't close each other, so opening both stacks them pixel-for-pixel while the Tools menu shows both as active.
**Where.** `src/components/RankingTable.tsx:92`, `src/components/RegionRankingTable.tsx:104`, `src/App.tsx:2469` (SearchBar), `:324`/`:1712-1717` (independent toggles); contrast `src/components/FilterPanel.tsx:781-783`.
**Fix.** Give both ranking tables the `top-28` offset FilterPanel uses, and make the two ranking tools mutually exclusive (mirroring the existing filter↔ranking exclusion).

### DT-2 — The desktop comparison table covers the open area panel mid-pin-flow · **Medium** · [Claude Code]
**Problem.** The desktop `ComparisonPanel` table is centered on the full viewport (`bottom-4 left-1/2 -translate-x-1/2 max-w-[800px]`) with no awareness of the full-height 380 px `NeighborhoodPanel` on the left. On a typical laptop the table's left edge lands inside the panel and, painted later, covers its bottom section (exports, similar areas, notes) — immediately after the user pins a second area, i.e. in the core compare flow. The existing `suppressMobile` handles only the mobile collision.
**Where.** `src/components/ComparisonPanel.tsx:248` (+ `suppressMobile` at `:23`), `src/components/NeighborhoodPanel.tsx:2088`.
**Fix.** When an area is selected, shift the desktop table's centering right by ~half the panel width (or constrain it to the map area right of the panel).

### DT-3 — FilterPanel shows "No neighborhoods match / Clear all" while the national dataset is still loading · **Medium** · [Claude Code]
**Problem.** On `?city=all` the national set loads on demand and FilterPanel's `data` is null until it resolves. With a filter active during that window, `ranked` is empty, so the panel renders its zero-match empty state with a "Clear all" recovery — while the banner directly above correctly says all of Finland is still loading. The user sees a contradictory "0 results, clear your filters" for a query that hasn't run yet.
**Where.** `src/components/FilterPanel.tsx:754-769` (no-match block, no loading guard), `:670-675` (loading banner); `src/App.tsx:2523-2528`.
**Fix.** When `isAggregate && !data && filters.length > 0`, render a loading placeholder instead of the no-match state.

---

## 4. Save, account & sync

### AC-1 — "Session expired" sync state is a dead end and survives logout → re-login · **Medium** · [Claude Code]
**Problem.** When a sync fails with 401, `sessionExpired` is set in module-level `syncStatus` state, but `useAuth` is never told — the header keeps showing the logged-in menu, and the UserMenu hides its Retry button for the 401 case, leaving only the passive text "Session expired — please log in again" with no matching control. Worse, the module state is cleared only by a *successful* save (or a test-only reset): `handleLogout` resets all six data stores but not `syncStatus`, and on re-login the merge usually equals the server (so no save fires) — so the user's natural recovery path leaves the stale error dot on screen indefinitely.
**Where.** `src/utils/syncStatus.ts:22-30,94,141` (no production reset), `src/App.tsx:573-582` (logout skips syncStatus), `src/components/UserMenu.tsx:159-172`, `src/hooks/useAuth.ts:41-51`.
**Fix.** Export a production `resetSyncStatus()` and call it on logout and on the login transition; on `sessionExpired`, render a button that clears local auth state and opens the AuthModal, so the instruction has a control.

### AC-2 — Deleted filter presets resurrect across devices — the one synced store without tombstones or a login-merge guard · **Medium** · [Claude Code]
**Problem.** `useFilterPresets` merges by pure set-union, `removePreset` writes no deletion tombstone, and there is no `loginMergePendingRef` — unlike the other five synced stores, which all got these guards. A preset deleted on one device (or while signed out) reappears after the on-login merge unions the still-present server copy back in; the unguarded 1 s-debounced save can also race the merge fetch on the null→id login transition.
**Where.** `src/hooks/useFilterPresets.ts:59-70` (union merge), `:116-128` (unguarded debounced save), `:173-177` (no tombstone); contrast `src/hooks/useFavorites.ts:42,71-77,113-114,138`.
**Fix.** Mirror the favorites pattern: a `naapurustot-filter-presets-removed` tombstone set via `syncTombstones.ts`, skipped in the merge and cleared on re-add, plus a `loginMergePendingRef` gate on the debounced save.

### AC-3 — Signup is hard-gated on Cloudflare Turnstile with no honest path for blocked users · **Medium** · [Claude Code]
**Problem.** With a site key configured, signup requires a Turnstile token. If `challenges.cloudflare.com` is blocked (corporate proxy, strict blocker), the widget's script-error UI at least explains itself — but if the script loads and the challenge simply never issues a token, submitting loops on a generic "Bot verification failed — please try again" that can never succeed, with no way to distinguish "still loading" from "blocked." Account creation is silently unreachable for that class of first-time visitors.
**Where.** `src/components/AuthModal.tsx:98-101` (hard gate); `src/components/Turnstile.tsx:40-47,82-84,93-111`.
**Fix.** Distinguish "verification still loading" from "verification failed" in the submit-time copy, and on repeated failure show an honest message (the app is fully usable without an account; name the blocker as the likely cause) instead of an infinite "try again."

---

## 5. Mobile

### MO-1 — Shortlist chips have far-below-minimum touch targets · **Medium** · [Claude Code]
**Problem.** The ShortlistTray is the primary mobile surface for the flagship synced shortlist, yet each chip's select button is a `py-1` text node (~24 px tall) and its remove control is a 16×16 px "×" — both far under the 44 px standard the rest of the app enforces (the tray's `min-h-[44px]` rule is scoped to the actions row only). Mis-taps and accidental removals on exactly the surface users curate most.
**Where.** `src/components/ShortlistTray.tsx:267` (chips container), `:281-291` (select + remove buttons); the 44 px rule at `:177` covers only the actions row.
**Fix.** Apply the app's `min-h-[44px] md:min-h-0` pattern to the chip buttons and give the "×" a ≥44 px padded hit area.

### MO-2 — The touch peek bar paints over the Legend (and can reach the Layers FAB) · **Medium** · [Claude Code]
**Problem.** The peek bar centers at the same bottom band the Legend occupies (`z-30` vs `z-10`), and during peek `selected` is null so the Legend's `hidden={!!selected}` never fires — the peek bar overlaps it for typical area-name widths, and long names can also reach the bottom-right Layers FAB (which is likewise not hidden during peek). Cluttered, mutually-obscuring chrome exactly when the user is trying to read the peeked value.
**Where.** `src/App.tsx:2587-2631` (peek bar), `:2634` + `src/components/Legend.tsx:89` (`hidden={!!selected}`), `src/components/LayerSelector.tsx:437-457` (FAB `hidden={!!selected || splitMode}`).
**Fix.** Extend the Legend's (and FAB's) hide condition to include the peek state, or dock the peek bar above the legend band.

### MO-3 — Panel-header icon toggles are ~32 px wide in a tight row of four · **Low** · [Claude Code]
**Problem.** The favourite / reference / shortlist icon buttons in the mobile NeighborhoodPanel sheet header have `min-h-[44px]` but only `p-1.5` around a `w-5 h-5` icon (~32 px wide), laid out with `gap-1` — height meets the standard, width doesn't, inviting mis-taps between adjacent toggles.
**Where.** `src/components/NeighborhoodPanel.tsx:1022-1072` (the three buttons), rendered in the sheet header at `:2228-2234`.
**Fix.** Add `min-w-[44px] md:min-w-0`, mirroring the existing height pattern.

---

## 6. Loading & perceived performance

### LP-1 — Profile→profile navigation blanks the whole page and downloads the national dataset · **High** · [Claude Code]
**Problem.** On the prerendered profile pages — the app's dominant organic-search entry — tapping a "Similar neighbourhoods" card is a client-side navigation, so the component doesn't remount and the DOM's embedded payload still belongs to the *previous* area. `readEmbeddedProfile(newPno)` misses, the code falls to the fetch path calling `loadNeighborhoodData()` (the multi-MB national set), and because `if (loading)` returns a bare centered spinner, the entire rendered profile is replaced by a blank page for the duration of that download+parse — on exactly the low-powered mobile devices SEO visitors arrive on. The prerender fast path runs only in the `useState` initializer, never on a same-route param change.
**Where.** `src/pages/NeighborhoodProfilePage.tsx:175` (`setLoading(true)` on pno change), `:214-237` (embedded miss → national fetch), `:427-433` (full-page spinner replaces content), `:81-98` (mount-only fast path).
**Fix.** Keep the previous profile visible under a lightweight overlay while the next loads, and resolve the target from the already-loaded region features (as the similar-areas grid itself does) instead of pulling the national set for one area.

---

## 7. Accessibility

### AY-1 — Auth errors are invisible to screen readers · **High** · [Claude Code]
**Problem.** Every auth failure — wrong password, password mismatch, bot-check failure, rate limiting — renders into a plain `<p className="text-sm text-red-600">` with no `role="alert"` and no live region; the inputs never get `aria-invalid`/`aria-describedby`. A screen-reader user who submits and fails gets zero feedback at a hard gate: focus stays on the re-enabled submit button and nothing is announced.
**Where.** `src/components/AuthModal.tsx:289` (error `<p>`); validation feeding it at `:90-101`; inputs at `:195-234`.
**Fix.** Give the error node `role="alert"` (or an always-mounted `aria-live="assertive"` container), and set `aria-invalid` + `aria-describedby` on the offending inputs.

### AY-2 — The onboarding tour swallows Enter globally, breaking Back / Skip / language selection for keyboard users · **Medium** · [Claude Code]
**Problem.** The tour's window-level keydown handler treats *any* Enter as "advance" — `e.preventDefault()` + next step — without checking the event target. Tabbing to "Back" and pressing Enter moves *forward*; Enter on "Skip" advances; worst, Enter on a language button in the welcome step's embedded LanguagePicker advances the tour instead of switching language (Space still works, but Enter is the expected key).
**Where.** `src/components/OnboardingTour.tsx:158-193` (handler; Enter branch at `:163-166`); LanguagePicker at `:335-339`, Back/Skip at `:312-317,355-363`.
**Fix.** Ignore Enter when `e.target` is a button/link/input (let native activation run); keep ArrowRight as the unconditional advance key.

### AY-3 — Profile-page section headers are neither headings nor expose their collapse state · **Medium** · [Claude Code]
**Problem.** On the ~9,000 prerendered profile pages, the four main data sections (Demographics, Housing, Services, Environment) render as bare `<button>`s with no heading element and no `aria-expanded` — while the sibling Quality Index and Similar-neighbourhoods blocks use real `<h2>`s. Screen-reader users navigating by heading (a primary mode) skip all four stat sections entirely, and collapse state is never announced.
**Where.** `src/pages/NeighborhoodProfilePage.tsx:972-994` (`Section` component); compare the real `<h2>`s at `:638,805`.
**Fix.** Put the title in an `<h2>` inside the toggle button and add `aria-expanded={open}`.

---

## 8. Profile pages, discoverability & trust

### DX-1 — The profile-page language control is an ambiguous single cycle-button · **Low** · [Claude Code]
**Problem.** The profile pages — the app's highest-traffic first impression — offer language switching only as one button showing the *next* language's code ("EN" on a Finnish page) with an `aria-label` of just "language." A cold visitor can't tell whether "EN" is the current or target language, and a Swedish speaker on a Finnish page can't reach SV in one action or discover that a FI→EN→SV cycle exists. The in-app Settings uses a clear three-segment picker, so the weakest control sits on the biggest surface.
**Where.** `src/pages/NeighborhoodProfilePage.tsx:527-534`; contrast the in-app `LanguagePicker`.
**Fix.** Reuse the shared three-option `LanguagePicker`, or at minimum label the button "Switch language" and distinguish current from target.

---

## Checked and pruned

Verified real but below the three-per-category bar (fair game later): CorrelationExplorer's region colors have no legend (12 colors cycled over ~70 regions); the CustomQualityPanel opens far-right of its NeighborhoodPanel trigger; saving a 51st filter preset silently no-ops behind success-looking UI; the theme-toggle cross-fade overrides `prefers-reduced-motion` (color-only). Checked and confirmed **already handled** (not re-reported): logout store-wipe + tombstone clearing, recovery-copy honesty, show/hide password, back-gesture coverage incl. the Layers sheet, the national-fetch progress bar, prerender first-paint skeleton, bare-`?pno=` deep-link routing, URL-codec round-trip, honest "dataset rebuilt" copy. The tour's completion→Finder handoff was flagged by one lens but is an explicit, commented activation decision — not re-litigated here.

## Coverage gaps / follow-up

Under-reviewed this pass, worth a targeted look next time: embed mode (`?embed=1`) end-to-end; PWA/offline behavior after the service-worker fix; the planning (kaavat & hankkeet) overlay's own UX beyond its mobile toggle; Swedish copy quality (reviewed for presence/parity, not idiom); the grid overlays' per-cell readout and zoom behavior.

---

## Suggested Sequencing

Items within a batch are file-disjoint and safe as parallel Claude Code sessions; later batches rebase on earlier ones where files repeat (OnboardingTour: AY-2 → ON-1/ON-2; NeighborhoodProfilePage: LP-1 → AY-3 → DX-1; SearchBar: SN-1 → SN-3; AuthModal: AY-1 → AC-3). All 19 findings are [Claude Code]; none need manual setup. Stagger pushes — auto-merge shares one concurrency group.

**Batch 1 — The four highs.**
- **DT-1** Ranking panels below the search bar + mutual exclusion · **SN-1** Municipality in search rows · **AY-1** `role="alert"` on auth errors · **LP-1** Keep profile visible on client nav + light lookup

**Batch 2 — Sync honesty + keyboard + touch basics.**
- **AC-1** `resetSyncStatus()` + re-login affordance · **AY-2** Tour Enter-target check · **MO-1** Shortlist chip touch targets · **DT-3** Loading guard on the filter no-match state

**Batch 3 — Presets, panel collisions, profile semantics.**
- **AC-2** Filter-preset tombstones + merge guard · **DT-2** Comparison table offset from the open panel · **MO-2** Hide Legend/FAB during peek · **AY-3** Profile section `<h2>` + `aria-expanded`

**Batch 4 — Remaining polish.**
- **AC-3** Honest Turnstile-blocked messaging · **SN-2** Filterable mobile region list · **SN-3** Address placeholder on desktop · **MO-3** Panel icon-button width · **ON-1/ON-2** Tour hint + load gating · **DX-1** Profile language picker
