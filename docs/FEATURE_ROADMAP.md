# naapurustot.fi — Feature Roadmap

> Generated 2026-06-01 from a full multi-agent codebase audit. Supersedes the 2026-05-22 roadmap, most of which has shipped.

## Project Context

naapurustot.fi is a mature static React 19 / TypeScript 5.9 / Vite 8 single-page app built on MapLibre GL, live at naapurustot.fi, covering all 69 Tilastokeskus seutukunnat (~3,018 postal codes) as per-region lazy-loaded TopoJSON. The map needs no backend — all computation is client-side over bundled geodata — while an optional Express + PostgreSQL backend (api.naapurustot.fi) provides JWT auth and cloud sync of favorites/notes/preferences. The stack pairs Turf.js and proj4 for geospatial work, Tailwind for styling, React hooks + Context for state, and FI/EN/SV i18n; distribution leans on a PWA, ~27,000 prerendered SEO profile pages, regional hubs, and an embed mode. The product is already broad and deep: ~58–71 verified-source data layers across 11 categories, a documented composite Quality Index normalized against winsorized national ranges, and a rich analysis toolkit (correlation, similarity, ranking, wizard, filters, comparison, split map, time slider, isochrones).

The real frontier this roadmap targets is finer real granularity (250m grids beyond today's three Helsinki-centric layers, OSM building footprints), real-not-proxy data and deeper time-series, the lived-decision workflow (shareable URL state, durable shortlists, commute anchoring, custom reference baselines), trust/transparency surfaces (sources page, proxy and freshness disclosure, Quality Index auditability, privacy notice), and the deferred ops/CI/data-integrity infrastructure (single source-of-truth registry, provenance gates, health monitoring, coverage and payload reporting). Every item respects the hard constraints: real verifiable public sources only, finest-available granularity, data propagated into the GeoJSON source of truth and rebuilt into TopoJSON, the ~210KB gzipped bundle budget (heavy deps lazy-loaded), and the claude/* branch + auto-merge workflow.

## 1 — Quick Wins

### QW-1 Distribution viz: histogram + percentile rank for the active metric

| | |
|---|---|
| **What** | Add a small distribution panel for the currently selected layer that renders a histogram (or boxplot) of the metric across the active scope (region or all-Finland), marks where the selected neighborhood falls, and shows its exact percentile rank. Computed entirely client-side from already-loaded features, reusing the value extraction used by the choropleth and the correlation explorer. Honor the existing comparison-scope toggle: compute over the current region's neighborhoods in regional view, over all loaded features in national view. |
| **Why** | Users see a color and a number but no sense of the distribution shape — is this typical, an outlier, top-decile? A histogram with a "you are at the 87th percentile" marker turns every metric into an instantly interpretable insight and complements the national-range normalization already shipped. |
| **Touches** | src/utils/correlation.ts, src/components/NeighborhoodPanel.tsx, src/utils/metrics.ts, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### QW-2 Persistent named shortlist with side-by-side comparison and share

| | |
|---|---|
| **What** | Introduce a lightweight named shortlist distinct from one-tap favorites: as a user browses they add candidate neighborhoods to a shortlist that persists in localStorage (and cloud-syncs like favorites/notes when signed in via a new GET/PUT /auth/shortlist endpoint mirroring the existing pattern), opens directly into the comparison panel, and exports/shares via the extended URL state. Add a new useShortlist hook mirroring useFavorites, an "Add to shortlist" control in NeighborhoodPanel, and a shortlist tray. |
| **Why** | Choosing a home is a multi-day, multi-candidate process, but the comparison panel currently requires re-pinning each session and favorites are an undifferentiated flat list. A durable, named, shareable shortlist matches how people actually run a housing search and keeps them returning through the whole decision instead of losing their working set on refresh. |
| **Touches** | src/hooks/useFavorites.ts, src/hooks/useShortlist.ts, src/components/ComparisonPanel.tsx, src/components/NeighborhoodPanel.tsx, src/utils/api.ts, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Medium |
| **Dependencies** | CF-1 |
| **Tag** | Claude Code |

### QW-3 Embed snippet upgrade: carry full state + "open full view" deep link + auto-resize

| | |
|---|---|
| **What** | Extend buildEmbedSnippet to carry the richer URL state (layer, selected pno, region, compare, and once available filters/weights/year) so an embedded iframe shows the exact view the author configured. Refactor the existing embed watermark link to call buildEmbedSnippet with full state including compare, and add a small "Avaa naapurustot.fi:ssa" overlay that deep-links to the full app with the same state. Add a postMessage height handshake so host pages can auto-size the iframe (currently absent). |
| **Why** | Embeds are a distribution channel into local news, real-estate listings, and municipal blogs, but a generic-state iframe with no path back to the full app leaks engagement and gives no referral. Carrying state plus a branded "open full view" link turns every embed into a configured showcase and a click-through funnel. |
| **Touches** | src/utils/embed.ts, src/App.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Small |
| **Dependencies** | CF-1 |
| **Tag** | Claude Code |

## 2 — Core Features

### CF-1 Comprehensive shareable URL state (filters, weights, time-year, isochrone, viewport, lang/colorblind)

| | |
|---|---|
| **What** | Extend the URL state serializer in useUrlState beyond the current pno/layer/compare/city to encode the analytical state a user actually built: active filter ranges/presets, custom quality weights (or persona id), comparison scope, time-slider year, isochrone settings, draw-area polygons (compactly), viewport (center/zoom), and lang/colorblind. Use short compact keys with strict validation+clamping on parse, omit defaults to keep URLs short and pasteable, and keep viewport optional behind a "copy link to this view" affordance to avoid replaceState churn on pan. Add a "Copy share link" affordance and tests. |
| **Why** | A configured map state (filtered, custom-weighted, time-set, pinned comparison) is the product's most viral and most collaborative artifact, but today a shared link restores only neighborhood/layer/compare/city, so a recipient lands on a generic default. Making every analysis reproducible by URL is the single highest-leverage growth and collaboration mechanic for a no-login tool, and is the foundational enabler for shareable shortlists, share-image cards, and richer embeds. |
| **Touches** | src/hooks/useUrlState.ts, src/App.tsx, src/utils/embed.ts, src/hooks/useQualityWeights.ts, src/hooks/useFilterPresets.ts, src/utils/filterUtils.ts, src/components/TimeSlider.tsx, src/components/ComparisonPanel.tsx, src/components/NeighborhoodPanel.tsx, src/components/SettingsDropdown.tsx, src/components/IsochroneControls.tsx, src/__tests__/urlState.test.ts |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-2 Implement the 250m national grid (population, income, age/education) — replace the placeholder fetch

| | |
|---|---|
| **What** | Implement scripts/fetch_grid_data.py (currently a documentation-only stub) against Statistics Finland's published 250m statistical grid (vaestoruutuaineisto via StatFin PxWeb / open file download), reprojecting ETRS-TM35FIN (EPSG:3067) to WGS84 with proj4/pyproj, and emit real grid TopoJSON for population density, median income, and age/education structure. Wire it through the data pipeline (prepare_data.py, validate_data.py, build_grid_data.mjs) and rebuild via npm run build:data so the highest-variance fundamentals render at sub-postal resolution nationwide where published, degrading to the existing hatch where cells are suppressed. |
| **Why** | Postal codes can be huge and internally lopsided — a single code may mix a dense apartment core with sparse forest, misleading exactly the people making a high-stakes move. The 250m demographic grid is the canonical finest-granularity Finnish open dataset; implementing this documented placeholder satisfies the granularity mandate and unblocks national grid rollout beyond today's three Helsinki-centric grid layers. |
| **Touches** | scripts/fetch_grid_data.py, scripts/build_grid_data.mjs, scripts/prepare_data.py, scripts/validate_data.py, src/hooks/useGridData.ts, public/data/metro_neighborhoods.geojson |
| **Complexity** | Large |
| **Dependencies** | IN-1 |
| **Tag** | Claude Code |

### CF-3 OSM building-footprint morphology layer (density, lot coverage, typology)

| | |
|---|---|
| **What** | Add a "built form" layer set derived from OSM building footprints via a new scripts/fetch_building_footprints.py querying Overpass for way/relation building=* with full geometry (`out geom;`). Aggregate per postal code: footprint coverage ratio (sum of footprint area / land area pinta_ala), building-count density, and a coarse morphology mix (low-rise detached vs apartment-block share by footprint-size buckets). Add the LayerId + color scale in colorScales.ts, metric metadata in metrics.ts, FI/EN/SV labels, write values into the GeoJSON, and rebuild the TopoJSON. Where OSM coverage is partial, use the existing gray/low-data hatch. |
| **Why** | Built-form morphology — leafy detached suburb, dense apartment grid, or sprawling blocks — is one of the strongest lived-experience signals when choosing a home and is currently only weakly proxied by detached-house share. Real footprint morphology gives a concrete, finer-than-Paavo signal of urban character, using a free, verifiable source the project already ingests for POIs at near-zero new infrastructure cost. |
| **Touches** | scripts/fetch_building_footprints.py, scripts/prepare_data.py, src/utils/colorScales.ts, src/utils/metrics.ts, public/data/metro_neighborhoods.geojson, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-4 Commute-to-destination travel-time filter (anchor isochrone to a real address)

| | |
|---|---|
| **What** | Add a "How far from..." destination input next to the existing isochrone controls. The user geocodes a real address (workplace, school) via the existing Digitransit geocoder, picks mode (walk/bike/transit/car) and a time budget, and the map shades every neighborhood by whether its centroid falls inside the reachable area from that destination. Compute one reverse isochrone around the destination, then point-in-polygon-test each neighborhood centroid with findNeighborhoodForPoint, surface a "within X min of <address>" badge in NeighborhoodPanel, and cache per destination+mode+budget in sessionStorage like the current isochrone cache. (Distinct from the shipped single-neighborhood isochrone; renumbered to avoid collision with the shipped CF-4/CF-5.) |
| **Why** | Commute is the single most decision-determining constraint for relocators, and the one thing the app cannot answer today: the current isochrone only draws outward from a neighborhood you already selected, never inward from where you need to be daily. Letting someone type their office and instantly see which neighborhoods are commute-viable turns the map from "browse stats" into "find where I could actually live". |
| **Touches** | src/utils/isochrone.ts, src/components/IsochroneControls.tsx, src/utils/geocode.ts, src/components/Map.tsx, src/components/NeighborhoodPanel.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Large |
| **Dependencies** | None |
| **Tag** | Manual Setup |

### CF-5 Custom reference-neighborhood baseline with per-criterion "why it matched" breakdown

| | |
|---|---|
| **What** | Let the user pin ANY neighborhood as a custom reference baseline instead of only the metro/region average, so per-metric diff arrows, the radar overlay, comparison framing, and quality diffs are computed relative to a user-chosen "home" or "target" area ("greener than where I live, but pricier"). Generalize the hardcoded metroAverages diff logic in NeighborhoodPanel, RadarChart, and AreaSummaryPanel to a selected reference. In the wizard/filter result and comparison views, also show a per-metric contribution breakdown — which criteria pushed each neighborhood up or down, with the actual value vs the chosen threshold — instead of an opaque single match-%. Store the reference pno in URL state with a clear "compared to {area}" label. |
| **Why** | Relative-to-average is generic; relative-to-a-place-I-care-about (my current street) is the question people actually have, and a ranked list with a single opaque score does not help someone decide. Generalizing the existing metro-diff and scoring logic to a user-selected reference, plus exposing why each place scored, is a far more persuasive and trustworthy lens that adds no new data. |
| **Touches** | src/components/NeighborhoodPanel.tsx, src/components/ComparisonPanel.tsx, src/components/NeighborhoodWizard.tsx, src/components/RadarChart.tsx, src/components/AreaSummaryPanel.tsx, src/utils/filterUtils.ts, src/utils/qualityIndex.ts, src/hooks/useUrlState.ts, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-6 Configurable + national similarity engine ("find places like here, anywhere in Finland")

| | |
|---|---|
| **What** | Replace the hardcoded 10-metric SIMILARITY_METRICS array in src/utils/similarity.ts with a user-selectable metric set and optional per-metric weights, and add a "search all of Finland" toggle so the similarity query ranks candidates across every loaded region instead of only the current view. Persist the chosen metric set in URL/localStorage and surface a small picker in the panel that already shows the top-5 similar neighborhoods. |
| **Why** | The similarity engine is powerful but opaque — users cannot tell it what "similar" means to them, and it cannot answer the most compelling question ("find me places like my current home, anywhere in Finland"). Making the existing engine configurable and national is a large analytical upgrade with no new data, leveraging the whole-Finland coverage already shipped. |
| **Touches** | src/utils/similarity.ts, src/components/NeighborhoodPanel.tsx, src/hooks/useUrlState.ts, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-7 Property-price and crime time-series (add _history series + change metrics)

| | |
|---|---|
| **What** | Extend the historical-trends pipeline so property prices and crime rates get the same [year, value] history treatment income/population/unemployment already have. fetch_property_prices.py already queries multiple yearly periods of the StatFin ashi table and fetch_crime_index.py reads a yearly StatFin rpk table — capture the full year series instead of only the latest, write property_price_history and crime_index_history into the GeoJSON, derive change-% metrics, and wire both into the existing TimeSlider/TrendChart/Sparkline components. |
| **Why** | Time-series exists for only 3 metrics today, yet two of the most decision-relevant numbers — what prices are doing and whether crime is rising or falling — sit on upstream tables the pipeline already touches that publish yearly data. This turns static snapshots into trends with no new data source, directly extending the shipped time-slider investment. |
| **Touches** | scripts/fetch_property_prices.py, scripts/fetch_crime_index.py, scripts/historical_trends.json, scripts/prepare_data.py, src/utils/metrics.ts, src/components/TrendChart.tsx, src/components/Sparkline.tsx, public/data/metro_neighborhoods.geojson |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-8 Quality Index auditability: per-neighborhood factor-coverage breakdown

| | |
|---|---|
| **What** | Make each neighborhood's Quality Index defensible by showing, on demand in the NeighborhoodPanel quality section, exactly which of the ~61 factors contributed: per-dimension score, factors used, factors missing (no data) for this specific area, and how missing factors were handled (re-normalized within available factors vs penalized). Surface the active comparison scope (national vs within-region) and a "coverage: X/61 factors" confidence chip so a low-coverage rural postal code is visibly less certain than a fully-covered Helsinki one. |
| **Why** | The index is the headline number every visitor sees, yet there is no way to see why a given area scored as it did or how many factors were actually available — partial-coverage areas get a confident-looking score built on few inputs. Exposing factor coverage and missing-data handling makes the flagship metric auditable, defends against "this score is wrong" challenges, and reinforces the documented methodology in qualityIndex.ts. |
| **Touches** | src/utils/qualityIndex.ts, src/components/NeighborhoodPanel.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### CF-9 Public Data Sources & Methodology page (FI/EN/SV, prerendered, linked app-wide)

| | |
|---|---|
| **What** | Add a static, prerendered /tietolahteet (FI), /en/data-sources, /sv/datakallor route built from the data-source registry, listing every layer with its source name, clickable source URL, license, vintage year, granularity, and a "derived/proxy" badge where applicable. Include a concise Quality Index methodology summary rendered from docs/QUALITY_INDEX.md plus the national-normalization explanation. Wire it into prerender.mjs, the sitemap (with hreflang alternates), and add a footer/header link from the SPA and from every prerendered profile page's nav. |
| **Why** | The methodology is currently buried in a repo markdown file and a single tooltip string; there is no public, indexable page a skeptical journalist, official, or resident can cite to verify the data. A transparent, multilingual sources+methodology page is the single biggest trust/credibility lever and strengthens SEO/E-E-A-T across the ~27,000 profile pages. |
| **Touches** | scripts/prerender.mjs, scripts/generate-sitemap.mjs, src/pages/DataSourcesPage.tsx, src/main.tsx, docs/QUALITY_INDEX.md, src/locales/fi.json, src/locales/en.json, src/locales/sv.json, src/data/data_sources.json |
| **Complexity** | Medium |
| **Dependencies** | IN-2 |
| **Tag** | Claude Code |

### CF-10 Comparison & correlation "share as image" cards (PNG export + Web Share)

| | |
|---|---|
| **What** | Generalize the existing single-neighborhood score-card path to produce two branded PNG artifacts: a side-by-side comparison card (2-3 pinned neighborhoods with key metric diffs and quality badges) and a correlation snapshot card (the scatter plot, Pearson r, the two metric labels, a naapurustot.fi watermark, and the deep link). Reuse the lazy-loaded html-to-image path so the bundle budget is untouched, and wire a "Jaa kuvana" / Web Share button into ComparisonPanel and CorrelationExplorer mirroring NeighborhoodPanel. |
| **Why** | Comparison and correlation are exactly the screenshots people already crop and post, but today they must hand-screenshot an un-branded, un-linked view. A branded card with the deep link baked in converts each share into traceable inbound traffic and back-links — top-of-funnel growth with export machinery already proven. |
| **Touches** | src/utils/scoreCard.ts, src/components/ComparisonPanel.tsx, src/components/CorrelationExplorer.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json, src/__tests__/scoreCard.test.ts |
| **Complexity** | Medium |
| **Dependencies** | CF-1 |
| **Tag** | Claude Code |

### CF-11 Prerender SEO depth: twitter:image, verifiable percentile badges, FAQPage + Dataset JSON-LD

| | |
|---|---|
| **What** | Sharpen the ~27k prerendered profiles and 207 hubs using only data already in the repo. (1) Inject the currently-missing twitter:image meta tag (pointing at the shared og-image.png) so X/Slack/WhatsApp cards render at all. (2) Compute each neighborhood's percentile rank within its region and nationally for headline metrics (quality index, income, transit) from the loaded GeoJSON + national_ranges.json, and surface them as a verifiable sentence in the meta description, noscript table, and JSON-LD additionalProperty ("Top 8% nationally for quality index"). (3) Emit a FAQPage JSON-LD block plus matching visible/noscript Q&A templated from real values ("What is the average income in {area}?"), and a Dataset JSON-LD node on hub pages describing the underlying open datasets, sources, and licenses. |
| **Why** | Profiles are the SEO surface but their social cards are half-broken (no twitter:image) and copy is generic, while answer engines increasingly cite pages with explicit Q&A/Dataset structured data. Real computed superlatives and templated Q&A are the most clickable, most-quoted hooks for humans and LLMs — all traced to real data, so no integrity risk — deepening discoverability across 27k profiles with zero new data sources. |
| **Touches** | scripts/prerender.mjs, scripts/prerender-hubs.mjs, src/components/profile/JsonLd.tsx, src/utils/nationalRanges.ts, src/utils/percentileRanks.ts, index.html |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

## 3 — Polish

### PO-1 prefers-reduced-motion support + re-enable AA color-contrast CI gate

| | |
|---|---|
| **What** | Add a global CSS media query in src/index.css that neutralizes Tailwind transition/animation utilities under prefers-reduced-motion: reduce, plus a small useReducedMotion (matchMedia) hook consumed where motion is programmatic: useAnimatedValue counter tweens, MapLibre easeTo/flyTo in Map.tsx and SplitMapView.tsx (pass animate:false/duration:0 when reduced), the onboarding tour, and bottom-sheet drags / sparkline draws. Separately, fix the brand-500-on-white contrast (currently 4.47:1, below WCAG AA) by darkening the brand text token or adjusting usage so the disabled axe color-contrast rule can be re-enabled in CI. |
| **Why** | There is no prefers-reduced-motion handling anywhere in src (a WCAG 2.3.3 gap and vestibular trigger given animated counters, radar tweens, and map fly-to), and sub-AA brand text excludes low-vision users — exactly the cohorts making housing decisions. Both are low-effort, high-trust accessibility wins for a public-interest civic tool, and re-enabling the contrast gate prevents regressions. |
| **Touches** | src/index.css, src/hooks/useAnimatedValue.ts, src/components/Map.tsx, src/components/SplitMapView.tsx, src/components/OnboardingTour.tsx, tailwind.config.js, e2e/a11y.spec.ts |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-2 Honest proxy/derived-data disclosure badge on map, legend, and panel

| | |
|---|---|
| **What** | Surface the is_proxy/derived flag from the data-source registry directly in the UI: a small "estimate / arvio" badge with an explanatory popover wherever a value comes from a regression proxy or derived model rather than direct measurement — specifically Tampere/Turku transit_reachability_score (R²=0.58 regression) and their distance-from-center air-quality gradients, plus any source tagged derived. Show it in the Legend, the NeighborhoodPanel stat row next to the existing source attribution, and in the tooltip. Add FI/EN/SV strings explaining what "estimate" means and which regions/layers are affected. |
| **Why** | Presenting a regression proxy with the same visual weight as a measured value quietly overstates accuracy — an acknowledged gap that erodes trust if a local notices their city's "transit access" isn't real travel-time data. Explicitly labelling estimates is honest, defuses "this is wrong" criticism, and turns a weakness into a credibility signal without removing the layer. |
| **Touches** | src/utils/metrics.ts, src/components/NeighborhoodPanel.tsx, src/components/Legend.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json |
| **Complexity** | Small |
| **Dependencies** | IN-2 |
| **Tag** | Claude Code |

### PO-3 Per-layer data-freshness / vintage panel with staleness signalling

| | |
|---|---|
| **What** | Replace the single global build_metadata.json timestamp with a per-layer freshness view driven by the registry's vintage years: a sortable list of every layer, its vintage, granularity, and source, with a subtle "last updated N years ago" staleness indicator (amber for layers older than ~3 years such as foreign_language 2020, noise 2012-2022, crime 2023). Keep the build-derived timestamp as "site last rebuilt", but make data age per-layer and honest, and optionally show the vintage year inline in the Legend caption. Extend the LayerConfig interface with optional vintage_year and source fields to support per-layer metadata. |
| **Why** | A single build timestamp implies all data is fresh, but vintages actually range 2012-2026 with several frozen snapshots. Users making relocation decisions deserve to know a metric is years old. Per-layer freshness is a low-effort honesty win that prevents over-trusting stale layers. |
| **Touches** | src/components/Legend.tsx, src/data/build_metadata.json, src/data/data_sources.json, src/locales/fi.json, src/locales/en.json, src/locales/sv.json, src/utils/colorScales.ts |
| **Complexity** | Medium |
| **Dependencies** | IN-2 |
| **Tag** | Claude Code |

### PO-4 Recently-viewed & favorites re-entry surface ("continue exploring") on the home view

| | |
|---|---|
| **What** | On (re)load with no deep link, render a lightweight panel/strip that resurfaces the user's recent neighborhoods (useRecentNeighborhoods) and favorites (useFavorites) as one-click chips that restore that view, plus "similar to your favorites" suggestions from the existing similarity engine. New HomeReentryPanel.tsx component, rendered when nothing is selected. Purely local data, no new fetch; degrades to onboarding for first-time visitors. |
| **Why** | The product is research-grade but has weak return-visit hooks for anonymous users — every fresh load starts cold. A "pick up where you left off" surface, built from local recents/favorites already tracked, raises day-N return engagement and gives the optional account a tangible upgrade reason (cloud-synced recents across devices), without new data sources. |
| **Touches** | src/hooks/useRecentNeighborhoods.ts, src/hooks/useFavorites.ts, src/utils/similarity.ts, src/App.tsx, src/components/EmptyStateIllustrations.tsx, src/components/HomeReentryPanel.tsx |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-5 Surface and retry silent server-sync failures + cross-tab localStorage sync

| | |
|---|---|
| **What** | Add a thin sync-status layer used by useFavorites, useNotes, useQualityWeights, and useFilterPresets: replace the silently-swallowed server-sync catch blocks with a status signal (idle/syncing/error) exposed to a small unobtrusive "changes not saved to your account, retry" indicator, plus exponential-backoff retry. Add cross-tab consistency via a storage event listener (and/or BroadcastChannel) so favoriting in one tab updates others. All browser-native APIs, no new heavy deps. |
| **Why** | Server-sync failures for favorites/notes/preferences are swallowed silently with no retry or feedback, and there is no cross-tab localStorage sync, so logged-in users can lose data they believe is cloud-saved and see stale state across tabs. This is a trust-and-data-loss fix for the optional-backend feature the project already invested in, with zero bundle impact. |
| **Touches** | src/hooks/useFavorites.ts, src/hooks/useNotes.ts, src/hooks/useQualityWeights.ts, src/hooks/useFilterPresets.ts, src/components/UserMenu.tsx, src/utils/syncStatus.ts |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### PO-6 Privacy & data-handling notice page for the auth backend (FI/EN/SV)

| | |
|---|---|
| **What** | Add a prerendered, multilingual privacy/data-handling page (/tietosuoja, /en/privacy, /sv/integritet) that plainly states what the optional account collects (email, hashed password, favorites/notes/preferences synced to api.naapurustot.fi), the legal basis, retention, the third parties involved (Cloudflare Turnstile, Sentry, self-hosted Umami), that the map works fully without an account, and how to contact for data requests. Link it from the auth/signup UI and the site footer. Transparency notice only — does NOT implement the deferred GDPR export/delete or account-deletion flows. |
| **Why** | The product collects emails and personal favorites/notes via the backend and runs Turnstile/Sentry/Umami, but there is no privacy notice anywhere — a basic legal/compliance gap and a trust blocker at the exact moment a user is asked to sign up. A clear, honest notice is table stakes for a public Finnish service handling personal data and is independent of the deferred export/delete machinery. |
| **Touches** | scripts/prerender.mjs, scripts/generate-sitemap.mjs, src/components/AuthModal.tsx, src/locales/fi.json, src/locales/en.json, src/locales/sv.json, src/main.tsx, src/pages/PrivacyPage.tsx, src/components/SettingsDropdown.tsx |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Manual Setup |

### PO-7 Locale key-parity + Swedish format-locale CI gate

| | |
|---|---|
| **What** | Add a Vitest spec under src/__tests__ that asserts en.json and sv.json have full key parity with fi.json (sv.json currently missing ~53 of 587 keys) and that no value is an empty string, failing CI when a new fi key lands without translations, and translate the missing SV keys. Separately, fix src/utils/formatting.ts getNumberFormatter() so Swedish maps to sv-SE instead of silently falling through the en-vs-fi ternary, matching the sv-SE tag the prerender scripts already use. |
| **Why** | Swedish is a co-official Finnish language yet ~9% of the UI silently falls back to Finnish, with number formatting inconsistent between the live app and the prerendered SEO pages (which correctly use sv-SE). A parity test prevents regression permanently and the formatting fix makes the runtime app match its own SEO output, at zero bundle cost. |
| **Touches** | src/utils/formatting.ts, src/locales/sv.json, src/locales/fi.json, src/locales/en.json, src/__tests__/i18nKeyParity.test.ts |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

## 4 — Infrastructure

### IN-1 Manifest-driven grid-layer discovery (kill the hardcoded 3-path registry)

| | |
|---|---|
| **What** | Have scripts/build_grid_data.mjs emit a grid_manifest.json (mapping each LayerId to its built grid file path, format, bbox, and coverage scope) as it scans public/data for grid files, mirroring the existing region_coverage.json pattern from build_region_data.mjs. Refactor src/hooks/useGridData.ts to read GRID_PATHS and hasGridData() from that manifest at startup instead of the hardcoded transit_reachability/light_pollution/air_quality object, and let the Legend/UI show per-grid coverage scope ("Helsinki metro only") instead of silently falling back. |
| **Why** | Grid layers are the granularity frontier, but every new one currently requires editing the hook and risks silent fallback (a typo'd path just warns to console and reverts to choropleth) with no coverage signal to users. A manifest removes the code coupling so grid rollout scales with data and makes partial coverage explicit, directly unblocking the 250m national grid item. |
| **Touches** | src/hooks/useGridData.ts, scripts/build_grid_data.mjs, src/data/grid_manifest.json, src/components/Legend.tsx, package.json |
| **Complexity** | Small |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-2 Single source-of-truth data-source registry + CI drift check

| | |
|---|---|
| **What** | Create one canonical machine-readable registry (src/data/data_sources.json) keyed by metric/GeoJSON property, each entry carrying: human source name, source URL, publisher/license, vintage year(s), granularity (postal/250m grid/derived), and a boolean is_proxy flag. Generate the existing METRIC_SOURCES map in src/utils/metrics.ts from this registry (or import it directly) so the hand-maintained, URL-less map can no longer silently drift. Add a Vitest spec that fails CI if any LayerId in colorScales.ts / metrics.ts lacks a registry entry, and a Python check in validate_data.py asserting every layer written to the GeoJSON has a registry row. |
| **Why** | Source attribution is the product's core credibility asset, but METRIC_SOURCES is a separate hand-maintained map with no URLs and years frozen at a uniform value while real vintages span 2012-2026. A single registry with CI parity guarantees every shown number traces to a citable, dated, licensed source and prevents attribution from rotting as the 58-71 layers evolve. It is the foundation for the public sources page, the proxy badge, and the freshness panel. |
| **Touches** | src/data/data_sources.json, src/utils/metrics.ts, src/utils/colorScales.ts, scripts/validate_data.py, src/__tests__/metrics-registry.test.ts |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-3 Build-time data-provenance integrity check + provenance manifest

| | |
|---|---|
| **What** | Harden the pipeline's trustworthiness: in prepare_data.py / validate_data.py, assert that the vintage years declared in the data-source registry match the actual vintages recorded in scripts/*.json provenance fields, failing the build on mismatch. Also compute per-metric null-rate and compare against a committed src/data/data_baseline.json, failing if coverage drops by more than a configurable delta or a previously-populated metric becomes entirely null. Emit a build-time provenance manifest (extending build_metadata.json) recording per layer: source, vintage, granularity, row count, coverage %, and add it as a CI artifact and to the data-refresh workflow summary. |
| **Why** | The quarterly data-refresh workflow currently only sanity-checks file size and feature count, so a silent upstream schema change that nulls a column (e.g. property_price or crime), or a vintage drifting out of sync with the declared source, would pass review and ship a degraded map. A provenance + null-rate gate turns the project's data-integrity stance into an enforced automated check and gives a defensible audit trail for every data change, supporting the sources page and freshness panel. |
| **Touches** | scripts/prepare_data.py, scripts/validate_data.py, .github/workflows/data-refresh.yml, src/data/build_metadata.json, src/data/data_sources.json |
| **Complexity** | Medium |
| **Dependencies** | IN-2 |
| **Tag** | Claude Code |

### IN-4 Synthetic data-freshness + backend uptime health monitor (Actions cron)

| | |
|---|---|
| **What** | Add a lightweight scheduled GitHub Actions workflow (health-check.yml) that runs daily: (1) pings api.naapurustot.fi/health and opens an issue if the optional backend is down or slow; (2) fetches the deployed build_metadata/provenance manifest and warns if data is older than a configurable threshold (e.g. not refreshed in >2 quarters), catching a silently-failed quarterly refresh; (3) verifies the deployed sitemap.xml and a sample profile page return 200. On failure it opens a GitHub issue (via built-in GITHUB_TOKEN) so the owner is alerted. Data-age threshold configurable as a GitHub secret. |
| **Why** | There are no post-deploy health checks, no synthetic data-freshness monitoring, and server-sync failures are swallowed silently — so a dead backend or a quietly-failed data refresh could go unnoticed for months. A zero-cost cron smoke test gives the operator early warning that the live site and its data are healthy, foundational ops trustworthiness without standing up new infrastructure. |
| **Touches** | .github/workflows/health-check.yml, server/api/src/index.ts, src/data/build_metadata.json |
| **Complexity** | Small |
| **Dependencies** | IN-3 |
| **Tag** | Claude Code |

### IN-5 Test-coverage reporting + ratchet gate in CI

| | |
|---|---|
| **What** | Wire the already-installed-but-unused @vitest/coverage-v8 into the Vitest config with a v8 provider and sane include/exclude, add an npm run test:coverage script, and add a CI step in ci.yml (and the auto-merge.yml path) that runs coverage and enforces a baseline threshold that ratchets up — failing if coverage drops below the committed baseline rather than demanding a fixed high number. Surface the summary in the GitHub step summary like the existing bundle-size report. |
| **Why** | @vitest/coverage-v8 is installed but never invoked, so the 145 specs produce no coverage signal and regressions in critical paths (the dataLoader/filterPresets tests written to fix sub-15% coverage) can silently reappear. A ratchet gate locks in hard-won coverage without blocking unrelated work, using infra patterns the CI already demonstrates. |
| **Touches** | .github/workflows/ci.yml, .github/workflows/auto-merge.yml, vitest.config.ts, package.json |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

### IN-6 Region TopoJSON payload audit + quantization for map-load performance

| | |
|---|---|
| **What** | Add a build-time payload report (extend build_region_data.mjs / build_grid_data.mjs) that records each per-region TopoJSON's gzipped byte size into a committed manifest and prints a CI step summary like the existing bundle-size report, flagging any region file crossing a configurable size budget. Pair it with coordinate quantization/precision tuning in the TopoJSON build (geo2topo -q / toposimplify, following the existing build_seutukunta_boundaries.mjs -q 1e5 pattern) to shrink precision where it does not affect rendering, measuring before/after payload on the largest regions. This is a data-payload performance lever distinct from the JS bundle budget. |
| **Why** | CI enforces a JS bundle budget but has no visibility into the per-region geodata payloads users actually download on the map hot path, and the dataset spans ~3,018 postal codes across 69 lazy-loaded regions where the biggest regions dominate first-paint cost. Instrumenting and quantizing the geodata gives a measurable map-performance win and a regression guard for the largest real cost on the wire. |
| **Touches** | scripts/build_region_data.mjs, scripts/build_grid_data.mjs, .github/workflows/ci.yml |
| **Complexity** | Medium |
| **Dependencies** | None |
| **Tag** | Claude Code |

## Suggested Sequencing

### Batch 1 — Foundations: registry, manifest, URL state, standalone wins

The bedrock items everything else builds on — the data-source registry (IN-2) and grid manifest (IN-1) unblock most transparency and grid work, and comprehensive URL state (CF-1) enables shortlists, share-cards, and richer embeds. The rest are fully self-contained features with no dependencies that can run in parallel from day one.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| IN-2 | Infrastructure | Medium | Claude Code |
| IN-1 | Infrastructure | Small | Claude Code |
| CF-1 | Core Features | Large | Claude Code |
| QW-1 | Quick Wins | Small | Claude Code |
| CF-6 | Core Features | Medium | Claude Code |
| CF-7 | Core Features | Medium | Claude Code |
| CF-8 | Core Features | Medium | Claude Code |
| PO-1 | Polish | Small | Claude Code |
| PO-4 | Polish | Medium | Claude Code |
| PO-5 | Polish | Medium | Claude Code |
| PO-7 | Polish | Small | Claude Code |
| IN-5 | Infrastructure | Medium | Claude Code |
| IN-6 | Infrastructure | Medium | Claude Code |
| CF-4 | Core Features | Large | Manual Setup |

Parallel-safety note: distinct file sets except for shared hubs — CF-1, CF-6, and QW-1 all touch useUrlState.ts/NeighborhoodPanel.tsx and the locale JSONs (merge CF-1 first as it restructures the serializer, then CF-6's metric+scope params, then QW-1's histogram section); PO-1, IN-5, and IN-6 share ci.yml/config files (append-only, merge in ID order); CF-4 needs VITE_DIGITRANSIT_API_KEY set in the deploy environment before it delivers end-user value.

### Batch 2 — Granularity & shipped-state consumers

Heavy data-pipeline and analytical features that depend on Batch 1's foundations: the 250m grid (CF-2) needs the grid manifest, footprint morphology (CF-3) is independent but pipeline-heavy, and the reference-baseline (CF-5) consumes the URL-state plumbing from CF-1.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-2 | Core Features | Large | Claude Code |
| CF-3 | Core Features | Large | Claude Code |
| CF-5 | Core Features | Medium | Claude Code |
| QW-2 | Quick Wins | Medium | Claude Code |

Parallel-safety note: CF-2 and CF-3 both write to public/data/metro_neighborhoods.geojson and prepare_data.py (sequence the data-pipeline merge: rebuild and validate GeoJSON after each lands, never concurrently); CF-5 and QW-2 touch NeighborhoodPanel.tsx/ComparisonPanel.tsx and locale JSONs (append-only, merge CF-5's reference logic before QW-2's shortlist control).

### Batch 3 — Trust surfaces & provenance gates

The transparency and integrity layer that consumes the registry from Batch 1: the public sources page (CF-9), proxy badge (PO-2), freshness panel (PO-3), and the build-time provenance gate (IN-3) all read src/data/data_sources.json, so they must follow IN-2.

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-9 | Core Features | Medium | Claude Code |
| PO-2 | Polish | Small | Claude Code |
| PO-3 | Polish | Medium | Claude Code |
| IN-3 | Infrastructure | Medium | Claude Code |
| PO-6 | Polish | Small | Manual Setup |

Parallel-safety note: largely distinct files — CF-9 and PO-6 both add routes to main.tsx and pages to prerender.mjs/generate-sitemap.mjs (append routes in ID order); PO-2 and PO-3 share Legend.tsx and locale JSONs (append-only); PO-6 needs owner sign-off on legal/retention copy before publishing.

### Batch 4 — Distribution polish & ops monitoring

The final layer that depends on the richer URL state (share-cards CF-10, embed upgrade QW-3), the prerender depth pass (CF-11), and the provenance manifest (health monitor IN-4 reads IN-3's output).

| Item | Category | Complexity | Tag |
|---|---|---|---|
| CF-10 | Core Features | Medium | Claude Code |
| QW-3 | Quick Wins | Small | Claude Code |
| CF-11 | Core Features | Medium | Claude Code |
| IN-4 | Infrastructure | Small | Claude Code |

Parallel-safety note: distinct file sets — CF-10 (scoreCard/Comparison/Correlation), QW-3 (embed.ts/App.tsx), CF-11 (prerender scripts/JsonLd), and IN-4 (new workflow + server health endpoint) only overlap on locale JSONs (append-only); IN-4 lands after IN-3 so the freshness check has a provenance manifest to read.

## Completed since the 2026-05-22 Roadmap

| Capability | Area |
|---|---|
| MapLibre GL choropleth, 58–71 layers across 11 categories, theme-aware borders | Map core |
| Composite Quality Index (0–100), 6 dimensions, ~61 factors, documented methodology | Quality Index |
| National-reference normalization (winsorized p2/p98) + "within region" scope toggle | Quality Index |
| 7 quality personas + free-form weight sliders | Quality Index |
| Whole-Finland coverage: all 69 seutukunnat (~3,018 postal codes), lazy-loaded TopoJSON | Coverage |
| Per-region coverage badges in CitySelector from region_coverage.json | Coverage |
| 250m grid layers for air_quality (FMI ENFUSER, Helsinki), light_pollution (VIIRS), transit_reachability | Granularity |
| Zoom-based grid/postal fade-over + no-data hatch overlay | Map rendering |
| Seutukunta boundary outlines + all-cities metro-area dissolve via @turf/union | Map rendering |
| Digitransit travel-time isochrones (single neighborhood, walk/bike/transit) | Mobility |
| Draw-area + select-areas tools with population-weighted summary | Analysis |
| Split map view with synchronized pan/zoom | Analysis |
| Time slider for income, population, unemployment (5-year history) | Time-series |
| Correlation/scatter explorer (Pearson r + best-fit) | Analysis |
| Similarity engine (10 metrics, top-5) | Analysis |
| Region-level ranking (69 seutukunnat) + neighborhood ranking table | Analysis |
| 4-step discovery wizard + filter panel with presets/ranking | Analysis |
| Multi-neighborhood comparison panel (max 3, table + chart) | Analysis |
| NeighborhoodPanel: quality badge, radar, sparklines, metro diffs, source attribution | UX |
| Mobile bottom-sheet + swipe tabs, 44px touch targets | UX |
| Colorblind palettes; FI/EN/SV i18n (lazy EN/SV) | Accessibility / i18n |
| Onboarding tour, keyboard shortcuts overlay, geolocation, embed mode | UX |
| Score-card PNG export, CSV export, browser-print PDF export | Export |
| WebGL-unavailable graceful fallback | Resilience |
| PWA (NetworkFirst HTML / CacheFirst tiles / SWR geodata), auto-update | PWA |
| ~27,000 prerendered profile pages with JSON-LD, noscript tables, hreflang | SEO |
| 207 regional hubs + all-areas directory + sitemap.xml; llms.txt | SEO |
| Optional backend: JWT/bcrypt/Turnstile auth; cloud sync of favorites/notes/preferences | Backend |
| IP rate limiting, timing-attack-resistant login | Backend |
| Sentry, Umami, web-vitals tracking | Observability |
| CI/CD: 145 Vitest + 8 Playwright, axe-core, Lighthouse CI, CodeQL, npm/pip audit | CI/CD |
| ~210KB gzipped bundle budget; code splitting; lazy @turf modules; auto-merge | CI/CD |
| Build-derived data-freshness timestamp in settings | Data ops |
| URL deep-linking for pno/layer/compare/city (+ legacy hash migration) | State |
| Quarterly data-refresh workflow with GeoJSON validation; daily on-droplet pg_dump backups | Data ops |
