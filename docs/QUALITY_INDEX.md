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

The 58 available factors are grouped into **four evaluative dimensions** plus
two descriptive ones. Each dimension is scored once and then weighted, so each
concept counts once. The default factor weights within a dimension sum to that
dimension's target.

| Dimension | Weight | Factors (default weights) | Why |
|-----------|-------:|---------------------------|-----|
| **Safety & peace of mind** | 23 | Violent crime 15 · traffic safety 8 | Feeling safe is foundational; fear of crime is a large, persistent drag on life satisfaction. The crime figure is *crimes against life and health*, not total offences — see below. |
| **Health, nature & calm** | 28 | Air 9 · tree canopy 8 · quiet (low noise) 7 · water 4 | Clean air, green and blue space and quiet have robust positive effects on physical and mental health. |
| **Livelihood & purpose** | 26 | Employment 12 · income 10 · education 4 | Unemployment is one of the largest wellbeing shocks; income matters with steep diminishing returns; education is kept small as it is ~76 % redundant with income. |
| **Everyday freedom & ease** | 23 | Walkability 7 · transit 7 · essential services 6 · cycling 3 | Getting around easily with essentials within reach reduces daily friction; amenity *density* is deliberately demoted. |
| **Housing context** | 0 | (descriptive — see below) | No objective "better" direction. |
| **Demographics & other** | 0 | (descriptive — see below) | No objective "better" direction. |

The four evaluative weights sum to 100, so each is readable as a percentage of
the score. The ordering — a healthy environment first, then livelihood, then
safety and everyday ease level — is a deliberate editorial stance, not an
institutional formula.

The 11 points freed by cutting safety from 30 to 23 went to **traffic safety
(4 → 8), transit (3 → 7) and essential services (3 → 6)**. All three are
postal-resolution and directly measured, which is the point: the reason safety
was cut is that crime is a *municipal* number, and weight spent on it cannot
distinguish two neighbourhoods in the same city. Moving those points onto
measurements that do vary per postal code raises how much the index can actually
tell apart, rather than just rounding the total back up.

They deliberately did **not** go to income, employment or education — already 26
combined and mutually correlated, with education capped at 4 for being ~76 %
redundant with income — nor to `water_proximity` (2,789 of 3,018 areas read
exactly 0), `walkability_index` (37 distinct values nationally, 1,412 areas
sharing one), noise (74 % carry a modelled baseline) or air quality (a coarse
~5–10 km SILAM grid, flagged `is_proxy`). Weighting a degenerate or coarse metric
harder buys no discrimination.

### Why safety is weighted 19 and not 30

Two measurement facts, not a judgement that safety matters less:

1. **It is municipal.** Finland publishes no crime statistic below municipality
   level — StatFin table `13h4`'s area variable is 1 whole-country + 19 maakunta
   + 308 municipalities, with no postal codes. Every postal code in a city
   therefore carries the same value. At weight 26 a quarter of a *neighbourhood*
   score could not move when comparing neighbourhoods in one city, which is the
   most common use of the app. The index advertised 100 points of discrimination
   and delivered 74.
2. **The old metric was not measuring safety.** It read `crime_index`, i.e. all
   recorded offences. Measured nationally for 2025, that is 47 % property crime
   and 22 % traffic infractions; crimes against life and health are 8 % of it.
   The factor now reads `violent_crime_rate` (crimes against life and health,
   five-year mean, withheld under 2,000 residents), which is what the label
   claims. Total offences and property crime remain available as opt-in factors
   at weight 0 — never alongside each other, since `crime_index` is the parent
   of both and weighting a parent with its child double-counts.

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
for a healthy environment (28), safety (23) and everyday ease (23).

The same redundancy argument is why safety is not built from a socioeconomic
proxy. An earlier pipeline spread the municipal crime rate across postal codes
using density, unemployment and rent; the result correlated +0.58 with rental
rate within a municipality, so the index would have counted rent and
unemployment a second and third time under a safety label. Measured at the level
crime is actually published, crime and income are essentially uncorrelated
(r = −0.09), which is exactly the sign that the earlier within-city variation was
manufactured rather than observed.

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
| **Balanced** | Every evaluative dimension weighted *exactly equally* (25 each across the four evaluative dimensions, summing to exactly 100 via largest-remainder allocation) — distinct from Default. |
| **Family with children** | Services, safety, education |
| **Young professional (car-free)** | Mobility (transit/cycling/walking), services, prosperity |
| **Student** | Mobility, services, quiet |
| **Retiree** | Safety, healthcare services, clean & quiet environment |
| **Nature & quiet** | Environment, tree canopy, low noise |

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

## Direction: which end of a metric is "good"

Normalizing a metric says how much of it an area has; it does not say whether more
of it is better. Two separate things answer that, and the index keeps them apart on
purpose.

**`invert` is a fact about the data.** It is true when the raw column runs opposite
to the factor's own label: `water_proximity_m` is a distance while the label is
"Veden läheisyys" (proximity), and `unemployment_rate` is the inverse of the label
"Työllisyys". Applying it yields a score that means *how much of the labelled
quantity this area has* — nothing more. A factor whose label already names the raw
quantity (`noise_pollution` → "Melu") is **not** inverted.

**The sign of the weight is the user's preferred direction**, and `invert` never
consults it, so the two compose instead of cancelling. **Every factor is signed**:
each slider runs −100…+100 with zero in the middle, where

- **+** favours areas with *more* of the labelled quantity,
- **−** favours areas with *less* of it,
- **0** drops the factor from the index entirely.

Because `invert` lands first, **"+" means the same thing on every slider** — more of
whatever the slider is named after — whether that is "Asukastiheys", "Veden
läheisyys" or "Melu". The panel spells the two ends out (`← vähemmän` / `enemmän →`),
snaps to zero near the middle so dragging down to "ignore this" cannot overshoot
into "prefer the opposite", and announces the direction in words to screen readers
rather than leaving a bare "−40" to be interpreted.

A weight's **magnitude** sets the factor's share of the index; only its sign chooses
a direction. So −60 and +60 pull equally hard, in opposite directions.

### Why hazards carry negative default weights

The corollary of a uniform "+" is that factors whose label names a hazard are
counted **negatively** by default. The default index weighs traffic accidents at
**−8** and noise at **−7** — read as "we want less of these, weighted 8 and 7". This
is not a change in what the index computes; it is the same arithmetic, written so
that a weight map states its own direction. Reading the defaults now tells you both
what is counted and which way it points.

Factors whose label names something desirable keep positive defaults, with `invert`
doing the reconciliation where the raw column disagrees — Safety **+15** reads
`violent_crime_rate` inverted, Employment **+12** reads `unemployment_rate`
inverted.

### What the signed sliders buy

Everything descriptive — demographics, housing composition, tenure, sectoral
employment, prices, party support — has no better direction at all, so the sign is
the only way to express a preference. The built-environment cluster (transit,
services, groceries, restaurants, walkability, cycling, sports facilities, EV
charging, water proximity) is the same: "I want a quiet rural spot with no bus stop
and no supermarket" is a mainstream Finnish search and is only expressible because
those sliders run both ways.

Signing the hazards too means the index can be pointed at things it would not
recommend — a positive weight on crime or radon ranks the *worst* areas highest.
That is a deliberate consequence of letting users define their own lens rather than
having the tool refuse. It is worth remembering when reading a customised score:
the category labels still run *Vältä* → *Erinomainen*, but under a custom weighting
they describe fit to that weighting, not a general verdict. Profile pages reached
in-app after a weight change are badged *mukautettu* for exactly this reason; the
published, prerendered scores always use the documented defaults.

## Data sources

Every factor traces to a real source — Statistics Finland (Paavo), HSL/HSY,
Helsinki Region Infoshare, OpenStreetMap, and the per-metric attributions shown
in the neighborhood panel. No values are fabricated or interpolated as
placeholders.
