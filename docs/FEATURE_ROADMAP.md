# naapurustot.fi — Feature Roadmap

> Generated 2026-05-22 from a full codebase analysis. Replaces the 2026-04-13
> roadmap, the bulk of which has now shipped. A **Completed** section at the
> bottom records what landed since that roadmap.

---

## Status — 2026-05-29 implementation pass

This roadmap was executed end-to-end in a single pass, with the following items
**deliberately skipped** at the project owner's request: **CF-2** (user reviews),
**CF-6** (email digest), **PO-1** (per-neighborhood OG images), **PO-3** (auth
reset/verification), **PO-4** (GDPR export/deletion), **PO-5** (real-time air
quality), and **IN-1 / IN-2** (Dependabot, API observability).

**Shipped:** QW-1 (build-derived data-freshness timestamp), QW-2 (keyboard
shortcuts + `?` overlay), QW-3 (geolocation "show my area"), QW-4 (MiniMap
a11y + axe-core E2E), CF-1 (quality-index redesign — see below), CF-3
(correlation/scatter explorer), CF-4 (region comparison & ranking), CF-5
(Digitransit travel-time isochrones; needs `VITE_DIGITRANSIT_API_KEY`, hidden
when unset), PO-2 (time slider / historical playback), IN-3 (deploy artifact
trimming via a Vite strip plugin).

**CF-1 partial:** phases (A) dimension grouping + rebalanced defaults, (B)
`docs/QUALITY_INDEX.md`, and (D) persona presets + explainer + softened labels
shipped. Phase **(C) national-reference normalization** is intentionally
deferred — it changes the meaning of every published score and is the part the
roadmap flags for human/editorial review before release. It is documented as
the next step in `docs/QUALITY_INDEX.md`.

---

## Project Context

naapurustot.fi is a static React 19 + TypeScript SPA on a MapLibre GL choropleth,
with an optional Express + PostgreSQL backend. It is a mature product — this
roadmap is about depth and rigour, not breadth.

**Where the project stands today:**

- **Whole-Finland coverage shipped.** All **69 Tilastokeskus seutukunnat** (3 018
  postal codes, Helsinki seutu → Lapland → Åland) are configured in `regions.ts`,
  each with an ingested per-region TopoJSON and a coverage badge in the
  CitySelector. The 2026-04-13 roadmap's flagship CF-5 is essentially done.
- **~58 data layers** in `colorScales.ts` across 11 categories (Quality, Trends,
  Demographics, Economy, Housing, Services, Safety, Mobility, Environment,
  Voting, Connectivity).
- **Backend live** at `api.naapurustot.fi`: auth (JWT/bcrypt/Turnstile) plus
  **cloud sync of favorites, notes, and preferences** (`user_favorites`,
  `user_notes`, `user_preferences` tables; `/auth/{favorites,notes,preferences}`
  routes). The favorites/notes/preferences-sync items from the last roadmap all
  shipped.
- **Tooling/observability shipped:** Sentry (frontend + backend), `web-vitals`,
  Lighthouse CI (perf ≥ 0.85, a11y ≥ 0.95, BP/SEO ≥ 0.95), CodeQL, `npm audit` +
  `pip-audit` in CI, a 210 KB gzipped JS bundle budget, daily on-droplet Postgres
  backups.
- **Frontend depth shipped:** onboarding tour, embed mode, Swedish (FI/EN/SV),
  per-metric explanations + source attribution, skip link, ARIA-labelled radar
  and trend charts, multi-neighborhood PDF/CSV export, score-card image export,
  split map, draw/select tools, wizard, ranking, filter presets, customizable
  quality index, colorblind palettes, PWA, prerendered profile + regional-hub
  pages, `llms.txt`, JSON-LD.

**What this roadmap targets:** the product is broad; the next wins are (1) making
the **headline Quality Index defensible** rather than hand-tuned, (2) adding the
**lived-experience layer** (reviews) the backend was built for, (3) net-new
**analysis tools**, and (4) closing **auth/compliance/ops** gaps now that user
data is stored in production.

**Tech stack:** React 19.2, React Router 7.13, TypeScript 5.9, Vite 8,
MapLibre GL 5.20, Turf.js 7.3, Tailwind 3, Vitest, Playwright, Node 24, Express,
PostgreSQL 16, Docker Compose, Caddy.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Build-Derived Data-Freshness Timestamp

| | |
|---|---|
| **What** | `SettingsDropdown.tsx` shows `Last updated: 2026-03` as a **hardcoded string**. The data pipeline (`data-refresh.yml`) runs quarterly (Jan/Apr/Jul/Oct), so the label is already stale — the last refresh was April 2026. Embed a real `_metadata.generated` timestamp into the per-region TopoJSON during `npm run build:data` (`build_region_data.mjs`), read it through `dataLoader.ts` / `useMapData.ts`, and render the actual date. |
| **Why** | Users make real decisions (relocation, home purchase) on this data; a stale or fabricated "last updated" date quietly erodes trust and is the kind of thing that ages into being simply wrong. Per-metric source attribution already exists — a correct global timestamp is the one missing, drift-prone piece. |
| **Touches** | `scripts/build_region_data.mjs` (embed metadata), `src/utils/dataLoader.ts` or `src/hooks/useMapData.ts` (extract it), `src/components/SettingsDropdown.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Keyboard Shortcuts + `?` Overlay

| | |
|---|---|
| **What** | Today only `Escape` is wired (in `App.tsx`). Add power-user shortcuts and a `?` overlay listing them: `/` focus search, `F` filter, `R` ranking, `W` wizard, `C` customize quality, `S` split map, `G` "show my area" (QW-3), `L` sign-in, `[`/`]` step through the current ranking/filter results. New `ShortcutsOverlay.tsx`; shortcuts should no-op while a text input is focused. |
| **Why** | The app exposes nine tools behind two dropdowns. Repeat users — relocation advisors, agents, journalists — navigate far faster by keyboard, and a discoverable shortcut list doubles as feature discovery for tools buried in menus. |
| **Touches** | `src/App.tsx` (global keydown), new `src/components/ShortcutsOverlay.tsx`, `src/components/SettingsDropdown.tsx` (entry point), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Geolocation — "Show My Area"

| | |
|---|---|
| **What** | A small "use my location" button (in the SearchBar or as a map control) that calls `navigator.geolocation`, picks the containing postal code via point-in-polygon, switches to the right region, and selects the neighborhood. Graceful fallbacks for denied permission / outside Finland. |
| **Why** | With whole-Finland coverage now live, "what's *my* neighborhood like?" is the most natural first action for a huge share of visitors, and today it requires knowing your own postal code or name. One tap turns a national map into a personal one. |
| **Touches** | `src/components/SearchBar.tsx` (or a new map control), `src/utils/geocode.ts` / `src/utils/geometryFilter.ts` (point-in-polygon), `src/App.tsx` (selection handler), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Finish Accessibility: MiniMap Label + axe-core in E2E

| | |
|---|---|
| **What** | Accessibility is largely done (skip link, ARIA-labelled `RadarChart`/`TrendChart`, a Lighthouse a11y ≥ 0.95 gate). Two gaps remain: `profile/MiniMap.tsx` is an unlabelled MapLibre `<div>` with no accessible name or text alternative, and there is no automated a11y assertion beyond Lighthouse's single-page audit. Add a `role`/`aria-label` (and a concise text summary) to MiniMap, and an `axe-core` pass over key app states in the Playwright E2E suite. |
| **Why** | The EU Web Accessibility Directive applies to public information services. axe-core catches structural issues (labels, contrast, roles) across interactive states that a single Lighthouse run misses, and locks accessibility in against regression as later features ship. |
| **Touches** | `src/components/profile/MiniMap.tsx`, `e2e/` (new axe-core spec), `.github/workflows/ci.yml`, `package.json` (`@axe-core/playwright` devDep) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 Quality Index Methodology — A Defensible, Documented Default

> **Prioritized.** This addresses the project owner's brief: *a well-thought-out
> default quality index.*

| | |
|---|---|
| **What** | The Quality Index is the **default map layer** — the first thing every visitor sees — yet its default weighting is hand-tuned: Safety 25 / Income 20 / Employment 20 / Education 15 / Transit 7 / Services 5 / Air 3. Rework it in four phases. **(A) Kill the double-counting.** Income, employment, education and crime are all strong proxies for area affluence, so ~80 % of the score is effectively *one* latent variable (socioeconomic status) counted four times — the "Quality Index" is largely an affluence map relabelled. Group the ~50 flat factors into ~6 conceptual **dimensions** (e.g. Prosperity, Safety, Services & amenities, Mobility, Environment, Housing context), score each dimension once, then weight dimensions — so each concept counts once and liveability factors (services, transit, green space, walkability, noise) actually register. **(B) Documented default.** Anchor the dimension weights to a citable external framework (OECD Better Life Index / Eurostat Quality-of-Life dimensions) and write `docs/QUALITY_INDEX.md` justifying every weight and its source. **(C) National-reference normalization.** Today each metric is min-max normalized over *whatever is loaded*, so the best postal code in tiny Joutsa scores ~100 just like the best in Helsinki, and a score's meaning shifts when you switch regions. Compute fixed national percentile breakpoints once at build time over all 3 018 postal codes, store them as a data artifact, and normalize against them so "72" means the same everywhere (keep the existing `comparisonScope` "within region" toggle as an explicit opt-in). **(D) Persona presets + explainer.** `CustomQualityPanel` currently offers only free-form sliders + reset — ship 5–6 named lenses (Balanced default, Family with children, Young professional / car-free, Student, Retiree, Nature & quiet), cloud-synced via the existing preferences sync, plus a "How is this calculated?" popover on the QualityBadge. Also reconsider the harsh category labels (`Avoid` / `Bad` for postal codes where people actually live) in favour of descriptive, non-pejorative wording. |
| **Why** | This is the product's headline number; if it is not defensible, the product is not defensible. A score that silently equals "how wealthy is this area" is both analytically weak and editorially loaded — it stigmatizes lower-income neighborhoods and tells users little they could not guess from the income layer. A documented, dimension-balanced, nationally-comparable index with honest personas turns the index from a hand-wave into the credible, distinctive core of the product — and makes "naapurustot.fi's quality index" something that can be cited rather than dismissed. |
| **Touches** | `src/utils/qualityIndex.ts` (dimension grouping, default weights, normalization — the core change), `src/components/CustomQualityPanel.tsx` (personas + explainer), `src/components/NeighborhoodPanel.tsx` (QualityBadge explainer + category labels), `src/hooks/useQualityWeights.ts`, `scripts/build_region_data.mjs` or `scripts/prepare_data.py` (build national reference ranges), new `docs/QUALITY_INDEX.md`, `src/locales/{fi,en,sv}.json`, and the ~14 `qualityIndex*.test.ts` suites |
| **Complexity** | Large |
| **Dependencies** | None (preset cloud-sync reuses CF-2 from the prior roadmap, already shipped). High-visibility change — best done on a stable base with Sentry watching. |
| **Tag** | Claude Code (the *methodology choices* and the new category wording warrant a human/editorial review before release) |

### CF-2 User Reviews & Ratings

| | |
|---|---|
| **What** | Logged-in users post a short review (≤ 500 chars) and a 1–5 star rating per neighborhood. Show average rating + count in `NeighborhoodPanel`, on the prerendered profile page, and as an optional `user_rating` map layer. Schema: `reviews (id, user_id, pno, rating, body, created_at, updated_at, status)` with a `pending`/`published`/`hidden` moderation flag. Spam controls: Turnstile-gated submission, one review per user per postal code, 24 h edit window. |
| **Why** | The 58 objective layers already cover the measurable. The missing dimension is lived experience — "what is it *actually* like to live here?" — and it is the single biggest differentiator versus any other Finnish neighborhood tool. The auth, rate-limiting and Turnstile rails were built for exactly this and are currently underused. |
| **Touches** | `server/api/src/db.ts` (+`reviews` table), new `server/api/src/reviews.ts` + mount in `index.ts`, new `src/components/ReviewsSection.tsx`, `src/components/NeighborhoodPanel.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `scripts/prerender.mjs` (render reviews), `src/utils/colorScales.ts` (new `user_rating` layer + `LayerId`), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Large |
| **Dependencies** | None (auth rails exist). |
| **Tag** | Claude Code (a moderation workflow + user-generated-content T&Cs should be agreed before public launch) |

### CF-3 Correlation / Scatter Explorer

| | |
|---|---|
| **What** | A new panel from `ToolsDropdown` ("Explore relationships"): the user picks two of the ~58 metrics; the panel renders a scatter plot — one point per neighborhood, sized by population, coloured by region — with the Pearson coefficient and an optional best-fit line. Hovering a point highlights it on the map. All computation is client-side from the already-loaded data. |
| **Why** | A genuinely net-new analytical capability no Finnish neighborhood tool offers. It answers questions the choropleth cannot — "do low-crime areas cost more?", "does income track air quality?" — and correlation-plot screenshots are highly shareable on social/LinkedIn, a low-cost growth channel. |
| **Touches** | New `src/components/CorrelationExplorer.tsx`, new `src/utils/correlation.ts` (Pearson + axis extraction), `src/components/ToolsDropdown.tsx`, `src/App.tsx` (panel state + map-highlight link), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Region Comparison & Ranking

| | |
|---|---|
| **What** | The ranking table ranks neighborhoods *within* a view; comparison pins up to three *neighborhoods*. Neither works at the **region** level. Add a region view: rank all 69 seutukunnat by any metric (population-weighted aggregates already exist via `region_properties.json` / `computeMetroAverages`), and let users compare whole regions side by side. Surface it from `ToolsDropdown` or the CitySelector. |
| **Why** | The product just went national — 69 regions — but offers no way to ask "which seutukunta has the best transit / lowest unemployment / cheapest housing?". A region-level league table is a natural, low-cost payoff of the national rollout and serves a different audience (people choosing a *city/region*, not yet a street). |
| **Touches** | New `src/components/RegionRanking.tsx` (or extend `RankingTable.tsx`), a region-aggregation util over `src/data/region_properties.json`, `src/components/ToolsDropdown.tsx` / `src/components/CitySelector.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None (national data + region aggregates already shipped) |
| **Tag** | Claude Code |

### CF-5 Isochrone / Travel-Time Overlay

| | |
|---|---|
| **What** | With a neighborhood selected, show a "reachable within X minutes" overlay. The user picks mode (walk / bike / transit) and budget (10/20/30/45 min) in `NeighborhoodPanel`; query the Digitransit Routing API isochrone endpoint, render the polygon as a translucent fill, cache by pno+mode+budget in `sessionStorage`. |
| **Why** | "How far can I get from here in 30 minutes?" is the defining question for commuters and relocators. The existing `transit_reachability` score is a single abstract number; an actual reachable-area polygon is vastly more intuitive, and Digitransit covers essentially all of Finland — so it pays off the national rollout. |
| **Touches** | New `src/utils/isochrone.ts`, new `src/components/IsochroneOverlay.tsx`, `src/components/Map.tsx` (overlay layer), `src/components/NeighborhoodPanel.tsx` (controls), `src/components/ToolsDropdown.tsx`, `src/App.tsx`, `src/locales/{fi,en,sv}.json` |
| **Complexity** | Large |
| **Dependencies** | None (functionally) |
| **Tag** | Manual Setup (Digitransit has required a free subscription API key since 2023 — register at digitransit.fi and provide the key as a build-time env var) |

### CF-6 Email Digest & Neighborhood Alerts

| | |
|---|---|
| **What** | For opted-in, verified, logged-in users: a low-volume (monthly/quarterly) email digest summarizing changes to favorited neighborhoods — income/price movement, new reviews (CF-2), data refreshes. One-click RFC 8058 unsubscribe. Needs a transactional email provider, a server-side cron worker (the `data-refresh.yml` cadence is a natural trigger), and an opt-in toggle in `UserMenu`. |
| **Why** | Retention. Most visitors look at one neighborhood once and never return; favorites sync exists but creates no reason to come back. A digest tied to the data-refresh cycle re-engages exactly the users who explicitly asked to care, and turns favorites from a bookmark into an ongoing thread. |
| **Touches** | `server/api/src/db.ts` (`users.email_digest_opt_in`), new `server/api/src/email.ts`, new digest worker (`server/workers/`), `server/api/src/auth.ts` (unsubscribe route), email templates, `src/components/UserMenu.tsx` |
| **Complexity** | Medium |
| **Dependencies** | PO-3 (email verification) should land first so digests only reach verified addresses; shares `email.ts` with PO-3 |
| **Tag** | Manual Setup (transactional email provider account — Resend/Postmark/SES — plus SPF/DKIM/DMARC DNS records) |

---

## 3 — Polish

UX, edge cases, compliance, quality.

### PO-1 Dynamic Per-Neighborhood OG Images

| | |
|---|---|
| **What** | Every shared profile URL (`/alue/00500-...`) currently gets the same site-wide `og-image.png`. Generate a per-neighborhood social-preview image — name, a small static map thumbnail, the quality index, one headline metric — at build time inside the existing prerender pipeline, written to `public/og/{pno}.png`, with the profile page emitting per-pno `og:image` / `twitter:image` meta. |
| **Why** | The prerender pipeline already emits ~9 000 profile pages × 3 languages; rich link previews drive multiple times the click-through of a generic card across WhatsApp, Slack, LinkedIn. This converts the SEO surface already built into an organic distribution channel at near-zero marginal cost. |
| **Touches** | `scripts/prerender.mjs`, new `scripts/render-og-image.mjs`, new `public/og/` output, profile-page `<meta>` tags, the `build:pages` npm script |
| **Complexity** | Medium |
| **Dependencies** | Benefits from CF-1 (the headline metric on the card should be the redesigned index) but does not block on it |
| **Tag** | Claude Code (build-time generation; no external service) |

### PO-2 Time Slider / Historical Playback

| | |
|---|---|
| **What** | Several metrics already carry 5-year history arrays (`median_income`, `population`, `unemployment_rate`) used only inside per-neighborhood trend charts. Add a time slider below the legend that scrubs earliest → latest year and animates the choropleth across all neighborhoods at once, with a play/pause control. Visible only when a time-series metric is active. |
| **Why** | "How has this area changed over five years?" is evocative and decision-relevant for buyers and planners. The trend data is already fetched and bundled — exposing it *spatially* across the whole map, not just one chart, is a distinctive capability for near-zero data cost. |
| **Touches** | New `src/components/TimeSlider.tsx`, `src/components/Map.tsx` (year-indexed paint expressions), `src/components/Legend.tsx`, `src/utils/metrics.ts` (flag time-series metrics), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-3 Auth UX: Password Reset + Email Verification

| | |
|---|---|
| **What** | Auth has signup/login/logout but no password reset and no email verification. Add: (1) forgot-password (request → signed-token email → reset form), (2) verification on signup (token email; UI shows "verify your email" until clicked), (3) a change-password form in `UserMenu`. |
| **Why** | Baseline hygiene for any production auth system. Without reset, a locked-out user is locked out forever; without verification, digest emails (CF-6) go to mistyped addresses and damage sender reputation. The product stores user data in production today — these are overdue. |
| **Touches** | `server/api/src/auth.ts` (reset/verify routes + token handling), `server/api/src/db.ts` (`email_verified_at`, `password_reset_tokens`), new `server/api/src/email.ts` (shared with CF-6), new `src/pages/ResetPasswordPage.tsx` + `VerifyEmailPage.tsx`, `src/components/AuthModal.tsx`, `src/components/UserMenu.tsx`, `src/main.tsx` (routes) |
| **Complexity** | Medium |
| **Dependencies** | Shares the transactional email provider + `email.ts` with CF-6 |
| **Tag** | Manual Setup (email provider + deliverability DNS) |

### PO-4 GDPR Data Export + Account Deletion

| | |
|---|---|
| **What** | The product stores user data (favorites, notes, preferences, and reviews once CF-2 ships) but offers no export and no deletion. Add to `UserMenu`: (1) "Download my data" → JSON of all stored user data; (2) "Delete my account" with confirmation + a 30-day grace window (soft-delete flag + cascade). Add a `/privacy` page documenting retention and third-party processors. |
| **Why** | GDPR Article 20 (portability) and Article 17 (erasure) are legal requirements for an EU-operated service holding personal data. Far cheaper to build now, while the user-data model is small, than to retrofit later. |
| **Touches** | `server/api/src/index.ts` / `auth.ts` (export + delete routes), `server/api/src/db.ts` (soft-delete + cascade), `src/components/UserMenu.tsx`, new `src/pages/PrivacyPage.tsx`, `src/main.tsx` (route), prerender config |
| **Complexity** | Small–Medium |
| **Dependencies** | CF-2 should land first so the export covers reviews |
| **Tag** | Claude Code (the privacy-policy copy needs legal review before public launch) |

### PO-5 Real-Time Air Quality Layer

| | |
|---|---|
| **What** | HSY publishes hourly air-quality indices per station. When the `air_quality` layer is active in the Helsinki metro, overlay live values instead of the static monthly average and show an "updated X hours ago" badge on the selected neighborhood. Cache 1 h in `localStorage`; fall back to the static average + the existing hatched no-data pattern outside HSY coverage. |
| **Why** | Hourly air quality swings sharply with traffic and weather; a monthly average misses lived experience. A live value makes the app usable for daily decisions ("is it a good day to run in Kallio?") and differentiates it from static dashboards. |
| **Touches** | New `src/utils/airQualityLive.ts` (HSY client), `src/components/Map.tsx` (merge live values when the layer is active), `src/components/NeighborhoodPanel.tsx` (timestamp badge), `src/locales/{fi,en,sv}.json` |
| **Complexity** | Medium |
| **Dependencies** | HSY coverage is Helsinki-metro only — explicitly a regional enhancement, not national |
| **Tag** | Claude Code (HSY's feed is open and keyless; validate endpoint stability/rate limits before rollout) |

---

## 4 — Infrastructure

Not user-facing; unblocks future growth and de-risks operations.

### IN-1 Dependabot

| | |
|---|---|
| **What** | CodeQL, `npm audit` and `pip-audit` already run in CI, but there is **no Dependabot** — nothing opens PRs to actually apply updates. Add `.github/dependabot.yml` for npm (frontend + `server/api/`), pip (data pipeline), Docker (server base images) and GitHub Actions. Constrain load-bearing deps (`@turf/union`, `maplibre-gl`) to patch/minor only — major bumps on those have a CLAUDE.md pitfall history. |
| **Why** | Audits *detect* vulnerable dependencies; Dependabot *fixes* them. Without it, security and maintenance debt accumulates silently across a now four-runtime stack (frontend, Node API, Python pipeline, Docker). Zero cost on a public repo. |
| **Touches** | New `.github/dependabot.yml` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code (committing the file is sufficient; GitHub enables Dependabot automatically) |

### IN-2 API Observability — Metrics, Structured Logs, Off-Site Backup, Uptime

| | |
|---|---|
| **What** | The API has a minimal `/health` and a daily on-droplet `pg_dump`, but no operational visibility. Add: (1) an expanded `/health` reporting DB connectivity + version + uptime; (2) a `/metrics` endpoint (request counts, latency, auth-failure counts); (3) structured JSON request logging; (4) **off-site** backup replication (the current backups live only on the same droplet — a droplet loss loses the data and its backups); (5) an external uptime monitor on `api.naapurustot.fi`. |
| **Why** | The API is in production with real user data and no safety net. If the DB fails, nobody knows until users notice favorites stopped syncing; if the droplet dies, the only backups die with it; a brute-force auth attempt is invisible. This is baseline ops hygiene for a live backend. |
| **Touches** | `server/api/src/index.ts` (health + metrics routes), new `server/api/src/logging.ts`, `server/docker-compose.yml`, `server/backup.sh` (off-site target), uptime-monitor configuration |
| **Complexity** | Medium |
| **Dependencies** | None (Sentry already shipped) |
| **Tag** | Manual Setup (off-site storage bucket — DigitalOcean Spaces / S3 — plus an UptimeRobot or equivalent account; the `/metrics`, `/health` and logging code is Claude Code) |

### IN-3 Trim Deployed Data Artifacts

| | |
|---|---|
| **What** | `public/data/` holds pipeline **inputs** that Vite copies verbatim into the deployed site: `metro_neighborhoods.geojson` (~41 MB — the source-of-truth GeoJSON the app never loads at runtime) and the `*_grid.geojson` files (~5 MB, superseded by their `.topojson` builds). Audit what `dist/` actually ships, then move build-only inputs out of `public/` (e.g. a `data-src/` directory the pipeline and `build:data` read from) so they are not deployed. Also note the ~10 MB `src/data/region_properties.json` powering the "all cities" view as a payload-size watch item. |
| **Why** | ~46 MB of dead weight is copied into every GitHub Pages deploy — slower deploys, wasted bandwidth, and raw source data needlessly exposed at `/data/` (only weakly hidden by a `robots.txt` disallow). Cleanly separating pipeline inputs from shipped assets removes the footgun and shrinks the deploy. |
| **Touches** | `vite.config.ts` (publicDir / copy config), `public/data/` → new `data-src/` (or similar), `scripts/*` that read those inputs, `.gitignore`, `.github/workflows/deploy.yml` |
| **Complexity** | Small–Medium |
| **Dependencies** | None — verify each file is truly unused at runtime before moving it |
| **Tag** | Claude Code |

---

## Suggested Sequencing

Items within a batch are **logically independent** — no item depends on or breaks
another in the same batch — so they are safe to run as parallel Claude Code
sessions. Where two items append to the same hub file (`App.tsx`, `ToolsDropdown.tsx`,
the locale JSON, or a server file), the conflict is **mechanical, not logical**;
those pairs are called out with a merge order. Batches run sequentially: batch
N+1 assumes batch N is merged.

### Batch 1 — Trust, Reach & Hygiene

Six fully parallel sessions. None changes core application logic, so this batch
de-risks everything after it.

| Item | Category | Complexity | Tag |
|------|----------|-----------|-----|
| QW-1 Build-derived data-freshness timestamp | Quick Win | Small | Claude Code |
| QW-3 Geolocation — "show my area" | Quick Win | Small | Claude Code |
| QW-4 Finish accessibility (MiniMap + axe-core) | Quick Win | Small | Claude Code |
| PO-1 Dynamic per-neighborhood OG images | Polish | Medium | Claude Code |
| IN-1 Dependabot | Infrastructure | Small | Claude Code |
| IN-3 Trim deployed data artifacts | Infrastructure | Small–Medium | Claude Code |

> **Why first:** correct data-freshness (trust), a finished accessibility story
> (compliance), automated dependency updates (security), a leaner deploy
> (IN-3), social-preview reach (PO-1) and a personal entry point (QW-3) — all
> before any new application surface is added.
>
> **File map:** QW-1 → `build_region_data.mjs`, `dataLoader.ts`/`useMapData.ts`,
> `SettingsDropdown.tsx`, locales · QW-3 → `SearchBar.tsx`, `geocode.ts`/`geometryFilter.ts`,
> `App.tsx`, locales · QW-4 → `profile/MiniMap.tsx`, `e2e/`, `ci.yml`, `package.json`
> · PO-1 → `prerender.mjs`, new `render-og-image.mjs`, `public/og/`, profile meta
> · IN-1 → new `.github/dependabot.yml` · IN-3 → `vite.config.ts`, `public/data/`,
> `.gitignore`, `deploy.yml`.
>
> **Parallel safety:** QW-3 is the only batch-1 item touching `App.tsx`. QW-1 and
> QW-3 both append locale keys (trivial). No other overlap.

### Batch 2 — The Quality Index Redesign

Three parallel sessions with zero file overlap (locale appends aside).

| Item | Category | Complexity | Tag |
|------|----------|-----------|-----|
| CF-1 Quality Index methodology — defensible default | Core Feature | Large | Claude Code |
| QW-2 Keyboard shortcuts + `?` overlay | Quick Win | Small | Claude Code |
| PO-2 Time slider / historical playback | Polish | Medium | Claude Code |

> **Why second:** CF-1 reworks the **default map layer** — the most visible
> change in this roadmap — so it should land on the stable, observable base from
> batch 1, with shipped Sentry catching any regression. QW-2 and PO-2 are
> independent UX wins that fill the batch without touching CF-1's files.
>
> **File map:** CF-1 → `qualityIndex.ts`, `CustomQualityPanel.tsx`,
> `NeighborhoodPanel.tsx`, `useQualityWeights.ts`, `build_region_data.mjs`, new
> `docs/QUALITY_INDEX.md`, `qualityIndex*.test.ts`, locales · QW-2 → `App.tsx`,
> new `ShortcutsOverlay.tsx`, `SettingsDropdown.tsx`, locales · PO-2 → new
> `TimeSlider.tsx`, `Map.tsx`, `Legend.tsx`, `metrics.ts`, locales.
>
> **Parallel safety:** the three items touch disjoint components. Only locale
> JSON is shared (mechanical).

### Batch 3 — Backend Differentiators, Analysis Tools & Compliance

Four sessions, two mechanical-conflict pairs (noted below).

| Item | Category | Complexity | Tag |
|------|----------|-----------|-----|
| CF-2 User reviews & ratings | Core Feature | Large | Claude Code |
| CF-3 Correlation / scatter explorer | Core Feature | Medium | Claude Code |
| CF-4 Region comparison & ranking | Core Feature | Medium | Claude Code |
| PO-4 GDPR data export + account deletion | Polish | Small–Medium | Claude Code |

> **Why third:** reviews (CF-2) is the lived-experience layer the backend was
> built for and the product's biggest differentiator; CF-3 and CF-4 are net-new
> analysis tools; PO-4 closes the compliance gap and wants reviews to exist so
> the export is complete.
>
> **File map:** CF-2 → `db.ts` + new `reviews.ts` + `index.ts`, new
> `ReviewsSection.tsx`, `NeighborhoodPanel.tsx`, `NeighborhoodProfilePage.tsx`,
> `prerender.mjs`, `colorScales.ts`, locales · CF-3 → new `CorrelationExplorer.tsx`
> + `correlation.ts`, `ToolsDropdown.tsx`, `App.tsx`, locales · CF-4 → new
> `RegionRanking.tsx`, region-aggregation util, `ToolsDropdown.tsx`/`CitySelector.tsx`,
> `App.tsx`, locales · PO-4 → `index.ts`/`auth.ts`, `db.ts`, `UserMenu.tsx`, new
> `PrivacyPage.tsx`, `main.tsx`.
>
> **Parallel safety:** **(a)** CF-2 & PO-4 both touch `server/api/src/db.ts` and
> `index.ts` — sequence **CF-2 before PO-4** so the GDPR export covers reviews.
> **(b)** CF-3 & CF-4 both add a tool to `ToolsDropdown.tsx` and panel state to
> `App.tsx` — sequence them; both edits are additive. No logical coupling in
> either pair.

### Batch 4 — External-Service Features & Operations

Five sessions, two mechanical-conflict pairs (noted below). This is the
external-dependency batch — most operationally heavy, so it runs last on a fully
stable base.

| Item | Category | Complexity | Tag |
|------|----------|-----------|-----|
| CF-5 Isochrone / travel-time overlay | Core Feature | Large | Manual Setup |
| CF-6 Email digest & neighborhood alerts | Core Feature | Medium | Manual Setup |
| PO-3 Auth UX: password reset + email verification | Polish | Medium | Manual Setup |
| PO-5 Real-time air quality layer | Polish | Medium | Claude Code |
| IN-2 API observability (metrics, logs, backup, uptime) | Infrastructure | Medium | Manual Setup |

> **Why last:** every item here needs an external account or service —
> Digitransit API key (CF-5), a transactional email provider (CF-6, PO-3),
> off-site storage + an uptime monitor (IN-2) — or external-API validation
> (PO-5). All benefit from the stable, observable foundation of batches 1–3.
>
> **File map:** CF-5 → new `isochrone.ts` + `IsochroneOverlay.tsx`, `Map.tsx`,
> `NeighborhoodPanel.tsx`, `ToolsDropdown.tsx`, `App.tsx`, locales · CF-6 →
> `db.ts`, new `email.ts` + digest worker, `auth.ts`, `UserMenu.tsx`, templates ·
> PO-3 → `auth.ts`, `db.ts`, new `email.ts`, new `ResetPasswordPage.tsx` +
> `VerifyEmailPage.tsx`, `AuthModal.tsx`, `UserMenu.tsx`, `main.tsx` · PO-5 → new
> `airQualityLive.ts`, `Map.tsx`, `NeighborhoodPanel.tsx`, locales · IN-2 →
> `index.ts`, new `logging.ts`, `docker-compose.yml`, `backup.sh`.
>
> **Parallel safety:** **(a)** CF-6 & PO-3 share `server/api/src/email.ts`,
> `db.ts`, `auth.ts` and `UserMenu.tsx` — sequence **PO-3 first** so it scaffolds
> `email.ts`, then CF-6 builds the digest template on top (PO-3's email
> verification is also a soft prerequisite for CF-6). **(b)** CF-5 & PO-5 both
> touch `Map.tsx` and `NeighborhoodPanel.tsx` — sequence them; the edits are
> additive (a new overlay layer vs. a live-value merge). IN-2 touches only
> `server/api/src/index.ts` among the shared files and is otherwise isolated.

---

## Completed since the 2026-04-13 Roadmap

These items from the previous roadmap have shipped and are intentionally **not**
carried forward:

| Prev ID | Item | Evidence |
|---|---|---|
| CF-5 | Full-Finland coverage via seutukunta alignment | All 69 seutukunnat in `regions.ts` with ingested per-region TopoJSON; `region_coverage.json` + CitySelector coverage badges; `seutukunnat.topojson` outline |
| CF-3 | Swedish language support | `sv.json`, FI/EN/SV picker, SV prerender routes |
| CF-2 | Cloud-synced filter & quality presets | `user_preferences` table, `/auth/preferences`, `useQualityWeights`, `useFilterPresets(userId)` |
| CF-8 | Multi-neighborhood PDF report | `exportComparisonPdf()` in `export.ts` |
| QW-1 | Onboarding tour | `OnboardingTour.tsx` (5 steps), first-visit gated |
| QW-4 | Skip link + chart ARIA | Skip link in `index.html`; `role="img"` + `aria-label` on `RadarChart`/`TrendChart` (MiniMap remains — see QW-4 above) |
| QW-5 | Explain-this-metric tooltips | `METRIC_EXPLANATIONS` + `METRIC_SOURCES` in `metrics.ts`, info popovers in `NeighborhoodPanel` |
| QW-6 | Cloud-synced notes | `user_notes` table, `/auth/notes`, `useNotes(userId)` |
| QW-7 | Embed mode | `embed.ts`, `IS_EMBED`, `buildEmbedSnippet`, watermark, "copy embed" in settings |
| IN-1 | Sentry (frontend + backend) | `@sentry/react` + `@sentry/node`, `server/api/src/instrument.ts` |
| IN-2 | Core Web Vitals monitoring | `web-vitals` dep, `src/utils/webVitals.ts` |
| IN-3 | Lighthouse CI | `lighthouserc.cjs`, Lighthouse job in `ci.yml` |
| IN-4 (part) | Security scanning | CodeQL (`codeql.yml`), `npm audit` + `pip-audit` in CI — **Dependabot still missing → IN-1 above** |
| — | SEO/GEO expansion | Regional hub prerendering (`prerender-hubs.mjs`), `llms.txt`/`llms-full.txt`, expanded JSON-LD |

**Partially shipped — folded into this roadmap with reduced scope:** QW-3 Data
Freshness (a label exists but is hardcoded → QW-1), PO-1 WCAG audit (Lighthouse
a11y gate live; MiniMap + axe-core remain → QW-4), PO-2 Dynamic OG Images
(carried as PO-1), IN-5 API Observability (`/health` + on-droplet backups exist;
metrics/logs/off-site backup/uptime remain → IN-2).

**Carried forward unchanged:** CF-1 Reviews (→ CF-2), CF-4 Correlation Explorer
(→ CF-3), CF-6 Isochrone (→ CF-5), CF-7 Email Digest (→ CF-6), QW-2 Keyboard
Shortcuts (→ QW-2), PO-4 Time Slider (→ PO-2), PO-5 Auth UX (→ PO-3), PO-6 GDPR
(→ PO-4), PO-3 Real-Time Air Quality (→ PO-5).
