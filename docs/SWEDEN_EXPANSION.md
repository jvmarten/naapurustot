# Sweden expansion — scoping

Status: all of Sweden is on the map and has profile pages (2026-10-27). What was built,
and where it differs from the plan below, is in §7.

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

Finnish layers with **no** Swedish equivalent found yet (radon, health index, flood risk, planning) are left out for Sweden, not filled in; §11 says why for radon and flood risk.

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

## 7. As built (2026-10-27)

Steps 1–7 and 9 of §5 landed together. The Stockholm-only pilot was skipped, because the
pipeline handles the whole country as cheaply as one region. Differences from the plan:

- **One national view for both countries, not `city=se`.** `city=all` ("Suomi ja Ruotsi")
  draws Finland's 69 and Sweden's 71 region outlines from one file,
  `src/data/region_outlines.topojson`, built in `build:data`. National ranges, national
  averages and the quality index stay Finland's (filtered by `countryOfId`), so no Finnish
  figure moved. Every Finnish artifact rebuilt byte-identical.
- **One set of artifacts, not `src/data/<country>/`.** Swedish region files sit beside the
  Finnish ones (`regions/se_*.topojson`), and `region_properties.json` carries both
  countries (1.0 → 1.5 MB gzipped, fetched only by the national-set features). The search
  index, fetched at idle, grew from 43 to 102 kB gzipped.
- **The region registry is code, not a fetched file.** `src/utils/regionsSe.ts` is generated
  as compact tuples, without centres, zooms or municipality codes, because every caller of
  `REGIONS` reads it synchronously. That, the 71 names in the bundled `fi.json`, and the
  extra region-file URLs are what the map bundle grew by (§2.5, Q3).
- **Layers.** Sweden has 15: three of its own (economic standard in SEK, low economic
  standard, foreign background) and twelve that share a key with Finland under SCB's
  definitions. Each shared key has a definition note and its own colour stops (`stopsSe`).
  On a Sweden-only map the layer list shows only these, the comparison scope reads
  "Koko Ruotsi", and a Finnish-only layer switches to economic standard.
- **Panel.** A Swedish area gets SCB's rows. Paavo-shaped breakdowns, the radar, the
  strengths summary, trends, the fit badge and the profile link are hidden, because each
  would score against Finland or render empty.
- **Suppressed cells.** In the tenure and house-type tables SCB never publishes a 1 or a 2,
  so a suppressed cell holds 1–2 persons. A share containing one is published only when
  both bounds round to the same decimal. Region aggregates use the 1.5 midpoint inside
  Σ numerator / Σ denominator, which is at most half a person per area, so they are not
  biased by leaving those areas out.
- **Profile pages (step 8):** all 18,480 (fi/en/sv), at the same routes as Finland's,
  from `scripts/prerender-se.mjs`, plus their own sitemap child (`sitemap-alue-se`). They
  are about 15 KB each, with no per-area social card or oEmbed, so the published tree grew
  in pages but not in rasterizing time: 58,936 files (guard raised to 66,000), kept under
  the ~65,000 that once broke the Pages sync. The region link in the breadcrumb opens the
  region on the map, because Swedish regions have no hub pages yet.
- **Country views and coastline (later the same day).** Picking Finland or Sweden in the
  region selector now narrows the national view to that country (`city=fi` / `city=se`),
  as §3.2 first planned. DeSO polygons are cut to OSM's land polygons before
  simplifying (`scripts/se/clip_deso_land.py`), because SCB's run out to sea where
  Paavo's stop at the shore.
- **Not yet:** Swedish region hubs and ranking pages, and Swedish history before 2024 (Q5).

## 8. Quality index for Sweden (2026-10-27)

The default factors, Swedish source per factor (all per DeSO unless noted):

| Factor | Sweden | Same method as Finland? |
|---|---|---|
| Employment, education | SCB | SCB's definitions (scored within Sweden) |
| Income | SCB ekonomisk standard, SEK (`propertiesSe`) | Different concept, scored within Sweden |
| Transit, healthcare, grocery, cycling | OpenStreetMap extract (`fetch_se_osm.py`) | Same tags. Swedish stops look under-mapped (60k vs Finland's 95k OSM stops) |
| Schools | Skolverket register (`fetch_se_schools.py`) | Register, like Opintopolku |
| Daycare | — | Preschools are not in Skolverket's register |
| Air quality | FMI SILAM (`fetch_se_air_quality.py`) | Same model and index as Finland's SILAM fill-in |
| Walkability | Six densities' percentiles within Sweden | Same formula |
| Water proximity | OSM water + SCB 1 km grid (`fetch_se_water_proximity.py`) | Same method |
| Tree canopy | Copernicus TCD 2024, 10 m, from the CDSE S3 archive (`fetch_se_canopy.py`), 2018–2024 as a series | Same product and method; Finland moved to the same reader (`scripts/tcd_cdse.py`) |
| Safety (violent crime) | Brå, BrB 3 kap., 2021–2025 mean, per municipality and, in Stockholm, Göteborg and Malmö, per city district (`fetch_se_crime.py`) | Same concept and method; Swedish counting rules, so own stops. `is_proxy` |
| Traffic accidents | Trafikanalys, police-reported injury accidents per kommun, 2022–2024 (`fetch_se_kommun_layers.py`, §11) | Municipal proxy and injury-only; Finland's are point-level and include property damage. Own stops |
| Noise | EEA's END round-4 road Lden contours (`fetch_se_noise.py`, §11) | Same method (band midpoints, 40 dB outside the contours) |

**Crime (2026-10-28).** `statistik.bra.se` was never blocked: it serves the wrong
intermediate certificate (GeoTrust EV RSA CA 2018 instead of DigiCert EV RSA CA G2), which
browsers repair and Python does not. `fetch_se_crime.py` appends the right intermediate
(`scripts/se/certs/`) to the CA bundle, keeps verification on, and drives Brå's table form
for all 290 municipalities: violent crime (BrB 3 kap., five-year mean, the default safety
factor), property crime (8–12 kap.) and total offences, per 1,000. Totals match Brå's
published municipal CSV exactly. `apply_se_crime.py` writes them into the committed
`se_deso.geojson`; a full `build_se_geojson.py` run does the same.

The same afternoon, the three largest cities went to district level. Brå publishes their
20 current districts; `fetch_se_districts.py` downloads the cities' own boundaries
(Stockholm's 11 stadsdelsområden from 2024, dataportalen.stockholm.se, no licence stated;
Göteborg's four stadsområden from 2021, CC0; Malmö's five 2013 stadsområden, CC0, which
Malmö no longer uses but Brå still reports by) and assigns each of the 1,098 DeSOs to the
district holding most of its area (`deso_district.json`; 26 straddle a boundary at under
90 %). The check that the assignment fits Brå's geography: each district's population
implied by Brå's count and rate agrees with the sum of its assigned DeSOs' residents to
within 0–3.4 %. Järva and Norra innerstaden (formed 2024) report 0 offences for earlier
years; a year with no offences at all is read as "did not exist" and left out of the mean,
so their violent figure is a 2024–2025 mean.

Scoring: each country against its own p2/p98 ranges, missing factors dropped, then the
Swedish composite mapped onto Finland's by quantile under the default weights (CLAUDE.md,
Sweden note 9). Accidents and noise arrived in §11, so every default factor now has a
Swedish source; within the services factor Sweden still has no daycare count.

## 9. More layers (2026-10-28)

Sweden went from 28 to 32 layers:

| Layer | Source | Notes |
|---|---|---|
| Tree canopy | Copernicus HRL Tree Cover Density, 10 m, yearly VLCC release: 2024 on the map, 2018–2024 on the year slider | The EEA ImageServer both countries used was retired; `scripts/tcd_cdse.py` finds the tiles in the CDSE catalogue (no login) and reads them from CDSE's S3 (`CDSE_S3_ACCESS_KEY`/`CDSE_S3_SECRET_KEY`), counting every pixel whose centre is inside the area. Every year sits on the same 100 km grid, so one label raster per tile serves all seven. Finland's postal areas were re-measured from the same tiles, so both countries share one product and Finland's colour stops; the capital region keeps HSY's 2024 LiDAR as its current value, and its slider years are Copernicus like everywhere else. Swedish areas are measured inside the shore-clipped polygons. The canopy factor now scores Swedish areas. |
| EV charging | OpenStreetMap `amenity=charging_station`, nodes and ways, one per coordinate | Same rule as `fetch_ev_charging.py`, from the same 2026-10-27 extract as the other OSM counts (those came out unchanged). Finland's stops. |
| Single-person households | SCB TAB6568, *ensamstående utan barn* / all households | Sweden's own stops (`note.se_households`). |
| Building age | SCB TAB6540, residential buildings by construction decade | Mean of decade midpoints, Finland's convention; Sweden's is per DeSO, not a municipal proxy. Sweden's own stops. |

Checked and left out, so they are not re-investigated:

- **Population, income and unemployment change.** The DeSO 2025 series begin in 2024 (SCB
  returns 0 for 2010–2023 under the new codes). 5,835 codes carry over from DeSO 2018, but a
  shared code does not mean a shared boundary: 1,230 of them differ by over 1 % of their
  area (only 2,922 are identical), and DeSOs are redrawn where population grew, so keeping
  only unchanged areas would leave out the growth. Revisit once the 2025 series spans five
  years (reference year 2029).
- **Young children (0–6) and young adults (18–29).** SCB's DeSO ages come in five-year
  bands (0–4, 15–19, ...), which cannot give the age span the layer is named for.
- **Jobs by sector.** SCB publishes employed people by where they live (TAB6681/TAB6682);
  Finland's layers count jobs where they are. Different measures.
- **Light pollution.** Since added (§13).
- **Daycare and sports facilities.** Finland's come from registers (Varda, LIPAS); an OSM
  count would be a different measure. Preschools are not in Skolverket's register (§8).
- **Then attempted (§11):** property prices and rent, broadband, radon, noise, flood risk,
  traffic accidents.

## 10. Elections (2026-10-29)

Sweden went from 32 to 43 layers with the Riksdag election of 13 September 2026:
turnout, party diversity and political lean on Finland's keys, and the eight Riksdag
parties (S, M, SD, V, C, KD, MP, L) as Sweden-only layers (`party_se_*`). Source:
Valmyndigheten's final count per election district (`roster-per-distrikt-slutligt-…
-riksdagsvalet-2026.xlsx`) and its 2026 district boundaries (`valdistrikt-riket-2026.zip`),
both from val.se's *Rådata val 2026* page, free to use with Valmyndigheten named.
`scripts/se/fetch_se_election.py` → `election_deso.json` → `apply_se_election.py` (or a
full `build_se_geojson.py`).

That is finer than Finland's figures, which are municipal outside the capital region:
6,312 districts with a boundary, each ~1,000–2,000 voters. Districts and DeSOs are drawn
independently (31,233 overlaps), so each district's counts go to the DeSOs it overlaps by
where its residents live — SCB's 1 km population grid, cells split by area — and every
metric is computed from the apportioned counts. The script fails unless the apportioned
national valid votes, electorate and votes cast equal the published totals.

- **Formulas are Finland's** (`fetch_election_results.derive_metrics`). Lean uses CHES 2019
  `lrgen` for the Swedish parties (CHES2019V3.csv, country 16), the survey Finland's index
  uses, so it keeps Finland's colour stops. Diversity is the normalised Shannon entropy per
  district, then a valid-vote-weighted mean per DeSO: the index divides by ln(parties with
  votes), and apportioning would hand every DeSO its neighbours' one-vote parties.
- **Collection districts.** Early votes arriving too late for the polling stations are
  counted on the Wednesday in an *uppsamlingsdistrikt*, which has votes but no area and no
  electorate: median 5.5 % of a municipality's votes, 1.4 % (Ovanåker) to 23 % (Dorotea),
  highest in sparsely populated municipalities. Valmyndigheten's district turnout leaves
  them out, which would draw rural Norrland as low-turnout for reasons of post. For turnout
  they are spread over the municipality's districts in proportion to the votes counted
  there, so each municipality's DeSOs add up to its published turnout (national 84.9 %).
  Party shares use only the votes counted in districts, which are the ones with a place.
- Extremes are Valmyndigheten's own: an Ekerö district counted 49 % (0125C1080 reads
  55 %), Södra Ängby 98 %.

## 11. The rest of the list (2026-10-29)

Sweden went from 43 to 48 layers. Every Finnish layer on §9's "not attempted" list was
looked for; three came in on Finland's keys, two as Sweden-only layers, two stay out.

| Layer | Source | Level | Notes |
|---|---|---|---|
| Rent (`rent_se`, kr/m²/month) | SCB TAB4590 / TAB4549, mean annual rent per m² in rental flats ÷ 12, 2026 | kommun; Stockholm's 11 and Malmö's 5 districts | Göteborg's SCB districts are the ten pre-2021 SDNs, which no current boundary matches, so it takes the kommun figure. SEK, so its own layer rather than Finland's €-formatted key |
| House price (`house_price_se`, kr) | SCB TAB1169, mean purchase price of permanent detached houses sold, 2025 | kommun | Finland's `property_price` is flats per m²; SCB publishes flats (bostadsrätter) only per län |
| Broadband (`broadband_coverage_pct`) | PTS bredbandskartläggning 2025 (bredbandskartan's GeoServer), households and workplaces with access to ≥ 100 Mbit/s | kommun | Finland counts buildings. PTS prints no table for Sundbyberg (its sparse part is one household), so Sundbyberg is empty, not imputed. Own stops (96–99.99 %) |
| Traffic accidents (`traffic_accident_rate`) | Trafikanalys, police-reported injury accidents by the kommun where they happened, 2022–2024 mean per 1,000 residents | kommun | Injury accidents only; Finland's register points include property damage. The kommuner add up to Trafikanalys's national total every year (its "–" read as 0). Own stops |
| Road noise (`noise_pollution`) | EEA, END round-4 road Lden contours as reported by Sweden (10 m raster, update April 2026) | DeSO | Finland's method: band midpoints, ">75" as 77.5, 40 dB outside the contours; Finland's stops. 12 % of DeSO land is outside the mosaic's footprint (northern Lapland, inland Småland), i.e. no road the directive maps; it takes the background like ground between contours |

All four municipal figures are flagged `is_proxy` (`validate_data.py` enforces it).
Accidents and noise are default quality-index factors, so Swedish scores now include them:
the calibration curve was rebuilt, Swedish region averages moved by −0.6 (Storuman) to +7.4
(Bollnäs-Ovanåker), rural regions up, as §8 expected. No Finnish figure changed.

Checked and left out, so they are not re-investigated:

- **Flood risk.** Finland's figure is the share of land in the 1/100a zone *within SYKE's
  mapped extent*, null outside it. MCF (formerly MSB) publishes 100-year river floods
  nationally for only 4 of its 80 mapped watercourses (the rest carry only the highest
  computed flow), its Floods-Directive maps cover 25 areas with coastal levels as 2150
  climate scenarios, and no service has a mapped-extent polygon, so "mapped and dry"
  cannot be told from "never mapped". The pan-European alternative was tried and rejected: the
  Copernicus EMS / JRC river flood hazard map (v3.1.1, RP100, 90 m, CC BY 4.0) covers
  every DeSO, but its 90 m terrain floods whole flat neighbourhoods. In central Uppsala it
  puts six DeSOs at 100 % where MCF's own 5 m Fyrisån 100-year map gives 0, 0, 0, 3.3,
  18.4 and 43.5 %. A layer that wrong where people live is worse than no layer.
- **Radon.** Finland's is STUK's measured indoor radon per postal code. Sweden has no
  national register of indoor measurements (SSM leaves them to the kommuner, SCB has no
  table); SGU's ground-radiation maps measure something else. The JRC European Atlas of
  Natural Radiation does map indoor radon on 10 km cells from national surveys, but only
  in its viewer (no download), and its terms say no action may be taken on the data
  without consulting each data provider.
- **Price-to-rent.** Needs flat prices per kommun, which SCB does not publish.

## 12. Layers checked on request (2026-10-29)

Sweden went from 48 to 55 layers. Of the twelve Finnish layers never looked into before,
seven came in, five stay out.

| Layer | Source | Level | Notes |
|---|---|---|---|
| New residential buildings (`new_buildings_se`) | SCB TAB6540, residential buildings built 2021–2030 / those with a known decade, 2025 | DeSO | Finland's `new_construction` counts buildings under way, so own layer. SCB's ".." here is a zero: with it read as 0 each kommun's DeSOs add up to the kommun's published count (281 of 290 exactly, the rest within the ±2 cell noise), which `fetch_se_extra.py` re-checks |
| School grade points (`school_grades_se`) | Skolverket planned-educations API v3, upper-secondary average grade points (0–20) for diploma students, three latest years per programme | DeSO holding the school (560) | Finland's mean of the lukios in a postal area, null elsewhere, mirrored. A school is the plain mean of its programmes (sizes given only as "cirka 40") |
| Job self-sufficiency (`job_self_sufficiency`) | SCB TAB1828, jobs in the kommun per 100 employed residents, 2024 | kommun | Same ratio as Finland's; no Swedish region average (no job counts to sum). Own stops |
| Mean age (`he_kika`) | SCB TAB637, 2025 | kommun | DeSO tables have only 5-year bands. Own stops |
| Ohälsotal (`sickness_se`) | Försäkringskassan via Kolada N00957, benefit days per resident 16–64, 2025 | kommun | Not Kela's age-standardised morbidity index, so own layer |
| Pensioners 65–74 (`pensioners_se`) | Kolada N02287, 2024 | kommun | A rate within one age band, not Finland's share of all residents |
| Planning reserve (`planned_homes_se`) | SKR via Kolada N07923, homes current detailed plans allow per 1,000 residents, 2025 | kommun | Self-reported survey: 198 of 290 kommuner answered; the rest are empty |

All kommun figures are `is_proxy`. None is a default quality-index factor; scores did not move.

Checked and left out:

- **Average apartment size.** Only dwellings counted in 10 m² bands per kommun (TAB826);
  a mean would need assumed band midpoints, including for "under 31" and "over 200".
- **Living space per person.** No source below national level (TAB828 is a survey).
- **Student share.** SCB counts students where they study, not where they live.
- **Transit reachability.** Needs a routing run — done in §15.
- **Price-to-rent.** As §11.

## 13. Light pollution (2026-10-30)

Sweden went from 55 to 56 layers. `light_pollution` is on Finland's key and Finland's
stops: NASA Black Marble VNP46A4 (collection 2), `NearNadir_Composite_Snow_Free`, the
**2024** annual composite. That is Finland's year: its 500 m grid matched the 2024 tiles
cell for cell (1,004 of 1,004 sampled) and the 2025 tiles in none. 2025 is published; a
move to it should change both countries together.

`scripts/se/fetch_se_light.py` → `light_deso.json` → `apply_se_light.py` (or a full
`build_se_geojson.py`). Tiles h19v02, h19v03 and h20v02 (h20v03 holds no Swedish land),
found through CMR and read from LAADS DAAC, both under a NASA Earthdata bearer token. In
the cloud sessions the network proxy adds that token for `cmr.earthdata.nasa.gov` and
`data.laadsdaac.earthdatacloud.nasa.gov`; the script sends `EARTHDATA_TOKEN` only if it is
set. Each DeSO is the mean of the pixels whose centres lie inside its shore-clipped polygon,
as Finland's postal mean is. A pixel is ~460 × 230 m, so 209 small city DeSOs hold no
pixel centre; they take the mean of the pixels they touch, rasterized one by one (in a
shared label raster a neighbour drawn later takes the shared pixels, which left 64 of them
with nothing). All 6,160 have a value: median 14.7, max 261 (Södra Hammarbyhamnen),
six forest DeSOs in Värmland at 0.

Finland's 500 m grid overlay is not extended to Sweden: every grid in `grid_manifest.json`
is Finland's, so a Swedish view (`viewCountry === 'se'`) no longer fetches one. Before
that, a Swedish region asked for a shard that does not exist and fell back to the whole
11 MB Finnish file, only to clip every cell away. The layer's default quality-index weight
is 0, so scores did not move.

## 14. Trend layers (2026-10-30)

Sweden went from 56 to 60 layers, all per kommun (`is_proxy`) and all on Finland's windows.

| Layer | Source | Notes |
|---|---|---|
| Crime change (`crime_index_change_pct`) | Brå, all reported offences per 100,000, 2020 → 2025 | Finland's figure is its municipal rate's change over the same years, so Finland's key and stops (a relative change, whatever the counting rules). Per kommun even where the level is per city district: Järva and Norra innerstaden did not exist before 2024. `fetch_se_crime.py`, written by `crime_props` |
| House price change (`house_price_change_se`) | SCB TAB1169, mean purchase price of permanent detached houses sold, 2020 → 2025 | Sweden-only, as `house_price_se` is. SCB prints every kommun however few houses sold (fewest: Dorotea, 11 then 8), so the counts are kept beside it in `kommun_layers.json`. Median +18.5 %, one fall (Dorotea −26 %). `fetch_se_kommun_layers.py`, written by `later_props` |

| Construction activity (`construction_activity`) | SCB TAB2538, completed dwellings in newly constructed buildings, 2020–2025, per 1,000 residents (SCB 2025) | Finland's measure (dwellings completed 2020– per 1,000 residents of the municipality), so Finland's key and stops; the two distributions are close (medians 14.2 and 12.1). The kommuner add up to SCB's national total every year, which the script checks |
| Population projection (`population_projection_pct`) | SCB TAB6300, Befolkningsframskrivning 2022, population 2022 → 2040 | Finland's is Tilastokeskus 2024, base year → 2040. 2022 is SCB's latest projection by kommun: the 2023–2025 editions are national only, so the vintage is two years older than Finland's. Finland's key and stops (−18.5 to +22.7 %) |

Both crime change and house price change lack a region figure in the all-regions view:
Finland's change there is derived from the aggregated history arrays, and Sweden carries
none for these two.

## 15. Transit reachability (2026-10-30)

Sweden went from 60 to 61 layers. `transit_reachability_score` is on Finland's key, formula
and stops: the mean rush-hour door-to-door public-transport time from where people live to
the region's centre, mapped linearly from 10 min (100) to 90 min (0). Finland reads its
times from the Helsinki Region Travel Time Matrix; Sweden has no such matrix, so
`scripts/se/fetch_se_transit.py` routes them on Samtrafiken's national timetable.

- **Timetable.** GTFS Sweden 3 (Trafiklab, CC0; `TRAFIKLAB_KEY`), feed 2026-10-30, the
  ordinary Tuesday 2026-11-10: 131,772 trips and 876,492 connections leaving 08:00–14:00.
  The endpoint answers 406 without `Accept-Encoding: gzip`. The 840 MB zip is cached in
  `scripts/se/cache/` (git-ignored), and so is the ~10-minute stop_times parse.
  Three stops have no usable position (e.g. "Stockholm, Tallink" at 0° N 0° E): ridden
  through, never walked to.
- **Routing.** A profile Connection Scan in C (`scripts/se/transit_profile.c`, compiled by
  the script), one backward pass per hub. Door to door: a walk of up to 1.5 km to a stop,
  waiting, riding, changes (1 min slack, walks of up to 400 m between stops), the walk from
  any platform within 500 m of the hub, or walking all the way if that is faster. Walks
  are straight lines × 1.3 at 4.5 km/h — not the street network the Helsinki matrix uses.
  Each origin departs at every minute 08:00–08:59 and the time is the mean of the 60.
  ResRobot (`TRAFIKLAB_RESROBOT_KEY`) was not needed: 1.6 M origins × 60 departures is
  far past any API quota, and the timetable it routes on is this one.
- **Hubs.** Each FA25 region is named after its centre municipality or two of them;
  the hub is that seat's travel centre by name (`<seat> Centralstation / C / resecentrum /
  station / busstation / terminal`, 70 of 85), else the station with the most departures
  08:00–14:00 within 500 m (15, all in their town centres: Sjötorgsgatan in Gällivare,
  Älgen in Örnsköldsvik, Edsbyn Centrum, …). Busiest-cluster alone was tried first and
  rejected: it put Stockholm's hub at Stadsbiblioteket, Malmö's at Möllevångstorget and
  Storuman's in Stensele. Two-centre regions take the mean of both, as Finland's cell
  takes the mean of its four. The chosen hubs are written to `transit_deso.json`.
- **Origins.** Finland averages a postal area's 250 m cells. Here each DeSO's 250 m points
  are weighted by the residents of the SCB 1 km population grid cell holding them
  (`stat:befolkning_1km_2025`), so a 2,000 km² forest DeSO is scored where its village
  is: 1.62 M points; 53 DeSOs with none are scored at their representative point.
- **Bounds.** A departure minute from which nothing reaches the hub on a connection
  leaving by 14:00 is only a lower bound; 308 points whose bounded mean still scored above
  0 were left out rather than published high.

All 6,160 DeSOs have a value: median 45.3 (Finland's 183 Helsinki-region postal areas:
64.4), 856 at 0, mostly Norrland and Gotland outside their towns. Majorna and Kortedala
in Göteborg score ~80, Möllevången in Malmö 85, Stockholm's suburbs 50–75. Default
quality-index weight is 0, so no score moved.

