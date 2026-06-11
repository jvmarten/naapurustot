# The naapurustot.fi Quality Index

> Methodology for the headline **Quality Index** — the default map layer and the
> first number every visitor sees. This document explains how it is computed,
> why each weight was chosen, and where it is deliberately conservative.
>
> **This methodology and its category wording are open to editorial revision.**
> The choices below are defensible defaults, not the last word.

## Why the index looks the way it does

The original index was a flat, hand-tuned blend dominated by income,
employment, education and crime — all strong proxies for area **affluence**
(in this dataset `income` and neighbour `education` correlate at **+0.76**).
Roughly **80 %** of the score was effectively *one* latent variable
(socioeconomic status) counted several times over: an affluence map relabelled,
analytically weak and editorially loaded, since it quietly stigmatized
lower-income areas while telling users little they couldn't read off the income
layer.

The current index is built from a different question — **what actually makes a
place good to live in?** — using what subjective-wellbeing research consistently
finds: feeling *safe*, a *healthy and calm environment*, *not being unemployed*,
and an *easy daily life* matter far more to life satisfaction than raw income or
the density of nearby amenities. So safety and environment lead, money is
present but mid-weight (with work counting for more than wealth), and service
density is demoted.

## The dimension model

The ~50 available factors are grouped into **four evaluative dimensions** plus
two descriptive ones. Each dimension is scored once and then weighted, so each
concept counts once. The default factor weights within a dimension sum to that
dimension's target.

| Dimension | Weight | Factors (default weights) | Why |
|-----------|-------:|---------------------------|-----|
| **Safety & peace of mind** | 30 | Crime 26 · traffic safety 4 | Feeling safe is foundational; fear of crime is a large, persistent drag on life satisfaction. |
| **Health, nature & calm** | 28 | Air 9 · tree canopy 8 · quiet (low noise) 7 · water 4 | Clean air, green and blue space and quiet have robust positive effects on physical and mental health. |
| **Livelihood & purpose** | 26 | Employment 12 · income 10 · education 4 | Unemployment is one of the largest wellbeing shocks; income matters with steep diminishing returns; education is kept small as it is ~76 % redundant with income. |
| **Everyday freedom & ease** | 16 | Walkability 7 · cycling 3 · transit 3 · essential services 3 | Getting around easily with essentials within reach reduces daily friction; amenity *density* is deliberately demoted. |
| **Housing context** | 0 | (descriptive — see below) | No objective "better" direction. |
| **Demographics & other** | 0 | (descriptive — see below) | No objective "better" direction. |

The four evaluative weights sum to 100. The ordering — safety first, then a
healthy environment, then livelihood, then everyday ease — is a deliberate
editorial stance, not an institutional formula.

### What's deliberately *not* in the default

- **Social connection / belonging** — the single strongest real-world driver of
  happiness — has no faithful proxy in open neighbourhood data. (Voter turnout
  is 100 % covered and, usefully, uncorrelated with income, but it measures
  civic participation, not friendship.) Rather than dress up a weak proxy, the
  default leaves it out, and the "How is this calculated?" popover says so.
- **Wealth as a headline.** Money is capped at mid-weight and split so that
  *employment* outweighs *income*.
- **Amenity density.** Counts of restaurants, shops or gyms barely predict life
  satisfaction, so essential-service access is a token 3 and the rest are opt-in.

### How dimension scoring is implemented

`computeQualityIndices` uses a weighted average of per-factor normalized scores.
Because the default factor weights within a dimension **sum to that dimension's
target weight** (e.g. Health = air 9 + tree canopy 8 + noise 7 + water 4 = 28),
this is mathematically equivalent to scoring each dimension once and then
weighting the dimensions. Splitting Livelihood into employment 12 + income 10 +
education 4 is what stops affluence being counted several times over: pure
socioeconomic status now contributes ~26 % rather than ~80 %, leaving real room
for safety (30), a healthy environment (28) and everyday ease (16).

As of CF-17, every default-weighted factor has ~97–100 % national coverage (Paavo,
HSY, OSM, and — new — the national Digiroad stop register): **transit**
(`transit_stop_density`, weight 3) is now nationwide at **~100 %** (up from ~10.9 %
Helsinki-region only). Thin coverage now only affects *optional* factors a user can
add via custom weights — e.g. **school quality** (`school_quality_score`, ~10 %) and
the optional `transit_reachability` factor (~5.5 %).

Under the default *Whole-of-Finland* scope a missing factor is imputed at the
neutral midpoint. To keep this honest, the neighbourhood panel's **Data coverage**
breakdown shows each active factor's real national coverage and flags the ones that
are sparse *everywhere*, so a "no data here" gap in an otherwise complete metric is
visibly different from a metric that is thin across the whole country.

### Housing & demographics

Housing metrics (price, ownership rate, apartment size) and demographic /
sectoral / civic metrics have **no objective "better" direction** — a high rental
share or a young population is a preference, not a quality. They are therefore
**descriptive** (default weight 0) and never inflate or deflate the default
score, though users can opt them in via custom weights.

## Persona presets

`CustomQualityPanel` ships six named lenses (cloud-synced via the existing
preferences sync):

| Persona | Emphasis |
|---------|----------|
| **Default** (the out-of-the-box index) | The OECD-anchored weighting in the table above — Prosperity leans a little heavier (30). |
| **Balanced** | Every evaluative dimension weighted *exactly equally* (20 each) — distinct from Default. |
| **Family with children** | Services, safety, education |
| **Young professional (car-free)** | Mobility (transit/cycling/walking), services, prosperity |
| **Student** | Mobility, services, quiet |
| **Retiree** | Safety, healthcare services, clean & quiet environment |
| **Nature & quiet** | Environment, green space, low noise |

"Default" and "Balanced" are deliberately separate: the default is opinionated
(material conditions weigh somewhat more, per OECD), while "Balanced" is the
neutral all-equal lens for users who want no built-in emphasis.

Personas are just weight presets — users can fine-tune any factor afterwards,
and a "How is this calculated?" popover on the Quality badge lists the active
dimensions and weights.

## Category labels

The 0–100 score maps to five directional bands (colors unchanged):

| Range | Label |
|-------|-------|
| 0–20 | Avoid |
| 20–40 | Bad |
| 40–60 | Okay |
| 60–80 | Good |
| 80–100 | Excellent |

## Normalization

Each metric is **min–max normalized against fixed national reference ranges** —
the default **"Whole of Finland"** scope — so a score of "72" means the same
thing in Helsinki and in Oulu and postal codes are directly comparable across
regions.

Because the map lazy-loads one seutukunta at a time, the client never holds all
~3 018 postal codes and so cannot derive a nation-wide range at runtime. The
ranges are therefore pre-computed once at build time
(`scripts/build_national_ranges.mjs` → `src/data/national_ranges.json`) over
every postal code. The bounds are **winsorized to the 2nd/98th percentile** so a
single extreme postal code (e.g. a CBD property price far above everywhere else)
can't compress the rest of the country into a narrow band; the missing-data
fallback uses the true national mean. The artifact rebuilds as part of
`npm run build:data`.

The **comparison-scope toggle** lets users opt into **within-region**
normalization instead, which re-derives each metric's range from just the loaded
region's postal codes — useful for asking "which areas are best *within this
region*?" regardless of how the region compares nationally. The all-cities view
always uses the national ranges, so a postal code's score is identical whether
it is reached via its region or via the national aggregate.

> Switching the default to national normalization changed the meaning of every
> published score relative to the earlier region-relative behaviour. The
> methodology and its category wording remain open to editorial revision.

## Data sources

Every factor traces to a real source — Statistics Finland (Paavo), HSL/HSY,
Helsinki Region Infoshare, OpenStreetMap, and the per-metric attributions shown
in the neighborhood panel. No values are fabricated or interpolated as
placeholders.
