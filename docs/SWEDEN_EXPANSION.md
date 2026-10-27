# Sweden expansion — scoping

Status: decided 2026-10-27 (§6). Step 1 of §5 is in progress.

The goal is to add Sweden as a second country, at SCB's **DeSO** level (6,160
demographic statistical areas, 700–2,700 residents each), which is finer than
Finland's Paavo postal areas. Estonia follows once the code is country-generic.

This document lists what assumes "Finland, postal code" today, the decisions
that have to be made before code is written, and a branch-by-branch order that
the auto-merge queue can land one at a time.

## 1. Facts that shape the design

| Fact | Consequence |
|---|---|
| Swedish postal-code boundaries are PostNord's and not openly licensed. | The Swedish unit is DeSO, not postnummer. "Postal code" becomes "statistical area" in code. |
| DeSO 2025 has 6,160 areas, applied to statistics from 2024 onward. Older years are **not** re-cut to the new version ([SCB](https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/demografiska-statistikomraden-deso/)). | Trends only start at 2024 unless we hand-match the 2018 version. Every table we fetch has to be checked for the DeSO version. |
| DeSO codes look like `0180C1090`: 4-digit municipality, a letter A/B/C, then 4 digits. | They can never collide with a Finnish 5-digit `pno`, so no ID prefix is needed (§3.1). |
| **DeSO areas have no names**, only codes. RegSO (3,363 areas, each an aggregate of DeSOs) do have names. | Display names, slugs and search have to come from RegSO (and municipality) names (§3.6). |
| Boundaries are open geodata on Lantmäteriet's Geodataportalen; the statistics sit in SCB's Statistikdatabasen, which is PxWeb ([SCB open geodata](https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/geodata/oppna-geodata/), [DeSO tables](https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/demografiska-statistikomraden-deso/deso-tabellerna-i-ssd--information-och-instruktioner/)). | `scripts/pxweb.py` is a starting point, but SCB's API v2 needs checking against it. |
| Sweden's region equivalent to seutukunnat is the FA-region (funktionell analysregion), published by **Tillväxtverket**, not SCB. FA25 (2025, for 2025–2035) has **71 regions** ([Tillväxtverket](https://tillvaxtverket.se/tillvaxtverket/statistikochanalys/statistikomregionalutveckling/regionalaindelningar/faregioner.1799.html)). Checked 2026-10-27: its list assigns all 290 municipalities exactly once, and every code matches SCB's municipality list. Two names differ only in spelling (`0114` Upplands-Väsby, `2023` Malung); we use SCB's names. | The region tier carries over directly. Stockholm-Solna (36 municipalities), Göteborg (27) and Malmö-Lund (27) are the metro regions. |

## 2. Inventory: what assumes Finland today

Measured on `main` at the time of writing.

### 2.1 Area identity (5-digit `pno`)
- `pno` appears 641 times across 116 files. Most of those uses are just a key and keep working with any string.
- The **validators** are what break. These sites hard-code `/^\d{5}$/` and would silently drop a DeSO code:
  - `src/hooks/useUrlState.ts:315,451,454,463,468,593`: `pno`, `compare`, `ref`, `sl` and `draw=s:`
  - `src/utils/slug.ts:53`: `parseSlug`, which also does `slice(0, 5)`
  - `src/hooks/useShortlist.ts:155`, `src/hooks/useNotes.ts:21,196`, `src/utils/homeReference.ts:16,26`
  - `src/components/SearchBar.tsx:186`: a typed 5-digit number skips geocoding
  - `server/api/src/auth.ts:992`: `PNO_RE` on the notes sync
- Server storage is JSONB arrays and maps keyed by `pno` (`user_favorites`, `user_notes`, `user_shortlist`), so **no migration is needed**, only the validators.

### 2.2 Country scope
- `src/utils/regions.ts`: the `RegionId` union and `REGIONS` cover 69 seutukunnat. `ALL_FINLAND_VIEWPORT`, `DEFAULT_CITY = 'all'` and `getRegionByMunicipality` all assume one country. Municipality codes are Finnish 3-digit codes; Swedish codes are 4-digit, so these don't collide.
- `src/hooks/useUrlState.ts:205,299`: the viewport and draw codecs reject anything outside lng 18–33, lat 58–71. Sweden spans roughly lng 10.9–24.2, lat 55.3–69.1, so Malmö and Gothenburg would be rejected.
- Region labels are 77 `city.*` keys in `fi.json`, which is **statically bundled**.

### 2.3 Data pipeline and artifacts
- `scripts/prepare_data.py` (2,941 lines) is built around Paavo WFS (`geo.stat.fi`) plus about 50 Finnish fetchers. None of it carries over as code; the Overpass, VIIRS and Copernicus fetchers carry over as patterns.
- `scripts/build_region_data.mjs` reads one GeoJSON and groups by `city`. `region_properties.json` (all of Finland, geometry stripped) is **1.0 MB gzipped** for 3,018 areas. At 6,160 areas a Swedish one would be roughly 2 MB, so the national files must be **per country**: a Finland visitor must never fetch Sweden's.
- `national_ranges.json`, `national_percentiles.json`, `region_aggregates.json`, `adjacency.json`, `region_search_index.json` and `seutukunnat.topojson` are all national, and all need a per-country variant.
- `src/data/data_sources.json` has one entry per metric with no country dimension, and `scripts/provenance.json` mirrors it (validation enforces the match).

### 2.4 Metrics and formatting
- `NeighborhoodProperties` (`src/utils/metrics.ts`) uses Paavo field names (`he_vakiy`, `hr_mtu`, `ko_yl_kork`…), and many derived layers are computed from them.
- Currency is hard-coded to euros: the `euro`, `euroSqm` and `euroSqmMonth` formatters and `unit: '€'` in `src/utils/colorScales.ts`, plus `NeighborhoodPanel.tsx`, `TrendChart.tsx`, `JsonLd.tsx`, the affordability tool and the wizard's €/m² bands.
- The quality index (`src/utils/qualityIndex.ts`) has factor weights tuned to Finnish coverage and Finnish sources (e.g. municipal crime from StatFin 13h4), and is normalised with national ranges.

### 2.5 Pages, services, budget
- `scripts/prerender.mjs` emits `/alue/`, `/en/area/` and `/sv/omrade/` per area, about 9,000 pages and 9,261 social cards today. Sweden at three languages would add about 18,500 pages and 6,160 cards. That is exactly the deploy size and time risk described in CLAUDE.md ("Social-card cache").
- `src/utils/geocode.ts` and `src/utils/isochrone.ts` use Digitransit, which covers Finland only.
- The basemap (OpenFreeMap) is worldwide, so nothing to do there. `/live/` is out of scope.
- **Bundle budget:** `BUDGET` has **121 bytes** of headroom. A Swedish region registry written into `REGIONS` as JS, plus 60×3 locale keys in the static `fi.json`, would blow it several times over (est. 2–4 kB gz). The Swedish registry and region names must be a **fetched data asset**, and the country plumbing itself needs room made first.

## 3. Design decisions (recommended)

### 3.1 Area IDs: keep both formats bare, validate in one place
Finnish IDs stay `00100`. Every existing URL, favourite, server row and indexed page keeps working, which a `fi:` prefix would break. Swedish IDs are the raw DeSO code. The formats can't overlap, so one module (`src/utils/areaId.ts`) owns them:

```ts
export const isAreaId = (s: string) => /^\d{5}$/.test(s) || /^\d{4}[A-C]\d{4}$/.test(s);
export const countryOf = (id: string): CountryId => (id.length === 5 ? 'fi' : 'se');
```

All the §2.1 sites call it; the server copies it, as it already copies `PNO_RE`. Estonia later adds its own disjoint pattern.

### 3.2 Country is a property of the region, not a new URL parameter
Add `country: CountryId` to `RegionConfig`. Swedish region IDs get a `se_` prefix (`se_stockholm`) to keep the existing `city=` namespace collision-free. `city=all` keeps meaning all of Finland (the default, and every old link); `city=se` is all of Sweden. Mixed-country selections are refused at first.

### 3.3 Per-country data artifacts
- Source: `public/data/se_deso.geojson`, next to `metro_neighborhoods.geojson` and also stripped from `dist/`.
- `build:data` loops over countries. Finland's outputs keep their current paths and must come out **byte-identical**; the idempotency gate in `checks` proves the refactor changed nothing.
- Swedish outputs go under `src/data/se/` (`regions/*.topojson`, `region_properties.json`, `national_ranges.json`, outlines, adjacency, search index), loaded only once a Swedish region is selected.

### 3.4 Metric keys: share a key only when the definition is the same
Map a Swedish value onto an existing key only if SCB measures the same thing: population or age shares, yes; "median income" generally **no**. Paavo's `hr_mtu` is the median income of residents, while SCB publishes disposable income / "ekonomisk standard" on its own definitions. A different definition gets its own key and its own `data_sources.json` entry. `data_sources.json` grows a per-country level (`metrics.<key>.<country>`), and `validate_data.py` and `provenance.json` follow. Swedish municipal values are flagged `is_proxy` exactly as Finnish ones are.

### 3.5 Currency: show SEK, never convert
Formatters take the currency from the feature's country. Converting to euros would bake in an exchange rate we picked and print it as data. Comparisons and rankings stay within one country (next point), so mixed currencies never meet in one scale.

### 3.6 Rankings and quality index: within one country
DeSO areas and postal areas are different-sized units, so cross-country ranks would mislead. Percentiles, colour scales and rankings are per country. **Launch Sweden without the quality index.** It needs its own factor set and coverage audit (`docs/QUALITY_INDEX.md`), so ship that as a later step rather than showing a score half-built from missing factors.

### 3.7 Names, slugs, search
Display name = RegSO name, plus the municipality when needed to tell areas apart. Several DeSOs share one RegSO, so the slug is `{deso}-{regso-name}` (e.g. `/sv/omrade/0180C1090-sodermalm/`). It's unique because of the code, as Finnish slugs are. `parseSlug` reads the ID with `isAreaId` instead of `slice(0, 5)`. Search indexes RegSO and municipality names. A typed Swedish postnummer goes to geocoding instead of an ID lookup.

### 3.8 Profile pages: all three languages
Swedish areas get `/alue/`, `/en/area/` and `/sv/omrade/` pages like Finnish ones (decided, Q2): about 18,500 more pages and 6,160 more cards, roughly tripling the deploy tree. The droplet serves the site, but the Pages standby still has to stay deployable inside `actions/deploy-pages`' timeout, so measure the `deploy` job, the artifact size and the card rasterising time on the Stockholm pilot before going national.

### 3.9 Services
Geocoding and isochrones are switched off for Swedish regions at first, with the controls hidden rather than broken. Trafiklab ResRobot is the candidate to replace them later.

## 4. Candidate Swedish data sources

All unverified until a fetcher runs against them. "Level" is the finest level we expect to find openly.

| Topic | Source | Level | Notes |
|---|---|---|---|
| Boundaries | SCB via Geodataportalen | DeSO / RegSO | DeSO 2025 version |
| Population, age, sex | SCB Statistikdatabasen | DeSO | |
| Foreign background | SCB | DeSO | Not the same definition as Finland's "foreign language", so a new key |
| Education (25–64) | SCB | DeSO | Tables cover 2015–2023 |
| Employment | SCB | DeSO | Tables cover 2020–2024 |
| Households, tenure | SCB | DeSO | |
| Income / ekonomisk standard | SCB | DeSO? | **Verify** a DeSO table exists, and which definition |
| Property prices | SCB fastighetspriser | Municipality | `is_proxy`. Mäklarstatistik/Booli aren't open |
| Crime | BRÅ | Municipality / police area | `is_proxy` |
| Schools | Skolverket open APIs | School point → DeSO | Register with coordinates, plus results |
| Elections | Valmyndigheten | Voting district (~6,000) | Finer than municipality; needs district geometry |
| Transit stops | Trafiklab GTFS Sverige | Point → DeSO | Needs a free API key; check licence |
| Services (restaurants, groceries, health, EV, cycling) | OpenStreetMap | Point → DeSO | Reuse the Overpass patterns and density rules (4 decimals) |
| Tree canopy | Copernicus HRL | 10 m raster | Same product as Finland |
| Light pollution | NASA VIIRS | ~500 m grid | Same pipeline |
| Air quality | CAMS | ~10 km | `is_proxy` |
| Flood risk | MSB översvämningskarteringar | Polygon | Check coverage and licence |

Finnish layers with **no** Swedish equivalent found yet (radon, health index, broadband, noise, planning) are left out for Sweden, not filled in.

## 5. Branch order

Each is one `claude/*` branch, landed and verified on `main` before the next is pushed.

1. **`areaId` validator.** Add `src/utils/areaId.ts` and switch every §2.1 site plus the server to it. Finland behaviour is unchanged; tests cover both formats. Small, and costs a few bytes.
2. ~~Make bundle room.~~ Not a separate step: each branch raises `BUDGET` by its measured cost plus ~1.5 kB, with the reason recorded in `scripts/check-bundle-size.mjs` (Q3).
3. **Country dimension, Finland only.** Add `CountryId`, `country` on `RegionConfig`, per-country viewport bounds (widen the URL codecs), and a per-country level in `data_sources.json` / `provenance.json` / `validate_data.py`. No user-visible change.
4. **Per-country `build:data`.** Loop the build over countries, keeping Finland's output byte-identical (the idempotency gate proves it), and add the `src/data/<country>/` layout and the loader paths.
5. **Commit FA25 as source data** (Q4): Tillväxtverket's FA25 list joined to SCB's municipality codes, and fail the build if a municipality is unassigned or assigned twice.
6. **Sweden pipeline, Stockholm pilot.** Add `scripts/se/` fetchers for DeSO boundaries, the SCB core tables and the OSM densities for the Stockholm FA-region only. Write `public/data/se_deso.geojson` and build the artifacts.
7. **Frontend: Sweden switch.** Add the fetched region registry and names, SEK formatting, per-country ranges, and hide Digitransit features. Ship the Stockholm pilot behind a non-default region. No quality index yet.
8. **Profile pages for Sweden.** fi/en/sv prerender and slugs; measure deploy time and artifact size.
9. **National Sweden.** All FA-regions plus the `city=se` outline view.
10. **More layers**, then a Swedish quality index with its own factor set.

## 6. Decisions (2026-10-27)

- **Q1 Domain:** everything stays under naapurustot.fi. A global domain can come later.
- **Q2 Languages:** Swedish areas get Finnish, English and Swedish pages, the same as Finnish areas.
- **Q3 Bundle budget:** raise it. `BUDGET` is a ratchet set just above the measured size, so each feature bumps it by its measured cost plus ~1.5 kB, with the reason recorded. Swedish region data still stays out of JS, so a Finnish visitor never downloads Sweden.
- **Q4 Regions:** FA25. Membership is confirmed against SCB's municipality codes (§1); §5 step 5 commits it as source data with a build check.
- **Q5 History:** the latest values are the same either way. Older history (matching DeSO 2018 areas whose boundaries didn't change) is optional and can come later.
