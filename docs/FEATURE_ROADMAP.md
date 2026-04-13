# naapurustot.fi — Feature Roadmap

> Generated 2026-04-13 from full codebase analysis following a major architectural upgrade.
> Replaces the previous roadmap. A **Completed** section at the bottom lists items from earlier roadmaps that have now shipped.

---

## Project Context

naapurustot.fi is a neighborhood-level data explorer for Finnish cities — a React/TypeScript SPA with prerendered per-neighborhood profile pages, a MapLibre GL choropleth of 54 data layers, and as of recently a **full Express + PostgreSQL backend** providing optional user accounts, cloud-synced favorites, and self-hosted Umami analytics.

**Recent architectural upgrade (since the previous roadmap):**

- **Backend shipped** (`server/api/`): Node 22 + Express + PostgreSQL 16 behind Caddy. Endpoints for signup/login/logout (JWT cookies, bcrypt, Turnstile CAPTCHA on signup), per-user favorites (`user_favorites` table), rate limiting. Deployed to DigitalOcean at `api.naapurustot.fi` via `deploy-server.yml`.
- **Auth UI shipped** (`AuthModal.tsx`, `UserMenu.tsx`, `Turnstile.tsx`, `useAuth.ts`). Optional — everything works anonymously with localStorage fallback.
- **Pretty URLs + SEO prerendering shipped** (`scripts/prerender.mjs`, `scripts/generate-sitemap.mjs`, `src/pages/NeighborhoodProfilePage.tsx`, `src/utils/slug.ts`). Every neighborhood has a static HTML page at `/alue/{pno}-{slug}` (FI) and `/en/area/{pno}-{slug}` (EN) with JSON-LD, sitemap, hreflang.
- **Analytics shipped**: Umami self-hosted at `analytics.naapurustot.fi`. Script tag in `index.html`, event tracking via `src/utils/analytics.ts`.
- **Region-split TopoJSON**: `src/data/regions/helsinki_metro.topojson` / `turku.topojson` / `tampere.topojson` loaded on demand. "All cities" view uses `@turf/union` (lazy-loaded chunk, mandatory dependency per CLAUDE.md pitfalls).
- **Grid layers shipped**: Air quality grid (~2.4 MB), light pollution grid (~2.8 MB), transit reachability grid — all lazy-loaded with silent fallback to choropleth.
- **Frontend features shipped**: POI overlay fully wired, split map, ranking table, wizard, draw tool, radar chart, sparklines, empty states, keyboard-Escape handling, filter presets ("Families", "Commuters"), customizable quality index, colorblind palettes, mobile bottom sheets, PWA.

**Regions:** 22 region IDs are defined in `src/utils/regions.ts`. Only 3 have data today (Helsinki metro, Turku, Tampere). The remaining 19 (Oulu, Jyväskylä, Lahti, Kuopio, Pori, etc.) are scaffolded but un-ingested.

**Tech stack:** React 19.2, React Router 7.13, TypeScript 5.9, Vite 8, MapLibre GL 5.20, Turf.js 7.3, Tailwind 3, Vitest, Playwright, Node 22, Express, PostgreSQL 16, Docker Compose, Caddy.

**What the backend unlocks (but hasn't yet been built on top of):** user reviews, cloud-synced notes + filter + quality presets, email digests, neighborhood alerts, password reset / email verify flows, GDPR data export/delete. The auth rails exist; the features on top of them don't.

---

## 1 — Quick Wins

Small effort, noticeable improvement for users.

### QW-1 Onboarding Tour for First-Time Visitors

| | |
|---|---|
| **What** | 4–5 step highlight overlay on first visit only (tracked via localStorage key `naapurustot-onboarding-seen`). Steps: (1) layer selector — "54 data layers across 8 categories", (2) search bar + region switcher — "search by name, postal code, address, or switch cities", (3) click a neighborhood — "explore the full profile", (4) tools dropdown — "filter, compare, rank, draw, wizard, split view", (5) sign-in — "create an account to sync favorites across devices". Portal-based, no library. |
| **Why** | The app has eight powerful tools (wizard, filter, comparison, draw, split map, ranking, POI overlay, custom quality index) + auth. New users discover maybe two of them before bouncing. A single lightweight tour fixes the biggest feature-discovery hole in the app. |
| **Touches** | New `src/components/OnboardingTour.tsx`, `src/App.tsx` (first-visit check + conditional render), `src/locales/fi.json` + `src/locales/en.json` (step labels) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Keyboard Shortcuts + Overlay

| | |
|---|---|
| **What** | Extend the current Escape-only handling to power-user shortcuts. `?` opens a shortcuts modal listing all bindings: `/` focus search, `1`–`8` switch layer category, `F` filter, `C` comparison, `R` ranking, `W` wizard, `D` draw, `S` split map, `L` sign-in, `[` / `]` previous/next neighborhood in current filter or ranking. New `src/components/ShortcutsOverlay.tsx`. |
| **Why** | Eight toggleable tools currently require mouse. Power users (relocation advisors, real estate agents) get dramatic workflow speedup. Many users browse on laptops; keyboard is faster than navigating nested dropdowns. |
| **Touches** | `src/App.tsx` (global keydown handler + shortcut overlay state), new `src/components/ShortcutsOverlay.tsx`, `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-3 Data Freshness Indicator

| | |
|---|---|
| **What** | Embed `_metadata.updated: "2026-04-01"` into each region TopoJSON during `npm run build:data` (in `scripts/build_region_data.mjs`). Surface as a "Data updated: April 2026" label in the footer or settings dropdown. Keep the existing `METRIC_SOURCES` per-metric source info icons in NeighborhoodPanel as they are. |
| **Why** | Users making real decisions (home purchase, relocation) need to know data currency. A missing or old timestamp erodes trust. Per-metric sources already exist; a global "data updated" timestamp is the one thing missing. |
| **Touches** | `scripts/build_region_data.mjs` (embed timestamp into each region file), `src/utils/dataLoader.ts` or `src/hooks/useMapData.ts` (extract metadata), `src/components/SettingsDropdown.tsx` or footer, `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-4 Skip-to-Content Link + Chart ARIA Descriptions

| | |
|---|---|
| **What** | Add a visually-hidden skip-to-content link as the first interactive element in `index.html` (visible on focus, jumps to `#main`). Add `role="img"` + generated `aria-label` / `aria-describedby` to `RadarChart.tsx` and `TrendChart.tsx` (e.g., "Radar chart for Kallio: safety 72, income 68, employment 81, education 58, transit 92, services 85 — strongest: transit, services"). |
| **Why** | Finland's accessibility legislation (EU Web Accessibility Directive) requires WCAG 2.1 AA for public information services. Skip links and chart ARIA are two of the most common flags; both are 30-minute fixes. Improves Lighthouse a11y as a side effect. |
| **Touches** | `index.html` (skip link markup), `src/index.css` (skip-link focus styles), `src/components/RadarChart.tsx`, `src/components/TrendChart.tsx` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-5 Explain-This-Metric Tooltips

| | |
|---|---|
| **What** | Extend the existing info-icon pattern in NeighborhoodPanel with plain-language one-liners describing what each metric actually means (e.g., "unemployment_rate — share of working-age residents registered as unemployed. Lower is better for labor market vitality"). Store explanations as a new `METRIC_EXPLANATIONS` map in `src/utils/metrics.ts` alongside the existing `METRIC_SOURCES`. Show on click/tap of the info icon (currently the icon shows source only). |
| **Why** | 54 data layers, many with technical names (`price_to_rent`, `foreign_language_pct`, `transit_reachability`, `light_pollution`). Without definitions users misread or ignore metrics. Explanations live next to the data, not in a separate glossary page. |
| **Touches** | `src/utils/metrics.ts` (new explanation map + i18n keys), `src/components/NeighborhoodPanel.tsx` (info popover content), `src/locales/*.json` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-6 Cloud-Synced Notes

| | |
|---|---|
| **What** | Notes are currently localStorage-only (`src/hooks/useNotes.ts`). Favorites are already cloud-synced for logged-in users (pattern in `src/utils/api.ts` — `getFavorites` / `saveFavorites`). Replicate that pattern for notes: add `user_notes` Postgres table (`user_id`, `pno`, `note`, `updated_at`), API endpoints `GET/PUT /api/notes`, merge logic on login (server + local wins by `updated_at`), debounced save. |
| **Why** | Favorites sync across devices, notes don't — inconsistent. Anyone keeping structured notes on neighborhoods (common for relocators or investors) can lose them when switching devices. Cheap to ship given the favorites-sync pattern is already proven. |
| **Touches** | `server/api/src/db.ts` (schema + migration), `server/api/src/index.ts` (routes), new migration under `server/db-init/`, `src/utils/api.ts` (client), `src/hooks/useNotes.ts` (merge + sync), possibly `server/api/src/rateLimit.ts` |
| **Complexity** | Small–Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-7 Embed Mode (iframe Support)

| | |
|---|---|
| **What** | Support a `?embed=1&layer=median_income&pno=00100` URL flag that strips chrome (header, tools dropdown, settings, user menu), expands the map to full viewport, and adds a small "naapurustot.fi" attribution watermark linking back. Include a "Copy embed code" option in SettingsDropdown that generates an iframe snippet. |
| **Why** | Distribution channel. Real estate sites, blogs, local news, and community forums get an interactive neighborhood widget for free; every embed is a branded backlink. Costs nothing — same static build. |
| **Touches** | `src/App.tsx` (read `embed` param, conditionally render chrome), `src/components/SettingsDropdown.tsx` (embed snippet generator), `src/index.css` (embed styles) |
| **Complexity** | Small–Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

---

## 2 — Core Features

Meaningful additions that make the product more complete.

### CF-1 User Reviews & Ratings

| | |
|---|---|
| **What** | Logged-in users can post a short review (max 500 chars) and a 1–5 star rating for any neighborhood. Display average rating on the neighborhood profile page and as an optional map layer ("User rating"). Schema: `reviews (id, user_id, pno, rating, body, created_at, updated_at, status)` with moderation flag (`pending` / `published` / `hidden`). Basic spam protection: Turnstile-gated submission, 1 review per user per pno, 24 h edit window. |
| **Why** | This is the flagship backend-enabled feature. Objective data (income, crime, air quality) is already covered by the existing 54 layers. Lived-experience signal — "what's it actually like to live here?" — is the major missing dimension and the single biggest differentiator vs any existing Finnish neighborhood tool. |
| **Touches** | `server/api/src/db.ts` + new migration, `server/api/src/index.ts` (routes), possibly new `server/api/src/reviews.ts`, new `src/components/ReviewsSection.tsx`, `src/pages/NeighborhoodProfilePage.tsx` (render reviews), `src/components/NeighborhoodPanel.tsx` (show avg rating + review count), `src/utils/colorScales.ts` (add user_rating layer), moderation dashboard |
| **Complexity** | Large |
| **Dependencies** | None (auth rails exist) |
| **Tag** | Claude Code (but the moderation strategy + legal T&Cs for user-generated content should be reviewed before public launch) |

### CF-2 Cloud-Synced Filter & Quality Presets

| | |
|---|---|
| **What** | Filter presets (from `useFilterPresets`) and custom quality-index weight presets (from `CustomQualityPanel`) are localStorage-only today. Extend the existing favorites/notes sync pattern to both. Schema: `user_preferences (user_id, filter_presets_json, quality_presets_json, updated_at)`. Users can now maintain their saved criteria across devices and share preset JSONs via URL. |
| **Why** | The filter and quality-index customization are among the deepest features in the app; saved presets are what turn first-time exploration into repeat usage. Device-locked presets feel broken once a user has signed in and seen favorites sync. |
| **Touches** | `server/api/src/db.ts` + migration, `server/api/src/index.ts` (routes), `src/utils/api.ts`, `src/hooks/useFilterPresets.ts`, `src/components/CustomQualityPanel.tsx` (persona presets + sync), new `src/hooks/useQualityPresets.ts` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-3 Swedish Language Support

| | |
|---|---|
| **What** | Add Swedish as a third UI language (FI/EN/SV). GeoJSON already has `namn` (Swedish neighborhood name). Create `src/locales/sv.json` mirroring `fi.json` + `en.json` structure. Add `'sv'` to the `Lang` union in `src/utils/i18n.ts`. Update `SettingsDropdown.tsx` to a three-option picker. Route prerendering creates `/sv/omrade/{pno}-{slug}` pages with `hreflang="sv"`. `SearchBar` and `NeighborhoodProfilePage` use `namn` when lang is `sv`. |
| **Why** | Swedish is an official Finnish language, widely spoken in Espoo, Kauniainen, Turku, and coastal areas. Name data already exists. The prerendering pipeline is proven — adding a third locale is incremental work with meaningful audience reach and a clear inclusivity signal. |
| **Touches** | New `src/locales/sv.json`, `src/utils/i18n.ts`, `src/components/SettingsDropdown.tsx`, `src/components/SearchBar.tsx`, `src/pages/NeighborhoodProfilePage.tsx`, `scripts/prerender.mjs` (add SV route), `scripts/generate-sitemap.mjs` (add SV URLs + hreflang), `index.html` |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code (initial translations can be generated; recommend native-speaker review before release) |

### CF-4 Correlation / Scatter Explorer

| | |
|---|---|
| **What** | New panel opened via ToolsDropdown ("Explore relationships"). User picks two metrics; panel renders a scatter plot with each point = one neighborhood, sized by population, colored by region. Hovering a point highlights the neighborhood on the map. Displays Pearson correlation coefficient and optional best-fit line. All computation client-side from the already-loaded GeoJSON. |
| **Why** | Net-new analytical capability not offered by any existing Finnish neighborhood tool. Answers questions like "does higher income correlate with better air quality?", "are low-crime areas more expensive?". Strong shareability on social / LinkedIn — screenshots of correlation plots get traction. |
| **Touches** | New `src/components/CorrelationExplorer.tsx`, new `src/utils/correlation.ts` (Pearson + axis extraction), `src/components/ToolsDropdown.tsx` (toggle), `src/App.tsx` (panel state + map highlight link) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-5 Complete Finnish Cities Rollout

| | |
|---|---|
| **What** | `src/utils/regions.ts` defines 22 regions; only 3 have data (Helsinki metro, Turku, Tampere). Extend the data pipeline (`scripts/prepare_data.py`, `scripts/build_region_data.mjs`) to ingest Oulu, Jyväskylä, Lahti, Kuopio, Pori next (priority by population). Each region requires postal-code geometry (Statistics Finland WFS) + Paavo data + Overpass POIs + HSY/Police/Traficom where available. Prerendering + sitemap automatically pick up new regions. |
| **Why** | The biggest step-change in addressable users available to the product. The infrastructure (per-region lazy loading, sitemap generation, regional SEO pages) already handles arbitrary regions — this is pure data-pipeline work. Oulu + Jyväskylä alone add ~350 k residents; all 5 together add ~1M. |
| **Touches** | `scripts/prepare_data.py` (add region configs), `scripts/build_region_data.mjs` (new region outputs), new `src/data/regions/*.topojson` files, sitemap regeneration, per-region bundle size validation |
| **Complexity** | Large |
| **Dependencies** | None (but note: some metrics — HSL transit access, HSY air quality — are Helsinki-only and must fall back gracefully via the existing hatched-missing-data pattern) |
| **Tag** | Manual Setup (data pipeline run for each new city + manual verification that city-specific data sources work) |

### CF-6 Isochrone / Travel Time Visualization

| | |
|---|---|
| **What** | When a neighborhood is selected, show a "reachable within X minutes" overlay. User picks mode (walk / bike / transit) and time budget (10/20/30/45 min) from the NeighborhoodPanel. Query Digitransit Routing API (`/v2/{router}/index/graphql` isochrone query), render the polygon as a semi-transparent fill. Cache by pno+mode+budget in sessionStorage. |
| **Why** | "How far can I get from here in 30 minutes by transit?" is the #1 question for commuters and relocators. The existing `transit_reachability` score is a single number; an actual polygon is vastly more intuitive. Also ties into CF-5 — isochrones work anywhere in Finland that Digitransit covers, which is nearly everywhere. |
| **Touches** | New `src/utils/isochrone.ts`, new `src/components/IsochroneOverlay.tsx`, `src/components/Map.tsx` (isochrone layer), `src/components/NeighborhoodPanel.tsx` (controls), `src/locales/*.json` |
| **Complexity** | Large |
| **Dependencies** | None (Digitransit is free; anonymous access works for current traffic levels) |
| **Tag** | Manual Setup (Digitransit API key registration recommended for production rate limits) |

### CF-7 Email Digest & Neighborhood Alerts

| | |
|---|---|
| **What** | For opted-in logged-in users: monthly email digest summarizing changes to their favorited neighborhoods (income change, price change, new reviews, data refresh). One-click unsubscribe. Requires a transactional email provider (Resend, Postmark, or AWS SES), a server-side cron job (already have `data-refresh.yml` monthly cadence), an opt-in toggle in UserMenu, and a minimal HTML email template. |
| **Why** | Retention driver. One-time users open the site, look at one neighborhood, and don't return. A low-volume (monthly) digest creates a re-engagement loop tied to the monthly data refresh — when new data arrives, the users who explicitly care get notified. Ties favorites sync to real ongoing value. |
| **Touches** | `server/api/src/db.ts` (`users.email_digest_opt_in`, `users.email_verified_at`), `server/api/src/index.ts` (unsubscribe route), new `server/api/src/email.ts`, new `server/workers/send-digests.ts`, email templates, `src/components/UserMenu.tsx` (opt-in toggle) |
| **Complexity** | Medium |
| **Dependencies** | PO-5 (email verification) should land first so digests only go to verified addresses |
| **Tag** | Manual Setup (email provider account, SPF/DKIM/DMARC DNS configuration, unsubscribe header compliance per RFC 8058) |

### CF-8 Multi-Neighborhood PDF Report

| | |
|---|---|
| **What** | Extend the existing single-neighborhood PDF export to 2–3 pinned neighborhoods. One page per neighborhood + a summary page with side-by-side tables and overlaid radar (multi-dataset RadarChart already supports this). Button in `ComparisonPanel.tsx` alongside CSV export. Uses existing print-optimized CSS. |
| **Why** | Real estate agents and relocation advisors use single-neighborhood PDFs today. The comparison panel is their natural next step; currently they must export each separately. A 30–60 min extension with high professional-user value. |
| **Touches** | `src/components/ComparisonPanel.tsx` (export button + assembly), `src/utils/export.ts` (multi-section PDF generation), `src/index.css` (print styles) |
| **Complexity** | Small–Medium |
| **Dependencies** | None (CF-4 radar overlay already shipped per previous roadmap) |
| **Tag** | Claude Code |

---

## 3 — Polish

UX improvements, edge case handling, compliance, quality.

### PO-1 Full WCAG 2.2 AA Accessibility Audit

| | |
|---|---|
| **What** | Run axe-core + Lighthouse against every major state (default, panel open, comparison, filter, wizard, draw, dark mode, mobile, colorblind modes, EN locale). Fix identified issues. Common gaps to check: (1) color contrast on Tailwind slate/neutral utilities in dark mode, (2) focus-visible ring on map overlay controls and close buttons, (3) screen-reader announcements for filter match count + layer switch, (4) table `<th>` scopes in RankingTable, (5) form labels in FilterPanel sliders, (6) focus trap in AuthModal and other modals, (7) aria-current on active nav/layer, (8) alt text on the MiniMap SVG. |
| **Why** | EU Web Accessibility Directive applies. Beyond compliance, every a11y improvement benefits all users: better contrast helps outdoor visibility, focus rings help keyboard users + screencast viewers, descriptive labels help voice control + screen readers equally. |
| **Touches** | Many components (contrast), `src/App.tsx` (focus trap helpers), `src/components/FilterPanel.tsx`, `src/components/RankingTable.tsx`, `src/components/AuthModal.tsx`, `src/components/profile/MiniMap.tsx`, `src/index.css` (focus styles), new axe-core integration into e2e tests |
| **Complexity** | Medium |
| **Dependencies** | QW-4 (skip link + chart ARIA) should land first |
| **Tag** | Claude Code |

### PO-2 Dynamic OG Images per Neighborhood

| | |
|---|---|
| **What** | When a prerendered profile URL like `/alue/00500-kallio` is shared on WhatsApp, Slack, LinkedIn, or Twitter, generate a rich preview image showing: neighborhood name, a small static map thumbnail, quality index score, one headline metric. Options: (a) Cloudflare Worker with `@vercel/og`, (b) Node script in `scripts/prerender.mjs` that renders OG images at build time into `public/og/{pno}.png`. Option (b) fits the existing prerendering pipeline cleanly. |
| **Why** | Link previews drive multiple-times more click-throughs than plain URLs. The prerendering pipeline already produces a per-neighborhood HTML page; extending it to emit a per-neighborhood OG image is a natural fit. Currently every shared link gets the same static thumbnail. |
| **Touches** | `scripts/prerender.mjs` (OG image generation step), new `scripts/render-og-image.mjs` (puppeteer or `@vercel/og`), `public/og/` directory output, profile page `<meta property="og:image">` per-pno values |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code (build-time option) OR Manual Setup (Cloudflare Worker option needs external deployment) |

### PO-3 Real-Time Air Quality Layer

| | |
|---|---|
| **What** | HSY publishes hourly air quality index per sensor station. Replace the static `air_quality_index` monthly average with a live value when the air_quality layer is active. Show a "updated X hours ago" badge on the selected neighborhood. Fall back to monthly average + hatched pattern where the API is unreachable or coverage is sparse. Cache 1 h in localStorage. |
| **Why** | Hourly AQ changes dramatically with weather and traffic; monthly averages miss lived experience. Live data makes the app usable for daily decisions (should I run outdoors in Kallio today?). Differentiates vs static dashboards. |
| **Touches** | New `src/utils/airQualityLive.ts` (HSY API client), `src/components/Map.tsx` (merge live values when layer is active), `src/components/NeighborhoodPanel.tsx` (timestamp badge), possibly error handling in a11y announcements |
| **Complexity** | Medium |
| **Dependencies** | None (CF-5 if non-Helsinki cities need equivalent live sources — HSY coverage is Helsinki metro only) |
| **Tag** | Manual Setup (HSY API endpoint stability + rate limits validation in staging before production rollout) |

### PO-4 Time Slider / Historical Playback

| | |
|---|---|
| **What** | For metrics with trend data (`median_income`, `population`, `unemployment_rate` — 5-year arrays already in the GeoJSON), add a time slider below the legend that scrubs earliest → latest year. Dragging animates choropleth colors year-by-year. Play/pause button for auto-play. Only visible when a time-series metric is active. |
| **Why** | "How has this neighborhood changed over the last 5 years?" is evocative and weighty for home buyers and city planners. Trend data is already fetched but surfaced only inside per-neighborhood charts — exposing it spatially across all neighborhoods at once is a distinctive capability. |
| **Touches** | New `src/components/TimeSlider.tsx`, `src/components/Map.tsx` (dynamic style expressions indexed by year), `src/components/Legend.tsx` (slider placement), `src/utils/metrics.ts` (flag time-series metrics) |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Auth UX: Password Reset + Email Verification

| | |
|---|---|
| **What** | The current auth flow has signup/login/logout but no password reset and no email verification. Add: (1) "Forgot password" flow (request → email with signed token → reset form → new password), (2) email verification on signup (verification token sent on signup, UI state shows "verify your email" until clicked), (3) change-password form in UserMenu. Verification required before email digests (CF-7) can be sent. |
| **Why** | Any production auth system needs these. Without password reset, users locked out forever. Without email verification, digest emails go to mistyped addresses and hurt deliverability (SPF/DKIM reputation). Baseline hygiene for a live auth product. |
| **Touches** | `server/api/src/auth.ts` (reset + verify endpoints + token handling), `server/api/src/db.ts` (`users.email_verified_at`, `password_reset_tokens` table), new `server/api/src/email.ts`, new reset/verify routes/pages, `src/components/AuthModal.tsx` + new `src/components/ResetPasswordPage.tsx` + `src/components/VerifyEmailPage.tsx`, `src/components/UserMenu.tsx` (change password) |
| **Complexity** | Medium |
| **Dependencies** | Needs a transactional email provider (shared with CF-7) |
| **Tag** | Manual Setup (email provider + DNS records for deliverability) |

### PO-6 GDPR Data Export + Account Deletion

| | |
|---|---|
| **What** | Required now that user data is stored. In UserMenu add: (1) "Download my data" button that exports JSON of user's favorites, notes (if synced), reviews (if CF-1 shipped), preferences (if CF-2 shipped); (2) "Delete my account" button with confirmation + 30-day grace window. Document data retention and third-party processors in a `/privacy` page. |
| **Why** | GDPR Article 20 (portability) and Article 17 (right to be forgotten) apply. For any EU-operated service storing user data these are legal requirements. Easier to build in while the user data model is small than to retrofit later. |
| **Touches** | `server/api/src/index.ts` (export + delete routes), `server/api/src/db.ts` (soft-delete flag + cascade), `src/components/UserMenu.tsx`, new `src/pages/PrivacyPage.tsx`, prerendering configuration for privacy page |
| **Complexity** | Small–Medium |
| **Dependencies** | CF-1 (reviews), CF-2 (preset sync) ideally landed so the export covers all user data types |
| **Tag** | Claude Code (the privacy policy copy needs legal review before public launch) |

---

## 4 — Infrastructure

Not user-facing but unblocks future growth.

### IN-1 Sentry Error Tracking (Frontend + Backend)

| | |
|---|---|
| **What** | Frontend: add `@sentry/react` to `src/main.tsx`, configure DSN via `VITE_SENTRY_DSN` env var, set up source map upload in Vite build, release tagging in `deploy.yml`. Backend: add `@sentry/node` to `server/api/src/index.ts` with Express integration, configure DSN, release tagging in `deploy-server.yml`. Sampling: 10% sessions / 100% errors / 100% unhandled rejections. |
| **Why** | Zero visibility into production errors currently — both frontend (map rendering, auth flows, localStorage quota) and backend (route errors, DB connection issues, Turnstile validation failures) fail silently. Sentry gives stack traces with source maps, breadcrumbs, user impact counts, release regression detection. Critical for a stack with a live API. |
| **Touches** | `package.json` (@sentry/react), `src/main.tsx`, `vite.config.ts` (Sentry Vite plugin for source maps), `.github/workflows/deploy.yml` (DSN + upload), `server/api/package.json` (@sentry/node), `server/api/src/index.ts`, `.github/workflows/deploy-server.yml` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup (Sentry account + project creation + DSN secrets provisioning for frontend and backend) |

### IN-2 Core Web Vitals Monitoring

| | |
|---|---|
| **What** | Add the `web-vitals` library (~3 KB) to report LCP, INP, CLS, FCP, TTFB. Dev: log to console. Prod: send as custom events to the existing Umami analytics endpoint (already shipped as IN-1 of the previous plan). Add a small dashboard card in Umami for trending. |
| **Why** | Map rendering is heavy — MapLibre GL, region TopoJSON parsing, `@turf/union` lazy-loaded on "all cities", grid data loading — all compete for the main thread. Performance regressions from new features currently go unnoticed until users complain. CWV are also SEO ranking factors, and the app now has prerendered SEO pages making this matter more. |
| **Touches** | `package.json` (web-vitals dep), `src/main.tsx` (report vitals), `src/utils/analytics.ts` (consume beacons as custom events) |
| **Complexity** | Small |
| **Dependencies** | Umami analytics (already shipped) |
| **Tag** | Claude Code |

### IN-3 Lighthouse CI Integration

| | |
|---|---|
| **What** | Add a `lighthouse-ci` job in `.github/workflows/ci.yml` that runs Lighthouse against the preview build on every PR. Assert minimum scores: performance ≥ 85, accessibility ≥ 95, best practices ≥ 95, SEO ≥ 95. Include prerendered neighborhood profile pages in the audited URLs, not only the app shell. Upload full HTML report as a PR artifact. |
| **Why** | Bundle size is already tracked per-PR; Lighthouse catches regressions bundle size can't see (render-blocking resources, missing alt text, LCP bloat from map init, broken SEO meta tags on prerendered pages). Hardens the prerendering pipeline specifically. |
| **Touches** | `.github/workflows/ci.yml` (new lighthouse-ci job), new `lighthouserc.json`, possibly `package.json` (@lhci/cli devDep) |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-4 Dependency & Security Scanning

| | |
|---|---|
| **What** | Enable Dependabot via `.github/dependabot.yml` for npm (frontend + `server/api/`), pip (data pipeline), Docker (server base images), and GitHub Actions. Add `npm audit --audit-level=high` and `pip-audit` as CI steps. Enable GitHub CodeQL via the native workflow template (free for public repos). |
| **Why** | The project is now a public-facing full stack (frontend + Node API + Postgres + Docker). Without auto-updates, security debt accumulates silently. Dependabot + CodeQL are zero-cost on public repos. Note: `@turf/union` must stay pinned per CLAUDE.md pitfalls — configure Dependabot to allow patch/minor only, not major bumps on load-bearing deps. |
| **Touches** | New `.github/dependabot.yml`, `.github/workflows/ci.yml` (audit steps), new `.github/workflows/codeql.yml` |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-5 API Observability: Health, Metrics, Backups

| | |
|---|---|
| **What** | Currently the API has no explicit health check beyond implicit Caddy routing. Add: (1) `/health` endpoint reporting DB connection, version, uptime; (2) `/metrics` Prometheus endpoint or structured JSON metrics (request count, latency, auth failures); (3) automated nightly Postgres backup via `pg_dump` to S3-compatible storage or DigitalOcean Spaces; (4) UptimeRobot or similar external health monitor for `api.naapurustot.fi`; (5) log aggregation (or at least structured JSON logs). |
| **Why** | The API is in production but has no safety net. If the DB dies, no one knows until users notice favorites don't sync. If someone runs a brute-force auth attack, no visibility. If the droplet crashes, no backup to restore from. Baseline ops hygiene for any live backend. |
| **Touches** | `server/api/src/index.ts` (health + metrics routes), new `server/api/src/logging.ts`, `server/docker-compose.yml` (backup sidecar container), new `server/scripts/backup.sh`, new uptime monitor configuration |
| **Complexity** | Medium |
| **Dependencies** | IN-1 (Sentry) ideally first, so backend errors surface in Sentry rather than only logs |
| **Tag** | Manual Setup (S3/Spaces bucket, UptimeRobot account, potentially Grafana Cloud for metrics) |

---

## Suggested Sequencing

Items within each batch are designed to be **safe for parallel Claude Code sessions** — no two items in the same batch modify the same file where practical. Batches run sequentially: Batch N+1 assumes Batch N is merged and stable. Within-batch conflicts that can't be avoided are called out explicitly.

### Batch 1 — Foundation, Quick Wins & Observability

All items touch independent files. Six parallel sessions safe.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| QW-1 Onboarding Tour | Quick Win | Small | Claude Code |
| QW-3 Data Freshness Indicator | Quick Win | Small | Claude Code |
| QW-4 Skip Link + Chart ARIA | Quick Win | Small | Claude Code |
| QW-5 Explain-This-Metric Tooltips | Quick Win | Small | Claude Code |
| IN-1 Sentry (Frontend + Backend) | Infrastructure | Small | Manual Setup |
| IN-4 Dependency & Security Scanning | Infrastructure | Small | Claude Code |

> **Why first:** Maximum user-facing discovery win (QW-1), trust (QW-3, QW-5), compliance baseline (QW-4, IN-4), and observability (IN-1) — all before adding new surface area. Every later batch benefits from Sentry already catching regressions and dependencies being auto-patched.
>
> **File map:**
> - QW-1 → new `OnboardingTour.tsx`, `App.tsx` render + localStorage, locales
> - QW-3 → `build_region_data.mjs`, `dataLoader.ts` or `useMapData.ts`, `SettingsDropdown.tsx`, locales
> - QW-4 → `index.html`, `index.css`, `RadarChart.tsx`, `TrendChart.tsx`
> - QW-5 → `metrics.ts` (METRIC_EXPLANATIONS), `NeighborhoodPanel.tsx`, locales
> - IN-1 → `main.tsx`, `vite.config.ts`, `deploy.yml`, `server/api/src/index.ts`, `deploy-server.yml`
> - IN-4 → new `dependabot.yml`, `ci.yml` append, new `codeql.yml`
>
> **Parallel safety:** QW-1 and IN-1 both touch `main.tsx` / `App.tsx` nearby — QW-1 is a render-tree conditional, IN-1 is a Sentry init wrapper. Run them one-after-the-other within the batch if doing simultaneous branches, or merge carefully.

### Batch 2 — Backend-Synced Features + Performance Signals

Depends on Batch 1 (Sentry must be catching errors before syncing sensitive user data). Six parallel sessions.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| QW-2 Keyboard Shortcuts + Overlay | Quick Win | Small | Claude Code |
| QW-6 Cloud-Synced Notes | Quick Win | Small–Medium | Claude Code |
| QW-7 Embed Mode | Quick Win | Small–Medium | Claude Code |
| CF-2 Cloud-Synced Filter & Quality Presets | Core Feature | Medium | Claude Code |
| CF-8 Multi-Neighborhood PDF Report | Core Feature | Small–Medium | Claude Code |
| IN-2 Core Web Vitals Monitoring | Infrastructure | Small | Claude Code |
| IN-3 Lighthouse CI Integration | Infrastructure | Small | Claude Code |

> **Why second:** Unlocks the backend's obvious follow-through (sync *all* user data, not just favorites), adds the biggest remaining discoverability miss (QW-2), opens distribution (QW-7), and extends proven features (CF-8). Ops signals (IN-2, IN-3) light up before larger features ship.
>
> **File map:**
> - QW-2 → `App.tsx` (keydown), new `ShortcutsOverlay.tsx`, locales
> - QW-6 → `server/api/src/db.ts` + migration, `server/api/src/index.ts` (routes), `src/utils/api.ts`, `src/hooks/useNotes.ts`
> - QW-7 → `App.tsx` (embed param), `SettingsDropdown.tsx`, `index.css`
> - CF-2 → `server/api/src/db.ts` + migration, `server/api/src/index.ts`, `src/utils/api.ts`, `src/hooks/useFilterPresets.ts`, `CustomQualityPanel.tsx`, new `useQualityPresets.ts`
> - CF-8 → `ComparisonPanel.tsx`, `export.ts`, `index.css`
> - IN-2 → `main.tsx`, `analytics.ts`, `package.json`
> - IN-3 → `ci.yml`, new `lighthouserc.json`
>
> **Parallel safety:** QW-2 and QW-7 both touch `App.tsx`. QW-6 and CF-2 both touch `server/api/src/db.ts` + `server/api/src/index.ts` + `src/utils/api.ts`. Run each pair sequentially within the batch, or coordinate merge order. The three files are short enough that merge conflicts are trivial.

### Batch 3 — Differentiating Features & Compliance

Depends on Batch 2. Six parallel sessions.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-1 User Reviews & Ratings | Core Feature | Large | Claude Code |
| CF-3 Swedish Language Support | Core Feature | Medium | Claude Code |
| CF-4 Correlation / Scatter Explorer | Core Feature | Medium | Claude Code |
| PO-1 Full WCAG 2.2 AA Audit | Polish | Medium | Claude Code |
| PO-2 Dynamic OG Images per Neighborhood | Polish | Medium | Claude Code |
| PO-6 GDPR Data Export + Account Deletion | Polish | Small–Medium | Claude Code |
| IN-5 API Observability | Infrastructure | Medium | Manual Setup |

> **Why third:** Reviews (CF-1) is the biggest product differentiator unlocked by the backend. Swedish (CF-3) and prerendered OG (PO-2) multiply the reach of the SEO pages already shipped. PO-1 + PO-6 together close the compliance gap now that user data is involved. IN-5 makes the API safe to operate under real load.
>
> **File map:**
> - CF-1 → `server/api/src/db.ts` + migration + new `reviews.ts`, `server/api/src/index.ts`, new `ReviewsSection.tsx`, `NeighborhoodProfilePage.tsx`, `NeighborhoodPanel.tsx`, `colorScales.ts` (new user_rating layer)
> - CF-3 → new `sv.json`, `i18n.ts`, `SettingsDropdown.tsx`, `SearchBar.tsx`, `NeighborhoodProfilePage.tsx`, `prerender.mjs`, `generate-sitemap.mjs`
> - CF-4 → new `CorrelationExplorer.tsx`, new `correlation.ts`, `ToolsDropdown.tsx`, `App.tsx`
> - PO-1 → many components (contrast, aria, focus-visible), `index.css`, `AuthModal.tsx` (focus trap)
> - PO-2 → `prerender.mjs`, new `render-og-image.mjs`, new `public/og/` output, meta tags in profile page
> - PO-6 → `server/api/src/index.ts` (export + delete routes), `server/api/src/db.ts`, `UserMenu.tsx`, new `PrivacyPage.tsx`
> - IN-5 → `server/api/src/index.ts` (health + metrics), new `logging.ts`, `docker-compose.yml`, new `backup.sh`
>
> **Parallel safety:** CF-1, PO-6, IN-5 all touch `server/api/src/index.ts` (adding routes). Coordinate via clearly-scoped route additions and a single final merge. CF-3 and CF-1 both touch `NeighborhoodProfilePage.tsx` — run CF-3 first (language-aware content) then CF-1 (reviews section). PO-1 is cross-cutting but each component edit is small and contention is low.

### Batch 4 — Scale-Out & Advanced Features

Depends on Batch 3. Seven items; coordinate across `Map.tsx` edits.

| Item | Category | Complexity | Tag |
|------|----------|------------|-----|
| CF-5 Complete Finnish Cities Rollout | Core Feature | Large | Manual Setup |
| CF-6 Isochrone / Travel Time | Core Feature | Large | Manual Setup |
| CF-7 Email Digest & Alerts | Core Feature | Medium | Manual Setup |
| PO-3 Real-Time Air Quality Layer | Polish | Medium | Manual Setup |
| PO-4 Time Slider / Historical Playback | Polish | Medium | Claude Code |
| PO-5 Auth UX: Password Reset + Email Verification | Polish | Medium | Manual Setup |

> **Why last:** Highest effort, most external dependencies (Statistics Finland WFS for new cities, Digitransit for isochrones, transactional email provider for digests + verification, HSY API for live AQ). All benefit from the stable foundation + monitoring + observability from earlier batches — regressions land softly, errors surface in Sentry.
>
> **File map:**
> - CF-5 → `prepare_data.py`, `build_region_data.mjs`, new `src/data/regions/*.topojson`, `regions.ts` (activate ids), sitemap regen
> - CF-6 → new `isochrone.ts`, new `IsochroneOverlay.tsx`, `Map.tsx` (layer), `NeighborhoodPanel.tsx` (controls)
> - CF-7 → `server/api/src/db.ts`, new `email.ts`, new `server/workers/send-digests.ts`, `UserMenu.tsx`, email templates
> - PO-3 → new `airQualityLive.ts`, `Map.tsx` (merge live values), `NeighborhoodPanel.tsx` (badge)
> - PO-4 → new `TimeSlider.tsx`, `Map.tsx` (year-indexed style expressions), `Legend.tsx`, `metrics.ts`
> - PO-5 → `server/api/src/auth.ts`, `server/api/src/db.ts`, reuse of `email.ts` from CF-7, `AuthModal.tsx`, new `ResetPasswordPage.tsx` + `VerifyEmailPage.tsx`, `UserMenu.tsx`
>
> **Parallel safety:** CF-6, PO-3, PO-4 all touch `Map.tsx`. Run sequentially within the batch or split into sub-batches (e.g., CF-6 + PO-4 first, PO-3 next). CF-7 and PO-5 both add code to `email.ts` — build CF-7's email.ts scaffolding first, then PO-5 adds reset/verify templates on top. CF-5 is pure data-pipeline and doesn't conflict with anything else.

---

## Completed (since the previous roadmap)

These items from the 2026-03-23 and in-progress 2026-04-13 draft roadmaps have now fully shipped:

| ID (prev) | Item | How |
|---|---|---|
| CF-1 | POI Overlay Layer | `POILayer.ts` fully wired; categories: school, daycare, grocery, healthcare, transit stops; clustering enabled |
| CF-4 | Radar Chart Overlay in Comparison | `RadarChart.tsx` renders multi-axis comparison |
| CF-5 | Grid Heatmap Expansion | Air quality grid (2.4 MB), light pollution grid (2.8 MB), transit reachability grid — all lazy-loaded with graceful fallback |
| PO-1 | Pretty URL Slugs + SEO Prerendering | `scripts/prerender.mjs` + `scripts/generate-sitemap.mjs` emit `/alue/{pno}-{slug}` (FI) and `/en/area/{pno}-{slug}` (EN) with JSON-LD, hreflang, per-neighborhood meta descriptions |
| IN-1 | Privacy-Respecting Analytics | Umami self-hosted at `analytics.naapurustot.fi`; event tracking via `src/utils/analytics.ts` |
| — | Backend infrastructure | Express + Postgres + Caddy + Docker Compose under `server/`; deployed to DigitalOcean via `deploy-server.yml` |
| — | Authentication system | Signup/login/logout with JWT cookies, bcrypt, Turnstile CAPTCHA (`AuthModal.tsx`, `UserMenu.tsx`, `useAuth.ts`, `server/api/src/auth.ts`) |
| — | Cloud-synced favorites | `getFavorites` / `saveFavorites` in `src/utils/api.ts`; localStorage-first with debounced server sync; merge on login |
| — | Region-split TopoJSON + lazy loading | `src/data/regions/*.topojson`; `useMapData` loads on demand; all-cities view via `@turf/union` lazy chunk |
| — | Neighborhood profile pages | `src/pages/NeighborhoodProfilePage.tsx` with MiniMap, StatCard, JSON-LD Place + BreadcrumbList schema |
| — | Sitemap + bilingual SEO | `sitemap.xml` auto-generated for every neighborhood × 2 locales with `hreflang` |

Partially-complete items from earlier roadmaps that remain open have been folded into this plan with updated scope: QW-4 Quality Persona Presets (filter presets shipped; dedicated quality-index presets folded into CF-2 sync), QW-5 Hover Tooltip (shipped via `TooltipOverlay.tsx`; the "quick-peek" scope is covered by existing hover), QW-7 Skip Link + Chart ARIA (now QW-4 in this plan), CF-2 Grid (only light pollution previously; now air quality + light pollution + transit all shipped; remaining 250m grids folded into CF-5 city rollout work), PO-3 OG Images (static only previously; dynamic per-neighborhood version is now PO-2), PO-5 Sparklines (shipped via `Sparkline.tsx`), IN-1 Sentry (optional DSN wiring existed; full frontend + backend enablement is now IN-1 of this plan).
