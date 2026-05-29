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
for safety (30), a healthy environment (28) and everyday ease (16). Every factor
that carries default weight has ~97–100 % coverage in all regions except transit
(patchy outside Helsinki) and traffic safety (~70 %), both small.

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
| **Balanced** (default) | All dimensions in balance (the table above) |
| **Family with children** | Services, safety, education |
| **Young professional (car-free)** | Mobility (transit/cycling/walking), services, prosperity |
| **Student** | Mobility, services, quiet |
| **Retiree** | Safety, healthcare services, clean & quiet environment |
| **Nature & quiet** | Environment, green space, low noise |

Personas are just weight presets — users can fine-tune any factor afterwards,
and a "How is this calculated?" popover on the Quality badge lists the active
dimensions and weights.

## Category labels

The harsh directional labels were replaced with descriptive, non-pejorative
wording (colors unchanged):

| Range | Old | New |
|-------|-----|-----|
| 0–20 | Avoid | **Emerging** |
| 20–40 | Bad | **Developing** |
| 40–60 | Okay | **Balanced** |
| 60–80 | Good | **Strong** |
| 80–100 | Excellent | **Excellent** |

## Normalization (current & planned)

Each metric is currently **min–max normalized over the loaded area**, with the
existing *comparison scope* toggle letting users switch between the whole loaded
view and a single region. A consequence is that a score's meaning shifts when
you switch regions — the best postal code in a small region can score ~100 just
like the best in Helsinki.

**Planned (CF-1 phase C):** compute fixed **national percentile breakpoints**
once at build time over all ~3 018 postal codes, store them as a data artifact,
and normalize against them so "72" means the same everywhere — keeping the
"within region" toggle as an explicit opt-in. This change alters the meaning of
every published score and is the part of CF-1 that most warrants editorial
review before release; it is intentionally **not yet enabled by default**.

## Data sources

Every factor traces to a real source — Statistics Finland (Paavo), HSL/HSY,
Helsinki Region Infoshare, OpenStreetMap, and the per-metric attributions shown
in the neighborhood panel. No values are fabricated or interpolated as
placeholders.
